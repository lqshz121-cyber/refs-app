BEGIN;

-- Sales receipts have their own posted cash evidence and never a payment occurrence.
-- Keep the actor-bound public wrappers introduced by 385; only replace their private executors.

CREATE OR REPLACE FUNCTION refs_set_reconciliation_clearance_385(
  p_tenant uuid,p_entity uuid,p_reconciliation uuid,p_bank_source uuid,p_expected_reconciliation_version bigint,
  p_expected_bank_version bigint,p_clear boolean,p_reason text,p_idempotency_key text,p_request_hash text
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE actor text:=refs_current_actor(); receipt idempotency_receipt; rec reconciliation; bank bank_source; prior_date date;
DECLARE active_match uuid; item reconciliation_item; cleared_activity numeric(20,4); book_balance numeric(20,4); response jsonb; event_payload jsonb;
BEGIN
  PERFORM refs_assert_scope(p_tenant,p_entity,'BANK.RECONCILIATION.CLEAR');
  IF actor IS NULL THEN RAISE EXCEPTION 'Authenticated actor missing' USING ERRCODE='42501'; END IF;
  IF p_request_hash<>refs_reconciliation_clearance_hash(p_tenant,p_entity,p_reconciliation,p_bank_source,p_expected_reconciliation_version,p_expected_bank_version,p_clear,p_reason) THEN
    RAISE EXCEPTION 'Reconciliation clearance request hash is not canonical' USING ERRCODE='22023';
  END IF;
  IF p_expected_reconciliation_version IS NULL OR p_expected_reconciliation_version<0 OR p_expected_bank_version IS NULL OR p_expected_bank_version<0
     OR p_clear IS NULL OR COALESCE(length(btrim(p_reason)),0) NOT BETWEEN 8 AND 2000 THEN
    RAISE EXCEPTION 'Clearance requires revisions, an explicit state and review reason' USING ERRCODE='22023';
  END IF;
  INSERT INTO idempotency_receipt(tenant_id,operation_scope,idempotency_key,request_hash,status,actor_id)
    VALUES(p_tenant,'RECONCILIATION_CLEARANCE:'||p_entity,p_idempotency_key,p_request_hash,'IN_PROGRESS',actor)
  ON CONFLICT (tenant_id,operation_scope,idempotency_key) DO NOTHING;
  SELECT * INTO receipt FROM idempotency_receipt
    WHERE tenant_id=p_tenant AND operation_scope='RECONCILIATION_CLEARANCE:'||p_entity AND idempotency_key=p_idempotency_key FOR UPDATE;
  IF receipt.request_hash<>p_request_hash THEN RAISE EXCEPTION 'Idempotency key reused with a different request' USING ERRCODE='23505'; END IF;
  IF receipt.status='SUCCEEDED' THEN RETURN receipt.response_body||jsonb_build_object('idempotent',true); END IF;
  SELECT * INTO rec FROM reconciliation WHERE tenant_id=p_tenant AND entity_id=p_entity AND reconciliation_id=p_reconciliation FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Reconciliation was not found in the selected entity' USING ERRCODE='P0002'; END IF;
  IF rec.version<>p_expected_reconciliation_version THEN RAISE EXCEPTION 'Reconciliation version conflict' USING ERRCODE='40001'; END IF;
  IF rec.status NOT IN ('DRAFT','IN_REVIEW','REOPENED') THEN RAISE EXCEPTION 'Signed-off reconciliation items are immutable' USING ERRCODE='23514'; END IF;
  SELECT * INTO bank FROM bank_source WHERE tenant_id=p_tenant AND entity_id=p_entity AND bank_source_id=p_bank_source FOR UPDATE;
  IF NOT FOUND OR bank.bank_account_ref<>rec.bank_account_ref OR bank.transaction_date>rec.statement_ending_date THEN
    RAISE EXCEPTION 'Bank transaction is outside the reconciliation statement scope' USING ERRCODE='23514';
  END IF;
  IF bank.version<>p_expected_bank_version THEN RAISE EXCEPTION 'Bank transaction version conflict' USING ERRCODE='40001'; END IF;
  SELECT max(statement_ending_date) INTO prior_date FROM reconciliation
    WHERE tenant_id=p_tenant AND entity_id=p_entity AND bank_account_ref=rec.bank_account_ref
      AND status='RECONCILED' AND statement_ending_date<rec.statement_ending_date;
  IF prior_date IS NOT NULL AND bank.transaction_date<=prior_date THEN RAISE EXCEPTION 'Bank transaction belongs to a prior signed-off statement' USING ERRCODE='23514'; END IF;
  IF bank.currency<>rec.currency THEN RAISE EXCEPTION 'Bank transaction currency is outside the reconciliation scope' USING ERRCODE='23514'; END IF;
  SELECT m.bank_match_id INTO active_match FROM bank_match m
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
  FOR SHARE;
  IF p_clear AND active_match IS NULL THEN RAISE EXCEPTION 'Only exact actively matched bank evidence can be cleared' USING ERRCODE='23514'; END IF;
  IF p_clear THEN
    INSERT INTO reconciliation_item(tenant_id,entity_id,reconciliation_id,bank_source_id,bank_match_id,state,cleared_by,reason)
    VALUES(p_tenant,p_entity,p_reconciliation,p_bank_source,active_match,'CLEARED',actor,btrim(p_reason))
    ON CONFLICT (tenant_id,entity_id,reconciliation_id,bank_source_id) DO UPDATE
      SET bank_match_id=EXCLUDED.bank_match_id,state='CLEARED',cleared_by=actor,cleared_at=clock_timestamp(),
          uncleared_by=NULL,uncleared_at=NULL,reason=btrim(p_reason),version=reconciliation_item.version+1
    RETURNING * INTO item;
  ELSE
    UPDATE reconciliation_item SET state='UNCLEARED',uncleared_by=actor,uncleared_at=clock_timestamp(),reason=btrim(p_reason),version=version+1
    WHERE tenant_id=p_tenant AND entity_id=p_entity AND reconciliation_id=p_reconciliation AND bank_source_id=p_bank_source AND state='CLEARED'
    RETURNING * INTO item;
    IF NOT FOUND THEN RAISE EXCEPTION 'Only a cleared statement item can be uncleared' USING ERRCODE='23514'; END IF;
  END IF;
  SELECT COALESCE(sum(b.amount),0)::numeric(20,4) INTO cleared_activity
  FROM reconciliation_item i JOIN bank_source b
    ON b.tenant_id=i.tenant_id AND b.entity_id=i.entity_id AND b.bank_source_id=i.bank_source_id
  WHERE i.tenant_id=p_tenant AND i.entity_id=p_entity AND i.reconciliation_id=p_reconciliation AND i.state='CLEARED';
  SELECT COALESCE(sum(ll.debit_amount-ll.credit_amount),0)::numeric(20,4) INTO book_balance
  FROM ledger_line ll JOIN journal_line jl
    ON jl.tenant_id=ll.tenant_id AND jl.entity_id=ll.entity_id
      AND jl.journal_entry_id=ll.journal_entry_id AND jl.journal_line_id=ll.journal_line_id
  JOIN journal_entry je ON je.tenant_id=ll.tenant_id AND je.entity_id=ll.entity_id AND je.journal_entry_id=ll.journal_entry_id
  WHERE ll.tenant_id=p_tenant AND ll.entity_id=p_entity AND jl.member_ref=rec.bank_account_ref
    AND je.status='POSTED' AND je.currency=rec.currency AND je.journal_date<=rec.statement_ending_date;
  UPDATE reconciliation SET book_ending_balance=book_balance,difference=statement_ending_balance-book_balance,version=version+1
    WHERE tenant_id=p_tenant AND entity_id=p_entity AND reconciliation_id=p_reconciliation RETURNING * INTO rec;
  response:=jsonb_build_object('reconciliation_id',p_reconciliation,'bank_source_id',p_bank_source,
    'state',item.state,'item_revision',item.version,'difference',rec.difference,'status',rec.status,'revision',rec.version,'idempotent',false);
  INSERT INTO audit_event(tenant_id,entity_id,event_type,object_type,object_id,action,actor_id,actor_type,permission_used,
    request_id,correlation_id,idempotency_key,after_hash,reason)
  VALUES(p_tenant,p_entity,CASE WHEN p_clear THEN 'RECONCILIATION_ITEM_CLEARED' ELSE 'RECONCILIATION_ITEM_UNCLEARED' END,
    'RECONCILIATION',p_reconciliation,CASE WHEN p_clear THEN 'CLEAR_BANK_ITEM' ELSE 'UNCLEAR_BANK_ITEM' END,actor,'USER',
    'BANK.RECONCILIATION.CLEAR',p_idempotency_key,p_idempotency_key,p_idempotency_key,refs_jsonb_hash(response),btrim(p_reason));
  event_payload:=response-'idempotent';
  INSERT INTO outbox_event(tenant_id,entity_id,aggregate_type,aggregate_id,event_type,payload,payload_hash)
  VALUES(p_tenant,p_entity,'RECONCILIATION',p_reconciliation,
    CASE WHEN p_clear THEN 'RECONCILIATION_ITEM_CLEARED' ELSE 'RECONCILIATION_ITEM_UNCLEARED' END,event_payload,refs_jsonb_hash(event_payload));
  UPDATE idempotency_receipt SET status='SUCCEEDED',response_status=201,response_body=response,completed_at=clock_timestamp()
    WHERE tenant_id=p_tenant AND operation_scope='RECONCILIATION_CLEARANCE:'||p_entity AND idempotency_key=p_idempotency_key;
  RETURN response;
END;
$$;

CREATE OR REPLACE FUNCTION refs_transition_reconciliation_adjustment_aware_385(
  p_tenant uuid,p_entity uuid,p_reconciliation uuid,p_action text,p_expected_version bigint,p_reason text,
  p_idempotency_key text,p_request_hash text
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE actor text:=refs_current_actor(); receipt idempotency_receipt; rec reconciliation; action text:=upper(p_action);
DECLARE total_items bigint; cleared_items bigint; scoped_bank_items bigint; invalid_evidence bigint; foreign_currency_items bigint;
DECLARE prior_date date; snapshot jsonb; snapshot_hash text; snapshot_id uuid; response jsonb; event_payload jsonb;
DECLARE latest_snapshot_reconciliation_id uuid; cleared_activity numeric(20,4); book_balance numeric(20,4);
BEGIN
  IF action='REVIEW' THEN PERFORM refs_assert_scope(p_tenant,p_entity,'BANK.RECONCILIATION.REVIEW');
  ELSIF action='SIGN_OFF' THEN PERFORM refs_assert_scope(p_tenant,p_entity,'BANK.RECONCILIATION.SIGN_OFF');
  ELSIF action='REOPEN' THEN PERFORM refs_assert_scope(p_tenant,p_entity,'BANK.RECONCILIATION.REOPEN');
  ELSE RAISE EXCEPTION 'Unsupported reconciliation transition' USING ERRCODE='22023'; END IF;
  IF actor IS NULL THEN RAISE EXCEPTION 'Authenticated actor missing' USING ERRCODE='42501'; END IF;
  IF p_request_hash<>refs_reconciliation_transition_hash(p_tenant,p_entity,p_reconciliation,action,p_expected_version,p_reason) THEN
    RAISE EXCEPTION 'Reconciliation transition request hash is not canonical' USING ERRCODE='22023';
  END IF;
  IF p_expected_version IS NULL OR p_expected_version<0 OR COALESCE(length(btrim(p_reason)),0) NOT BETWEEN 8 AND 2000 THEN
    RAISE EXCEPTION 'Reconciliation transition requires a revision and review reason' USING ERRCODE='22023';
  END IF;
  INSERT INTO idempotency_receipt(tenant_id,operation_scope,idempotency_key,request_hash,status,actor_id)
    VALUES(p_tenant,'RECONCILIATION_'||action||':'||p_entity,p_idempotency_key,p_request_hash,'IN_PROGRESS',actor)
  ON CONFLICT (tenant_id,operation_scope,idempotency_key) DO NOTHING;
  SELECT * INTO receipt FROM idempotency_receipt WHERE tenant_id=p_tenant
    AND operation_scope='RECONCILIATION_'||action||':'||p_entity AND idempotency_key=p_idempotency_key FOR UPDATE;
  IF receipt.request_hash<>p_request_hash THEN RAISE EXCEPTION 'Idempotency key reused with a different request' USING ERRCODE='23505'; END IF;
  IF receipt.status='SUCCEEDED' THEN RETURN receipt.response_body||jsonb_build_object('idempotent',true); END IF;
  SELECT * INTO rec FROM reconciliation WHERE tenant_id=p_tenant AND entity_id=p_entity AND reconciliation_id=p_reconciliation FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Reconciliation was not found in the selected entity' USING ERRCODE='P0002'; END IF;
  IF rec.version<>p_expected_version THEN RAISE EXCEPTION 'Reconciliation version conflict' USING ERRCODE='40001'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(p_tenant::text||':'||p_entity::text||':'||rec.bank_account_ref,0));
  SELECT count(*),count(*) FILTER (WHERE i.state='CLEARED'),count(*) FILTER (WHERE i.state='CLEARED' AND NOT (
      (
        m.bank_match_id IS NOT NULL AND m.status='ACTIVE' AND m.candidate_rule_code='EXACT_POSTED_PAYMENT'
        AND m.amount_delta=0 AND m.currency_match AND m.payment_occurrence_id IS NOT NULL
        AND po.payment_occurrence_id IS NOT NULL AND po.status='POSTED' AND po.posted_journal_entry_id=m.journal_entry_id
        AND po.source_document_id IS NOT DISTINCT FROM m.business_source_document_id AND po.currency=b.currency
        AND NOT EXISTS(SELECT 1 FROM business_adjustment ba WHERE ba.tenant_id=po.tenant_id AND ba.entity_id=po.entity_id
          AND ba.source_occurrence_id=po.payment_occurrence_id AND ba.adjustment_kind IN ('AP_PAYMENT_REVERSAL','AR_RECEIPT_REVERSAL')
          AND ba.status<>'REJECTED')
        AND payment_je.status='POSTED' AND payment_je.currency=b.currency AND payment_line.member_ref=b.bank_account_ref
        AND ((b.amount<0 AND payment_line.credit_amount=-b.amount AND payment_line.debit_amount=0)
          OR (b.amount>0 AND payment_line.debit_amount=b.amount AND payment_line.credit_amount=0))
        AND payment_ledger.ledger_line_id IS NOT NULL AND payment_ledger.debit_amount=payment_line.debit_amount
        AND payment_ledger.credit_amount=payment_line.credit_amount
        AND EXISTS(SELECT 1 FROM source_link sl WHERE sl.tenant_id=m.tenant_id AND sl.entity_id=m.entity_id
          AND sl.link_type='POSTED_PAYMENT_BANK_MATCH' AND sl.bank_source_id=m.bank_source_id AND sl.bank_match_id=m.bank_match_id
          AND sl.source_document_id IS NOT DISTINCT FROM po.source_document_id AND sl.journal_entry_id=m.journal_entry_id
          AND sl.journal_line_id=m.journal_line_id AND sl.ledger_line_id=m.ledger_line_id)
      ) OR (
        m.bank_match_id IS NOT NULL AND m.status='ACTIVE' AND m.candidate_rule_code='EXACT_POSTED_SALES_RECEIPT'
        AND m.amount_delta=0 AND m.currency_match AND m.sales_receipt_id IS NOT NULL
        AND m.payment_occurrence_id IS NULL AND m.business_source_document_id IS NULL
        AND s.sales_receipt_id IS NOT NULL AND s.status='POSTED' AND s.journal_entry_id=m.journal_entry_id
        AND s.currency=b.currency AND s.bank_member_ref=b.bank_account_ref AND s.cash_account_code=payment_line.account_code
        AND s.amount=abs(b.amount) AND payment_je.status='POSTED' AND payment_je.currency=b.currency
        AND payment_line.member_ref=b.bank_account_ref
        AND ((b.amount<0 AND payment_line.credit_amount=-b.amount AND payment_line.debit_amount=0)
          OR (b.amount>0 AND payment_line.debit_amount=b.amount AND payment_line.credit_amount=0))
        AND payment_ledger.ledger_line_id IS NOT NULL AND payment_ledger.debit_amount=payment_line.debit_amount
        AND payment_ledger.credit_amount=payment_line.credit_amount
        AND EXISTS(SELECT 1 FROM source_link sl WHERE sl.tenant_id=m.tenant_id AND sl.entity_id=m.entity_id
          AND sl.link_type='POSTED_SALES_RECEIPT_BANK_MATCH' AND sl.bank_source_id=m.bank_source_id AND sl.bank_match_id=m.bank_match_id
          AND sl.source_document_id IS NULL AND sl.journal_entry_id=m.journal_entry_id
          AND sl.journal_line_id=m.journal_line_id AND sl.ledger_line_id=m.ledger_line_id)
      ) OR (
        i.bank_match_id IS NULL AND EXISTS(
          SELECT 1 FROM reconciliation_adjustment_draft draft
          JOIN journal_entry adjustment_je ON adjustment_je.tenant_id=draft.tenant_id AND adjustment_je.entity_id=draft.entity_id
            AND adjustment_je.journal_entry_id=draft.journal_entry_id AND adjustment_je.status='POSTED' AND adjustment_je.currency=b.currency
          WHERE draft.tenant_id=i.tenant_id AND draft.entity_id=i.entity_id AND draft.reconciliation_id=i.reconciliation_id
            AND draft.bank_source_id=i.bank_source_id AND draft.bank_delta=b.amount
            AND 1=(SELECT count(*) FROM journal_line adjustment_line WHERE adjustment_line.tenant_id=draft.tenant_id
              AND adjustment_line.entity_id=draft.entity_id AND adjustment_line.journal_entry_id=draft.journal_entry_id
              AND adjustment_line.member_ref=b.bank_account_ref)
            AND b.amount=(SELECT COALESCE(sum(adjustment_line.debit_amount-adjustment_line.credit_amount),0)
              FROM journal_line adjustment_line WHERE adjustment_line.tenant_id=draft.tenant_id AND adjustment_line.entity_id=draft.entity_id
                AND adjustment_line.journal_entry_id=draft.journal_entry_id AND adjustment_line.member_ref=b.bank_account_ref)
            AND EXISTS(SELECT 1 FROM journal_line adjustment_line JOIN ledger_line adjustment_ledger
              ON adjustment_ledger.tenant_id=adjustment_line.tenant_id AND adjustment_ledger.entity_id=adjustment_line.entity_id
                AND adjustment_ledger.journal_entry_id=adjustment_line.journal_entry_id AND adjustment_ledger.journal_line_id=adjustment_line.journal_line_id
              WHERE adjustment_line.tenant_id=draft.tenant_id AND adjustment_line.entity_id=draft.entity_id
                AND adjustment_line.journal_entry_id=draft.journal_entry_id AND adjustment_line.member_ref=b.bank_account_ref
                AND adjustment_ledger.debit_amount=adjustment_line.debit_amount AND adjustment_ledger.credit_amount=adjustment_line.credit_amount)
            AND EXISTS(SELECT 1 FROM source_link sl WHERE sl.tenant_id=draft.tenant_id AND sl.entity_id=draft.entity_id
              AND sl.link_type='RECONCILIATION_ADJUSTMENT_DRAFT' AND sl.reconciliation_id=i.reconciliation_id
              AND sl.bank_source_id=i.bank_source_id AND sl.journal_entry_id=draft.journal_entry_id)
            AND EXISTS(SELECT 1 FROM source_link att_link JOIN attachment att ON att.tenant_id=att_link.tenant_id
              AND att.attachment_id=att_link.attachment_id WHERE att_link.tenant_id=draft.tenant_id AND att_link.entity_id=draft.entity_id
                AND att_link.journal_entry_id=draft.journal_entry_id AND att_link.link_type='JE_ATTACHMENT'
                AND att.finalization_status='VERIFIED_CLEAN' AND att.scan_status='CLEAN' AND att.verified_at IS NOT NULL AND att.finalized_at IS NOT NULL)
        )
      )
    )) INTO total_items,cleared_items,invalid_evidence
  FROM reconciliation_item i JOIN bank_source b
    ON b.tenant_id=i.tenant_id AND b.entity_id=i.entity_id AND b.bank_source_id=i.bank_source_id
  LEFT JOIN bank_match m ON m.tenant_id=i.tenant_id AND m.entity_id=i.entity_id AND m.bank_match_id=i.bank_match_id
  LEFT JOIN payment_occurrence po ON po.tenant_id=m.tenant_id AND po.entity_id=m.entity_id
    AND po.payment_occurrence_id=m.payment_occurrence_id
  LEFT JOIN sales_receipt s ON s.tenant_id=m.tenant_id AND s.entity_id=m.entity_id AND s.sales_receipt_id=m.sales_receipt_id
  LEFT JOIN journal_entry payment_je ON payment_je.tenant_id=m.tenant_id AND payment_je.entity_id=m.entity_id AND payment_je.journal_entry_id=m.journal_entry_id
  LEFT JOIN journal_line payment_line ON payment_line.tenant_id=m.tenant_id AND payment_line.entity_id=m.entity_id
    AND payment_line.journal_entry_id=m.journal_entry_id AND payment_line.journal_line_id=m.journal_line_id
  LEFT JOIN ledger_line payment_ledger ON payment_ledger.tenant_id=m.tenant_id AND payment_ledger.entity_id=m.entity_id
    AND payment_ledger.journal_entry_id=m.journal_entry_id AND payment_ledger.journal_line_id=m.journal_line_id AND payment_ledger.ledger_line_id=m.ledger_line_id
  WHERE i.tenant_id=p_tenant AND i.entity_id=p_entity AND i.reconciliation_id=p_reconciliation;
  SELECT max(statement_ending_date) INTO prior_date FROM reconciliation
    WHERE tenant_id=p_tenant AND entity_id=p_entity AND bank_account_ref=rec.bank_account_ref
      AND status='RECONCILED' AND statement_ending_date<rec.statement_ending_date;
  SELECT count(*),count(*) FILTER (WHERE b.currency<>rec.currency) INTO scoped_bank_items,foreign_currency_items
  FROM bank_source b
  WHERE b.tenant_id=p_tenant AND b.entity_id=p_entity AND b.bank_account_ref=rec.bank_account_ref
    AND (
      (rec.wbs_bank_statement_receipt_id IS NULL AND b.transaction_date<=rec.statement_ending_date
        AND (prior_date IS NULL OR b.transaction_date>prior_date))
      OR EXISTS(
        SELECT 1 FROM wbs_bank_statement_transaction t
        WHERE rec.wbs_bank_statement_receipt_id IS NOT NULL
          AND t.tenant_id=b.tenant_id AND t.entity_id=b.entity_id
          AND t.wbs_bank_statement_receipt_id=rec.wbs_bank_statement_receipt_id
          AND t.bank_source_id=b.bank_source_id
      )
    );
  SELECT COALESCE(sum(b.amount),0)::numeric(20,4) INTO cleared_activity FROM reconciliation_item i JOIN bank_source b
    ON b.tenant_id=i.tenant_id AND b.entity_id=i.entity_id AND b.bank_source_id=i.bank_source_id
  WHERE i.tenant_id=p_tenant AND i.entity_id=p_entity AND i.reconciliation_id=p_reconciliation AND i.state='CLEARED';
  SELECT COALESCE(sum(ll.debit_amount-ll.credit_amount),0)::numeric(20,4) INTO book_balance FROM ledger_line ll JOIN journal_line jl
    ON jl.tenant_id=ll.tenant_id AND jl.entity_id=ll.entity_id AND jl.journal_entry_id=ll.journal_entry_id AND jl.journal_line_id=ll.journal_line_id
  JOIN journal_entry posted ON posted.tenant_id=ll.tenant_id AND posted.entity_id=ll.entity_id AND posted.journal_entry_id=ll.journal_entry_id
  WHERE ll.tenant_id=p_tenant AND ll.entity_id=p_entity AND jl.member_ref=rec.bank_account_ref
    AND posted.status='POSTED' AND posted.currency=rec.currency AND posted.journal_date<=rec.statement_ending_date;
  IF action='REVIEW' THEN
    IF rec.status NOT IN ('DRAFT','REOPENED') THEN RAISE EXCEPTION 'Only Draft or Reopened reconciliation can enter review' USING ERRCODE='23514'; END IF;
    IF rec.statement_ending_balance<>book_balance OR rec.statement_ending_balance<>rec.statement_opening_balance+cleared_activity
       OR scoped_bank_items=0 OR foreign_currency_items<>0 OR total_items<>scoped_bank_items OR total_items<>cleared_items OR invalid_evidence<>0 THEN
      RAISE EXCEPTION 'Review requires book-to-bank tie, statement activity tie, one currency, and exact posted evidence' USING ERRCODE='23514';
    END IF;
    UPDATE reconciliation SET status='IN_REVIEW',book_ending_balance=book_balance,difference=statement_ending_balance-book_balance,
      reviewed_by=actor,reviewed_at=clock_timestamp(),review_reason=btrim(p_reason),version=version+1
      WHERE tenant_id=p_tenant AND entity_id=p_entity AND reconciliation_id=p_reconciliation RETURNING * INTO rec;
  ELSIF action='SIGN_OFF' THEN
    IF rec.status<>'IN_REVIEW' OR rec.statement_ending_balance<>book_balance
       OR rec.statement_ending_balance<>rec.statement_opening_balance+cleared_activity
       OR scoped_bank_items=0 OR foreign_currency_items<>0 OR total_items<>scoped_bank_items OR total_items<>cleared_items OR invalid_evidence<>0 THEN
      RAISE EXCEPTION 'Sign-off requires reviewed book-to-bank tie and exact posted evidence' USING ERRCODE='23514';
    END IF;
    IF rec.reviewed_by=actor THEN RAISE EXCEPTION 'Reviewer cannot sign off the same reconciliation' USING ERRCODE='42501'; END IF;
    UPDATE reconciliation SET status='RECONCILED',book_ending_balance=book_balance,difference=statement_ending_balance-book_balance,
      reconciled_by=actor,reconciled_at=clock_timestamp(),version=version+1
      WHERE tenant_id=p_tenant AND entity_id=p_entity AND reconciliation_id=p_reconciliation RETURNING * INTO rec;
    SELECT jsonb_build_object('reconciliation',to_jsonb(rec),'items',COALESCE(jsonb_agg(to_jsonb(i) ORDER BY i.bank_source_id),'[]'::jsonb))
      INTO snapshot FROM reconciliation_item i WHERE i.tenant_id=p_tenant AND i.entity_id=p_entity AND i.reconciliation_id=p_reconciliation;
    snapshot_hash:=refs_jsonb_hash(snapshot);snapshot_id:=gen_random_uuid();
    INSERT INTO reconciliation_snapshot(reconciliation_snapshot_id,tenant_id,entity_id,reconciliation_id,reconciliation_version,
      statement_ending_date,snapshot_body,snapshot_hash,signed_off_by)
    VALUES(snapshot_id,p_tenant,p_entity,p_reconciliation,rec.version,rec.statement_ending_date,snapshot,snapshot_hash,actor);
  ELSE
    IF rec.status<>'RECONCILED' THEN RAISE EXCEPTION 'Only a signed-off reconciliation can be reopened' USING ERRCODE='23514'; END IF;
    IF rec.reconciled_by=actor THEN RAISE EXCEPTION 'Signer cannot reopen the same reconciliation' USING ERRCODE='42501'; END IF;
    SELECT s.reconciliation_id INTO latest_snapshot_reconciliation_id FROM reconciliation_snapshot s JOIN reconciliation signed
      ON signed.tenant_id=s.tenant_id AND signed.entity_id=s.entity_id AND signed.reconciliation_id=s.reconciliation_id
    WHERE s.tenant_id=p_tenant AND s.entity_id=p_entity AND signed.bank_account_ref=rec.bank_account_ref
    ORDER BY s.statement_ending_date DESC,s.signed_off_at DESC,s.reconciliation_version DESC LIMIT 1 FOR SHARE OF signed;
    IF latest_snapshot_reconciliation_id IS DISTINCT FROM rec.reconciliation_id THEN RAISE EXCEPTION 'A reconciliation can be reopened only from the latest signed-off statement' USING ERRCODE='23514'; END IF;
    IF EXISTS(SELECT 1 FROM reconciliation opened WHERE opened.tenant_id=p_tenant AND opened.entity_id=p_entity
      AND opened.bank_account_ref=rec.bank_account_ref AND opened.reconciliation_id<>rec.reconciliation_id
      AND opened.status IN ('DRAFT','IN_REVIEW','REOPENED')) THEN RAISE EXCEPTION 'A signed statement cannot be reopened while another reconciliation is open' USING ERRCODE='23514'; END IF;
    UPDATE reconciliation SET status='REOPENED',reopened_by=actor,reopened_at=clock_timestamp(),version=version+1
      WHERE tenant_id=p_tenant AND entity_id=p_entity AND reconciliation_id=p_reconciliation RETURNING * INTO rec;
  END IF;
  response:=jsonb_build_object('reconciliation_id',p_reconciliation,'status',rec.status,'difference',rec.difference,
    'revision',rec.version,'snapshot_id',snapshot_id,'snapshot_hash',snapshot_hash,'idempotent',false);
  INSERT INTO audit_event(tenant_id,entity_id,event_type,object_type,object_id,action,actor_id,actor_type,permission_used,
    request_id,correlation_id,idempotency_key,after_hash,reason)
  VALUES(p_tenant,p_entity,'RECONCILIATION_'||action,'RECONCILIATION',p_reconciliation,action||'_RECONCILIATION',actor,'USER',
    'BANK.RECONCILIATION.'||action,p_idempotency_key,p_idempotency_key,p_idempotency_key,refs_jsonb_hash(response),btrim(p_reason));
  event_payload:=response-'idempotent';
  INSERT INTO outbox_event(tenant_id,entity_id,aggregate_type,aggregate_id,event_type,payload,payload_hash)
  VALUES(p_tenant,p_entity,'RECONCILIATION',p_reconciliation,'RECONCILIATION_'||action,event_payload,refs_jsonb_hash(event_payload));
  UPDATE idempotency_receipt SET status='SUCCEEDED',response_status=201,response_body=response,completed_at=clock_timestamp()
    WHERE tenant_id=p_tenant AND operation_scope='RECONCILIATION_'||action||':'||p_entity AND idempotency_key=p_idempotency_key;
  RETURN response;
END;
$$;

REVOKE ALL ON FUNCTION refs_set_reconciliation_clearance_385(uuid,uuid,uuid,uuid,bigint,bigint,boolean,text,text,text),refs_transition_reconciliation_adjustment_aware_385(uuid,uuid,uuid,text,bigint,text,text,text) FROM PUBLIC,refs_app;
COMMIT;
