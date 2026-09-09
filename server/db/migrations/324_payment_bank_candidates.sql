BEGIN;
CREATE INDEX payment_occurrence_bank_candidate_idx ON payment_occurrence(tenant_id,entity_id,currency,amount,payment_occurrence_id)
  INCLUDE(accounting_date,occurrence_kind) WHERE status='POSTED';
CREATE FUNCTION refs_read_payment_bank_candidates(p_tenant uuid,p_entity uuid,p_bank_source uuid,p_after uuid DEFAULT NULL,p_limit integer DEFAULT 50)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE bank_row bank_source;result jsonb;
BEGIN
  PERFORM refs_assert_scope(p_tenant,p_entity,'BANK.MATCH.CREATE');
  IF p_bank_source IS NULL OR p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 100 THEN
    RAISE EXCEPTION 'Payment bank candidate selection is invalid' USING ERRCODE='22023';
  END IF;
  SELECT * INTO bank_row FROM bank_source WHERE tenant_id=p_tenant AND entity_id=p_entity AND bank_source_id=p_bank_source;
  IF NOT FOUND THEN RAISE EXCEPTION 'Bank transaction not found in this company' USING ERRCODE='P0002'; END IF;
  IF p_after IS NOT NULL AND NOT EXISTS(SELECT 1 FROM payment_occurrence WHERE tenant_id=p_tenant AND entity_id=p_entity AND payment_occurrence_id=p_after) THEN
    RAISE EXCEPTION 'Payment cursor is outside this company' USING ERRCODE='22023';
  END IF;
  WITH candidates AS MATERIALIZED (
    SELECT po.payment_occurrence_id,po.version::text occurrence_revision,po.occurrence_kind,po.business_document_id,
      po.source_document_id,bd.document_number,bd.counterparty_ref,bd.counterparty_name,po.period_id,
      to_char(po.accounting_date,'YYYY-MM-DD') accounting_date,po.currency,po.amount::text amount,
      bank_row.bank_account_ref bank_member_ref,je.journal_entry_id,je.journal_number,je.revision::text journal_revision,
      jl.journal_line_id,jl.account_code cash_account_code,ll.ledger_line_id,(bank_row.transaction_date-po.accounting_date) date_delta_days
    FROM public.payment_occurrence po
    JOIN public.business_document bd ON bd.tenant_id=po.tenant_id AND bd.entity_id=po.entity_id AND bd.business_document_id=po.business_document_id
    JOIN public.journal_entry je
      ON je.tenant_id=po.tenant_id AND je.entity_id=po.entity_id
        AND je.journal_entry_id=po.posted_journal_entry_id AND je.status='POSTED'
        AND je.period_id=po.period_id AND je.currency=po.currency AND je.journal_date=po.accounting_date
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
      AND po.currency=bank_row.currency AND po.amount=abs(bank_row.amount)
      AND ((po.occurrence_kind='AP_PAYMENT' AND bank_row.amount=-po.amount)
        OR (po.occurrence_kind='AR_RECEIPT' AND bank_row.amount=po.amount))
      AND po.accounting_date BETWEEN bank_row.transaction_date-31 AND bank_row.transaction_date+31
      AND (p_after IS NULL OR po.payment_occurrence_id>p_after)
      AND NOT EXISTS(SELECT 1 FROM public.reconciliation signed_statement
        WHERE signed_statement.tenant_id=p_tenant AND signed_statement.entity_id=p_entity
          AND signed_statement.bank_account_ref=bank_row.bank_account_ref
          AND signed_statement.status='RECONCILED' AND signed_statement.statement_ending_date>=bank_row.transaction_date)
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
    ORDER BY po.payment_occurrence_id LIMIT p_limit+1
  ), page AS (SELECT * FROM candidates ORDER BY payment_occurrence_id LIMIT p_limit)
  SELECT jsonb_build_object('schema_version','PAYMENT_BANK_CANDIDATES_V1','entity_id',p_entity,
    'bank_source_id',p_bank_source,'bank_revision',bank_row.version::text,'after_id',p_after,'limit',p_limit,
    'rows',COALESCE((SELECT jsonb_agg(to_jsonb(page) ORDER BY payment_occurrence_id) FROM page),'[]'::jsonb),
    'next_id',CASE WHEN (SELECT count(*) FROM candidates)>p_limit THEN (SELECT payment_occurrence_id FROM page ORDER BY payment_occurrence_id DESC LIMIT 1) ELSE NULL END)
  INTO result;
  RETURN result;
END;
$$;
REVOKE ALL ON FUNCTION refs_read_payment_bank_candidates(uuid,uuid,uuid,uuid,integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION refs_read_payment_bank_candidates(uuid,uuid,uuid,uuid,integer) TO refs_app;
COMMIT;
