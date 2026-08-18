BEGIN;

ALTER FUNCTION refs_create_wbs_test_payable_draft(uuid,uuid,uuid,jsonb,jsonb,integer,text,text)
  RENAME TO refs_create_wbs_test_payable_draft_v168;

REVOKE ALL ON FUNCTION refs_create_wbs_test_payable_draft_v168(uuid,uuid,uuid,jsonb,jsonb,integer,text,text)
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
  -- This forward-only compatibility wrapper remains limited by the original
  -- staging TEST_ONLY command and its WBS.TEST.IMPORT scope assertion.
  PERFORM public.refs_assert_scope(p_tenant,p_entity,'WBS.TEST.IMPORT');

  INSERT INTO public.account_master(
    tenant_id,entity_id,account_code,account_name,
    requires_member,required_member_type,active
  ) VALUES (
    p_tenant,p_entity,'291001','Accounts Payable',true,'VENDOR',true
  ) ON CONFLICT DO NOTHING;

  PERFORM 1
  FROM public.account_master
  WHERE tenant_id=p_tenant
    AND entity_id=p_entity
    AND account_code='291001'
    AND active
    AND requires_member
    AND required_member_type='VENDOR'
  FOR SHARE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'WBS test AP control account conflicts with existing master data'
      USING ERRCODE='23514';
  END IF;

  RETURN public.refs_create_wbs_test_payable_draft_v168(
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
