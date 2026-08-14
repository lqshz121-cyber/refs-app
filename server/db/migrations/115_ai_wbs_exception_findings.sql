BEGIN;

-- A persisted AI finding is evidence, not an accounting instruction.  The
-- source row remains immutable and this trigger deliberately contains no path
-- to staging, a journal, approval, or posting.
CREATE TABLE ai_finding (
  ai_finding_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant(tenant_id),
  entity_id uuid NOT NULL,
  finding_key text NOT NULL CHECK(length(btrim(finding_key)) BETWEEN 8 AND 240),
  source_evidence_row_id uuid NOT NULL,
  source_record_id text NOT NULL CHECK(length(btrim(source_record_id)) BETWEEN 1 AND 128),
  source_version text NOT NULL CHECK(length(btrim(source_version)) BETWEEN 1 AND 128),
  source_row_hash text NOT NULL CHECK(source_row_hash~'^sha256:[0-9a-f]{64}$'),
  provider_content_hash text NOT NULL CHECK(provider_content_hash~'^sha256:[0-9a-f]{64}$'),
  observation_hash text NOT NULL CHECK(observation_hash~'^sha256:[0-9a-f]{64}$'),
  finding_hash text NOT NULL CHECK(finding_hash~'^sha256:[0-9a-f]{64}$'),
  rule_id text NOT NULL CHECK(rule_id IN ('WBS_UNSIGNED_SOURCE','WBS_ENTITY_SCOPE_EXCEPTION')),
  risk_level text NOT NULL CHECK(risk_level IN ('HIGH','MEDIUM','LOW')),
  confidence numeric(5,4) NOT NULL CHECK(confidence>=0 AND confidence<=1),
  status text NOT NULL DEFAULT 'OPEN' CHECK(status='OPEN'),
  reason text NOT NULL CHECK(length(btrim(reason)) BETWEEN 8 AND 2000),
  suggested_action text NOT NULL CHECK(length(btrim(suggested_action)) BETWEEN 8 AND 2000),
  suggested_owner text NOT NULL CHECK(length(btrim(suggested_owner)) BETWEEN 2 AND 128),
  due_date date,
  due_date_status text NOT NULL CHECK(due_date_status='HUMAN_ASSIGNMENT_REQUIRED'),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE(tenant_id,entity_id,ai_finding_id),
  UNIQUE(tenant_id,entity_id,finding_hash),
  UNIQUE(tenant_id,entity_id,source_evidence_row_id),
  FOREIGN KEY(tenant_id,entity_id) REFERENCES entity(tenant_id,entity_id),
  FOREIGN KEY(tenant_id,entity_id,source_evidence_row_id)
    REFERENCES wbs_operator_payable_evidence_row(tenant_id,entity_id,wbs_operator_payable_evidence_row_id)
);

ALTER TABLE ai_finding ENABLE ROW LEVEL SECURITY;
CREATE POLICY ai_finding_scope ON ai_finding
  USING(tenant_id=refs_current_tenant() AND refs_entity_allowed(entity_id))
  WITH CHECK(tenant_id=refs_current_tenant() AND refs_entity_allowed(entity_id));
CREATE TRIGGER ai_finding_append_only BEFORE UPDATE OR DELETE ON ai_finding
  FOR EACH ROW EXECUTE FUNCTION reject_mutation();

CREATE FUNCTION refs_materialize_ai_wbs_exception_finding(p_evidence_row_id uuid) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE source_row wbs_operator_payable_evidence_row; attestation wbs_operator_payable_attestation;
DECLARE finding_id uuid:=gen_random_uuid(); finding_hash text;
DECLARE rule text; risk text; explanation text; next_action text; payload jsonb; actor text:=COALESCE(refs_current_actor(),'SYSTEM');
BEGIN
  SELECT * INTO source_row FROM wbs_operator_payable_evidence_row WHERE wbs_operator_payable_evidence_row_id=p_evidence_row_id FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'AI finding source evidence row is absent' USING ERRCODE='23503'; END IF;
  SELECT * INTO attestation FROM wbs_operator_payable_attestation
    WHERE tenant_id=source_row.tenant_id AND entity_id=source_row.entity_id
      AND wbs_operator_payable_attestation_id=source_row.wbs_operator_payable_attestation_id FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'AI finding source attestation is absent' USING ERRCODE='23503'; END IF;

  rule:=CASE WHEN attestation.company_scope_status='ENTITY_SCOPE_MATCHED' THEN 'WBS_UNSIGNED_SOURCE' ELSE 'WBS_ENTITY_SCOPE_EXCEPTION' END;
  risk:=CASE WHEN attestation.company_scope_status='ENTITY_SCOPE_MATCHED' THEN 'MEDIUM' ELSE 'HIGH' END;
  explanation:=CASE WHEN rule='WBS_UNSIGNED_SOURCE'
    THEN 'This payable is retained as unsigned WBS exception evidence and cannot enter accounting until a provider-signed source is admitted.'
    ELSE 'This payable has unsigned WBS exception evidence and a company scope that does not match the configured accounting entity.' END;
  next_action:=CASE WHEN rule='WBS_UNSIGNED_SOURCE'
    THEN 'Obtain a provider-signed source, then assign a human reviewer before any Draft JE request.'
    ELSE 'Resolve the company-to-entity scope discrepancy and obtain a provider-signed source before review.' END;
  finding_hash:=refs_jsonb_hash(jsonb_build_object(
    'schema_version','AI_WBS_EXCEPTION_FINDING_V1','source_evidence_row_id',source_row.wbs_operator_payable_evidence_row_id,
    'source_record_id',source_row.source_record_id,'source_version',source_row.source_version,'source_row_hash',source_row.row_hash,
    'provider_content_hash',attestation.provider_content_hash,'observation_hash',attestation.observation_hash,'rule_id',rule
  ));
  INSERT INTO ai_finding(ai_finding_id,tenant_id,entity_id,finding_key,source_evidence_row_id,source_record_id,source_version,
    source_row_hash,provider_content_hash,observation_hash,finding_hash,rule_id,risk_level,confidence,reason,suggested_action,
    suggested_owner,due_date,due_date_status)
  VALUES(finding_id,source_row.tenant_id,source_row.entity_id,'WBS_EXCEPTION:'||source_row.wbs_operator_payable_evidence_row_id,
    source_row.wbs_operator_payable_evidence_row_id,source_row.source_record_id,source_row.source_version,source_row.row_hash,attestation.provider_content_hash,
    attestation.observation_hash,finding_hash,rule,risk,CASE WHEN risk='HIGH' THEN 0.9900 ELSE 0.9800 END,explanation,next_action,
    'CONTROLLER',NULL,'HUMAN_ASSIGNMENT_REQUIRED');
  payload:=jsonb_build_object('schema_version','AI_WBS_EXCEPTION_FINDING_V1','analysis_mode','DETERMINISTIC_READ_ONLY',
    'ai_finding_id',finding_id,'finding_key','WBS_EXCEPTION:'||source_row.wbs_operator_payable_evidence_row_id,'rule_id',rule,
    'risk_level',risk,'confidence',CASE WHEN risk='HIGH' THEN 0.9900 ELSE 0.9800 END,'source_evidence_row_id',source_row.wbs_operator_payable_evidence_row_id,
    'source_record_id',source_row.source_record_id,'source_version',source_row.source_version,'source_row_hash',source_row.row_hash,
    'provider_content_hash',attestation.provider_content_hash,'observation_hash',attestation.observation_hash,
    'can_create_draft',false,'can_review',false,'can_approve',false,'can_post',false);
  INSERT INTO audit_event(tenant_id,entity_id,event_type,object_type,object_id,action,actor_id,actor_type,permission_used,
    request_id,correlation_id,after_hash,metadata)
  VALUES(source_row.tenant_id,source_row.entity_id,'AI_FINDING_MATERIALIZED','AI_FINDING',finding_id,'MATERIALIZE',actor,'SYSTEM',NULL,
    'AI_WBS_EXCEPTION:'||source_row.wbs_operator_payable_evidence_row_id,'AI_WBS_EXCEPTION:'||source_row.wbs_operator_payable_evidence_row_id,
    finding_hash,payload);
  INSERT INTO outbox_event(tenant_id,entity_id,aggregate_type,aggregate_id,event_type,payload,payload_hash)
  VALUES(source_row.tenant_id,source_row.entity_id,'AI_FINDING',finding_id,'AI_FINDING_MATERIALIZED',payload,refs_jsonb_hash(payload));
  RETURN finding_id;
END;
$$;

CREATE FUNCTION refs_materialize_ai_wbs_exception_finding_trigger() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
BEGIN
  PERFORM refs_materialize_ai_wbs_exception_finding(NEW.wbs_operator_payable_evidence_row_id);
  RETURN NEW;
END;
$$;

CREATE TRIGGER materialize_ai_wbs_exception_finding
  AFTER INSERT ON wbs_operator_payable_evidence_row
  FOR EACH ROW EXECUTE FUNCTION refs_materialize_ai_wbs_exception_finding_trigger();

-- Existing immutable exception rows predate this migration.  Backfill them in
-- the same migration transaction so the authoritative AI queue is not blank
-- until a future provider observation arrives.
DO $$
DECLARE evidence_id uuid;
BEGIN
  FOR evidence_id IN SELECT wbs_operator_payable_evidence_row_id FROM wbs_operator_payable_evidence_row ORDER BY created_at,wbs_operator_payable_evidence_row_id LOOP
    PERFORM refs_materialize_ai_wbs_exception_finding(evidence_id);
  END LOOP;
END $$;

CREATE FUNCTION refs_read_ai_wbs_exception_findings(p_tenant uuid,p_entity uuid,p_limit integer DEFAULT 50)
RETURNS TABLE(ai_finding_id uuid,finding_key text,source_evidence_row_id uuid,source_record_id text,source_version text,
  source_row_hash text,provider_content_hash text,observation_hash text,rule_id text,risk_level text,confidence numeric,status text,
  reason text,suggested_action text,suggested_owner text,due_date date,due_date_status text,created_at timestamptz,
  can_create_draft boolean,can_review boolean,can_approve boolean,can_post boolean)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
BEGIN
  PERFORM refs_assert_scope(p_tenant,p_entity,'WBS.PAYABLE.OPERATOR_ATTEST');
  IF p_limit IS NULL OR p_limit<1 OR p_limit>100 THEN RAISE EXCEPTION 'AI finding limit must be between 1 and 100' USING ERRCODE='22023'; END IF;
  RETURN QUERY SELECT f.ai_finding_id,f.finding_key,f.source_evidence_row_id,f.source_record_id,f.source_version,
    f.source_row_hash,f.provider_content_hash,f.observation_hash,f.rule_id,f.risk_level,f.confidence,f.status,f.reason,
    f.suggested_action,f.suggested_owner,f.due_date,f.due_date_status,f.created_at,false,false,false,false
  FROM ai_finding f WHERE f.tenant_id=p_tenant AND f.entity_id=p_entity ORDER BY f.created_at DESC,f.ai_finding_id DESC LIMIT p_limit;
END;
$$;

REVOKE ALL ON ai_finding FROM PUBLIC,refs_app;
REVOKE ALL ON FUNCTION refs_materialize_ai_wbs_exception_finding(uuid) FROM PUBLIC,refs_app;
REVOKE ALL ON FUNCTION refs_materialize_ai_wbs_exception_finding_trigger() FROM PUBLIC,refs_app;
REVOKE ALL ON FUNCTION refs_read_ai_wbs_exception_findings(uuid,uuid,integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION refs_read_ai_wbs_exception_findings(uuid,uuid,integer) TO refs_app;

COMMIT;
