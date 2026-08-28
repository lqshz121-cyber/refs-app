BEGIN;

CREATE TABLE ai_bank_duplicate_payment_lifecycle_function_backup(function_identity text PRIMARY KEY,function_definition text NOT NULL);
INSERT INTO ai_bank_duplicate_payment_lifecycle_function_backup VALUES
 ('resolve',pg_get_functiondef('refs_resolve_ai_finding_action(uuid,uuid,uuid,text,text,integer,text,text)'::regprocedure)),
 ('assign',pg_get_functiondef('refs_assign_ai_finding_action(uuid,uuid,text,uuid,text,text,date,integer,text,text)'::regprocedure)),
 ('candidates',pg_get_functiondef('refs_read_ai_finding_assignment_candidates(uuid,uuid,integer)'::regprocedure)),
 ('summary',pg_get_functiondef('refs_read_ai_accounting_analysis_summary(uuid,uuid)'::regprocedure)),
 ('finding_read',pg_get_functiondef('refs_read_ai_bank_duplicate_payment_findings(uuid,uuid,integer)'::regprocedure));
REVOKE ALL ON ai_bank_duplicate_payment_lifecycle_function_backup FROM PUBLIC,refs_app;

-- Immutable findings from migration 212 remain immutable.  This separate
-- append-only ledger records either a Controller conclusion or replacement by
-- newer evidence, and is the sole authority for the current-risk projection.
CREATE TABLE ai_bank_duplicate_payment_lifecycle (
  ai_bank_duplicate_payment_lifecycle_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant(tenant_id),
  entity_id uuid NOT NULL,
  ai_bank_duplicate_payment_finding_id uuid NOT NULL,
  finding_hash text NOT NULL CHECK(finding_hash~'^sha256:[0-9a-f]{64}$'),
  disposition text NOT NULL CHECK(disposition IN('DUPLICATE_CONFIRMED','VALID_DISTINCT_PAYMENTS','SUPERSEDED_BY_NEW_EVIDENCE')),
  human_evidence jsonb,
  successor_finding_id uuid,
  successor_finding_hash text CHECK(successor_finding_hash IS NULL OR successor_finding_hash~'^sha256:[0-9a-f]{64}$'),
  created_by text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE(tenant_id,entity_id,ai_bank_duplicate_payment_finding_id),
  UNIQUE(tenant_id,entity_id,ai_bank_duplicate_payment_lifecycle_id),
  FOREIGN KEY(tenant_id,entity_id) REFERENCES entity(tenant_id,entity_id),
  FOREIGN KEY(tenant_id,entity_id,ai_bank_duplicate_payment_finding_id) REFERENCES ai_bank_duplicate_payment_finding(tenant_id,entity_id,ai_bank_duplicate_payment_finding_id),
  CHECK(
    (disposition='SUPERSEDED_BY_NEW_EVIDENCE' AND human_evidence IS NULL AND successor_finding_id IS NOT NULL AND successor_finding_hash IS NOT NULL)
    OR
    (disposition IN('DUPLICATE_CONFIRMED','VALID_DISTINCT_PAYMENTS') AND successor_finding_id IS NULL AND successor_finding_hash IS NULL
      AND jsonb_typeof(human_evidence)='object'
      AND (human_evidence-'vendor_identity'-'invoice_support'-'payment_approval'-'bank_memo'-'resolution_reason')='{}'::jsonb
      AND length(btrim(human_evidence->>'vendor_identity')) BETWEEN 2 AND 500
      AND length(btrim(human_evidence->>'invoice_support')) BETWEEN 2 AND 1000
      AND length(btrim(human_evidence->>'payment_approval')) BETWEEN 2 AND 1000
      AND length(btrim(human_evidence->>'bank_memo')) BETWEEN 2 AND 1000
      AND length(btrim(human_evidence->>'resolution_reason')) BETWEEN 8 AND 2000)
  )
);
ALTER TABLE ai_bank_duplicate_payment_lifecycle ENABLE ROW LEVEL SECURITY;
CREATE POLICY ai_bank_duplicate_payment_lifecycle_scope ON ai_bank_duplicate_payment_lifecycle
  USING(tenant_id=refs_current_tenant() AND refs_entity_allowed(entity_id))
  WITH CHECK(tenant_id=refs_current_tenant() AND refs_entity_allowed(entity_id));
CREATE TRIGGER ai_bank_duplicate_payment_lifecycle_append_only BEFORE UPDATE OR DELETE ON ai_bank_duplicate_payment_lifecycle FOR EACH ROW EXECUTE FUNCTION reject_mutation();

CREATE FUNCTION refs_supersede_ai_bank_duplicate_payment_finding() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE prior record;
BEGIN
  FOR prior IN
    SELECT f.ai_bank_duplicate_payment_finding_id,f.finding_hash
    FROM ai_bank_duplicate_payment_finding f
    WHERE f.tenant_id=NEW.tenant_id AND f.entity_id=NEW.entity_id
      AND f.ai_bank_duplicate_payment_finding_id<>NEW.ai_bank_duplicate_payment_finding_id
      AND f.accounting_period_id=NEW.accounting_period_id
      AND f.finding->>'bank_account_ref'=NEW.finding->>'bank_account_ref'
      AND f.finding->>'transaction_date'=NEW.finding->>'transaction_date'
      AND f.finding->>'currency'=NEW.finding->>'currency'
      AND f.finding->>'amount'=NEW.finding->>'amount'
  LOOP
    INSERT INTO ai_bank_duplicate_payment_lifecycle(tenant_id,entity_id,ai_bank_duplicate_payment_finding_id,finding_hash,disposition,successor_finding_id,successor_finding_hash,created_by)
    VALUES(NEW.tenant_id,NEW.entity_id,prior.ai_bank_duplicate_payment_finding_id,prior.finding_hash,'SUPERSEDED_BY_NEW_EVIDENCE',NEW.ai_bank_duplicate_payment_finding_id,NEW.finding_hash,NEW.created_by)
    ON CONFLICT(tenant_id,entity_id,ai_bank_duplicate_payment_finding_id) DO NOTHING;
  END LOOP;
  RETURN NEW;
END;
$$;
CREATE TRIGGER ai_bank_duplicate_payment_supersede_after_insert AFTER INSERT ON ai_bank_duplicate_payment_finding FOR EACH ROW EXECUTE FUNCTION refs_supersede_ai_bank_duplicate_payment_finding();

CREATE VIEW ai_bank_duplicate_payment_current_finding WITH (security_barrier=true) AS
SELECT f.* FROM ai_bank_duplicate_payment_finding f
WHERE f.status='OPEN'
  AND NOT EXISTS(SELECT 1 FROM ai_bank_duplicate_payment_lifecycle l WHERE l.tenant_id=f.tenant_id AND l.entity_id=f.entity_id AND l.ai_bank_duplicate_payment_finding_id=f.ai_bank_duplicate_payment_finding_id);

CREATE FUNCTION refs_resolve_ai_bank_duplicate_payment_hash(p_tenant uuid,p_entity uuid,p_action uuid,p_finding uuid,p_finding_hash text,p_conclusion text,p_human_evidence jsonb,p_expected_revision integer) RETURNS text
LANGUAGE sql IMMUTABLE SET search_path=pg_catalog,public,pg_temp AS $$
  SELECT refs_jsonb_hash(jsonb_build_object('schema_version','AI_BANK_DUPLICATE_PAYMENT_RESOLUTION_V1','tenant_id',p_tenant,'entity_id',p_entity,'ai_finding_action_id',p_action,'finding_id',p_finding,'finding_hash',p_finding_hash,'conclusion',p_conclusion,'human_evidence',p_human_evidence,'expected_revision',p_expected_revision))
$$;

CREATE FUNCTION refs_resolve_ai_bank_duplicate_payment(p_tenant uuid,p_entity uuid,p_action uuid,p_finding uuid,p_finding_hash text,p_conclusion text,p_human_evidence jsonb,p_expected_revision integer,p_idempotency_key text,p_request_hash text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE action_row ai_finding_action; finding_row ai_bank_duplicate_payment_finding; idem idempotency_receipt; actor text:=refs_current_actor(); lifecycle_id uuid:=gen_random_uuid(); result jsonb;
BEGIN
  PERFORM refs_assert_scope(p_tenant,p_entity,'AI.FINDING.RESOLVE');
  IF actor IS NULL OR p_request_hash IS DISTINCT FROM refs_resolve_ai_bank_duplicate_payment_hash(p_tenant,p_entity,p_action,p_finding,p_finding_hash,p_conclusion,p_human_evidence,p_expected_revision) THEN RAISE EXCEPTION 'Duplicate-payment resolution request is not canonical' USING ERRCODE='22023';END IF;
  IF p_conclusion NOT IN('DUPLICATE_CONFIRMED','VALID_DISTINCT_PAYMENTS') OR jsonb_typeof(p_human_evidence)<>'object' OR (p_human_evidence-'vendor_identity'-'invoice_support'-'payment_approval'-'bank_memo'-'resolution_reason')<>'{}'::jsonb THEN RAISE EXCEPTION 'Duplicate-payment resolution requires closed human evidence' USING ERRCODE='22023';END IF;
  INSERT INTO idempotency_receipt(tenant_id,operation_scope,idempotency_key,request_hash,status,actor_id) VALUES(p_tenant,'AI_BANK_DUPLICATE_PAYMENT_RESOLVE:'||p_entity,p_idempotency_key,p_request_hash,'IN_PROGRESS',actor) ON CONFLICT(tenant_id,operation_scope,idempotency_key) DO NOTHING;
  SELECT * INTO idem FROM idempotency_receipt WHERE tenant_id=p_tenant AND operation_scope='AI_BANK_DUPLICATE_PAYMENT_RESOLVE:'||p_entity AND idempotency_key=p_idempotency_key FOR UPDATE;
  IF idem.actor_id<>actor OR idem.request_hash<>p_request_hash THEN RAISE EXCEPTION 'Idempotency key reused by another resolver or payload' USING ERRCODE='23505';END IF;
  IF idem.status='SUCCEEDED' THEN RETURN idem.response_body||jsonb_build_object('idempotent',true);END IF;
  SELECT * INTO finding_row FROM ai_bank_duplicate_payment_current_finding WHERE tenant_id=p_tenant AND entity_id=p_entity AND ai_bank_duplicate_payment_finding_id=p_finding AND finding_hash=p_finding_hash;
  SELECT * INTO action_row FROM ai_finding_action WHERE tenant_id=p_tenant AND entity_id=p_entity AND ai_finding_action_id=p_action FOR UPDATE;
  IF finding_row.ai_bank_duplicate_payment_finding_id IS NULL OR action_row.ai_finding_action_id IS NULL OR action_row.finding_kind<>'BANK_DUPLICATE_PAYMENT' OR action_row.finding_id<>p_finding OR action_row.finding_hash<>p_finding_hash OR action_row.status<>'OPEN' OR action_row.revision<>p_expected_revision THEN RAISE EXCEPTION 'Duplicate-payment resolution requires current exact finding and open action revision' USING ERRCODE=CASE WHEN action_row.ai_finding_action_id IS NOT NULL AND action_row.revision<>p_expected_revision THEN '40001' ELSE '23514' END;END IF;
  INSERT INTO ai_bank_duplicate_payment_lifecycle(ai_bank_duplicate_payment_lifecycle_id,tenant_id,entity_id,ai_bank_duplicate_payment_finding_id,finding_hash,disposition,human_evidence,created_by) VALUES(lifecycle_id,p_tenant,p_entity,p_finding,p_finding_hash,p_conclusion,p_human_evidence,actor);
  UPDATE ai_finding_action SET status='RESOLVED',resolution_reason=btrim(p_human_evidence->>'resolution_reason'),resolved_by=actor,resolved_at=clock_timestamp(),revision=revision+1 WHERE ai_finding_action_id=p_action RETURNING * INTO action_row;
  result:=jsonb_build_object('schema_version','AI_BANK_DUPLICATE_PAYMENT_RESOLUTION_V1','ai_bank_duplicate_payment_lifecycle_id',lifecycle_id,'ai_finding_action_id',p_action,'finding_id',p_finding,'finding_hash',p_finding_hash,'conclusion',p_conclusion,'status','RESOLVED','revision',action_row.revision,'can_create_draft',false,'can_review',false,'can_approve',false,'can_post',false,'idempotent',false);
  INSERT INTO audit_event(tenant_id,entity_id,event_type,object_type,object_id,action,actor_id,actor_type,permission_used,request_id,correlation_id,idempotency_key,after_hash,reason,metadata) VALUES(p_tenant,p_entity,'AI_BANK_DUPLICATE_PAYMENT_RESOLVED','AI_BANK_DUPLICATE_PAYMENT_FINDING',p_finding,'RESOLVE',actor,'USER','AI.FINDING.RESOLVE',p_idempotency_key,p_idempotency_key,p_idempotency_key,p_request_hash,btrim(p_human_evidence->>'resolution_reason'),result);
  INSERT INTO outbox_event(tenant_id,entity_id,aggregate_type,aggregate_id,event_type,payload,payload_hash) VALUES(p_tenant,p_entity,'AI_BANK_DUPLICATE_PAYMENT_FINDING',p_finding,'AI_BANK_DUPLICATE_PAYMENT_RESOLVED',result,refs_jsonb_hash(result));
  UPDATE idempotency_receipt SET status='SUCCEEDED',response_status=201,response_body=result,completed_at=clock_timestamp() WHERE idempotency_receipt_id=idem.idempotency_receipt_id;
  RETURN result;
END;
$$;

-- Bank duplicate-payment resolutions require the structured conclusion above;
-- the generic free-text resolver must fail closed for this finding kind.
DO $$ DECLARE definition text;BEGIN
  SELECT pg_get_functiondef('refs_resolve_ai_finding_action(uuid,uuid,uuid,text,text,integer,text,text)'::regprocedure) INTO definition;
  definition:=replace(definition,'IF NOT FOUND OR action_row.finding_hash<>p_finding_hash', 'IF FOUND AND action_row.finding_kind=''BANK_DUPLICATE_PAYMENT'' THEN RAISE EXCEPTION ''Bank duplicate-payment findings require structured resolution'' USING ERRCODE=''23514''; END IF; IF NOT FOUND OR action_row.finding_hash<>p_finding_hash');
  EXECUTE definition;
END $$;

-- Every consumer must use the same current-risk projection.
DO $$ DECLARE definition text;BEGIN
  SELECT pg_get_functiondef('refs_assign_ai_finding_action(uuid,uuid,text,uuid,text,text,date,integer,text,text)'::regprocedure) INTO definition;
  definition:=replace(definition,'FROM ai_bank_duplicate_payment_finding WHERE tenant_id=p_tenant', 'FROM ai_bank_duplicate_payment_current_finding WHERE tenant_id=p_tenant');EXECUTE definition;
  SELECT pg_get_functiondef('refs_read_ai_finding_assignment_candidates(uuid,uuid,integer)'::regprocedure) INTO definition;
  definition:=replace(definition,'FROM ai_bank_duplicate_payment_finding f WHERE f.tenant_id=p_tenant', 'FROM ai_bank_duplicate_payment_current_finding f WHERE f.tenant_id=p_tenant');EXECUTE definition;
  SELECT pg_get_functiondef('refs_read_ai_accounting_analysis_summary(uuid,uuid)'::regprocedure) INTO definition;
  definition:=replace(definition,'FROM ai_bank_duplicate_payment_finding WHERE tenant_id=p_tenant', 'FROM ai_bank_duplicate_payment_current_finding WHERE tenant_id=p_tenant');EXECUTE definition;
END $$;

CREATE OR REPLACE FUNCTION refs_read_ai_bank_duplicate_payment_findings(p_tenant uuid,p_entity uuid,p_limit integer DEFAULT 20)
RETURNS TABLE(ai_bank_duplicate_payment_finding_id uuid,rule_id text,risk_level text,confidence numeric,reason text,suggested_action text,source_document_id uuid,candidate_source_document_id uuid,external_bank_line_id text,source_payload_hash text,candidate_payload_hash text,match_key_hash text,created_at timestamptz,can_create_draft boolean,can_review boolean,can_approve boolean,can_post boolean)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$ BEGIN
  PERFORM refs_assert_ai_analysis_scope(p_tenant,p_entity);IF p_limit IS NULL OR p_limit<1 OR p_limit>100 THEN RAISE EXCEPTION 'AI bank duplicate-payment finding limit must be between 1 and 100' USING ERRCODE='22023';END IF;
  RETURN QUERY SELECT f.ai_bank_duplicate_payment_finding_id,f.finding->>'rule_id',f.finding->>'risk_level',(f.finding->>'confidence')::numeric,f.finding->>'reason',f.finding->>'suggested_action',s1.source_document_id,s2.source_document_id,s1.external_bank_line_id,s1.source_payload_hash,s2.source_payload_hash,f.finding_hash,f.created_at,false,false,false,false FROM ai_bank_duplicate_payment_current_finding f JOIN ai_bank_duplicate_payment_source s1 ON s1.tenant_id=f.tenant_id AND s1.entity_id=f.entity_id AND s1.ai_bank_duplicate_payment_finding_id=f.ai_bank_duplicate_payment_finding_id AND s1.source_ordinal=1 JOIN ai_bank_duplicate_payment_source s2 ON s2.tenant_id=f.tenant_id AND s2.entity_id=f.entity_id AND s2.ai_bank_duplicate_payment_finding_id=f.ai_bank_duplicate_payment_finding_id AND s2.source_ordinal=2 WHERE f.tenant_id=p_tenant AND f.entity_id=p_entity ORDER BY f.created_at DESC,f.ai_bank_duplicate_payment_finding_id DESC LIMIT p_limit;
END $$;

REVOKE ALL ON ai_bank_duplicate_payment_lifecycle,ai_bank_duplicate_payment_current_finding FROM PUBLIC,refs_app;
REVOKE ALL ON FUNCTION refs_supersede_ai_bank_duplicate_payment_finding(),refs_resolve_ai_bank_duplicate_payment_hash(uuid,uuid,uuid,uuid,text,text,jsonb,integer),refs_resolve_ai_bank_duplicate_payment(uuid,uuid,uuid,uuid,text,text,jsonb,integer,text,text) FROM PUBLIC;
GRANT SELECT ON ai_bank_duplicate_payment_current_finding TO refs_app;
GRANT EXECUTE ON FUNCTION refs_resolve_ai_bank_duplicate_payment_hash(uuid,uuid,uuid,uuid,text,text,jsonb,integer),refs_resolve_ai_bank_duplicate_payment(uuid,uuid,uuid,uuid,text,text,jsonb,integer,text,text) TO refs_app;
COMMIT;
