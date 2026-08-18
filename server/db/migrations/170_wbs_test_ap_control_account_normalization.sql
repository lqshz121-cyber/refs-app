BEGIN;

ALTER FUNCTION refs_create_wbs_test_payable_draft(uuid,uuid,uuid,jsonb,jsonb,integer,text,text)
  RENAME TO refs_create_wbs_test_payable_draft_v169;

REVOKE ALL ON FUNCTION refs_create_wbs_test_payable_draft_v169(uuid,uuid,uuid,jsonb,jsonb,integer,text,text)
  FROM PUBLIC,refs_app;

CREATE FUNCTION refs_create_wbs_test_payable_draft(
  p_tenant uuid,
  p_entity uuid,
  p_period uuid,
  p_observation jsonb,
  p_row jsonb,
  p_row_index integer,
  p_idempotency_key text,
  p_request_hash text
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
BEGIN
  -- Normalization is reachable only through the staging TEST_ONLY command by
  -- an actor already scoped to this exact entity with WBS.TEST.IMPORT.
  PERFORM public.refs_assert_scope(p_tenant,p_entity,'WBS.TEST.IMPORT');

  UPDATE public.account_master
  SET active=true,requires_member=true,required_member_type='VENDOR'
  WHERE tenant_id=p_tenant
    AND entity_id=p_entity
    AND account_code='291001'
    AND (NOT active OR NOT requires_member OR required_member_type IS DISTINCT FROM 'VENDOR');

  RETURN public.refs_create_wbs_test_payable_draft_v169(
    p_tenant,p_entity,p_period,p_observation,p_row,p_row_index,
    p_idempotency_key,p_request_hash
  );
END;
$$;

REVOKE ALL ON FUNCTION refs_create_wbs_test_payable_draft(uuid,uuid,uuid,jsonb,jsonb,integer,text,text)
  FROM PUBLIC;
GRANT EXECUTE ON FUNCTION refs_create_wbs_test_payable_draft(uuid,uuid,uuid,jsonb,jsonb,integer,text,text)
  TO refs_app;

COMMIT;
