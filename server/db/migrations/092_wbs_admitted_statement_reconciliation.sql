BEGIN;

ALTER TABLE reconciliation
  ADD COLUMN wbs_bank_statement_receipt_id uuid,
  ADD CONSTRAINT reconciliation_wbs_bank_statement_receipt_fk
    FOREIGN KEY(tenant_id,entity_id,wbs_bank_statement_receipt_id)
    REFERENCES wbs_bank_statement_receipt(tenant_id,entity_id,wbs_bank_statement_receipt_id);

CREATE UNIQUE INDEX reconciliation_wbs_bank_statement_receipt_uq
  ON reconciliation(tenant_id,entity_id,wbs_bank_statement_receipt_id)
  WHERE wbs_bank_statement_receipt_id IS NOT NULL;

CREATE FUNCTION refs_guard_reconciliation_wbs_statement_scope() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE statement_row public.wbs_bank_statement_receipt%ROWTYPE;
BEGIN
  IF TG_OP='UPDATE' AND OLD.wbs_bank_statement_receipt_id IS DISTINCT FROM NEW.wbs_bank_statement_receipt_id THEN
    RAISE EXCEPTION 'An admitted WBS statement link is immutable' USING ERRCODE='55000';
  END IF;
  IF NEW.wbs_bank_statement_receipt_id IS NULL THEN RETURN NEW; END IF;
  SELECT * INTO statement_row
  FROM public.wbs_bank_statement_receipt s
  WHERE s.tenant_id=NEW.tenant_id AND s.entity_id=NEW.entity_id
    AND s.wbs_bank_statement_receipt_id=NEW.wbs_bank_statement_receipt_id
    AND s.signature_verified AND s.admission_status='ADMITTED'
  FOR SHARE;
  IF NOT FOUND OR NEW.bank_account_ref<>statement_row.bank_account_ref
     OR NEW.statement_ending_date<>statement_row.statement_end_date
     OR NEW.statement_opening_balance<>statement_row.opening_balance
     OR NEW.statement_ending_balance<>statement_row.ending_balance
     OR NEW.currency<>statement_row.currency THEN
    RAISE EXCEPTION 'Reconciliation statement facts must match the exact admitted WBS statement receipt' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER reconciliation_wbs_statement_scope_guard
  BEFORE INSERT OR UPDATE ON reconciliation
  FOR EACH ROW EXECUTE FUNCTION refs_guard_reconciliation_wbs_statement_scope();

CREATE FUNCTION refs_guard_reconciliation_wbs_statement_item() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE statement_receipt uuid;
BEGIN
  SELECT r.wbs_bank_statement_receipt_id INTO statement_receipt
  FROM public.reconciliation r
  WHERE r.tenant_id=NEW.tenant_id AND r.entity_id=NEW.entity_id AND r.reconciliation_id=NEW.reconciliation_id
  FOR SHARE;
  IF statement_receipt IS NOT NULL AND NOT EXISTS(
    SELECT 1 FROM public.wbs_bank_statement_transaction t
    WHERE t.tenant_id=NEW.tenant_id AND t.entity_id=NEW.entity_id
      AND t.wbs_bank_statement_receipt_id=statement_receipt AND t.bank_source_id=NEW.bank_source_id
  ) THEN
    RAISE EXCEPTION 'Only bank sources from the admitted WBS statement receipt may enter this reconciliation' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER reconciliation_item_wbs_statement_scope_guard
  BEFORE INSERT OR UPDATE OF reconciliation_id,bank_source_id ON reconciliation_item
  FOR EACH ROW EXECUTE FUNCTION refs_guard_reconciliation_wbs_statement_item();

CREATE FUNCTION refs_guard_reconciliation_wbs_statement_adjustment() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE statement_receipt uuid;
BEGIN
  SELECT r.wbs_bank_statement_receipt_id INTO statement_receipt
  FROM public.reconciliation r
  WHERE r.tenant_id=NEW.tenant_id AND r.entity_id=NEW.entity_id AND r.reconciliation_id=NEW.reconciliation_id
  FOR SHARE;
  IF statement_receipt IS NOT NULL AND NOT EXISTS(
    SELECT 1 FROM public.wbs_bank_statement_transaction t
    WHERE t.tenant_id=NEW.tenant_id AND t.entity_id=NEW.entity_id
      AND t.wbs_bank_statement_receipt_id=statement_receipt AND t.bank_source_id=NEW.bank_source_id
  ) THEN
    RAISE EXCEPTION 'Only bank sources from the admitted WBS statement receipt may create an adjustment Draft' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER reconciliation_adjustment_draft_wbs_statement_scope_guard
  BEFORE INSERT OR UPDATE OF reconciliation_id,bank_source_id ON reconciliation_adjustment_draft
  FOR EACH ROW EXECUTE FUNCTION refs_guard_reconciliation_wbs_statement_adjustment();

CREATE FUNCTION refs_wbs_statement_reconciliation_start_hash(
  p_tenant uuid,p_entity uuid,p_statement_receipt uuid,p_reason text
) RETURNS text
LANGUAGE sql IMMUTABLE SET search_path=pg_catalog,public,pg_temp AS $$
  SELECT refs_jsonb_hash(jsonb_build_object(
    'tenant_id',p_tenant,'entity_id',p_entity,'wbs_bank_statement_receipt_id',p_statement_receipt,
    'reason',btrim(p_reason)
  ))
$$;

CREATE FUNCTION refs_start_reconciliation_from_wbs_statement(
  p_tenant uuid,p_entity uuid,p_statement_receipt uuid,p_reason text,
  p_idempotency_key text,p_request_hash text
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE actor text:=refs_current_actor(); idem idempotency_receipt; statement_row wbs_bank_statement_receipt;
DECLARE reconciliation_id uuid:=gen_random_uuid(); prior_date date; prior_balance numeric(20,4); book_balance numeric(20,4);
DECLARE linked_count integer; valid_count integer; statement_activity numeric(20,4); response jsonb; event_payload jsonb;
BEGIN
  PERFORM refs_assert_scope(p_tenant,p_entity,'BANK.RECONCILIATION.START');
  IF actor IS NULL THEN RAISE EXCEPTION 'Authenticated actor missing' USING ERRCODE='42501'; END IF;
  IF p_statement_receipt IS NULL OR COALESCE(length(btrim(p_reason)),0) NOT BETWEEN 8 AND 2000 THEN
    RAISE EXCEPTION 'An admitted statement receipt and canonical review reason are required' USING ERRCODE='22023';
  END IF;
  IF p_request_hash<>refs_wbs_statement_reconciliation_start_hash(p_tenant,p_entity,p_statement_receipt,p_reason) THEN
    RAISE EXCEPTION 'Admitted statement reconciliation request hash is not canonical' USING ERRCODE='22023';
  END IF;

  SELECT * INTO statement_row
  FROM wbs_bank_statement_receipt s
  WHERE s.tenant_id=p_tenant AND s.entity_id=p_entity
    AND s.wbs_bank_statement_receipt_id=p_statement_receipt
    AND s.signature_verified AND s.admission_status='ADMITTED'
  FOR SHARE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'An exact admitted WBS bank statement receipt is required' USING ERRCODE='23514';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(p_tenant::text||':'||p_entity::text||':'||statement_row.bank_account_ref,0));

  INSERT INTO idempotency_receipt(tenant_id,operation_scope,idempotency_key,request_hash,status,actor_id)
    VALUES(p_tenant,'RECONCILIATION_WBS_START:'||p_entity,p_idempotency_key,p_request_hash,'IN_PROGRESS',actor)
  ON CONFLICT (tenant_id,operation_scope,idempotency_key) DO NOTHING;
  SELECT * INTO idem FROM idempotency_receipt
  WHERE tenant_id=p_tenant AND operation_scope='RECONCILIATION_WBS_START:'||p_entity
    AND idempotency_key=p_idempotency_key FOR UPDATE;
  IF idem.request_hash<>p_request_hash THEN
    RAISE EXCEPTION 'Idempotency key reused with a different admitted statement request' USING ERRCODE='23505';
  END IF;
  IF idem.status='SUCCEEDED' THEN RETURN idem.response_body||jsonb_build_object('idempotent',true); END IF;

  PERFORM 1 FROM member_master
  WHERE tenant_id=p_tenant AND entity_id=p_entity AND member_ref=statement_row.bank_account_ref
    AND member_type='BANK' AND active FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'The admitted statement bank account is not an active BANK member' USING ERRCODE='23514'; END IF;

  SELECT count(*)::integer INTO linked_count
  FROM wbs_bank_statement_transaction t
  WHERE t.tenant_id=p_tenant AND t.entity_id=p_entity
    AND t.wbs_bank_statement_receipt_id=p_statement_receipt;
  SELECT count(*)::integer,COALESCE(sum(b.amount),0)::numeric(20,4) INTO valid_count,statement_activity
  FROM wbs_bank_statement_transaction t
  JOIN bank_source b ON b.tenant_id=t.tenant_id AND b.entity_id=t.entity_id AND b.bank_source_id=t.bank_source_id
  WHERE t.tenant_id=p_tenant AND t.entity_id=p_entity
    AND t.wbs_bank_statement_receipt_id=p_statement_receipt
    AND b.bank_account_ref=statement_row.bank_account_ref AND b.currency=statement_row.currency
    AND b.transaction_date BETWEEN statement_row.statement_start_date AND statement_row.statement_end_date;
  IF linked_count<1 OR valid_count<>linked_count THEN
    RAISE EXCEPTION 'Every statement row must retain the exact admitted account, currency and date scope' USING ERRCODE='23514';
  END IF;
  IF statement_row.opening_balance+statement_activity<>statement_row.ending_balance THEN
    RAISE EXCEPTION 'Admitted statement opening balance plus receipt activity must equal ending balance' USING ERRCODE='23514';
  END IF;

  PERFORM 1 FROM reconciliation
  WHERE tenant_id=p_tenant AND entity_id=p_entity AND bank_account_ref=statement_row.bank_account_ref
    AND status IN ('DRAFT','IN_REVIEW','REOPENED') FOR UPDATE;
  IF FOUND THEN RAISE EXCEPTION 'An open reconciliation already exists for this bank account' USING ERRCODE='23505'; END IF;

  SELECT s.statement_ending_date,r.statement_ending_balance INTO prior_date,prior_balance
  FROM reconciliation_snapshot s JOIN reconciliation r
    ON r.tenant_id=s.tenant_id AND r.entity_id=s.entity_id AND r.reconciliation_id=s.reconciliation_id
  WHERE s.tenant_id=p_tenant AND s.entity_id=p_entity AND r.bank_account_ref=statement_row.bank_account_ref
  ORDER BY s.statement_ending_date DESC,s.signed_off_at DESC,s.reconciliation_version DESC LIMIT 1 FOR SHARE OF r;
  IF prior_date IS NOT NULL AND prior_date>=statement_row.statement_end_date THEN
    RAISE EXCEPTION 'Statement ending date must follow the latest signed-off statement' USING ERRCODE='23514';
  END IF;
  IF prior_date IS NOT NULL AND prior_balance<>statement_row.opening_balance THEN
    RAISE EXCEPTION 'Statement opening balance must equal the latest signed-off ending balance' USING ERRCODE='23514';
  END IF;

  SELECT COALESCE(sum(ll.debit_amount-ll.credit_amount),0)::numeric(20,4) INTO book_balance
  FROM ledger_line ll JOIN journal_line jl
    ON jl.tenant_id=ll.tenant_id AND jl.entity_id=ll.entity_id
      AND jl.journal_entry_id=ll.journal_entry_id AND jl.journal_line_id=ll.journal_line_id
  JOIN journal_entry je ON je.tenant_id=ll.tenant_id AND je.entity_id=ll.entity_id AND je.journal_entry_id=ll.journal_entry_id
  WHERE ll.tenant_id=p_tenant AND ll.entity_id=p_entity AND jl.member_ref=statement_row.bank_account_ref
    AND je.status='POSTED' AND je.currency=statement_row.currency AND je.journal_date<=statement_row.statement_end_date;

  INSERT INTO reconciliation(reconciliation_id,tenant_id,entity_id,bank_account_ref,statement_ending_date,
    statement_opening_balance,statement_ending_balance,book_ending_balance,currency,difference,status,started_by,started_at,
    wbs_bank_statement_receipt_id)
  VALUES(reconciliation_id,p_tenant,p_entity,statement_row.bank_account_ref,statement_row.statement_end_date,
    statement_row.opening_balance,statement_row.ending_balance,book_balance,statement_row.currency,
    statement_row.ending_balance-book_balance,'DRAFT',actor,clock_timestamp(),p_statement_receipt);
  response:=jsonb_build_object('reconciliation_id',reconciliation_id,'wbs_bank_statement_receipt_id',p_statement_receipt,
    'bank_account_ref',statement_row.bank_account_ref,'statement_start_date',statement_row.statement_start_date,
    'statement_ending_date',statement_row.statement_end_date,'statement_opening_balance',statement_row.opening_balance,
    'statement_ending_balance',statement_row.ending_balance,'book_ending_balance',book_balance,'currency',statement_row.currency,
    'difference',statement_row.ending_balance-book_balance,'status','DRAFT','revision',0,'idempotent',false);
  INSERT INTO audit_event(tenant_id,entity_id,event_type,object_type,object_id,action,actor_id,actor_type,permission_used,
    request_id,correlation_id,idempotency_key,after_hash,reason,metadata)
  VALUES(p_tenant,p_entity,'RECONCILIATION_STARTED','RECONCILIATION',reconciliation_id,'START_RECONCILIATION',actor,'USER',
    'BANK.RECONCILIATION.START',p_idempotency_key,p_idempotency_key,p_idempotency_key,refs_jsonb_hash(response),btrim(p_reason),
    jsonb_build_object('wbs_bank_statement_receipt_id',p_statement_receipt));
  event_payload:=response-'idempotent';
  INSERT INTO outbox_event(tenant_id,entity_id,aggregate_type,aggregate_id,event_type,payload,payload_hash)
  VALUES(p_tenant,p_entity,'RECONCILIATION',reconciliation_id,'RECONCILIATION_STARTED',event_payload,refs_jsonb_hash(event_payload));
  UPDATE idempotency_receipt SET status='SUCCEEDED',response_status=201,response_body=response,completed_at=clock_timestamp()
  WHERE idempotency_receipt_id=idem.idempotency_receipt_id;
  RETURN response;
END;
$$;

CREATE OR REPLACE FUNCTION refs_list_reconciliation_worksheet(
  p_tenant uuid,p_entity uuid,p_reconciliation uuid
)
RETURNS TABLE(
  reconciliation_id uuid,reconciliation_version bigint,bank_source_id uuid,bank_version bigint,
  bank_account_ref text,external_bank_line_id text,transaction_date date,currency char(3),amount numeric(20,4),
  bank_match_id uuid,bank_match_version bigint,match_status text,business_source_document_id uuid,
  journal_entry_id uuid,journal_line_id uuid,clearance_state text,reconciliation_item_id uuid,item_version bigint,
  cleared_by text,cleared_at timestamptz,uncleared_by text,uncleared_at timestamptz
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE reconciliation_row public.reconciliation%ROWTYPE;
DECLARE prior_ending_date date;
BEGIN
  PERFORM public.refs_assert_scope(p_tenant,p_entity,'BANK.VIEW');
  SELECT * INTO reconciliation_row FROM public.reconciliation r
  WHERE r.tenant_id=p_tenant AND r.entity_id=p_entity AND r.reconciliation_id=p_reconciliation
    AND r.status IN ('DRAFT','IN_REVIEW','REOPENED') FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Open reconciliation was not found in the requested scope' USING ERRCODE='P0002'; END IF;
  SELECT max(previous.statement_ending_date) INTO prior_ending_date FROM public.reconciliation previous
  WHERE previous.tenant_id=p_tenant AND previous.entity_id=p_entity
    AND previous.bank_account_ref=reconciliation_row.bank_account_ref AND previous.status='RECONCILED'
    AND previous.statement_ending_date<reconciliation_row.statement_ending_date;
  RETURN QUERY
    SELECT reconciliation_row.reconciliation_id,reconciliation_row.version,
      b.bank_source_id,b.version,b.bank_account_ref,b.external_bank_line_id,b.transaction_date,b.currency,b.amount,
      active_match.bank_match_id,active_match.version,active_match.status::text,
      active_match.business_source_document_id,active_match.journal_entry_id,active_match.journal_line_id,
      COALESCE(item.state,'NOT_CLEARED'),item.reconciliation_item_id,item.version,
      item.cleared_by,item.cleared_at,item.uncleared_by,item.uncleared_at
    FROM public.bank_source b
    LEFT JOIN LATERAL (
      SELECT bm.* FROM public.bank_match bm
      WHERE bm.tenant_id=b.tenant_id AND bm.entity_id=b.entity_id
        AND bm.bank_source_id=b.bank_source_id AND bm.status='ACTIVE' FOR SHARE
    ) active_match ON true
    LEFT JOIN public.reconciliation_item item
      ON item.tenant_id=b.tenant_id AND item.entity_id=b.entity_id
        AND item.reconciliation_id=reconciliation_row.reconciliation_id AND item.bank_source_id=b.bank_source_id
    WHERE b.tenant_id=p_tenant AND b.entity_id=p_entity
      AND b.bank_account_ref=reconciliation_row.bank_account_ref
      AND (
        (reconciliation_row.wbs_bank_statement_receipt_id IS NULL
          AND b.transaction_date<=reconciliation_row.statement_ending_date
          AND (prior_ending_date IS NULL OR b.transaction_date>prior_ending_date))
        OR EXISTS(
          SELECT 1 FROM public.wbs_bank_statement_transaction t
          WHERE reconciliation_row.wbs_bank_statement_receipt_id IS NOT NULL
            AND t.tenant_id=b.tenant_id AND t.entity_id=b.entity_id
            AND t.wbs_bank_statement_receipt_id=reconciliation_row.wbs_bank_statement_receipt_id
            AND t.bank_source_id=b.bank_source_id
        )
      )
    ORDER BY b.transaction_date,b.external_bank_line_id,b.bank_source_id;
END;
$$;

ALTER FUNCTION refs_transition_reconciliation_adjustment_aware(uuid,uuid,uuid,text,bigint,text,text,text)
  RENAME TO refs_transition_reconciliation_adjustment_aware_legacy_092;
REVOKE ALL ON FUNCTION refs_transition_reconciliation_adjustment_aware_legacy_092(uuid,uuid,uuid,text,bigint,text,text,text)
  FROM PUBLIC,refs_app;

CREATE FUNCTION refs_transition_reconciliation_adjustment_aware(
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
  LEFT JOIN payment_occurrence po ON po.tenant_id=m.tenant_id AND po.entity_id=m.entity_id AND po.payment_occurrence_id=m.payment_occurrence_id
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

REVOKE ALL ON FUNCTION refs_transition_reconciliation_adjustment_aware(uuid,uuid,uuid,text,bigint,text,text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION refs_transition_reconciliation_adjustment_aware(uuid,uuid,uuid,text,bigint,text,text,text) TO refs_app;

REVOKE ALL ON FUNCTION refs_wbs_statement_reconciliation_start_hash(uuid,uuid,uuid,text) FROM PUBLIC;
REVOKE ALL ON FUNCTION refs_start_reconciliation_from_wbs_statement(uuid,uuid,uuid,text,text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION refs_wbs_statement_reconciliation_start_hash(uuid,uuid,uuid,text) TO refs_app;
GRANT EXECUTE ON FUNCTION refs_start_reconciliation_from_wbs_statement(uuid,uuid,uuid,text,text,text) TO refs_app;

COMMIT;
