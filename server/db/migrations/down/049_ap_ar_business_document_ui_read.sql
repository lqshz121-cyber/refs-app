BEGIN;

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
      d.version,d.created_at,d.updated_at
    FROM public.business_document d
    WHERE d.tenant_id=p_tenant AND d.entity_id=p_entity AND d.document_kind=p_kind
    ORDER BY d.accounting_date DESC,d.created_at DESC,d.business_document_id DESC;
END;
$$;

REVOKE ALL ON FUNCTION refs_list_business_documents(uuid,uuid,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION refs_list_business_documents(uuid,uuid,text) TO refs_app;

COMMIT;
