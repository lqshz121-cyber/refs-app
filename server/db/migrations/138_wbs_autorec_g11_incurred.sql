BEGIN;

INSERT INTO permission_catalog(permission_code,domain,risk_class,sod_class)
VALUES('BANK.AUTOREC.G11.INCUR','BANK','CRITICAL','WBS_AUTOREC_G11_FINALIZER')
ON CONFLICT(permission_code) DO UPDATE SET active=true,domain=EXCLUDED.domain,risk_class=EXCLUDED.risk_class,sod_class=EXCLUDED.sod_class,version=permission_catalog.version+1,effective_to=NULL;

ALTER TABLE wbs_autorec_execution_event DROP CONSTRAINT wbs_autorec_execution_event_command_check;
ALTER TABLE wbs_autorec_execution_event DROP CONSTRAINT wbs_autorec_execution_event_current_state_check;
ALTER TABLE wbs_autorec_execution_event DROP CONSTRAINT wbs_autorec_execution_event_next_state_check;
ALTER TABLE wbs_autorec_execution_event ADD CONSTRAINT wbs_autorec_execution_event_command_check CHECK(command IN ('RESERVE','RELEASE','INCUR'));
ALTER TABLE wbs_autorec_execution_event ADD CONSTRAINT wbs_autorec_execution_event_current_state_check CHECK(current_state IN ('REVIEW_REQUIRED','RESERVED','RELEASED'));
ALTER TABLE wbs_autorec_execution_event ADD CONSTRAINT wbs_autorec_execution_event_next_state_check CHECK(next_state IN ('RESERVED','RELEASED','INCURRED'));
ALTER TABLE wbs_autorec_execution_event ADD CONSTRAINT wbs_autorec_execution_event_transition_check CHECK(
  (command='RESERVE' AND current_state='REVIEW_REQUIRED' AND next_state='RESERVED') OR
  (command='RELEASE' AND current_state='RESERVED' AND next_state='RELEASED') OR
  (command='INCUR' AND current_state='RELEASED' AND next_state='INCURRED')
);

CREATE TABLE wbs_autorec_g11_completion (
  wbs_autorec_g11_completion_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,entity_id uuid NOT NULL,wbs_autorec_match_review_id uuid NOT NULL,
  release_execution_receipt_id uuid NOT NULL,release_execution_version integer NOT NULL CHECK(release_execution_version>=1),
  payable_incur_accounting_event_id uuid NOT NULL,autoc_accounting_event_id uuid NOT NULL,
  payable_incur_journal_entry_id uuid NOT NULL,autoc_journal_entry_id uuid NOT NULL,
  payable_incur_posting_batch_id uuid NOT NULL,autoc_posting_batch_id uuid NOT NULL,
  incur_execution_receipt_id uuid NOT NULL,incur_execution_version integer NOT NULL CHECK(incur_execution_version>=1),
  evidence_hash text NOT NULL CHECK(evidence_hash ~ '^sha256:[0-9a-f]{64}$'),
  finalized_by text NOT NULL,finalized_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  request_hash text NOT NULL CHECK(request_hash ~ '^sha256:[0-9a-f]{64}$'),idempotency_key text NOT NULL,
  CHECK(payable_incur_accounting_event_id<>autoc_accounting_event_id),
  CHECK(payable_incur_journal_entry_id<>autoc_journal_entry_id),
  CHECK(payable_incur_posting_batch_id<>autoc_posting_batch_id),
  UNIQUE(tenant_id,entity_id,wbs_autorec_match_review_id),
  UNIQUE(tenant_id,entity_id,wbs_autorec_g11_completion_id),
  UNIQUE(tenant_id,entity_id,incur_execution_receipt_id),
  FOREIGN KEY(tenant_id,entity_id) REFERENCES entity(tenant_id,entity_id),
  FOREIGN KEY(tenant_id,entity_id,wbs_autorec_match_review_id) REFERENCES wbs_autorec_match_review(tenant_id,entity_id,wbs_autorec_match_review_id),
  FOREIGN KEY(tenant_id,entity_id,payable_incur_accounting_event_id) REFERENCES accounting_event(tenant_id,entity_id,accounting_event_id),
  FOREIGN KEY(tenant_id,entity_id,autoc_accounting_event_id) REFERENCES accounting_event(tenant_id,entity_id,accounting_event_id),
  FOREIGN KEY(tenant_id,entity_id,payable_incur_journal_entry_id) REFERENCES journal_entry(tenant_id,entity_id,journal_entry_id),
  FOREIGN KEY(tenant_id,entity_id,autoc_journal_entry_id) REFERENCES journal_entry(tenant_id,entity_id,journal_entry_id),
  FOREIGN KEY(tenant_id,entity_id,payable_incur_posting_batch_id) REFERENCES posting_batch(tenant_id,entity_id,posting_batch_id),
  FOREIGN KEY(tenant_id,entity_id,autoc_posting_batch_id) REFERENCES posting_batch(tenant_id,entity_id,posting_batch_id),
  FOREIGN KEY(incur_execution_receipt_id) REFERENCES wbs_autorec_execution_event(execution_receipt_id)
);
CREATE TABLE wbs_autorec_g11_completion_line (
  wbs_autorec_g11_completion_line_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,entity_id uuid NOT NULL,wbs_autorec_g11_completion_id uuid NOT NULL,
  event_type text NOT NULL CHECK(event_type IN ('PAYABLE_INCUR','AUTOC')),
  line_role text NOT NULL CHECK(line_role IN ('CLEARING','OFFSET')),
  accounting_event_id uuid NOT NULL,journal_entry_id uuid NOT NULL,posting_batch_id uuid NOT NULL,
  journal_line_id uuid NOT NULL,ledger_line_id uuid NOT NULL,account_code text NOT NULL,
  debit_amount numeric(20,4) NOT NULL CHECK(debit_amount>=0),credit_amount numeric(20,4) NOT NULL CHECK(credit_amount>=0),member_ref text,
  CHECK((debit_amount>0 AND credit_amount=0) OR (credit_amount>0 AND debit_amount=0)),
  UNIQUE(tenant_id,entity_id,wbs_autorec_g11_completion_id,event_type,line_role),
  UNIQUE(tenant_id,entity_id,ledger_line_id),
  FOREIGN KEY(tenant_id,entity_id,wbs_autorec_g11_completion_id) REFERENCES wbs_autorec_g11_completion(tenant_id,entity_id,wbs_autorec_g11_completion_id),
  FOREIGN KEY(tenant_id,entity_id,accounting_event_id) REFERENCES accounting_event(tenant_id,entity_id,accounting_event_id),
  FOREIGN KEY(tenant_id,entity_id,journal_entry_id,journal_line_id) REFERENCES journal_line(tenant_id,entity_id,journal_entry_id,journal_line_id),
  FOREIGN KEY(tenant_id,entity_id,posting_batch_id) REFERENCES posting_batch(tenant_id,entity_id,posting_batch_id),
  FOREIGN KEY(tenant_id,entity_id,ledger_line_id) REFERENCES ledger_line(tenant_id,entity_id,ledger_line_id)
);
ALTER TABLE wbs_autorec_g11_completion ENABLE ROW LEVEL SECURITY;
ALTER TABLE wbs_autorec_g11_completion_line ENABLE ROW LEVEL SECURITY;
CREATE POLICY wbs_autorec_g11_completion_scope ON wbs_autorec_g11_completion USING(tenant_id=refs_current_tenant() AND refs_entity_allowed(entity_id)) WITH CHECK(tenant_id=refs_current_tenant() AND refs_entity_allowed(entity_id));
CREATE POLICY wbs_autorec_g11_completion_line_scope ON wbs_autorec_g11_completion_line USING(tenant_id=refs_current_tenant() AND refs_entity_allowed(entity_id)) WITH CHECK(tenant_id=refs_current_tenant() AND refs_entity_allowed(entity_id));
CREATE TRIGGER wbs_autorec_g11_completion_append_only BEFORE UPDATE OR DELETE ON wbs_autorec_g11_completion FOR EACH ROW EXECUTE FUNCTION reject_mutation();
CREATE TRIGGER wbs_autorec_g11_completion_line_append_only BEFORE UPDATE OR DELETE ON wbs_autorec_g11_completion_line FOR EACH ROW EXECUTE FUNCTION reject_mutation();

CREATE FUNCTION refs_wbs_autorec_g11_incur_hash(p_tenant uuid,p_entity uuid,p_review uuid,p_expected_evidence_hash text,p_reason text)
RETURNS text LANGUAGE sql IMMUTABLE SET search_path=pg_catalog,public,pg_temp AS $$
 SELECT refs_jsonb_hash(jsonb_build_object('tenant_id',p_tenant,'entity_id',p_entity,'review_id',p_review,'expected_evidence_hash',p_expected_evidence_hash,'reason',btrim(p_reason)))
$$;

CREATE FUNCTION refs_finalize_wbs_autorec_g11_incur(p_tenant uuid,p_entity uuid,p_review uuid,p_expected_evidence_hash text,p_reason text,p_idempotency text,p_request_hash text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE actor text:=refs_current_actor(); review_row wbs_autorec_match_review; release_row wbs_autorec_execution_event;
DECLARE payable_event accounting_event; autoc_event accounting_event; payable_je journal_entry; autoc_je journal_entry;
DECLARE payable_batch uuid; autoc_batch uuid; completion_id uuid:=gen_random_uuid(); incur_id uuid:=gen_random_uuid(); next_version integer;
DECLARE rec idempotency_receipt; evidence text; result jsonb; candidate jsonb; prior_actors text[];
BEGIN
  PERFORM refs_assert_scope(p_tenant,p_entity,'BANK.AUTOREC.G11.INCUR');
  IF actor IS NULL OR p_request_hash<>refs_wbs_autorec_g11_incur_hash(p_tenant,p_entity,p_review,p_expected_evidence_hash,p_reason)
     OR p_idempotency !~ '^[A-Za-z0-9._:-]{8,200}$' OR coalesce(length(btrim(p_reason)),0) NOT BETWEEN 8 AND 2000 THEN
    RAISE EXCEPTION 'G11 INCUR request is invalid' USING ERRCODE='22023';
  END IF;
  SELECT * INTO review_row FROM wbs_autorec_match_review WHERE tenant_id=p_tenant AND entity_id=p_entity
    AND wbs_autorec_match_review_id=p_review AND decision='ACCEPTED' FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'G11 INCUR requires an ACCEPTED review' USING ERRCODE='P0002'; END IF;
  IF review_row.evidence_hash<>p_expected_evidence_hash THEN RAISE EXCEPTION 'G11 review evidence changed' USING ERRCODE='40001'; END IF;
  INSERT INTO idempotency_receipt(tenant_id,operation_scope,idempotency_key,request_hash,status,actor_id)
  VALUES(p_tenant,'WBS_AUTOREC_G11_INCUR:'||p_entity,p_idempotency,p_request_hash,'IN_PROGRESS',actor) ON CONFLICT DO NOTHING;
  SELECT * INTO rec FROM idempotency_receipt WHERE tenant_id=p_tenant AND operation_scope='WBS_AUTOREC_G11_INCUR:'||p_entity AND idempotency_key=p_idempotency FOR UPDATE;
  IF rec.request_hash<>p_request_hash THEN RAISE EXCEPTION 'Idempotency key reused with a different request' USING ERRCODE='23505'; END IF;
  IF rec.status='SUCCEEDED' THEN RETURN rec.response_body||jsonb_build_object('idempotent',true); END IF;
  SELECT * INTO release_row FROM wbs_autorec_execution_event e WHERE e.tenant_id=p_tenant AND e.entity_id=p_entity
    AND e.review_candidate_id=review_row.review_candidate_id ORDER BY e.version DESC LIMIT 1 FOR UPDATE;
  IF release_row.command<>'RELEASE' OR release_row.current_state<>'RESERVED' OR release_row.next_state<>'RELEASED' THEN
    RAISE EXCEPTION 'G11 INCUR requires the latest RELEASED execution' USING ERRCODE='23514';
  END IF;
  candidate:=release_row.intent->'review_candidate';
  IF candidate IS NULL OR refs_jsonb_hash(candidate)<>review_row.candidate_hash THEN RAISE EXCEPTION 'G11 released candidate changed' USING ERRCODE='23514'; END IF;
  IF (SELECT count(*) FROM accounting_event WHERE tenant_id=p_tenant AND entity_id=p_entity AND wbs_autorec_match_review_id=p_review)<>2 THEN
    RAISE EXCEPTION 'G11 INCUR requires exactly two accounting events' USING ERRCODE='23514';
  END IF;
  SELECT * INTO payable_event FROM accounting_event WHERE tenant_id=p_tenant AND entity_id=p_entity AND wbs_autorec_match_review_id=p_review AND event_type='PAYABLE_INCUR' FOR SHARE;
  SELECT * INTO autoc_event FROM accounting_event WHERE tenant_id=p_tenant AND entity_id=p_entity AND wbs_autorec_match_review_id=p_review AND event_type='AUTOC' FOR SHARE;
  IF payable_event.accounting_event_id IS NULL OR autoc_event.accounting_event_id IS NULL OR payable_event.amount<>autoc_event.amount
     OR payable_event.amount<>(candidate->>'allocated_amount')::numeric(20,4) OR payable_event.currency<>autoc_event.currency
     OR payable_event.currency<>candidate->>'currency' OR payable_event.bank_account_ref<>autoc_event.bank_account_ref
     OR payable_event.bank_account_ref<>candidate->>'bank_account_ref' OR payable_event.clearing_member_ref<>autoc_event.clearing_member_ref
     OR payable_event.mapping_snapshot_id<>autoc_event.mapping_snapshot_id OR payable_event.mapping_snapshot_hash<>autoc_event.mapping_snapshot_hash THEN
    RAISE EXCEPTION 'G11 accounting events do not share the exact reviewed allocation and mapping' USING ERRCODE='23514';
  END IF;
  SELECT je.* INTO payable_je FROM journal_accounting_event b JOIN journal_entry je USING(tenant_id,entity_id,journal_entry_id)
    WHERE b.tenant_id=p_tenant AND b.entity_id=p_entity AND b.accounting_event_id=payable_event.accounting_event_id FOR SHARE OF je;
  SELECT je.* INTO autoc_je FROM journal_accounting_event b JOIN journal_entry je USING(tenant_id,entity_id,journal_entry_id)
    WHERE b.tenant_id=p_tenant AND b.entity_id=p_entity AND b.accounting_event_id=autoc_event.accounting_event_id FOR SHARE OF je;
  IF payable_je.journal_entry_id IS NULL OR autoc_je.journal_entry_id IS NULL OR payable_je.journal_entry_id=autoc_je.journal_entry_id
     OR payable_je.status<>'POSTED' OR autoc_je.status<>'POSTED' OR payable_je.journal_type<>'AUTO' OR autoc_je.journal_type<>'AUTO'
     OR payable_je.revision<>4 OR autoc_je.revision<>4 THEN RAISE EXCEPTION 'G11 INCUR requires two distinct standard POSTED AUTO journals' USING ERRCODE='23514'; END IF;
  prior_actors:=ARRAY[review_row.candidate_prepared_by,review_row.matched_by,review_row.reviewed_by,payable_je.created_by,payable_je.reviewed_by,payable_je.approved_by,payable_je.posted_by,autoc_je.created_by,autoc_je.reviewed_by,autoc_je.approved_by,autoc_je.posted_by];
  IF actor=ANY(prior_actors) THEN RAISE EXCEPTION 'G11 finalizer SoD violation' USING ERRCODE='42501'; END IF;
  IF (SELECT count(*) FROM journal_line WHERE tenant_id=p_tenant AND entity_id=p_entity AND journal_entry_id IN(payable_je.journal_entry_id,autoc_je.journal_entry_id))<>4
     OR (SELECT count(*) FROM ledger_line WHERE tenant_id=p_tenant AND entity_id=p_entity AND journal_entry_id IN(payable_je.journal_entry_id,autoc_je.journal_entry_id))<>4
     OR EXISTS(SELECT 1 FROM journal_line jl LEFT JOIN ledger_line ll ON ll.tenant_id=jl.tenant_id AND ll.entity_id=jl.entity_id AND ll.journal_entry_id=jl.journal_entry_id AND ll.journal_line_id=jl.journal_line_id
       WHERE jl.tenant_id=p_tenant AND jl.entity_id=p_entity AND jl.journal_entry_id IN(payable_je.journal_entry_id,autoc_je.journal_entry_id)
         AND (ll.ledger_line_id IS NULL OR ll.account_code<>jl.account_code OR ll.debit_amount<>jl.debit_amount OR ll.credit_amount<>jl.credit_amount OR ll.member_ref IS DISTINCT FROM jl.member_ref)) THEN
    RAISE EXCEPTION 'G11 posted journal and ledger lines are incomplete or inconsistent' USING ERRCODE='23514';
  END IF;
  IF NOT EXISTS(SELECT 1 FROM journal_line WHERE tenant_id=p_tenant AND entity_id=p_entity AND journal_entry_id=payable_je.journal_entry_id AND account_code='291001' AND credit_amount=payable_event.amount AND debit_amount=0 AND member_ref=payable_event.clearing_member_ref)
     OR NOT EXISTS(SELECT 1 FROM journal_line WHERE tenant_id=p_tenant AND entity_id=p_entity AND journal_entry_id=autoc_je.journal_entry_id AND account_code='291001' AND debit_amount=autoc_event.amount AND credit_amount=0 AND member_ref=autoc_event.clearing_member_ref)
     OR EXISTS(SELECT 1 FROM (SELECT journal_entry_id,sum(debit_amount) debit,sum(credit_amount) credit FROM journal_line WHERE tenant_id=p_tenant AND entity_id=p_entity AND journal_entry_id IN(payable_je.journal_entry_id,autoc_je.journal_entry_id) GROUP BY journal_entry_id) totals WHERE debit<>credit)
     OR (SELECT coalesce(sum(debit_amount-credit_amount),0) FROM journal_line WHERE tenant_id=p_tenant AND entity_id=p_entity AND journal_entry_id IN(payable_je.journal_entry_id,autoc_je.journal_entry_id) AND account_code='291001' AND member_ref=payable_event.clearing_member_ref)<>0 THEN
    RAISE EXCEPTION 'G11 clearing legs are not exact, balanced, and net zero' USING ERRCODE='23514';
  END IF;
  SELECT (array_agg(DISTINCT posting_batch_id))[1] INTO payable_batch FROM ledger_line WHERE tenant_id=p_tenant AND entity_id=p_entity AND journal_entry_id=payable_je.journal_entry_id HAVING count(DISTINCT posting_batch_id)=1;
  SELECT (array_agg(DISTINCT posting_batch_id))[1] INTO autoc_batch FROM ledger_line WHERE tenant_id=p_tenant AND entity_id=p_entity AND journal_entry_id=autoc_je.journal_entry_id HAVING count(DISTINCT posting_batch_id)=1;
  IF payable_batch IS NULL OR autoc_batch IS NULL OR payable_batch=autoc_batch THEN RAISE EXCEPTION 'G11 requires one distinct posting batch per journal' USING ERRCODE='23514'; END IF;
  evidence:=refs_jsonb_hash(jsonb_build_object('review_id',p_review,'review_evidence_hash',review_row.evidence_hash,
    'release_receipt_id',release_row.execution_receipt_id,'release_version',release_row.version,
    'payable_event_id',payable_event.accounting_event_id,'autoc_event_id',autoc_event.accounting_event_id,
    'payable_journal_id',payable_je.journal_entry_id,'autoc_journal_id',autoc_je.journal_entry_id,
    'payable_batch_id',payable_batch,'autoc_batch_id',autoc_batch));
  next_version:=release_row.version+1;
  INSERT INTO wbs_autorec_execution_event(execution_receipt_id,tenant_id,entity_id,review_candidate_id,command,current_state,next_state,version,request_hash,idempotency_key,intent)
  VALUES(incur_id,p_tenant,p_entity,review_row.review_candidate_id,'INCUR','RELEASED','INCURRED',next_version,p_request_hash,p_idempotency,
    jsonb_build_object('review_candidate',candidate,'wbs_autorec_match_review_id',p_review,'payable_incur_accounting_event_id',payable_event.accounting_event_id,
      'autoc_accounting_event_id',autoc_event.accounting_event_id,'payable_incur_journal_entry_id',payable_je.journal_entry_id,
      'autoc_journal_entry_id',autoc_je.journal_entry_id,'g11_evidence_hash',evidence));
  INSERT INTO wbs_autorec_g11_completion(wbs_autorec_g11_completion_id,tenant_id,entity_id,wbs_autorec_match_review_id,
    release_execution_receipt_id,release_execution_version,payable_incur_accounting_event_id,autoc_accounting_event_id,
    payable_incur_journal_entry_id,autoc_journal_entry_id,payable_incur_posting_batch_id,autoc_posting_batch_id,
    incur_execution_receipt_id,incur_execution_version,evidence_hash,finalized_by,request_hash,idempotency_key)
  VALUES(completion_id,p_tenant,p_entity,p_review,release_row.execution_receipt_id,release_row.version,payable_event.accounting_event_id,
    autoc_event.accounting_event_id,payable_je.journal_entry_id,autoc_je.journal_entry_id,payable_batch,autoc_batch,incur_id,next_version,evidence,actor,p_request_hash,p_idempotency);
  INSERT INTO wbs_autorec_g11_completion_line(tenant_id,entity_id,wbs_autorec_g11_completion_id,event_type,line_role,
    accounting_event_id,journal_entry_id,posting_batch_id,journal_line_id,ledger_line_id,account_code,debit_amount,credit_amount,member_ref)
  SELECT p_tenant,p_entity,completion_id,ae.event_type,CASE WHEN jl.account_code='291001' THEN 'CLEARING' ELSE 'OFFSET' END,
    ae.accounting_event_id,je.journal_entry_id,ll.posting_batch_id,jl.journal_line_id,ll.ledger_line_id,jl.account_code,jl.debit_amount,jl.credit_amount,jl.member_ref
  FROM accounting_event ae JOIN journal_accounting_event jae USING(tenant_id,entity_id,accounting_event_id)
    JOIN journal_entry je USING(tenant_id,entity_id,journal_entry_id) JOIN journal_line jl USING(tenant_id,entity_id,journal_entry_id)
    JOIN ledger_line ll USING(tenant_id,entity_id,journal_entry_id,journal_line_id)
  WHERE ae.tenant_id=p_tenant AND ae.entity_id=p_entity AND ae.wbs_autorec_match_review_id=p_review;
  result:=jsonb_build_object('wbs_autorec_g11_completion_id',completion_id,'wbs_autorec_match_review_id',p_review,
    'review_candidate_id',review_row.review_candidate_id,'release_execution_receipt_id',release_row.execution_receipt_id,
    'incur_execution_receipt_id',incur_id,'incur_execution_version',next_version,'evidence_hash',evidence,
    'payable_incur_accounting_event_id',payable_event.accounting_event_id,'autoc_accounting_event_id',autoc_event.accounting_event_id,
    'payable_incur_journal_entry_id',payable_je.journal_entry_id,'autoc_journal_entry_id',autoc_je.journal_entry_id,
    'g11_linked',true,'incurred',true,'idempotent',false);
  INSERT INTO audit_event(tenant_id,entity_id,event_type,object_type,object_id,action,actor_id,actor_type,permission_used,request_id,correlation_id,idempotency_key,after_hash,reason,metadata)
  VALUES(p_tenant,p_entity,'WBS_AUTOREC_G11_INCURRED','WBS_AUTOREC_G11_COMPLETION',completion_id,'INCUR',actor,'USER','BANK.AUTOREC.G11.INCUR',p_idempotency,p_idempotency,p_idempotency,evidence,btrim(p_reason),result-'idempotent');
  INSERT INTO outbox_event(tenant_id,entity_id,aggregate_type,aggregate_id,event_type,payload,payload_hash)
  VALUES(p_tenant,p_entity,'WBS_AUTOREC_G11_COMPLETION',completion_id,'WBS_AUTOREC_G11_INCURRED',result-'idempotent',refs_jsonb_hash(result-'idempotent'));
  UPDATE idempotency_receipt SET status='SUCCEEDED',response_status=201,response_body=result,completed_at=clock_timestamp()
    WHERE tenant_id=p_tenant AND operation_scope='WBS_AUTOREC_G11_INCUR:'||p_entity AND idempotency_key=p_idempotency;
  RETURN result;
END $$;

CREATE FUNCTION refs_get_wbs_autorec_g11_evidence(p_tenant uuid,p_entity uuid,p_review uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE result jsonb;
BEGIN
  PERFORM refs_assert_scope(p_tenant,p_entity,'WBS.AUTOREC.VIEW');
  SELECT jsonb_build_object('completion',to_jsonb(c),'review',to_jsonb(r),
    'released_candidate',release.intent->'review_candidate','incur_event',to_jsonb(incur),
    'accounting_events',(SELECT jsonb_agg(to_jsonb(ae) ORDER BY ae.event_type) FROM accounting_event ae WHERE ae.tenant_id=c.tenant_id AND ae.entity_id=c.entity_id AND ae.wbs_autorec_match_review_id=c.wbs_autorec_match_review_id),
    'lines',(SELECT jsonb_agg(to_jsonb(line) ORDER BY line.event_type,line.line_role) FROM wbs_autorec_g11_completion_line line WHERE line.tenant_id=c.tenant_id AND line.entity_id=c.entity_id AND line.wbs_autorec_g11_completion_id=c.wbs_autorec_g11_completion_id),
    'g11_linked',true,'incurred',true) INTO result
  FROM wbs_autorec_g11_completion c JOIN wbs_autorec_match_review r USING(tenant_id,entity_id,wbs_autorec_match_review_id)
    JOIN wbs_autorec_execution_event release ON release.execution_receipt_id=c.release_execution_receipt_id
    JOIN wbs_autorec_execution_event incur ON incur.execution_receipt_id=c.incur_execution_receipt_id
  WHERE c.tenant_id=p_tenant AND c.entity_id=p_entity AND c.wbs_autorec_match_review_id=p_review
    AND incur.command='INCUR' AND incur.next_state='INCURRED';
  IF result IS NULL THEN RAISE EXCEPTION 'Completed G11 evidence was not found in the selected entity' USING ERRCODE='P0002'; END IF;
  RETURN result;
END $$;

REVOKE ALL ON wbs_autorec_g11_completion,wbs_autorec_g11_completion_line FROM PUBLIC,refs_app;
GRANT SELECT ON wbs_autorec_g11_completion,wbs_autorec_g11_completion_line TO refs_app;
REVOKE ALL ON FUNCTION refs_wbs_autorec_g11_incur_hash(uuid,uuid,uuid,text,text) FROM PUBLIC;
REVOKE ALL ON FUNCTION refs_finalize_wbs_autorec_g11_incur(uuid,uuid,uuid,text,text,text,text) FROM PUBLIC;
REVOKE ALL ON FUNCTION refs_get_wbs_autorec_g11_evidence(uuid,uuid,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION refs_wbs_autorec_g11_incur_hash(uuid,uuid,uuid,text,text) TO refs_app;
GRANT EXECUTE ON FUNCTION refs_finalize_wbs_autorec_g11_incur(uuid,uuid,uuid,text,text,text,text) TO refs_app;
GRANT EXECUTE ON FUNCTION refs_get_wbs_autorec_g11_evidence(uuid,uuid,uuid) TO refs_app;

COMMIT;
