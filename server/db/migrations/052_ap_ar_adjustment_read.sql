BEGIN;

-- Adjustment commands are not authoritative to a browser until their durable
-- state and linked JE workflow can be read back from the scoped ledger.
CREATE FUNCTION refs_list_business_adjustments(p_tenant uuid,p_entity uuid,p_module text)
RETURNS TABLE(
  business_adjustment_id uuid, adjustment_kind text, business_document_id uuid,
  source_adjustment_id uuid, amount numeric(20,4), currency char(3),
  accounting_date date, period_id uuid, reason text, status text, version bigint,
  journal_entry_id uuid, journal_status text, journal_revision bigint,
  created_at timestamptz
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE required_permission text;
BEGIN
  IF p_module='AP' THEN required_permission:='AP.VIEW';
  ELSIF p_module='AR' THEN required_permission:='AR.VIEW';
  ELSE RAISE EXCEPTION 'Unsupported adjustment module' USING ERRCODE='22023';
  END IF;
  PERFORM public.refs_assert_scope(p_tenant,p_entity,required_permission);
  RETURN QUERY
    SELECT a.business_adjustment_id,a.adjustment_kind,a.business_document_id,
      a.source_adjustment_id,a.amount,a.currency,a.accounting_date,a.period_id,
      a.reason,a.status,a.version,j.journal_entry_id,j.status::text,j.revision,a.created_at
    FROM public.business_adjustment a
    LEFT JOIN public.journal_entry j ON j.tenant_id=a.tenant_id AND j.entity_id=a.entity_id
      AND j.journal_entry_id=COALESCE(a.draft_journal_entry_id,a.posted_journal_entry_id)
    WHERE a.tenant_id=p_tenant AND a.entity_id=p_entity
      AND ((p_module='AP' AND a.adjustment_kind IN ('AP_BILL_VOID','AP_VENDOR_CREDIT','AP_PAYMENT_REVERSAL'))
        OR (p_module='AR' AND a.adjustment_kind IN ('AR_CREDIT_MEMO','AR_REFUND','AR_RECEIPT_REVERSAL')))
    ORDER BY a.accounting_date DESC,a.created_at DESC,a.business_adjustment_id DESC;
END;
$$;

REVOKE ALL ON FUNCTION refs_list_business_adjustments(uuid,uuid,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION refs_list_business_adjustments(uuid,uuid,text) TO refs_app;

COMMIT;
