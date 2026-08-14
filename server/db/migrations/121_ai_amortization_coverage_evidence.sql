BEGIN;

-- Coverage dates are accounting evidence, not browser form values.  A later
-- worker may consume only this immutable record to prepare an amortization
-- proposal; it remains incapable of creating a Draft JE or posting.
CREATE TABLE ai_amortization_coverage_evidence (
  ai_amortization_coverage_evidence_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant(tenant_id),
  entity_id uuid NOT NULL,
  source_document_id uuid NOT NULL,
  source_payload_hash text NOT NULL CHECK(source_payload_hash ~ '^sha256:[0-9a-f]{64}$'),
  source_document_version bigint NOT NULL CHECK(source_document_version >= 0),
  coverage_start date NOT NULL CHECK(coverage_start=date_trunc('month',coverage_start)::date),
  coverage_end date NOT NULL CHECK(coverage_end=(date_trunc('month',coverage_end)+interval '1 month - 1 day')::date AND coverage_end>=coverage_start),
  evidence_ref text NOT NULL CHECK(length(btrim(evidence_ref)) BETWEEN 1 AND 512),
  evidence_hash text NOT NULL CHECK(evidence_hash ~ '^sha256:[0-9a-f]{64}$'),
  extraction_method text NOT NULL CHECK(extraction_method IN ('SIGNED_SOURCE_FIELD','SIGNED_ATTACHMENT_FIELD','HUMAN_VERIFIED_SOURCE_FIELD')),
  coverage_hash text NOT NULL CHECK(coverage_hash ~ '^sha256:[0-9a-f]{64}$'),
  created_by text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE(tenant_id,entity_id,ai_amortization_coverage_evidence_id),
  UNIQUE(tenant_id,entity_id,source_document_id,source_document_version),
  UNIQUE(tenant_id,entity_id,coverage_hash),
  FOREIGN KEY(tenant_id,entity_id) REFERENCES entity(tenant_id,entity_id),
  FOREIGN KEY(tenant_id,entity_id,source_document_id) REFERENCES source_document(tenant_id,entity_id,source_document_id)
);

ALTER TABLE ai_amortization_coverage_evidence ENABLE ROW LEVEL SECURITY;
CREATE POLICY ai_amortization_coverage_evidence_scope ON ai_amortization_coverage_evidence
  USING(tenant_id=refs_current_tenant() AND refs_entity_allowed(entity_id))
  WITH CHECK(tenant_id=refs_current_tenant() AND refs_entity_allowed(entity_id));
CREATE TRIGGER ai_amortization_coverage_evidence_append_only BEFORE UPDATE OR DELETE ON ai_amortization_coverage_evidence
  FOR EACH ROW EXECUTE FUNCTION reject_mutation();

CREATE FUNCTION refs_ai_amortization_coverage_evidence_hash(
  p_tenant uuid,p_entity uuid,p_source uuid,p_source_payload_hash text,p_coverage_start date,p_coverage_end date,
  p_evidence_ref text,p_evidence_hash text,p_extraction_method text
) RETURNS text LANGUAGE sql IMMUTABLE SET search_path=pg_catalog,public,pg_temp AS $$
  SELECT refs_jsonb_hash(jsonb_build_object(
    'schema_version','AI_AMORTIZATION_COVERAGE_EVIDENCE_V1','tenant_id',p_tenant,'entity_id',p_entity,
    'source_document_id',p_source,'source_payload_hash',p_source_payload_hash,'coverage_start',p_coverage_start,
    'coverage_end',p_coverage_end,'evidence_ref',btrim(p_evidence_ref),'evidence_hash',p_evidence_hash,
    'extraction_method',p_extraction_method
  ))
$$;

CREATE FUNCTION refs_record_ai_amortization_coverage_evidence(
  p_tenant uuid,p_entity uuid,p_source uuid,p_source_payload_hash text,p_coverage_start date,p_coverage_end date,
  p_evidence_ref text,p_evidence_hash text,p_extraction_method text,p_idempotency_key text,p_request_hash text
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE actor text:=refs_current_actor(); idem idempotency_receipt; source source_document;
DECLARE evidence_id uuid:=gen_random_uuid(); coverage_hash text; result jsonb; event_payload jsonb;
BEGIN
  PERFORM refs_assert_scope(p_tenant,p_entity,'AI.AMORTIZATION.PROPOSE');
  IF actor IS NULL THEN RAISE EXCEPTION 'Authenticated amortization evidence recorder missing' USING ERRCODE='42501'; END IF;
  IF p_request_hash IS DISTINCT FROM refs_ai_amortization_coverage_evidence_hash(p_tenant,p_entity,p_source,p_source_payload_hash,p_coverage_start,p_coverage_end,p_evidence_ref,p_evidence_hash,p_extraction_method) THEN
    RAISE EXCEPTION 'AI amortization coverage evidence request hash is not canonical' USING ERRCODE='22023';
  END IF;
  IF COALESCE(p_source_payload_hash,'') !~ '^sha256:[0-9a-f]{64}$' OR COALESCE(p_evidence_hash,'') !~ '^sha256:[0-9a-f]{64}$'
     OR p_coverage_start IS NULL OR p_coverage_end IS NULL
     OR p_coverage_start<>date_trunc('month',p_coverage_start)::date
     OR p_coverage_end<>(date_trunc('month',p_coverage_end)+interval '1 month - 1 day')::date
     OR p_coverage_end<p_coverage_start OR COALESCE(length(btrim(p_evidence_ref)),0) NOT BETWEEN 1 AND 512
     OR COALESCE(p_extraction_method,'') NOT IN ('SIGNED_SOURCE_FIELD','SIGNED_ATTACHMENT_FIELD','HUMAN_VERIFIED_SOURCE_FIELD') THEN
    RAISE EXCEPTION 'AI amortization coverage evidence requires exact source and evidence hashes plus whole-month coverage' USING ERRCODE='22023';
  END IF;
  INSERT INTO idempotency_receipt(tenant_id,operation_scope,idempotency_key,request_hash,status,actor_id)
    VALUES(p_tenant,'AI_AMORTIZATION_COVERAGE_EVIDENCE:'||p_entity,p_idempotency_key,p_request_hash,'IN_PROGRESS',actor)
    ON CONFLICT(tenant_id,operation_scope,idempotency_key) DO NOTHING;
  SELECT * INTO idem FROM idempotency_receipt WHERE tenant_id=p_tenant AND operation_scope='AI_AMORTIZATION_COVERAGE_EVIDENCE:'||p_entity AND idempotency_key=p_idempotency_key FOR UPDATE;
  IF idem.request_hash<>p_request_hash THEN RAISE EXCEPTION 'Idempotency key reused with different AI amortization coverage evidence' USING ERRCODE='23505'; END IF;
  IF idem.status='SUCCEEDED' THEN RETURN idem.response_body||jsonb_build_object('idempotent',true); END IF;
  SELECT * INTO source FROM source_document WHERE tenant_id=p_tenant AND entity_id=p_entity AND source_document_id=p_source FOR SHARE;
  IF NOT FOUND OR source.payload_hash<>p_source_payload_hash OR source.status<>'READY_FOR_DRAFT' OR source.gross_amount<=0 THEN
    RAISE EXCEPTION 'AI amortization coverage evidence source is missing, changed, not review-ready, or has no positive amount' USING ERRCODE='23514';
  END IF;
  coverage_hash:=p_request_hash;
  IF EXISTS(SELECT 1 FROM ai_amortization_coverage_evidence WHERE tenant_id=p_tenant AND entity_id=p_entity AND source_document_id=p_source AND source_document_version=source.version) THEN
    RAISE EXCEPTION 'Source document version already has immutable amortization coverage evidence' USING ERRCODE='23505';
  END IF;
  INSERT INTO ai_amortization_coverage_evidence(ai_amortization_coverage_evidence_id,tenant_id,entity_id,source_document_id,source_payload_hash,source_document_version,coverage_start,coverage_end,evidence_ref,evidence_hash,extraction_method,coverage_hash,created_by)
    VALUES(evidence_id,p_tenant,p_entity,p_source,source.payload_hash,source.version,p_coverage_start,p_coverage_end,btrim(p_evidence_ref),p_evidence_hash,p_extraction_method,coverage_hash,actor);
  event_payload:=jsonb_build_object('schema_version','AI_AMORTIZATION_COVERAGE_EVIDENCE_V1','ai_amortization_coverage_evidence_id',evidence_id,'source_document_id',p_source,'source_payload_hash',source.payload_hash,'source_document_version',source.version,'coverage_start',p_coverage_start,'coverage_end',p_coverage_end,'evidence_hash',p_evidence_hash,'extraction_method',p_extraction_method,'can_create_draft',false,'can_review',false,'can_approve',false,'can_post',false);
  INSERT INTO audit_event(tenant_id,entity_id,event_type,object_type,object_id,action,actor_id,actor_type,permission_used,request_id,correlation_id,idempotency_key,after_hash,reason,metadata)
    VALUES(p_tenant,p_entity,'AI_AMORTIZATION_COVERAGE_EVIDENCE_RECORDED','AI_AMORTIZATION_COVERAGE_EVIDENCE',evidence_id,'RECORD',actor,'USER','AI.AMORTIZATION.PROPOSE',p_idempotency_key,p_idempotency_key,p_idempotency_key,coverage_hash,'Coverage evidence retained for deterministic amortization analysis',event_payload);
  INSERT INTO outbox_event(tenant_id,entity_id,aggregate_type,aggregate_id,event_type,payload,payload_hash)
    VALUES(p_tenant,p_entity,'AI_AMORTIZATION_COVERAGE_EVIDENCE',evidence_id,'AI_AMORTIZATION_COVERAGE_EVIDENCE_RECORDED',event_payload,refs_jsonb_hash(event_payload));
  result:=event_payload||jsonb_build_object('idempotent',false);
  UPDATE idempotency_receipt SET status='SUCCEEDED',response_status=201,response_body=result,completed_at=clock_timestamp() WHERE idempotency_receipt_id=idem.idempotency_receipt_id;
  RETURN result;
END;
$$;

REVOKE ALL ON ai_amortization_coverage_evidence FROM PUBLIC,refs_app;
REVOKE EXECUTE ON FUNCTION refs_ai_amortization_coverage_evidence_hash(uuid,uuid,uuid,text,date,date,text,text,text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION refs_record_ai_amortization_coverage_evidence(uuid,uuid,uuid,text,date,date,text,text,text,text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION refs_ai_amortization_coverage_evidence_hash(uuid,uuid,uuid,text,date,date,text,text,text) TO refs_app;
GRANT EXECUTE ON FUNCTION refs_record_ai_amortization_coverage_evidence(uuid,uuid,uuid,text,date,date,text,text,text,text,text) TO refs_app;

COMMIT;
