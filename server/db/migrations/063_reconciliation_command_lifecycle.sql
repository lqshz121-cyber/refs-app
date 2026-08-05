BEGIN;

INSERT INTO permission_catalog(permission_code,domain,risk_class,sod_class)
VALUES ('BANK.RECONCILIATION.START','BANK','HIGH','BANK_RECONCILIATION_MAKER'),
       ('BANK.RECONCILIATION.CLEAR','BANK','HIGH','BANK_RECONCILIATION_MAKER'),
       ('BANK.RECONCILIATION.REVIEW','BANK','HIGH','BANK_RECONCILIATION_REVIEWER'),
       ('BANK.RECONCILIATION.SIGN_OFF','BANK','CRITICAL','BANK_RECONCILIATION_APPROVER'),
       ('BANK.RECONCILIATION.REOPEN','BANK','CRITICAL','BANK_RECONCILIATION_REOPENER')
ON CONFLICT (permission_code) DO UPDATE
  SET active=true,domain=EXCLUDED.domain,risk_class=EXCLUDED.risk_class,sod_class=EXCLUDED.sod_class,
      version=permission_catalog.version+1,effective_to=NULL;

ALTER TABLE reconciliation
  ADD COLUMN statement_opening_balance numeric(20,4) NOT NULL DEFAULT 0,
  ADD COLUMN book_ending_balance numeric(20,4) NOT NULL DEFAULT 0,
  ADD COLUMN currency char(3),
  ADD COLUMN started_by text,
  ADD COLUMN started_at timestamptz,
  ADD COLUMN reviewed_by text,
  ADD COLUMN reviewed_at timestamptz,
  ADD COLUMN review_reason text,
  ADD CONSTRAINT reconciliation_started_ck CHECK ((started_by IS NULL)=(started_at IS NULL)),
  ADD CONSTRAINT reconciliation_reviewed_ck CHECK (
    status<>'IN_REVIEW' OR
    (reviewed_by IS NOT NULL AND reviewed_at IS NOT NULL AND length(btrim(review_reason)) BETWEEN 8 AND 2000)
  ),
  ADD CONSTRAINT reconciliation_reopened_ck CHECK (
    status<>'REOPENED' OR (reopened_by IS NOT NULL AND reopened_at IS NOT NULL)
  );

CREATE TABLE reconciliation_item (
  reconciliation_item_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  entity_id uuid NOT NULL,
  reconciliation_id uuid NOT NULL,
  bank_source_id uuid NOT NULL,
  bank_match_id uuid,
  state text NOT NULL CHECK (state IN ('CLEARED','UNCLEARED')),
  cleared_by text NOT NULL,
  cleared_at timestamptz NOT NULL DEFAULT now(),
  uncleared_by text,
  uncleared_at timestamptz,
  reason text NOT NULL CHECK (length(btrim(reason)) BETWEEN 8 AND 2000),
  version bigint NOT NULL DEFAULT 0 CHECK (version>=0),
  CHECK ((state='UNCLEARED' AND uncleared_by IS NOT NULL AND uncleared_at IS NOT NULL) OR state='CLEARED'),
  UNIQUE (tenant_id,entity_id,reconciliation_id,bank_source_id),
  UNIQUE (tenant_id,entity_id,reconciliation_item_id),
  FOREIGN KEY (tenant_id,entity_id,reconciliation_id) REFERENCES reconciliation(tenant_id,entity_id,reconciliation_id),
  FOREIGN KEY (tenant_id,entity_id,bank_source_id) REFERENCES bank_source(tenant_id,entity_id,bank_source_id),
  FOREIGN KEY (tenant_id,entity_id,bank_match_id) REFERENCES bank_match(tenant_id,entity_id,bank_match_id)
);

CREATE INDEX reconciliation_item_scope_idx
  ON reconciliation_item(tenant_id,entity_id,reconciliation_id,state,bank_source_id);

CREATE UNIQUE INDEX reconciliation_one_open_account_uq
  ON reconciliation(tenant_id,entity_id,bank_account_ref)
  WHERE status IN ('DRAFT','IN_REVIEW','REOPENED');

CREATE TABLE reconciliation_snapshot (
  reconciliation_snapshot_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  entity_id uuid NOT NULL,
  reconciliation_id uuid NOT NULL,
  reconciliation_version bigint NOT NULL CHECK (reconciliation_version>=0),
  statement_ending_date date NOT NULL,
  snapshot_body jsonb NOT NULL,
  snapshot_hash text NOT NULL CHECK (snapshot_hash ~ '^sha256:[0-9a-f]{64}$'),
  signed_off_by text NOT NULL,
  signed_off_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id,entity_id,reconciliation_id,reconciliation_version),
  UNIQUE (tenant_id,entity_id,reconciliation_snapshot_id),
  FOREIGN KEY (tenant_id,entity_id,reconciliation_id) REFERENCES reconciliation(tenant_id,entity_id,reconciliation_id)
);

CREATE FUNCTION refs_block_signed_reconciliation_match_change() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
BEGIN
  IF OLD.status='ACTIVE' AND NEW.status<>'ACTIVE' AND EXISTS(
    SELECT 1 FROM public.reconciliation_item i
    JOIN public.reconciliation r
      ON r.tenant_id=i.tenant_id AND r.entity_id=i.entity_id AND r.reconciliation_id=i.reconciliation_id
    WHERE i.tenant_id=OLD.tenant_id AND i.entity_id=OLD.entity_id AND i.bank_match_id=OLD.bank_match_id
      AND i.state='CLEARED' AND r.status='RECONCILED'
  ) THEN
    RAISE EXCEPTION 'Signed-off reconciliation must be reopened before its bank match can change' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER bank_match_signed_reconciliation_guard
  BEFORE UPDATE OF status ON bank_match
  FOR EACH ROW EXECUTE FUNCTION refs_block_signed_reconciliation_match_change();

ALTER TABLE reconciliation_item ENABLE ROW LEVEL SECURITY;
ALTER TABLE reconciliation_snapshot ENABLE ROW LEVEL SECURITY;
CREATE POLICY reconciliation_item_scope_policy ON reconciliation_item
  USING (tenant_id=refs_current_tenant() AND refs_entity_allowed(entity_id))
  WITH CHECK (tenant_id=refs_current_tenant() AND refs_entity_allowed(entity_id));
CREATE POLICY reconciliation_snapshot_scope_policy ON reconciliation_snapshot
  USING (tenant_id=refs_current_tenant() AND refs_entity_allowed(entity_id))
  WITH CHECK (tenant_id=refs_current_tenant() AND refs_entity_allowed(entity_id));

CREATE FUNCTION refs_reconciliation_start_hash(
  p_tenant uuid,p_entity uuid,p_bank_account_ref text,p_statement_ending_date date,
  p_statement_opening_balance numeric,p_statement_ending_balance numeric,p_reason text
) RETURNS text
LANGUAGE sql IMMUTABLE SET search_path=pg_catalog,public,pg_temp AS $$
  SELECT refs_jsonb_hash(jsonb_build_object(
    'tenant_id',p_tenant,'entity_id',p_entity,'bank_account_ref',p_bank_account_ref,
    'statement_ending_date',p_statement_ending_date,'statement_opening_balance',p_statement_opening_balance,
    'statement_ending_balance',p_statement_ending_balance,'reason',btrim(p_reason)
  ))
$$;

CREATE FUNCTION refs_start_reconciliation(
  p_tenant uuid,p_entity uuid,p_bank_account_ref text,p_statement_ending_date date,
  p_statement_opening_balance numeric,p_statement_ending_balance numeric,p_reason text,
  p_idempotency_key text,p_request_hash text
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE actor text:=refs_current_actor(); receipt idempotency_receipt; reconciliation_id uuid:=gen_random_uuid();
DECLARE prior_date date; prior_balance numeric(20,4); book_balance numeric(20,4); response jsonb; event_payload jsonb;
DECLARE statement_currency char(3); currency_count integer;
BEGIN
  PERFORM refs_assert_scope(p_tenant,p_entity,'BANK.RECONCILIATION.START');
  IF actor IS NULL THEN RAISE EXCEPTION 'Authenticated actor missing' USING ERRCODE='42501'; END IF;
  IF p_request_hash<>refs_reconciliation_start_hash(p_tenant,p_entity,p_bank_account_ref,p_statement_ending_date,p_statement_opening_balance,p_statement_ending_balance,p_reason) THEN
    RAISE EXCEPTION 'Reconciliation start request hash is not canonical' USING ERRCODE='22023';
  END IF;
  IF p_bank_account_ref IS NULL OR p_bank_account_ref<>btrim(p_bank_account_ref) OR p_bank_account_ref='' OR length(p_bank_account_ref)>128
     OR p_statement_ending_date IS NULL OR p_statement_opening_balance IS NULL OR p_statement_ending_balance IS NULL
     OR COALESCE(length(btrim(p_reason)),0) NOT BETWEEN 8 AND 2000 THEN
    RAISE EXCEPTION 'Reconciliation start requires a canonical account, statement date, balances and review reason' USING ERRCODE='22023';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(p_tenant::text||':'||p_entity::text||':'||p_bank_account_ref,0));

  INSERT INTO idempotency_receipt(tenant_id,operation_scope,idempotency_key,request_hash,status,actor_id)
    VALUES(p_tenant,'RECONCILIATION_START:'||p_entity,p_idempotency_key,p_request_hash,'IN_PROGRESS',actor)
  ON CONFLICT (tenant_id,operation_scope,idempotency_key) DO NOTHING;
  SELECT * INTO receipt FROM idempotency_receipt
    WHERE tenant_id=p_tenant AND operation_scope='RECONCILIATION_START:'||p_entity AND idempotency_key=p_idempotency_key FOR UPDATE;
  IF receipt.request_hash<>p_request_hash THEN RAISE EXCEPTION 'Idempotency key reused with a different request' USING ERRCODE='23505'; END IF;
  IF receipt.status='SUCCEEDED' THEN RETURN receipt.response_body||jsonb_build_object('idempotent',true); END IF;

  PERFORM 1 FROM reconciliation
    WHERE tenant_id=p_tenant AND entity_id=p_entity AND bank_account_ref=p_bank_account_ref
      AND status IN ('DRAFT','IN_REVIEW','REOPENED') FOR UPDATE;
  IF FOUND THEN RAISE EXCEPTION 'An open reconciliation already exists for this bank account' USING ERRCODE='23505'; END IF;
  SELECT s.statement_ending_date,r.statement_ending_balance INTO prior_date,prior_balance
  FROM reconciliation_snapshot s JOIN reconciliation r
    ON r.tenant_id=s.tenant_id AND r.entity_id=s.entity_id AND r.reconciliation_id=s.reconciliation_id
  WHERE s.tenant_id=p_tenant AND s.entity_id=p_entity AND r.bank_account_ref=p_bank_account_ref
  ORDER BY s.statement_ending_date DESC,s.signed_off_at DESC,s.reconciliation_version DESC LIMIT 1 FOR SHARE OF r;
  IF prior_date IS NOT NULL AND prior_date>=p_statement_ending_date THEN
    RAISE EXCEPTION 'Statement ending date must follow the latest signed-off statement' USING ERRCODE='23514';
  END IF;
  IF prior_date IS NOT NULL AND prior_balance<>p_statement_opening_balance THEN
    RAISE EXCEPTION 'Statement opening balance must equal the latest signed-off ending balance' USING ERRCODE='23514';
  END IF;
  SELECT min(currency),count(DISTINCT currency) INTO statement_currency,currency_count
  FROM bank_source WHERE tenant_id=p_tenant AND entity_id=p_entity AND bank_account_ref=p_bank_account_ref
    AND transaction_date<=p_statement_ending_date AND (prior_date IS NULL OR transaction_date>prior_date);
  IF currency_count<>1 OR statement_currency IS NULL THEN
    RAISE EXCEPTION 'Reconciliation requires exactly one statement currency in scope' USING ERRCODE='23514';
  END IF;
  SELECT COALESCE(sum(ll.debit_amount-ll.credit_amount),0)::numeric(20,4) INTO book_balance
  FROM ledger_line ll JOIN journal_line jl
    ON jl.tenant_id=ll.tenant_id AND jl.entity_id=ll.entity_id
      AND jl.journal_entry_id=ll.journal_entry_id AND jl.journal_line_id=ll.journal_line_id
  JOIN journal_entry je ON je.tenant_id=ll.tenant_id AND je.entity_id=ll.entity_id AND je.journal_entry_id=ll.journal_entry_id
  WHERE ll.tenant_id=p_tenant AND ll.entity_id=p_entity AND jl.member_ref=p_bank_account_ref
    AND je.status='POSTED' AND je.currency=statement_currency AND je.journal_date<=p_statement_ending_date;

  INSERT INTO reconciliation(reconciliation_id,tenant_id,entity_id,bank_account_ref,statement_ending_date,
    statement_opening_balance,statement_ending_balance,book_ending_balance,currency,difference,status,started_by,started_at)
  VALUES(reconciliation_id,p_tenant,p_entity,p_bank_account_ref,p_statement_ending_date,
    p_statement_opening_balance,p_statement_ending_balance,book_balance,statement_currency,
    p_statement_ending_balance-book_balance,'DRAFT',actor,clock_timestamp());
  response:=jsonb_build_object('reconciliation_id',reconciliation_id,'bank_account_ref',p_bank_account_ref,
    'statement_ending_date',p_statement_ending_date,'statement_opening_balance',p_statement_opening_balance,
    'statement_ending_balance',p_statement_ending_balance,'book_ending_balance',book_balance,'currency',statement_currency,
    'difference',p_statement_ending_balance-book_balance,'status','DRAFT','revision',0,'idempotent',false);
  INSERT INTO audit_event(tenant_id,entity_id,event_type,object_type,object_id,action,actor_id,actor_type,permission_used,
    request_id,correlation_id,idempotency_key,after_hash,reason)
  VALUES(p_tenant,p_entity,'RECONCILIATION_STARTED','RECONCILIATION',reconciliation_id,'START_RECONCILIATION',actor,'USER',
    'BANK.RECONCILIATION.START',p_idempotency_key,p_idempotency_key,p_idempotency_key,refs_jsonb_hash(response),btrim(p_reason));
  event_payload:=response-'idempotent';
  INSERT INTO outbox_event(tenant_id,entity_id,aggregate_type,aggregate_id,event_type,payload,payload_hash)
  VALUES(p_tenant,p_entity,'RECONCILIATION',reconciliation_id,'RECONCILIATION_STARTED',event_payload,refs_jsonb_hash(event_payload));
  UPDATE idempotency_receipt SET status='SUCCEEDED',response_status=201,response_body=response,completed_at=clock_timestamp()
    WHERE tenant_id=p_tenant AND operation_scope='RECONCILIATION_START:'||p_entity AND idempotency_key=p_idempotency_key;
  RETURN response;
END;
$$;

CREATE FUNCTION refs_reconciliation_clearance_hash(
  p_tenant uuid,p_entity uuid,p_reconciliation uuid,p_bank_source uuid,p_expected_reconciliation_version bigint,
  p_expected_bank_version bigint,p_clear boolean,p_reason text
) RETURNS text
LANGUAGE sql IMMUTABLE SET search_path=pg_catalog,public,pg_temp AS $$
  SELECT refs_jsonb_hash(jsonb_build_object('tenant_id',p_tenant,'entity_id',p_entity,'reconciliation_id',p_reconciliation,
    'bank_source_id',p_bank_source,'expected_reconciliation_version',p_expected_reconciliation_version,
    'expected_bank_version',p_expected_bank_version,'clear',p_clear,'reason',btrim(p_reason)))
$$;

CREATE FUNCTION refs_set_reconciliation_clearance(
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

CREATE FUNCTION refs_reconciliation_transition_hash(
  p_tenant uuid,p_entity uuid,p_reconciliation uuid,p_action text,p_expected_version bigint,p_reason text
) RETURNS text
LANGUAGE sql IMMUTABLE SET search_path=pg_catalog,public,pg_temp AS $$
  SELECT refs_jsonb_hash(jsonb_build_object('tenant_id',p_tenant,'entity_id',p_entity,'reconciliation_id',p_reconciliation,
    'action',upper(p_action),'expected_version',p_expected_version,'reason',btrim(p_reason)))
$$;

CREATE FUNCTION refs_transition_reconciliation(
  p_tenant uuid,p_entity uuid,p_reconciliation uuid,p_action text,p_expected_version bigint,p_reason text,
  p_idempotency_key text,p_request_hash text
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE actor text:=refs_current_actor(); receipt idempotency_receipt; rec reconciliation; action text:=upper(p_action);
DECLARE total_items bigint; cleared_items bigint; scoped_bank_items bigint; invalid_matches bigint; foreign_currency_items bigint;
DECLARE prior_date date; snapshot jsonb; snapshot_hash text; snapshot_id uuid; response jsonb; event_payload jsonb;
DECLARE latest_snapshot_reconciliation_id uuid;
DECLARE cleared_activity numeric(20,4); book_balance numeric(20,4);
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
  SELECT count(*),count(*) FILTER (WHERE i.state='CLEARED'),count(*) FILTER (WHERE i.state='CLEARED' AND (
      m.bank_match_id IS NULL OR m.status<>'ACTIVE' OR m.candidate_rule_code<>'EXACT_POSTED_PAYMENT'
      OR m.amount_delta<>0 OR NOT m.currency_match OR m.payment_occurrence_id IS NULL
      OR po.payment_occurrence_id IS NULL OR po.status<>'POSTED' OR po.posted_journal_entry_id<>m.journal_entry_id
      OR po.source_document_id IS DISTINCT FROM m.business_source_document_id OR po.currency<>b.currency
      OR EXISTS(SELECT 1 FROM business_adjustment ba WHERE ba.tenant_id=po.tenant_id AND ba.entity_id=po.entity_id
        AND ba.source_occurrence_id=po.payment_occurrence_id
        AND ba.adjustment_kind IN ('AP_PAYMENT_REVERSAL','AR_RECEIPT_REVERSAL') AND ba.status<>'REJECTED')
      OR je.status<>'POSTED' OR je.currency<>b.currency OR jl.member_ref<>b.bank_account_ref
      OR NOT ((b.amount<0 AND jl.credit_amount=-b.amount AND jl.debit_amount=0)
        OR (b.amount>0 AND jl.debit_amount=b.amount AND jl.credit_amount=0))
      OR ll.ledger_line_id IS NULL OR ll.debit_amount<>jl.debit_amount OR ll.credit_amount<>jl.credit_amount
      OR NOT EXISTS(SELECT 1 FROM source_link sl WHERE sl.tenant_id=m.tenant_id AND sl.entity_id=m.entity_id
        AND sl.link_type='POSTED_PAYMENT_BANK_MATCH' AND sl.bank_source_id=m.bank_source_id AND sl.bank_match_id=m.bank_match_id
        AND sl.source_document_id IS NOT DISTINCT FROM po.source_document_id AND sl.journal_entry_id=m.journal_entry_id
        AND sl.journal_line_id=m.journal_line_id AND sl.ledger_line_id=m.ledger_line_id)
    ))
    INTO total_items,cleared_items,invalid_matches
  FROM reconciliation_item i JOIN bank_source b
    ON b.tenant_id=i.tenant_id AND b.entity_id=i.entity_id AND b.bank_source_id=i.bank_source_id
  LEFT JOIN bank_match m
    ON m.tenant_id=i.tenant_id AND m.entity_id=i.entity_id AND m.bank_match_id=i.bank_match_id
  LEFT JOIN payment_occurrence po ON po.tenant_id=m.tenant_id AND po.entity_id=m.entity_id
    AND po.payment_occurrence_id=m.payment_occurrence_id
  LEFT JOIN journal_entry je ON je.tenant_id=m.tenant_id AND je.entity_id=m.entity_id AND je.journal_entry_id=m.journal_entry_id
  LEFT JOIN journal_line jl ON jl.tenant_id=m.tenant_id AND jl.entity_id=m.entity_id
    AND jl.journal_entry_id=m.journal_entry_id AND jl.journal_line_id=m.journal_line_id
  LEFT JOIN ledger_line ll ON ll.tenant_id=m.tenant_id AND ll.entity_id=m.entity_id
    AND ll.journal_entry_id=m.journal_entry_id AND ll.journal_line_id=m.journal_line_id AND ll.ledger_line_id=m.ledger_line_id
  WHERE i.tenant_id=p_tenant AND i.entity_id=p_entity AND i.reconciliation_id=p_reconciliation;
  SELECT max(statement_ending_date) INTO prior_date FROM reconciliation
    WHERE tenant_id=p_tenant AND entity_id=p_entity AND bank_account_ref=rec.bank_account_ref
      AND status='RECONCILED' AND statement_ending_date<rec.statement_ending_date;
  SELECT count(*),count(*) FILTER (WHERE currency<>rec.currency) INTO scoped_bank_items,foreign_currency_items FROM bank_source
    WHERE tenant_id=p_tenant AND entity_id=p_entity AND bank_account_ref=rec.bank_account_ref
      AND transaction_date<=rec.statement_ending_date AND (prior_date IS NULL OR transaction_date>prior_date);
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
  IF action='REVIEW' THEN
    IF rec.status NOT IN ('DRAFT','REOPENED') THEN RAISE EXCEPTION 'Only Draft or Reopened reconciliation can enter review' USING ERRCODE='23514'; END IF;
    IF rec.statement_ending_balance<>book_balance OR rec.statement_ending_balance<>rec.statement_opening_balance+cleared_activity
       OR scoped_bank_items=0 OR foreign_currency_items<>0 OR total_items<>scoped_bank_items OR total_items<>cleared_items OR invalid_matches<>0 THEN
      RAISE EXCEPTION 'Review requires book-to-bank tie, statement activity tie, one currency, and exact posted-match evidence' USING ERRCODE='23514';
    END IF;
    UPDATE reconciliation SET status='IN_REVIEW',book_ending_balance=book_balance,difference=statement_ending_balance-book_balance,
      reviewed_by=actor,reviewed_at=clock_timestamp(),review_reason=btrim(p_reason),version=version+1
      WHERE tenant_id=p_tenant AND entity_id=p_entity AND reconciliation_id=p_reconciliation RETURNING * INTO rec;
  ELSIF action='SIGN_OFF' THEN
    IF rec.status<>'IN_REVIEW' OR rec.statement_ending_balance<>book_balance
       OR rec.statement_ending_balance<>rec.statement_opening_balance+cleared_activity
       OR scoped_bank_items=0 OR foreign_currency_items<>0 OR total_items<>scoped_bank_items OR total_items<>cleared_items OR invalid_matches<>0 THEN
      RAISE EXCEPTION 'Sign-off requires reviewed book-to-bank tie and exact posted-match evidence' USING ERRCODE='23514';
    END IF;
    IF rec.reviewed_by=actor THEN RAISE EXCEPTION 'Reviewer cannot sign off the same reconciliation' USING ERRCODE='42501'; END IF;
    UPDATE reconciliation SET status='RECONCILED',book_ending_balance=book_balance,difference=statement_ending_balance-book_balance,
      reconciled_by=actor,reconciled_at=clock_timestamp(),version=version+1
      WHERE tenant_id=p_tenant AND entity_id=p_entity AND reconciliation_id=p_reconciliation RETURNING * INTO rec;
    SELECT jsonb_build_object('reconciliation',to_jsonb(rec),'items',COALESCE(jsonb_agg(to_jsonb(i) ORDER BY i.bank_source_id),'[]'::jsonb))
      INTO snapshot FROM reconciliation_item i
      WHERE i.tenant_id=p_tenant AND i.entity_id=p_entity AND i.reconciliation_id=p_reconciliation;
    snapshot_hash:=refs_jsonb_hash(snapshot);snapshot_id:=gen_random_uuid();
    INSERT INTO reconciliation_snapshot(reconciliation_snapshot_id,tenant_id,entity_id,reconciliation_id,reconciliation_version,
      statement_ending_date,snapshot_body,snapshot_hash,signed_off_by)
    VALUES(snapshot_id,p_tenant,p_entity,p_reconciliation,rec.version,rec.statement_ending_date,snapshot,snapshot_hash,actor);
  ELSE
    IF rec.status<>'RECONCILED' THEN RAISE EXCEPTION 'Only a signed-off reconciliation can be reopened' USING ERRCODE='23514'; END IF;
    IF rec.reconciled_by=actor THEN RAISE EXCEPTION 'Signer cannot reopen the same reconciliation' USING ERRCODE='42501'; END IF;
    SELECT s.reconciliation_id INTO latest_snapshot_reconciliation_id
    FROM reconciliation_snapshot s JOIN reconciliation signed
      ON signed.tenant_id=s.tenant_id AND signed.entity_id=s.entity_id AND signed.reconciliation_id=s.reconciliation_id
    WHERE s.tenant_id=p_tenant AND s.entity_id=p_entity AND signed.bank_account_ref=rec.bank_account_ref
    ORDER BY s.statement_ending_date DESC,s.signed_off_at DESC,s.reconciliation_version DESC LIMIT 1 FOR SHARE OF signed;
    IF latest_snapshot_reconciliation_id IS DISTINCT FROM rec.reconciliation_id THEN
      RAISE EXCEPTION 'A reconciliation can be reopened only from the latest signed-off statement' USING ERRCODE='23514';
    END IF;
    IF EXISTS(SELECT 1 FROM reconciliation opened WHERE opened.tenant_id=p_tenant AND opened.entity_id=p_entity
      AND opened.bank_account_ref=rec.bank_account_ref AND opened.reconciliation_id<>rec.reconciliation_id
      AND opened.status IN ('DRAFT','IN_REVIEW','REOPENED')) THEN
      RAISE EXCEPTION 'A signed statement cannot be reopened while another reconciliation is open' USING ERRCODE='23514';
    END IF;
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

REVOKE ALL ON TABLE reconciliation_item,reconciliation_snapshot FROM PUBLIC;
REVOKE ALL ON FUNCTION refs_block_signed_reconciliation_match_change() FROM PUBLIC;
REVOKE ALL ON FUNCTION refs_reconciliation_start_hash(uuid,uuid,text,date,numeric,numeric,text) FROM PUBLIC;
REVOKE ALL ON FUNCTION refs_start_reconciliation(uuid,uuid,text,date,numeric,numeric,text,text,text) FROM PUBLIC;
REVOKE ALL ON FUNCTION refs_reconciliation_clearance_hash(uuid,uuid,uuid,uuid,bigint,bigint,boolean,text) FROM PUBLIC;
REVOKE ALL ON FUNCTION refs_set_reconciliation_clearance(uuid,uuid,uuid,uuid,bigint,bigint,boolean,text,text,text) FROM PUBLIC;
REVOKE ALL ON FUNCTION refs_reconciliation_transition_hash(uuid,uuid,uuid,text,bigint,text) FROM PUBLIC;
REVOKE ALL ON FUNCTION refs_transition_reconciliation(uuid,uuid,uuid,text,bigint,text,text,text) FROM PUBLIC;
GRANT SELECT ON TABLE reconciliation_item,reconciliation_snapshot TO refs_app;
GRANT EXECUTE ON FUNCTION refs_reconciliation_start_hash(uuid,uuid,text,date,numeric,numeric,text) TO refs_app;
GRANT EXECUTE ON FUNCTION refs_start_reconciliation(uuid,uuid,text,date,numeric,numeric,text,text,text) TO refs_app;
GRANT EXECUTE ON FUNCTION refs_reconciliation_clearance_hash(uuid,uuid,uuid,uuid,bigint,bigint,boolean,text) TO refs_app;
GRANT EXECUTE ON FUNCTION refs_set_reconciliation_clearance(uuid,uuid,uuid,uuid,bigint,bigint,boolean,text,text,text) TO refs_app;
GRANT EXECUTE ON FUNCTION refs_reconciliation_transition_hash(uuid,uuid,uuid,text,bigint,text) TO refs_app;
GRANT EXECUTE ON FUNCTION refs_transition_reconciliation(uuid,uuid,uuid,text,bigint,text,text,text) TO refs_app;

COMMIT;
