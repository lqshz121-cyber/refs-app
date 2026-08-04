BEGIN;

CREATE OR REPLACE FUNCTION refs_record_wbs_snapshot_receipts(
  p_tenant uuid,p_entity uuid,p_snapshot uuid,p_captured_at timestamptz,p_environment text,
  p_dictionary_version text,p_package_hash text,p_receipts jsonb,p_idempotency_key text,p_request_hash text
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE actor text:=refs_current_actor(); receipt idempotency_receipt; computed_hash text; batch_id uuid:=gen_random_uuid(); snapshot_import_id uuid:=gen_random_uuid();
DECLARE entity_source_system text; entity_source_id text; item jsonb; event_payload jsonb; response jsonb; count_rows integer:=0;
DECLARE item_module text; item_entity text; item_record text; item_version text; item_payload_hash text; item_payload_ref text; item_kind text; item_receipt_hash text;
BEGIN
  PERFORM refs_assert_scope(p_tenant,p_entity,'WBS.SNAPSHOT.IMPORT');
  IF actor IS NULL THEN RAISE EXCEPTION 'Authenticated actor missing' USING ERRCODE='42501'; END IF;
  computed_hash:=refs_wbs_snapshot_import_hash(p_tenant,p_entity,p_snapshot,p_captured_at,p_environment,p_dictionary_version,p_package_hash,p_receipts);
  IF p_request_hash<>computed_hash THEN RAISE EXCEPTION 'WBS snapshot request hash is not canonical' USING ERRCODE='22023'; END IF;
  INSERT INTO idempotency_receipt(tenant_id,operation_scope,idempotency_key,request_hash,status,actor_id)
    VALUES(p_tenant,'WBS_SNAPSHOT_IMPORT:'||p_entity,p_idempotency_key,p_request_hash,'IN_PROGRESS',actor)
    ON CONFLICT (tenant_id,operation_scope,idempotency_key) DO NOTHING;
  SELECT * INTO receipt FROM idempotency_receipt
    WHERE tenant_id=p_tenant AND operation_scope='WBS_SNAPSHOT_IMPORT:'||p_entity AND idempotency_key=p_idempotency_key
    FOR UPDATE;
  IF receipt.request_hash<>p_request_hash THEN RAISE EXCEPTION 'Idempotency key reused with different request hash' USING ERRCODE='23505'; END IF;
  IF receipt.status='SUCCEEDED' THEN RETURN receipt.response_body||jsonb_build_object('idempotent',true); END IF;
  IF p_captured_at>clock_timestamp()+interval '5 minutes' OR upper(btrim(p_environment)) NOT IN ('SANDBOX','PRODUCTION')
     OR length(btrim(p_dictionary_version))=0 OR p_package_hash !~ '^sha256:[0-9a-f]{64}$'
     OR jsonb_typeof(p_receipts)<>'array' OR jsonb_array_length(p_receipts)=0 THEN
    RAISE EXCEPTION 'WBS snapshot metadata is invalid' USING ERRCODE='22023';
  END IF;
  SELECT source_system,source_entity_id INTO entity_source_system,entity_source_id
    FROM entity WHERE tenant_id=p_tenant AND entity_id=p_entity FOR SHARE;
  IF NOT FOUND OR entity_source_system<>'WBS' THEN RAISE EXCEPTION 'WBS snapshot entity scope is invalid' USING ERRCODE='42501'; END IF;
  INSERT INTO import_batch(import_batch_id,tenant_id,entity_id,connector_code,source_module,source_entity_id,idempotency_key,request_hash,status,row_count,started_at,completed_at)
    VALUES(batch_id,p_tenant,p_entity,'WBS_SNAPSHOT','snapshot_observation',entity_source_id,p_idempotency_key,p_request_hash,'SUCCEEDED',jsonb_array_length(p_receipts),clock_timestamp(),clock_timestamp());
  INSERT INTO wbs_snapshot_import(wbs_snapshot_import_id,tenant_id,entity_id,snapshot_id,captured_at,environment,dictionary_version,package_hash,import_batch_id,created_by)
    VALUES(snapshot_import_id,p_tenant,p_entity,p_snapshot,p_captured_at,upper(btrim(p_environment)),btrim(p_dictionary_version),p_package_hash,batch_id,actor);
  FOR item IN SELECT value FROM jsonb_array_elements(p_receipts)
  LOOP
    item_module:=item->>'source_module'; item_entity:=item->>'source_entity_id'; item_record:=item->>'source_record_id'; item_version:=item->>'source_version';
    item_payload_hash:=item->>'payload_hash'; item_payload_ref:=item->>'payload_ref'; item_kind:=item->>'ingestion_kind';
    IF item->>'snapshot_id'<>p_snapshot::text OR item->>'source_system'<>'WBS' OR item_entity<>entity_source_id
       OR item_module IS NULL OR length(btrim(item_module))=0 OR item_record IS NULL OR length(btrim(item_record))=0
       OR item_version !~ ('^snapshot:'||p_snapshot::text||':') OR item_payload_hash !~ '^sha256:[0-9a-f]{64}$'
       OR item_payload_ref !~ '^object://wbs-snapshot/' OR item_kind NOT IN ('TRANSACTION_CANDIDATE','AUTOREC_CANDIDATE','CONTROL_SOURCE','LEDGER_EVIDENCE','CONTROL_EVIDENCE') THEN
      RAISE EXCEPTION 'WBS snapshot receipt is invalid or outside entity scope' USING ERRCODE='22023';
    END IF;
    item_receipt_hash:=refs_jsonb_hash(item);
    INSERT INTO wbs_snapshot_receipt(tenant_id,entity_id,wbs_snapshot_import_id,source_module,source_entity_id,source_record_id,source_version,payload_hash,payload_ref,ingestion_kind,receipt_hash)
      VALUES(p_tenant,p_entity,snapshot_import_id,item_module,item_entity,item_record,item_version,item_payload_hash,item_payload_ref,item_kind,item_receipt_hash);
    count_rows:=count_rows+1;
  END LOOP;
  event_payload:=jsonb_build_object('snapshot_id',p_snapshot,'import_batch_id',batch_id,'package_hash',p_package_hash,'receipt_count',count_rows,'environment',upper(btrim(p_environment)));
  INSERT INTO audit_event(tenant_id,entity_id,event_type,object_type,object_id,action,actor_id,actor_type,permission_used,request_id,correlation_id,idempotency_key,after_hash,metadata)
    VALUES(p_tenant,p_entity,'WBS_SNAPSHOT_OBSERVED','WBS_SNAPSHOT',snapshot_import_id,'IMPORT',actor,'SERVICE_ACCOUNT','WBS.SNAPSHOT.IMPORT',p_idempotency_key,p_idempotency_key,p_idempotency_key,refs_jsonb_hash(event_payload),jsonb_build_object('snapshot_id',p_snapshot,'receipt_count',count_rows,'environment',upper(btrim(p_environment))));
  INSERT INTO outbox_event(tenant_id,entity_id,aggregate_type,aggregate_id,event_type,payload,payload_hash)
    VALUES(p_tenant,p_entity,'WBS_SNAPSHOT',snapshot_import_id,'WBS_SNAPSHOT_OBSERVED',event_payload,refs_jsonb_hash(event_payload));
  response:=jsonb_build_object('wbs_snapshot_import_id',snapshot_import_id,'import_batch_id',batch_id,'snapshot_id',p_snapshot,'receipt_count',count_rows,'idempotent',false);
  UPDATE idempotency_receipt SET status='SUCCEEDED',response_status=201,response_body=response,completed_at=clock_timestamp()
    WHERE tenant_id=p_tenant AND operation_scope='WBS_SNAPSHOT_IMPORT:'||p_entity AND idempotency_key=p_idempotency_key;
  RETURN response;
END;
$$;

COMMIT;
