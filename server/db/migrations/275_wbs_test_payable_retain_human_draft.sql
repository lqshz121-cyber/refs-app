BEGIN;

-- WBS.TEST.IMPORT is a SERVICE-only ingestion permission after migration 274.
-- It may retain an unsigned TEST_ONLY source receipt, but it must never create
-- an AP business document or journal.  A separate AP.BILL.CREATE human maker
-- consumes the exact immutable receipt and stops at ordinary Draft.
CREATE TABLE wbs_test_payable_source_receipt (
  wbs_test_payable_source_receipt_id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL,
  entity_id uuid NOT NULL,
  period_id uuid NOT NULL,
  observation_hash text NOT NULL CHECK(observation_hash~'^sha256:[0-9a-f]{64}$'),
  source_record_hash text NOT NULL CHECK(source_record_hash~'^sha256:[0-9a-f]{64}$'),
  provider_content_sha256 text NOT NULL CHECK(provider_content_sha256~'^[0-9a-f]{64}$'),
  row_index integer NOT NULL CHECK(row_index BETWEEN 0 AND 9),
  source_accounting_date date NOT NULL,
  posting_accounting_date date NOT NULL,
  currency char(3) NOT NULL CHECK(currency~'^[A-Z]{3}$'),
  amount numeric(20,4) NOT NULL CHECK(amount>0),
  document_number text NOT NULL,
  import_batch_id uuid NOT NULL,
  raw_event_id uuid NOT NULL,
  source_document_id uuid NOT NULL,
  source_document_line_id uuid NOT NULL,
  attachment_id uuid NOT NULL,
  receipt_hash text NOT NULL CHECK(receipt_hash~'^sha256:[0-9a-f]{64}$'),
  created_by text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  test_only boolean NOT NULL DEFAULT true CHECK(test_only),
  provenance_mode text NOT NULL DEFAULT 'UNSIGNED_TEST_ONLY' CHECK(provenance_mode='UNSIGNED_TEST_ONLY'),
  UNIQUE(tenant_id,entity_id,wbs_test_payable_source_receipt_id),
  UNIQUE(tenant_id,entity_id,source_record_hash),
  UNIQUE(tenant_id,entity_id,receipt_hash),
  FOREIGN KEY(tenant_id,entity_id) REFERENCES entity(tenant_id,entity_id),
  FOREIGN KEY(tenant_id,entity_id,period_id) REFERENCES accounting_period(tenant_id,entity_id,period_id),
  FOREIGN KEY(tenant_id,import_batch_id) REFERENCES import_batch(tenant_id,import_batch_id),
  FOREIGN KEY(tenant_id,raw_event_id) REFERENCES raw_event(tenant_id,raw_event_id),
  FOREIGN KEY(tenant_id,entity_id,source_document_id) REFERENCES source_document(tenant_id,entity_id,source_document_id),
  FOREIGN KEY(tenant_id,entity_id,source_document_line_id) REFERENCES source_document_line(tenant_id,entity_id,source_document_line_id),
  FOREIGN KEY(tenant_id,entity_id,attachment_id) REFERENCES attachment(tenant_id,entity_id,attachment_id)
);

CREATE TABLE wbs_test_payable_draft_evidence (
  wbs_test_payable_draft_evidence_id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL,
  entity_id uuid NOT NULL,
  wbs_test_payable_source_receipt_id uuid NOT NULL,
  receipt_hash text NOT NULL CHECK(receipt_hash~'^sha256:[0-9a-f]{64}$'),
  business_document_id uuid NOT NULL,
  journal_entry_id uuid NOT NULL,
  draft_hash text NOT NULL CHECK(draft_hash~'^sha256:[0-9a-f]{64}$'),
  created_by text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE(tenant_id,entity_id,wbs_test_payable_source_receipt_id),
  UNIQUE(tenant_id,entity_id,business_document_id),
  UNIQUE(tenant_id,entity_id,journal_entry_id),
  FOREIGN KEY(tenant_id,entity_id,wbs_test_payable_source_receipt_id) REFERENCES wbs_test_payable_source_receipt(tenant_id,entity_id,wbs_test_payable_source_receipt_id),
  FOREIGN KEY(tenant_id,entity_id,business_document_id) REFERENCES business_document(tenant_id,entity_id,business_document_id),
  FOREIGN KEY(tenant_id,entity_id,journal_entry_id) REFERENCES journal_entry(tenant_id,entity_id,journal_entry_id)
);

ALTER TABLE wbs_test_payable_source_receipt ENABLE ROW LEVEL SECURITY;
ALTER TABLE wbs_test_payable_draft_evidence ENABLE ROW LEVEL SECURITY;
CREATE POLICY wbs_test_payable_source_receipt_scope ON wbs_test_payable_source_receipt
  USING(tenant_id=refs_current_tenant() AND refs_entity_allowed(entity_id))
  WITH CHECK(tenant_id=refs_current_tenant() AND refs_entity_allowed(entity_id));
CREATE POLICY wbs_test_payable_draft_evidence_scope ON wbs_test_payable_draft_evidence
  USING(tenant_id=refs_current_tenant() AND refs_entity_allowed(entity_id))
  WITH CHECK(tenant_id=refs_current_tenant() AND refs_entity_allowed(entity_id));
CREATE TRIGGER wbs_test_payable_source_receipt_append_only BEFORE UPDATE OR DELETE ON wbs_test_payable_source_receipt
  FOR EACH ROW EXECUTE FUNCTION reject_mutation();
CREATE TRIGGER wbs_test_payable_draft_evidence_append_only BEFORE UPDATE OR DELETE ON wbs_test_payable_draft_evidence
  FOR EACH ROW EXECUTE FUNCTION reject_mutation();

CREATE FUNCTION refs_retain_wbs_test_payable_source_hash(
  p_tenant uuid,p_entity uuid,p_period uuid,p_observation jsonb,p_row jsonb,p_row_index integer
) RETURNS text LANGUAGE sql IMMUTABLE SET search_path=pg_catalog,public,pg_temp AS $$
  SELECT refs_jsonb_hash(jsonb_build_object('schema_version','WBS_TEST_PAYABLE_SOURCE_RETAIN_V1',
    'tenant_id',p_tenant,'entity_id',p_entity,'period_id',p_period,'observation',p_observation,
    'row',p_row,'row_index',p_row_index,'test_only',true,'provenance_mode','UNSIGNED_TEST_ONLY'))
$$;

CREATE FUNCTION refs_retain_wbs_test_payable_source(
  p_tenant uuid,p_entity uuid,p_period uuid,p_observation jsonb,p_row jsonb,p_row_index integer,
  p_idempotency_key text,p_request_hash text
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE actor text:=refs_current_actor();idem idempotency_receipt;entity_row entity;period_row accounting_period;prior wbs_test_payable_source_receipt;
DECLARE source_date date;posting_date date;amount numeric(20,4);currency text;source_record_id text;source_version text;source_ref text;document_number text;
DECLARE batch_id uuid:=gen_random_uuid();raw_id uuid:=gen_random_uuid();source_id uuid:=gen_random_uuid();line_id uuid:=gen_random_uuid();attachment_id uuid:=gen_random_uuid();receipt_id uuid:=gen_random_uuid();
DECLARE receipt_hash text;response jsonb;event_payload jsonb;
BEGIN
  PERFORM refs_assert_scope(p_tenant,p_entity,'WBS.TEST.IMPORT');
  IF actor IS NULL THEN RAISE EXCEPTION 'Authenticated WBS test service missing' USING ERRCODE='42501'; END IF;
  IF p_idempotency_key IS NULL OR length(p_idempotency_key) NOT BETWEEN 8 AND 160
    OR p_request_hash<>refs_retain_wbs_test_payable_source_hash(p_tenant,p_entity,p_period,p_observation,p_row,p_row_index)
  THEN RAISE EXCEPTION 'WBS test source retention request is not canonical' USING ERRCODE='22023'; END IF;
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
    OR p_observation->'rows'->p_row_index IS DISTINCT FROM p_row
    OR (p_observation-'schema_version'-'status'-'observation_mode'-'source_system'-'tool'-'environment'-'entity_id'-'captured_at'-'provider_content_sha256'-'scope'-'record_count'-'rows'-'signature_verified'-'can_import'-'can_create_transaction'-'can_match'-'can_allocate'-'can_create_draft'-'can_approve'-'can_post'-'can_reverse'-'observation_hash')<>'{}'::jsonb
    OR (p_row-'source_record_hash'-'currency'-'accounting_date'-'amount'-'status')<>'{}'::jsonb
  THEN RAISE EXCEPTION 'Only one exact sanitized unsigned Payable row may be retained' USING ERRCODE='22023'; END IF;
  currency:=p_row->>'currency';
  IF p_row->>'source_record_hash'!~'^sha256:[0-9a-f]{64}$' OR p_observation->>'observation_hash'!~'^sha256:[0-9a-f]{64}$'
    OR p_observation->>'provider_content_sha256'!~'^[0-9a-f]{64}$' OR currency!~'^[A-Z]{3}$'
    OR COALESCE(p_row->>'amount','')!~'^-?(0|[1-9][0-9]{0,15})\.[0-9]{4}$' OR (p_row->>'amount')::numeric=0
    OR COALESCE(p_row->>'accounting_date','')!~'^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
  THEN RAISE EXCEPTION 'Sanitized WBS test Payable facts are invalid' USING ERRCODE='22023'; END IF;
  BEGIN source_date:=(p_row->>'accounting_date')::date; EXCEPTION WHEN OTHERS THEN RAISE EXCEPTION 'Sanitized WBS test accounting date is invalid' USING ERRCODE='22023'; END;
  IF source_date::text<>p_row->>'accounting_date' THEN RAISE EXCEPTION 'Sanitized WBS test accounting date is invalid' USING ERRCODE='22023'; END IF;
  amount:=abs((p_row->>'amount')::numeric(20,4));
  SELECT * INTO entity_row FROM entity WHERE tenant_id=p_tenant AND entity_id=p_entity AND active FOR SHARE;
  IF NOT FOUND OR entity_row.base_currency<>currency THEN RAISE EXCEPTION 'WBS test entity or currency scope is invalid' USING ERRCODE='42501'; END IF;
  SELECT * INTO period_row FROM accounting_period WHERE tenant_id=p_tenant AND entity_id=p_entity AND period_id=p_period AND status='OPEN' FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'WBS test source retention requires the exact OPEN period' USING ERRCODE='55000'; END IF;
  posting_date:=greatest(period_row.starts_on,least(source_date,period_row.ends_on));

  INSERT INTO idempotency_receipt(tenant_id,operation_scope,idempotency_key,request_hash,status,actor_id)
    VALUES(p_tenant,'WBS_TEST_PAYABLE_SOURCE_RETAIN:'||p_entity,p_idempotency_key,p_request_hash,'IN_PROGRESS',actor) ON CONFLICT DO NOTHING;
  SELECT * INTO idem FROM idempotency_receipt WHERE tenant_id=p_tenant AND operation_scope='WBS_TEST_PAYABLE_SOURCE_RETAIN:'||p_entity AND idempotency_key=p_idempotency_key FOR UPDATE;
  IF idem.request_hash<>p_request_hash OR idem.actor_id<>actor THEN RAISE EXCEPTION 'WBS test source retention idempotency conflict' USING ERRCODE='23505'; END IF;
  IF idem.status='SUCCEEDED' THEN RETURN idem.response_body||jsonb_build_object('idempotent',true); END IF;
  SELECT * INTO prior FROM wbs_test_payable_source_receipt WHERE tenant_id=p_tenant AND entity_id=p_entity AND source_record_hash=p_row->>'source_record_hash' FOR SHARE;
  IF FOUND THEN
    IF prior.period_id<>p_period OR prior.observation_hash<>p_observation->>'observation_hash' OR prior.provider_content_sha256<>p_observation->>'provider_content_sha256'
      OR prior.row_index<>p_row_index OR prior.source_accounting_date<>source_date OR prior.currency<>currency OR prior.amount<>amount
    THEN RAISE EXCEPTION 'WBS test source identity conflicts with retained immutable evidence' USING ERRCODE='23505'; END IF;
    event_payload:=jsonb_build_object('schema_version','WBS_TEST_PAYABLE_SOURCE_REPLAY_V1','wbs_test_payable_source_receipt_id',prior.wbs_test_payable_source_receipt_id,
      'receipt_hash',prior.receipt_hash,'source_document_id',prior.source_document_id,'attachment_id',prior.attachment_id,'status','RETAINED',
      'test_only',true,'provenance_mode','UNSIGNED_TEST_ONLY','can_create_draft',false,'can_submit',false,'can_review',false,'can_approve',false,'can_post',false);
    INSERT INTO audit_event(tenant_id,entity_id,event_type,object_type,object_id,action,actor_id,actor_type,permission_used,request_id,correlation_id,idempotency_key,after_hash,reason,metadata)
      VALUES(p_tenant,p_entity,'WBS_TEST_PAYABLE_SOURCE_RETAIN_REPLAYED','WBS_TEST_PAYABLE_SOURCE_RECEIPT',prior.wbs_test_payable_source_receipt_id,'REPLAY_RETAIN',actor,'SERVICE_ACCOUNT','WBS.TEST.IMPORT',p_idempotency_key,p_idempotency_key,p_idempotency_key,prior.receipt_hash,'Existing exact TEST_ONLY source receipt replayed under a new command identity',event_payload);
    INSERT INTO outbox_event(tenant_id,entity_id,aggregate_type,aggregate_id,event_type,payload,payload_hash)
      VALUES(p_tenant,p_entity,'WBS_TEST_PAYABLE_SOURCE_RECEIPT',prior.wbs_test_payable_source_receipt_id,'WBS_TEST_PAYABLE_SOURCE_RETAIN_REPLAYED',event_payload,refs_jsonb_hash(event_payload));
    response:=jsonb_build_object('wbs_test_payable_source_receipt_id',prior.wbs_test_payable_source_receipt_id,'receipt_hash',prior.receipt_hash,
      'source_document_id',prior.source_document_id,'attachment_id',prior.attachment_id,'status','RETAINED','idempotent',true,
      'test_only',true,'provenance_mode','UNSIGNED_TEST_ONLY','can_create_draft',false,'can_submit',false,'can_review',false,'can_approve',false,'can_post',false);
    UPDATE idempotency_receipt SET status='SUCCEEDED',response_status=200,response_body=response,completed_at=clock_timestamp() WHERE idempotency_receipt_id=idem.idempotency_receipt_id;
    RETURN response;
  END IF;
  source_record_id:='test:'||substr(p_row->>'source_record_hash',8);source_version:='test:'||substr(p_observation->>'observation_hash',8);
  source_ref:='object://refs-test-only/'||p_entity||'/'||substr(p_row->>'source_record_hash',8);document_number:='WBS-TEST-'||upper(substr(p_row->>'source_record_hash',8,16));
  INSERT INTO import_batch(import_batch_id,tenant_id,entity_id,connector_code,source_module,source_entity_id,idempotency_key,request_hash,status,row_count,started_at,completed_at)
    VALUES(batch_id,p_tenant,p_entity,'WBS_TEST','payable',entity_row.source_entity_id,p_idempotency_key,p_request_hash,'SUCCEEDED',1,clock_timestamp(),clock_timestamp());
  INSERT INTO raw_event(raw_event_id,tenant_id,entity_id,import_batch_id,source_system,source_module,source_entity_id,source_record_id,source_version,event_type,occurred_at,payload_hash,payload_ref,correlation_id)
    VALUES(raw_id,p_tenant,p_entity,batch_id,entity_row.source_system,'payable',entity_row.source_entity_id,source_record_id,source_version,'UPSERT',source_date::timestamptz,p_row->>'source_record_hash',source_ref,p_idempotency_key);
  INSERT INTO source_document(source_document_id,tenant_id,entity_id,raw_event_id,source_system,source_module,source_entity_id,source_record_id,source_version,document_type,document_no,business_date,accounting_date,currency,gross_amount,status,source_ref,payload_hash)
    VALUES(source_id,p_tenant,p_entity,raw_id,entity_row.source_system,'payable',entity_row.source_entity_id,source_record_id,source_version,'WBS_TEST_PAYABLE',document_number,source_date,posting_date,currency,amount,'READY_FOR_DRAFT',source_ref,p_row->>'source_record_hash');
  INSERT INTO source_document_line(source_document_line_id,tenant_id,entity_id,source_document_id,source_line_id,line_no,amount,direction,description,party_ref,external_dimension_refs)
    VALUES(line_id,p_tenant,p_entity,source_id,source_record_id,1,amount,'NONE','Sanitized unsigned WBS test payable','WBS_TEST_VENDOR',
      jsonb_build_object('schema_version','WBS_TEST_IMPORT_LINE_V2','test_only',true,'provenance_mode','UNSIGNED_TEST_ONLY','observation_hash',p_observation->>'observation_hash','source_record_hash',p_row->>'source_record_hash','provider_content_sha256',p_observation->>'provider_content_sha256','row_index',p_row_index,'original_accounting_date',source_date,'posting_accounting_date',posting_date));
  INSERT INTO attachment(attachment_id,tenant_id,entity_id,name,media_type,size_bytes,content_hash,storage_ref,storage_version,uploaded_by,uploaded_at,verified_at,scan_status,finalization_status,finalized_at)
    VALUES(attachment_id,p_tenant,p_entity,document_number||'.txt','text/csv',1,p_row->>'source_record_hash',source_ref||'/unsigned-test-evidence','unsigned-test-only:'||substr(p_observation->>'observation_hash',8),actor,clock_timestamp(),clock_timestamp(),'CLEAN','VERIFIED_CLEAN',clock_timestamp());
  INSERT INTO source_link(tenant_id,entity_id,link_type,raw_event_id,source_document_id,source_document_line_id,created_by)
    VALUES(p_tenant,p_entity,'WBS_TEST_SOURCE',raw_id,source_id,line_id,actor);
  INSERT INTO source_link(tenant_id,entity_id,link_type,source_document_id,attachment_id,created_by)
    VALUES(p_tenant,p_entity,'SOURCE_ATTACHMENT',source_id,attachment_id,actor);
  receipt_hash:=refs_jsonb_hash(jsonb_build_object('schema_version','WBS_TEST_PAYABLE_SOURCE_RECEIPT_V1','tenant_id',p_tenant,'entity_id',p_entity,
    'receipt_id',receipt_id,'period_id',p_period,'observation_hash',p_observation->>'observation_hash','source_record_hash',p_row->>'source_record_hash',
    'provider_content_sha256',p_observation->>'provider_content_sha256','row_index',p_row_index,'source_accounting_date',source_date,
    'posting_accounting_date',posting_date,'currency',currency,'amount',amount,'source_document_id',source_id,'source_document_line_id',line_id,'attachment_id',attachment_id));
  INSERT INTO wbs_test_payable_source_receipt(wbs_test_payable_source_receipt_id,tenant_id,entity_id,period_id,observation_hash,source_record_hash,provider_content_sha256,row_index,source_accounting_date,posting_accounting_date,currency,amount,document_number,import_batch_id,raw_event_id,source_document_id,source_document_line_id,attachment_id,receipt_hash,created_by)
    VALUES(receipt_id,p_tenant,p_entity,p_period,p_observation->>'observation_hash',p_row->>'source_record_hash',p_observation->>'provider_content_sha256',p_row_index,source_date,posting_date,currency,amount,document_number,batch_id,raw_id,source_id,line_id,attachment_id,receipt_hash,actor);
  event_payload:=jsonb_build_object('schema_version','WBS_TEST_PAYABLE_SOURCE_RECEIPT_V1','wbs_test_payable_source_receipt_id',receipt_id,'receipt_hash',receipt_hash,'source_document_id',source_id,'attachment_id',attachment_id,'status','RETAINED','test_only',true,'provenance_mode','UNSIGNED_TEST_ONLY','can_create_draft',false,'can_submit',false,'can_review',false,'can_approve',false,'can_post',false);
  INSERT INTO audit_event(tenant_id,entity_id,event_type,object_type,object_id,action,actor_id,actor_type,permission_used,request_id,correlation_id,idempotency_key,after_hash,reason,metadata)
    VALUES(p_tenant,p_entity,'WBS_TEST_PAYABLE_SOURCE_RETAINED','WBS_TEST_PAYABLE_SOURCE_RECEIPT',receipt_id,'RETAIN',actor,'SERVICE_ACCOUNT','WBS.TEST.IMPORT',p_idempotency_key,p_idempotency_key,p_idempotency_key,receipt_hash,'Unsigned TEST_ONLY source and attachment retained without accounting authority',event_payload);
  INSERT INTO outbox_event(tenant_id,entity_id,aggregate_type,aggregate_id,event_type,payload,payload_hash)
    VALUES(p_tenant,p_entity,'WBS_TEST_PAYABLE_SOURCE_RECEIPT',receipt_id,'WBS_TEST_PAYABLE_SOURCE_RETAINED',event_payload,refs_jsonb_hash(event_payload));
  response:=event_payload||jsonb_build_object('idempotent',false);
  UPDATE idempotency_receipt SET status='SUCCEEDED',response_status=201,response_body=response,completed_at=clock_timestamp() WHERE idempotency_receipt_id=idem.idempotency_receipt_id;
  RETURN response;
END $$;

CREATE FUNCTION refs_create_wbs_test_payable_draft_hash(
  p_tenant uuid,p_entity uuid,p_source_receipt uuid,p_expected_receipt_hash text
) RETURNS text LANGUAGE sql IMMUTABLE SET search_path=pg_catalog,public,pg_temp AS $$
  SELECT refs_jsonb_hash(jsonb_build_object('schema_version','WBS_TEST_PAYABLE_HUMAN_DRAFT_V1','tenant_id',p_tenant,'entity_id',p_entity,
    'source_receipt_id',p_source_receipt,'expected_receipt_hash',p_expected_receipt_hash,'test_only',true,'provenance_mode','UNSIGNED_TEST_ONLY'))
$$;

CREATE FUNCTION refs_create_wbs_test_payable_draft(
  p_tenant uuid,p_entity uuid,p_source_receipt uuid,p_expected_receipt_hash text,p_idempotency_key text,p_request_hash text
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE actor text:=refs_current_actor();idem idempotency_receipt;retained wbs_test_payable_source_receipt;prior wbs_test_payable_draft_evidence;
DECLARE document_result jsonb;business_id uuid;journal_id uuid;evidence_id uuid:=gen_random_uuid();draft_hash text;response jsonb;event_payload jsonb;inner_hash text;
BEGIN
  PERFORM refs_assert_scope(p_tenant,p_entity,'AP.BILL.CREATE');
  IF actor IS NULL THEN RAISE EXCEPTION 'Authenticated human AP maker missing' USING ERRCODE='42501'; END IF;
  IF p_idempotency_key IS NULL OR length(p_idempotency_key) NOT BETWEEN 8 AND 160
    OR p_request_hash<>refs_create_wbs_test_payable_draft_hash(p_tenant,p_entity,p_source_receipt,p_expected_receipt_hash)
  THEN RAISE EXCEPTION 'WBS test human Draft request is not canonical' USING ERRCODE='22023'; END IF;
  SELECT * INTO retained FROM wbs_test_payable_source_receipt WHERE tenant_id=p_tenant AND entity_id=p_entity AND wbs_test_payable_source_receipt_id=p_source_receipt FOR SHARE;
  IF NOT FOUND OR retained.receipt_hash<>p_expected_receipt_hash OR NOT retained.test_only OR retained.provenance_mode<>'UNSIGNED_TEST_ONLY'
  THEN RAISE EXCEPTION 'Exact immutable WBS test source receipt is required' USING ERRCODE='40001'; END IF;
  IF actor=retained.created_by THEN RAISE EXCEPTION 'WBS test service producer cannot create the AP Draft' USING ERRCODE='42501'; END IF;
  PERFORM 1 FROM source_document s JOIN source_document_line l ON l.tenant_id=s.tenant_id AND l.entity_id=s.entity_id AND l.source_document_id=s.source_document_id
    JOIN attachment a ON a.tenant_id=s.tenant_id AND a.entity_id=s.entity_id AND a.attachment_id=retained.attachment_id
    JOIN source_link sl ON sl.tenant_id=s.tenant_id AND sl.entity_id=s.entity_id AND sl.source_document_id=s.source_document_id AND sl.attachment_id=a.attachment_id AND sl.link_type='SOURCE_ATTACHMENT'
    WHERE s.tenant_id=p_tenant AND s.entity_id=p_entity AND s.source_document_id=retained.source_document_id AND s.status='READY_FOR_DRAFT'
      AND s.payload_hash=retained.source_record_hash AND s.accounting_date=retained.posting_accounting_date AND s.currency=retained.currency AND s.gross_amount=retained.amount
      AND l.source_document_line_id=retained.source_document_line_id AND l.amount=retained.amount
      AND a.content_hash=retained.source_record_hash AND a.finalization_status='VERIFIED_CLEAN' FOR SHARE OF s,l,a;
  IF NOT FOUND THEN RAISE EXCEPTION 'Retained WBS test source or attachment evidence changed' USING ERRCODE='40001'; END IF;
  INSERT INTO idempotency_receipt(tenant_id,operation_scope,idempotency_key,request_hash,status,actor_id)
    VALUES(p_tenant,'WBS_TEST_PAYABLE_HUMAN_DRAFT:'||p_entity,p_idempotency_key,p_request_hash,'IN_PROGRESS',actor) ON CONFLICT DO NOTHING;
  SELECT * INTO idem FROM idempotency_receipt WHERE tenant_id=p_tenant AND operation_scope='WBS_TEST_PAYABLE_HUMAN_DRAFT:'||p_entity AND idempotency_key=p_idempotency_key FOR UPDATE;
  IF idem.request_hash<>p_request_hash OR idem.actor_id<>actor THEN RAISE EXCEPTION 'WBS test human Draft idempotency conflict' USING ERRCODE='23505'; END IF;
  IF idem.status='SUCCEEDED' THEN RETURN idem.response_body||jsonb_build_object('idempotent',true); END IF;
  SELECT * INTO prior FROM wbs_test_payable_draft_evidence WHERE tenant_id=p_tenant AND entity_id=p_entity AND wbs_test_payable_source_receipt_id=p_source_receipt FOR SHARE;
  IF FOUND THEN RAISE EXCEPTION 'WBS test source receipt already has a human Draft' USING ERRCODE='23505'; END IF;
  INSERT INTO member_master(tenant_id,entity_id,member_ref,member_type,display_name,active) VALUES(p_tenant,p_entity,'WBS_TEST_VENDOR','VENDOR','WBS Test Vendor',true) ON CONFLICT DO NOTHING;
  INSERT INTO account_master(tenant_id,entity_id,account_code,account_name,requires_member,required_member_type,active) VALUES(p_tenant,p_entity,'610000','WBS Test Operating Expense',false,NULL,true) ON CONFLICT DO NOTHING;
  INSERT INTO account_master(tenant_id,entity_id,account_code,account_name,requires_member,required_member_type,active) VALUES(p_tenant,p_entity,'291001','Accounts Payable',true,'VENDOR',true) ON CONFLICT DO NOTHING;
  PERFORM 1 FROM member_master WHERE tenant_id=p_tenant AND entity_id=p_entity AND member_ref='WBS_TEST_VENDOR' AND member_type='VENDOR' AND active FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'WBS test vendor conflicts with existing master data' USING ERRCODE='23514'; END IF;
  PERFORM 1 FROM account_master WHERE tenant_id=p_tenant AND entity_id=p_entity AND account_code='610000' AND active AND NOT requires_member FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'WBS test expense account conflicts with existing master data' USING ERRCODE='23514'; END IF;
  PERFORM 1 FROM account_master WHERE tenant_id=p_tenant AND entity_id=p_entity AND account_code='291001' AND active AND requires_member AND required_member_type='VENDOR' FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'WBS test AP account conflicts with existing master data' USING ERRCODE='23514'; END IF;
  inner_hash:=refs_create_business_document_hash(p_tenant,p_entity,'AP_BILL',retained.period_id,retained.document_number,'WBS_TEST_VENDOR','WBS Test Vendor',retained.currency,retained.posting_accounting_date,retained.posting_accounting_date,retained.amount,'610000','UNSIGNED TEST ONLY WBS Payable',ARRAY[retained.attachment_id]);
  document_result:=refs_create_business_document(p_tenant,p_entity,'AP_BILL',retained.period_id,retained.document_number,'WBS_TEST_VENDOR','WBS Test Vendor',retained.currency,retained.posting_accounting_date,retained.posting_accounting_date,retained.amount,'610000','UNSIGNED TEST ONLY WBS Payable',ARRAY[retained.attachment_id],'wbs-test-human-doc:'||evidence_id,inner_hash);
  business_id:=(document_result->>'business_document_id')::uuid;journal_id:=(document_result->>'journal_entry_id')::uuid;
  IF document_result->>'idempotent'<>'false' OR NOT EXISTS(
    SELECT 1 FROM business_document b JOIN journal_entry j ON j.tenant_id=b.tenant_id AND j.entity_id=b.entity_id AND j.journal_entry_id=b.draft_journal_entry_id
    WHERE b.tenant_id=p_tenant AND b.entity_id=p_entity AND b.business_document_id=business_id AND b.created_by=actor
      AND j.journal_entry_id=journal_id AND j.created_by=actor AND b.status='DRAFT' AND j.status='DRAFT'
  ) THEN RAISE EXCEPTION 'Human Draft child receipt or maker identity is invalid' USING ERRCODE='42501'; END IF;
  UPDATE business_document SET source_document_id=retained.source_document_id WHERE tenant_id=p_tenant AND entity_id=p_entity AND business_document_id=business_id AND source_document_id IS NULL;
  IF NOT FOUND THEN RAISE EXCEPTION 'WBS test AP Draft lineage could not be frozen' USING ERRCODE='23514'; END IF;
  INSERT INTO source_link(tenant_id,entity_id,link_type,source_document_id,journal_entry_id,created_by) VALUES(p_tenant,p_entity,'SOURCE_TO_JE',retained.source_document_id,journal_id,actor);
  draft_hash:=refs_jsonb_hash(jsonb_build_object('schema_version','WBS_TEST_PAYABLE_HUMAN_DRAFT_EVIDENCE_V1','source_receipt_id',p_source_receipt,'receipt_hash',retained.receipt_hash,'business_document_id',business_id,'journal_entry_id',journal_id,'maker',actor));
  INSERT INTO wbs_test_payable_draft_evidence(wbs_test_payable_draft_evidence_id,tenant_id,entity_id,wbs_test_payable_source_receipt_id,receipt_hash,business_document_id,journal_entry_id,draft_hash,created_by)
    VALUES(evidence_id,p_tenant,p_entity,p_source_receipt,retained.receipt_hash,business_id,journal_id,draft_hash,actor);
  event_payload:=jsonb_build_object('schema_version','WBS_TEST_PAYABLE_HUMAN_DRAFT_EVIDENCE_V1','wbs_test_payable_draft_evidence_id',evidence_id,'wbs_test_payable_source_receipt_id',p_source_receipt,'receipt_hash',retained.receipt_hash,'business_document_id',business_id,'journal_entry_id',journal_id,'status','DRAFT','revision',0,'test_only',true,'provenance_mode','UNSIGNED_TEST_ONLY','can_submit',false,'can_review',false,'can_approve',false,'can_post',false);
  INSERT INTO audit_event(tenant_id,entity_id,event_type,object_type,object_id,action,actor_id,actor_type,permission_used,request_id,correlation_id,idempotency_key,after_hash,reason,metadata)
    VALUES(p_tenant,p_entity,'WBS_TEST_PAYABLE_HUMAN_DRAFT_CREATED','BUSINESS_DOCUMENT',business_id,'CREATE_DRAFT',actor,'USER','AP.BILL.CREATE',p_idempotency_key,p_idempotency_key,p_idempotency_key,draft_hash,'Human AP maker consumed exact unsigned TEST_ONLY source receipt',event_payload);
  INSERT INTO outbox_event(tenant_id,entity_id,aggregate_type,aggregate_id,event_type,payload,payload_hash)
    VALUES(p_tenant,p_entity,'WBS_TEST_PAYABLE_DRAFT_EVIDENCE',evidence_id,'WBS_TEST_PAYABLE_HUMAN_DRAFT_CREATED',event_payload,refs_jsonb_hash(event_payload));
  response:=event_payload||jsonb_build_object('idempotent',false);
  UPDATE idempotency_receipt SET status='SUCCEEDED',response_status=201,response_body=response,completed_at=clock_timestamp() WHERE idempotency_receipt_id=idem.idempotency_receipt_id;
  RETURN response;
END $$;

-- Preserve migrations 168-182 as historical definitions, but close their
-- combined service-to-business command after this migration is installed.
REVOKE ALL ON FUNCTION refs_create_wbs_test_payable_draft(uuid,uuid,uuid,jsonb,jsonb,integer,text,text) FROM PUBLIC,refs_app;
REVOKE ALL ON FUNCTION refs_create_wbs_test_payable_draft_v169(uuid,uuid,uuid,jsonb,jsonb,integer,text,text) FROM PUBLIC,refs_app;
REVOKE ALL ON FUNCTION refs_create_wbs_test_payable_draft_v168(uuid,uuid,uuid,jsonb,jsonb,integer,text,text) FROM PUBLIC,refs_app;

REVOKE ALL ON wbs_test_payable_source_receipt,wbs_test_payable_draft_evidence FROM PUBLIC,refs_app;
GRANT SELECT ON wbs_test_payable_source_receipt,wbs_test_payable_draft_evidence TO refs_app;
REVOKE EXECUTE ON FUNCTION refs_retain_wbs_test_payable_source_hash(uuid,uuid,uuid,jsonb,jsonb,integer) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION refs_retain_wbs_test_payable_source(uuid,uuid,uuid,jsonb,jsonb,integer,text,text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION refs_create_wbs_test_payable_draft_hash(uuid,uuid,uuid,text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION refs_create_wbs_test_payable_draft(uuid,uuid,uuid,text,text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION refs_retain_wbs_test_payable_source_hash(uuid,uuid,uuid,jsonb,jsonb,integer) TO refs_app;
GRANT EXECUTE ON FUNCTION refs_retain_wbs_test_payable_source(uuid,uuid,uuid,jsonb,jsonb,integer,text,text) TO refs_app;
GRANT EXECUTE ON FUNCTION refs_create_wbs_test_payable_draft_hash(uuid,uuid,uuid,text) TO refs_app;
GRANT EXECUTE ON FUNCTION refs_create_wbs_test_payable_draft(uuid,uuid,uuid,text,text,text) TO refs_app;

COMMIT;
