BEGIN;

-- Aging is a subledger report.  It must include still-available posted
-- credits, otherwise its total diverges from the AP/AR control accounts.
CREATE OR REPLACE FUNCTION refs_ar_aging(p_tenant uuid,p_entity uuid,p_as_of date)
RETURNS TABLE(currency char(3),current_amount numeric(20,4),days_1_30 numeric(20,4),days_31_60 numeric(20,4),days_61_90 numeric(20,4),days_91_plus numeric(20,4),total_open_balance numeric(20,4))
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
BEGIN
  PERFORM public.refs_assert_scope(p_tenant,p_entity,'AR.VIEW');
  IF p_as_of IS NULL THEN RAISE EXCEPTION 'Aging date is required' USING ERRCODE='22004'; END IF;
  RETURN QUERY
  WITH allocations AS (
    SELECT tenant_id,entity_id,business_adjustment_id,COALESCE(sum(amount) FILTER (WHERE status='ACTIVE'),0)::numeric(20,4) AS active_amount
    FROM public.business_allocation GROUP BY tenant_id,entity_id,business_adjustment_id
  ), refunds AS (
    SELECT tenant_id,entity_id,source_adjustment_id,COALESCE(sum(amount) FILTER (WHERE status='POSTED'),0)::numeric(20,4) AS posted_amount
    FROM public.business_adjustment WHERE adjustment_kind='AR_REFUND' GROUP BY tenant_id,entity_id,source_adjustment_id
  ), movements AS (
    SELECT d.currency,d.open_balance::numeric(20,4) AS amount,COALESCE(d.due_date,d.accounting_date) AS aging_date
    FROM public.business_document d
    WHERE d.tenant_id=p_tenant AND d.entity_id=p_entity AND d.document_kind='AR_INVOICE'
      AND d.status NOT IN ('DRAFT','PENDING_POST','VOID','REVERSED') AND d.accounting_date<=p_as_of
    UNION ALL
    SELECT a.currency,(-a.amount+COALESCE(al.active_amount,0)+COALESCE(r.posted_amount,0))::numeric(20,4),a.accounting_date
    FROM public.business_adjustment a
    LEFT JOIN allocations al ON al.tenant_id=a.tenant_id AND al.entity_id=a.entity_id AND al.business_adjustment_id=a.business_adjustment_id
    LEFT JOIN refunds r ON r.tenant_id=a.tenant_id AND r.entity_id=a.entity_id AND r.source_adjustment_id=a.business_adjustment_id
    WHERE a.tenant_id=p_tenant AND a.entity_id=p_entity AND a.adjustment_kind='AR_CREDIT_MEMO' AND a.status='POSTED'
      AND a.accounting_date<=p_as_of AND a.amount-COALESCE(al.active_amount,0)-COALESCE(r.posted_amount,0)<>0
  )
  SELECT m.currency,
    COALESCE(sum(m.amount) FILTER (WHERE p_as_of<=m.aging_date),0)::numeric(20,4),
    COALESCE(sum(m.amount) FILTER (WHERE p_as_of-m.aging_date BETWEEN 1 AND 30),0)::numeric(20,4),
    COALESCE(sum(m.amount) FILTER (WHERE p_as_of-m.aging_date BETWEEN 31 AND 60),0)::numeric(20,4),
    COALESCE(sum(m.amount) FILTER (WHERE p_as_of-m.aging_date BETWEEN 61 AND 90),0)::numeric(20,4),
    COALESCE(sum(m.amount) FILTER (WHERE p_as_of-m.aging_date>=91),0)::numeric(20,4),
    COALESCE(sum(m.amount),0)::numeric(20,4)
  FROM movements m GROUP BY m.currency;
END;
$$;

CREATE OR REPLACE FUNCTION refs_ap_aging(p_tenant uuid,p_entity uuid,p_as_of date)
RETURNS TABLE(currency char(3),current_amount numeric(20,4),days_1_30 numeric(20,4),days_31_60 numeric(20,4),days_61_90 numeric(20,4),days_91_plus numeric(20,4),total_open_balance numeric(20,4))
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
BEGIN
  PERFORM public.refs_assert_scope(p_tenant,p_entity,'AP.VIEW');
  IF p_as_of IS NULL THEN RAISE EXCEPTION 'Aging date is required' USING ERRCODE='22004'; END IF;
  RETURN QUERY
  WITH allocations AS (
    SELECT tenant_id,entity_id,business_adjustment_id,COALESCE(sum(amount) FILTER (WHERE status='ACTIVE'),0)::numeric(20,4) AS active_amount
    FROM public.business_allocation GROUP BY tenant_id,entity_id,business_adjustment_id
  ), movements AS (
    SELECT d.currency,d.open_balance::numeric(20,4) AS amount,COALESCE(d.due_date,d.accounting_date) AS aging_date
    FROM public.business_document d
    WHERE d.tenant_id=p_tenant AND d.entity_id=p_entity AND d.document_kind='AP_BILL'
      AND d.status NOT IN ('DRAFT','PENDING_POST','VOID','REVERSED') AND d.accounting_date<=p_as_of
    UNION ALL
    SELECT a.currency,(-a.amount+COALESCE(al.active_amount,0))::numeric(20,4),a.accounting_date
    FROM public.business_adjustment a
    LEFT JOIN allocations al ON al.tenant_id=a.tenant_id AND al.entity_id=a.entity_id AND al.business_adjustment_id=a.business_adjustment_id
    WHERE a.tenant_id=p_tenant AND a.entity_id=p_entity AND a.adjustment_kind='AP_VENDOR_CREDIT' AND a.status='POSTED'
      AND a.accounting_date<=p_as_of AND a.amount-COALESCE(al.active_amount,0)<>0
  )
  SELECT m.currency,
    COALESCE(sum(m.amount) FILTER (WHERE p_as_of<=m.aging_date),0)::numeric(20,4),
    COALESCE(sum(m.amount) FILTER (WHERE p_as_of-m.aging_date BETWEEN 1 AND 30),0)::numeric(20,4),
    COALESCE(sum(m.amount) FILTER (WHERE p_as_of-m.aging_date BETWEEN 31 AND 60),0)::numeric(20,4),
    COALESCE(sum(m.amount) FILTER (WHERE p_as_of-m.aging_date BETWEEN 61 AND 90),0)::numeric(20,4),
    COALESCE(sum(m.amount) FILTER (WHERE p_as_of-m.aging_date>=91),0)::numeric(20,4),
    COALESCE(sum(m.amount),0)::numeric(20,4)
  FROM movements m GROUP BY m.currency;
END;
$$;

REVOKE ALL ON FUNCTION refs_ar_aging(uuid,uuid,date) FROM PUBLIC;
REVOKE ALL ON FUNCTION refs_ap_aging(uuid,uuid,date) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION refs_ar_aging(uuid,uuid,date) TO refs_app;
GRANT EXECUTE ON FUNCTION refs_ap_aging(uuid,uuid,date) TO refs_app;

COMMIT;
