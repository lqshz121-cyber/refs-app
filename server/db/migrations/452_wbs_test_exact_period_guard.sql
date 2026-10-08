BEGIN;

-- Invoke inside the same persistence transaction, before any retention writes.
-- This is a scope guard, not a source admission or authorization issuer.
CREATE FUNCTION refs_assert_wbs_test_exact_period(
  p_tenant uuid,p_entity uuid,p_period uuid,p_rows jsonb
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE selected_period accounting_period; source_row jsonb; source_date date;
BEGIN
  PERFORM refs_assert_scope(p_tenant,p_entity,'WBS.TEST.IMPORT');
  SELECT * INTO selected_period FROM accounting_period
    WHERE tenant_id=p_tenant AND entity_id=p_entity AND period_id=p_period
      AND ledger_code='PRIMARY' AND status='OPEN' FOR SHARE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Exact OPEN PRIMARY WBS test period required' USING ERRCODE='55000';
  END IF;
  IF p_rows IS NULL OR jsonb_typeof(p_rows)<>'array' THEN
    RAISE EXCEPTION 'WBS test source rows must be an array' USING ERRCODE='22023';
  END IF;
  IF jsonb_array_length(p_rows) NOT BETWEEN 1 AND 10000 THEN
    RAISE EXCEPTION 'Bounded WBS test source population required' USING ERRCODE='22023';
  END IF;
  FOR source_row IN SELECT value FROM jsonb_array_elements(p_rows) LOOP
    IF jsonb_typeof(source_row)<>'object'
      OR COALESCE(source_row->>'accounting_date','')!~'^[0-9]{4}-[0-9]{2}-[0-9]{2}$' THEN
      RAISE EXCEPTION 'Exact WBS test source date required' USING ERRCODE='22023';
    END IF;
    BEGIN source_date:=(source_row->>'accounting_date')::date;
    EXCEPTION WHEN OTHERS THEN
      RAISE EXCEPTION 'Invalid WBS test source date' USING ERRCODE='22023';
    END;
    IF source_date::text<>source_row->>'accounting_date'
      OR source_date<selected_period.starts_on OR source_date>selected_period.ends_on THEN
      RAISE EXCEPTION 'WBS test source date is outside its exact period' USING ERRCODE='22023';
    END IF;
  END LOOP;
END;
$$;
REVOKE ALL ON FUNCTION refs_assert_wbs_test_exact_period(uuid,uuid,uuid,jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION refs_assert_wbs_test_exact_period(uuid,uuid,uuid,jsonb) TO refs_app;

COMMIT;
