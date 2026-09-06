BEGIN;
ALTER TABLE bank_match ADD COLUMN sales_receipt_id uuid,
  ADD CONSTRAINT bank_match_sales_receipt_fk FOREIGN KEY(tenant_id,entity_id,sales_receipt_id)
    REFERENCES sales_receipt(tenant_id,entity_id,sales_receipt_id),
  DROP CONSTRAINT bank_match_business_evidence_ck,
  ADD CONSTRAINT bank_match_business_evidence_ck CHECK(business_source_document_id IS NOT NULL OR payment_occurrence_id IS NOT NULL OR sales_receipt_id IS NOT NULL),
  ADD CONSTRAINT bank_match_sales_receipt_trace_ck CHECK(sales_receipt_id IS NULL OR
    (payment_occurrence_id IS NULL AND business_source_document_id IS NULL AND journal_entry_id IS NOT NULL AND journal_line_id IS NOT NULL AND ledger_line_id IS NOT NULL));
CREATE UNIQUE INDEX bank_match_one_active_sales_receipt_uq ON bank_match(tenant_id,entity_id,sales_receipt_id)
  WHERE status='ACTIVE' AND sales_receipt_id IS NOT NULL;
CREATE INDEX sales_receipt_bank_candidate_idx ON sales_receipt(tenant_id,entity_id,bank_member_ref,currency,amount,accounting_date,sales_receipt_id)
  WHERE status='POSTED';

CREATE FUNCTION refs_read_sales_receipt_bank_candidates(p_tenant uuid,p_entity uuid,p_bank_source uuid,p_after uuid DEFAULT NULL,p_limit integer DEFAULT 50)
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
