BEGIN;

CREATE FUNCTION refs_read_ai_ap_invoice_cutoff_inputs(p_tenant uuid,p_entity uuid,p_period uuid,p_limit integer DEFAULT 2000)
RETURNS TABLE(entity_id uuid,current_accounting_period_id uuid,current_period_code text,current_period_starts_on date,current_period_ends_on date,invoice_accounting_period_id uuid,invoice_period_code text,invoice_period_status text,business_document_id uuid,source_document_id uuid,source_payload_hash text,posted_journal_entry_id uuid,posted_journal_status text,vendor_ref text,vendor_name text,document_number text,currency text,gross_amount text,invoice_business_date date,accounting_date date)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE selected_period accounting_period;
BEGIN
  PERFORM refs_assert_ai_analysis_scope(p_tenant,p_entity);
  IF p_limit IS NULL OR p_limit<1 OR p_limit>2000 THEN RAISE EXCEPTION 'AI AP invoice cutoff limit must be between 1 and 2000' USING ERRCODE='22023';END IF;
  SELECT period.* INTO selected_period FROM accounting_period period WHERE period.tenant_id=p_tenant AND period.entity_id=p_entity AND period.period_id=p_period AND period.ledger_code='PRIMARY';
  IF NOT FOUND THEN RAISE EXCEPTION 'AI AP invoice cutoff current accounting period was not found' USING ERRCODE='23503';END IF;
  IF EXISTS(
    SELECT 1 FROM business_document document
    LEFT JOIN source_document source ON source.tenant_id=document.tenant_id AND source.entity_id=document.entity_id AND source.source_document_id=document.source_document_id
    LEFT JOIN journal_entry journal ON journal.tenant_id=document.tenant_id AND journal.entity_id=document.entity_id AND journal.journal_entry_id=document.posted_journal_entry_id
    LEFT JOIN accounting_period invoice_period ON invoice_period.tenant_id=source.tenant_id AND invoice_period.entity_id=source.entity_id AND invoice_period.ledger_code='PRIMARY' AND source.business_date BETWEEN invoice_period.starts_on AND invoice_period.ends_on
    WHERE document.tenant_id=p_tenant AND document.entity_id=p_entity AND document.document_kind='AP_BILL' AND document.accounting_date BETWEEN selected_period.starts_on AND selected_period.ends_on AND document.posted_journal_entry_id IS NOT NULL
      AND (document.source_document_id IS NULL OR source.source_document_id IS NULL OR source.payload_hash!~'^sha256:[0-9a-f]{64}$' OR journal.status<>'POSTED' OR journal.period_id<>p_period OR journal.journal_date<>document.accounting_date OR invoice_period.period_id IS NULL OR NULLIF(btrim(document.counterparty_ref),'') IS NULL)
  ) THEN RAISE EXCEPTION 'AI AP invoice cutoff evidence is incomplete or does not resolve to exact source and Posted-period lineage' USING ERRCODE='23514';END IF;
  RETURN QUERY
  SELECT document.entity_id,selected_period.period_id,selected_period.period_code,selected_period.starts_on,selected_period.ends_on,invoice_period.period_id,invoice_period.period_code,invoice_period.status::text,document.business_document_id,source.source_document_id,source.payload_hash,journal.journal_entry_id,journal.status::text,btrim(document.counterparty_ref),btrim(document.counterparty_name),btrim(document.document_number),document.currency::text,to_char(document.gross_amount,'FM9999999999999990.0000'),source.business_date,document.accounting_date
  FROM business_document document
  JOIN source_document source ON source.tenant_id=document.tenant_id AND source.entity_id=document.entity_id AND source.source_document_id=document.source_document_id
  JOIN journal_entry journal ON journal.tenant_id=document.tenant_id AND journal.entity_id=document.entity_id AND journal.journal_entry_id=document.posted_journal_entry_id AND journal.status='POSTED' AND journal.period_id=p_period AND journal.journal_date=document.accounting_date
  JOIN accounting_period invoice_period ON invoice_period.tenant_id=source.tenant_id AND invoice_period.entity_id=source.entity_id AND invoice_period.ledger_code='PRIMARY' AND source.business_date BETWEEN invoice_period.starts_on AND invoice_period.ends_on
  WHERE document.tenant_id=p_tenant AND document.entity_id=p_entity AND document.document_kind='AP_BILL' AND document.accounting_date BETWEEN selected_period.starts_on AND selected_period.ends_on AND source.payload_hash~'^sha256:[0-9a-f]{64}$'
  ORDER BY source.business_date,document.business_document_id LIMIT p_limit;
END;$$;

REVOKE ALL ON FUNCTION refs_read_ai_ap_invoice_cutoff_inputs(uuid,uuid,uuid,integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION refs_read_ai_ap_invoice_cutoff_inputs(uuid,uuid,uuid,integer) TO refs_app;
COMMIT;
