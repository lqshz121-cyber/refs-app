BEGIN;

-- A controller must never supply an opaque payment occurrence identifier to
-- manufacture a Bank Match.  This read surface returns only already-POSTED
-- cash occurrences that satisfy every immutable predicate enforced again by
-- refs_create_bank_payment_match.  It is deliberately protected by the
-- high-risk BANK.MATCH.CREATE permission rather than BANK.VIEW.
CREATE FUNCTION refs_list_bank_match_candidates(
  p_tenant uuid,
  p_entity uuid,
  p_bank_source uuid
)
RETURNS TABLE(
  payment_occurrence_id uuid,
  occurrence_version bigint,
  occurrence_kind text,
  business_source_document_id uuid,
  accounting_date date,
  currency char(3),
  amount numeric(20,4),
  journal_entry_id uuid,
  journal_line_id uuid,
  ledger_line_id uuid,
  date_delta_days integer
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE bank_row bank_source;
BEGIN
  PERFORM public.refs_assert_scope(p_tenant,p_entity,'BANK.MATCH.CREATE');

  SELECT * INTO bank_row
  FROM public.bank_source
  WHERE tenant_id=p_tenant AND entity_id=p_entity AND bank_source_id=p_bank_source
  FOR SHARE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Bank transaction was not found in the selected entity' USING ERRCODE='P0002';
  END IF;

  RETURN QUERY
    SELECT po.payment_occurrence_id,po.version,po.occurrence_kind,po.source_document_id,
      po.accounting_date,po.currency,po.amount,je.journal_entry_id,jl.journal_line_id,
      ll.ledger_line_id,(bank_row.transaction_date-po.accounting_date)
    FROM public.payment_occurrence po
    JOIN public.journal_entry je
      ON je.tenant_id=po.tenant_id AND je.entity_id=po.entity_id
        AND je.journal_entry_id=po.posted_journal_entry_id AND je.status='POSTED'
    JOIN public.journal_line jl
      ON jl.tenant_id=je.tenant_id AND jl.entity_id=je.entity_id AND jl.journal_entry_id=je.journal_entry_id
        AND jl.member_ref=bank_row.bank_account_ref
        AND ((po.occurrence_kind='AP_PAYMENT' AND jl.credit_amount=po.amount AND jl.debit_amount=0)
          OR (po.occurrence_kind='AR_RECEIPT' AND jl.debit_amount=po.amount AND jl.credit_amount=0))
    JOIN public.ledger_line ll
      ON ll.tenant_id=jl.tenant_id AND ll.entity_id=jl.entity_id
        AND ll.journal_entry_id=jl.journal_entry_id AND ll.journal_line_id=jl.journal_line_id
    WHERE po.tenant_id=p_tenant AND po.entity_id=p_entity AND po.status='POSTED'
      AND po.posted_journal_entry_id IS NOT NULL
      AND po.currency=bank_row.currency
      AND ((po.occurrence_kind='AP_PAYMENT' AND bank_row.amount=-po.amount)
        OR (po.occurrence_kind='AR_RECEIPT' AND bank_row.amount=po.amount))
      AND abs(bank_row.transaction_date-po.accounting_date)<=31
      AND 1=(SELECT count(*)
        FROM public.journal_line one_line
        JOIN public.ledger_line one_ledger
          ON one_ledger.tenant_id=one_line.tenant_id AND one_ledger.entity_id=one_line.entity_id
            AND one_ledger.journal_entry_id=one_line.journal_entry_id AND one_ledger.journal_line_id=one_line.journal_line_id
        WHERE one_line.tenant_id=po.tenant_id AND one_line.entity_id=po.entity_id
          AND one_line.journal_entry_id=po.posted_journal_entry_id AND one_line.member_ref=bank_row.bank_account_ref
          AND ((po.occurrence_kind='AP_PAYMENT' AND one_line.credit_amount=po.amount AND one_line.debit_amount=0)
            OR (po.occurrence_kind='AR_RECEIPT' AND one_line.debit_amount=po.amount AND one_line.credit_amount=0)))
      AND NOT EXISTS(
        SELECT 1 FROM public.bank_match active_match
        WHERE active_match.tenant_id=po.tenant_id AND active_match.entity_id=po.entity_id
          AND (active_match.bank_source_id=bank_row.bank_source_id OR active_match.payment_occurrence_id=po.payment_occurrence_id)
          AND active_match.status='ACTIVE'
      )
      AND NOT EXISTS(
        SELECT 1 FROM public.business_adjustment reversal
        WHERE reversal.tenant_id=po.tenant_id AND reversal.entity_id=po.entity_id
          AND reversal.source_occurrence_id=po.payment_occurrence_id
          AND reversal.adjustment_kind IN ('AP_PAYMENT_REVERSAL','AR_RECEIPT_REVERSAL')
          AND reversal.status<>'REJECTED'
      )
    ORDER BY po.accounting_date ASC,po.payment_occurrence_id ASC;
END;
$$;

REVOKE ALL ON FUNCTION refs_list_bank_match_candidates(uuid,uuid,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION refs_list_bank_match_candidates(uuid,uuid,uuid) TO refs_app;

COMMIT;
