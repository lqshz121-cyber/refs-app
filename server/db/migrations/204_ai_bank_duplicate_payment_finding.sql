BEGIN;

CREATE TABLE ai_bank_duplicate_payment_finding(
  ai_bank_duplicate_payment_finding_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant(tenant_id),
  entity_id uuid NOT NULL,
  accounting_period_id uuid NOT NULL,
  finding_hash text NOT NULL CHECK(finding_hash~'^sha256:[0-9a-f]{64}$'),
  finding jsonb NOT NULL,
  status text NOT NULL DEFAULT 'OPEN' CHECK(status='OPEN'),
  created_by text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE(tenant_id,entity_id,ai_bank_duplicate_payment_finding_id),
  UNIQUE(tenant_id,entity_id,finding_hash),
  FOREIGN KEY(tenant_id,entity_id) REFERENCES entity(tenant_id,entity_id),
  FOREIGN KEY(tenant_id,entity_id,accounting_period_id) REFERENCES accounting_period(tenant_id,entity_id,period_id),
  CHECK(finding->>'schema_version'='AI_BANK_DUPLICATE_PAYMENT_FINDING_V1'),
  CHECK(finding->'action_flags'='{"can_create_draft":false,"can_review":false,"can_approve":false,"can_post":false}'::jsonb)
);

CREATE TABLE ai_bank_duplicate_payment_source(
  tenant_id uuid NOT NULL,
  entity_id uuid NOT NULL,
  ai_bank_duplicate_payment_finding_id uuid NOT NULL,
  source_ordinal integer NOT NULL CHECK(source_ordinal BETWEEN 1 AND 500),
  bank_source_id uuid NOT NULL,
  source_document_id uuid NOT NULL,
  source_payload_hash text NOT NULL CHECK(source_payload_hash~'^sha256:[0-9a-f]{64}$'),
  external_bank_line_id text NOT NULL CHECK(length(btrim(external_bank_line_id)) BETWEEN 1 AND 256),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY(tenant_id,entity_id,ai_bank_duplicate_payment_finding_id,source_ordinal),
  UNIQUE(tenant_id,entity_id,ai_bank_duplicate_payment_finding_id,bank_source_id),
  UNIQUE(tenant_id,entity_id,ai_bank_duplicate_payment_finding_id,external_bank_line_id),
  FOREIGN KEY(tenant_id,entity_id,ai_bank_duplicate_payment_finding_id) REFERENCES ai_bank_duplicate_payment_finding(tenant_id,entity_id,ai_bank_duplicate_payment_finding_id),
  FOREIGN KEY(tenant_id,entity_id,bank_source_id) REFERENCES bank_source(tenant_id,entity_id,bank_source_id),
  FOREIGN KEY(tenant_id,entity_id,source_document_id) REFERENCES source_document(tenant_id,entity_id,source_document_id)
);

ALTER TABLE ai_bank_duplicate_payment_finding ENABLE ROW LEVEL SECURITY;
ALTER TABLE ai_bank_duplicate_payment_source ENABLE ROW LEVEL SECURITY;
CREATE POLICY ai_bank_duplicate_payment_finding_scope ON ai_bank_duplicate_payment_finding USING(tenant_id=refs_current_tenant() AND refs_entity_allowed(entity_id)) WITH CHECK(tenant_id=refs_current_tenant() AND refs_entity_allowed(entity_id));
CREATE POLICY ai_bank_duplicate_payment_source_scope ON ai_bank_duplicate_payment_source USING(tenant_id=refs_current_tenant() AND refs_entity_allowed(entity_id)) WITH CHECK(tenant_id=refs_current_tenant() AND refs_entity_allowed(entity_id));
CREATE TRIGGER ai_bank_duplicate_payment_finding_append_only BEFORE UPDATE OR DELETE ON ai_bank_duplicate_payment_finding FOR EACH ROW EXECUTE FUNCTION reject_mutation();
CREATE TRIGGER ai_bank_duplicate_payment_source_append_only BEFORE UPDATE OR DELETE ON ai_bank_duplicate_payment_source FOR EACH ROW EXECUTE FUNCTION reject_mutation();

CREATE FUNCTION refs_ai_bank_duplicate_payment_batch_hash(p_tenant uuid,p_entity uuid,p_period uuid,p_batch jsonb) RETURNS text
LANGUAGE sql IMMUTABLE SET search_path=pg_catalog,public,pg_temp AS $$
  SELECT refs_jsonb_hash(jsonb_build_object('schema_version','AI_BANK_DUPLICATE_PAYMENT_RUN_V1','tenant_id',p_tenant,'entity_id',p_entity,'accounting_period_id',p_period,'batch',p_batch))
$$;

CREATE FUNCTION refs_materialize_ai_bank_duplicate_payment_batch(p_tenant uuid,p_entity uuid,p_period uuid,p_batch jsonb,p_idempotency_key text,p_request_hash text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE actor text:=refs_current_actor();idem idempotency_receipt;period_row accounting_period;item jsonb;trace jsonb;bank_row bank_source;document_row source_document;receipt_row wbs_bank_statement_receipt;finding_id uuid;finding_hash text;event_payload jsonb;response jsonb;result_ids jsonb:='[]'::jsonb;inserted_count integer:=0;replayed_count integer:=0;ordinal integer;trace_count integer;
BEGIN
  PERFORM refs_assert_ai_analysis_scope(p_tenant,p_entity);
  IF actor IS NULL THEN RAISE EXCEPTION 'Authenticated bank duplicate-payment actor missing' USING ERRCODE='42501'; END IF;
  IF length(coalesce(p_idempotency_key,'')) NOT BETWEEN 8 AND 200 THEN RAISE EXCEPTION 'Bank duplicate-payment idempotency key is invalid' USING ERRCODE='22023'; END IF;
  IF p_request_hash IS DISTINCT FROM refs_ai_bank_duplicate_payment_batch_hash(p_tenant,p_entity,p_period,p_batch) THEN RAISE EXCEPTION 'Bank duplicate-payment request hash is not canonical' USING ERRCODE='22023'; END IF;
  SELECT period.* INTO period_row FROM accounting_period period WHERE period.tenant_id=p_tenant AND period.entity_id=p_entity AND period.period_id=p_period FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Bank duplicate-payment period is absent' USING ERRCODE='23503'; END IF;
  IF jsonb_typeof(p_batch)<>'object' OR (p_batch-'schema_version'-'current_accounting_period_id'-'scanned_payment_count'-'finding_count'-'findings'-'action_flags')<>'{}'::jsonb OR p_batch->>'schema_version'<>'AI_BANK_DUPLICATE_PAYMENT_BATCH_V1' OR p_batch->>'current_accounting_period_id'<>p_period::text OR jsonb_typeof(p_batch->'findings')<>'array' OR jsonb_array_length(p_batch->'findings')>500 OR (p_batch->>'finding_count')::integer<>jsonb_array_length(p_batch->'findings') OR p_batch->'action_flags' IS DISTINCT FROM '{"can_create_draft":false,"can_review":false,"can_approve":false,"can_post":false}'::jsonb THEN RAISE EXCEPTION 'Bank duplicate-payment batch is malformed or action-enabled' USING ERRCODE='22023'; END IF;
  INSERT INTO idempotency_receipt(tenant_id,operation_scope,idempotency_key,request_hash,status,actor_id) VALUES(p_tenant,'AI_BANK_DUPLICATE_PAYMENT:'||p_entity||':'||p_period,p_idempotency_key,p_request_hash,'IN_PROGRESS',actor) ON CONFLICT(tenant_id,operation_scope,idempotency_key) DO NOTHING;
  SELECT * INTO idem FROM idempotency_receipt WHERE tenant_id=p_tenant AND operation_scope='AI_BANK_DUPLICATE_PAYMENT:'||p_entity||':'||p_period AND idempotency_key=p_idempotency_key FOR UPDATE;
  IF idem.request_hash IS DISTINCT FROM p_request_hash OR idem.actor_id IS DISTINCT FROM actor THEN RAISE EXCEPTION 'Bank duplicate-payment idempotency key conflicts with payload or actor' USING ERRCODE='23505'; END IF;
  IF idem.status='SUCCEEDED' THEN RETURN idem.response_body||jsonb_build_object('idempotent',true); END IF;
  FOR item IN SELECT value FROM jsonb_array_elements(p_batch->'findings') LOOP
    IF (item-'schema_version'-'finding_type'-'risk_level'-'rule_id'-'entity_id'-'accounting_period_id'-'bank_account_ref'-'transaction_date'-'currency'-'amount'-'payment_count'-'source_trace'-'reason'-'suggested_action'-'confidence'-'owner_role'-'due_basis'-'required_human_fields'-'action_flags')<>'{}'::jsonb OR item->>'schema_version'<>'AI_BANK_DUPLICATE_PAYMENT_FINDING_V1' OR item->>'finding_type'<>'SAME_DAY_SAME_AMOUNT_BANK_PAYMENT' OR item->>'rule_id'<>'AI_BANK_SAME_DAY_SAME_AMOUNT_PAYMENT_V1' OR item->>'entity_id'<>p_entity::text OR item->>'accounting_period_id'<>p_period::text OR item->>'risk_level' NOT IN('HIGH','MEDIUM') OR item->>'transaction_date'!~'^\d{4}-\d{2}-\d{2}$' OR item->>'currency'!~'^[A-Z]{3}$' OR item->>'amount'!~'^-[1-9][0-9]*\.[0-9]{4}$' OR jsonb_typeof(item->'payment_count')<>'number' OR (item->>'payment_count')::integer<2 OR (item->>'payment_count')::integer>500 OR jsonb_typeof(item->'source_trace')<>'array' OR jsonb_array_length(item->'source_trace')<>(item->>'payment_count')::integer OR item->'required_human_fields' IS DISTINCT FROM '["vendor_identity","invoice_support","payment_approval","bank_memo","duplicate_or_valid_conclusion","resolution_reason"]'::jsonb OR item->>'owner_role'<>'CONTROLLER_REVIEW' OR item->>'due_basis'<>'BEFORE_BANK_RECONCILIATION_CLOSE' OR item->'action_flags' IS DISTINCT FROM '{"can_create_draft":false,"can_review":false,"can_approve":false,"can_post":false}'::jsonb OR item->>'risk_level' IS DISTINCT FROM (CASE WHEN (item->>'payment_count')::integer>=3 THEN 'HIGH' ELSE 'MEDIUM' END) THEN RAISE EXCEPTION 'Bank duplicate-payment finding is malformed, unscoped, or action-enabled' USING ERRCODE='22023'; END IF;
    ordinal:=0;trace_count:=0;
    FOR trace IN SELECT value FROM jsonb_array_elements(item->'source_trace') LOOP ordinal:=ordinal+1;
      IF (trace-'bank_source_id'-'source_document_id'-'source_payload_hash'-'external_bank_line_id')<>'{}'::jsonb OR trace->>'bank_source_id'!~'^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' OR trace->>'source_document_id'!~'^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' OR trace->>'source_payload_hash'!~'^sha256:[0-9a-f]{64}$' OR length(btrim(coalesce(trace->>'external_bank_line_id',''))) NOT BETWEEN 1 AND 256 THEN RAISE EXCEPTION 'Bank duplicate-payment source trace is malformed' USING ERRCODE='22023'; END IF;
      SELECT bank.* INTO bank_row FROM bank_source bank WHERE bank.tenant_id=p_tenant AND bank.entity_id=p_entity AND bank.bank_source_id=(trace->>'bank_source_id')::uuid FOR SHARE;
      IF NOT FOUND OR bank_row.source_document_id IS DISTINCT FROM (trace->>'source_document_id')::uuid OR bank_row.external_bank_line_id IS DISTINCT FROM trace->>'external_bank_line_id' OR bank_row.bank_account_ref IS DISTINCT FROM item->>'bank_account_ref' OR bank_row.transaction_date IS DISTINCT FROM (item->>'transaction_date')::date OR bank_row.currency IS DISTINCT FROM item->>'currency' OR bank_row.amount IS DISTINCT FROM (item->>'amount')::numeric OR bank_row.transaction_date NOT BETWEEN period_row.starts_on AND period_row.ends_on THEN RAISE EXCEPTION 'Bank duplicate-payment trace does not match the exact period source' USING ERRCODE='23514'; END IF;
      SELECT document.* INTO document_row FROM source_document document WHERE document.tenant_id=p_tenant AND document.entity_id=p_entity AND document.source_document_id=bank_row.source_document_id AND document.payload_hash=trace->>'source_payload_hash' FOR SHARE;
      IF NOT FOUND THEN RAISE EXCEPTION 'Bank duplicate-payment source payload lineage changed' USING ERRCODE='23514'; END IF;
      SELECT receipt.* INTO receipt_row FROM wbs_bank_statement_transaction txn JOIN wbs_bank_statement_receipt receipt ON receipt.tenant_id=txn.tenant_id AND receipt.entity_id=txn.entity_id AND receipt.wbs_bank_statement_receipt_id=txn.wbs_bank_statement_receipt_id WHERE txn.tenant_id=p_tenant AND txn.entity_id=p_entity AND txn.bank_source_id=bank_row.bank_source_id AND txn.source_document_id=document_row.source_document_id AND receipt.signature_verified=true AND receipt.admission_status='ADMITTED' FOR SHARE OF receipt;
      IF NOT FOUND THEN RAISE EXCEPTION 'Bank duplicate-payment source is not signed admitted evidence' USING ERRCODE='23514'; END IF;
      trace_count:=trace_count+1;
    END LOOP;
    IF trace_count<>(item->>'payment_count')::integer OR (SELECT count(DISTINCT value->>'bank_source_id') FROM jsonb_array_elements(item->'source_trace'))<>trace_count OR (SELECT count(DISTINCT value->>'external_bank_line_id') FROM jsonb_array_elements(item->'source_trace'))<>trace_count THEN RAISE EXCEPTION 'Bank duplicate-payment finding requires distinct complete source identities' USING ERRCODE='23514'; END IF;
    finding_hash:=refs_jsonb_hash(jsonb_build_object('schema_version','AI_BANK_DUPLICATE_PAYMENT_EVIDENCE_V1','tenant_id',p_tenant,'entity_id',p_entity,'accounting_period_id',p_period,'finding',item));
    SELECT ai_bank_duplicate_payment_finding_id INTO finding_id FROM ai_bank_duplicate_payment_finding WHERE tenant_id=p_tenant AND entity_id=p_entity AND finding_hash=finding_hash;
    IF FOUND THEN replayed_count:=replayed_count+1; ELSE
      finding_id:=gen_random_uuid();
      INSERT INTO ai_bank_duplicate_payment_finding(ai_bank_duplicate_payment_finding_id,tenant_id,entity_id,accounting_period_id,finding_hash,finding,created_by) VALUES(finding_id,p_tenant,p_entity,p_period,finding_hash,item,actor);
      ordinal:=0;FOR trace IN SELECT value FROM jsonb_array_elements(item->'source_trace') LOOP ordinal:=ordinal+1;INSERT INTO ai_bank_duplicate_payment_source(tenant_id,entity_id,ai_bank_duplicate_payment_finding_id,source_ordinal,bank_source_id,source_document_id,source_payload_hash,external_bank_line_id) VALUES(p_tenant,p_entity,finding_id,ordinal,(trace->>'bank_source_id')::uuid,(trace->>'source_document_id')::uuid,trace->>'source_payload_hash',trace->>'external_bank_line_id');END LOOP;
      event_payload:=jsonb_build_object('schema_version','AI_BANK_DUPLICATE_PAYMENT_EVIDENCE_V1','finding_id',finding_id,'finding_hash',finding_hash,'source_trace_hash',refs_jsonb_hash(item->'source_trace'),'duplicate_determination','HUMAN_DECISION_REQUIRED','can_create_draft',false,'can_review',false,'can_approve',false,'can_post',false);
      INSERT INTO audit_event(tenant_id,entity_id,event_type,object_type,object_id,action,actor_id,actor_type,permission_used,request_id,correlation_id,idempotency_key,after_hash,reason,metadata) VALUES(p_tenant,p_entity,'AI_BANK_DUPLICATE_PAYMENT_MATERIALIZED','AI_BANK_DUPLICATE_PAYMENT_FINDING',finding_id,'MATERIALIZE',actor,'USER','AI.ANALYSIS.EXPLAIN',p_idempotency_key,p_idempotency_key,p_idempotency_key,finding_hash,'Deterministic source-bound same-day same-amount payment evidence; duplicate conclusion requires Controller review',event_payload);
      INSERT INTO outbox_event(tenant_id,entity_id,aggregate_type,aggregate_id,event_type,payload,payload_hash) VALUES(p_tenant,p_entity,'AI_BANK_DUPLICATE_PAYMENT_FINDING',finding_id,'AI_BANK_DUPLICATE_PAYMENT_MATERIALIZED',event_payload,refs_jsonb_hash(event_payload));inserted_count:=inserted_count+1;
    END IF;
    result_ids:=result_ids||jsonb_build_array(finding_id);
  END LOOP;
  response:=jsonb_build_object('schema_version','AI_BANK_DUPLICATE_PAYMENT_RUN_RECEIPT_V1','accounting_period_id',p_period,'row_count',jsonb_array_length(p_batch->'findings'),'inserted_count',inserted_count,'replayed_count',replayed_count,'finding_ids',result_ids,'request_hash',p_request_hash,'can_create_draft',false,'can_review',false,'can_approve',false,'can_post',false,'idempotent',false);
  UPDATE idempotency_receipt SET status='SUCCEEDED',response_status=201,response_body=response,completed_at=clock_timestamp() WHERE idempotency_receipt_id=idem.idempotency_receipt_id;
  RETURN response;
END;
$$;

REVOKE ALL ON ai_bank_duplicate_payment_finding,ai_bank_duplicate_payment_source FROM PUBLIC,refs_app;
REVOKE ALL ON FUNCTION refs_ai_bank_duplicate_payment_batch_hash(uuid,uuid,uuid,jsonb),refs_materialize_ai_bank_duplicate_payment_batch(uuid,uuid,uuid,jsonb,text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION refs_ai_bank_duplicate_payment_batch_hash(uuid,uuid,uuid,jsonb),refs_materialize_ai_bank_duplicate_payment_batch(uuid,uuid,uuid,jsonb,text,text) TO refs_app;

COMMIT;
