BEGIN;

-- Read-only, period-scoped evidence adapter for deterministic duplicate-payment
-- analysis. Only provider-signed and formally admitted WBS bank rows qualify.
CREATE FUNCTION refs_read_ai_bank_duplicate_payment_sources(
  p_tenant uuid,
  p_entity uuid,
  p_period uuid,
  p_limit integer DEFAULT 500
)
RETURNS TABLE(
  bank_source_id uuid,
  source_document_id uuid,
  source_payload_hash text,
  entity_id uuid,
  accounting_period_id uuid,
  bank_account_ref text,
  external_bank_line_id text,
  transaction_date date,
  currency char(3),
  amount numeric(20,4),
  source_admission_status text,
  signature_verified boolean
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE selected_period accounting_period;
BEGIN
  PERFORM refs_assert_scope(p_tenant,p_entity,'AI.ANALYSIS.EXPLAIN');
  IF p_limit IS NULL OR p_limit<1 OR p_limit>500 THEN
    RAISE EXCEPTION 'AI bank duplicate-payment source limit must be between 1 and 500' USING ERRCODE='22023';
  END IF;
  SELECT period.* INTO selected_period
  FROM accounting_period period
  WHERE period.tenant_id=p_tenant AND period.entity_id=p_entity AND period.period_id=p_period;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'AI bank duplicate-payment accounting period was not found' USING ERRCODE='23503';
  END IF;
  RETURN QUERY
    SELECT bank.bank_source_id,document.source_document_id,document.payload_hash,bank.entity_id,selected_period.period_id,
      bank.bank_account_ref,bank.external_bank_line_id,bank.transaction_date,bank.currency,bank.amount,
      receipt.admission_status,receipt.signature_verified
    FROM bank_source bank
    JOIN source_document document
      ON document.tenant_id=bank.tenant_id AND document.entity_id=bank.entity_id AND document.source_document_id=bank.source_document_id
    JOIN wbs_bank_statement_transaction txn
      ON txn.tenant_id=bank.tenant_id AND txn.entity_id=bank.entity_id AND txn.bank_source_id=bank.bank_source_id AND txn.source_document_id=document.source_document_id
    JOIN wbs_bank_statement_receipt receipt
      ON receipt.tenant_id=txn.tenant_id AND receipt.entity_id=txn.entity_id AND receipt.wbs_bank_statement_receipt_id=txn.wbs_bank_statement_receipt_id
    WHERE bank.tenant_id=p_tenant AND bank.entity_id=p_entity
      AND bank.transaction_date BETWEEN selected_period.starts_on AND selected_period.ends_on
      AND bank.amount<0
      AND document.payload_hash~'^sha256:[0-9a-f]{64}$'
      AND receipt.signature_verified=true AND receipt.admission_status='ADMITTED'
    ORDER BY bank.transaction_date,bank.bank_account_ref,bank.amount,bank.bank_source_id
    LIMIT p_limit;
END;
$$;

REVOKE ALL ON FUNCTION refs_read_ai_bank_duplicate_payment_sources(uuid,uuid,uuid,integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION refs_read_ai_bank_duplicate_payment_sources(uuid,uuid,uuid,integer) TO refs_app;

COMMIT;
