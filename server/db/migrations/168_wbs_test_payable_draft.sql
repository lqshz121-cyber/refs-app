BEGIN;

-- This permission is intentionally separate from Provider admission. It may
-- exist only on the controlled staging tenant and never implies signature,
-- Object Lock, attachment-upload, review, approval, or posting authority.
INSERT INTO permission_catalog(permission_code,domain,risk_class,sod_class)
VALUES('WBS.TEST.IMPORT','WBS','HIGH','WBS_TEST_IMPORTER')
ON CONFLICT(permission_code) DO UPDATE SET domain=EXCLUDED.domain,active=true,
  risk_class=EXCLUDED.risk_class,sod_class=EXCLUDED.sod_class,effective_to=NULL;

CREATE TABLE wbs_test_import_draft (
  wbs_test_import_draft_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  entity_id uuid NOT NULL,
  period_id uuid NOT NULL,
  observation_hash text NOT NULL CHECK(observation_hash~'^sha256:[0-9a-f]{64}$'),
  source_record_hash text NOT NULL CHECK(source_record_hash~'^sha256:[0-9a-f]{64}$'),
  provider_content_sha256 text NOT NULL CHECK(provider_content_sha256~'^[0-9a-f]{64}$'),
  row_index integer NOT NULL CHECK(row_index BETWEEN 0 AND 9),
  import_batch_id uuid NOT NULL,
  raw_event_id uuid NOT NULL,
  source_document_id uuid NOT NULL,
  source_document_line_id uuid NOT NULL,
  attachment_id uuid NOT NULL,
  business_document_id uuid NOT NULL,
  journal_entry_id uuid NOT NULL,
  request_hash text NOT NULL CHECK(request_hash~'^sha256:[0-9a-f]{64}$'),
  created_by text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  test_only boolean NOT NULL DEFAULT true CHECK(test_only),
  provenance_mode text NOT NULL DEFAULT 'UNSIGNED_TEST_ONLY' CHECK(provenance_mode='UNSIGNED_TEST_ONLY'),
  UNIQUE(tenant_id,entity_id,observation_hash,source_record_hash),
  UNIQUE(tenant_id,entity_id,wbs_test_import_draft_id),
  FOREIGN KEY(tenant_id,entity_id) REFERENCES entity(tenant_id,entity_id),
  FOREIGN KEY(tenant_id,entity_id,period_id) REFERENCES accounting_period(tenant_id,entity_id,period_id),
  FOREIGN KEY(tenant_id,import_batch_id) REFERENCES import_batch(tenant_id,import_batch_id),
  FOREIGN KEY(tenant_id,raw_event_id) REFERENCES raw_event(tenant_id,raw_event_id),
  FOREIGN KEY(tenant_id,entity_id,source_document_id) REFERENCES source_document(tenant_id,entity_id,source_document_id),
  FOREIGN KEY(tenant_id,entity_id,source_document_line_id) REFERENCES source_document_line(tenant_id,entity_id,source_document_line_id),
  FOREIGN KEY(tenant_id,entity_id,attachment_id) REFERENCES attachment(tenant_id,entity_id,attachment_id),
  FOREIGN KEY(tenant_id,entity_id,business_document_id) REFERENCES business_document(tenant_id,entity_id,business_document_id),
  FOREIGN KEY(tenant_id,entity_id,journal_entry_id) REFERENCES journal_entry(tenant_id,entity_id,journal_entry_id)
);
ALTER TABLE wbs_test_import_draft ENABLE ROW LEVEL SECURITY;
CREATE POLICY wbs_test_import_draft_scope ON wbs_test_import_draft
  USING(tenant_id=refs_current_tenant() AND refs_entity_allowed(entity_id))
  WITH CHECK(tenant_id=refs_current_tenant() AND refs_entity_allowed(entity_id));
CREATE TRIGGER wbs_test_import_draft_append_only BEFORE UPDATE OR DELETE ON wbs_test_import_draft
  FOR EACH ROW EXECUTE FUNCTION reject_mutation();

CREATE FUNCTION refs_create_wbs_test_payable_draft_hash(
  p_tenant uuid,p_entity uuid,p_period uuid,p_observation jsonb,p_row jsonb,p_row_index integer
) RETURNS text LANGUAGE sql IMMUTABLE SET search_path=pg_catalog,public,pg_temp AS $$
  SELECT refs_jsonb_hash(jsonb_build_object('tenant_id',p_tenant,'entity_id',p_entity,'period_id',p_period,
    'observation',p_observation,'row',p_row,'row_index',p_row_index,'test_only',true,'provenance_mode','UNSIGNED_TEST_ONLY'))
$$;

CREATE FUNCTION refs_create_wbs_test_payable_draft(
  p_tenant uuid,p_entity uuid,p_period uuid,p_observation jsonb,p_row jsonb,p_row_index integer,
  p_idempotency_key text,p_request_hash text
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE actor text:=refs_current_actor();idem idempotency_receipt;entity_row entity;prior wbs_test_import_draft;
DECLARE v_source_hash text;v_observation_hash text;v_provider_hash text;source_accounting_date date;posting_date date;period_row accounting_period;amount numeric(20,4);currency text;
DECLARE source_record_id text;source_version text;source_ref text;document_number text;vendor_ref text:='WBS_TEST_VENDOR';vendor_name text:='WBS Test Vendor';
DECLARE batch_id uuid:=gen_random_uuid();raw_id uuid:=gen_random_uuid();source_id uuid:=gen_random_uuid();line_id uuid:=gen_random_uuid();attachment_id uuid:=gen_random_uuid();trace_id uuid:=gen_random_uuid();
DECLARE document_hash text;document_result jsonb;business_id uuid;journal_id uuid;response jsonb;event_payload jsonb;inner_hash text;
BEGIN
  PERFORM refs_assert_scope(p_tenant,p_entity,'WBS.TEST.IMPORT');
  IF actor IS NULL THEN RAISE EXCEPTION 'Authenticated WBS test importer missing' USING ERRCODE='42501'; END IF;
  IF p_request_hash<>refs_create_wbs_test_payable_draft_hash(p_tenant,p_entity,p_period,p_observation,p_row,p_row_index)
     OR p_idempotency_key IS NULL OR length(p_idempotency_key) NOT BETWEEN 8 AND 160 THEN
    RAISE EXCEPTION 'WBS test import request is not canonical' USING ERRCODE='22023';
  END IF;
  IF jsonb_typeof(p_observation)<>'object' OR jsonb_typeof(p_row)<>'object'
     OR p_observation->>'schema_version'<>'WBS_LIVE_PILOT_OBSERVATION_V1'
     OR p_observation->>'status'<>'NOT_ADMITTED' OR p_observation->>'observation_mode'<>'UNSIGNED_PILOT'
     OR p_observation->>'source_system'<>'WBS' OR p_observation->>'tool'<>'list_payables'
     OR p_observation->>'environment'<>'PRODUCTION' OR p_observation->>'entity_id'<>p_entity::text
     OR p_observation->>'signature_verified'<>'false' OR p_observation->>'can_import'<>'false'
     OR p_observation->>'can_create_transaction'<>'false' OR p_observation->>'can_create_draft'<>'false'
     OR p_observation->>'can_approve'<>'false' OR p_observation->>'can_post'<>'false'
     OR jsonb_typeof(p_observation->'rows')<>'array' OR (p_observation->>'record_count')!~'^[1-9][0-9]*$'
     OR (p_observation->>'record_count')::integer<>jsonb_array_length(p_observation->'rows')
     OR jsonb_array_length(p_observation->'rows')>10 OR p_row_index<0 OR p_row_index>=jsonb_array_length(p_observation->'rows')
     OR p_observation->'rows'->p_row_index IS DISTINCT FROM p_row THEN
    RAISE EXCEPTION 'Only one exact sanitized unsigned Payable pilot row may enter the test importer' USING ERRCODE='22023';
  END IF;
  IF (p_observation-'schema_version'-'status'-'observation_mode'-'source_system'-'tool'-'environment'-'entity_id'-'captured_at'-'provider_content_sha256'-'scope'-'record_count'-'rows'-'signature_verified'-'can_import'-'can_create_transaction'-'can_match'-'can_allocate'-'can_create_draft'-'can_approve'-'can_post'-'can_reverse'-'observation_hash')<>'{}'::jsonb
     OR (p_row-'source_record_hash'-'currency'-'accounting_date'-'amount'-'status')<>'{}'::jsonb THEN
    RAISE EXCEPTION 'WBS test import accepts only the closed sanitized Pilot schema' USING ERRCODE='22023';
  END IF;
  v_source_hash:=p_row->>'source_record_hash';v_observation_hash:=p_observation->>'observation_hash';v_provider_hash:=p_observation->>'provider_content_sha256';
  currency:=p_row->>'currency';
  IF v_source_hash!~'^sha256:[0-9a-f]{64}$' OR v_observation_hash!~'^sha256:[0-9a-f]{64}$' OR v_provider_hash!~'^[0-9a-f]{64}$'
     OR currency!~'^[A-Z]{3}$' OR COALESCE(p_row->>'amount','')!~'^(0|[1-9][0-9]{0,15})\.[0-9]{4}$'
     OR (p_row->>'amount')::numeric<=0 OR COALESCE(p_row->>'accounting_date','')!~'^[0-9]{4}-[0-9]{2}-[0-9]{2}$' THEN
    RAISE EXCEPTION 'Sanitized WBS test Payable facts are invalid' USING ERRCODE='22023';
  END IF;
  BEGIN source_accounting_date:=(p_row->>'accounting_date')::date; EXCEPTION WHEN OTHERS THEN RAISE EXCEPTION 'Sanitized WBS test accounting date is invalid' USING ERRCODE='22023'; END;
  IF source_accounting_date::text<>p_row->>'accounting_date' THEN RAISE EXCEPTION 'Sanitized WBS test accounting date is invalid' USING ERRCODE='22023'; END IF;
  amount:=(p_row->>'amount')::numeric(20,4);
  SELECT * INTO entity_row FROM entity WHERE tenant_id=p_tenant AND entity_id=p_entity AND active FOR SHARE;
  IF NOT FOUND OR entity_row.base_currency<>currency THEN RAISE EXCEPTION 'WBS test import entity or currency scope is invalid' USING ERRCODE='42501'; END IF;
  SELECT * INTO period_row FROM accounting_period WHERE tenant_id=p_tenant AND entity_id=p_entity AND period_id=p_period AND status='OPEN' FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'WBS test import requires the exact OPEN accounting period' USING ERRCODE='55000'; END IF;
  posting_date:=greatest(period_row.starts_on,least(source_accounting_date,period_row.ends_on));

  INSERT INTO idempotency_receipt(tenant_id,operation_scope,idempotency_key,request_hash,status,actor_id)
    VALUES(p_tenant,'WBS_TEST_IMPORT:'||p_entity,p_idempotency_key,p_request_hash,'IN_PROGRESS',actor) ON CONFLICT DO NOTHING;
  SELECT * INTO idem FROM idempotency_receipt WHERE tenant_id=p_tenant AND operation_scope='WBS_TEST_IMPORT:'||p_entity AND idempotency_key=p_idempotency_key FOR UPDATE;
  IF idem.request_hash<>p_request_hash OR idem.actor_id<>actor THEN RAISE EXCEPTION 'WBS test import idempotency conflict' USING ERRCODE='23505'; END IF;
  IF idem.status='SUCCEEDED' THEN RETURN idem.response_body||jsonb_build_object('idempotent',true); END IF;
  SELECT * INTO prior FROM wbs_test_import_draft d WHERE d.tenant_id=p_tenant AND d.entity_id=p_entity
    AND d.observation_hash=p_observation->>'observation_hash' AND d.source_record_hash=p_row->>'source_record_hash' FOR SHARE;
  IF FOUND THEN
    response:=jsonb_build_object('business_document_id',prior.business_document_id,'journal_entry_id',prior.journal_entry_id,'source_document_id',prior.source_document_id,'attachment_id',prior.attachment_id,'status','DRAFT','revision',0,'idempotent',true,'test_only',true,'provenance_mode','UNSIGNED_TEST_ONLY');
    UPDATE idempotency_receipt SET status='SUCCEEDED',response_status=200,response_body=response,completed_at=clock_timestamp() WHERE idempotency_receipt_id=idem.idempotency_receipt_id;
    RETURN response;
  END IF;

  INSERT INTO member_master(tenant_id,entity_id,member_ref,member_type,display_name,active) VALUES(p_tenant,p_entity,vendor_ref,'VENDOR',vendor_name,true) ON CONFLICT DO NOTHING;
  PERFORM 1 FROM member_master WHERE tenant_id=p_tenant AND entity_id=p_entity AND member_ref=vendor_ref AND member_type='VENDOR' AND active FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'WBS test vendor conflicts with existing master data' USING ERRCODE='23514'; END IF;
  INSERT INTO account_master(tenant_id,entity_id,account_code,account_name,requires_member,required_member_type,active) VALUES(p_tenant,p_entity,'610000','WBS Test Operating Expense',false,NULL,true) ON CONFLICT DO NOTHING;
  PERFORM 1 FROM account_master WHERE tenant_id=p_tenant AND entity_id=p_entity AND account_code='610000' AND active AND NOT requires_member FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'WBS test expense account conflicts with existing master data' USING ERRCODE='23514'; END IF;
  PERFORM 1 FROM account_master WHERE tenant_id=p_tenant AND entity_id=p_entity AND account_code='291001' AND active AND requires_member AND required_member_type='VENDOR' FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'WBS test import requires the existing AP control account 291001' USING ERRCODE='23503'; END IF;

  source_record_id:='test:'||substr(v_source_hash,8,16)||':'||substr(v_observation_hash,8,16);source_version:='test:'||substr(v_observation_hash,8);source_ref:='object://refs-test-only/'||p_entity||'/'||substr(v_source_hash,8);
  document_number:='WBS-TEST-'||upper(substr(v_source_hash,8,16));document_hash:=v_source_hash;
  INSERT INTO import_batch(import_batch_id,tenant_id,entity_id,connector_code,source_module,source_entity_id,idempotency_key,request_hash,status,row_count,started_at,completed_at)
    VALUES(batch_id,p_tenant,p_entity,'WBS_TEST','payable',entity_row.source_entity_id,p_idempotency_key,p_request_hash,'SUCCEEDED',1,clock_timestamp(),clock_timestamp());
  INSERT INTO raw_event(raw_event_id,tenant_id,entity_id,import_batch_id,source_system,source_module,source_entity_id,source_record_id,source_version,event_type,occurred_at,payload_hash,payload_ref,correlation_id)
    VALUES(raw_id,p_tenant,p_entity,batch_id,'WBS','payable',entity_row.source_entity_id,source_record_id,source_version,'UPSERT',source_accounting_date::timestamptz,document_hash,source_ref,p_idempotency_key);
  INSERT INTO source_document(source_document_id,tenant_id,entity_id,raw_event_id,source_system,source_module,source_entity_id,source_record_id,source_version,document_type,document_no,business_date,accounting_date,currency,gross_amount,status,source_ref,payload_hash)
    VALUES(source_id,p_tenant,p_entity,raw_id,'WBS','payable',entity_row.source_entity_id,source_record_id,source_version,'WBS_TEST_PAYABLE',document_number,source_accounting_date,posting_date,currency,amount,'READY_FOR_DRAFT',source_ref,document_hash);
  INSERT INTO source_document_line(source_document_line_id,tenant_id,entity_id,source_document_id,source_line_id,line_no,amount,direction,description,party_ref,external_dimension_refs)
    VALUES(line_id,p_tenant,p_entity,source_id,source_record_id,1,amount,'NONE','Sanitized unsigned WBS test payable',vendor_ref,
      jsonb_build_object('schema_version','WBS_TEST_IMPORT_LINE_V1','test_only',true,'provenance_mode','UNSIGNED_TEST_ONLY','observation_hash',v_observation_hash,'source_record_hash',v_source_hash,'provider_content_sha256',v_provider_hash,'row_index',p_row_index,'original_accounting_date',source_accounting_date,'posting_accounting_date',posting_date));
  INSERT INTO attachment(attachment_id,tenant_id,entity_id,name,media_type,size_bytes,content_hash,storage_ref,storage_version,uploaded_by,uploaded_at,verified_at,scan_status,finalization_status,finalized_at)
    VALUES(attachment_id,p_tenant,p_entity,document_number||'.txt','text/csv',1,v_source_hash,source_ref||'/test-evidence','test-only:'||substr(v_observation_hash,8),actor,clock_timestamp(),clock_timestamp(),'CLEAN','VERIFIED_CLEAN',clock_timestamp());
  INSERT INTO source_link(tenant_id,entity_id,link_type,raw_event_id,source_document_id,source_document_line_id,created_by)
    VALUES(p_tenant,p_entity,'WBS_TEST_SOURCE',raw_id,source_id,line_id,actor);
  INSERT INTO source_link(tenant_id,entity_id,link_type,source_document_id,attachment_id,created_by)
    VALUES(p_tenant,p_entity,'SOURCE_ATTACHMENT',source_id,attachment_id,actor);

  inner_hash:=refs_create_business_document_hash(p_tenant,p_entity,'AP_BILL',p_period,document_number,vendor_ref,vendor_name,currency,posting_date,posting_date,amount,'610000','UNSIGNED TEST ONLY WBS Payable',ARRAY[attachment_id]);
  document_result:=refs_create_business_document(p_tenant,p_entity,'AP_BILL',p_period,document_number,vendor_ref,vendor_name,currency,posting_date,posting_date,amount,'610000','UNSIGNED TEST ONLY WBS Payable',ARRAY[attachment_id],'wbs-test-doc:'||p_idempotency_key,inner_hash);
  business_id:=(document_result->>'business_document_id')::uuid;journal_id:=(document_result->>'journal_entry_id')::uuid;
  UPDATE business_document SET source_document_id=source_id WHERE tenant_id=p_tenant AND entity_id=p_entity AND business_document_id=business_id AND source_document_id IS NULL;
  IF NOT FOUND THEN RAISE EXCEPTION 'WBS test business document lineage could not be frozen' USING ERRCODE='23514'; END IF;
  INSERT INTO source_link(tenant_id,entity_id,link_type,source_document_id,journal_entry_id,created_by) VALUES(p_tenant,p_entity,'SOURCE_TO_JE',source_id,journal_id,actor);
  INSERT INTO wbs_test_import_draft(wbs_test_import_draft_id,tenant_id,entity_id,period_id,observation_hash,source_record_hash,provider_content_sha256,row_index,import_batch_id,raw_event_id,source_document_id,source_document_line_id,attachment_id,business_document_id,journal_entry_id,request_hash,created_by)
    VALUES(trace_id,p_tenant,p_entity,p_period,v_observation_hash,v_source_hash,v_provider_hash,p_row_index,batch_id,raw_id,source_id,line_id,attachment_id,business_id,journal_id,p_request_hash,actor);
  event_payload:=jsonb_build_object('wbs_test_import_draft_id',trace_id,'business_document_id',business_id,'journal_entry_id',journal_id,'source_document_id',source_id,'attachment_id',attachment_id,'status','DRAFT','test_only',true,'provenance_mode','UNSIGNED_TEST_ONLY');
  INSERT INTO audit_event(tenant_id,entity_id,event_type,object_type,object_id,action,actor_id,actor_type,permission_used,request_id,correlation_id,idempotency_key,after_hash,reason,metadata)
    VALUES(p_tenant,p_entity,'WBS_TEST_PAYABLE_DRAFT_CREATED','WBS_TEST_IMPORT',trace_id,'CREATE_TEST_DRAFT',actor,'USER','WBS.TEST.IMPORT',p_idempotency_key,p_idempotency_key,p_idempotency_key,p_request_hash,'Explicitly authorized unsigned test-only WBS import',event_payload);
  INSERT INTO outbox_event(tenant_id,entity_id,aggregate_type,aggregate_id,event_type,payload,payload_hash)
    VALUES(p_tenant,p_entity,'WBS_TEST_IMPORT',trace_id,'WBS_TEST_PAYABLE_DRAFT_CREATED',event_payload,refs_jsonb_hash(event_payload));
  response:=jsonb_build_object('business_document_id',business_id,'journal_entry_id',journal_id,'source_document_id',source_id,'attachment_id',attachment_id,'status','DRAFT','revision',0,'idempotent',false,'test_only',true,'provenance_mode','UNSIGNED_TEST_ONLY');
  UPDATE idempotency_receipt SET status='SUCCEEDED',response_status=201,response_body=response,completed_at=clock_timestamp() WHERE idempotency_receipt_id=idem.idempotency_receipt_id;
  RETURN response;
END $$;

CREATE FUNCTION refs_finalize_wbs_test_import_source_hash(
  p_tenant uuid,p_entity uuid,p_source_document uuid,p_business_document uuid,p_journal_entry uuid
) RETURNS text LANGUAGE sql IMMUTABLE SET search_path=pg_catalog,public,pg_temp AS $$
  SELECT refs_jsonb_hash(jsonb_build_object('tenant_id',p_tenant,'entity_id',p_entity,
    'source_document_id',p_source_document,'business_document_id',p_business_document,
    'journal_entry_id',p_journal_entry,'status','POSTED','test_only',true))
$$;

CREATE FUNCTION refs_finalize_wbs_test_import_source(
  p_tenant uuid,p_entity uuid,p_source_document uuid,p_business_document uuid,p_journal_entry uuid,
  p_idempotency_key text,p_request_hash text
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE actor text:=refs_current_actor();idem idempotency_receipt;trace wbs_test_import_draft;
DECLARE source_state source_status;business_state text;journal_state journal_status;response jsonb;event_payload jsonb;
BEGIN
  PERFORM refs_assert_scope(p_tenant,p_entity,'WBS.TEST.IMPORT');
  IF actor IS NULL THEN RAISE EXCEPTION 'Authenticated WBS test importer missing' USING ERRCODE='42501'; END IF;
  IF p_request_hash<>refs_finalize_wbs_test_import_source_hash(p_tenant,p_entity,p_source_document,p_business_document,p_journal_entry)
     OR p_idempotency_key IS NULL OR length(p_idempotency_key) NOT BETWEEN 8 AND 160 THEN
    RAISE EXCEPTION 'WBS test source finalization request is not canonical' USING ERRCODE='22023';
  END IF;
  SELECT * INTO trace FROM wbs_test_import_draft WHERE tenant_id=p_tenant AND entity_id=p_entity
    AND source_document_id=p_source_document AND business_document_id=p_business_document AND journal_entry_id=p_journal_entry FOR SHARE;
  IF NOT FOUND OR NOT trace.test_only OR trace.provenance_mode<>'UNSIGNED_TEST_ONLY' THEN
    RAISE EXCEPTION 'WBS test source finalization identity is invalid' USING ERRCODE='23514';
  END IF;
  SELECT status INTO source_state FROM source_document WHERE tenant_id=p_tenant AND entity_id=p_entity AND source_document_id=p_source_document FOR UPDATE;
  SELECT status INTO business_state FROM business_document WHERE tenant_id=p_tenant AND entity_id=p_entity AND business_document_id=p_business_document FOR SHARE;
  SELECT status INTO journal_state FROM journal_entry WHERE tenant_id=p_tenant AND entity_id=p_entity AND journal_entry_id=p_journal_entry FOR SHARE;
  IF source_state NOT IN ('READY_FOR_DRAFT','POSTED') OR business_state<>'OPEN' OR journal_state<>'POSTED' THEN
    RAISE EXCEPTION 'WBS test source may be finalized only after the exact business document and journal are posted' USING ERRCODE='55000';
  END IF;
  INSERT INTO idempotency_receipt(tenant_id,operation_scope,idempotency_key,request_hash,status,actor_id)
    VALUES(p_tenant,'WBS_TEST_FINALIZE:'||p_entity,p_idempotency_key,p_request_hash,'IN_PROGRESS',actor) ON CONFLICT DO NOTHING;
  SELECT * INTO idem FROM idempotency_receipt WHERE tenant_id=p_tenant AND operation_scope='WBS_TEST_FINALIZE:'||p_entity AND idempotency_key=p_idempotency_key FOR UPDATE;
  IF idem.request_hash<>p_request_hash OR idem.actor_id<>actor THEN RAISE EXCEPTION 'WBS test source finalization idempotency conflict' USING ERRCODE='23505'; END IF;
  IF idem.status='SUCCEEDED' THEN RETURN idem.response_body||jsonb_build_object('idempotent',true); END IF;
  IF source_state='POSTED' THEN RAISE EXCEPTION 'WBS test source was finalized without the matching receipt' USING ERRCODE='23514'; END IF;
  UPDATE source_document SET status='POSTED',version=version+1,updated_at=clock_timestamp()
    WHERE tenant_id=p_tenant AND entity_id=p_entity AND source_document_id=p_source_document AND status='READY_FOR_DRAFT';
  IF NOT FOUND THEN RAISE EXCEPTION 'WBS test source finalization lost its compare-and-swap' USING ERRCODE='40001'; END IF;
  response:=jsonb_build_object('status','POSTED','test_only',true,'idempotent',false);
  event_payload:=jsonb_build_object('wbs_test_import_draft_id',trace.wbs_test_import_draft_id,'source_document_id',p_source_document,
    'business_document_id',p_business_document,'journal_entry_id',p_journal_entry,'status','POSTED','test_only',true);
  INSERT INTO audit_event(tenant_id,entity_id,event_type,object_type,object_id,action,actor_id,actor_type,permission_used,request_id,correlation_id,idempotency_key,after_hash,reason,metadata)
    VALUES(p_tenant,p_entity,'WBS_TEST_SOURCE_POSTED','SOURCE_DOCUMENT',p_source_document,'FINALIZE_TEST_SOURCE',actor,'USER','WBS.TEST.IMPORT',p_idempotency_key,p_idempotency_key,p_idempotency_key,p_request_hash,'Exact test-only WBS Draft completed the independent accounting workflow',event_payload);
  INSERT INTO outbox_event(tenant_id,entity_id,aggregate_type,aggregate_id,event_type,payload,payload_hash)
    VALUES(p_tenant,p_entity,'SOURCE_DOCUMENT',p_source_document,'WBS_TEST_SOURCE_POSTED',event_payload,refs_jsonb_hash(event_payload));
  UPDATE idempotency_receipt SET status='SUCCEEDED',response_status=200,response_body=response,completed_at=clock_timestamp()
    WHERE idempotency_receipt_id=idem.idempotency_receipt_id;
  RETURN response;
END $$;

REVOKE ALL ON wbs_test_import_draft FROM PUBLIC,refs_app;
GRANT SELECT ON wbs_test_import_draft TO refs_app;
REVOKE EXECUTE ON FUNCTION refs_create_wbs_test_payable_draft_hash(uuid,uuid,uuid,jsonb,jsonb,integer) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION refs_create_wbs_test_payable_draft(uuid,uuid,uuid,jsonb,jsonb,integer,text,text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION refs_finalize_wbs_test_import_source_hash(uuid,uuid,uuid,uuid,uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION refs_finalize_wbs_test_import_source(uuid,uuid,uuid,uuid,uuid,text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION refs_create_wbs_test_payable_draft_hash(uuid,uuid,uuid,jsonb,jsonb,integer) TO refs_app;
GRANT EXECUTE ON FUNCTION refs_create_wbs_test_payable_draft(uuid,uuid,uuid,jsonb,jsonb,integer,text,text) TO refs_app;
GRANT EXECUTE ON FUNCTION refs_finalize_wbs_test_import_source_hash(uuid,uuid,uuid,uuid,uuid) TO refs_app;
GRANT EXECUTE ON FUNCTION refs_finalize_wbs_test_import_source(uuid,uuid,uuid,uuid,uuid,text,text) TO refs_app;

COMMIT;
