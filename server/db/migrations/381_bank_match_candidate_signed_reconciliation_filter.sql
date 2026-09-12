BEGIN;

-- Candidate reads must not offer a bank line that the matching commands must
-- reject because it belongs to an already signed-off reconciliation. This
-- keeps the reviewer selection surface consistent with the serialized command.
CREATE OR REPLACE FUNCTION refs_list_bank_match_candidates(
  p_tenant uuid,
  p_entity uuid,
  p_bank_source uuid
)
RETURNS TABLE(
  payment_occurrence_id uuid,
  occurrence_version integer,
  occurrence_kind text,
  business_source_document_id uuid,
  accounting_date text,
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
    SELECT po.payment_occurrence_id,po.version::integer,po.occurrence_kind,po.business_document_id,
      to_char(po.accounting_date,'YYYY-MM-DD'),po.currency,po.amount,je.journal_entry_id,jl.journal_line_id,
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
      AND po.version BETWEEN 0 AND 2147483647
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
        SELECT 1 FROM public.reconciliation signed_statement
        WHERE signed_statement.tenant_id=p_tenant AND signed_statement.entity_id=p_entity
          AND signed_statement.bank_account_ref=bank_row.bank_account_ref
          AND signed_statement.status='RECONCILED' AND signed_statement.statement_ending_date>=bank_row.transaction_date
      )
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

CREATE OR REPLACE FUNCTION refs_read_sales_receipt_bank_candidates(p_tenant uuid,p_entity uuid,p_bank_source uuid,p_after uuid DEFAULT NULL,p_limit integer DEFAULT 50)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE bank_row bank_source;result jsonb;
BEGIN
  PERFORM refs_assert_scope(p_tenant,p_entity,'BANK.MATCH.CREATE');
  IF p_bank_source IS NULL OR p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 100 THEN
    RAISE EXCEPTION 'Cash sale bank candidate selection is invalid' USING ERRCODE='22023';
  END IF;
  SELECT * INTO bank_row FROM bank_source WHERE tenant_id=p_tenant AND entity_id=p_entity AND bank_source_id=p_bank_source;
  IF NOT FOUND THEN RAISE EXCEPTION 'Bank transaction not found in this company' USING ERRCODE='P0002'; END IF;
  IF p_after IS NOT NULL AND NOT EXISTS(SELECT 1 FROM sales_receipt WHERE tenant_id=p_tenant AND entity_id=p_entity AND sales_receipt_id=p_after) THEN
    RAISE EXCEPTION 'Cash sale cursor is outside this company' USING ERRCODE='22023';
  END IF;
  WITH candidates AS MATERIALIZED (
    SELECT s.sales_receipt_id,s.version::text receipt_revision,s.receipt_number,s.period_id,
      s.customer_ref,s.customer_name,s.bank_member_ref,s.cash_account_code,to_char(s.accounting_date,'YYYY-MM-DD') accounting_date,
      s.currency,s.amount::text amount,s.journal_entry_id,j.revision::text journal_revision,
      cash.line_ids[1] journal_line_id,cash.ledger_ids[1] ledger_line_id,(bank_row.transaction_date-s.accounting_date) date_delta_days
    FROM sales_receipt s JOIN journal_entry j ON j.tenant_id=s.tenant_id AND j.entity_id=s.entity_id
      AND j.journal_entry_id=s.journal_entry_id AND j.status='POSTED' AND j.period_id=s.period_id AND j.currency=s.currency AND j.journal_date=s.accounting_date
    CROSS JOIN LATERAL (
      SELECT array_agg(jl.journal_line_id) line_ids,array_agg(ll.ledger_line_id) ledger_ids,count(*) n
      FROM journal_line jl JOIN ledger_line ll ON ll.tenant_id=jl.tenant_id AND ll.entity_id=jl.entity_id
        AND ll.journal_entry_id=jl.journal_entry_id AND ll.journal_line_id=jl.journal_line_id
      WHERE jl.tenant_id=s.tenant_id AND jl.entity_id=s.entity_id AND jl.journal_entry_id=s.journal_entry_id
        AND jl.account_code=s.cash_account_code AND jl.member_ref=s.bank_member_ref AND jl.debit_amount=s.amount AND jl.credit_amount=0
    ) cash
    WHERE s.tenant_id=p_tenant AND s.entity_id=p_entity AND s.status='POSTED' AND cash.n=1
      AND s.bank_member_ref=bank_row.bank_account_ref AND s.currency=bank_row.currency AND s.amount=bank_row.amount
      AND s.accounting_date BETWEEN bank_row.transaction_date-31 AND bank_row.transaction_date+31
      AND (p_after IS NULL OR s.sales_receipt_id>p_after)
      AND NOT EXISTS(SELECT 1 FROM public.reconciliation signed_statement
        WHERE signed_statement.tenant_id=p_tenant AND signed_statement.entity_id=p_entity
          AND signed_statement.bank_account_ref=bank_row.bank_account_ref
          AND signed_statement.status='RECONCILED' AND signed_statement.statement_ending_date>=bank_row.transaction_date)
      AND NOT EXISTS(SELECT 1 FROM bank_match m WHERE m.tenant_id=p_tenant AND m.entity_id=p_entity AND m.status='ACTIVE'
        AND (m.bank_source_id=p_bank_source OR m.sales_receipt_id=s.sales_receipt_id))
    ORDER BY s.sales_receipt_id LIMIT p_limit+1
  ), page AS (SELECT * FROM candidates ORDER BY sales_receipt_id LIMIT p_limit)
  SELECT jsonb_build_object('schema_version','SALES_RECEIPT_BANK_CANDIDATES_V1','entity_id',p_entity,
    'bank_source_id',p_bank_source,'bank_revision',bank_row.version::text,'after_id',p_after,'limit',p_limit,
    'rows',COALESCE((SELECT jsonb_agg(to_jsonb(page) ORDER BY sales_receipt_id) FROM page),'[]'::jsonb),
    'next_id',CASE WHEN (SELECT count(*) FROM candidates)>p_limit THEN (SELECT sales_receipt_id FROM page ORDER BY sales_receipt_id DESC LIMIT 1) ELSE NULL END)
  INTO result;
  RETURN result;
END;
$$;
REVOKE ALL ON FUNCTION refs_read_sales_receipt_bank_candidates(uuid,uuid,uuid,uuid,integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION refs_read_sales_receipt_bank_candidates(uuid,uuid,uuid,uuid,integer) TO refs_app;

COMMIT;
