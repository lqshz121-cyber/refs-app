BEGIN;

CREATE OR REPLACE FUNCTION refs_set_reconciliation_clearance(
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

CREATE OR REPLACE FUNCTION refs_reconciliation_transition_hash(
  p_tenant uuid,p_entity uuid,p_reconciliation uuid,p_action text,p_expected_version bigint,p_reason text
) RETURNS text
LANGUAGE sql IMMUTABLE SET search_path=pg_catalog,public,pg_temp AS $$
  SELECT refs_jsonb_hash(jsonb_build_object('tenant_id',p_tenant,'entity_id',p_entity,'reconciliation_id',p_reconciliation,
    'action',upper(p_action),'expected_version',p_expected_version,'reason',btrim(p_reason)))
$$;


REVOKE ALL ON FUNCTION refs_set_reconciliation_clearance(uuid,uuid,uuid,uuid,bigint,bigint,boolean,text,text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION refs_set_reconciliation_clearance(uuid,uuid,uuid,uuid,bigint,bigint,boolean,text,text,text) TO refs_app;

COMMIT;
