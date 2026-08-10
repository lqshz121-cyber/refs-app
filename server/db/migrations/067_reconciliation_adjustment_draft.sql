BEGIN;

INSERT INTO permission_catalog(permission_code,domain,risk_class,sod_class)
VALUES ('BANK.RECONCILIATION.ADJUSTMENT_DRAFT','BANK','HIGH','BANK_RECONCILIATION_MAKER')
ON CONFLICT (permission_code) DO UPDATE
  SET active=true,domain=EXCLUDED.domain,risk_class=EXCLUDED.risk_class,sod_class=EXCLUDED.sod_class,
      version=permission_catalog.version+1,effective_to=NULL;

CREATE TABLE reconciliation_adjustment_draft (
  reconciliation_adjustment_draft_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  entity_id uuid NOT NULL,
  reconciliation_id uuid NOT NULL,
  bank_source_id uuid NOT NULL,
  journal_entry_id uuid NOT NULL,
  reconciliation_version bigint NOT NULL CHECK (reconciliation_version>=0),
  bank_delta numeric(20,4) NOT NULL CHECK (bank_delta<>0),
  reason text NOT NULL CHECK (length(btrim(reason)) BETWEEN 8 AND 2000),
  created_by text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE (tenant_id,entity_id,reconciliation_id,journal_entry_id),
  UNIQUE (tenant_id,entity_id,reconciliation_id,bank_source_id),
  UNIQUE (tenant_id,entity_id,reconciliation_adjustment_draft_id),
  FOREIGN KEY (tenant_id,entity_id,reconciliation_id) REFERENCES reconciliation(tenant_id,entity_id,reconciliation_id),
  FOREIGN KEY (tenant_id,entity_id,bank_source_id) REFERENCES bank_source(tenant_id,entity_id,bank_source_id),
  FOREIGN KEY (tenant_id,entity_id,journal_entry_id) REFERENCES journal_entry(tenant_id,entity_id,journal_entry_id)
);

CREATE INDEX reconciliation_adjustment_draft_scope_idx
  ON reconciliation_adjustment_draft(tenant_id,entity_id,reconciliation_id,bank_source_id,journal_entry_id);

ALTER TABLE reconciliation_adjustment_draft ENABLE ROW LEVEL SECURITY;
CREATE POLICY reconciliation_adjustment_draft_scope_policy ON reconciliation_adjustment_draft
  USING (tenant_id=refs_current_tenant() AND refs_entity_allowed(entity_id))
  WITH CHECK (tenant_id=refs_current_tenant() AND refs_entity_allowed(entity_id));

CREATE FUNCTION refs_reconciliation_adjustment_draft_hash(
  p_tenant uuid,p_entity uuid,p_reconciliation uuid,p_bank_source uuid,p_expected_reconciliation_version bigint,
  p_period uuid,p_journal_number text,p_journal_date date,p_currency char(3),p_description text,
  p_lines jsonb,p_attachment_ids uuid[],p_reason text
) RETURNS text
LANGUAGE sql IMMUTABLE SET search_path=pg_catalog,public,pg_temp AS $$
  SELECT refs_jsonb_hash(jsonb_build_object(
    'tenant_id',p_tenant,'entity_id',p_entity,'reconciliation_id',p_reconciliation,'bank_source_id',p_bank_source,
    'expected_reconciliation_version',p_expected_reconciliation_version,'period_id',p_period,
    'journal_number',btrim(p_journal_number),'journal_date',p_journal_date,'currency',upper(p_currency),
    'description',p_description,'lines',p_lines,
    'attachment_ids',to_jsonb(ARRAY(SELECT value FROM unnest(COALESCE(p_attachment_ids,'{}'::uuid[])) value ORDER BY value)),
    'reason',btrim(p_reason)
  ))
$$;

CREATE FUNCTION refs_create_reconciliation_adjustment_draft(
  p_tenant uuid,p_entity uuid,p_reconciliation uuid,p_bank_source uuid,p_expected_reconciliation_version bigint,
  p_period uuid,p_journal_number text,p_journal_date date,p_currency char(3),p_description text,
  p_lines jsonb,p_attachment_ids uuid[],p_reason text,p_idempotency_key text,p_request_hash text
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE actor text:=refs_current_actor(); receipt idempotency_receipt; rec reconciliation; bank bank_source; journal_id uuid:=gen_random_uuid();
DECLARE prior_date date; line_count integer; bank_line_count integer; bank_delta numeric(20,4); response jsonb; event_payload jsonb;
BEGIN
  PERFORM refs_assert_scope(p_tenant,p_entity,'BANK.RECONCILIATION.ADJUSTMENT_DRAFT');
  PERFORM refs_assert_scope(p_tenant,p_entity,'GL.JE.CREATE');
  IF actor IS NULL THEN RAISE EXCEPTION 'Authenticated actor missing' USING ERRCODE='42501'; END IF;
  IF p_request_hash<>refs_reconciliation_adjustment_draft_hash(
    p_tenant,p_entity,p_reconciliation,p_bank_source,p_expected_reconciliation_version,p_period,p_journal_number,p_journal_date,
    p_currency,p_description,p_lines,p_attachment_ids,p_reason
  ) THEN RAISE EXCEPTION 'Reconciliation adjustment request hash is not canonical' USING ERRCODE='22023'; END IF;
  IF p_expected_reconciliation_version IS NULL OR p_expected_reconciliation_version<0
     OR COALESCE(length(btrim(p_journal_number)),0)=0 OR length(p_journal_number)>128
     OR p_journal_date IS NULL OR p_currency !~ '^[A-Z]{3}$'
     OR jsonb_typeof(p_lines)<>'array' OR jsonb_array_length(p_lines)<2
     OR COALESCE(length(btrim(p_reason)),0) NOT BETWEEN 8 AND 2000 THEN
    RAISE EXCEPTION 'Reconciliation adjustment requires canonical Draft journal evidence and review reason' USING ERRCODE='22023';
  END IF;

  INSERT INTO idempotency_receipt(tenant_id,operation_scope,idempotency_key,request_hash,status,actor_id)
    VALUES(p_tenant,'RECONCILIATION_ADJUSTMENT_DRAFT:'||p_entity,p_idempotency_key,p_request_hash,'IN_PROGRESS',actor)
  ON CONFLICT (tenant_id,operation_scope,idempotency_key) DO NOTHING;
  SELECT * INTO receipt FROM idempotency_receipt WHERE tenant_id=p_tenant
    AND operation_scope='RECONCILIATION_ADJUSTMENT_DRAFT:'||p_entity AND idempotency_key=p_idempotency_key FOR UPDATE;
  IF receipt.request_hash<>p_request_hash THEN RAISE EXCEPTION 'Idempotency key reused with a different request' USING ERRCODE='23505'; END IF;
  IF receipt.status='SUCCEEDED' THEN RETURN receipt.response_body||jsonb_build_object('idempotent',true); END IF;

  SELECT * INTO rec FROM reconciliation
  WHERE tenant_id=p_tenant AND entity_id=p_entity AND reconciliation_id=p_reconciliation FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Reconciliation was not found in the selected entity' USING ERRCODE='P0002'; END IF;
  IF rec.version<>p_expected_reconciliation_version THEN RAISE EXCEPTION 'Reconciliation version conflict' USING ERRCODE='40001'; END IF;
  IF rec.status NOT IN ('DRAFT','REOPENED') THEN RAISE EXCEPTION 'Only Draft or Reopened reconciliation can receive an adjustment Draft' USING ERRCODE='23514'; END IF;
  IF rec.currency<>p_currency THEN RAISE EXCEPTION 'Adjustment currency must match the reconciliation currency' USING ERRCODE='23514'; END IF;
  IF rec.difference=0 THEN RAISE EXCEPTION 'A tied reconciliation cannot create an adjustment Draft' USING ERRCODE='23514'; END IF;
  SELECT * INTO bank FROM bank_source
  WHERE tenant_id=p_tenant AND entity_id=p_entity AND bank_source_id=p_bank_source FOR SHARE;
  IF NOT FOUND OR bank.bank_account_ref<>rec.bank_account_ref OR bank.currency<>rec.currency
     OR bank.transaction_date>rec.statement_ending_date OR bank.amount<>rec.difference THEN
    RAISE EXCEPTION 'Adjustment must bind the exact unresolved statement bank source and difference' USING ERRCODE='23514';
  END IF;
  IF EXISTS(SELECT 1 FROM reconciliation_item item WHERE item.tenant_id=p_tenant AND item.entity_id=p_entity
      AND item.reconciliation_id=p_reconciliation AND item.bank_source_id=p_bank_source AND item.state='CLEARED')
     OR EXISTS(SELECT 1 FROM bank_match match_row WHERE match_row.tenant_id=p_tenant AND match_row.entity_id=p_entity
      AND match_row.bank_source_id=p_bank_source AND match_row.status='ACTIVE')
     OR EXISTS(SELECT 1 FROM reconciliation_adjustment_draft prior WHERE prior.tenant_id=p_tenant AND prior.entity_id=p_entity
      AND prior.reconciliation_id=p_reconciliation AND prior.bank_source_id=p_bank_source) THEN
    RAISE EXCEPTION 'Statement bank source already has reconciliation treatment' USING ERRCODE='23514';
  END IF;

  SELECT max(statement_ending_date) INTO prior_date FROM reconciliation
  WHERE tenant_id=p_tenant AND entity_id=p_entity AND bank_account_ref=rec.bank_account_ref
    AND status='RECONCILED' AND statement_ending_date<rec.statement_ending_date;
  IF p_journal_date>rec.statement_ending_date OR (prior_date IS NOT NULL AND p_journal_date<=prior_date) THEN
    RAISE EXCEPTION 'Adjustment date must belong to the open reconciliation statement window' USING ERRCODE='23514';
  END IF;
  PERFORM 1 FROM accounting_period WHERE tenant_id=p_tenant AND entity_id=p_entity AND period_id=p_period
    AND status='OPEN' AND p_journal_date BETWEEN starts_on AND ends_on FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Adjustment date must belong to the selected OPEN period' USING ERRCODE='55000'; END IF;
  IF COALESCE(cardinality(p_attachment_ids),0)=0 OR COALESCE(cardinality(p_attachment_ids),0)<>(
    SELECT count(DISTINCT a.attachment_id) FROM attachment a
    WHERE a.tenant_id=p_tenant AND a.entity_id=p_entity AND a.attachment_id=ANY(p_attachment_ids)
      AND a.finalization_status='VERIFIED_CLEAN' AND a.scan_status='CLEAN'
      AND a.verified_at IS NOT NULL AND a.finalized_at IS NOT NULL
  ) THEN RAISE EXCEPTION 'Reconciliation adjustment requires tenant-owned attachment evidence' USING ERRCODE='23503'; END IF;

  SELECT count(*) INTO line_count
  FROM jsonb_to_recordset(p_lines) AS x(line_no integer,account_code text,debit_amount numeric,credit_amount numeric,member_ref text,description text,dimensions jsonb);
  IF line_count<>jsonb_array_length(p_lines) OR EXISTS (
    SELECT 1 FROM jsonb_to_recordset(p_lines) AS x(line_no integer,account_code text,debit_amount numeric,credit_amount numeric,member_ref text,description text,dimensions jsonb)
    WHERE x.line_no IS NULL OR x.line_no<=0 OR COALESCE(length(btrim(x.account_code)),0)=0
      OR COALESCE(x.debit_amount,0)<0 OR COALESCE(x.credit_amount,0)<0
      OR x.debit_amount<>round(x.debit_amount,4) OR x.credit_amount<>round(x.credit_amount,4)
      OR NOT ((COALESCE(x.debit_amount,0)>0 AND COALESCE(x.credit_amount,0)=0) OR (COALESCE(x.credit_amount,0)>0 AND COALESCE(x.debit_amount,0)=0))
      OR (x.member_ref IS NOT NULL AND (x.member_ref<>btrim(x.member_ref) OR x.member_ref='' OR length(x.member_ref)>128))
      OR (x.description IS NOT NULL AND length(x.description)>2000)
      OR (x.dimensions IS NOT NULL AND jsonb_typeof(x.dimensions)<>'object')
  ) OR EXISTS (
    SELECT 1 FROM jsonb_to_recordset(p_lines) AS x(line_no integer) GROUP BY x.line_no HAVING count(*)>1
  ) OR (SELECT COALESCE(sum(COALESCE(x.debit_amount,0)),0)<>COALESCE(sum(COALESCE(x.credit_amount,0)),0)
        FROM jsonb_to_recordset(p_lines) AS x(debit_amount numeric,credit_amount numeric)) THEN
    RAISE EXCEPTION 'Reconciliation adjustment lines must be unique, canonical and balanced' USING ERRCODE='23514';
  END IF;
  SELECT count(*),COALESCE(sum(x.debit_amount-x.credit_amount),0)::numeric(20,4)
  INTO bank_line_count,bank_delta
  FROM jsonb_to_recordset(p_lines) AS x(line_no integer,account_code text,debit_amount numeric,credit_amount numeric,member_ref text)
  WHERE x.member_ref=rec.bank_account_ref;
  IF bank_line_count<>1 OR bank_delta<>rec.difference THEN
    RAISE EXCEPTION 'Adjustment must contain exactly one bank-account line that resolves the current reconciliation difference' USING ERRCODE='23514';
  END IF;

  INSERT INTO journal_entry(journal_entry_id,tenant_id,entity_id,period_id,journal_number,journal_type,status,journal_date,currency,description,created_by)
  VALUES(journal_id,p_tenant,p_entity,p_period,btrim(p_journal_number),'MANUAL','DRAFT',p_journal_date,p_currency,p_description,actor);
  INSERT INTO journal_line(tenant_id,entity_id,period_id,journal_entry_id,line_no,account_code,debit_amount,credit_amount,member_ref,description,dimensions)
  SELECT p_tenant,p_entity,p_period,journal_id,x.line_no,btrim(x.account_code),x.debit_amount,x.credit_amount,x.member_ref,x.description,COALESCE(x.dimensions,'{}'::jsonb)
  FROM jsonb_to_recordset(p_lines) AS x(line_no integer,account_code text,debit_amount numeric,credit_amount numeric,member_ref text,description text,dimensions jsonb);
  INSERT INTO source_link(tenant_id,entity_id,link_type,journal_entry_id,attachment_id,created_by)
  SELECT p_tenant,p_entity,'JE_ATTACHMENT',journal_id,value,actor FROM unnest(p_attachment_ids) value;
  INSERT INTO source_link(tenant_id,entity_id,link_type,reconciliation_id,journal_entry_id,bank_source_id,created_by)
  VALUES(p_tenant,p_entity,'RECONCILIATION_ADJUSTMENT_DRAFT',p_reconciliation,journal_id,p_bank_source,actor);
  INSERT INTO reconciliation_adjustment_draft(tenant_id,entity_id,reconciliation_id,bank_source_id,journal_entry_id,reconciliation_version,bank_delta,reason,created_by)
  VALUES(p_tenant,p_entity,p_reconciliation,p_bank_source,journal_id,p_expected_reconciliation_version,bank_delta,btrim(p_reason),actor);
  UPDATE reconciliation SET version=version+1 WHERE tenant_id=p_tenant AND entity_id=p_entity AND reconciliation_id=p_reconciliation RETURNING * INTO rec;
  response:=jsonb_build_object('reconciliation_id',p_reconciliation,'bank_source_id',p_bank_source,'journal_entry_id',journal_id,'journal_status','DRAFT',
    'journal_revision',0,'reconciliation_revision',rec.version,'bank_delta',bank_delta,'idempotent',false);
  INSERT INTO audit_event(tenant_id,entity_id,event_type,object_type,object_id,action,actor_id,actor_type,permission_used,
    request_id,correlation_id,idempotency_key,after_hash,reason)
  VALUES(p_tenant,p_entity,'RECONCILIATION_ADJUSTMENT_DRAFT_CREATED','JOURNAL_ENTRY',journal_id,'CREATE_RECONCILIATION_ADJUSTMENT_DRAFT',
    actor,'USER','BANK.RECONCILIATION.ADJUSTMENT_DRAFT',p_idempotency_key,p_idempotency_key,p_idempotency_key,refs_jsonb_hash(response),btrim(p_reason));
  event_payload:=response-'idempotent';
  INSERT INTO outbox_event(tenant_id,entity_id,aggregate_type,aggregate_id,event_type,payload,payload_hash)
  VALUES(p_tenant,p_entity,'RECONCILIATION',p_reconciliation,'RECONCILIATION_ADJUSTMENT_DRAFT_CREATED',event_payload,refs_jsonb_hash(event_payload));
  UPDATE idempotency_receipt SET status='SUCCEEDED',response_status=201,response_body=response,completed_at=clock_timestamp()
  WHERE tenant_id=p_tenant AND operation_scope='RECONCILIATION_ADJUSTMENT_DRAFT:'||p_entity AND idempotency_key=p_idempotency_key;
  RETURN response;
END;
$$;

CREATE FUNCTION refs_reconciliation_adjustment_clearance_hash(
  p_tenant uuid,p_entity uuid,p_reconciliation uuid,p_bank_source uuid,p_expected_reconciliation_version bigint,
  p_expected_bank_version bigint,p_clear boolean,p_reason text
) RETURNS text
LANGUAGE sql IMMUTABLE SET search_path=pg_catalog,public,pg_temp AS $$
  SELECT refs_jsonb_hash(jsonb_build_object(
    'tenant_id',p_tenant,'entity_id',p_entity,'reconciliation_id',p_reconciliation,'bank_source_id',p_bank_source,
    'expected_reconciliation_version',p_expected_reconciliation_version,'expected_bank_version',p_expected_bank_version,
    'clear',p_clear,'reason',btrim(p_reason)
  ))
$$;

CREATE FUNCTION refs_set_reconciliation_adjustment_clearance(
  p_tenant uuid,p_entity uuid,p_reconciliation uuid,p_bank_source uuid,p_expected_reconciliation_version bigint,
  p_expected_bank_version bigint,p_clear boolean,p_reason text,p_idempotency_key text,p_request_hash text
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE actor text:=refs_current_actor(); receipt idempotency_receipt; rec reconciliation; bank bank_source;
DECLARE draft reconciliation_adjustment_draft; adjustment_je journal_entry; item reconciliation_item;
DECLARE bank_line_count integer; bank_delta numeric(20,4); book_balance numeric(20,4); response jsonb; event_payload jsonb;
BEGIN
  PERFORM refs_assert_scope(p_tenant,p_entity,'BANK.RECONCILIATION.CLEAR');
  IF actor IS NULL THEN RAISE EXCEPTION 'Authenticated actor missing' USING ERRCODE='42501'; END IF;
  IF p_request_hash<>refs_reconciliation_adjustment_clearance_hash(
    p_tenant,p_entity,p_reconciliation,p_bank_source,p_expected_reconciliation_version,p_expected_bank_version,p_clear,p_reason
  ) THEN RAISE EXCEPTION 'Reconciliation adjustment clearance request hash is not canonical' USING ERRCODE='22023'; END IF;
  IF p_expected_reconciliation_version IS NULL OR p_expected_reconciliation_version<0 OR p_expected_bank_version IS NULL OR p_expected_bank_version<0
     OR p_clear IS NULL OR COALESCE(length(btrim(p_reason)),0) NOT BETWEEN 8 AND 2000 THEN
    RAISE EXCEPTION 'Adjustment clearance requires revisions, explicit state and review reason' USING ERRCODE='22023';
  END IF;
  INSERT INTO idempotency_receipt(tenant_id,operation_scope,idempotency_key,request_hash,status,actor_id)
    VALUES(p_tenant,'RECONCILIATION_ADJUSTMENT_CLEARANCE:'||p_entity,p_idempotency_key,p_request_hash,'IN_PROGRESS',actor)
  ON CONFLICT (tenant_id,operation_scope,idempotency_key) DO NOTHING;
  SELECT * INTO receipt FROM idempotency_receipt WHERE tenant_id=p_tenant
    AND operation_scope='RECONCILIATION_ADJUSTMENT_CLEARANCE:'||p_entity AND idempotency_key=p_idempotency_key FOR UPDATE;
  IF receipt.request_hash<>p_request_hash THEN RAISE EXCEPTION 'Idempotency key reused with a different request' USING ERRCODE='23505'; END IF;
  IF receipt.status='SUCCEEDED' THEN RETURN receipt.response_body||jsonb_build_object('idempotent',true); END IF;
  SELECT * INTO rec FROM reconciliation WHERE tenant_id=p_tenant AND entity_id=p_entity AND reconciliation_id=p_reconciliation FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Reconciliation was not found in the selected entity' USING ERRCODE='P0002'; END IF;
  IF rec.version<>p_expected_reconciliation_version THEN RAISE EXCEPTION 'Reconciliation version conflict' USING ERRCODE='40001'; END IF;
  IF rec.status NOT IN ('DRAFT','REOPENED') THEN RAISE EXCEPTION 'Signed-off reconciliation items are immutable' USING ERRCODE='23514'; END IF;
  SELECT * INTO bank FROM bank_source WHERE tenant_id=p_tenant AND entity_id=p_entity AND bank_source_id=p_bank_source FOR UPDATE;
  IF NOT FOUND OR bank.version<>p_expected_bank_version OR bank.bank_account_ref<>rec.bank_account_ref
     OR bank.currency<>rec.currency OR bank.transaction_date>rec.statement_ending_date THEN
    RAISE EXCEPTION 'Statement bank source is outside the exact reconciliation scope or revision' USING ERRCODE='40001';
  END IF;
  SELECT * INTO draft FROM reconciliation_adjustment_draft WHERE tenant_id=p_tenant AND entity_id=p_entity
    AND reconciliation_id=p_reconciliation AND bank_source_id=p_bank_source FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'No adjustment Draft is bound to this statement bank source' USING ERRCODE='23514'; END IF;
  SELECT * INTO adjustment_je FROM journal_entry WHERE tenant_id=p_tenant AND entity_id=p_entity AND journal_entry_id=draft.journal_entry_id FOR SHARE;
  IF adjustment_je.status<>'POSTED' OR adjustment_je.currency<>rec.currency THEN
    RAISE EXCEPTION 'Adjustment Draft must be an exact Posted Journal Entry before clearance' USING ERRCODE='23514';
  END IF;
  SELECT count(*),COALESCE(sum(debit_amount-credit_amount),0)::numeric(20,4) INTO bank_line_count,bank_delta
  FROM journal_line WHERE tenant_id=p_tenant AND entity_id=p_entity AND journal_entry_id=draft.journal_entry_id
    AND member_ref=rec.bank_account_ref;
  IF bank_line_count<>1 OR bank_delta<>bank.amount OR bank_delta<>draft.bank_delta
     OR NOT EXISTS(SELECT 1 FROM ledger_line WHERE tenant_id=p_tenant AND entity_id=p_entity
       AND journal_entry_id=draft.journal_entry_id) OR NOT EXISTS(
       SELECT 1 FROM source_link sl WHERE sl.tenant_id=p_tenant AND sl.entity_id=p_entity
         AND sl.link_type='RECONCILIATION_ADJUSTMENT_DRAFT' AND sl.reconciliation_id=p_reconciliation
         AND sl.bank_source_id=p_bank_source AND sl.journal_entry_id=draft.journal_entry_id
     ) THEN RAISE EXCEPTION 'Adjustment clearance requires immutable posted journal and exact source trace' USING ERRCODE='23514'; END IF;
  IF p_clear THEN
    INSERT INTO reconciliation_item(tenant_id,entity_id,reconciliation_id,bank_source_id,bank_match_id,state,cleared_by,reason)
    VALUES(p_tenant,p_entity,p_reconciliation,p_bank_source,NULL,'CLEARED',actor,btrim(p_reason))
    ON CONFLICT (tenant_id,entity_id,reconciliation_id,bank_source_id) DO UPDATE
      SET bank_match_id=NULL,state='CLEARED',cleared_by=actor,cleared_at=clock_timestamp(),uncleared_by=NULL,uncleared_at=NULL,
          reason=btrim(p_reason),version=reconciliation_item.version+1
    RETURNING * INTO item;
  ELSE
    UPDATE reconciliation_item SET state='UNCLEARED',uncleared_by=actor,uncleared_at=clock_timestamp(),reason=btrim(p_reason),version=version+1
    WHERE tenant_id=p_tenant AND entity_id=p_entity AND reconciliation_id=p_reconciliation AND bank_source_id=p_bank_source
      AND bank_match_id IS NULL AND state='CLEARED' RETURNING * INTO item;
    IF NOT FOUND THEN RAISE EXCEPTION 'Only a cleared adjustment statement item can be uncleared' USING ERRCODE='23514'; END IF;
  END IF;
  SELECT COALESCE(sum(ll.debit_amount-ll.credit_amount),0)::numeric(20,4) INTO book_balance
  FROM ledger_line ll JOIN journal_line jl ON jl.tenant_id=ll.tenant_id AND jl.entity_id=ll.entity_id
    AND jl.journal_entry_id=ll.journal_entry_id AND jl.journal_line_id=ll.journal_line_id
  JOIN journal_entry posted ON posted.tenant_id=ll.tenant_id AND posted.entity_id=ll.entity_id AND posted.journal_entry_id=ll.journal_entry_id
  WHERE ll.tenant_id=p_tenant AND ll.entity_id=p_entity AND jl.member_ref=rec.bank_account_ref
    AND posted.status='POSTED' AND posted.currency=rec.currency AND posted.journal_date<=rec.statement_ending_date;
  UPDATE reconciliation SET book_ending_balance=book_balance,difference=statement_ending_balance-book_balance,version=version+1
    WHERE tenant_id=p_tenant AND entity_id=p_entity AND reconciliation_id=p_reconciliation RETURNING * INTO rec;
  response:=jsonb_build_object('reconciliation_id',p_reconciliation,'bank_source_id',p_bank_source,'journal_entry_id',draft.journal_entry_id,
    'state',item.state,'item_revision',item.version,'difference',rec.difference,'status',rec.status,'revision',rec.version,'idempotent',false);
  INSERT INTO audit_event(tenant_id,entity_id,event_type,object_type,object_id,action,actor_id,actor_type,permission_used,
    request_id,correlation_id,idempotency_key,after_hash,reason)
  VALUES(p_tenant,p_entity,CASE WHEN p_clear THEN 'RECONCILIATION_ADJUSTMENT_ITEM_CLEARED' ELSE 'RECONCILIATION_ADJUSTMENT_ITEM_UNCLEARED' END,
    'RECONCILIATION',p_reconciliation,CASE WHEN p_clear THEN 'CLEAR_ADJUSTMENT_BANK_ITEM' ELSE 'UNCLEAR_ADJUSTMENT_BANK_ITEM' END,
    actor,'USER','BANK.RECONCILIATION.CLEAR',p_idempotency_key,p_idempotency_key,p_idempotency_key,refs_jsonb_hash(response),btrim(p_reason));
  event_payload:=response-'idempotent';
  INSERT INTO outbox_event(tenant_id,entity_id,aggregate_type,aggregate_id,event_type,payload,payload_hash)
  VALUES(p_tenant,p_entity,'RECONCILIATION',p_reconciliation,
    CASE WHEN p_clear THEN 'RECONCILIATION_ADJUSTMENT_ITEM_CLEARED' ELSE 'RECONCILIATION_ADJUSTMENT_ITEM_UNCLEARED' END,event_payload,refs_jsonb_hash(event_payload));
  UPDATE idempotency_receipt SET status='SUCCEEDED',response_status=201,response_body=response,completed_at=clock_timestamp()
    WHERE tenant_id=p_tenant AND operation_scope='RECONCILIATION_ADJUSTMENT_CLEARANCE:'||p_entity AND idempotency_key=p_idempotency_key;
  RETURN response;
END;
$$;

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
  SELECT count(*),count(*) FILTER (WHERE currency<>rec.currency) INTO scoped_bank_items,foreign_currency_items FROM bank_source
    WHERE tenant_id=p_tenant AND entity_id=p_entity AND bank_account_ref=rec.bank_account_ref
      AND transaction_date<=rec.statement_ending_date AND (prior_date IS NULL OR transaction_date>prior_date);
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

CREATE FUNCTION refs_guard_reconciliation_adjustment_lifecycle() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE actor text:=refs_current_actor(); rec reconciliation; adjustment reconciliation_adjustment_draft; final_book_balance numeric(20,4);
BEGIN
  IF TG_TABLE_NAME='reconciliation' THEN
    IF NEW.status IN ('IN_REVIEW','RECONCILED') AND OLD.status IS DISTINCT FROM NEW.status AND EXISTS(
      SELECT 1 FROM reconciliation_adjustment_draft draft
      WHERE draft.tenant_id=NEW.tenant_id AND draft.entity_id=NEW.entity_id
        AND draft.reconciliation_id=NEW.reconciliation_id AND draft.created_by=actor
    ) THEN RAISE EXCEPTION 'Adjustment Draft creator cannot review or sign off the same reconciliation' USING ERRCODE='42501'; END IF;
    RETURN NEW;
  END IF;
  IF NEW.status='POSTED' AND OLD.status<>'POSTED' THEN
    SELECT * INTO adjustment FROM reconciliation_adjustment_draft draft
    WHERE draft.tenant_id=NEW.tenant_id AND draft.entity_id=NEW.entity_id AND draft.journal_entry_id=NEW.journal_entry_id;
    IF FOUND THEN
      SELECT * INTO rec FROM reconciliation r
      WHERE r.tenant_id=adjustment.tenant_id AND r.entity_id=adjustment.entity_id AND r.reconciliation_id=adjustment.reconciliation_id
      FOR UPDATE;
      IF NOT FOUND THEN RAISE EXCEPTION 'Reconciliation adjustment parent was not found' USING ERRCODE='P0002'; END IF;
      IF rec.status NOT IN ('DRAFT','REOPENED') THEN RAISE EXCEPTION 'Reconciliation adjustment cannot post after review or sign-off' USING ERRCODE='23514'; END IF;
      IF NEW.currency<>rec.currency THEN RAISE EXCEPTION 'Reconciliation adjustment currency drift detected' USING ERRCODE='23514'; END IF;
      IF (SELECT count(*) FROM journal_line WHERE tenant_id=NEW.tenant_id AND entity_id=NEW.entity_id
            AND journal_entry_id=NEW.journal_entry_id AND member_ref=rec.bank_account_ref)<>1 THEN
        RAISE EXCEPTION 'Reconciliation adjustment must retain exactly one bank-account line' USING ERRCODE='23514';
      END IF;
      IF (SELECT COALESCE(sum(debit_amount-credit_amount),0) FROM journal_line WHERE tenant_id=NEW.tenant_id AND entity_id=NEW.entity_id
            AND journal_entry_id=NEW.journal_entry_id AND member_ref=rec.bank_account_ref)<>adjustment.bank_delta THEN
        RAISE EXCEPTION 'Reconciliation adjustment bank delta drift detected' USING ERRCODE='23514';
      END IF;
      SELECT COALESCE(sum(ll.debit_amount-ll.credit_amount),0)::numeric(20,4) INTO final_book_balance
      FROM ledger_line ll JOIN journal_line jl ON jl.tenant_id=ll.tenant_id AND jl.entity_id=ll.entity_id
        AND jl.journal_entry_id=ll.journal_entry_id AND jl.journal_line_id=ll.journal_line_id
      JOIN journal_entry posted ON posted.tenant_id=ll.tenant_id AND posted.entity_id=ll.entity_id AND posted.journal_entry_id=ll.journal_entry_id
      WHERE ll.tenant_id=NEW.tenant_id AND ll.entity_id=NEW.entity_id AND jl.member_ref=rec.bank_account_ref
        AND posted.status='POSTED' AND posted.currency=rec.currency AND posted.journal_date<=rec.statement_ending_date;
      IF final_book_balance<>rec.statement_ending_balance THEN
        RAISE EXCEPTION 'Reconciliation adjustment may post only when it exactly resolves the statement difference' USING ERRCODE='23514';
      END IF;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER reconciliation_adjustment_review_sod_guard
  BEFORE UPDATE OF status ON reconciliation
  FOR EACH ROW EXECUTE FUNCTION refs_guard_reconciliation_adjustment_lifecycle();
CREATE TRIGGER reconciliation_adjustment_post_guard
  BEFORE UPDATE OF status ON journal_entry
  FOR EACH ROW EXECUTE FUNCTION refs_guard_reconciliation_adjustment_lifecycle();

REVOKE ALL ON TABLE reconciliation_adjustment_draft FROM PUBLIC;
REVOKE ALL ON FUNCTION refs_reconciliation_adjustment_draft_hash(uuid,uuid,uuid,uuid,bigint,uuid,text,date,char,text,jsonb,uuid[],text) FROM PUBLIC;
REVOKE ALL ON FUNCTION refs_create_reconciliation_adjustment_draft(uuid,uuid,uuid,uuid,bigint,uuid,text,date,char,text,jsonb,uuid[],text,text,text) FROM PUBLIC;
REVOKE ALL ON FUNCTION refs_reconciliation_adjustment_clearance_hash(uuid,uuid,uuid,uuid,bigint,bigint,boolean,text) FROM PUBLIC;
REVOKE ALL ON FUNCTION refs_set_reconciliation_adjustment_clearance(uuid,uuid,uuid,uuid,bigint,bigint,boolean,text,text,text) FROM PUBLIC;
REVOKE ALL ON FUNCTION refs_transition_reconciliation_adjustment_aware(uuid,uuid,uuid,text,bigint,text,text,text) FROM PUBLIC;
REVOKE ALL ON FUNCTION refs_guard_reconciliation_adjustment_lifecycle() FROM PUBLIC;
GRANT SELECT ON TABLE reconciliation_adjustment_draft TO refs_app;
GRANT EXECUTE ON FUNCTION refs_reconciliation_adjustment_draft_hash(uuid,uuid,uuid,uuid,bigint,uuid,text,date,char,text,jsonb,uuid[],text) TO refs_app;
GRANT EXECUTE ON FUNCTION refs_create_reconciliation_adjustment_draft(uuid,uuid,uuid,uuid,bigint,uuid,text,date,char,text,jsonb,uuid[],text,text,text) TO refs_app;
GRANT EXECUTE ON FUNCTION refs_reconciliation_adjustment_clearance_hash(uuid,uuid,uuid,uuid,bigint,bigint,boolean,text) TO refs_app;
GRANT EXECUTE ON FUNCTION refs_set_reconciliation_adjustment_clearance(uuid,uuid,uuid,uuid,bigint,bigint,boolean,text,text,text) TO refs_app;
GRANT EXECUTE ON FUNCTION refs_transition_reconciliation_adjustment_aware(uuid,uuid,uuid,text,bigint,text,text,text) TO refs_app;

COMMIT;
