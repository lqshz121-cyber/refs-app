BEGIN;

CREATE OR REPLACE FUNCTION refs_resolve_wbs_test_bank_match_fixture(p_tenant uuid,p_entity uuid)
RETURNS TABLE(
  period_id uuid,
  bank_source_id uuid,
  bank_version bigint,
  bank_account_ref text,
  transaction_date date,
  currency char(3),
  payment_amount numeric(20,4),
  business_document_id uuid,
  document_number text,
  active_bank_match_id uuid,
  active_payment_occurrence_id uuid,
  active_journal_entry_id uuid,
  active_journal_line_id uuid,
  active_ledger_line_id uuid,
  active_match_revision bigint
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
BEGIN
  PERFORM public.refs_assert_scope(p_tenant,p_entity,'WBS.TEST.IMPORT');
  PERFORM public.refs_assert_scope(p_tenant,p_entity,'BANK.VIEW');
  PERFORM public.refs_assert_scope(p_tenant,p_entity,'AP.VIEW');

  RETURN QUERY
  WITH bank_choice AS (
    SELECT b.*
    FROM public.bank_source b
    JOIN public.source_document d
      ON d.tenant_id=b.tenant_id AND d.entity_id=b.entity_id AND d.source_document_id=b.source_document_id
    WHERE b.tenant_id=p_tenant AND b.entity_id=p_entity
      AND b.bank_account_ref='WBS_TEST_BANK'
      AND b.amount<0
      AND d.document_type='WBS_TEST_BANK_TRANSACTION'
      AND NOT EXISTS(
        SELECT 1 FROM public.reconciliation_item i
        WHERE i.tenant_id=b.tenant_id AND i.entity_id=b.entity_id AND i.bank_source_id=b.bank_source_id
      )
    ORDER BY b.transaction_date,b.bank_source_id
    LIMIT 1
  ), fixture AS (
    SELECT p.period_id,b.bank_source_id,b.version AS bank_version,b.bank_account_ref,b.transaction_date,b.currency,
      -b.amount AS payment_amount,bill.business_document_id,bill.document_number,
      active.bank_match_id AS active_bank_match_id,active.payment_occurrence_id AS active_payment_occurrence_id,
      active.journal_entry_id AS active_journal_entry_id,active.journal_line_id AS active_journal_line_id,
      active.ledger_line_id AS active_ledger_line_id,active.version AS active_match_revision
    FROM bank_choice b
    JOIN public.accounting_period p
      ON p.tenant_id=b.tenant_id AND p.entity_id=b.entity_id AND p.ledger_code='PRIMARY'
        AND p.status='OPEN' AND b.transaction_date BETWEEN p.starts_on AND p.ends_on
    LEFT JOIN LATERAL (
      SELECT bm.bank_match_id,bm.business_source_document_id,bm.payment_occurrence_id,bm.journal_entry_id,
        bm.journal_line_id,bm.ledger_line_id,bm.version
      FROM public.bank_match bm
      WHERE bm.tenant_id=p_tenant AND bm.entity_id=p_entity
        AND bm.bank_source_id=b.bank_source_id AND bm.status='ACTIVE'
      ORDER BY bm.bank_match_id
      LIMIT 1
    ) active ON true
    JOIN LATERAL (
      SELECT bd.business_document_id,bd.document_number
      FROM public.business_document bd
      JOIN public.source_document sd
        ON sd.tenant_id=bd.tenant_id AND sd.entity_id=bd.entity_id AND sd.source_document_id=bd.source_document_id
      WHERE bd.tenant_id=b.tenant_id AND bd.entity_id=b.entity_id
        AND bd.document_kind='AP_BILL'
        AND (bd.status IN ('OPEN','PARTIALLY_PAID') OR (active.bank_match_id IS NOT NULL AND bd.source_document_id=active.business_source_document_id AND bd.status='PAID'))
        AND bd.currency=b.currency AND (active.bank_match_id IS NOT NULL OR bd.open_balance>=-b.amount)
        AND bd.accounting_date BETWEEN p.starts_on AND p.ends_on
        AND sd.accounting_date=bd.accounting_date
        AND sd.source_system='WBS' AND sd.source_module='payable'
        AND sd.document_type='WBS_TEST_PAYABLE' AND sd.status='POSTED'
        AND bd.document_number LIKE 'WBS-TEST-%'
        AND (active.bank_match_id IS NULL OR bd.source_document_id=active.business_source_document_id)
      ORDER BY CASE WHEN bd.source_document_id=active.business_source_document_id THEN 0 ELSE 1 END,
        bd.open_balance DESC,bd.business_document_id
      LIMIT 1
    ) bill ON true
  )
  SELECT f.period_id,f.bank_source_id,f.bank_version,f.bank_account_ref,f.transaction_date,f.currency,
    f.payment_amount,f.business_document_id,f.document_number,
    f.active_bank_match_id,f.active_payment_occurrence_id,f.active_journal_entry_id,
    f.active_journal_line_id,f.active_ledger_line_id,f.active_match_revision
  FROM fixture f;
END;
$$;

REVOKE ALL ON FUNCTION refs_resolve_wbs_test_bank_match_fixture(uuid,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION refs_resolve_wbs_test_bank_match_fixture(uuid,uuid) TO refs_app;

COMMIT;
