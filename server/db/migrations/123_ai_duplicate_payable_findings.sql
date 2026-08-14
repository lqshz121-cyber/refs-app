BEGIN;

-- Exact duplicate-payable evidence only.  This never changes a source status,
-- creates a Draft, or posts.  A finding exists only when the supplier identity
-- is singular and the invoice number, amount, currency, entity, and type match.
CREATE TABLE ai_duplicate_payable_finding (
  ai_duplicate_payable_finding_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant(tenant_id),
  entity_id uuid NOT NULL,
  source_document_id uuid NOT NULL,
  candidate_source_document_id uuid NOT NULL,
  source_payload_hash text NOT NULL CHECK(source_payload_hash~'^sha256:[0-9a-f]{64}$'),
  source_document_version bigint NOT NULL CHECK(source_document_version>=0),
  candidate_payload_hash text NOT NULL CHECK(candidate_payload_hash~'^sha256:[0-9a-f]{64}$'),
  candidate_document_version bigint NOT NULL CHECK(candidate_document_version>=0),
  match_key_hash text NOT NULL CHECK(match_key_hash~'^sha256:[0-9a-f]{64}$'),
  finding_hash text NOT NULL CHECK(finding_hash~'^sha256:[0-9a-f]{64}$'),
  rule_id text NOT NULL CHECK(rule_id='DUPLICATE_PAYABLE_EXACT'),
  risk_level text NOT NULL CHECK(risk_level='HIGH'),
  confidence numeric(5,4) NOT NULL CHECK(confidence=1.0000),
  status text NOT NULL DEFAULT 'OPEN' CHECK(status='OPEN'),
  reason text NOT NULL CHECK(length(btrim(reason)) BETWEEN 8 AND 2000),
  suggested_action text NOT NULL CHECK(length(btrim(suggested_action)) BETWEEN 8 AND 2000),
  suggested_owner text NOT NULL CHECK(suggested_owner='CONTROLLER'),
  due_date date,
  due_date_status text NOT NULL CHECK(due_date_status='HUMAN_ASSIGNMENT_REQUIRED'),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CHECK(source_document_id<>candidate_source_document_id),
  CHECK(source_document_id::text<candidate_source_document_id::text),
  UNIQUE(tenant_id,entity_id,ai_duplicate_payable_finding_id),
  UNIQUE(tenant_id,entity_id,source_document_id,candidate_source_document_id,rule_id),
  UNIQUE(tenant_id,entity_id,finding_hash),
  FOREIGN KEY(tenant_id,entity_id) REFERENCES entity(tenant_id,entity_id),
  FOREIGN KEY(tenant_id,entity_id,source_document_id) REFERENCES source_document(tenant_id,entity_id,source_document_id),
  FOREIGN KEY(tenant_id,entity_id,candidate_source_document_id) REFERENCES source_document(tenant_id,entity_id,source_document_id)
);
ALTER TABLE ai_duplicate_payable_finding ENABLE ROW LEVEL SECURITY;
CREATE POLICY ai_duplicate_payable_finding_scope ON ai_duplicate_payable_finding
  USING(tenant_id=refs_current_tenant() AND refs_entity_allowed(entity_id))
  WITH CHECK(tenant_id=refs_current_tenant() AND refs_entity_allowed(entity_id));
CREATE TRIGGER ai_duplicate_payable_finding_append_only BEFORE UPDATE OR DELETE ON ai_duplicate_payable_finding
  FOR EACH ROW EXECUTE FUNCTION reject_mutation();

CREATE FUNCTION refs_ai_payable_counterparty(p_tenant uuid,p_entity uuid,p_source uuid) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE refs text[];
BEGIN
  SELECT array_agg(DISTINCT ref ORDER BY ref) INTO refs FROM (
    SELECT NULLIF(btrim(l.party_ref),'') AS ref FROM source_document_line l
      WHERE l.tenant_id=p_tenant AND l.entity_id=p_entity AND l.source_document_id=p_source
    UNION
    SELECT NULLIF(btrim(e.matched_facts->>'vendor_ref'),'') AS ref FROM rule_evaluation e
      WHERE e.tenant_id=p_tenant AND e.source_document_id=p_source
  ) values WHERE ref IS NOT NULL;
  IF cardinality(refs)<>1 THEN RETURN NULL; END IF;
  RETURN refs[1];
END;
$$;

CREATE FUNCTION refs_materialize_ai_duplicate_payable_findings(p_source uuid) RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE source_row source_document; candidate_row source_document; source_party text; candidate_party text; left_id uuid; right_id uuid;
DECLARE left_hash text; right_hash text; left_version bigint; right_version bigint; match_hash text; finding_hash text; payload jsonb; actor text:=COALESCE(refs_current_actor(),'SYSTEM'); created_count integer:=0; finding_id uuid;
BEGIN
  SELECT * INTO source_row FROM source_document WHERE source_document_id=p_source FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'AI duplicate finding source document is absent' USING ERRCODE='23503'; END IF;
  IF source_row.status NOT IN ('READY_FOR_DRAFT','DRAFT_CREATED','PENDING_JE_REVIEW','PENDING_JE_APPROVAL','APPROVED','POSTED')
     OR source_row.source_module<>'payable' OR NULLIF(btrim(source_row.document_no),'') IS NULL OR source_row.gross_amount<=0 THEN RETURN 0; END IF;
  source_party:=refs_ai_payable_counterparty(source_row.tenant_id,source_row.entity_id,source_row.source_document_id);
  IF source_party IS NULL THEN RETURN 0; END IF;
  FOR candidate_row IN
    SELECT d.* FROM source_document d WHERE d.tenant_id=source_row.tenant_id AND d.entity_id=source_row.entity_id
      AND d.source_document_id<>source_row.source_document_id AND d.status IN ('READY_FOR_DRAFT','DRAFT_CREATED','PENDING_JE_REVIEW','PENDING_JE_APPROVAL','APPROVED','POSTED')
      AND d.source_module='payable' AND d.document_type=source_row.document_type
      AND lower(btrim(d.document_no))=lower(btrim(source_row.document_no)) AND d.currency=source_row.currency AND d.gross_amount=source_row.gross_amount
    FOR SHARE
  LOOP
    candidate_party:=refs_ai_payable_counterparty(candidate_row.tenant_id,candidate_row.entity_id,candidate_row.source_document_id);
    IF candidate_party IS DISTINCT FROM source_party THEN CONTINUE; END IF;
    IF source_row.source_document_id::text<candidate_row.source_document_id::text THEN
      left_id:=source_row.source_document_id;left_hash:=source_row.payload_hash;left_version:=source_row.version;right_id:=candidate_row.source_document_id;right_hash:=candidate_row.payload_hash;right_version:=candidate_row.version;
    ELSE
      left_id:=candidate_row.source_document_id;left_hash:=candidate_row.payload_hash;left_version:=candidate_row.version;right_id:=source_row.source_document_id;right_hash:=source_row.payload_hash;right_version:=source_row.version;
    END IF;
    match_hash:=refs_jsonb_hash(jsonb_build_object('schema_version','AI_DUPLICATE_PAYABLE_V1','tenant_id',source_row.tenant_id,'entity_id',source_row.entity_id,'document_type',source_row.document_type,'document_no',lower(btrim(source_row.document_no)),'counterparty_ref',source_party,'currency',source_row.currency,'gross_amount',source_row.gross_amount));
    finding_hash:=refs_jsonb_hash(jsonb_build_object('schema_version','AI_DUPLICATE_PAYABLE_V1','left_source_document_id',left_id,'left_payload_hash',left_hash,'left_version',left_version,'right_source_document_id',right_id,'right_payload_hash',right_hash,'right_version',right_version,'match_key_hash',match_hash,'rule_id','DUPLICATE_PAYABLE_EXACT'));
    INSERT INTO ai_duplicate_payable_finding(ai_duplicate_payable_finding_id,tenant_id,entity_id,source_document_id,candidate_source_document_id,source_payload_hash,source_document_version,candidate_payload_hash,candidate_document_version,match_key_hash,finding_hash,rule_id,risk_level,confidence,reason,suggested_action,suggested_owner,due_date,due_date_status)
    VALUES(gen_random_uuid(),source_row.tenant_id,source_row.entity_id,left_id,right_id,left_hash,left_version,right_hash,right_version,match_hash,finding_hash,'DUPLICATE_PAYABLE_EXACT','HIGH',1.0000,'Two payable sources have the same supplier, normalized invoice number, document type, currency, and gross amount. The match is retained as evidence only; neither source was changed.','Compare the two source records and their attachments. Retain a controller decision before any Draft or payment activity.','CONTROLLER',NULL,'HUMAN_ASSIGNMENT_REQUIRED')
    ON CONFLICT(tenant_id,entity_id,source_document_id,candidate_source_document_id,rule_id) DO NOTHING
    RETURNING ai_duplicate_payable_finding_id INTO finding_id;
    IF finding_id IS NULL THEN CONTINUE; END IF;
    payload:=jsonb_build_object('schema_version','AI_DUPLICATE_PAYABLE_V1','ai_duplicate_payable_finding_id',finding_id,'source_document_id',left_id,'candidate_source_document_id',right_id,'source_payload_hash',left_hash,'source_document_version',left_version,'candidate_payload_hash',right_hash,'candidate_document_version',right_version,'match_key_hash',match_hash,'rule_id','DUPLICATE_PAYABLE_EXACT','risk_level','HIGH','confidence',1.0000,'can_create_draft',false,'can_review',false,'can_approve',false,'can_post',false);
    INSERT INTO audit_event(tenant_id,entity_id,event_type,object_type,object_id,action,actor_id,actor_type,request_id,correlation_id,after_hash,reason,metadata)
      VALUES(source_row.tenant_id,source_row.entity_id,'AI_DUPLICATE_PAYABLE_FINDING_MATERIALIZED','AI_DUPLICATE_PAYABLE_FINDING',finding_id,'MATERIALIZE',actor,'SYSTEM','AI_DUPLICATE_PAYABLE:'||finding_id,'AI_DUPLICATE_PAYABLE:'||finding_id,finding_hash,'Deterministic exact duplicate payable source finding',payload);
    INSERT INTO outbox_event(tenant_id,entity_id,aggregate_type,aggregate_id,event_type,payload,payload_hash)
      VALUES(source_row.tenant_id,source_row.entity_id,'AI_DUPLICATE_PAYABLE_FINDING',finding_id,'AI_DUPLICATE_PAYABLE_FINDING_MATERIALIZED',payload,refs_jsonb_hash(payload));
    created_count:=created_count+1;
  END LOOP;
  RETURN created_count;
END;
$$;

CREATE FUNCTION refs_materialize_ai_duplicate_payable_findings_from_document_trigger() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$ BEGIN PERFORM refs_materialize_ai_duplicate_payable_findings(NEW.source_document_id); RETURN NEW; END; $$;
CREATE FUNCTION refs_materialize_ai_duplicate_payable_findings_from_line_trigger() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$ BEGIN PERFORM refs_materialize_ai_duplicate_payable_findings(NEW.source_document_id); RETURN NEW; END; $$;
CREATE FUNCTION refs_materialize_ai_duplicate_payable_findings_from_rule_trigger() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$ BEGIN PERFORM refs_materialize_ai_duplicate_payable_findings(NEW.source_document_id); RETURN NEW; END; $$;
CREATE TRIGGER materialize_ai_duplicate_payable_findings_from_document AFTER INSERT OR UPDATE OF status,document_no,gross_amount,currency,document_type ON source_document FOR EACH ROW EXECUTE FUNCTION refs_materialize_ai_duplicate_payable_findings_from_document_trigger();
CREATE TRIGGER materialize_ai_duplicate_payable_findings_from_line AFTER INSERT OR UPDATE OF party_ref ON source_document_line FOR EACH ROW EXECUTE FUNCTION refs_materialize_ai_duplicate_payable_findings_from_line_trigger();
CREATE TRIGGER materialize_ai_duplicate_payable_findings_from_rule AFTER INSERT OR UPDATE OF matched_facts ON rule_evaluation FOR EACH ROW EXECUTE FUNCTION refs_materialize_ai_duplicate_payable_findings_from_rule_trigger();

CREATE FUNCTION refs_read_ai_duplicate_payable_findings(p_tenant uuid,p_entity uuid,p_limit integer DEFAULT 50)
RETURNS TABLE(ai_duplicate_payable_finding_id uuid,source_document_id uuid,candidate_source_document_id uuid,source_payload_hash text,source_document_version bigint,candidate_payload_hash text,candidate_document_version bigint,match_key_hash text,rule_id text,risk_level text,confidence numeric,status text,reason text,suggested_action text,suggested_owner text,due_date date,due_date_status text,created_at timestamptz,can_create_draft boolean,can_review boolean,can_approve boolean,can_post boolean)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$ BEGIN
  PERFORM refs_assert_scope(p_tenant,p_entity,'AI.AMORTIZATION.PROPOSE');
  IF p_limit IS NULL OR p_limit<1 OR p_limit>100 THEN RAISE EXCEPTION 'AI duplicate payable finding limit must be between 1 and 100' USING ERRCODE='22023'; END IF;
  RETURN QUERY SELECT f.ai_duplicate_payable_finding_id,f.source_document_id,f.candidate_source_document_id,f.source_payload_hash,f.source_document_version,f.candidate_payload_hash,f.candidate_document_version,f.match_key_hash,f.rule_id,f.risk_level,f.confidence,f.status,f.reason,f.suggested_action,f.suggested_owner,f.due_date,f.due_date_status,f.created_at,false,false,false,false FROM ai_duplicate_payable_finding f WHERE f.tenant_id=p_tenant AND f.entity_id=p_entity ORDER BY f.created_at DESC,f.ai_duplicate_payable_finding_id DESC LIMIT p_limit;
END; $$;

REVOKE ALL ON ai_duplicate_payable_finding FROM PUBLIC,refs_app;
REVOKE ALL ON FUNCTION refs_ai_payable_counterparty(uuid,uuid,uuid) FROM PUBLIC,refs_app;
REVOKE ALL ON FUNCTION refs_materialize_ai_duplicate_payable_findings(uuid) FROM PUBLIC,refs_app;
REVOKE ALL ON FUNCTION refs_read_ai_duplicate_payable_findings(uuid,uuid,integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION refs_read_ai_duplicate_payable_findings(uuid,uuid,integer) TO refs_app;

COMMIT;
