BEGIN;

CREATE FUNCTION refs_read_ai_vendor_account_coding_history(p_tenant uuid,p_entity uuid,p_period uuid,p_limit integer DEFAULT 2000)
RETURNS TABLE(entity_id uuid,accounting_period_id uuid,business_document_id uuid,source_document_id uuid,source_payload_hash text,posted_journal_entry_id uuid,posted_journal_line_id uuid,posted_line_hash text,vendor_ref text,vendor_name text,document_number text,account_code text,account_name text,is_current_period boolean)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE selected_period accounting_period;
BEGIN
  PERFORM refs_assert_ai_analysis_scope(p_tenant,p_entity);
  IF p_limit IS NULL OR p_limit<1 OR p_limit>2000 THEN RAISE EXCEPTION 'AI vendor account coding history limit must be between 1 and 2000' USING ERRCODE='22023';END IF;
  SELECT period.* INTO selected_period FROM accounting_period period WHERE period.tenant_id=p_tenant AND period.entity_id=p_entity AND period.period_id=p_period;
  IF NOT FOUND THEN RAISE EXCEPTION 'AI vendor account coding current accounting period was not found' USING ERRCODE='23503';END IF;
  IF EXISTS(
    SELECT 1 FROM business_document document
    JOIN accounting_period period ON period.tenant_id=document.tenant_id AND period.entity_id=document.entity_id AND document.accounting_date BETWEEN period.starts_on AND period.ends_on
    LEFT JOIN source_document source ON source.tenant_id=document.tenant_id AND source.entity_id=document.entity_id AND source.source_document_id=document.source_document_id
    LEFT JOIN journal_entry journal ON journal.tenant_id=document.tenant_id AND journal.entity_id=document.entity_id AND journal.journal_entry_id=document.posted_journal_entry_id
    LEFT JOIN journal_line line ON line.tenant_id=journal.tenant_id AND line.entity_id=journal.entity_id AND line.period_id=journal.period_id AND line.journal_entry_id=journal.journal_entry_id AND line.line_no=1
    LEFT JOIN account_master account ON account.tenant_id=line.tenant_id AND account.entity_id=line.entity_id AND account.account_code=line.account_code
    WHERE document.tenant_id=p_tenant AND document.entity_id=p_entity AND document.document_kind='AP_BILL' AND period.ends_on<=selected_period.ends_on AND document.posted_journal_entry_id IS NOT NULL
      AND (document.source_document_id IS NULL OR source.source_document_id IS NULL OR source.payload_hash!~'^sha256:[0-9a-f]{64}$' OR journal.status<>'POSTED' OR line.journal_line_id IS NULL OR line.debit_amount<=0 OR line.credit_amount<>0 OR account.account_code IS NULL OR NULLIF(btrim(document.counterparty_ref),'') IS NULL)
  ) THEN RAISE EXCEPTION 'AI vendor account coding history contains incomplete source or Posted debit-line evidence' USING ERRCODE='23514';END IF;
  RETURN QUERY
  SELECT document.entity_id,period.period_id,document.business_document_id,source.source_document_id,source.payload_hash,journal.journal_entry_id,line.journal_line_id,
    refs_jsonb_hash(jsonb_build_object('schema_version','AI_VENDOR_POSTED_AP_CODING_LINE_V1','journal_entry_id',journal.journal_entry_id,'journal_line_id',line.journal_line_id,'account_code',line.account_code,'debit_amount',line.debit_amount,'credit_amount',line.credit_amount,'member_ref',line.member_ref,'dimensions',line.dimensions)),
    btrim(document.counterparty_ref),btrim(document.counterparty_name),btrim(document.document_number),line.account_code,account.account_name,(period.period_id=p_period)
  FROM business_document document
  JOIN accounting_period period ON period.tenant_id=document.tenant_id AND period.entity_id=document.entity_id AND document.accounting_date BETWEEN period.starts_on AND period.ends_on
  JOIN source_document source ON source.tenant_id=document.tenant_id AND source.entity_id=document.entity_id AND source.source_document_id=document.source_document_id
  JOIN journal_entry journal ON journal.tenant_id=document.tenant_id AND journal.entity_id=document.entity_id AND journal.journal_entry_id=document.posted_journal_entry_id AND journal.status='POSTED'
  JOIN journal_line line ON line.tenant_id=journal.tenant_id AND line.entity_id=journal.entity_id AND line.period_id=journal.period_id AND line.journal_entry_id=journal.journal_entry_id AND line.line_no=1 AND line.debit_amount>0 AND line.credit_amount=0
  JOIN account_master account ON account.tenant_id=line.tenant_id AND account.entity_id=line.entity_id AND account.account_code=line.account_code
  WHERE document.tenant_id=p_tenant AND document.entity_id=p_entity AND document.document_kind='AP_BILL' AND period.ends_on<=selected_period.ends_on AND source.payload_hash~'^sha256:[0-9a-f]{64}$'
  ORDER BY period.ends_on DESC,document.accounting_date DESC,document.business_document_id
  LIMIT p_limit;
END;$$;

REVOKE ALL ON FUNCTION refs_read_ai_vendor_account_coding_history(uuid,uuid,uuid,integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION refs_read_ai_vendor_account_coding_history(uuid,uuid,uuid,integer) TO refs_app;
COMMIT;
