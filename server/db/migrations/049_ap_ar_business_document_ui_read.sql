BEGIN;

-- The browser must render the authoritative source account and description
-- instead of retaining a parallel local copy.  These values are derived from
-- the immutable Draft/Posted journal which backs a native business document.
REVOKE EXECUTE ON FUNCTION refs_list_business_documents(uuid,uuid,text) FROM refs_app;
DROP FUNCTION refs_list_business_documents(uuid,uuid,text);

CREATE FUNCTION refs_list_business_documents(p_tenant uuid,p_entity uuid,p_kind text)
RETURNS TABLE(
  business_document_id uuid,
  document_number text,
  counterparty_ref text,
  counterparty_name text,
  currency char(3),
  accounting_date date,
  due_date date,
  gross_amount numeric(20,4),
  open_balance numeric(20,4),
  status text,
  posted_journal_entry_id uuid,
  version bigint,
  offset_account_code text,
  description text,
  created_at timestamptz,
  updated_at timestamptz
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE required_permission text;
BEGIN
  IF p_kind='AP_BILL' THEN required_permission:='AP.VIEW';
  ELSIF p_kind='AR_INVOICE' THEN required_permission:='AR.VIEW';
  ELSE RAISE EXCEPTION 'Unsupported business document kind' USING ERRCODE='22023';
  END IF;
  PERFORM public.refs_assert_scope(p_tenant,p_entity,required_permission);
  RETURN QUERY
    SELECT d.business_document_id,d.document_number,d.counterparty_ref,d.counterparty_name,d.currency,
      d.accounting_date,d.due_date,d.gross_amount,d.open_balance,d.status,d.posted_journal_entry_id,
      d.version,lines.offset_account_code,journals.description,d.created_at,d.updated_at
    FROM public.business_document d
    LEFT JOIN public.journal_entry journals
      ON journals.tenant_id=d.tenant_id AND journals.entity_id=d.entity_id
      AND journals.journal_entry_id=COALESCE(d.draft_journal_entry_id,d.posted_journal_entry_id)
    LEFT JOIN LATERAL (
      SELECT line.account_code AS offset_account_code
      FROM public.journal_line line
      WHERE line.tenant_id=d.tenant_id AND line.entity_id=d.entity_id
        AND line.journal_entry_id=COALESCE(d.draft_journal_entry_id,d.posted_journal_entry_id)
        AND ((d.document_kind='AP_BILL' AND line.line_no=1) OR (d.document_kind='AR_INVOICE' AND line.line_no=2))
      LIMIT 1
    ) lines ON true
    WHERE d.tenant_id=p_tenant AND d.entity_id=p_entity AND d.document_kind=p_kind
    ORDER BY d.accounting_date DESC,d.created_at DESC,d.business_document_id DESC;
END;
$$;

REVOKE ALL ON FUNCTION refs_list_business_documents(uuid,uuid,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION refs_list_business_documents(uuid,uuid,text) TO refs_app;

COMMIT;
