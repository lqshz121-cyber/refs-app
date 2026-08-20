BEGIN;

DO $migration$
BEGIN
  IF EXISTS(SELECT 1 FROM wbs_test_bank_import_stage WHERE expected_rows IS NOT NULL) THEN
    RAISE EXCEPTION 'Cannot roll back checkpoint integrity while immutable WBS Bank checkpoints exist' USING ERRCODE='55006';
  END IF;
END;
$migration$;

DO $migration$
DECLARE definition text;
  old_columns constant text:='INSERT INTO wbs_test_bank_import_stage(tenant_id,entity_id,period_id,company_code,bank_account_ref,observation_hash,provider_content_sha256,rows_hash,expected_row_count,expected_activity,statement_start_date,statement_end_date,import_batch_id,root_idempotency_key,root_request_hash,created_by)';
  new_columns constant text:='INSERT INTO wbs_test_bank_import_stage(tenant_id,entity_id,period_id,company_code,bank_account_ref,observation_hash,provider_content_sha256,rows_hash,expected_rows,expected_row_count,expected_activity,statement_start_date,statement_end_date,import_batch_id,root_idempotency_key,root_request_hash,created_by)';
  old_values constant text:='VALUES(p_tenant,p_entity,p_period,p_company_code,p_bank_account_ref,p_observation->>''observation_hash'',p_observation->>''provider_content_sha256'',rows_hash,rows_count,activity,period_row.starts_on,period_row.ends_on,gen_random_uuid(),p_idempotency_key,p_request_hash,actor)';
  new_values constant text:='VALUES(p_tenant,p_entity,p_period,p_company_code,p_bank_account_ref,p_observation->>''observation_hash'',p_observation->>''provider_content_sha256'',rows_hash,p_observation->''rows'',rows_count,activity,period_row.starts_on,period_row.ends_on,gen_random_uuid(),p_idempotency_key,p_request_hash,actor)';
  old_anchor constant text:='rows_hash:=refs_jsonb_hash(p_observation->''rows''); chunk_count:=ceil(rows_count/100.0)::integer;';
  new_anchor constant text:='rows_hash:=refs_jsonb_hash(p_observation->''rows''); chunk_count:=ceil(rows_count/100.0)::integer;
  IF EXISTS(
    SELECT 1
      FROM wbs_controlled_test_bank_import_row prior
      JOIN jsonb_array_elements(p_observation->''rows'') candidate(value)
        ON candidate.value->>''source_record_hash''=prior.source_record_hash
     WHERE prior.tenant_id=p_tenant AND prior.entity_id=p_entity AND prior.bank_account_ref=p_bank_account_ref
       AND (prior.original_transaction_date,prior.posting_transaction_date,prior.direction,prior.signed_amount)
           IS DISTINCT FROM ((candidate.value->>''accounting_date'')::date,(candidate.value->>''accounting_date'')::date,candidate.value->>''direction'',CASE candidate.value->>''direction'' WHEN ''DEBIT'' THEN (candidate.value->>''amount'')::numeric(20,4) ELSE -((candidate.value->>''amount'')::numeric(20,4)) END)
  ) THEN RAISE EXCEPTION ''Controlled test Bank monthly source identity changed payload'' USING ERRCODE=''23505''; END IF;';
  old_conflict constant text:='OR stage_row.provider_content_sha256<>p_observation->>''provider_content_sha256'' OR stage_row.rows_hash<>rows_hash OR stage_row.expected_row_count<>rows_count';
  new_conflict constant text:='OR stage_row.provider_content_sha256<>p_observation->>''provider_content_sha256'' OR stage_row.rows_hash<>rows_hash OR stage_row.expected_rows IS DISTINCT FROM p_observation->''rows'' OR stage_row.expected_row_count<>rows_count';
  old_response constant text:='RETURN jsonb_build_object(''status'',''WBS_TEST_BANK_IMPORT_PARTIAL'',''stage_id'',stage_row.wbs_test_bank_import_stage_id,''next_chunk_index'',next_chunk,''chunk_count'',chunk_count,''transaction_count'',rows_count,''test_only'',true,''provenance_mode'',''CONTROLLED_TEST_UNSIGNED'',''idempotent'',next_chunk>0);';
  new_response constant text:='RETURN jsonb_build_object(''status'',''WBS_TEST_BANK_IMPORT_PARTIAL'',''stage_id'',stage_row.wbs_test_bank_import_stage_id,''next_chunk_index'',next_chunk,''chunk_count'',chunk_count,''transaction_count'',rows_count,''test_only'',true,''provenance_mode'',''CONTROLLED_TEST_UNSIGNED'',''can_import'',false,''can_match'',false,''can_create_draft'',false,''can_post'',false,''idempotent'',next_chunk>0);';
BEGIN
  SELECT pg_get_functiondef('public.refs_begin_wbs_test_bank_staged_import(uuid,uuid,uuid,text,jsonb,text,text,text)'::regprocedure) INTO definition;
  IF position(new_columns IN definition)=0 OR position(new_values IN definition)=0 OR position(new_anchor IN definition)=0 OR position(new_conflict IN definition)=0 OR position(new_response IN definition)=0 THEN
    RAISE EXCEPTION 'Unexpected checkpoint-integrity begin definition during rollback' USING ERRCODE='22023';
  END IF;
  definition:=replace(definition,new_columns,old_columns);
  definition:=replace(definition,new_values,old_values);
  definition:=replace(definition,new_anchor,old_anchor);
  definition:=replace(definition,new_conflict,old_conflict);
  definition:=replace(definition,new_response,old_response);
  EXECUTE definition;
END;
$migration$;

DO $migration$
DECLARE definition text;
  old_declare constant text:='DECLARE expected_size integer; chunk_hash text; chunk_activity numeric(20,4); bad_count integer; distinct_count integer; next_chunk integer;';
  new_declare constant text:='DECLARE expected_size integer; chunk_hash text; expected_chunk_hash text; chunk_activity numeric(20,4); bad_count integer; distinct_count integer; next_chunk integer;';
  old_anchor constant text:='chunk_hash:=refs_jsonb_hash(p_rows);
  SELECT * INTO retained FROM wbs_test_bank_import_stage_chunk';
  new_anchor constant text:='chunk_hash:=refs_jsonb_hash(p_rows);
  IF parent.expected_rows IS NULL THEN RAISE EXCEPTION ''Controlled test Bank checkpoint has no immutable expected row payload'' USING ERRCODE=''55000''; END IF;
  SELECT refs_jsonb_hash(COALESCE(jsonb_agg(value ORDER BY ordinality),''[]''::jsonb)) INTO expected_chunk_hash
    FROM jsonb_array_elements(parent.expected_rows) WITH ORDINALITY expected(value,ordinality)
   WHERE ordinality>p_chunk_index*100 AND ordinality<=(p_chunk_index+1)*100;
  IF expected_chunk_hash<>chunk_hash THEN RAISE EXCEPTION ''Controlled test Bank staged checkpoint chunk changed'' USING ERRCODE=''23505''; END IF;
  SELECT * INTO retained FROM wbs_test_bank_import_stage_chunk';
  old_replay constant text:='RETURN jsonb_build_object(''status'',''WBS_TEST_BANK_IMPORT_PARTIAL'',''stage_id'',p_stage,''chunk_index'',p_chunk_index,''idempotent'',true);';
  new_replay constant text:='RETURN jsonb_build_object(''status'',''WBS_TEST_BANK_IMPORT_PARTIAL'',''stage_id'',p_stage,''chunk_index'',p_chunk_index,''can_import'',false,''can_match'',false,''can_create_draft'',false,''can_post'',false,''idempotent'',true);';
  old_append constant text:='RETURN jsonb_build_object(''status'',''WBS_TEST_BANK_IMPORT_PARTIAL'',''stage_id'',p_stage,''chunk_index'',p_chunk_index,''idempotent'',false);';
  new_append constant text:='RETURN jsonb_build_object(''status'',''WBS_TEST_BANK_IMPORT_PARTIAL'',''stage_id'',p_stage,''chunk_index'',p_chunk_index,''can_import'',false,''can_match'',false,''can_create_draft'',false,''can_post'',false,''idempotent'',false);';
BEGIN
  SELECT pg_get_functiondef('public.refs_append_wbs_test_bank_staged_chunk(uuid,uuid,uuid,integer,jsonb,text)'::regprocedure) INTO definition;
  IF position(new_declare IN definition)=0 OR position(new_anchor IN definition)=0 OR position(new_replay IN definition)=0 OR position(new_append IN definition)=0 THEN
    RAISE EXCEPTION 'Unexpected checkpoint-integrity append definition during rollback' USING ERRCODE='22023';
  END IF;
  definition:=replace(definition,new_declare,old_declare);
  definition:=replace(definition,new_anchor,old_anchor);
  definition:=replace(definition,new_replay,old_replay);
  definition:=replace(definition,new_append,old_append);
  EXECUTE definition;
END;
$migration$;

DO $migration$
DECLARE definition text;
  old_replay constant text:='IF FOUND THEN RETURN final_row.response_body||jsonb_build_object(''idempotent'',true); END IF;';
  new_replay constant text:='IF FOUND THEN RETURN final_row.response_body||jsonb_build_object(''can_import'',false,''can_match'',false,''can_create_draft'',false,''can_post'',false,''idempotent'',true); END IF;';
  old_response constant text:='response:=jsonb_build_object(''wbs_controlled_test_bank_import_id'',import_id,''reconciliation_id'',reconciliation_id,''bank_account_ref'',parent.bank_account_ref,''statement_ending_date'',parent.statement_end_date,''transaction_count'',parent.expected_row_count,''bank_source_ids'',bank_ids,''status'',''DRAFT'',''test_only'',true,''provenance_mode'',''CONTROLLED_TEST_UNSIGNED'',''idempotent'',false);';
  new_response constant text:='response:=jsonb_build_object(''wbs_controlled_test_bank_import_id'',import_id,''reconciliation_id'',reconciliation_id,''bank_account_ref'',parent.bank_account_ref,''statement_ending_date'',parent.statement_end_date,''transaction_count'',parent.expected_row_count,''bank_source_ids'',bank_ids,''status'',''DRAFT'',''test_only'',true,''provenance_mode'',''CONTROLLED_TEST_UNSIGNED'',''can_import'',false,''can_match'',false,''can_create_draft'',false,''can_post'',false,''idempotent'',false);';
BEGIN
  SELECT pg_get_functiondef('public.refs_finalize_wbs_test_bank_staged_import(uuid,uuid,uuid)'::regprocedure) INTO definition;
  IF position(new_replay IN definition)=0 OR position(new_response IN definition)=0 THEN
    RAISE EXCEPTION 'Unexpected checkpoint-integrity finalize definition during rollback' USING ERRCODE='22023';
  END IF;
  definition:=replace(definition,new_replay,old_replay);
  definition:=replace(definition,new_response,old_response);
  EXECUTE definition;
END;
$migration$;

ALTER TABLE wbs_test_bank_import_stage DROP CONSTRAINT wbs_test_bank_import_stage_expected_rows_shape;
ALTER TABLE wbs_test_bank_import_stage DROP COLUMN expected_rows;

REVOKE ALL ON FUNCTION refs_begin_wbs_test_bank_staged_import(uuid,uuid,uuid,text,jsonb,text,text,text),refs_append_wbs_test_bank_staged_chunk(uuid,uuid,uuid,integer,jsonb,text),refs_finalize_wbs_test_bank_staged_import(uuid,uuid,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION refs_begin_wbs_test_bank_staged_import(uuid,uuid,uuid,text,jsonb,text,text,text),refs_append_wbs_test_bank_staged_chunk(uuid,uuid,uuid,integer,jsonb,text),refs_finalize_wbs_test_bank_staged_import(uuid,uuid,uuid) TO refs_app;

COMMIT;
