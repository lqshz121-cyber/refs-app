BEGIN;

CREATE TABLE wbs_controlled_test_bank_import (
  wbs_controlled_test_bank_import_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant(tenant_id),
  entity_id uuid NOT NULL,
  period_id uuid NOT NULL,
  company_code text NOT NULL CHECK(company_code ~ '^[A-Z0-9][A-Z0-9_:-]{0,63}$'),
  bank_account_ref text NOT NULL CHECK(bank_account_ref='WBS_TEST_BANK'),
  observation_hash text NOT NULL CHECK(observation_hash ~ '^sha256:[0-9a-f]{64}$'),
  provider_content_sha256 text NOT NULL CHECK(provider_content_sha256 ~ '^[0-9a-f]{64}$'),
  import_batch_id uuid NOT NULL,
  reconciliation_id uuid NOT NULL,
  statement_start_date date NOT NULL,
  statement_end_date date NOT NULL,
  statement_opening_balance numeric(20,4) NOT NULL,
  statement_ending_balance numeric(20,4) NOT NULL,
  row_count integer NOT NULL CHECK(row_count BETWEEN 1 AND 10),
  test_only boolean NOT NULL DEFAULT true CHECK(test_only),
  provenance_mode text NOT NULL DEFAULT 'CONTROLLED_TEST_UNSIGNED' CHECK(provenance_mode='CONTROLLED_TEST_UNSIGNED'),
  request_hash text NOT NULL CHECK(request_hash ~ '^sha256:[0-9a-f]{64}$'),
  created_by text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE(tenant_id,entity_id,observation_hash,bank_account_ref),
  UNIQUE(tenant_id,entity_id,wbs_controlled_test_bank_import_id),
  FOREIGN KEY(tenant_id,entity_id) REFERENCES entity(tenant_id,entity_id),
  FOREIGN KEY(tenant_id,entity_id,period_id) REFERENCES accounting_period(tenant_id,entity_id,period_id),
  FOREIGN KEY(tenant_id,import_batch_id) REFERENCES import_batch(tenant_id,import_batch_id),
  FOREIGN KEY(tenant_id,entity_id,reconciliation_id) REFERENCES reconciliation(tenant_id,entity_id,reconciliation_id)
);

CREATE TABLE wbs_controlled_test_bank_import_row (
  wbs_controlled_test_bank_import_row_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  entity_id uuid NOT NULL,
  wbs_controlled_test_bank_import_id uuid NOT NULL,
  row_index integer NOT NULL CHECK(row_index BETWEEN 0 AND 9),
  source_record_hash text NOT NULL CHECK(source_record_hash ~ '^sha256:[0-9a-f]{64}$'),
  original_transaction_date date NOT NULL,
  posting_transaction_date date NOT NULL,
  direction text NOT NULL CHECK(direction IN ('DEBIT','CREDIT')),
  signed_amount numeric(20,4) NOT NULL CHECK(signed_amount<>0),
  raw_event_id uuid NOT NULL,
  source_document_id uuid NOT NULL,
  source_document_line_id uuid NOT NULL,
  bank_source_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE(tenant_id,entity_id,wbs_controlled_test_bank_import_id,row_index),
  UNIQUE(tenant_id,entity_id,source_record_hash),
  UNIQUE(tenant_id,entity_id,bank_source_id),
  FOREIGN KEY(tenant_id,entity_id,wbs_controlled_test_bank_import_id) REFERENCES wbs_controlled_test_bank_import(tenant_id,entity_id,wbs_controlled_test_bank_import_id),
  FOREIGN KEY(tenant_id,raw_event_id) REFERENCES raw_event(tenant_id,raw_event_id),
  FOREIGN KEY(tenant_id,entity_id,source_document_id) REFERENCES source_document(tenant_id,entity_id,source_document_id),
  FOREIGN KEY(tenant_id,entity_id,source_document_line_id) REFERENCES source_document_line(tenant_id,entity_id,source_document_line_id),
  FOREIGN KEY(tenant_id,entity_id,bank_source_id) REFERENCES bank_source(tenant_id,entity_id,bank_source_id)
);

ALTER TABLE wbs_controlled_test_bank_import ENABLE ROW LEVEL SECURITY;
ALTER TABLE wbs_controlled_test_bank_import_row ENABLE ROW LEVEL SECURITY;
CREATE POLICY wbs_controlled_test_bank_import_scope_policy ON wbs_controlled_test_bank_import
  USING(tenant_id=refs_current_tenant() AND refs_entity_allowed(entity_id))
  WITH CHECK(tenant_id=refs_current_tenant() AND refs_entity_allowed(entity_id));
CREATE POLICY wbs_controlled_test_bank_import_row_scope_policy ON wbs_controlled_test_bank_import_row
  USING(tenant_id=refs_current_tenant() AND refs_entity_allowed(entity_id))
  WITH CHECK(tenant_id=refs_current_tenant() AND refs_entity_allowed(entity_id));
CREATE TRIGGER wbs_controlled_test_bank_import_append_only BEFORE UPDATE OR DELETE ON wbs_controlled_test_bank_import
  FOR EACH ROW EXECUTE FUNCTION reject_mutation();
CREATE TRIGGER wbs_controlled_test_bank_import_row_append_only BEFORE UPDATE OR DELETE ON wbs_controlled_test_bank_import_row
  FOR EACH ROW EXECUTE FUNCTION reject_mutation();

CREATE FUNCTION refs_create_wbs_controlled_test_bank_scope_hash(
  p_tenant uuid,p_entity uuid,p_period uuid,p_company_code text,p_observation jsonb,p_bank_account_ref text
) RETURNS text LANGUAGE sql IMMUTABLE SET search_path=pg_catalog,public,pg_temp AS $$
  SELECT refs_jsonb_hash(jsonb_build_object(
    'tenant_id',p_tenant,'entity_id',p_entity,'period_id',p_period,'company_code',p_company_code,
    'observation',p_observation,'bank_account_ref',p_bank_account_ref,'test_only',true,
    'provenance_mode','CONTROLLED_TEST_UNSIGNED'))
$$;

CREATE FUNCTION refs_create_wbs_controlled_test_bank_scope(
  p_tenant uuid,p_entity uuid,p_period uuid,p_company_code text,p_observation jsonb,p_bank_account_ref text,
  p_idempotency_key text,p_request_hash text
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE actor text:=refs_current_actor(); idem idempotency_receipt; prior wbs_controlled_test_bank_import;
DECLARE entity_row entity; period_row accounting_period; batch_id uuid:=gen_random_uuid(); import_id uuid:=gen_random_uuid();
DECLARE item jsonb; row_index integer:=0; raw_id uuid; source_id uuid; line_id uuid; bank_id uuid;
DECLARE original_date date; posting_date date; unsigned_amount numeric(20,4); signed_amount numeric(20,4);
DECLARE direction text; source_hash text; source_record_id text; source_version text; source_ref text; external_line_id text;
DECLARE activity numeric(20,4):=0; rows_count integer; starts_on date; ends_on date; observed_from date; observed_to date; response jsonb; event_payload jsonb;
DECLARE reconciliation_result jsonb; reconciliation_id uuid; bank_ids jsonb:='[]'::jsonb;
BEGIN
  PERFORM refs_assert_scope(p_tenant,p_entity,'WBS.TEST.IMPORT');
  PERFORM refs_assert_scope(p_tenant,p_entity,'BANK.RECONCILIATION.START');
  IF actor IS NULL THEN RAISE EXCEPTION 'Authenticated controlled test Bank importer missing' USING ERRCODE='42501'; END IF;
  IF p_request_hash<>refs_create_wbs_controlled_test_bank_scope_hash(p_tenant,p_entity,p_period,p_company_code,p_observation,p_bank_account_ref)
     OR p_idempotency_key IS NULL OR length(p_idempotency_key) NOT BETWEEN 8 AND 160 THEN
    RAISE EXCEPTION 'Controlled test Bank request is not canonical' USING ERRCODE='22023';
  END IF;
  IF p_bank_account_ref<>'WBS_TEST_BANK' OR p_company_code IS NULL OR p_company_code!~'^[A-Z0-9][A-Z0-9_:-]{0,63}$'
     OR jsonb_typeof(p_observation)<>'object'
     OR p_observation->>'schema_version'<>'WBS_LIVE_PILOT_OBSERVATION_V1'
     OR p_observation->>'status'<>'NOT_ADMITTED' OR p_observation->>'observation_mode'<>'UNSIGNED_PILOT'
     OR p_observation->>'source_system'<>'WBS' OR p_observation->>'tool'<>'list_bank_transactions'
     OR p_observation->>'environment'<>'PRODUCTION' OR p_observation->>'entity_id'<>p_entity::text
     OR p_observation->>'signature_verified'<>'false' OR p_observation->>'can_import'<>'false'
     OR p_observation->>'can_create_transaction'<>'false' OR p_observation->>'can_match'<>'false'
     OR p_observation->>'can_allocate'<>'false' OR p_observation->>'can_create_draft'<>'false'
     OR p_observation->>'can_approve'<>'false' OR p_observation->>'can_post'<>'false' OR p_observation->>'can_reverse'<>'false'
     OR COALESCE(p_observation->>'observation_hash','')!~'^sha256:[0-9a-f]{64}$'
     OR COALESCE(p_observation->>'provider_content_sha256','')!~'^[0-9a-f]{64}$'
     OR jsonb_typeof(p_observation->'rows')<>'array' THEN
    RAISE EXCEPTION 'Only one closed unsigned live WBS Bank observation may enter the controlled test bridge' USING ERRCODE='22023';
  END IF;
  IF p_observation->'scope'->'company_codes'<>jsonb_build_array(p_company_code)
     OR jsonb_typeof(p_observation->'scope'->'date_range')<>'array'
     OR jsonb_array_length(p_observation->'scope'->'date_range')<>2 THEN
    RAISE EXCEPTION 'Controlled test Bank Provider scope is not exact' USING ERRCODE='42501';
  END IF;
  BEGIN
    observed_from:=(p_observation->'scope'->'date_range'->>0)::date;
    observed_to:=(p_observation->'scope'->'date_range'->>1)::date;
  EXCEPTION WHEN OTHERS THEN
    RAISE EXCEPTION 'Controlled test Bank Provider date scope is invalid' USING ERRCODE='22023';
  END;
  IF observed_from::text<>p_observation->'scope'->'date_range'->>0 OR observed_to::text<>p_observation->'scope'->'date_range'->>1 OR observed_from>observed_to THEN
    RAISE EXCEPTION 'Controlled test Bank Provider date scope is invalid' USING ERRCODE='22023';
  END IF;
  rows_count:=jsonb_array_length(p_observation->'rows');
  IF rows_count NOT BETWEEN 1 AND 10 OR (p_observation->>'record_count')::integer<>rows_count THEN
    RAISE EXCEPTION 'Controlled test Bank observation must contain one to ten rows' USING ERRCODE='22023';
  END IF;
  SELECT * INTO entity_row FROM entity WHERE tenant_id=p_tenant AND entity_id=p_entity AND active FOR SHARE;
  IF NOT FOUND OR entity_row.base_currency<>'USD' THEN RAISE EXCEPTION 'Controlled test Bank entity scope is invalid' USING ERRCODE='42501'; END IF;
  SELECT * INTO period_row FROM accounting_period WHERE tenant_id=p_tenant AND entity_id=p_entity AND period_id=p_period AND status='OPEN' FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Controlled test Bank import requires the exact OPEN period' USING ERRCODE='55000'; END IF;
  starts_on:=period_row.starts_on;ends_on:=period_row.ends_on;

  INSERT INTO idempotency_receipt(tenant_id,operation_scope,idempotency_key,request_hash,status,actor_id)
    VALUES(p_tenant,'WBS_CONTROLLED_TEST_BANK:'||p_entity,p_idempotency_key,p_request_hash,'IN_PROGRESS',actor) ON CONFLICT DO NOTHING;
  SELECT * INTO idem FROM idempotency_receipt WHERE tenant_id=p_tenant AND operation_scope='WBS_CONTROLLED_TEST_BANK:'||p_entity AND idempotency_key=p_idempotency_key FOR UPDATE;
  IF idem.request_hash<>p_request_hash OR idem.actor_id<>actor THEN RAISE EXCEPTION 'Controlled test Bank idempotency conflict' USING ERRCODE='23505'; END IF;
  IF idem.status='SUCCEEDED' THEN RETURN idem.response_body||jsonb_build_object('idempotent',true); END IF;
  SELECT * INTO prior FROM wbs_controlled_test_bank_import WHERE tenant_id=p_tenant AND entity_id=p_entity AND observation_hash=p_observation->>'observation_hash' AND bank_account_ref=p_bank_account_ref FOR SHARE;
  IF FOUND THEN
    SELECT COALESCE(jsonb_agg(r.bank_source_id ORDER BY r.row_index),'[]'::jsonb) INTO bank_ids
      FROM wbs_controlled_test_bank_import_row r WHERE r.tenant_id=p_tenant AND r.entity_id=p_entity AND r.wbs_controlled_test_bank_import_id=prior.wbs_controlled_test_bank_import_id;
    response:=jsonb_build_object('wbs_controlled_test_bank_import_id',prior.wbs_controlled_test_bank_import_id,'reconciliation_id',prior.reconciliation_id,
      'bank_account_ref',prior.bank_account_ref,'statement_ending_date',prior.statement_end_date,'transaction_count',prior.row_count,
      'bank_source_ids',bank_ids,'status','DRAFT','test_only',true,'provenance_mode','CONTROLLED_TEST_UNSIGNED','idempotent',true);
    UPDATE idempotency_receipt SET status='SUCCEEDED',response_status=200,response_body=response,completed_at=clock_timestamp() WHERE idempotency_receipt_id=idem.idempotency_receipt_id;
    RETURN response;
  END IF;

  INSERT INTO member_master(tenant_id,entity_id,member_ref,member_type,display_name,active)
    VALUES(p_tenant,p_entity,p_bank_account_ref,'BANK','WBS Controlled Test Bank',true) ON CONFLICT DO NOTHING;
  PERFORM 1 FROM member_master WHERE tenant_id=p_tenant AND entity_id=p_entity AND member_ref=p_bank_account_ref AND member_type='BANK' AND active FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Controlled test Bank member conflicts with existing master data' USING ERRCODE='23514'; END IF;
  INSERT INTO import_batch(import_batch_id,tenant_id,entity_id,connector_code,source_module,source_entity_id,idempotency_key,request_hash,status,row_count,started_at,completed_at)
    VALUES(batch_id,p_tenant,p_entity,'WBS_TEST','bankFeed',entity_row.source_entity_id,p_idempotency_key,p_request_hash,'SUCCEEDED',rows_count,clock_timestamp(),clock_timestamp());

  FOR item IN SELECT value FROM jsonb_array_elements(p_observation->'rows') LOOP
    IF jsonb_typeof(item)<>'object' OR (item-'source_record_hash'-'currency'-'accounting_date'-'amount'-'direction'-'status')<>'{}'::jsonb
       OR COALESCE(item->>'source_record_hash','')!~'^sha256:[0-9a-f]{64}$'
       OR item->>'currency'<>'USD' OR COALESCE(item->>'accounting_date','')!~'^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
       OR COALESCE(item->>'amount','')!~'^(?:0|[1-9][0-9]{0,15})\.[0-9]{4}$'
       OR (item->>'amount')::numeric=0 OR item->>'direction' NOT IN ('DEBIT','CREDIT')
       OR COALESCE(length(item->>'status'),0) NOT BETWEEN 1 AND 64 THEN
      RAISE EXCEPTION 'Sanitized controlled test Bank row is invalid' USING ERRCODE='22023';
    END IF;
    BEGIN original_date:=(item->>'accounting_date')::date; EXCEPTION WHEN OTHERS THEN RAISE EXCEPTION 'Controlled test Bank date is invalid' USING ERRCODE='22023'; END;
    IF original_date::text<>item->>'accounting_date' OR original_date NOT BETWEEN observed_from AND observed_to THEN RAISE EXCEPTION 'Controlled test Bank date is outside the exact observation scope' USING ERRCODE='22023'; END IF;
    posting_date:=greatest(starts_on,least(original_date,ends_on));direction:=item->>'direction';unsigned_amount:=(item->>'amount')::numeric(20,4);
    signed_amount:=CASE direction WHEN 'DEBIT' THEN unsigned_amount ELSE -unsigned_amount END;activity:=activity+signed_amount;
    source_hash:=item->>'source_record_hash';source_record_id:='test-bank:'||substr(source_hash,8,24);source_version:='test:'||substr(p_observation->>'observation_hash',8);
    source_ref:='object://refs-test-only/'||p_entity||'/bank/'||substr(source_hash,8);external_line_id:='WBS-TEST-BANK-'||upper(substr(source_hash,8,16));
    raw_id:=gen_random_uuid();source_id:=gen_random_uuid();line_id:=gen_random_uuid();bank_id:=gen_random_uuid();
    INSERT INTO raw_event(raw_event_id,tenant_id,entity_id,import_batch_id,source_system,source_module,source_entity_id,source_record_id,source_version,event_type,occurred_at,payload_hash,payload_ref,correlation_id)
      VALUES(raw_id,p_tenant,p_entity,batch_id,entity_row.source_system,'bankFeed',entity_row.source_entity_id,source_record_id,source_version,'UPSERT',original_date::timestamptz,source_hash,source_ref,p_idempotency_key);
    INSERT INTO source_document(source_document_id,tenant_id,entity_id,raw_event_id,source_system,source_module,source_entity_id,source_record_id,source_version,document_type,document_no,business_date,accounting_date,currency,gross_amount,status,source_ref,payload_hash)
      VALUES(source_id,p_tenant,p_entity,raw_id,entity_row.source_system,'bankFeed',entity_row.source_entity_id,source_record_id,source_version,'WBS_TEST_BANK_TRANSACTION',external_line_id,original_date,posting_date,'USD',signed_amount,'RECEIVED',source_ref,source_hash);
    INSERT INTO source_document_line(source_document_line_id,tenant_id,entity_id,source_document_id,source_line_id,line_no,amount,direction,description,bank_account_ref,external_dimension_refs)
      VALUES(line_id,p_tenant,p_entity,source_id,source_record_id,1,unsigned_amount,direction,'Sanitized unsigned WBS controlled test Bank transaction',p_bank_account_ref,
        jsonb_build_object('schema_version','WBS_CONTROLLED_TEST_BANK_LINE_V1','test_only',true,'provenance_mode','CONTROLLED_TEST_UNSIGNED','observation_hash',p_observation->>'observation_hash','source_record_hash',source_hash,'provider_content_sha256',p_observation->>'provider_content_sha256','row_index',row_index,'original_transaction_date',original_date,'posting_transaction_date',posting_date,'provider_status',item->>'status'));
    INSERT INTO bank_source(bank_source_id,tenant_id,entity_id,source_document_id,source_line_id,bank_account_ref,external_bank_line_id,transaction_date,currency,amount)
      VALUES(bank_id,p_tenant,p_entity,source_id,line_id,p_bank_account_ref,external_line_id,posting_date,'USD',signed_amount);
    INSERT INTO source_link(tenant_id,entity_id,link_type,raw_event_id,source_document_id,source_document_line_id,bank_source_id,created_by)
      VALUES(p_tenant,p_entity,'WBS_CONTROLLED_TEST_BANK_SOURCE',raw_id,source_id,line_id,bank_id,actor);
    bank_ids:=bank_ids||jsonb_build_array(bank_id);row_index:=row_index+1;
  END LOOP;

  reconciliation_result:=refs_start_reconciliation(p_tenant,p_entity,p_bank_account_ref,ends_on,0,activity,
    'Start controlled TEST_ONLY unsigned WBS Bank reconciliation',p_idempotency_key||':reconciliation',
    refs_reconciliation_start_hash(p_tenant,p_entity,p_bank_account_ref,ends_on,0,activity,'Start controlled TEST_ONLY unsigned WBS Bank reconciliation'));
  reconciliation_id:=(reconciliation_result->>'reconciliation_id')::uuid;
  INSERT INTO wbs_controlled_test_bank_import(wbs_controlled_test_bank_import_id,tenant_id,entity_id,period_id,company_code,bank_account_ref,observation_hash,provider_content_sha256,import_batch_id,reconciliation_id,statement_start_date,statement_end_date,statement_opening_balance,statement_ending_balance,row_count,request_hash,created_by)
    VALUES(import_id,p_tenant,p_entity,p_period,p_company_code,p_bank_account_ref,p_observation->>'observation_hash',p_observation->>'provider_content_sha256',batch_id,reconciliation_id,starts_on,ends_on,0,activity,rows_count,p_request_hash,actor);
  row_index:=0;
  FOR item IN SELECT value FROM jsonb_array_elements(p_observation->'rows') LOOP
    source_hash:=item->>'source_record_hash';
    SELECT sl.raw_event_id,sl.source_document_id,sl.source_document_line_id,sl.bank_source_id INTO STRICT raw_id,source_id,line_id,bank_id
      FROM source_link sl
      JOIN raw_event re ON re.tenant_id=sl.tenant_id AND re.raw_event_id=sl.raw_event_id
      JOIN source_document d ON d.tenant_id=sl.tenant_id AND d.entity_id=sl.entity_id AND d.source_document_id=sl.source_document_id
      WHERE sl.tenant_id=p_tenant AND sl.entity_id=p_entity AND sl.link_type='WBS_CONTROLLED_TEST_BANK_SOURCE'
        AND re.import_batch_id=batch_id AND d.payload_hash=source_hash FOR SHARE;
    original_date:=(item->>'accounting_date')::date;posting_date:=greatest(starts_on,least(original_date,ends_on));direction:=item->>'direction';unsigned_amount:=(item->>'amount')::numeric(20,4);signed_amount:=CASE direction WHEN 'DEBIT' THEN unsigned_amount ELSE -unsigned_amount END;
    INSERT INTO wbs_controlled_test_bank_import_row(tenant_id,entity_id,wbs_controlled_test_bank_import_id,row_index,source_record_hash,original_transaction_date,posting_transaction_date,direction,signed_amount,raw_event_id,source_document_id,source_document_line_id,bank_source_id)
      VALUES(p_tenant,p_entity,import_id,row_index,source_hash,original_date,posting_date,direction,signed_amount,raw_id,source_id,line_id,bank_id);
    row_index:=row_index+1;
  END LOOP;
  INSERT INTO source_link(tenant_id,entity_id,link_type,source_document_id,bank_source_id,reconciliation_id,created_by)
    SELECT p_tenant,p_entity,'WBS_CONTROLLED_TEST_BANK_RECONCILIATION',r.source_document_id,r.bank_source_id,reconciliation_id,actor
    FROM wbs_controlled_test_bank_import_row r WHERE r.tenant_id=p_tenant AND r.entity_id=p_entity AND r.wbs_controlled_test_bank_import_id=import_id;
  event_payload:=jsonb_build_object('wbs_controlled_test_bank_import_id',import_id,'reconciliation_id',reconciliation_id,'bank_account_ref',p_bank_account_ref,'transaction_count',rows_count,'test_only',true,'provenance_mode','CONTROLLED_TEST_UNSIGNED','observation_hash',p_observation->>'observation_hash');
  INSERT INTO audit_event(tenant_id,entity_id,event_type,object_type,object_id,action,actor_id,actor_type,permission_used,request_id,correlation_id,idempotency_key,after_hash,reason,metadata)
    VALUES(p_tenant,p_entity,'WBS_CONTROLLED_TEST_BANK_IMPORTED','WBS_CONTROLLED_TEST_BANK',import_id,'IMPORT_TEST_BANK',actor,'USER','WBS.TEST.IMPORT',p_idempotency_key,p_idempotency_key,p_idempotency_key,p_request_hash,'Explicit controlled unsigned test-only Bank bridge',event_payload);
  INSERT INTO outbox_event(tenant_id,entity_id,aggregate_type,aggregate_id,event_type,payload,payload_hash)
    VALUES(p_tenant,p_entity,'WBS_CONTROLLED_TEST_BANK',import_id,'WBS_CONTROLLED_TEST_BANK_IMPORTED',event_payload,refs_jsonb_hash(event_payload));
  response:=jsonb_build_object('wbs_controlled_test_bank_import_id',import_id,'reconciliation_id',reconciliation_id,'bank_account_ref',p_bank_account_ref,'statement_ending_date',ends_on,'transaction_count',rows_count,'bank_source_ids',bank_ids,'status','DRAFT','test_only',true,'provenance_mode','CONTROLLED_TEST_UNSIGNED','idempotent',false);
  UPDATE idempotency_receipt SET status='SUCCEEDED',response_status=201,response_body=response,completed_at=clock_timestamp() WHERE idempotency_receipt_id=idem.idempotency_receipt_id;
  RETURN response;
END $$;

REVOKE ALL ON TABLE wbs_controlled_test_bank_import,wbs_controlled_test_bank_import_row FROM PUBLIC,refs_app;
GRANT SELECT ON TABLE wbs_controlled_test_bank_import,wbs_controlled_test_bank_import_row TO refs_app;
REVOKE ALL ON FUNCTION refs_create_wbs_controlled_test_bank_scope_hash(uuid,uuid,uuid,text,jsonb,text) FROM PUBLIC;
REVOKE ALL ON FUNCTION refs_create_wbs_controlled_test_bank_scope(uuid,uuid,uuid,text,jsonb,text,text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION refs_create_wbs_controlled_test_bank_scope_hash(uuid,uuid,uuid,text,jsonb,text) TO refs_app;
GRANT EXECUTE ON FUNCTION refs_create_wbs_controlled_test_bank_scope(uuid,uuid,uuid,text,jsonb,text,text,text) TO refs_app;

COMMIT;
