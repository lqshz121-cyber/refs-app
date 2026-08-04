BEGIN;

CREATE OR REPLACE FUNCTION refs_ap_control_total(p_tenant uuid,p_entity uuid)
RETURNS TABLE(currency char(3),open_balance numeric(20,4),control_balance numeric(20,4),in_balance boolean)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
BEGIN
  PERFORM public.refs_assert_scope(p_tenant,p_entity,'AP.VIEW');
  RETURN QUERY SELECT r.currency,r.ap_open_balance,r.ap_control_balance,r.ap_in_balance
    FROM public.refs_ap_ar_control_reconciliation r WHERE r.tenant_id=p_tenant AND r.entity_id=p_entity;
END;
$$;

CREATE OR REPLACE FUNCTION refs_ar_control_total(p_tenant uuid,p_entity uuid)
RETURNS TABLE(currency char(3),open_balance numeric(20,4),control_balance numeric(20,4),in_balance boolean)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
BEGIN
  PERFORM public.refs_assert_scope(p_tenant,p_entity,'AR.VIEW');
  RETURN QUERY SELECT r.currency,r.ar_open_balance,r.ar_control_balance,r.ar_in_balance
    FROM public.refs_ap_ar_control_reconciliation r WHERE r.tenant_id=p_tenant AND r.entity_id=p_entity;
END;
$$;

REVOKE ALL ON FUNCTION refs_ap_control_total(uuid,uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION refs_ar_control_total(uuid,uuid) FROM PUBLIC;
REVOKE SELECT ON refs_ap_ar_control_reconciliation FROM refs_app;
GRANT EXECUTE ON FUNCTION refs_ap_control_total(uuid,uuid) TO refs_app;
GRANT EXECUTE ON FUNCTION refs_ar_control_total(uuid,uuid) TO refs_app;
COMMIT;
