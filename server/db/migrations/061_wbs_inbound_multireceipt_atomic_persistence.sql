BEGIN;

CREATE OR REPLACE FUNCTION refs_persist_wbs_inbound_snapshot_rows(
  p_tenant uuid,p_entity uuid,p_batch uuid,p_groups jsonb,p_idempotency text,p_request_hash text
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE rec idempotency_receipt; actor text:=refs_current_actor(); group_item jsonb; row_item jsonb;
  receipt_hash text; payload_ref text; receipt_id uuid; group_rows jsonb; result_groups jsonb:='[]'::jsonb;
  response jsonb; event_payload jsonb; total_rows integer:=0; group_rows_count integer; seen_hashes text[]:=ARRAY[]::text[]; seen_sources text[]:=ARRAY[]::text[]; source_key text;
BEGIN
  PERFORM refs_assert_scope(p_tenant,p_entity,'WBS.SNAPSHOT.IMPORT');
  IF actor IS NULL THEN RAISE EXCEPTION 'Authenticated actor missing' USING ERRCODE='42501'; END IF;
  IF NOT EXISTS(SELECT 1 FROM import_batch WHERE tenant_id=p_tenant AND entity_id=p_entity AND import_batch_id=p_batch) THEN
    RAISE EXCEPTION 'Inbound batch scope is invalid' USING ERRCODE='42501';
  END IF;
  IF jsonb_typeof(p_groups)<>'array' OR jsonb_array_length(p_groups)=0 THEN
    RAISE EXCEPTION 'Inbound payload groups are required' USING ERRCODE='22023';
  END IF;
  INSERT INTO idempotency_receipt(tenant_id,operation_scope,idempotency_key,request_hash,status,actor_id)
    VALUES(p_tenant,'WBS_INBOUND_SNAPSHOT:'||p_entity,p_idempotency,p_request_hash,'IN_PROGRESS',actor)
    ON CONFLICT DO NOTHING;
  SELECT * INTO rec FROM idempotency_receipt
    WHERE tenant_id=p_tenant AND operation_scope='WBS_INBOUND_SNAPSHOT:'||p_entity AND idempotency_key=p_idempotency FOR UPDATE;
  IF rec.request_hash<>p_request_hash THEN RAISE EXCEPTION 'Idempotency key reused with different request' USING ERRCODE='23505'; END IF;
  IF rec.status='SUCCEEDED' THEN RETURN rec.response_body||jsonb_build_object('idempotent',true); END IF;

  FOR group_item IN SELECT value FROM jsonb_array_elements(p_groups)
  LOOP
    IF jsonb_typeof(group_item)<>'object' OR jsonb_typeof(group_item->'receipt')<>'object' OR jsonb_typeof(group_item->'rows')<>'array' OR jsonb_array_length(group_item->'rows')=0 THEN
      RAISE EXCEPTION 'Inbound payload group is invalid' USING ERRCODE='22023';
    END IF;
    receipt_hash:=group_item->'receipt'->>'payload_hash'; payload_ref:=group_item->'receipt'->>'payload_ref'; group_rows:=group_item->'rows';
    IF receipt_hash !~ '^sha256:[0-9a-f]{64}$' OR payload_ref !~ '^(object|s3)://' OR receipt_hash=ANY(seen_hashes) THEN
      RAISE EXCEPTION 'Inbound payload receipt is invalid or duplicated' USING ERRCODE='22023';
    END IF;
    seen_hashes:=array_append(seen_hashes,receipt_hash);
    INSERT INTO wbs_inbound_receipt(tenant_id,entity_id,import_batch_id,receipt_hash,payload_ref)
      VALUES(p_tenant,p_entity,p_batch,receipt_hash,payload_ref) RETURNING wbs_inbound_receipt.receipt_id INTO receipt_id;
    group_rows_count:=0;
    FOR row_item IN SELECT value FROM jsonb_array_elements(group_rows)
    LOOP
      source_key:=coalesce(row_item->'normalized'->>'source_type','')||E'\x1f'||coalesce(row_item->>'source_record_id','')||E'\x1f'||coalesce(row_item->>'source_version','');
      IF jsonb_typeof(row_item)<>'object' OR coalesce(row_item->>'source_record_id','')='' OR coalesce(row_item->>'source_version','')='' OR coalesce(row_item->'normalized'->>'source_type','')='' OR source_key=ANY(seen_sources)
         OR jsonb_typeof(row_item->'raw')<>'object' OR jsonb_typeof(row_item->'normalized')<>'object'
         OR jsonb_typeof(row_item->'outcome')<>'object' OR coalesce(row_item->>'outcome_kind','') NOT IN ('STAGING','EXCEPTION')
         OR row_item->'normalized'->>'receipt_hash'<>receipt_hash OR row_item->'normalized'->>'receipt_ref'<>payload_ref
         OR row_item->'normalized'->>'source_record_id'<>row_item->>'source_record_id' OR row_item->'normalized'->>'source_version'<>row_item->>'source_version' THEN
        RAISE EXCEPTION 'Inbound row trace is invalid' USING ERRCODE='22023';
      END IF;
      seen_sources:=array_append(seen_sources,source_key);
      INSERT INTO wbs_inbound_row(tenant_id,entity_id,receipt_id,source_record_id,source_version,raw,normalized,outcome,outcome_kind)
        VALUES(p_tenant,p_entity,receipt_id,row_item->>'source_record_id',row_item->>'source_version',row_item->'raw',row_item->'normalized',row_item->'outcome',row_item->>'outcome_kind');
      group_rows_count:=group_rows_count+1; total_rows:=total_rows+1;
    END LOOP;
    result_groups:=result_groups||jsonb_build_array(jsonb_build_object('receipt_id',receipt_id,'receipt_hash',receipt_hash,'payload_ref',payload_ref,'row_count',group_rows_count));
  END LOOP;
  response:=jsonb_build_object('import_batch_id',p_batch,'receipt_group_count',jsonb_array_length(result_groups),'row_count',total_rows,'groups',result_groups,'idempotent',false,'can_create_draft',false,'can_approve',false,'can_post',false);
  event_payload:=jsonb_build_object('import_batch_id',p_batch,'receipt_group_count',jsonb_array_length(result_groups),'row_count',total_rows);
  INSERT INTO audit_event(tenant_id,entity_id,event_type,object_type,object_id,action,actor_id,actor_type,permission_used,request_id,correlation_id,idempotency_key,after_hash,metadata)
    VALUES(p_tenant,p_entity,'WBS_INBOUND_SNAPSHOT_PERSISTED','WBS_INBOUND_SNAPSHOT',p_batch,'PERSIST',actor,'SERVICE_ACCOUNT','WBS.SNAPSHOT.IMPORT',p_idempotency,p_idempotency,p_idempotency,p_request_hash,event_payload);
  INSERT INTO outbox_event(tenant_id,entity_id,aggregate_type,aggregate_id,event_type,payload,payload_hash)
    VALUES(p_tenant,p_entity,'WBS_INBOUND_SNAPSHOT',p_batch,'WBS_INBOUND_SNAPSHOT_PERSISTED',event_payload,refs_jsonb_hash(event_payload));
  UPDATE idempotency_receipt SET status='SUCCEEDED',response_status=201,response_body=response,completed_at=clock_timestamp()
    WHERE tenant_id=p_tenant AND operation_scope='WBS_INBOUND_SNAPSHOT:'||p_entity AND idempotency_key=p_idempotency;
  RETURN response;
END $$;

REVOKE ALL ON FUNCTION refs_persist_wbs_inbound_snapshot_rows(uuid,uuid,uuid,jsonb,text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION refs_persist_wbs_inbound_snapshot_rows(uuid,uuid,uuid,jsonb,text,text) TO refs_app;

COMMIT;
