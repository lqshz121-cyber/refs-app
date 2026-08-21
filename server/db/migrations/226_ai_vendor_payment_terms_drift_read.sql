BEGIN;

CREATE FUNCTION refs_read_ai_vendor_payment_terms_history(p_tenant uuid,p_entity uuid,p_period uuid,p_limit integer DEFAULT 2000)
RETURNS TABLE(entity_id uuid,accounting_period_id uuid,business_document_id uuid,source_document_id uuid,source_payload_hash text,posted_journal_entry_id uuid,vendor_ref text,vendor_name text,document_number text,invoice_date date,due_date date,is_current_period boolean)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE selected_period accounting_period;
BEGIN
  PERFORM refs_assert_ai_analysis_scope(p_tenant,p_entity);
  IF p_limit IS NULL OR p_limit<1 OR p_limit>2000 THEN RAISE EXCEPTION 'AI vendor payment-terms history limit must be between 1 and 2000' USING ERRCODE='22023';END IF;
  SELECT period.* INTO selected_period FROM accounting_period period WHERE period.tenant_id=p_tenant AND period.entity_id=p_entity AND period.period_id=p_period AND period.ledger_code='PRIMARY';
  IF NOT FOUND THEN RAISE EXCEPTION 'AI vendor payment-terms current accounting period was not found' USING ERRCODE='23503';END IF;
  IF EXISTS(
    SELECT 1 FROM business_document document
    JOIN accounting_period period ON period.tenant_id=document.tenant_id AND period.entity_id=document.entity_id AND document.accounting_date BETWEEN period.starts_on AND period.ends_on AND period.ledger_code='PRIMARY'
    LEFT JOIN source_document source ON source.tenant_id=document.tenant_id AND source.entity_id=document.entity_id AND source.source_document_id=document.source_document_id
    LEFT JOIN journal_entry journal ON journal.tenant_id=document.tenant_id AND journal.entity_id=document.entity_id AND journal.journal_entry_id=document.posted_journal_entry_id
    WHERE document.tenant_id=p_tenant AND document.entity_id=p_entity AND document.document_kind='AP_BILL' AND period.ends_on<=selected_period.ends_on AND document.posted_journal_entry_id IS NOT NULL
      AND (document.source_document_id IS NULL OR source.source_document_id IS NULL OR source.payload_hash!~'^sha256:[0-9a-f]{64}$' OR journal.status<>'POSTED' OR journal.period_id<>period.period_id OR journal.journal_date<>document.accounting_date OR NULLIF(btrim(document.counterparty_ref),'') IS NULL OR document.due_date IS NOT NULL AND document.due_date<source.business_date)
  ) THEN RAISE EXCEPTION 'AI vendor payment-terms history contains incomplete or inconsistent source and Posted evidence' USING ERRCODE='23514';END IF;
  RETURN QUERY
  SELECT document.entity_id,period.period_id,document.business_document_id,source.source_document_id,source.payload_hash,journal.journal_entry_id,btrim(document.counterparty_ref),btrim(document.counterparty_name),btrim(document.document_number),source.business_date,document.due_date,(period.period_id=p_period)
  FROM business_document document
  JOIN accounting_period period ON period.tenant_id=document.tenant_id AND period.entity_id=document.entity_id AND document.accounting_date BETWEEN period.starts_on AND period.ends_on AND period.ledger_code='PRIMARY'
  JOIN source_document source ON source.tenant_id=document.tenant_id AND source.entity_id=document.entity_id AND source.source_document_id=document.source_document_id AND source.payload_hash~'^sha256:[0-9a-f]{64}$'
  JOIN journal_entry journal ON journal.tenant_id=document.tenant_id AND journal.entity_id=document.entity_id AND journal.journal_entry_id=document.posted_journal_entry_id AND journal.status='POSTED' AND journal.period_id=period.period_id AND journal.journal_date=document.accounting_date
  WHERE document.tenant_id=p_tenant AND document.entity_id=p_entity AND document.document_kind='AP_BILL' AND period.ends_on<=selected_period.ends_on
  ORDER BY period.ends_on DESC,document.business_document_id LIMIT p_limit;
END;$$;

REVOKE ALL ON FUNCTION refs_read_ai_vendor_payment_terms_history(uuid,uuid,uuid,integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION refs_read_ai_vendor_payment_terms_history(uuid,uuid,uuid,integer) TO refs_app;
COMMIT;
