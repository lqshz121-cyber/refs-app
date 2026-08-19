BEGIN;

CREATE TABLE wbs_test_bank_import_stage (
  wbs_test_bank_import_stage_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant(tenant_id),
  entity_id uuid NOT NULL,
  period_id uuid NOT NULL,
  company_code text NOT NULL CHECK(company_code~'^[A-Z0-9][A-Z0-9_:-]{0,63}$'),
  bank_account_ref text NOT NULL CHECK(bank_account_ref~'^WBS_TEST_BANK(?:_2026_0[1-6])?$'),
  observation_hash text NOT NULL CHECK(observation_hash~'^sha256:[0-9a-f]{64}$'),
  provider_content_sha256 text NOT NULL CHECK(provider_content_sha256~'^[0-9a-f]{64}$'),
  rows_hash text NOT NULL CHECK(rows_hash~'^sha256:[0-9a-f]{64}$'),
  expected_row_count integer NOT NULL CHECK(expected_row_count BETWEEN 1 AND 10000),
  expected_activity numeric(20,4) NOT NULL,
  statement_start_date date NOT NULL,
  statement_end_date date NOT NULL,
  import_batch_id uuid NOT NULL UNIQUE,
  root_idempotency_key text NOT NULL CHECK(length(root_idempotency_key) BETWEEN 8 AND 160),
  root_request_hash text NOT NULL CHECK(root_request_hash~'^sha256:[0-9a-f]{64}$'),
  created_by text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE(tenant_id,entity_id,observation_hash,bank_account_ref),
  UNIQUE(tenant_id,entity_id,wbs_test_bank_import_stage_id),
  FOREIGN KEY(tenant_id,entity_id) REFERENCES entity(tenant_id,entity_id),
  FOREIGN KEY(tenant_id,entity_id,period_id) REFERENCES accounting_period(tenant_id,entity_id,period_id)
);

CREATE TABLE wbs_test_bank_import_stage_chunk (
  wbs_test_bank_import_stage_chunk_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  entity_id uuid NOT NULL,
  wbs_test_bank_import_stage_id uuid NOT NULL,
  chunk_index integer NOT NULL CHECK(chunk_index BETWEEN 0 AND 99),
  chunk_hash text NOT NULL CHECK(chunk_hash~'^sha256:[0-9a-f]{64}$'),
  row_count integer NOT NULL CHECK(row_count BETWEEN 1 AND 100),
  activity numeric(20,4) NOT NULL,
  idempotency_key text NOT NULL CHECK(length(idempotency_key) BETWEEN 8 AND 180),
  created_by text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE(tenant_id,entity_id,wbs_test_bank_import_stage_id,chunk_index),
  FOREIGN KEY(tenant_id,entity_id,wbs_test_bank_import_stage_id)
    REFERENCES wbs_test_bank_import_stage(tenant_id,entity_id,wbs_test_bank_import_stage_id)
);

CREATE TABLE wbs_test_bank_import_stage_row (
  wbs_test_bank_import_stage_row_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  entity_id uuid NOT NULL,
  wbs_test_bank_import_stage_id uuid NOT NULL,
  chunk_index integer NOT NULL,
  row_index integer NOT NULL CHECK(row_index BETWEEN 0 AND 9999),
  row_payload jsonb NOT NULL,
  source_record_hash text NOT NULL CHECK(source_record_hash~'^sha256:[0-9a-f]{64}$'),
  original_transaction_date date NOT NULL,
  posting_transaction_date date NOT NULL,
  direction text NOT NULL CHECK(direction IN ('DEBIT','CREDIT')),
  unsigned_amount numeric(20,4) NOT NULL CHECK(unsigned_amount>0),
  signed_amount numeric(20,4) NOT NULL CHECK(signed_amount<>0),
  raw_event_id uuid NOT NULL UNIQUE,
  source_document_id uuid NOT NULL UNIQUE,
  source_document_line_id uuid NOT NULL UNIQUE,
  bank_source_id uuid NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE(tenant_id,entity_id,wbs_test_bank_import_stage_id,row_index),
  UNIQUE(tenant_id,entity_id,wbs_test_bank_import_stage_id,source_record_hash),
  FOREIGN KEY(tenant_id,entity_id,wbs_test_bank_import_stage_id,chunk_index)
    REFERENCES wbs_test_bank_import_stage_chunk(tenant_id,entity_id,wbs_test_bank_import_stage_id,chunk_index)
);

CREATE TABLE wbs_test_bank_import_stage_final (
  wbs_test_bank_import_stage_final_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  entity_id uuid NOT NULL,
  wbs_test_bank_import_stage_id uuid NOT NULL,
  wbs_controlled_test_bank_import_id uuid NOT NULL,
  reconciliation_id uuid NOT NULL,
  response_body jsonb NOT NULL,
  finalized_by text NOT NULL,
  finalized_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE(tenant_id,entity_id,wbs_test_bank_import_stage_id),
  FOREIGN KEY(tenant_id,entity_id,wbs_test_bank_import_stage_id)
    REFERENCES wbs_test_bank_import_stage(tenant_id,entity_id,wbs_test_bank_import_stage_id),
  FOREIGN KEY(tenant_id,entity_id,wbs_controlled_test_bank_import_id)
    REFERENCES wbs_controlled_test_bank_import(tenant_id,entity_id,wbs_controlled_test_bank_import_id),
  FOREIGN KEY(tenant_id,entity_id,reconciliation_id) REFERENCES reconciliation(tenant_id,entity_id,reconciliation_id)
);

ALTER TABLE wbs_test_bank_import_stage ENABLE ROW LEVEL SECURITY;
ALTER TABLE wbs_test_bank_import_stage_chunk ENABLE ROW LEVEL SECURITY;
ALTER TABLE wbs_test_bank_import_stage_row ENABLE ROW LEVEL SECURITY;
ALTER TABLE wbs_test_bank_import_stage_final ENABLE ROW LEVEL SECURITY;
CREATE POLICY wbs_test_bank_import_stage_scope ON wbs_test_bank_import_stage USING(tenant_id=refs_current_tenant() AND refs_entity_allowed(entity_id)) WITH CHECK(tenant_id=refs_current_tenant() AND refs_entity_allowed(entity_id));
CREATE POLICY wbs_test_bank_import_stage_chunk_scope ON wbs_test_bank_import_stage_chunk USING(tenant_id=refs_current_tenant() AND refs_entity_allowed(entity_id)) WITH CHECK(tenant_id=refs_current_tenant() AND refs_entity_allowed(entity_id));
CREATE POLICY wbs_test_bank_import_stage_row_scope ON wbs_test_bank_import_stage_row USING(tenant_id=refs_current_tenant() AND refs_entity_allowed(entity_id)) WITH CHECK(tenant_id=refs_current_tenant() AND refs_entity_allowed(entity_id));
CREATE POLICY wbs_test_bank_import_stage_final_scope ON wbs_test_bank_import_stage_final USING(tenant_id=refs_current_tenant() AND refs_entity_allowed(entity_id)) WITH CHECK(tenant_id=refs_current_tenant() AND refs_entity_allowed(entity_id));
CREATE TRIGGER wbs_test_bank_import_stage_append_only BEFORE UPDATE OR DELETE ON wbs_test_bank_import_stage FOR EACH ROW EXECUTE FUNCTION reject_mutation();
CREATE TRIGGER wbs_test_bank_import_stage_chunk_append_only BEFORE UPDATE OR DELETE ON wbs_test_bank_import_stage_chunk FOR EACH ROW EXECUTE FUNCTION reject_mutation();
CREATE TRIGGER wbs_test_bank_import_stage_row_append_only BEFORE UPDATE OR DELETE ON wbs_test_bank_import_stage_row FOR EACH ROW EXECUTE FUNCTION reject_mutation();
CREATE TRIGGER wbs_test_bank_import_stage_final_append_only BEFORE UPDATE OR DELETE ON wbs_test_bank_import_stage_final FOR EACH ROW EXECUTE FUNCTION reject_mutation();

CREATE FUNCTION refs_begin_wbs_test_bank_staged_import(
  p_tenant uuid,p_entity uuid,p_period uuid,p_company_code text,p_observation jsonb,p_bank_account_ref text,
  p_idempotency_key text,p_request_hash text
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE actor text:=refs_current_actor(); idem idempotency_receipt; entity_row entity; period_row accounting_period;
DECLARE stage_row wbs_test_bank_import_stage; final_row wbs_test_bank_import_stage_final;
DECLARE rows_count integer; bad_count integer; distinct_count integer; activity numeric(20,4); observed_from date; observed_to date;
DECLARE rows_hash text; next_chunk integer; chunk_count integer;
BEGIN
  PERFORM refs_assert_scope(p_tenant,p_entity,'WBS.TEST.IMPORT');
  PERFORM refs_assert_scope(p_tenant,p_entity,'BANK.RECONCILIATION.START');
  IF actor IS NULL OR p_request_hash<>refs_create_wbs_controlled_test_bank_scope_hash(p_tenant,p_entity,p_period,p_company_code,p_observation,p_bank_account_ref)
     OR p_idempotency_key IS NULL OR length(p_idempotency_key) NOT BETWEEN 8 AND 160 THEN
    RAISE EXCEPTION 'Controlled test Bank staged request is not canonical' USING ERRCODE='22023';
  END IF;
  IF p_bank_account_ref!~'^WBS_TEST_BANK(?:_2026_0[1-6])?$' OR p_company_code IS NULL OR p_company_code!~'^[A-Z0-9][A-Z0-9_:-]{0,63}$'
     OR jsonb_typeof(p_observation)<>'object'
     OR (p_observation-'schema_version'-'status'-'observation_mode'-'source_system'-'tool'-'environment'-'entity_id'-'captured_at'-'provider_content_sha256'-'scope'-'record_count'-'rows'-'signature_verified'-'can_import'-'can_create_transaction'-'can_match'-'can_allocate'-'can_create_draft'-'can_approve'-'can_post'-'can_reverse'-'observation_hash')<>'{}'::jsonb
     OR p_observation->>'schema_version'<>'WBS_LIVE_PILOT_OBSERVATION_V1' OR p_observation->>'status'<>'NOT_ADMITTED'
     OR p_observation->>'observation_mode'<>'UNSIGNED_PILOT' OR p_observation->>'source_system'<>'WBS'
     OR p_observation->>'tool'<>'list_bank_transactions' OR p_observation->>'environment'<>'PRODUCTION'
     OR p_observation->>'entity_id'<>p_entity::text OR p_observation->>'signature_verified'<>'false'
     OR p_observation->>'can_import'<>'false' OR p_observation->>'can_create_transaction'<>'false'
     OR p_observation->>'can_match'<>'false' OR p_observation->>'can_allocate'<>'false'
     OR p_observation->>'can_create_draft'<>'false' OR p_observation->>'can_approve'<>'false'
     OR p_observation->>'can_post'<>'false' OR p_observation->>'can_reverse'<>'false'
     OR COALESCE(p_observation->>'observation_hash','')!~'^sha256:[0-9a-f]{64}$'
     OR COALESCE(p_observation->>'provider_content_sha256','')!~'^[0-9a-f]{64}$'
     OR jsonb_typeof(p_observation->'rows')<>'array'
     OR p_observation->'scope'->'company_codes'<>jsonb_build_array(p_company_code)
     OR jsonb_typeof(p_observation->'scope'->'date_range')<>'array' OR jsonb_array_length(p_observation->'scope'->'date_range')<>2 THEN
    RAISE EXCEPTION 'Only one closed unsigned live WBS Bank observation may enter the staged bridge' USING ERRCODE='22023';
  END IF;
  BEGIN observed_from:=(p_observation->'scope'->'date_range'->>0)::date; observed_to:=(p_observation->'scope'->'date_range'->>1)::date;
  EXCEPTION WHEN OTHERS THEN RAISE EXCEPTION 'Controlled test Bank Provider date scope is invalid' USING ERRCODE='22023'; END;
  rows_count:=jsonb_array_length(p_observation->'rows');
  IF rows_count NOT BETWEEN 1 AND 10000 OR p_observation->>'record_count'<>rows_count::text
     OR observed_from::text<>p_observation->'scope'->'date_range'->>0 OR observed_to::text<>p_observation->'scope'->'date_range'->>1 OR observed_from>observed_to THEN
    RAISE EXCEPTION 'Controlled test Bank staged population is invalid' USING ERRCODE='22023';
  END IF;
  SELECT count(*) FILTER(WHERE jsonb_typeof(value)<>'object' OR (value-'source_record_hash'-'currency'-'accounting_date'-'amount'-'direction'-'status')<>'{}'::jsonb
      OR COALESCE(value->>'source_record_hash','')!~'^sha256:[0-9a-f]{64}$' OR value->>'currency'<>'USD'
      OR COALESCE(value->>'accounting_date','')!~'^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
      OR COALESCE(value->>'amount','')!~'^(?:0|[1-9][0-9]{0,15})\.[0-9]{4}$' OR (value->>'amount')::numeric=0
      OR value->>'direction' NOT IN ('DEBIT','CREDIT') OR COALESCE(length(value->>'status'),0) NOT BETWEEN 1 AND 64),
    count(DISTINCT value->>'source_record_hash'),
    sum(CASE value->>'direction' WHEN 'DEBIT' THEN (value->>'amount')::numeric ELSE -(value->>'amount')::numeric END)::numeric(20,4)
    INTO bad_count,distinct_count,activity FROM jsonb_array_elements(p_observation->'rows');
  IF bad_count<>0 OR distinct_count<>rows_count OR EXISTS(
    SELECT 1 FROM jsonb_array_elements(p_observation->'rows') e(value)
    WHERE (value->>'accounting_date')::date NOT BETWEEN observed_from AND observed_to
  ) THEN RAISE EXCEPTION 'Sanitized staged Bank rows are invalid or duplicated' USING ERRCODE='22023'; END IF;
  SELECT * INTO entity_row FROM entity WHERE tenant_id=p_tenant AND entity_id=p_entity AND active FOR SHARE;
  SELECT * INTO period_row FROM accounting_period WHERE tenant_id=p_tenant AND entity_id=p_entity AND period_id=p_period AND status='OPEN' FOR SHARE;
  IF entity_row.entity_id IS NULL OR entity_row.base_currency<>'USD' THEN RAISE EXCEPTION 'Controlled test Bank entity scope is invalid' USING ERRCODE='42501'; END IF;
  IF period_row.period_id IS NULL OR (p_bank_account_ref<>'WBS_TEST_BANK' AND (observed_from<>period_row.starts_on OR observed_to<>period_row.ends_on)) THEN RAISE EXCEPTION 'Controlled test Bank monthly import requires its exact OPEN month' USING ERRCODE='55000'; END IF;
  rows_hash:=refs_jsonb_hash(p_observation->'rows'); chunk_count:=ceil(rows_count/100.0)::integer;
  INSERT INTO idempotency_receipt(tenant_id,operation_scope,idempotency_key,request_hash,status,actor_id)
    VALUES(p_tenant,'WBS_CONTROLLED_TEST_BANK:'||p_entity,p_idempotency_key,p_request_hash,'IN_PROGRESS',actor) ON CONFLICT DO NOTHING;
  SELECT * INTO idem FROM idempotency_receipt WHERE tenant_id=p_tenant AND operation_scope='WBS_CONTROLLED_TEST_BANK:'||p_entity AND idempotency_key=p_idempotency_key FOR UPDATE;
  IF idem.request_hash<>p_request_hash OR idem.actor_id<>actor THEN RAISE EXCEPTION 'Controlled test Bank idempotency conflict' USING ERRCODE='23505'; END IF;
  IF idem.status='SUCCEEDED' THEN RETURN idem.response_body||jsonb_build_object('idempotent',true); END IF;
  SELECT * INTO stage_row FROM wbs_test_bank_import_stage WHERE tenant_id=p_tenant AND entity_id=p_entity AND observation_hash=p_observation->>'observation_hash' AND bank_account_ref=p_bank_account_ref FOR SHARE;
  IF NOT FOUND THEN
    INSERT INTO wbs_test_bank_import_stage(tenant_id,entity_id,period_id,company_code,bank_account_ref,observation_hash,provider_content_sha256,rows_hash,expected_row_count,expected_activity,statement_start_date,statement_end_date,import_batch_id,root_idempotency_key,root_request_hash,created_by)
      VALUES(p_tenant,p_entity,p_period,p_company_code,p_bank_account_ref,p_observation->>'observation_hash',p_observation->>'provider_content_sha256',rows_hash,rows_count,activity,period_row.starts_on,period_row.ends_on,gen_random_uuid(),p_idempotency_key,p_request_hash,actor)
      RETURNING * INTO stage_row;
  ELSIF stage_row.period_id<>p_period OR stage_row.company_code<>p_company_code OR stage_row.provider_content_sha256<>p_observation->>'provider_content_sha256' OR stage_row.rows_hash<>rows_hash OR stage_row.expected_row_count<>rows_count OR stage_row.expected_activity<>activity OR stage_row.root_idempotency_key<>p_idempotency_key OR stage_row.root_request_hash<>p_request_hash OR stage_row.created_by<>actor THEN
    RAISE EXCEPTION 'Controlled test Bank staged root conflicts with retained facts' USING ERRCODE='23505';
  END IF;
  SELECT * INTO final_row FROM wbs_test_bank_import_stage_final WHERE tenant_id=p_tenant AND entity_id=p_entity AND wbs_test_bank_import_stage_id=stage_row.wbs_test_bank_import_stage_id;
  IF FOUND THEN RETURN final_row.response_body||jsonb_build_object('idempotent',true); END IF;
  SELECT count(*) INTO next_chunk FROM wbs_test_bank_import_stage_chunk WHERE tenant_id=p_tenant AND entity_id=p_entity AND wbs_test_bank_import_stage_id=stage_row.wbs_test_bank_import_stage_id;
  RETURN jsonb_build_object('status','WBS_TEST_BANK_IMPORT_PARTIAL','stage_id',stage_row.wbs_test_bank_import_stage_id,'next_chunk_index',next_chunk,'chunk_count',chunk_count,'transaction_count',rows_count,'test_only',true,'provenance_mode','CONTROLLED_TEST_UNSIGNED','idempotent',next_chunk>0);
END $$;

CREATE FUNCTION refs_append_wbs_test_bank_staged_chunk(
  p_tenant uuid,p_entity uuid,p_stage uuid,p_chunk_index integer,p_rows jsonb,p_idempotency_key text
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE actor text:=refs_current_actor(); parent wbs_test_bank_import_stage; retained wbs_test_bank_import_stage_chunk;
DECLARE expected_size integer; chunk_hash text; chunk_activity numeric(20,4); bad_count integer; distinct_count integer; next_chunk integer;
BEGIN
  PERFORM refs_assert_scope(p_tenant,p_entity,'WBS.TEST.IMPORT'); PERFORM refs_assert_scope(p_tenant,p_entity,'BANK.RECONCILIATION.START');
  SELECT * INTO parent FROM wbs_test_bank_import_stage WHERE tenant_id=p_tenant AND entity_id=p_entity AND wbs_test_bank_import_stage_id=p_stage FOR SHARE;
  IF NOT FOUND OR parent.created_by<>actor THEN RAISE EXCEPTION 'Controlled test Bank stage is unavailable' USING ERRCODE='42501'; END IF;
  IF EXISTS(SELECT 1 FROM wbs_test_bank_import_stage_final WHERE tenant_id=p_tenant AND entity_id=p_entity AND wbs_test_bank_import_stage_id=p_stage) THEN
    RAISE EXCEPTION 'Controlled test Bank stage is already final' USING ERRCODE='55000';
  END IF;
  SELECT count(*) INTO next_chunk FROM wbs_test_bank_import_stage_chunk WHERE tenant_id=p_tenant AND entity_id=p_entity AND wbs_test_bank_import_stage_id=p_stage;
  expected_size:=least(100,parent.expected_row_count-p_chunk_index*100);
  IF p_chunk_index<0 OR p_chunk_index>=ceil(parent.expected_row_count/100.0)::integer OR jsonb_typeof(p_rows)<>'array' OR jsonb_array_length(p_rows)<>expected_size OR p_idempotency_key<>parent.root_idempotency_key||':chunk:'||p_chunk_index THEN
    RAISE EXCEPTION 'Controlled test Bank staged chunk boundary is invalid' USING ERRCODE='22023';
  END IF;
  chunk_hash:=refs_jsonb_hash(p_rows);
  SELECT * INTO retained FROM wbs_test_bank_import_stage_chunk WHERE tenant_id=p_tenant AND entity_id=p_entity AND wbs_test_bank_import_stage_id=p_stage AND chunk_index=p_chunk_index FOR SHARE;
  IF FOUND THEN
    IF retained.chunk_hash<>chunk_hash OR retained.idempotency_key<>p_idempotency_key THEN RAISE EXCEPTION 'Controlled test Bank staged chunk replay changed' USING ERRCODE='23505'; END IF;
    RETURN jsonb_build_object('status','WBS_TEST_BANK_IMPORT_PARTIAL','stage_id',p_stage,'chunk_index',p_chunk_index,'idempotent',true);
  END IF;
  IF p_chunk_index<>next_chunk THEN RAISE EXCEPTION 'Controlled test Bank staged chunks must be appended continuously' USING ERRCODE='55000'; END IF;
  SELECT count(*) FILTER(WHERE jsonb_typeof(value)<>'object' OR (value-'source_record_hash'-'currency'-'accounting_date'-'amount'-'direction'-'status')<>'{}'::jsonb
      OR COALESCE(value->>'source_record_hash','')!~'^sha256:[0-9a-f]{64}$' OR value->>'currency'<>'USD'
      OR COALESCE(value->>'accounting_date','')!~'^[0-9]{4}-[0-9]{2}-[0-9]{2}$' OR (value->>'accounting_date')::date NOT BETWEEN parent.statement_start_date AND parent.statement_end_date
      OR COALESCE(value->>'amount','')!~'^(?:0|[1-9][0-9]{0,15})\.[0-9]{4}$' OR (value->>'amount')::numeric=0
      OR value->>'direction' NOT IN ('DEBIT','CREDIT') OR COALESCE(length(value->>'status'),0) NOT BETWEEN 1 AND 64),
    count(DISTINCT value->>'source_record_hash'),sum(CASE value->>'direction' WHEN 'DEBIT' THEN (value->>'amount')::numeric ELSE -(value->>'amount')::numeric END)::numeric(20,4)
    INTO bad_count,distinct_count,chunk_activity FROM jsonb_array_elements(p_rows);
  IF bad_count<>0 OR distinct_count<>expected_size
     OR EXISTS(SELECT 1 FROM wbs_test_bank_import_stage_row r JOIN jsonb_array_elements(p_rows) e ON e->>'source_record_hash'=r.source_record_hash WHERE r.tenant_id=p_tenant AND r.entity_id=p_entity AND r.wbs_test_bank_import_stage_id=p_stage) THEN
    RAISE EXCEPTION 'Controlled test Bank staged chunk rows are invalid or duplicated' USING ERRCODE='22023';
  END IF;
  INSERT INTO wbs_test_bank_import_stage_chunk(tenant_id,entity_id,wbs_test_bank_import_stage_id,chunk_index,chunk_hash,row_count,activity,idempotency_key,created_by)
    VALUES(p_tenant,p_entity,p_stage,p_chunk_index,chunk_hash,expected_size,chunk_activity,p_idempotency_key,actor);
  INSERT INTO wbs_test_bank_import_stage_row(tenant_id,entity_id,wbs_test_bank_import_stage_id,chunk_index,row_index,row_payload,source_record_hash,original_transaction_date,posting_transaction_date,direction,unsigned_amount,signed_amount,raw_event_id,source_document_id,source_document_line_id,bank_source_id)
    SELECT p_tenant,p_entity,p_stage,p_chunk_index,p_chunk_index*100+ordinality-1,value,value->>'source_record_hash',(value->>'accounting_date')::date,greatest(parent.statement_start_date,least((value->>'accounting_date')::date,parent.statement_end_date)),value->>'direction',(value->>'amount')::numeric(20,4),CASE value->>'direction' WHEN 'DEBIT' THEN (value->>'amount')::numeric(20,4) ELSE -(value->>'amount')::numeric(20,4) END,gen_random_uuid(),gen_random_uuid(),gen_random_uuid(),gen_random_uuid()
    FROM jsonb_array_elements(p_rows) WITH ORDINALITY e(value,ordinality);
  RETURN jsonb_build_object('status','WBS_TEST_BANK_IMPORT_PARTIAL','stage_id',p_stage,'chunk_index',p_chunk_index,'idempotent',false);
END $$;

CREATE FUNCTION refs_finalize_wbs_test_bank_staged_import(p_tenant uuid,p_entity uuid,p_stage uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE actor text:=refs_current_actor(); parent wbs_test_bank_import_stage; final_row wbs_test_bank_import_stage_final; entity_row entity;
DECLARE actual_count integer; actual_activity numeric(20,4); actual_rows_hash text; chunk_count integer; reconciliation_result jsonb; reconciliation_id uuid; import_id uuid:=gen_random_uuid(); response jsonb; bank_ids jsonb; event_payload jsonb;
BEGIN
  PERFORM refs_assert_scope(p_tenant,p_entity,'WBS.TEST.IMPORT'); PERFORM refs_assert_scope(p_tenant,p_entity,'BANK.RECONCILIATION.START');
  SELECT * INTO parent FROM wbs_test_bank_import_stage WHERE tenant_id=p_tenant AND entity_id=p_entity AND wbs_test_bank_import_stage_id=p_stage FOR UPDATE;
  IF NOT FOUND OR parent.created_by<>actor THEN RAISE EXCEPTION 'Controlled test Bank stage is unavailable' USING ERRCODE='42501'; END IF;
  SELECT * INTO final_row FROM wbs_test_bank_import_stage_final WHERE tenant_id=p_tenant AND entity_id=p_entity AND wbs_test_bank_import_stage_id=p_stage;
  IF FOUND THEN RETURN final_row.response_body||jsonb_build_object('idempotent',true); END IF;
  SELECT count(*),coalesce(sum(signed_amount),0)::numeric(20,4),refs_jsonb_hash(jsonb_agg(row_payload ORDER BY row_index)) INTO actual_count,actual_activity,actual_rows_hash FROM wbs_test_bank_import_stage_row WHERE tenant_id=p_tenant AND entity_id=p_entity AND wbs_test_bank_import_stage_id=p_stage;
  SELECT count(*) INTO chunk_count FROM wbs_test_bank_import_stage_chunk WHERE tenant_id=p_tenant AND entity_id=p_entity AND wbs_test_bank_import_stage_id=p_stage;
  IF actual_count<>parent.expected_row_count OR actual_activity<>parent.expected_activity OR actual_rows_hash<>parent.rows_hash OR chunk_count<>ceil(parent.expected_row_count/100.0)::integer THEN
    RAISE EXCEPTION 'Controlled test Bank stage is incomplete or aggregate-mismatched' USING ERRCODE='55000';
  END IF;
  SELECT * INTO entity_row FROM entity WHERE tenant_id=p_tenant AND entity_id=p_entity AND active FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Controlled test Bank entity is unavailable' USING ERRCODE='42501'; END IF;
  INSERT INTO member_master(tenant_id,entity_id,member_ref,member_type,display_name,active) VALUES(p_tenant,p_entity,parent.bank_account_ref,'BANK','WBS Controlled Test Bank',true) ON CONFLICT DO NOTHING;
  PERFORM 1 FROM member_master WHERE tenant_id=p_tenant AND entity_id=p_entity AND member_ref=parent.bank_account_ref AND member_type='BANK' AND active FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Controlled test Bank member conflicts with existing master data' USING ERRCODE='23514'; END IF;
  INSERT INTO import_batch(import_batch_id,tenant_id,entity_id,connector_code,source_module,source_entity_id,idempotency_key,request_hash,status,row_count,started_at,completed_at)
    VALUES(parent.import_batch_id,p_tenant,p_entity,'WBS_TEST','bankFeed',entity_row.source_entity_id,parent.root_idempotency_key,parent.root_request_hash,'SUCCEEDED',parent.expected_row_count,clock_timestamp(),clock_timestamp());
  INSERT INTO raw_event(raw_event_id,tenant_id,entity_id,import_batch_id,source_system,source_module,source_entity_id,source_record_id,source_version,event_type,occurred_at,payload_hash,payload_ref,correlation_id)
    SELECT r.raw_event_id,p_tenant,p_entity,parent.import_batch_id,entity_row.source_system,'bankFeed',entity_row.source_entity_id,'test-bank:'||lower(parent.bank_account_ref)||':'||substr(r.source_record_hash,8,24),'test:'||substr(parent.observation_hash,8),'UPSERT',r.original_transaction_date::timestamptz,r.source_record_hash,'object://refs-test-only/'||p_entity||'/bank/'||lower(parent.bank_account_ref)||'/'||substr(r.source_record_hash,8),parent.root_idempotency_key FROM wbs_test_bank_import_stage_row r WHERE r.tenant_id=p_tenant AND r.entity_id=p_entity AND r.wbs_test_bank_import_stage_id=p_stage ORDER BY r.row_index;
  INSERT INTO source_document(source_document_id,tenant_id,entity_id,raw_event_id,source_system,source_module,source_entity_id,source_record_id,source_version,document_type,document_no,business_date,accounting_date,currency,gross_amount,status,source_ref,payload_hash)
    SELECT r.source_document_id,p_tenant,p_entity,r.raw_event_id,entity_row.source_system,'bankFeed',entity_row.source_entity_id,'test-bank:'||lower(parent.bank_account_ref)||':'||substr(r.source_record_hash,8,24),'test:'||substr(parent.observation_hash,8),'WBS_TEST_BANK_TRANSACTION','WBS-TEST-BANK-'||upper(substr(r.source_record_hash,8,16)),r.original_transaction_date,r.posting_transaction_date,'USD',r.signed_amount,'RECEIVED','object://refs-test-only/'||p_entity||'/bank/'||lower(parent.bank_account_ref)||'/'||substr(r.source_record_hash,8),r.source_record_hash FROM wbs_test_bank_import_stage_row r WHERE r.tenant_id=p_tenant AND r.entity_id=p_entity AND r.wbs_test_bank_import_stage_id=p_stage ORDER BY r.row_index;
  INSERT INTO source_document_line(source_document_line_id,tenant_id,entity_id,source_document_id,source_line_id,line_no,amount,direction,description,bank_account_ref,external_dimension_refs)
    SELECT r.source_document_line_id,p_tenant,p_entity,r.source_document_id,'test-bank:'||lower(parent.bank_account_ref)||':'||substr(r.source_record_hash,8,24),1,r.unsigned_amount,r.direction,'Sanitized unsigned WBS controlled test Bank transaction',parent.bank_account_ref,jsonb_build_object('schema_version','WBS_CONTROLLED_TEST_BANK_LINE_V1','test_only',true,'provenance_mode','CONTROLLED_TEST_UNSIGNED','observation_hash',parent.observation_hash,'source_record_hash',r.source_record_hash,'provider_content_sha256',parent.provider_content_sha256,'row_index',r.row_index,'original_transaction_date',r.original_transaction_date,'posting_transaction_date',r.posting_transaction_date,'provider_status',r.row_payload->>'status') FROM wbs_test_bank_import_stage_row r WHERE r.tenant_id=p_tenant AND r.entity_id=p_entity AND r.wbs_test_bank_import_stage_id=p_stage ORDER BY r.row_index;
  INSERT INTO bank_source(bank_source_id,tenant_id,entity_id,source_document_id,source_line_id,bank_account_ref,external_bank_line_id,transaction_date,currency,amount)
    SELECT r.bank_source_id,p_tenant,p_entity,r.source_document_id,r.source_document_line_id,parent.bank_account_ref,'WBS-TEST-BANK-'||upper(substr(r.source_record_hash,8,16)),r.posting_transaction_date,'USD',r.signed_amount FROM wbs_test_bank_import_stage_row r WHERE r.tenant_id=p_tenant AND r.entity_id=p_entity AND r.wbs_test_bank_import_stage_id=p_stage ORDER BY r.row_index;
  INSERT INTO source_link(tenant_id,entity_id,link_type,raw_event_id,source_document_id,source_document_line_id,bank_source_id,created_by)
    SELECT p_tenant,p_entity,'WBS_CONTROLLED_TEST_BANK_SOURCE',r.raw_event_id,r.source_document_id,r.source_document_line_id,r.bank_source_id,actor FROM wbs_test_bank_import_stage_row r WHERE r.tenant_id=p_tenant AND r.entity_id=p_entity AND r.wbs_test_bank_import_stage_id=p_stage ORDER BY r.row_index;
  reconciliation_result:=refs_start_reconciliation(p_tenant,p_entity,parent.bank_account_ref,parent.statement_end_date,0,parent.expected_activity,'Start controlled TEST_ONLY unsigned WBS Bank reconciliation',parent.root_idempotency_key||':reconciliation',refs_reconciliation_start_hash(p_tenant,p_entity,parent.bank_account_ref,parent.statement_end_date,0,parent.expected_activity,'Start controlled TEST_ONLY unsigned WBS Bank reconciliation'));
  reconciliation_id:=(reconciliation_result->>'reconciliation_id')::uuid;
  INSERT INTO wbs_controlled_test_bank_import(wbs_controlled_test_bank_import_id,tenant_id,entity_id,period_id,company_code,bank_account_ref,observation_hash,provider_content_sha256,import_batch_id,reconciliation_id,statement_start_date,statement_end_date,statement_opening_balance,statement_ending_balance,row_count,request_hash,created_by)
    VALUES(import_id,p_tenant,p_entity,parent.period_id,parent.company_code,parent.bank_account_ref,parent.observation_hash,parent.provider_content_sha256,parent.import_batch_id,reconciliation_id,parent.statement_start_date,parent.statement_end_date,0,parent.expected_activity,parent.expected_row_count,parent.root_request_hash,actor);
  INSERT INTO wbs_controlled_test_bank_import_row(tenant_id,entity_id,wbs_controlled_test_bank_import_id,row_index,bank_account_ref,source_record_hash,original_transaction_date,posting_transaction_date,direction,signed_amount,raw_event_id,source_document_id,source_document_line_id,bank_source_id)
    SELECT p_tenant,p_entity,import_id,r.row_index,parent.bank_account_ref,r.source_record_hash,r.original_transaction_date,r.posting_transaction_date,r.direction,r.signed_amount,r.raw_event_id,r.source_document_id,r.source_document_line_id,r.bank_source_id FROM wbs_test_bank_import_stage_row r WHERE r.tenant_id=p_tenant AND r.entity_id=p_entity AND r.wbs_test_bank_import_stage_id=p_stage ORDER BY r.row_index;
  INSERT INTO source_link(tenant_id,entity_id,link_type,source_document_id,bank_source_id,reconciliation_id,created_by)
    SELECT p_tenant,p_entity,'WBS_CONTROLLED_TEST_BANK_RECONCILIATION',r.source_document_id,r.bank_source_id,reconciliation_id,actor FROM wbs_test_bank_import_stage_row r WHERE r.tenant_id=p_tenant AND r.entity_id=p_entity AND r.wbs_test_bank_import_stage_id=p_stage ORDER BY r.row_index;
  SELECT jsonb_agg(bank_source_id ORDER BY row_index) INTO bank_ids FROM wbs_test_bank_import_stage_row WHERE tenant_id=p_tenant AND entity_id=p_entity AND wbs_test_bank_import_stage_id=p_stage;
  event_payload:=jsonb_build_object('wbs_controlled_test_bank_import_id',import_id,'reconciliation_id',reconciliation_id,'bank_account_ref',parent.bank_account_ref,'transaction_count',parent.expected_row_count,'test_only',true,'provenance_mode','CONTROLLED_TEST_UNSIGNED','observation_hash',parent.observation_hash);
  INSERT INTO audit_event(tenant_id,entity_id,event_type,object_type,object_id,action,actor_id,actor_type,permission_used,request_id,correlation_id,idempotency_key,after_hash,reason,metadata) VALUES(p_tenant,p_entity,'WBS_CONTROLLED_TEST_BANK_IMPORTED','WBS_CONTROLLED_TEST_BANK',import_id,'IMPORT_TEST_BANK',actor,'USER','WBS.TEST.IMPORT',parent.root_idempotency_key,parent.root_idempotency_key,parent.root_idempotency_key,parent.root_request_hash,'Explicit controlled unsigned test-only Bank staged bridge',event_payload);
  INSERT INTO outbox_event(tenant_id,entity_id,aggregate_type,aggregate_id,event_type,payload,payload_hash) VALUES(p_tenant,p_entity,'WBS_CONTROLLED_TEST_BANK',import_id,'WBS_CONTROLLED_TEST_BANK_IMPORTED',event_payload,refs_jsonb_hash(event_payload));
  response:=jsonb_build_object('wbs_controlled_test_bank_import_id',import_id,'reconciliation_id',reconciliation_id,'bank_account_ref',parent.bank_account_ref,'statement_ending_date',parent.statement_end_date,'transaction_count',parent.expected_row_count,'bank_source_ids',bank_ids,'status','DRAFT','test_only',true,'provenance_mode','CONTROLLED_TEST_UNSIGNED','idempotent',false);
  INSERT INTO wbs_test_bank_import_stage_final(tenant_id,entity_id,wbs_test_bank_import_stage_id,wbs_controlled_test_bank_import_id,reconciliation_id,response_body,finalized_by) VALUES(p_tenant,p_entity,p_stage,import_id,reconciliation_id,response,actor);
  UPDATE idempotency_receipt SET status='SUCCEEDED',response_status=201,response_body=response,completed_at=clock_timestamp() WHERE tenant_id=p_tenant AND operation_scope='WBS_CONTROLLED_TEST_BANK:'||p_entity AND idempotency_key=parent.root_idempotency_key AND request_hash=parent.root_request_hash AND actor_id=actor AND status='IN_PROGRESS';
  RETURN response;
END $$;

REVOKE ALL ON TABLE wbs_test_bank_import_stage,wbs_test_bank_import_stage_chunk,wbs_test_bank_import_stage_row,wbs_test_bank_import_stage_final FROM PUBLIC,refs_app;
REVOKE ALL ON FUNCTION refs_begin_wbs_test_bank_staged_import(uuid,uuid,uuid,text,jsonb,text,text,text),refs_append_wbs_test_bank_staged_chunk(uuid,uuid,uuid,integer,jsonb,text),refs_finalize_wbs_test_bank_staged_import(uuid,uuid,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION refs_begin_wbs_test_bank_staged_import(uuid,uuid,uuid,text,jsonb,text,text,text),refs_append_wbs_test_bank_staged_chunk(uuid,uuid,uuid,integer,jsonb,text),refs_finalize_wbs_test_bank_staged_import(uuid,uuid,uuid) TO refs_app;

COMMIT;
