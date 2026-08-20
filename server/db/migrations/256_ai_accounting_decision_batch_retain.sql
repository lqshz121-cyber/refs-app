BEGIN;

CREATE FUNCTION refs_retain_ai_accounting_decision_batch(p_tenant uuid,p_entity uuid,p_period uuid,p_packets jsonb,p_idempotency_key text,p_request_hash text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE actor text:=refs_current_actor(); receipt idempotency_receipt; packet jsonb; item jsonb; receipts jsonb:='[]'::jsonb; response jsonb; expected_hash text; index_no integer:=0; row_count integer;
BEGIN
  PERFORM refs_assert_scope(p_tenant,p_entity,'AI.ANALYSIS.EXPLAIN');
  IF actor IS NULL THEN RAISE EXCEPTION 'Authenticated AI analysis actor missing' USING ERRCODE='42501'; END IF;
  IF jsonb_typeof(p_packets)<>'array' THEN RAISE EXCEPTION 'Decision batch packets must be an array' USING ERRCODE='22023'; END IF;
  row_count:=jsonb_array_length(p_packets);
  IF row_count>500 THEN RAISE EXCEPTION 'Decision batch exceeds 500 packets' USING ERRCODE='22023'; END IF;
  IF NOT EXISTS(SELECT 1 FROM accounting_period WHERE tenant_id=p_tenant AND entity_id=p_entity AND period_id=p_period) THEN RAISE EXCEPTION 'Decision batch period is unavailable' USING ERRCODE='22023'; END IF;
  IF EXISTS(SELECT 1 FROM jsonb_array_elements(p_packets) x WHERE x->>'accounting_period_id'<>p_period::text) THEN RAISE EXCEPTION 'Decision batch period drifted' USING ERRCODE='23514'; END IF;
  IF EXISTS(
    SELECT 1 FROM jsonb_array_elements(p_packets) AS batch_packet(value)
    GROUP BY refs_jsonb_hash(value) HAVING count(*)>1
  ) THEN RAISE EXCEPTION 'Decision batch contains a duplicate canonical packet' USING ERRCODE='23514'; END IF;
  IF EXISTS(
    SELECT 1 FROM jsonb_array_elements(p_packets) AS batch_packet(value)
    GROUP BY value#>>'{source,source_document_id}' HAVING count(*)>1
  ) THEN RAISE EXCEPTION 'Decision batch contains more than one decision for a retained source' USING ERRCODE='23514'; END IF;
  expected_hash:=refs_jsonb_hash(jsonb_build_object('tenant_id',p_tenant,'entity_id',p_entity,'period_id',p_period,'packets',p_packets));
  IF p_request_hash<>expected_hash THEN RAISE EXCEPTION 'Decision batch retention hash is not canonical' USING ERRCODE='22023'; END IF;

  INSERT INTO idempotency_receipt(tenant_id,operation_scope,idempotency_key,request_hash,status,actor_id)
  VALUES(p_tenant,'AI_ACCOUNTING_DECISION_BATCH_RETAIN:'||p_entity,p_idempotency_key,p_request_hash,'IN_PROGRESS',actor) ON CONFLICT DO NOTHING;
  SELECT * INTO receipt FROM idempotency_receipt WHERE tenant_id=p_tenant AND operation_scope='AI_ACCOUNTING_DECISION_BATCH_RETAIN:'||p_entity AND idempotency_key=p_idempotency_key FOR UPDATE;
  IF receipt.request_hash<>p_request_hash OR receipt.actor_id<>actor THEN RAISE EXCEPTION 'Idempotency key reused with different batch or actor' USING ERRCODE='23505'; END IF;
  IF receipt.status='SUCCEEDED' THEN RETURN receipt.response_body||jsonb_build_object('idempotent',true); END IF;

  FOR packet IN SELECT value FROM jsonb_array_elements(p_packets) LOOP
    item:=refs_retain_ai_accounting_decision(p_tenant,p_entity,packet,refs_jsonb_hash(jsonb_build_object('parent_idempotency_key',p_idempotency_key,'packet_index',index_no)),refs_jsonb_hash(jsonb_build_object('tenant_id',p_tenant,'entity_id',p_entity,'packet',packet)));
    IF NOT (item ?& ARRAY['schema_version','ai_accounting_decision_id','decision_hash','packet_status','source_document_id','can_create_draft','can_review','can_approve','can_post','idempotent'])
      OR item-ARRAY['schema_version','ai_accounting_decision_id','decision_hash','packet_status','source_document_id','can_create_draft','can_review','can_approve','can_post','idempotent']<>'{}'::jsonb
      OR item->>'schema_version'<>'AI_ACCOUNTING_DECISION_RETAINED_V1' OR item->>'packet_status' NOT IN ('READY_FOR_HUMAN_REVIEW','EXCEPTION')
      OR item->>'can_create_draft'<>'false' OR item->>'can_review'<>'false' OR item->>'can_approve'<>'false' OR item->>'can_post'<>'false'
    THEN RAISE EXCEPTION 'Decision batch item returned unsafe evidence' USING ERRCODE='23514'; END IF;
    receipts:=receipts||jsonb_build_array(item); index_no:=index_no+1;
  END LOOP;
  response:=jsonb_build_object('schema_version','AI_ACCOUNTING_DECISION_RUN_RECEIPT_V1','accounting_period_id',p_period,'row_count',row_count,'receipts',receipts,'can_create_draft',false,'can_review',false,'can_approve',false,'can_post',false,'idempotent',false);
  UPDATE idempotency_receipt SET status='SUCCEEDED',response_status=201,response_body=response,completed_at=clock_timestamp()
   WHERE tenant_id=p_tenant AND operation_scope='AI_ACCOUNTING_DECISION_BATCH_RETAIN:'||p_entity AND idempotency_key=p_idempotency_key;
  RETURN response;
END $$;

REVOKE EXECUTE ON FUNCTION refs_retain_ai_accounting_decision_batch(uuid,uuid,uuid,jsonb,text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION refs_retain_ai_accounting_decision_batch(uuid,uuid,uuid,jsonb,text,text) TO refs_app;

COMMIT;
