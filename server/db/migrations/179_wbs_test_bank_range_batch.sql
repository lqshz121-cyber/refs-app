BEGIN;

ALTER TABLE wbs_controlled_test_bank_import DROP CONSTRAINT wbs_controlled_test_bank_import_bank_account_ref_check;
ALTER TABLE wbs_controlled_test_bank_import ADD CONSTRAINT wbs_controlled_test_bank_import_bank_account_ref_check CHECK(bank_account_ref='WBS_TEST_BANK' OR bank_account_ref~'^WBS_TEST_BANK_2026_0[1-6]$');
ALTER TABLE wbs_controlled_test_bank_import DROP CONSTRAINT wbs_controlled_test_bank_import_row_count_check;
ALTER TABLE wbs_controlled_test_bank_import ADD CONSTRAINT wbs_controlled_test_bank_import_row_count_check CHECK(row_count BETWEEN 1 AND 500);
ALTER TABLE wbs_controlled_test_bank_import_row DROP CONSTRAINT wbs_controlled_test_bank_import_row_row_index_check;
ALTER TABLE wbs_controlled_test_bank_import_row ADD CONSTRAINT wbs_controlled_test_bank_import_row_row_index_check CHECK(row_index BETWEEN 0 AND 499);

CREATE FUNCTION refs_ensure_wbs_test_h1_2026_periods(p_tenant uuid,p_entity uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE month_no integer;starts date;ends date;existing accounting_period;periods jsonb='[]'::jsonb;actor text;
BEGIN
  PERFORM refs_assert_scope(p_tenant,p_entity,'WBS.TEST.IMPORT');actor:=refs_current_actor();
  IF actor IS NULL THEN RAISE EXCEPTION 'Authenticated WBS H1 test importer missing' USING ERRCODE='42501'; END IF;
  PERFORM 1 FROM entity WHERE tenant_id=p_tenant AND entity_id=p_entity AND active FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'WBS H1 test entity is unavailable' USING ERRCODE='42501'; END IF;
  FOR month_no IN 1..6 LOOP
    starts:=make_date(2026,month_no,1);ends:=(starts+interval '1 month - 1 day')::date;
    SELECT * INTO existing FROM accounting_period WHERE tenant_id=p_tenant AND entity_id=p_entity AND ledger_code='PRIMARY' AND period_code=to_char(starts,'YYYY-MM') FOR SHARE;
    IF FOUND AND (existing.starts_on<>starts OR existing.ends_on<>ends OR existing.status<>'OPEN' OR existing.closed_by IS NOT NULL OR existing.closed_at IS NOT NULL) THEN
      RAISE EXCEPTION 'Existing WBS H1 test period conflicts with exact OPEN month %',to_char(starts,'YYYY-MM') USING ERRCODE='23514';
    END IF;
  END LOOP;
  FOR month_no IN 1..6 LOOP
    starts:=make_date(2026,month_no,1);ends:=(starts+interval '1 month - 1 day')::date;
    INSERT INTO accounting_period(tenant_id,entity_id,ledger_code,period_code,starts_on,ends_on,status)
      VALUES(p_tenant,p_entity,'PRIMARY',to_char(starts,'YYYY-MM'),starts,ends,'OPEN') ON CONFLICT(tenant_id,entity_id,ledger_code,period_code) DO NOTHING;
    SELECT * INTO STRICT existing FROM accounting_period WHERE tenant_id=p_tenant AND entity_id=p_entity AND ledger_code='PRIMARY' AND period_code=to_char(starts,'YYYY-MM');
    periods:=periods||jsonb_build_array(jsonb_build_object('period_id',existing.period_id,'period_code',existing.period_code,'starts_on',existing.starts_on,'ends_on',existing.ends_on));
  END LOOP;
  RETURN jsonb_build_object('status','WBS_TEST_H1_PERIODS_READY','periods',periods,'test_only',true);
END $$;

REVOKE ALL ON FUNCTION refs_ensure_wbs_test_h1_2026_periods(uuid,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION refs_ensure_wbs_test_h1_2026_periods(uuid,uuid) TO refs_app;

-- The public TEST_ONLY range command reads the Provider in immutable ten-row
-- cursor pages, validates every page before writing, then flattens at most 500
-- sanitized rows into one DRAFT reconciliation.  Keep the ordinary one-page
-- route bounded at ten in HTTP/service code; only this internal batch path can
-- reach the wider database ceiling.
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
  occurrences:=(length(definition)-length(replace(definition,old_guard,'')))/length(old_guard);
  IF occurrences<>1 THEN RAISE EXCEPTION 'Unexpected controlled test Bank row guard' USING ERRCODE='22023'; END IF;
  definition:=replace(definition,old_guard,new_guard);
  occurrences:=(length(definition)-length(replace(definition,old_message,'')))/length(old_message);
  IF occurrences<>1 THEN RAISE EXCEPTION 'Unexpected controlled test Bank row error' USING ERRCODE='22023'; END IF;
  definition:=replace(definition,old_message,new_message);
  occurrences:=(length(definition)-length(replace(definition,old_account_guard,'')))/length(old_account_guard);
  IF occurrences<>1 THEN RAISE EXCEPTION 'Unexpected controlled test Bank account guard' USING ERRCODE='22023'; END IF;
  definition:=replace(definition,old_account_guard,new_account_guard);
  EXECUTE definition;
END;
$migration$;

-- A source row previously imported by the one-page July test command has the
-- same immutable source hash as the H1 read.  Namespace only the TEST_ONLY
-- document identity by its observation hash so H1 creates its own dated AP/JE
-- chain while retaining the original source_record_hash verbatim in lineage.
DO $migration$
DECLARE definition text;old_source text:='source_ref:=''object://refs-test-only/''||p_entity||''/''||substr(v_source_hash,8);';new_source text:='source_ref:=''object://refs-test-only/''||p_entity||''/''||substr(v_source_hash,8)||''/''||substr(v_observation_hash,8,16);';old_number text:='document_number:=''WBS-TEST-''||upper(substr(v_source_hash,8,16));';new_number text:='document_number:=''WBS-TEST-''||upper(substr(v_source_hash,8,16))||''-''||upper(substr(v_observation_hash,8,8));';
BEGIN
  SELECT pg_get_functiondef('public.refs_create_wbs_test_payable_draft_v168(uuid,uuid,uuid,jsonb,jsonb,integer,text,text)'::regprocedure) INTO definition;
  IF strpos(definition,old_source)=0 OR strpos(definition,old_number)=0 THEN RAISE EXCEPTION 'Unexpected WBS TEST_ONLY Payable identity function' USING ERRCODE='22023'; END IF;
  EXECUTE replace(replace(definition,old_source,new_source),old_number,new_number);
END;
$migration$;

REVOKE ALL ON FUNCTION refs_create_wbs_controlled_test_bank_scope(uuid,uuid,uuid,text,jsonb,text,text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION refs_create_wbs_controlled_test_bank_scope(uuid,uuid,uuid,text,jsonb,text,text,text) TO refs_app;

COMMIT;
