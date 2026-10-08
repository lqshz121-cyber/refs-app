BEGIN;
ALTER FUNCTION refs_retain_wbs_test_payable_source(uuid,uuid,uuid,jsonb,jsonb,integer,text,text)
  RENAME TO refs_retain_wbs_test_payable_source_454;
CREATE FUNCTION refs_retain_wbs_test_payable_source(
  p_tenant uuid,p_entity uuid,p_period uuid,p_observation jsonb,p_row jsonb,p_row_index integer,
  p_idempotency_key text,p_request_hash text
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
BEGIN
  PERFORM refs_assert_scope(p_tenant,p_entity,'WBS.TEST.IMPORT');
  IF COALESCE(p_row->>'amount','')!~'^(0|[1-9][0-9]{0,15})\.[0-9]{4}$'
    OR (p_row->>'amount')::numeric<=0 THEN
    RAISE EXCEPTION 'Verified positive Payable source semantics required; negative amounts cannot become positive bills' USING ERRCODE='22023';
  END IF;
  RETURN refs_retain_wbs_test_payable_source_454(p_tenant,p_entity,p_period,p_observation,p_row,p_row_index,p_idempotency_key,p_request_hash);
END;
$$;
REVOKE ALL ON FUNCTION refs_retain_wbs_test_payable_source_454(uuid,uuid,uuid,jsonb,jsonb,integer,text,text) FROM PUBLIC,refs_app;
REVOKE ALL ON FUNCTION refs_retain_wbs_test_payable_source(uuid,uuid,uuid,jsonb,jsonb,integer,text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION refs_retain_wbs_test_payable_source(uuid,uuid,uuid,jsonb,jsonb,integer,text,text) TO refs_app;
COMMIT;
