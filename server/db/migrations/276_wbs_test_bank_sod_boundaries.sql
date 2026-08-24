BEGIN;

CREATE TABLE wbs_test_bank_import_receipt (
  wbs_test_bank_import_receipt_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  entity_id uuid NOT NULL,
  wbs_test_bank_import_stage_id uuid NOT NULL,
  period_id uuid NOT NULL,
  company_code text NOT NULL,
  bank_account_ref text NOT NULL,
  observation_hash text NOT NULL CHECK(observation_hash~'^sha256:[0-9a-f]{64}$'),
  provider_content_sha256 text NOT NULL CHECK(provider_content_sha256~'^[0-9a-f]{64}$'),
  request_hash text NOT NULL CHECK(request_hash~'^sha256:[0-9a-f]{64}$'),
  receipt_hash text NOT NULL CHECK(receipt_hash~'^sha256:[0-9a-f]{64}$'),
  row_count integer NOT NULL CHECK(row_count BETWEEN 1 AND 10000),
  statement_start_date date NOT NULL,
  statement_end_date date NOT NULL,
  statement_activity numeric(20,4) NOT NULL,
  imported_by text NOT NULL,
  finalized_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  reconciliation_id uuid,
  reconciliation_started_by text,
  reconciliation_started_at timestamptz,
  UNIQUE(tenant_id,entity_id,wbs_test_bank_import_stage_id),
  UNIQUE(tenant_id,entity_id,receipt_hash),
  FOREIGN KEY(tenant_id,entity_id) REFERENCES entity(tenant_id,entity_id),
  FOREIGN KEY(tenant_id,entity_id,period_id) REFERENCES accounting_period(tenant_id,entity_id,period_id),
  FOREIGN KEY(tenant_id,entity_id,wbs_test_bank_import_stage_id) REFERENCES wbs_test_bank_import_stage(tenant_id,entity_id,wbs_test_bank_import_stage_id),
  FOREIGN KEY(tenant_id,entity_id,reconciliation_id) REFERENCES reconciliation(tenant_id,entity_id,reconciliation_id),
  CHECK((reconciliation_id IS NULL AND reconciliation_started_by IS NULL AND reconciliation_started_at IS NULL) OR
        (reconciliation_id IS NOT NULL AND reconciliation_started_by IS NOT NULL AND reconciliation_started_at IS NOT NULL AND reconciliation_started_by<>imported_by))
);

CREATE TABLE wbs_test_bank_adjustment_post_receipt (
  tenant_id uuid NOT NULL,
  entity_id uuid NOT NULL,
  reconciliation_id uuid NOT NULL,
  bank_source_id uuid NOT NULL,
  journal_entry_id uuid NOT NULL,
  journal_posting_batch_id uuid NOT NULL,
  post_hash text NOT NULL CHECK(post_hash~'^sha256:[0-9a-f]{64}$'),
  posted_by text NOT NULL,
  posted_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  cleared_by text,
  cleared_at timestamptz,
  PRIMARY KEY(tenant_id,entity_id,reconciliation_id,bank_source_id),
  UNIQUE(tenant_id,entity_id,post_hash),
  FOREIGN KEY(tenant_id,entity_id,reconciliation_id) REFERENCES reconciliation(tenant_id,entity_id,reconciliation_id),
  FOREIGN KEY(tenant_id,entity_id,bank_source_id) REFERENCES bank_source(tenant_id,entity_id,bank_source_id),
  FOREIGN KEY(tenant_id,entity_id,journal_entry_id) REFERENCES journal_entry(tenant_id,entity_id,journal_entry_id),
  CHECK((cleared_by IS NULL AND cleared_at IS NULL) OR (cleared_by IS NOT NULL AND cleared_at IS NOT NULL AND cleared_by<>posted_by))
);

CREATE TABLE wbs_test_bank_legacy_function_backup (
  function_name text PRIMARY KEY,
  function_definition text NOT NULL
);
INSERT INTO wbs_test_bank_legacy_function_backup(function_name,function_definition) VALUES
 ('refs_begin_wbs_test_bank_staged_import',pg_get_functiondef('refs_begin_wbs_test_bank_staged_import(uuid,uuid,uuid,text,jsonb,text,text,text)'::regprocedure)),
 ('refs_append_wbs_test_bank_staged_chunk',pg_get_functiondef('refs_append_wbs_test_bank_staged_chunk(uuid,uuid,uuid,integer,jsonb,text)'::regprocedure)),
 ('refs_finalize_wbs_test_bank_staged_import',pg_get_functiondef('refs_finalize_wbs_test_bank_staged_import(uuid,uuid,uuid)'::regprocedure)),
 ('refs_wbs_test_bank_adjustment_post_clear_batch',pg_get_functiondef('refs_wbs_test_bank_adjustment_post_clear_batch(uuid,uuid,uuid,uuid,uuid[],text,text)'::regprocedure)),
 ('refs_resolve_wbs_test_bank_match_fixture',pg_get_functiondef('refs_resolve_wbs_test_bank_match_fixture(uuid,uuid)'::regprocedure)),
 ('refs_bind_wbs_test_bank_match_payment_source',pg_get_functiondef('refs_bind_wbs_test_bank_match_payment_source(uuid,uuid,uuid,uuid,uuid)'::regprocedure)),
 ('refs_propose_wbs_test_bank_match_config',pg_get_functiondef('refs_propose_wbs_test_bank_match_config(uuid,uuid)'::regprocedure));

CREATE FUNCTION refs_guard_wbs_test_bank_import_receipt() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP='DELETE' OR ROW(NEW.tenant_id,NEW.entity_id,NEW.wbs_test_bank_import_stage_id,NEW.period_id,NEW.company_code,NEW.bank_account_ref,NEW.observation_hash,NEW.provider_content_sha256,NEW.request_hash,NEW.receipt_hash,NEW.row_count,NEW.statement_start_date,NEW.statement_end_date,NEW.statement_activity,NEW.imported_by,NEW.finalized_at)
    IS DISTINCT FROM ROW(OLD.tenant_id,OLD.entity_id,OLD.wbs_test_bank_import_stage_id,OLD.period_id,OLD.company_code,OLD.bank_account_ref,OLD.observation_hash,OLD.provider_content_sha256,OLD.request_hash,OLD.receipt_hash,OLD.row_count,OLD.statement_start_date,OLD.statement_end_date,OLD.statement_activity,OLD.imported_by,OLD.finalized_at)
    OR OLD.reconciliation_id IS NOT NULL OR NEW.reconciliation_id IS NULL THEN RAISE EXCEPTION 'WBS TEST Bank import receipt is immutable' USING ERRCODE='55000'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER trg_wbs_test_bank_import_receipt_immutable BEFORE UPDATE OR DELETE ON wbs_test_bank_import_receipt FOR EACH ROW EXECUTE FUNCTION refs_guard_wbs_test_bank_import_receipt();

-- Applied migrations 175/184/185 combined SERVICE import with human START and
-- combined POST with CLEAR.  Retain their signatures for upgrade history, but
-- make every legacy entry point fail closed after this migration.
CREATE OR REPLACE FUNCTION refs_finalize_wbs_test_bank_staged_import(p_tenant uuid,p_entity uuid,p_stage uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
BEGIN RAISE EXCEPTION 'Legacy WBS TEST Bank import/start boundary is disabled after migration 276' USING ERRCODE='0A000'; END $$;
CREATE OR REPLACE FUNCTION refs_wbs_test_bank_adjustment_post_clear_batch(
  p_tenant uuid,p_entity uuid,p_reconciliation uuid,p_period uuid,
  p_bank_source_ids uuid[],p_reason text,p_idempotency_root text
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
BEGIN RAISE EXCEPTION 'Legacy WBS TEST Bank POST/CLEAR boundary is disabled after migration 276' USING ERRCODE='0A000'; END $$;
REVOKE ALL ON FUNCTION refs_finalize_wbs_test_bank_staged_import(uuid,uuid,uuid),refs_wbs_test_bank_adjustment_post_clear_batch(uuid,uuid,uuid,uuid,uuid[],text,text) FROM PUBLIC,refs_app;

-- Remove the obsolete human START assertion from the two immutable staging
-- commands without changing their signatures or all other validation logic.
DO $migration$
DECLARE fn text;
BEGIN
  SELECT pg_get_functiondef('refs_begin_wbs_test_bank_staged_import(uuid,uuid,uuid,text,jsonb,text,text,text)'::regprocedure) INTO fn;
  fn:=regexp_replace(fn,E'\\s*PERFORM\\s+(public\\.)?refs_assert_scope\\s*\\([^;]*''BANK\\.RECONCILIATION\\.START''[^;]*\\);','','g');
  IF fn LIKE '%BANK.RECONCILIATION.START%' THEN RAISE EXCEPTION 'Could not remove legacy START assertion from Bank stage begin'; END IF;
  EXECUTE fn;
  SELECT pg_get_functiondef('refs_append_wbs_test_bank_staged_chunk(uuid,uuid,uuid,integer,jsonb,text)'::regprocedure) INTO fn;
  fn:=regexp_replace(fn,E'\\s*PERFORM\\s+(public\\.)?refs_assert_scope\\s*\\([^;]*''BANK\\.RECONCILIATION\\.START''[^;]*\\);','','g');
  IF fn LIKE '%BANK.RECONCILIATION.START%' THEN RAISE EXCEPTION 'Could not remove legacy START assertion from Bank stage append'; END IF;
  EXECUTE fn;
END $migration$;

-- The historical controlled Match helpers also asserted SERVICE import beside
-- human payment/match permissions.  Preserve every other check while moving
-- read/propose to the match maker and source binding to the payment maker.
DO $match_boundary$
DECLARE fn text;
BEGIN
  SELECT pg_get_functiondef('refs_resolve_wbs_test_bank_match_fixture(uuid,uuid)'::regprocedure) INTO fn;
  fn:=regexp_replace(fn,E'\\s*PERFORM\\s+(public\\.)?refs_assert_scope\\s*\\([^;]*''WBS\\.TEST\\.IMPORT''[^;]*\\);','','g');
  IF fn LIKE '%WBS.TEST.IMPORT%' THEN RAISE EXCEPTION 'Could not remove SERVICE assertion from Bank Match fixture read'; END IF;
  EXECUTE fn;
  SELECT pg_get_functiondef('refs_bind_wbs_test_bank_match_payment_source(uuid,uuid,uuid,uuid,uuid)'::regprocedure) INTO fn;
  fn:=regexp_replace(fn,E'\\s*PERFORM\\s+(public\\.)?refs_assert_scope\\s*\\([^;]*''WBS\\.TEST\\.IMPORT''[^;]*\\);','','g');
  IF fn LIKE '%WBS.TEST.IMPORT%' THEN RAISE EXCEPTION 'Could not remove SERVICE assertion from payment source bind'; END IF;
  EXECUTE fn;
  SELECT pg_get_functiondef('refs_propose_wbs_test_bank_match_config(uuid,uuid)'::regprocedure) INTO fn;
  fn:=regexp_replace(fn,E'\\s*PERFORM\\s+(public\\.)?refs_assert_scope\\s*\\([^;]*''WBS\\.TEST\\.IMPORT''[^;]*\\);','','g');
  fn:=regexp_replace(fn,E'\\s*PERFORM\\s+(public\\.)?refs_assert_scope\\s*\\([^;]*''AP\\.PAYMENT\\.CREATE''[^;]*\\);',' PERFORM refs_assert_scope(p_tenant,p_entity,''BANK.MATCH.CREATE'');','g');
  IF fn LIKE '%WBS.TEST.IMPORT%' OR fn LIKE '%AP.PAYMENT.CREATE%' OR fn NOT LIKE '%BANK.MATCH.CREATE%' THEN RAISE EXCEPTION 'Could not split Bank Match configuration proposal authority'; END IF;
  EXECUTE fn;
END $match_boundary$;

CREATE FUNCTION refs_finalize_wbs_test_bank_import_receipt(p_tenant uuid,p_entity uuid,p_stage uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE actor text:=refs_current_actor(); parent wbs_test_bank_import_stage; retained wbs_test_bank_import_receipt; entity_row entity; period_row accounting_period;
DECLARE actual_count integer; actual_activity numeric(20,4); actual_rows_hash text; chunk_count integer; receipt_id uuid:=gen_random_uuid(); receipt_hash text; response jsonb; bank_ids jsonb; payload jsonb;
BEGIN
  PERFORM refs_assert_scope(p_tenant,p_entity,'WBS.TEST.IMPORT');
  SELECT * INTO parent FROM wbs_test_bank_import_stage WHERE tenant_id=p_tenant AND entity_id=p_entity AND wbs_test_bank_import_stage_id=p_stage FOR UPDATE;
  IF NOT FOUND OR parent.created_by<>actor THEN RAISE EXCEPTION 'Controlled test Bank stage is unavailable' USING ERRCODE='42501'; END IF;
  SELECT * INTO retained FROM wbs_test_bank_import_receipt WHERE tenant_id=p_tenant AND entity_id=p_entity AND wbs_test_bank_import_stage_id=p_stage;
  IF FOUND THEN RETURN jsonb_build_object('wbs_test_bank_import_receipt_id',retained.wbs_test_bank_import_receipt_id,'receipt_hash',retained.receipt_hash,'bank_account_ref',retained.bank_account_ref,'statement_ending_date',retained.statement_end_date,'transaction_count',retained.row_count,'bank_source_ids',(SELECT jsonb_agg(r.bank_source_id ORDER BY r.row_index) FROM wbs_test_bank_import_stage_row r WHERE r.wbs_test_bank_import_stage_id=p_stage),'status','FINALIZED','test_only',true,'provenance_mode','CONTROLLED_TEST_UNSIGNED','can_import',false,'can_match',false,'can_create_draft',false,'can_post',false,'idempotent',true); END IF;
  SELECT count(*),coalesce(sum(signed_amount),0)::numeric(20,4),refs_jsonb_hash(jsonb_agg(row_payload ORDER BY row_index)) INTO actual_count,actual_activity,actual_rows_hash FROM wbs_test_bank_import_stage_row WHERE tenant_id=p_tenant AND entity_id=p_entity AND wbs_test_bank_import_stage_id=p_stage;
  SELECT count(*) INTO chunk_count FROM wbs_test_bank_import_stage_chunk WHERE tenant_id=p_tenant AND entity_id=p_entity AND wbs_test_bank_import_stage_id=p_stage;
  IF actual_count<>parent.expected_row_count OR actual_activity<>parent.expected_activity OR actual_rows_hash<>parent.rows_hash OR chunk_count<>ceil(parent.expected_row_count/100.0)::integer THEN RAISE EXCEPTION 'Controlled test Bank stage is incomplete or aggregate-mismatched' USING ERRCODE='55000'; END IF;
  SELECT * INTO entity_row FROM entity WHERE tenant_id=p_tenant AND entity_id=p_entity AND active FOR SHARE;
  SELECT * INTO period_row FROM accounting_period WHERE tenant_id=p_tenant AND entity_id=p_entity AND period_id=parent.period_id AND status='OPEN' AND starts_on=parent.statement_start_date AND ends_on=parent.statement_end_date FOR SHARE;
  IF entity_row.entity_id IS NULL OR period_row.period_id IS NULL THEN RAISE EXCEPTION 'Controlled test Bank exact entity/OPEN period is unavailable' USING ERRCODE='55000'; END IF;
  INSERT INTO member_master(tenant_id,entity_id,member_ref,member_type,display_name,active) VALUES(p_tenant,p_entity,parent.bank_account_ref,'BANK','WBS Controlled Test Bank',true) ON CONFLICT DO NOTHING;
  PERFORM 1 FROM member_master WHERE tenant_id=p_tenant AND entity_id=p_entity AND member_ref=parent.bank_account_ref AND member_type='BANK' AND active FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Controlled test Bank member conflicts with master data' USING ERRCODE='23514'; END IF;
  INSERT INTO import_batch(import_batch_id,tenant_id,entity_id,connector_code,source_module,source_entity_id,idempotency_key,request_hash,status,row_count,started_at,completed_at) VALUES(parent.import_batch_id,p_tenant,p_entity,'WBS_TEST','bankFeed',entity_row.source_entity_id,parent.root_idempotency_key,parent.root_request_hash,'SUCCEEDED',actual_count,clock_timestamp(),clock_timestamp());
  INSERT INTO raw_event(raw_event_id,tenant_id,entity_id,import_batch_id,source_system,source_module,source_entity_id,source_record_id,source_version,event_type,occurred_at,payload_hash,payload_ref,correlation_id) SELECT r.raw_event_id,p_tenant,p_entity,parent.import_batch_id,entity_row.source_system,'bankFeed',entity_row.source_entity_id,'test-bank:'||lower(parent.bank_account_ref)||':'||substr(r.source_record_hash,8,24),'test:'||substr(parent.observation_hash,8),'UPSERT',r.original_transaction_date::timestamptz,r.source_record_hash,'object://refs-test-only/'||p_entity||'/bank/'||lower(parent.bank_account_ref)||'/'||substr(r.source_record_hash,8),parent.root_idempotency_key FROM wbs_test_bank_import_stage_row r WHERE r.wbs_test_bank_import_stage_id=p_stage ORDER BY r.row_index;
  INSERT INTO source_document(source_document_id,tenant_id,entity_id,raw_event_id,source_system,source_module,source_entity_id,source_record_id,source_version,document_type,document_no,business_date,accounting_date,currency,gross_amount,status,source_ref,payload_hash) SELECT r.source_document_id,p_tenant,p_entity,r.raw_event_id,entity_row.source_system,'bankFeed',entity_row.source_entity_id,'test-bank:'||lower(parent.bank_account_ref)||':'||substr(r.source_record_hash,8,24),'test:'||substr(parent.observation_hash,8),'WBS_TEST_BANK_TRANSACTION','WBS-TEST-BANK-'||upper(substr(r.source_record_hash,8,16)),r.original_transaction_date,r.posting_transaction_date,'USD',r.signed_amount,'RECEIVED','object://refs-test-only/'||p_entity||'/bank/'||lower(parent.bank_account_ref)||'/'||substr(r.source_record_hash,8),r.source_record_hash FROM wbs_test_bank_import_stage_row r WHERE r.wbs_test_bank_import_stage_id=p_stage ORDER BY r.row_index;
  INSERT INTO source_document_line(source_document_line_id,tenant_id,entity_id,source_document_id,source_line_id,line_no,amount,direction,description,bank_account_ref,external_dimension_refs) SELECT r.source_document_line_id,p_tenant,p_entity,r.source_document_id,'test-bank:'||lower(parent.bank_account_ref)||':'||substr(r.source_record_hash,8,24),1,r.unsigned_amount,r.direction,'Sanitized unsigned WBS controlled test Bank transaction',parent.bank_account_ref,jsonb_build_object('schema_version','WBS_CONTROLLED_TEST_BANK_LINE_V1','test_only',true,'provenance_mode','CONTROLLED_TEST_UNSIGNED','observation_hash',parent.observation_hash,'source_record_hash',r.source_record_hash,'provider_content_sha256',parent.provider_content_sha256,'row_index',r.row_index,'original_transaction_date',r.original_transaction_date,'posting_transaction_date',r.posting_transaction_date,'provider_status',r.row_payload->>'status') FROM wbs_test_bank_import_stage_row r WHERE r.wbs_test_bank_import_stage_id=p_stage ORDER BY r.row_index;
  INSERT INTO bank_source(bank_source_id,tenant_id,entity_id,source_document_id,source_line_id,bank_account_ref,external_bank_line_id,transaction_date,currency,amount) SELECT r.bank_source_id,p_tenant,p_entity,r.source_document_id,r.source_document_line_id,parent.bank_account_ref,'WBS-TEST-BANK-'||upper(substr(r.source_record_hash,8,16)),r.posting_transaction_date,'USD',r.signed_amount FROM wbs_test_bank_import_stage_row r WHERE r.wbs_test_bank_import_stage_id=p_stage ORDER BY r.row_index;
  INSERT INTO source_link(tenant_id,entity_id,link_type,raw_event_id,source_document_id,source_document_line_id,bank_source_id,created_by) SELECT p_tenant,p_entity,'WBS_CONTROLLED_TEST_BANK_SOURCE',r.raw_event_id,r.source_document_id,r.source_document_line_id,r.bank_source_id,actor FROM wbs_test_bank_import_stage_row r WHERE r.wbs_test_bank_import_stage_id=p_stage ORDER BY r.row_index;
  receipt_hash:=refs_jsonb_hash(jsonb_build_object('stage_id',p_stage,'period_id',parent.period_id,'company_code',parent.company_code,'bank_account_ref',parent.bank_account_ref,'observation_hash',parent.observation_hash,'provider_content_sha256',parent.provider_content_sha256,'request_hash',parent.root_request_hash,'row_count',actual_count,'statement_start_date',parent.statement_start_date,'statement_end_date',parent.statement_end_date,'statement_activity',actual_activity,'imported_by',actor));
  INSERT INTO wbs_test_bank_import_receipt(wbs_test_bank_import_receipt_id,tenant_id,entity_id,wbs_test_bank_import_stage_id,period_id,company_code,bank_account_ref,observation_hash,provider_content_sha256,request_hash,receipt_hash,row_count,statement_start_date,statement_end_date,statement_activity,imported_by) VALUES(receipt_id,p_tenant,p_entity,p_stage,parent.period_id,parent.company_code,parent.bank_account_ref,parent.observation_hash,parent.provider_content_sha256,parent.root_request_hash,receipt_hash,actual_count,parent.statement_start_date,parent.statement_end_date,actual_activity,actor);
  SELECT jsonb_agg(bank_source_id ORDER BY row_index) INTO bank_ids FROM wbs_test_bank_import_stage_row WHERE wbs_test_bank_import_stage_id=p_stage;
  payload:=jsonb_build_object('wbs_test_bank_import_receipt_id',receipt_id,'receipt_hash',receipt_hash,'bank_account_ref',parent.bank_account_ref,'transaction_count',actual_count,'test_only',true,'provenance_mode','CONTROLLED_TEST_UNSIGNED');
  INSERT INTO audit_event(tenant_id,entity_id,event_type,object_type,object_id,action,actor_id,actor_type,permission_used,request_id,correlation_id,idempotency_key,after_hash,reason,metadata) VALUES(p_tenant,p_entity,'WBS_TEST_BANK_IMPORT_RECEIPT_FINALIZED','WBS_TEST_BANK_IMPORT_RECEIPT',receipt_id,'FINALIZE_IMPORT_RECEIPT',actor,'SERVICE_ACCOUNT','WBS.TEST.IMPORT',parent.root_idempotency_key,parent.root_idempotency_key,parent.root_idempotency_key,receipt_hash,'SERVICE retained immutable unsigned TEST_ONLY Bank receipt; no reconciliation or accounting action',payload);
  INSERT INTO outbox_event(tenant_id,entity_id,aggregate_type,aggregate_id,event_type,payload,payload_hash) VALUES(p_tenant,p_entity,'WBS_TEST_BANK_IMPORT_RECEIPT',receipt_id,'WBS_TEST_BANK_IMPORT_RECEIPT_FINALIZED',payload,refs_jsonb_hash(payload));
  response:=payload||jsonb_build_object('statement_ending_date',parent.statement_end_date,'bank_source_ids',bank_ids,'status','FINALIZED','can_import',false,'can_match',false,'can_create_draft',false,'can_post',false,'idempotent',false);
  UPDATE idempotency_receipt SET status='SUCCEEDED',response_status=201,response_body=response,completed_at=clock_timestamp() WHERE tenant_id=p_tenant AND operation_scope='WBS_CONTROLLED_TEST_BANK:'||p_entity AND idempotency_key=parent.root_idempotency_key AND request_hash=parent.root_request_hash AND actor_id=actor AND status='IN_PROGRESS';
  RETURN response;
END $$;

CREATE FUNCTION refs_start_wbs_test_bank_reconciliation(p_tenant uuid,p_entity uuid,p_receipt uuid,p_expected_receipt_hash text,p_idempotency_key text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE actor text:=refs_current_actor(); receipt wbs_test_bank_import_receipt; started jsonb; rec_id uuid; payload jsonb;
BEGIN
  PERFORM refs_assert_scope(p_tenant,p_entity,'BANK.RECONCILIATION.START');
  SELECT * INTO receipt FROM wbs_test_bank_import_receipt WHERE tenant_id=p_tenant AND entity_id=p_entity AND wbs_test_bank_import_receipt_id=p_receipt FOR UPDATE;
  IF NOT FOUND OR receipt.receipt_hash<>p_expected_receipt_hash OR actor=receipt.imported_by THEN RAISE EXCEPTION 'Exact immutable Bank import receipt or independent human starter is unavailable' USING ERRCODE='42501'; END IF;
  IF receipt.reconciliation_id IS NOT NULL THEN RETURN jsonb_build_object('wbs_test_bank_import_receipt_id',p_receipt,'receipt_hash',receipt.receipt_hash,'reconciliation_id',receipt.reconciliation_id,'status','DRAFT','idempotent',true); END IF;
  started:=refs_start_reconciliation(p_tenant,p_entity,receipt.bank_account_ref,receipt.statement_end_date,0,receipt.statement_activity,'Start from exact immutable WBS TEST Bank import receipt',p_idempotency_key,refs_reconciliation_start_hash(p_tenant,p_entity,receipt.bank_account_ref,receipt.statement_end_date,0,receipt.statement_activity,'Start from exact immutable WBS TEST Bank import receipt'));
  rec_id:=(started->>'reconciliation_id')::uuid;
  UPDATE wbs_test_bank_import_receipt SET reconciliation_id=rec_id,reconciliation_started_by=actor,reconciliation_started_at=clock_timestamp() WHERE wbs_test_bank_import_receipt_id=p_receipt AND reconciliation_id IS NULL;
  INSERT INTO source_link(tenant_id,entity_id,link_type,source_document_id,bank_source_id,reconciliation_id,created_by) SELECT p_tenant,p_entity,'WBS_CONTROLLED_TEST_BANK_RECONCILIATION',r.source_document_id,r.bank_source_id,rec_id,actor FROM wbs_test_bank_import_stage_row r WHERE r.wbs_test_bank_import_stage_id=receipt.wbs_test_bank_import_stage_id ORDER BY r.row_index;
  payload:=jsonb_build_object('wbs_test_bank_import_receipt_id',p_receipt,'receipt_hash',receipt.receipt_hash,'reconciliation_id',rec_id,'imported_by',receipt.imported_by,'started_by',actor);
  INSERT INTO audit_event(tenant_id,entity_id,event_type,object_type,object_id,action,actor_id,actor_type,permission_used,request_id,correlation_id,idempotency_key,after_hash,reason,metadata) VALUES(p_tenant,p_entity,'WBS_TEST_BANK_RECONCILIATION_STARTED','RECONCILIATION',rec_id,'START_FROM_RECEIPT',actor,'USER','BANK.RECONCILIATION.START',p_idempotency_key,p_idempotency_key,p_idempotency_key,refs_jsonb_hash(payload),'Human maker consumed exact immutable WBS TEST Bank receipt into Draft reconciliation',payload);
  RETURN payload||jsonb_build_object('status','DRAFT','idempotent',false);
END $$;

CREATE FUNCTION refs_wbs_test_bank_adjustment_post_batch(p_tenant uuid,p_entity uuid,p_reconciliation uuid,p_period uuid,p_bank_source_ids uuid[],p_reason text,p_idempotency_root text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE actor text:=refs_current_actor(); ids uuid[]; source_id uuid; draft reconciliation_adjustment_draft; journal journal_entry; child jsonb; retained wbs_test_bank_adjustment_post_receipt; results jsonb:='[]'::jsonb; posted integer:=0;
BEGIN
  PERFORM refs_assert_scope(p_tenant,p_entity,'GL.JE.POST');
  IF p_reason NOT LIKE 'UNSIGNED TEST ONLY — %' OR COALESCE(length(p_idempotency_root),0) NOT BETWEEN 8 AND 120 THEN RAISE EXCEPTION 'WBS TEST Bank POST batch requires marked reason and stable identity' USING ERRCODE='22023'; END IF;
  ids:=refs_private_wbs_test_bank_adjustment_batch_ids(p_tenant,p_entity,p_reconciliation,p_bank_source_ids);
  FOREACH source_id IN ARRAY ids LOOP
    SELECT * INTO draft FROM reconciliation_adjustment_draft WHERE tenant_id=p_tenant AND entity_id=p_entity AND reconciliation_id=p_reconciliation AND bank_source_id=source_id FOR SHARE;
    SELECT * INTO journal FROM journal_entry WHERE tenant_id=p_tenant AND entity_id=p_entity AND journal_entry_id=draft.journal_entry_id FOR SHARE;
    IF journal.journal_entry_id IS NULL OR journal.status NOT IN ('APPROVED','POSTED') THEN RAISE EXCEPTION 'WBS TEST Bank POST batch requires exact Approved adjustment' USING ERRCODE='23514'; END IF;
    SELECT * INTO retained FROM wbs_test_bank_adjustment_post_receipt WHERE tenant_id=p_tenant AND entity_id=p_entity AND reconciliation_id=p_reconciliation AND bank_source_id=source_id;
    IF FOUND THEN
      IF retained.journal_entry_id<>journal.journal_entry_id OR retained.posted_by<>actor THEN RAISE EXCEPTION 'WBS TEST Bank POST receipt conflicts with actor or journal lineage' USING ERRCODE='23505'; END IF;
      child:=jsonb_build_object('journal_entry_id',retained.journal_entry_id,'posting_batch_id',retained.journal_posting_batch_id,'post_hash',retained.post_hash,'idempotent',true);
    ELSE
      child:=refs_post_journal(p_tenant,p_entity,p_period,journal.journal_entry_id,journal.revision,p_idempotency_root||':'||source_id||':post',refs_canonical_jsonb_hash(jsonb_build_object('tenantId',p_tenant,'entityId',p_entity,'periodId',p_period,'journalEntryId',journal.journal_entry_id,'expectedRevision',journal.revision)),actor);
      INSERT INTO wbs_test_bank_adjustment_post_receipt(tenant_id,entity_id,reconciliation_id,bank_source_id,journal_entry_id,journal_posting_batch_id,post_hash,posted_by) VALUES(p_tenant,p_entity,p_reconciliation,source_id,journal.journal_entry_id,(child->>'posting_batch_id')::uuid,refs_jsonb_hash(jsonb_build_object('reconciliation_id',p_reconciliation,'bank_source_id',source_id,'journal_entry_id',journal.journal_entry_id,'posting_batch_id',child->>'posting_batch_id','posted_by',actor)),actor) RETURNING post_hash INTO retained.post_hash;
      child:=child||jsonb_build_object('post_hash',retained.post_hash);posted:=posted+1;
    END IF;
    results:=results||jsonb_build_array(child||jsonb_build_object('bank_source_id',source_id));
  END LOOP;
  RETURN jsonb_build_object('stage','POST','processed_count',cardinality(ids),'posted_count',posted,'bank_source_ids',to_jsonb(ids),'results',results,'test_only',true);
END $$;

CREATE FUNCTION refs_wbs_test_bank_adjustment_clear_batch(p_tenant uuid,p_entity uuid,p_reconciliation uuid,p_bank_source_ids uuid[],p_reason text,p_idempotency_root text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE actor text:=refs_current_actor(); ids uuid[]; source_id uuid; retained wbs_test_bank_adjustment_post_receipt; rec reconciliation; bank bank_source; cleared integer:=0;
BEGIN
  PERFORM refs_assert_scope(p_tenant,p_entity,'BANK.RECONCILIATION.CLEAR');
  IF p_reason NOT LIKE 'UNSIGNED TEST ONLY — %' OR COALESCE(length(p_idempotency_root),0) NOT BETWEEN 8 AND 120 THEN RAISE EXCEPTION 'WBS TEST Bank CLEAR batch requires marked reason and stable identity' USING ERRCODE='22023'; END IF;
  ids:=refs_private_wbs_test_bank_adjustment_batch_ids(p_tenant,p_entity,p_reconciliation,p_bank_source_ids);
  FOREACH source_id IN ARRAY ids LOOP
    SELECT * INTO retained FROM wbs_test_bank_adjustment_post_receipt WHERE tenant_id=p_tenant AND entity_id=p_entity AND reconciliation_id=p_reconciliation AND bank_source_id=source_id FOR UPDATE;
    IF NOT FOUND OR retained.posted_by=actor THEN RAISE EXCEPTION 'Independent clearer requires exact POST receipt from a different actor' USING ERRCODE='42501'; END IF;
    IF retained.cleared_by IS NOT NULL THEN IF retained.cleared_by<>actor THEN RAISE EXCEPTION 'WBS TEST Bank CLEAR replay actor changed' USING ERRCODE='23505'; END IF; CONTINUE; END IF;
    SELECT * INTO rec FROM reconciliation WHERE tenant_id=p_tenant AND entity_id=p_entity AND reconciliation_id=p_reconciliation FOR SHARE;
    SELECT * INTO bank FROM bank_source WHERE tenant_id=p_tenant AND entity_id=p_entity AND bank_source_id=source_id FOR SHARE;
    PERFORM refs_set_reconciliation_adjustment_clearance(p_tenant,p_entity,p_reconciliation,source_id,rec.version,bank.version,true,p_reason,p_idempotency_root||':'||source_id||':clear-adjustment',refs_reconciliation_adjustment_clearance_hash(p_tenant,p_entity,p_reconciliation,source_id,rec.version,bank.version,true,p_reason));
    UPDATE wbs_test_bank_adjustment_post_receipt SET cleared_by=actor,cleared_at=clock_timestamp() WHERE tenant_id=p_tenant AND entity_id=p_entity AND reconciliation_id=p_reconciliation AND bank_source_id=source_id AND cleared_by IS NULL;
    cleared:=cleared+1;
  END LOOP;
  RETURN jsonb_build_object('stage','CLEAR','processed_count',cardinality(ids),'cleared_count',cleared,'bank_source_ids',to_jsonb(ids),'test_only',true);
END $$;

REVOKE ALL ON TABLE wbs_test_bank_import_receipt,wbs_test_bank_adjustment_post_receipt,wbs_test_bank_legacy_function_backup FROM PUBLIC,refs_app;
REVOKE ALL ON FUNCTION refs_finalize_wbs_test_bank_import_receipt(uuid,uuid,uuid),refs_start_wbs_test_bank_reconciliation(uuid,uuid,uuid,text,text),refs_wbs_test_bank_adjustment_post_batch(uuid,uuid,uuid,uuid,uuid[],text,text),refs_wbs_test_bank_adjustment_clear_batch(uuid,uuid,uuid,uuid[],text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION refs_begin_wbs_test_bank_staged_import(uuid,uuid,uuid,text,jsonb,text,text,text),refs_append_wbs_test_bank_staged_chunk(uuid,uuid,uuid,integer,jsonb,text),refs_finalize_wbs_test_bank_import_receipt(uuid,uuid,uuid),refs_start_wbs_test_bank_reconciliation(uuid,uuid,uuid,text,text),refs_wbs_test_bank_adjustment_post_batch(uuid,uuid,uuid,uuid,uuid[],text,text),refs_wbs_test_bank_adjustment_clear_batch(uuid,uuid,uuid,uuid[],text,text) TO refs_app;

COMMIT;
