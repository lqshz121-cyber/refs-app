BEGIN;

CREATE TABLE ai_invoice_accounting_classification_evidence (
  ai_invoice_accounting_classification_evidence_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant(tenant_id),
  entity_id uuid NOT NULL,
  accounting_period_id uuid NOT NULL,
  source_document_id uuid NOT NULL,
  source_document_line_id uuid NOT NULL,
  source_payload_hash text NOT NULL CHECK(source_payload_hash~'^sha256:[0-9a-f]{64}$'),
  source_line_hash text NOT NULL CHECK(source_line_hash~'^sha256:[0-9a-f]{64}$'),
  classifier_version text NOT NULL CHECK(classifier_version='AI_INVOICE_ACCOUNTING_CLASSIFICATION_V1'),
  classification text NOT NULL CHECK(classification IN ('EXPENSE','PREPAID_AMORTIZATION','ACCRUAL_REVIEW','CAPITALIZATION_REVIEW','BLOCKED')),
  reason text NOT NULL CHECK(length(btrim(reason)) BETWEEN 8 AND 2000),
  confidence numeric(5,4) NOT NULL CHECK(confidence BETWEEN 0 AND 1),
  required_human_fields jsonb NOT NULL CHECK(jsonb_typeof(required_human_fields)='array' AND jsonb_array_length(required_human_fields)<=12),
  classification_hash text NOT NULL CHECK(classification_hash~'^sha256:[0-9a-f]{64}$'),
  status text NOT NULL CHECK(status IN ('CLASSIFIED','REVIEW_REQUIRED','BLOCKED')),
  created_by text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE(tenant_id,entity_id,ai_invoice_accounting_classification_evidence_id),
  UNIQUE(tenant_id,entity_id,classification_hash),
  FOREIGN KEY(tenant_id,entity_id) REFERENCES entity(tenant_id,entity_id),
  FOREIGN KEY(tenant_id,entity_id,accounting_period_id) REFERENCES accounting_period(tenant_id,entity_id,period_id),
  FOREIGN KEY(tenant_id,entity_id,source_document_id) REFERENCES source_document(tenant_id,entity_id,source_document_id),
  FOREIGN KEY(tenant_id,entity_id,source_document_line_id) REFERENCES source_document_line(tenant_id,entity_id,source_document_line_id)
);

ALTER TABLE ai_invoice_accounting_classification_evidence ENABLE ROW LEVEL SECURITY;
CREATE POLICY ai_invoice_accounting_classification_evidence_scope ON ai_invoice_accounting_classification_evidence
  USING(tenant_id=refs_current_tenant() AND refs_entity_allowed(entity_id))
  WITH CHECK(tenant_id=refs_current_tenant() AND refs_entity_allowed(entity_id));
CREATE TRIGGER ai_invoice_accounting_classification_evidence_append_only BEFORE UPDATE OR DELETE ON ai_invoice_accounting_classification_evidence
  FOR EACH ROW EXECUTE FUNCTION reject_mutation();

CREATE FUNCTION refs_ai_invoice_classification_batch_hash(p_tenant uuid,p_entity uuid,p_period uuid,p_batch jsonb) RETURNS text
LANGUAGE sql IMMUTABLE SET search_path=pg_catalog,public,pg_temp AS $$
  SELECT refs_jsonb_hash(jsonb_build_object('schema_version','AI_INVOICE_ACCOUNTING_CLASSIFICATION_RUN_V1','tenant_id',p_tenant,'entity_id',p_entity,'accounting_period_id',p_period,'batch',p_batch))
$$;

CREATE FUNCTION refs_materialize_ai_invoice_classification_batch(p_tenant uuid,p_entity uuid,p_period uuid,p_batch jsonb,p_idempotency_key text,p_request_hash text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE actor text:=refs_current_actor(); idem idempotency_receipt; item jsonb; retained wbs_final1_retained_source_row; source source_document;
DECLARE evidence_id uuid; evidence_hash text; event_payload jsonb; response jsonb; inserted_count integer:=0; replay_count integer:=0; result_ids jsonb:='[]'::jsonb;
BEGIN
  PERFORM refs_assert_ai_analysis_scope(p_tenant,p_entity);
  IF actor IS NULL THEN RAISE EXCEPTION 'Authenticated AI invoice classification actor missing' USING ERRCODE='42501'; END IF;
  IF p_request_hash IS DISTINCT FROM refs_ai_invoice_classification_batch_hash(p_tenant,p_entity,p_period,p_batch) THEN RAISE EXCEPTION 'AI invoice classification request hash is not canonical' USING ERRCODE='22023'; END IF;
  IF jsonb_typeof(p_batch)<>'object' OR (p_batch-'schema_version'-'row_count'-'results'-'classification_counts'-'scope'-'scanned_document_count'-'eligible_invoice_line_count'-'action_flags')<>'{}'::jsonb
     OR p_batch->>'schema_version'<>'AI_INVOICE_ACCOUNTING_CLASSIFICATION_BATCH_V1' OR jsonb_typeof(p_batch->'results')<>'array'
     OR jsonb_array_length(p_batch->'results')>500 OR (p_batch->>'row_count')::integer<>jsonb_array_length(p_batch->'results')
     OR p_batch#>>'{scope,tenant_id}' IS DISTINCT FROM p_tenant::text OR p_batch#>>'{scope,entity_id}' IS DISTINCT FROM p_entity::text OR p_batch#>>'{scope,accounting_period_id}' IS DISTINCT FROM p_period::text
     OR p_batch->'action_flags' IS DISTINCT FROM '{"can_create_draft":false,"can_review":false,"can_approve":false,"can_post":false}'::jsonb THEN
    RAISE EXCEPTION 'AI invoice classification batch is malformed or action-enabled' USING ERRCODE='22023';
  END IF;
  INSERT INTO idempotency_receipt(tenant_id,operation_scope,idempotency_key,request_hash,status,actor_id)
    VALUES(p_tenant,'AI_INVOICE_CLASSIFICATION:'||p_entity||':'||p_period,p_idempotency_key,p_request_hash,'IN_PROGRESS',actor)
    ON CONFLICT(tenant_id,operation_scope,idempotency_key) DO NOTHING;
  SELECT * INTO idem FROM idempotency_receipt WHERE tenant_id=p_tenant AND operation_scope='AI_INVOICE_CLASSIFICATION:'||p_entity||':'||p_period AND idempotency_key=p_idempotency_key FOR UPDATE;
  IF idem.request_hash IS DISTINCT FROM p_request_hash OR idem.actor_id IS DISTINCT FROM actor THEN RAISE EXCEPTION 'AI invoice classification idempotency key conflicts with payload or actor' USING ERRCODE='23505'; END IF;
  IF idem.status='SUCCEEDED' THEN RETURN idem.response_body||jsonb_build_object('idempotent',true); END IF;
  FOR item IN SELECT value FROM jsonb_array_elements(p_batch->'results') LOOP
    IF jsonb_typeof(item)<>'object' OR (item-'schema_version'-'source_document_id'-'source_document_line_id'-'source_payload_hash'-'source_line_hash'-'classification'-'reason'-'confidence'-'required_human_fields'-'action_flags')<>'{}'::jsonb
       OR item->>'schema_version'<>'AI_INVOICE_ACCOUNTING_CLASSIFICATION_V1'
       OR item->>'classification' NOT IN ('EXPENSE','PREPAID_AMORTIZATION','ACCRUAL_REVIEW','CAPITALIZATION_REVIEW','BLOCKED')
       OR item->>'source_payload_hash' !~ '^sha256:[0-9a-f]{64}$' OR item->>'source_line_hash' !~ '^sha256:[0-9a-f]{64}$'
       OR jsonb_typeof(item->'confidence')<>'number' OR (item->>'confidence')::numeric NOT BETWEEN 0 AND 1
       OR length(btrim(item->>'reason')) NOT BETWEEN 8 AND 2000 OR jsonb_typeof(item->'required_human_fields')<>'array' OR jsonb_array_length(item->'required_human_fields')>12
       OR EXISTS(SELECT 1 FROM jsonb_array_elements(item->'required_human_fields') field WHERE jsonb_typeof(field)<>'string' OR length(btrim(field#>>'{}')) NOT BETWEEN 1 AND 64)
       OR item->'action_flags' IS DISTINCT FROM '{"can_create_draft":false,"can_review":false,"can_approve":false,"can_post":false}'::jsonb THEN
      RAISE EXCEPTION 'AI invoice classification row is malformed or action-enabled' USING ERRCODE='22023';
    END IF;
    SELECT * INTO retained FROM wbs_final1_retained_source_row r WHERE r.tenant_id=p_tenant AND r.entity_id=p_entity AND r.domain='PAYABLES'
      AND r.source_document_id=(item->>'source_document_id')::uuid AND r.source_document_line_id=(item->>'source_document_line_id')::uuid
      AND r.accounting_period_id=p_period AND r.raw_row_hash=item->>'source_line_hash' FOR SHARE;
    IF NOT FOUND THEN RAISE EXCEPTION 'AI invoice classification is not bound to exact retained payable evidence' USING ERRCODE='23514'; END IF;
    SELECT * INTO source FROM source_document d WHERE d.tenant_id=p_tenant AND d.entity_id=p_entity AND d.source_document_id=retained.source_document_id AND d.payload_hash=item->>'source_payload_hash' FOR SHARE;
    IF NOT FOUND OR NOT EXISTS(SELECT 1 FROM source_document_line l WHERE l.tenant_id=p_tenant AND l.entity_id=p_entity AND l.source_document_id=source.source_document_id AND l.source_document_line_id=retained.source_document_line_id) THEN
      RAISE EXCEPTION 'AI invoice classification source document lineage changed' USING ERRCODE='23514';
    END IF;
    evidence_hash:=refs_jsonb_hash(jsonb_build_object('schema_version','AI_INVOICE_ACCOUNTING_CLASSIFICATION_EVIDENCE_V1','tenant_id',p_tenant,'entity_id',p_entity,'accounting_period_id',p_period,'classification',item));
    SELECT ai_invoice_accounting_classification_evidence_id INTO evidence_id FROM ai_invoice_accounting_classification_evidence WHERE tenant_id=p_tenant AND entity_id=p_entity AND classification_hash=evidence_hash;
    IF FOUND THEN replay_count:=replay_count+1;
    ELSE
      evidence_id:=gen_random_uuid();
      INSERT INTO ai_invoice_accounting_classification_evidence(ai_invoice_accounting_classification_evidence_id,tenant_id,entity_id,accounting_period_id,source_document_id,source_document_line_id,source_payload_hash,source_line_hash,classifier_version,classification,reason,confidence,required_human_fields,classification_hash,status,created_by)
      VALUES(evidence_id,p_tenant,p_entity,p_period,retained.source_document_id,retained.source_document_line_id,item->>'source_payload_hash',item->>'source_line_hash','AI_INVOICE_ACCOUNTING_CLASSIFICATION_V1',item->>'classification',item->>'reason',(item->>'confidence')::numeric,item->'required_human_fields',evidence_hash,CASE item->>'classification' WHEN 'EXPENSE' THEN 'CLASSIFIED' WHEN 'BLOCKED' THEN 'BLOCKED' ELSE 'REVIEW_REQUIRED' END,actor);
      event_payload:=jsonb_build_object('schema_version','AI_INVOICE_ACCOUNTING_CLASSIFICATION_EVIDENCE_V1','classification_evidence_id',evidence_id,'accounting_period_id',p_period,'source_document_id',retained.source_document_id,'source_document_line_id',retained.source_document_line_id,'source_payload_hash',item->>'source_payload_hash','source_line_hash',item->>'source_line_hash','classification',item->>'classification','classification_hash',evidence_hash,'can_create_draft',false,'can_review',false,'can_approve',false,'can_post',false);
      INSERT INTO audit_event(tenant_id,entity_id,event_type,object_type,object_id,action,actor_id,actor_type,permission_used,request_id,correlation_id,idempotency_key,after_hash,reason,metadata)
      VALUES(p_tenant,p_entity,'AI_INVOICE_ACCOUNTING_CLASSIFIED','AI_INVOICE_ACCOUNTING_CLASSIFICATION_EVIDENCE',evidence_id,'CLASSIFY',actor,'USER','AI.ANALYSIS.EXPLAIN',p_idempotency_key,p_idempotency_key,p_idempotency_key,evidence_hash,'Deterministic source-bound invoice accounting classification; no accounting action',event_payload);
      INSERT INTO outbox_event(tenant_id,entity_id,aggregate_type,aggregate_id,event_type,payload,payload_hash)
      VALUES(p_tenant,p_entity,'AI_INVOICE_ACCOUNTING_CLASSIFICATION_EVIDENCE',evidence_id,'AI_INVOICE_ACCOUNTING_CLASSIFIED',event_payload,refs_jsonb_hash(event_payload));
      inserted_count:=inserted_count+1;
    END IF;
    result_ids:=result_ids||jsonb_build_array(evidence_id);
  END LOOP;
  response:=jsonb_build_object('schema_version','AI_INVOICE_ACCOUNTING_CLASSIFICATION_RUN_RECEIPT_V1','accounting_period_id',p_period,'row_count',jsonb_array_length(p_batch->'results'),'inserted_count',inserted_count,'replayed_count',replay_count,'classification_evidence_ids',result_ids,'request_hash',p_request_hash,'can_create_draft',false,'can_review',false,'can_approve',false,'can_post',false,'idempotent',false);
  UPDATE idempotency_receipt SET status='SUCCEEDED',response_status=201,response_body=response,completed_at=clock_timestamp() WHERE idempotency_receipt_id=idem.idempotency_receipt_id;
  RETURN response;
END;
$$;

CREATE FUNCTION refs_read_ai_invoice_classification_evidence(p_tenant uuid,p_entity uuid,p_period uuid,p_limit integer DEFAULT 100)
RETURNS SETOF ai_invoice_accounting_classification_evidence
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
BEGIN
  PERFORM refs_assert_ai_analysis_scope(p_tenant,p_entity);
  IF p_limit IS NULL OR p_limit<1 OR p_limit>500 THEN RAISE EXCEPTION 'AI invoice classification evidence limit must be between 1 and 500' USING ERRCODE='22023'; END IF;
  RETURN QUERY SELECT e.* FROM ai_invoice_accounting_classification_evidence e WHERE e.tenant_id=p_tenant AND e.entity_id=p_entity AND e.accounting_period_id=p_period ORDER BY e.created_at DESC,e.ai_invoice_accounting_classification_evidence_id DESC LIMIT p_limit;
END;
$$;

REVOKE ALL ON ai_invoice_accounting_classification_evidence FROM PUBLIC,refs_app;
REVOKE ALL ON FUNCTION refs_ai_invoice_classification_batch_hash(uuid,uuid,uuid,jsonb),refs_materialize_ai_invoice_classification_batch(uuid,uuid,uuid,jsonb,text,text),refs_read_ai_invoice_classification_evidence(uuid,uuid,uuid,integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION refs_ai_invoice_classification_batch_hash(uuid,uuid,uuid,jsonb),refs_materialize_ai_invoice_classification_batch(uuid,uuid,uuid,jsonb,text,text),refs_read_ai_invoice_classification_evidence(uuid,uuid,uuid,integer) TO refs_app;

COMMIT;
