BEGIN;

DO $$ BEGIN
  IF EXISTS(SELECT 1 FROM wbs_controlled_test_bank_import WHERE row_count>10 OR bank_account_ref<>'WBS_TEST_BANK')
     OR EXISTS(SELECT 1 FROM wbs_controlled_test_bank_import_row WHERE row_index>9)
     OR EXISTS(SELECT 1 FROM business_document WHERE document_kind='AP_BILL' AND document_number~'^WBS-TEST-[0-9A-F]{16}-[0-9A-F]{8}$') THEN
    RAISE EXCEPTION 'Cannot remove WBS H1 range support while range Bank evidence exists' USING ERRCODE='55006';
  END IF;
END $$;

DO $migration$
DECLARE definition text;old_source text:='source_ref:=''object://refs-test-only/''||p_entity||''/''||substr(v_source_hash,8);';new_source text:='source_ref:=''object://refs-test-only/''||p_entity||''/''||substr(v_source_hash,8)||''/''||substr(v_observation_hash,8,16);';old_number text:='document_number:=''WBS-TEST-''||upper(substr(v_source_hash,8,16));';new_number text:='document_number:=''WBS-TEST-''||upper(substr(v_source_hash,8,16))||''-''||upper(substr(v_observation_hash,8,8));';
BEGIN
  SELECT pg_get_functiondef('public.refs_create_wbs_test_payable_draft_v168(uuid,uuid,uuid,jsonb,jsonb,integer,text,text)'::regprocedure) INTO definition;
  IF strpos(definition,new_source)=0 OR strpos(definition,new_number)=0 THEN RAISE EXCEPTION 'Cannot restore unexpected WBS TEST_ONLY Payable identity function' USING ERRCODE='55000'; END IF;
  EXECUTE replace(replace(definition,new_source,old_source),new_number,old_number);
END;
$migration$;

DO $migration$
DECLARE
  definition text;
  old_guard constant text:='IF rows_count NOT BETWEEN 1 AND 10 OR (p_observation->>''record_count'')::integer<>rows_count THEN';
  new_guard constant text:='IF rows_count NOT BETWEEN 1 AND 500 OR (p_observation->>''record_count'')::integer<>rows_count THEN';
  old_message constant text:='Controlled test Bank observation must contain one to ten rows';
  new_message constant text:='Controlled test Bank observation must contain one to five hundred rows';
  old_account_guard constant text:='IF p_bank_account_ref<>''WBS_TEST_BANK'' OR p_company_code IS NULL';
  new_account_guard constant text:='IF p_bank_account_ref!~''^WBS_TEST_BANK(?:_2026_0[1-6])?$'' OR p_company_code IS NULL';
  occurrences integer;
BEGIN
  SELECT pg_get_functiondef(
    'public.refs_create_wbs_controlled_test_bank_scope(uuid,uuid,uuid,text,jsonb,text,text,text)'::regprocedure
  ) INTO definition;
  occurrences:=(length(definition)-length(replace(definition,new_guard,'')))/length(new_guard);
  IF occurrences<>1 THEN RAISE EXCEPTION 'Cannot restore unexpected controlled test Bank row guard' USING ERRCODE='55000'; END IF;
  definition:=replace(definition,new_guard,old_guard);
  occurrences:=(length(definition)-length(replace(definition,new_message,'')))/length(new_message);
  IF occurrences<>1 THEN RAISE EXCEPTION 'Cannot restore unexpected controlled test Bank row error' USING ERRCODE='55000'; END IF;
  definition:=replace(definition,new_message,old_message);
  occurrences:=(length(definition)-length(replace(definition,new_account_guard,'')))/length(new_account_guard);
  IF occurrences<>1 THEN RAISE EXCEPTION 'Cannot restore unexpected controlled test Bank account guard' USING ERRCODE='55000'; END IF;
  definition:=replace(definition,new_account_guard,old_account_guard);
  EXECUTE definition;
END;
$migration$;

REVOKE ALL ON FUNCTION refs_create_wbs_controlled_test_bank_scope(uuid,uuid,uuid,text,jsonb,text,text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION refs_create_wbs_controlled_test_bank_scope(uuid,uuid,uuid,text,jsonb,text,text,text) TO refs_app;

DROP FUNCTION refs_ensure_wbs_test_h1_2026_periods(uuid,uuid);

ALTER TABLE wbs_controlled_test_bank_import_row DROP CONSTRAINT wbs_controlled_test_bank_import_row_row_index_check;
ALTER TABLE wbs_controlled_test_bank_import_row ADD CONSTRAINT wbs_controlled_test_bank_import_row_row_index_check CHECK(row_index BETWEEN 0 AND 9);
ALTER TABLE wbs_controlled_test_bank_import DROP CONSTRAINT wbs_controlled_test_bank_import_row_count_check;
ALTER TABLE wbs_controlled_test_bank_import ADD CONSTRAINT wbs_controlled_test_bank_import_row_count_check CHECK(row_count BETWEEN 1 AND 10);
ALTER TABLE wbs_controlled_test_bank_import DROP CONSTRAINT wbs_controlled_test_bank_import_bank_account_ref_check;
ALTER TABLE wbs_controlled_test_bank_import ADD CONSTRAINT wbs_controlled_test_bank_import_bank_account_ref_check CHECK(bank_account_ref='WBS_TEST_BANK');

COMMIT;
