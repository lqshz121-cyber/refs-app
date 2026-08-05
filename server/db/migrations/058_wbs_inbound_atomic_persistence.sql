BEGIN;
CREATE TABLE wbs_inbound_receipt (
  receipt_id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL REFERENCES tenant(tenant_id), entity_id uuid NOT NULL,
  import_batch_id uuid NOT NULL REFERENCES import_batch(import_batch_id), receipt_hash text NOT NULL CHECK(receipt_hash ~ '^sha256:[0-9a-f]{64}$'), payload_ref text NOT NULL CHECK(payload_ref ~ '^(object|s3)://'), created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE(tenant_id,entity_id,import_batch_id,receipt_hash), FOREIGN KEY(tenant_id,entity_id) REFERENCES entity(tenant_id,entity_id)
);
CREATE TABLE wbs_inbound_row (
  wbs_inbound_row_id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL REFERENCES tenant(tenant_id), entity_id uuid NOT NULL, receipt_id uuid NOT NULL REFERENCES wbs_inbound_receipt(receipt_id),
  source_record_id text NOT NULL, source_version text NOT NULL, raw jsonb NOT NULL CHECK(jsonb_typeof(raw)='object'), normalized jsonb NOT NULL CHECK(jsonb_typeof(normalized)='object'), outcome jsonb NOT NULL CHECK(jsonb_typeof(outcome)='object'),
  outcome_kind text NOT NULL CHECK(outcome_kind IN ('STAGING','EXCEPTION')), created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE(tenant_id,entity_id,receipt_id,source_record_id,source_version), FOREIGN KEY(tenant_id,entity_id) REFERENCES entity(tenant_id,entity_id)
);
ALTER TABLE wbs_inbound_receipt ENABLE ROW LEVEL SECURITY; ALTER TABLE wbs_inbound_row ENABLE ROW LEVEL SECURITY;
CREATE POLICY wbs_inbound_receipt_scope ON wbs_inbound_receipt USING(tenant_id=refs_current_tenant() AND refs_entity_allowed(entity_id)) WITH CHECK(tenant_id=refs_current_tenant() AND refs_entity_allowed(entity_id));
CREATE POLICY wbs_inbound_row_scope ON wbs_inbound_row USING(tenant_id=refs_current_tenant() AND refs_entity_allowed(entity_id)) WITH CHECK(tenant_id=refs_current_tenant() AND refs_entity_allowed(entity_id));
CREATE TRIGGER wbs_inbound_receipt_append_only BEFORE UPDATE OR DELETE ON wbs_inbound_receipt FOR EACH ROW EXECUTE FUNCTION reject_mutation();
CREATE TRIGGER wbs_inbound_row_append_only BEFORE UPDATE OR DELETE ON wbs_inbound_row FOR EACH ROW EXECUTE FUNCTION reject_mutation();
CREATE OR REPLACE FUNCTION refs_persist_wbs_inbound_rows(p_tenant uuid,p_entity uuid,p_batch uuid,p_receipt_hash text,p_payload_ref text,p_rows jsonb,p_idempotency text,p_request_hash text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE rec idempotency_receipt; rid uuid; row jsonb; result jsonb; actor text:=refs_current_actor(); n integer:=0;
BEGIN
 PERFORM refs_assert_scope(p_tenant,p_entity,'WBS.SNAPSHOT.IMPORT'); IF actor IS NULL THEN RAISE EXCEPTION 'Authenticated actor missing' USING ERRCODE='42501'; END IF;
 IF jsonb_typeof(p_rows)<>'array' OR jsonb_array_length(p_rows)=0 THEN RAISE EXCEPTION 'Inbound rows are required' USING ERRCODE='22023'; END IF;
 INSERT INTO idempotency_receipt(tenant_id,operation_scope,idempotency_key,request_hash,status,actor_id) VALUES(p_tenant,'WBS_INBOUND:'||p_entity,p_idempotency,p_request_hash,'IN_PROGRESS',actor) ON CONFLICT DO NOTHING;
 SELECT * INTO rec FROM idempotency_receipt WHERE tenant_id=p_tenant AND operation_scope='WBS_INBOUND:'||p_entity AND idempotency_key=p_idempotency FOR UPDATE;
 IF rec.request_hash<>p_request_hash THEN RAISE EXCEPTION 'Idempotency key reused with different request' USING ERRCODE='23505'; END IF; IF rec.status='SUCCEEDED' THEN RETURN rec.response_body||jsonb_build_object('idempotent',true); END IF;
 INSERT INTO wbs_inbound_receipt(tenant_id,entity_id,import_batch_id,receipt_hash,payload_ref) VALUES(p_tenant,p_entity,p_batch,p_receipt_hash,p_payload_ref) RETURNING receipt_id INTO rid;
 FOR row IN SELECT value FROM jsonb_array_elements(p_rows) LOOP
  IF coalesce(row->>'source_record_id','')='' OR coalesce(row->>'source_version','')='' OR jsonb_typeof(row->'raw')<>'object' OR jsonb_typeof(row->'normalized')<>'object' OR jsonb_typeof(row->'outcome')<>'object' OR coalesce(row->>'outcome_kind','') NOT IN ('STAGING','EXCEPTION') THEN RAISE EXCEPTION 'Inbound row trace is invalid' USING ERRCODE='22023'; END IF;
  INSERT INTO wbs_inbound_row(tenant_id,entity_id,receipt_id,source_record_id,source_version,raw,normalized,outcome,outcome_kind) VALUES(p_tenant,p_entity,rid,row->>'source_record_id',row->>'source_version',row->'raw',row->'normalized',row->'outcome',row->>'outcome_kind'); n:=n+1;
 END LOOP;
 result:=jsonb_build_object('receipt_id',rid,'row_count',n,'idempotent',false,'can_create_draft',false,'can_approve',false,'can_post',false);
 INSERT INTO audit_event(tenant_id,entity_id,event_type,object_type,object_id,action,actor_id,actor_type,permission_used,idempotency_key,after_hash,metadata) VALUES(p_tenant,p_entity,'WBS_INBOUND_PERSISTED','WBS_INBOUND',rid,'PERSIST',actor,'SERVICE_ACCOUNT','WBS.SNAPSHOT.IMPORT',p_idempotency,p_request_hash,jsonb_build_object('row_count',n));
 UPDATE idempotency_receipt SET status='SUCCEEDED',response_status=201,response_body=result,completed_at=clock_timestamp() WHERE tenant_id=p_tenant AND operation_scope='WBS_INBOUND:'||p_entity AND idempotency_key=p_idempotency; RETURN result;
END $$;
REVOKE ALL ON FUNCTION refs_persist_wbs_inbound_rows(uuid,uuid,uuid,text,text,jsonb,text,text) FROM PUBLIC; GRANT EXECUTE ON FUNCTION refs_persist_wbs_inbound_rows(uuid,uuid,uuid,text,text,jsonb,text,text) TO refs_app;
COMMIT;
