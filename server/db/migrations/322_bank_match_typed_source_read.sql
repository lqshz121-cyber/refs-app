BEGIN;

-- Add explicit business identity while preserving the existing scoped readers.
CREATE FUNCTION refs_list_bank_transactions_v2(
  p_tenant uuid,
  p_entity uuid,
  p_bank_account_ref text,
  p_from date,
  p_through date,
  p_limit integer,
  p_offset integer
)
RETURNS TABLE(
  bank_source_id uuid, bank_account_ref text, external_bank_line_id text, transaction_date date,
  currency char(3), amount numeric(20,4), version bigint, source_document_id uuid, source_ref text,
  document_type text, bank_match_id uuid, match_status text, business_source_document_id uuid,
  journal_entry_id uuid, journal_line_id uuid, candidate_rule_code text, amount_delta numeric(20,4),
  currency_match boolean, date_delta_days integer, matched_by text, matched_at timestamptz, match_version bigint
,
  match_source_kind text,payment_occurrence_id uuid,sales_receipt_id uuid,sales_receipt_number text,sales_receipt_revision bigint,ledger_line_id uuid
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
BEGIN
  PERFORM public.refs_assert_scope(p_tenant,p_entity,'BANK.VIEW');
  RETURN QUERY
  SELECT r.*,CASE WHEN m.sales_receipt_id IS NOT NULL THEN 'SALES_RECEIPT' WHEN m.payment_occurrence_id IS NOT NULL THEN 'PAYMENT' WHEN m.business_source_document_id IS NOT NULL THEN 'IMPORTED_SOURCE' ELSE NULL END,
    m.payment_occurrence_id,m.sales_receipt_id,s.receipt_number,s.version,m.ledger_line_id
  FROM public.refs_list_bank_transactions(p_tenant,p_entity,p_bank_account_ref,p_from,p_through,p_limit,p_offset) r
  LEFT JOIN public.bank_match m ON m.tenant_id=p_tenant AND m.entity_id=p_entity AND m.bank_source_id=r.bank_source_id AND m.bank_match_id=r.bank_match_id
  LEFT JOIN public.sales_receipt s ON s.tenant_id=m.tenant_id AND s.entity_id=m.entity_id AND s.sales_receipt_id=m.sales_receipt_id
  ORDER BY r.transaction_date DESC,r.external_bank_line_id DESC,r.bank_source_id DESC;
END;
$$;
REVOKE ALL ON FUNCTION refs_list_bank_transactions_v2(uuid,uuid,text,date,date,integer,integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION refs_list_bank_transactions_v2(uuid,uuid,text,date,date,integer,integer) TO refs_app;

CREATE FUNCTION refs_list_reconciliation_worksheet_v2(
  p_tenant uuid,p_entity uuid,p_reconciliation uuid
)
RETURNS TABLE(
  reconciliation_id uuid,reconciliation_version bigint,bank_source_id uuid,bank_version bigint,
  bank_account_ref text,external_bank_line_id text,transaction_date date,currency char(3),amount numeric(20,4),
  bank_match_id uuid,bank_match_version bigint,match_status text,business_source_document_id uuid,
  journal_entry_id uuid,journal_line_id uuid,clearance_state text,reconciliation_item_id uuid,item_version bigint,
  cleared_by text,cleared_at timestamptz,uncleared_by text,uncleared_at timestamptz,
  adjustment_journal_entry_id uuid,adjustment_journal_version bigint,adjustment_journal_status text,
  adjustment_clearance_eligible boolean
,
  match_source_kind text,payment_occurrence_id uuid,sales_receipt_id uuid,sales_receipt_number text,sales_receipt_revision bigint,ledger_line_id uuid
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
BEGIN
  PERFORM public.refs_assert_scope(p_tenant,p_entity,'BANK.VIEW');
  RETURN QUERY
  SELECT r.*,CASE WHEN m.sales_receipt_id IS NOT NULL THEN 'SALES_RECEIPT' WHEN m.payment_occurrence_id IS NOT NULL THEN 'PAYMENT' WHEN m.business_source_document_id IS NOT NULL THEN 'IMPORTED_SOURCE' ELSE NULL END,
    m.payment_occurrence_id,m.sales_receipt_id,s.receipt_number,s.version,m.ledger_line_id
  FROM public.refs_list_reconciliation_worksheet(p_tenant,p_entity,p_reconciliation) r
  LEFT JOIN public.bank_match m ON m.tenant_id=p_tenant AND m.entity_id=p_entity AND m.bank_source_id=r.bank_source_id AND m.bank_match_id=r.bank_match_id
  LEFT JOIN public.sales_receipt s ON s.tenant_id=m.tenant_id AND s.entity_id=m.entity_id AND s.sales_receipt_id=m.sales_receipt_id
  ORDER BY r.transaction_date,r.external_bank_line_id,r.bank_source_id;
END;
$$;
REVOKE ALL ON FUNCTION refs_list_reconciliation_worksheet_v2(uuid,uuid,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION refs_list_reconciliation_worksheet_v2(uuid,uuid,uuid) TO refs_app;

CREATE FUNCTION refs_get_reconciliation_worksheet_item_v2(
  p_tenant uuid,p_entity uuid,p_reconciliation uuid,p_bank_source uuid
)
RETURNS TABLE(
  reconciliation_id uuid,reconciliation_version bigint,bank_source_id uuid,bank_version bigint,
  bank_account_ref text,external_bank_line_id text,transaction_date date,currency char(3),amount numeric(20,4),
  bank_match_id uuid,bank_match_version bigint,match_status text,business_source_document_id uuid,
  journal_entry_id uuid,journal_line_id uuid,clearance_state text,reconciliation_item_id uuid,item_version bigint,
  cleared_by text,cleared_at timestamptz,uncleared_by text,uncleared_at timestamptz,
  adjustment_journal_entry_id uuid,adjustment_journal_version bigint,adjustment_journal_status text,
  adjustment_clearance_eligible boolean
,
  match_source_kind text,payment_occurrence_id uuid,sales_receipt_id uuid,sales_receipt_number text,sales_receipt_revision bigint,ledger_line_id uuid
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
BEGIN
  PERFORM public.refs_assert_scope(p_tenant,p_entity,'BANK.VIEW');
  RETURN QUERY
  SELECT r.*,CASE WHEN m.sales_receipt_id IS NOT NULL THEN 'SALES_RECEIPT' WHEN m.payment_occurrence_id IS NOT NULL THEN 'PAYMENT' WHEN m.business_source_document_id IS NOT NULL THEN 'IMPORTED_SOURCE' ELSE NULL END,
    m.payment_occurrence_id,m.sales_receipt_id,s.receipt_number,s.version,m.ledger_line_id
  FROM public.refs_get_reconciliation_worksheet_item(p_tenant,p_entity,p_reconciliation,p_bank_source) r
  LEFT JOIN public.bank_match m ON m.tenant_id=p_tenant AND m.entity_id=p_entity AND m.bank_source_id=r.bank_source_id AND m.bank_match_id=r.bank_match_id
  LEFT JOIN public.sales_receipt s ON s.tenant_id=m.tenant_id AND s.entity_id=m.entity_id AND s.sales_receipt_id=m.sales_receipt_id
  ORDER BY r.bank_source_id;
END;
$$;
REVOKE ALL ON FUNCTION refs_get_reconciliation_worksheet_item_v2(uuid,uuid,uuid,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION refs_get_reconciliation_worksheet_item_v2(uuid,uuid,uuid,uuid) TO refs_app;

COMMIT;
