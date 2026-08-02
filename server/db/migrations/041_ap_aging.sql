BEGIN;

CREATE OR REPLACE FUNCTION refs_ap_aging(p_tenant uuid,p_entity uuid,p_as_of date)
RETURNS TABLE(
  currency char(3),
  current_amount numeric(20,4),
  days_1_30 numeric(20,4),
  days_31_60 numeric(20,4),
  days_61_90 numeric(20,4),
  days_91_plus numeric(20,4),
  total_open_balance numeric(20,4)
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
BEGIN
  PERFORM public.refs_assert_scope(p_tenant,p_entity,'AP.VIEW');
  IF p_as_of IS NULL THEN RAISE EXCEPTION 'Aging date is required' USING ERRCODE='22004'; END IF;
  RETURN QUERY
  SELECT d.currency,
    COALESCE(sum(d.open_balance) FILTER (WHERE p_as_of<=COALESCE(d.due_date,d.accounting_date)),0)::numeric(20,4),
    COALESCE(sum(d.open_balance) FILTER (WHERE p_as_of-COALESCE(d.due_date,d.accounting_date) BETWEEN 1 AND 30),0)::numeric(20,4),
    COALESCE(sum(d.open_balance) FILTER (WHERE p_as_of-COALESCE(d.due_date,d.accounting_date) BETWEEN 31 AND 60),0)::numeric(20,4),
    COALESCE(sum(d.open_balance) FILTER (WHERE p_as_of-COALESCE(d.due_date,d.accounting_date) BETWEEN 61 AND 90),0)::numeric(20,4),
    COALESCE(sum(d.open_balance) FILTER (WHERE p_as_of-COALESCE(d.due_date,d.accounting_date)>=91),0)::numeric(20,4),
    COALESCE(sum(d.open_balance),0)::numeric(20,4)
  FROM public.business_document d
  WHERE d.tenant_id=p_tenant AND d.entity_id=p_entity AND d.document_kind='AP_BILL'
    AND d.status NOT IN ('DRAFT','PENDING_POST','VOID','REVERSED')
  GROUP BY d.currency;
END;
$$;

REVOKE ALL ON FUNCTION refs_ap_aging(uuid,uuid,date) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION refs_ap_aging(uuid,uuid,date) TO refs_app;
COMMIT;
