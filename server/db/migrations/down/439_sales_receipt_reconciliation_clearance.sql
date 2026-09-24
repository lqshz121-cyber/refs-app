BEGIN;

-- Restores the 403 clearance query (EXACT_POSTED_PAYMENT only) in refs_set_reconciliation_clearance_418.
DO $migration$
DECLARE
  definition text;
  old_query constant text:=$old$  SELECT m.bank_match_id INTO active_match FROM bank_match m
  JOIN payment_occurrence po ON po.tenant_id=m.tenant_id AND po.entity_id=m.entity_id
    AND po.payment_occurrence_id=m.payment_occurrence_id
  JOIN journal_entry je ON je.tenant_id=m.tenant_id AND je.entity_id=m.entity_id AND je.journal_entry_id=m.journal_entry_id
  JOIN journal_line jl ON jl.tenant_id=m.tenant_id AND jl.entity_id=m.entity_id
    AND jl.journal_entry_id=m.journal_entry_id AND jl.journal_line_id=m.journal_line_id
  JOIN ledger_line ll ON ll.tenant_id=m.tenant_id AND ll.entity_id=m.entity_id
    AND ll.journal_entry_id=m.journal_entry_id AND ll.journal_line_id=m.journal_line_id AND ll.ledger_line_id=m.ledger_line_id
  WHERE m.tenant_id=p_tenant AND m.entity_id=p_entity AND m.bank_source_id=p_bank_source
    AND m.status='ACTIVE' AND m.candidate_rule_code='EXACT_POSTED_PAYMENT'
    AND m.amount_delta=0 AND m.currency_match AND m.payment_occurrence_id IS NOT NULL
    AND po.status='POSTED' AND po.posted_journal_entry_id=m.journal_entry_id
    AND po.source_document_id IS NOT DISTINCT FROM m.business_source_document_id AND po.currency=bank.currency
    AND NOT EXISTS(SELECT 1 FROM business_adjustment ba WHERE ba.tenant_id=po.tenant_id AND ba.entity_id=po.entity_id
      AND ba.source_occurrence_id=po.payment_occurrence_id
      AND ba.adjustment_kind IN ('AP_PAYMENT_REVERSAL','AR_RECEIPT_REVERSAL') AND ba.status<>'REJECTED')
    AND je.status='POSTED' AND je.currency=bank.currency AND jl.member_ref=bank.bank_account_ref
    AND ((bank.amount<0 AND jl.credit_amount=-bank.amount AND jl.debit_amount=0)
      OR (bank.amount>0 AND jl.debit_amount=bank.amount AND jl.credit_amount=0))
    AND ll.debit_amount=jl.debit_amount AND ll.credit_amount=jl.credit_amount
    AND EXISTS(SELECT 1 FROM source_link sl WHERE sl.tenant_id=m.tenant_id AND sl.entity_id=m.entity_id
      AND sl.link_type='POSTED_PAYMENT_BANK_MATCH' AND sl.bank_source_id=m.bank_source_id AND sl.bank_match_id=m.bank_match_id
      AND sl.source_document_id IS NOT DISTINCT FROM po.source_document_id AND sl.journal_entry_id=m.journal_entry_id
      AND sl.journal_line_id=m.journal_line_id AND sl.ledger_line_id=m.ledger_line_id)
  FOR SHARE OF m;$old$;
  new_query constant text:=$new$  SELECT m.bank_match_id INTO active_match FROM bank_match m
  LEFT JOIN payment_occurrence po ON po.tenant_id=m.tenant_id AND po.entity_id=m.entity_id
    AND po.payment_occurrence_id=m.payment_occurrence_id
  LEFT JOIN sales_receipt s ON s.tenant_id=m.tenant_id AND s.entity_id=m.entity_id
    AND s.sales_receipt_id=m.sales_receipt_id
  JOIN journal_entry je ON je.tenant_id=m.tenant_id AND je.entity_id=m.entity_id AND je.journal_entry_id=m.journal_entry_id
  JOIN journal_line jl ON jl.tenant_id=m.tenant_id AND jl.entity_id=m.entity_id
    AND jl.journal_entry_id=m.journal_entry_id AND jl.journal_line_id=m.journal_line_id
  JOIN ledger_line ll ON ll.tenant_id=m.tenant_id AND ll.entity_id=m.entity_id
    AND ll.journal_entry_id=m.journal_entry_id AND ll.journal_line_id=m.journal_line_id AND ll.ledger_line_id=m.ledger_line_id
  WHERE m.tenant_id=p_tenant AND m.entity_id=p_entity AND m.bank_source_id=p_bank_source
    AND m.status='ACTIVE' AND m.amount_delta=0 AND m.currency_match
    AND je.status='POSTED' AND je.currency=bank.currency AND jl.member_ref=bank.bank_account_ref
    AND ((bank.amount<0 AND jl.credit_amount=-bank.amount AND jl.debit_amount=0)
      OR (bank.amount>0 AND jl.debit_amount=bank.amount AND jl.credit_amount=0))
    AND ll.debit_amount=jl.debit_amount AND ll.credit_amount=jl.credit_amount
    AND ((m.candidate_rule_code='EXACT_POSTED_PAYMENT' AND m.payment_occurrence_id IS NOT NULL
      AND m.sales_receipt_id IS NULL AND po.payment_occurrence_id IS NOT NULL AND po.status='POSTED'
      AND po.posted_journal_entry_id=m.journal_entry_id
      AND po.source_document_id IS NOT DISTINCT FROM m.business_source_document_id AND po.currency=bank.currency
      AND NOT EXISTS(SELECT 1 FROM business_adjustment ba WHERE ba.tenant_id=po.tenant_id AND ba.entity_id=po.entity_id
        AND ba.source_occurrence_id=po.payment_occurrence_id
        AND ba.adjustment_kind IN ('AP_PAYMENT_REVERSAL','AR_RECEIPT_REVERSAL') AND ba.status<>'REJECTED')
      AND EXISTS(SELECT 1 FROM source_link sl WHERE sl.tenant_id=m.tenant_id AND sl.entity_id=m.entity_id
        AND sl.link_type='POSTED_PAYMENT_BANK_MATCH' AND sl.bank_source_id=m.bank_source_id AND sl.bank_match_id=m.bank_match_id
        AND sl.source_document_id IS NOT DISTINCT FROM po.source_document_id AND sl.journal_entry_id=m.journal_entry_id
        AND sl.journal_line_id=m.journal_line_id AND sl.ledger_line_id=m.ledger_line_id))
      OR (m.candidate_rule_code='EXACT_POSTED_SALES_RECEIPT' AND m.sales_receipt_id IS NOT NULL
        AND m.payment_occurrence_id IS NULL AND m.business_source_document_id IS NULL
        AND s.sales_receipt_id IS NOT NULL AND s.status='POSTED' AND s.journal_entry_id=m.journal_entry_id
        AND s.currency=bank.currency AND s.bank_member_ref=bank.bank_account_ref AND s.cash_account_code=jl.account_code
        AND s.amount=abs(bank.amount)
        AND EXISTS(SELECT 1 FROM source_link sl WHERE sl.tenant_id=m.tenant_id AND sl.entity_id=m.entity_id
          AND sl.link_type='POSTED_SALES_RECEIPT_BANK_MATCH' AND sl.bank_source_id=m.bank_source_id AND sl.bank_match_id=m.bank_match_id
          AND sl.source_document_id IS NULL AND sl.journal_entry_id=m.journal_entry_id
          AND sl.journal_line_id=m.journal_line_id AND sl.ledger_line_id=m.ledger_line_id)))
  FOR SHARE OF m;$new$;
BEGIN
  SELECT pg_get_functiondef('public.refs_set_reconciliation_clearance_418(uuid,uuid,uuid,uuid,bigint,bigint,boolean,text,text,text)'::regprocedure) INTO definition;
  IF position(new_query IN definition)=0 THEN
    RAISE EXCEPTION 'Migration 439 down requires the 439 clearance query' USING ERRCODE='55000';
  END IF;
  EXECUTE replace(definition,new_query,old_query);
END
$migration$;

COMMIT;
