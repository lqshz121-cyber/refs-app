BEGIN;

INSERT INTO permission_catalog(permission_code,domain,risk_class,sod_class)
VALUES ('BANK.MATCH.CREATE','BANK','HIGH','BANK_MATCH_MAKER'),
       ('BANK.MATCH.UNMATCH','BANK','HIGH','BANK_MATCH_REVIEWER')
ON CONFLICT (permission_code) DO UPDATE
  SET active=true,domain=EXCLUDED.domain,risk_class=EXCLUDED.risk_class,sod_class=EXCLUDED.sod_class,
      version=permission_catalog.version+1,effective_to=NULL;

ALTER TABLE bank_match
  ALTER COLUMN business_source_document_id DROP NOT NULL,
  ADD COLUMN payment_occurrence_id uuid,
  ADD COLUMN ledger_line_id uuid,
  ADD CONSTRAINT bank_match_business_evidence_ck
    CHECK (business_source_document_id IS NOT NULL OR payment_occurrence_id IS NOT NULL),
  ADD CONSTRAINT bank_match_payment_trace_ck
    CHECK (payment_occurrence_id IS NULL OR (journal_entry_id IS NOT NULL AND journal_line_id IS NOT NULL AND ledger_line_id IS NOT NULL)),
  ADD CONSTRAINT bank_match_payment_occurrence_fk
    FOREIGN KEY (tenant_id,entity_id,payment_occurrence_id)
    REFERENCES payment_occurrence(tenant_id,entity_id,payment_occurrence_id),
  ADD CONSTRAINT bank_match_ledger_line_fk
    FOREIGN KEY (tenant_id,entity_id,ledger_line_id)
    REFERENCES ledger_line(tenant_id,entity_id,ledger_line_id);
CREATE UNIQUE INDEX bank_match_one_active_payment_occurrence_uq
  ON bank_match(tenant_id,payment_occurrence_id)
  WHERE status='ACTIVE' AND payment_occurrence_id IS NOT NULL;

CREATE FUNCTION refs_block_reversal_for_active_bank_match() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
BEGIN
  IF NEW.adjustment_kind IN ('AP_PAYMENT_REVERSAL','AR_RECEIPT_REVERSAL')
     AND NEW.status<>'REJECTED'
     AND EXISTS(
       SELECT 1 FROM public.bank_match m
       WHERE m.tenant_id=NEW.tenant_id AND m.entity_id=NEW.entity_id
         AND m.payment_occurrence_id=NEW.source_occurrence_id AND m.status='ACTIVE'
     ) THEN
    RAISE EXCEPTION 'Active bank match must be explicitly unmatched before payment reversal' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION refs_block_reversal_for_active_bank_match() FROM PUBLIC;
CREATE TRIGGER business_adjustment_active_bank_match_guard
  BEFORE INSERT OR UPDATE OF status,source_occurrence_id ON business_adjustment
  FOR EACH ROW EXECUTE FUNCTION refs_block_reversal_for_active_bank_match();

CREATE FUNCTION refs_bank_match_hash(
  p_tenant uuid,p_entity uuid,p_bank_source uuid,p_payment_occurrence uuid,
  p_expected_bank_version bigint,p_expected_occurrence_version bigint,p_reason text
) RETURNS text
LANGUAGE sql IMMUTABLE SET search_path=pg_catalog,public,pg_temp AS $$
  SELECT refs_jsonb_hash(jsonb_build_object(
    'tenant_id',p_tenant,'entity_id',p_entity,'bank_source_id',p_bank_source,
    'payment_occurrence_id',p_payment_occurrence,'expected_bank_version',p_expected_bank_version,
    'expected_occurrence_version',p_expected_occurrence_version,'reason',btrim(p_reason)
  ))
$$;

CREATE FUNCTION refs_create_bank_payment_match(
  p_tenant uuid,p_entity uuid,p_bank_source uuid,p_payment_occurrence uuid,
  p_expected_bank_version bigint,p_expected_occurrence_version bigint,p_reason text,
  p_idempotency_key text,p_request_hash text
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE actor text:=refs_current_actor(); receipt idempotency_receipt;
DECLARE bank_row bank_source; occurrence payment_occurrence; payment_je journal_entry;
DECLARE payment_journal_line_id uuid; payment_ledger_id uuid; match_id uuid:=gen_random_uuid(); response jsonb; event_payload jsonb;
DECLARE expected_bank_amount numeric(20,4); date_delta integer; cash_line_count integer;
BEGIN
  PERFORM refs_assert_scope(p_tenant,p_entity,'BANK.MATCH.CREATE');
  IF actor IS NULL THEN RAISE EXCEPTION 'Authenticated actor missing' USING ERRCODE='42501'; END IF;
  IF p_request_hash<>refs_bank_match_hash(p_tenant,p_entity,p_bank_source,p_payment_occurrence,p_expected_bank_version,p_expected_occurrence_version,p_reason) THEN
    RAISE EXCEPTION 'Bank match request hash is not canonical' USING ERRCODE='22023';
  END IF;
  IF p_expected_bank_version IS NULL OR p_expected_bank_version<0 OR p_expected_occurrence_version IS NULL OR p_expected_occurrence_version<0
     OR COALESCE(length(btrim(p_reason)),0) NOT BETWEEN 8 AND 2000 THEN
    RAISE EXCEPTION 'Bank match requires expected revisions and a review reason' USING ERRCODE='22023';
  END IF;

  INSERT INTO idempotency_receipt(tenant_id,operation_scope,idempotency_key,request_hash,status,actor_id)
    VALUES(p_tenant,'BANK_PAYMENT_MATCH:'||p_entity,p_idempotency_key,p_request_hash,'IN_PROGRESS',actor)
  ON CONFLICT (tenant_id,operation_scope,idempotency_key) DO NOTHING;
  SELECT * INTO receipt FROM idempotency_receipt
    WHERE tenant_id=p_tenant AND operation_scope='BANK_PAYMENT_MATCH:'||p_entity AND idempotency_key=p_idempotency_key FOR UPDATE;
  IF receipt.request_hash<>p_request_hash THEN RAISE EXCEPTION 'Idempotency key reused with a different request' USING ERRCODE='23505'; END IF;
  IF receipt.status='SUCCEEDED' THEN RETURN receipt.response_body||jsonb_build_object('idempotent',true); END IF;

  SELECT * INTO occurrence FROM payment_occurrence
    WHERE tenant_id=p_tenant AND entity_id=p_entity AND payment_occurrence_id=p_payment_occurrence FOR UPDATE;
  IF NOT FOUND OR occurrence.status<>'POSTED' OR occurrence.posted_journal_entry_id IS NULL THEN
    RAISE EXCEPTION 'Bank match requires an authoritative POSTED payment or receipt' USING ERRCODE='23514';
  END IF;
  IF occurrence.version<>p_expected_occurrence_version THEN RAISE EXCEPTION 'Payment occurrence version conflict' USING ERRCODE='40001'; END IF;
  IF EXISTS(
    SELECT 1 FROM business_adjustment a
    WHERE a.tenant_id=p_tenant AND a.entity_id=p_entity AND a.source_occurrence_id=p_payment_occurrence
      AND a.adjustment_kind IN ('AP_PAYMENT_REVERSAL','AR_RECEIPT_REVERSAL') AND a.status<>'REJECTED'
  ) THEN RAISE EXCEPTION 'Payment with an existing reversal cannot be bank matched' USING ERRCODE='23514'; END IF;

  SELECT * INTO bank_row FROM bank_source
    WHERE tenant_id=p_tenant AND entity_id=p_entity AND bank_source_id=p_bank_source FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Bank transaction was not found in the selected entity' USING ERRCODE='P0002'; END IF;
  IF bank_row.version<>p_expected_bank_version THEN RAISE EXCEPTION 'Bank transaction version conflict' USING ERRCODE='40001'; END IF;
  PERFORM 1 FROM bank_match
    WHERE tenant_id=p_tenant AND entity_id=p_entity
      AND (bank_source_id=p_bank_source OR payment_occurrence_id=p_payment_occurrence) AND status='ACTIVE'
    ORDER BY bank_match_id FOR UPDATE;
  IF FOUND THEN RAISE EXCEPTION 'Bank transaction or payment already has an active match' USING ERRCODE='23505'; END IF;

  expected_bank_amount:=CASE occurrence.occurrence_kind WHEN 'AP_PAYMENT' THEN -occurrence.amount WHEN 'AR_RECEIPT' THEN occurrence.amount ELSE NULL END;
  IF expected_bank_amount IS NULL OR bank_row.currency<>occurrence.currency OR bank_row.amount<>expected_bank_amount THEN
    RAISE EXCEPTION 'Bank transaction direction, currency and amount must exactly match the posted occurrence' USING ERRCODE='23514';
  END IF;
  date_delta:=bank_row.transaction_date-occurrence.accounting_date;
  IF abs(date_delta)>31 THEN RAISE EXCEPTION 'Bank transaction date is outside the permitted review window' USING ERRCODE='23514'; END IF;

  SELECT * INTO payment_je FROM journal_entry
    WHERE tenant_id=p_tenant AND entity_id=p_entity AND journal_entry_id=occurrence.posted_journal_entry_id AND status='POSTED' FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Posted payment Journal Entry evidence is missing' USING ERRCODE='23514'; END IF;
  SELECT count(*) INTO cash_line_count
  FROM journal_line jl
  JOIN ledger_line ll ON ll.tenant_id=jl.tenant_id AND ll.entity_id=jl.entity_id
    AND ll.journal_entry_id=jl.journal_entry_id AND ll.journal_line_id=jl.journal_line_id
  WHERE jl.tenant_id=p_tenant AND jl.entity_id=p_entity AND jl.journal_entry_id=payment_je.journal_entry_id
    AND jl.member_ref=bank_row.bank_account_ref
    AND ((occurrence.occurrence_kind='AP_PAYMENT' AND jl.credit_amount=occurrence.amount AND jl.debit_amount=0)
      OR (occurrence.occurrence_kind='AR_RECEIPT' AND jl.debit_amount=occurrence.amount AND jl.credit_amount=0));
  IF cash_line_count<>1 THEN RAISE EXCEPTION 'Exactly one posted cash ledger line must match the bank account and occurrence' USING ERRCODE='23514'; END IF;
  SELECT jl.journal_line_id,ll.ledger_line_id INTO payment_journal_line_id,payment_ledger_id
  FROM journal_line jl
  JOIN ledger_line ll ON ll.tenant_id=jl.tenant_id AND ll.entity_id=jl.entity_id
    AND ll.journal_entry_id=jl.journal_entry_id AND ll.journal_line_id=jl.journal_line_id
  WHERE jl.tenant_id=p_tenant AND jl.entity_id=p_entity AND jl.journal_entry_id=payment_je.journal_entry_id
    AND jl.member_ref=bank_row.bank_account_ref
    AND ((occurrence.occurrence_kind='AP_PAYMENT' AND jl.credit_amount=occurrence.amount AND jl.debit_amount=0)
      OR (occurrence.occurrence_kind='AR_RECEIPT' AND jl.debit_amount=occurrence.amount AND jl.credit_amount=0))
  FOR SHARE;

  INSERT INTO bank_match(bank_match_id,tenant_id,entity_id,bank_source_id,business_source_document_id,payment_occurrence_id,
    journal_entry_id,journal_line_id,ledger_line_id,candidate_rule_code,amount_delta,currency_match,date_delta_days,status,matched_by)
  VALUES(match_id,p_tenant,p_entity,p_bank_source,occurrence.source_document_id,p_payment_occurrence,
    payment_je.journal_entry_id,payment_journal_line_id,payment_ledger_id,'EXACT_POSTED_PAYMENT',
    bank_row.amount-expected_bank_amount,true,date_delta,'ACTIVE',actor);
  INSERT INTO source_link(tenant_id,entity_id,link_type,source_document_id,journal_entry_id,journal_line_id,ledger_line_id,bank_source_id,bank_match_id,created_by)
  VALUES(p_tenant,p_entity,'POSTED_PAYMENT_BANK_MATCH',occurrence.source_document_id,payment_je.journal_entry_id,
    payment_journal_line_id,payment_ledger_id,p_bank_source,match_id,actor);

  response:=jsonb_build_object('bank_match_id',match_id,'bank_source_id',p_bank_source,'payment_occurrence_id',p_payment_occurrence,
    'source_document_id',occurrence.source_document_id,'journal_entry_id',payment_je.journal_entry_id,'journal_line_id',payment_journal_line_id,
    'ledger_line_id',payment_ledger_id,
    'status','ACTIVE','revision',0,'idempotent',false);
  INSERT INTO audit_event(tenant_id,entity_id,event_type,object_type,object_id,action,actor_id,actor_type,permission_used,
    request_id,correlation_id,idempotency_key,before_hash,after_hash,reason)
  VALUES(p_tenant,p_entity,'BANK_PAYMENT_MATCH_CREATED','BANK_MATCH',match_id,'CREATE_BANK_PAYMENT_MATCH',actor,'USER','BANK.MATCH.CREATE',
    p_idempotency_key,p_idempotency_key,p_idempotency_key,refs_jsonb_hash(to_jsonb(bank_row)),refs_jsonb_hash(response),btrim(p_reason));
  event_payload:=response-'idempotent';
  INSERT INTO outbox_event(tenant_id,entity_id,aggregate_type,aggregate_id,event_type,payload,payload_hash)
  VALUES(p_tenant,p_entity,'BANK_MATCH',match_id,'BANK_PAYMENT_MATCH_CREATED',event_payload,refs_jsonb_hash(event_payload));
  UPDATE idempotency_receipt SET status='SUCCEEDED',response_status=201,response_body=response,completed_at=clock_timestamp()
    WHERE tenant_id=p_tenant AND operation_scope='BANK_PAYMENT_MATCH:'||p_entity AND idempotency_key=p_idempotency_key;
  RETURN response;
END;
$$;

CREATE FUNCTION refs_bank_unmatch_hash(
  p_tenant uuid,p_entity uuid,p_bank_source uuid,p_bank_match uuid,
  p_expected_match_version bigint,p_reason text
) RETURNS text
LANGUAGE sql IMMUTABLE SET search_path=pg_catalog,public,pg_temp AS $$
  SELECT refs_jsonb_hash(jsonb_build_object(
    'tenant_id',p_tenant,'entity_id',p_entity,'bank_source_id',p_bank_source,
    'bank_match_id',p_bank_match,'expected_match_version',p_expected_match_version,'reason',btrim(p_reason)
  ))
$$;

CREATE FUNCTION refs_unmatch_bank_payment(
  p_tenant uuid,p_entity uuid,p_bank_source uuid,p_bank_match uuid,
  p_expected_match_version bigint,p_reason text,p_idempotency_key text,p_request_hash text
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE actor text:=refs_current_actor(); receipt idempotency_receipt; match_row bank_match;
DECLARE response jsonb; event_payload jsonb; prior_match_hash text;
BEGIN
  PERFORM refs_assert_scope(p_tenant,p_entity,'BANK.MATCH.UNMATCH');
  IF actor IS NULL THEN RAISE EXCEPTION 'Authenticated actor missing' USING ERRCODE='42501'; END IF;
  IF p_request_hash<>refs_bank_unmatch_hash(p_tenant,p_entity,p_bank_source,p_bank_match,p_expected_match_version,p_reason) THEN
    RAISE EXCEPTION 'Bank unmatch request hash is not canonical' USING ERRCODE='22023';
  END IF;
  IF p_expected_match_version IS NULL OR p_expected_match_version<0
     OR COALESCE(length(btrim(p_reason)),0) NOT BETWEEN 8 AND 2000 THEN
    RAISE EXCEPTION 'Bank unmatch requires an expected revision and a review reason of 8-2000 characters' USING ERRCODE='22023';
  END IF;

  INSERT INTO idempotency_receipt(tenant_id,operation_scope,idempotency_key,request_hash,status,actor_id)
    VALUES(p_tenant,'BANK_PAYMENT_UNMATCH:'||p_entity,p_idempotency_key,p_request_hash,'IN_PROGRESS',actor)
  ON CONFLICT (tenant_id,operation_scope,idempotency_key) DO NOTHING;
  SELECT * INTO receipt FROM idempotency_receipt
    WHERE tenant_id=p_tenant AND operation_scope='BANK_PAYMENT_UNMATCH:'||p_entity AND idempotency_key=p_idempotency_key FOR UPDATE;
  IF receipt.request_hash<>p_request_hash THEN RAISE EXCEPTION 'Idempotency key reused with a different request' USING ERRCODE='23505'; END IF;
  IF receipt.status='SUCCEEDED' THEN RETURN receipt.response_body||jsonb_build_object('idempotent',true); END IF;

  SELECT * INTO match_row FROM bank_match
    WHERE tenant_id=p_tenant AND entity_id=p_entity AND bank_source_id=p_bank_source AND bank_match_id=p_bank_match FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Active bank match was not found in the selected entity and bank transaction' USING ERRCODE='P0002'; END IF;
  IF match_row.version<>p_expected_match_version THEN RAISE EXCEPTION 'Bank match version conflict' USING ERRCODE='40001'; END IF;
  IF match_row.status<>'ACTIVE' THEN RAISE EXCEPTION 'Only an ACTIVE bank match can be unmatched' USING ERRCODE='23514'; END IF;
  prior_match_hash:=refs_jsonb_hash(to_jsonb(match_row));

  UPDATE bank_match SET status='UNMATCHED',unmatched_by=actor,unmatched_at=clock_timestamp(),version=version+1
    WHERE tenant_id=p_tenant AND entity_id=p_entity AND bank_match_id=p_bank_match
    RETURNING * INTO match_row;
  response:=jsonb_build_object('bank_match_id',match_row.bank_match_id,'bank_source_id',match_row.bank_source_id,
    'payment_occurrence_id',match_row.payment_occurrence_id,'source_document_id',match_row.business_source_document_id,
    'journal_entry_id',match_row.journal_entry_id,'journal_line_id',match_row.journal_line_id,'ledger_line_id',match_row.ledger_line_id,
    'status',match_row.status,'revision',match_row.version,'idempotent',false);
  INSERT INTO audit_event(tenant_id,entity_id,event_type,object_type,object_id,action,actor_id,actor_type,permission_used,
    request_id,correlation_id,idempotency_key,before_hash,after_hash,reason)
  VALUES(p_tenant,p_entity,'BANK_PAYMENT_MATCH_UNMATCHED','BANK_MATCH',p_bank_match,'UNMATCH_BANK_PAYMENT',actor,'USER','BANK.MATCH.UNMATCH',
    p_idempotency_key,p_idempotency_key,p_idempotency_key,prior_match_hash,refs_jsonb_hash(response),btrim(p_reason));
  event_payload:=response-'idempotent';
  INSERT INTO outbox_event(tenant_id,entity_id,aggregate_type,aggregate_id,event_type,payload,payload_hash)
  VALUES(p_tenant,p_entity,'BANK_MATCH',p_bank_match,'BANK_PAYMENT_MATCH_UNMATCHED',event_payload,refs_jsonb_hash(event_payload));
  UPDATE idempotency_receipt SET status='SUCCEEDED',response_status=201,response_body=response,completed_at=clock_timestamp()
    WHERE tenant_id=p_tenant AND operation_scope='BANK_PAYMENT_UNMATCH:'||p_entity AND idempotency_key=p_idempotency_key;
  RETURN response;
END;
$$;

REVOKE ALL ON FUNCTION refs_bank_match_hash(uuid,uuid,uuid,uuid,bigint,bigint,text) FROM PUBLIC;
REVOKE ALL ON FUNCTION refs_create_bank_payment_match(uuid,uuid,uuid,uuid,bigint,bigint,text,text,text) FROM PUBLIC;
REVOKE ALL ON FUNCTION refs_bank_unmatch_hash(uuid,uuid,uuid,uuid,bigint,text) FROM PUBLIC;
REVOKE ALL ON FUNCTION refs_unmatch_bank_payment(uuid,uuid,uuid,uuid,bigint,text,text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION refs_bank_match_hash(uuid,uuid,uuid,uuid,bigint,bigint,text) TO refs_app;
GRANT EXECUTE ON FUNCTION refs_create_bank_payment_match(uuid,uuid,uuid,uuid,bigint,bigint,text,text,text) TO refs_app;
GRANT EXECUTE ON FUNCTION refs_bank_unmatch_hash(uuid,uuid,uuid,uuid,bigint,text) TO refs_app;
GRANT EXECUTE ON FUNCTION refs_unmatch_bank_payment(uuid,uuid,uuid,uuid,bigint,text,text,text) TO refs_app;

COMMIT;
