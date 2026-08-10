BEGIN;

-- REFS-owned command evidence.  These records never mutate WBS and never
-- create, approve, or post a journal.  Each event is immutable; current state
-- is derived from the highest version for the candidate.
CREATE TABLE wbs_autorec_execution_event (
  execution_receipt_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant(tenant_id), entity_id uuid NOT NULL,
  review_candidate_id text NOT NULL CHECK(review_candidate_id ~ '^sha256:[0-9a-f]{64}$'),
  command text NOT NULL CHECK(command IN ('RESERVE','RELEASE')),
  current_state text NOT NULL CHECK(current_state IN ('REVIEW_REQUIRED','RESERVED')),
  next_state text NOT NULL CHECK(next_state IN ('RESERVED','RELEASED')),
  version integer NOT NULL CHECK(version >= 1),
  request_hash text NOT NULL CHECK(request_hash ~ '^sha256:[0-9a-f]{64}$'),
  idempotency_key text NOT NULL,
  intent jsonb NOT NULL CHECK(jsonb_typeof(intent)='object'),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE(tenant_id,entity_id,review_candidate_id,version),
  FOREIGN KEY(tenant_id,entity_id) REFERENCES entity(tenant_id,entity_id)
);
CREATE TABLE wbs_autorec_source_reservation (
  wbs_autorec_source_reservation_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant(tenant_id), entity_id uuid NOT NULL,
  execution_receipt_id uuid NOT NULL REFERENCES wbs_autorec_execution_event(execution_receipt_id),
  review_candidate_id text NOT NULL CHECK(review_candidate_id ~ '^sha256:[0-9a-f]{64}$'),
  source_side text NOT NULL CHECK(source_side IN ('BANK','BUSINESS')),
  source_type text NOT NULL CHECK(source_type IN ('BANK_TRANSACTION','PAYABLE','AUTOREC_PAYMENT_DETAIL')),
  source_record_id text NOT NULL, source_version text NOT NULL,
  currency text NOT NULL CHECK(currency ~ '^[A-Z]{3}$'),
  allocated_amount numeric(20,4) NOT NULL CHECK(allocated_amount > 0),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE(tenant_id,entity_id,execution_receipt_id,source_side),
  FOREIGN KEY(tenant_id,entity_id) REFERENCES entity(tenant_id,entity_id)
);
CREATE INDEX wbs_autorec_source_reservation_scope_idx ON wbs_autorec_source_reservation(tenant_id,entity_id,source_type,source_record_id,source_version);
ALTER TABLE wbs_autorec_execution_event ENABLE ROW LEVEL SECURITY;
ALTER TABLE wbs_autorec_source_reservation ENABLE ROW LEVEL SECURITY;
CREATE POLICY wbs_autorec_execution_event_scope ON wbs_autorec_execution_event USING(tenant_id=refs_current_tenant() AND refs_entity_allowed(entity_id)) WITH CHECK(tenant_id=refs_current_tenant() AND refs_entity_allowed(entity_id));
CREATE POLICY wbs_autorec_source_reservation_scope ON wbs_autorec_source_reservation USING(tenant_id=refs_current_tenant() AND refs_entity_allowed(entity_id)) WITH CHECK(tenant_id=refs_current_tenant() AND refs_entity_allowed(entity_id));
CREATE TRIGGER wbs_autorec_execution_event_append_only BEFORE UPDATE OR DELETE ON wbs_autorec_execution_event FOR EACH ROW EXECUTE FUNCTION reject_mutation();
CREATE TRIGGER wbs_autorec_source_reservation_append_only BEFORE UPDATE OR DELETE ON wbs_autorec_source_reservation FOR EACH ROW EXECUTE FUNCTION reject_mutation();

CREATE OR REPLACE FUNCTION refs_execute_wbs_autorec_intent(p_tenant uuid,p_entity uuid,p_intent jsonb,p_idempotency text,p_request_hash text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE actor text:=refs_current_actor(); rec idempotency_receipt; candidate jsonb; trace jsonb;
  cmd text; candidate_id text; stated text; target text; company text; currency text; bank_account text;
  bank_id text; bank_version text; business_id text; business_version text; bank_hash text; business_hash text;
  requested numeric(20,4); bank_amount numeric(20,4); business_amount numeric(20,4); reserved_bank numeric(20,4); reserved_business numeric(20,4);
  current_event wbs_autorec_execution_event; event_id uuid; next_version integer; result jsonb;
BEGIN
  PERFORM refs_assert_scope(p_tenant,p_entity,'BANK.AUTOREC.MANAGE');
  IF actor IS NULL THEN RAISE EXCEPTION 'Authenticated actor missing' USING ERRCODE='42501'; END IF;
  IF jsonb_typeof(p_intent)<>'object' OR p_request_hash !~ '^sha256:[0-9a-f]{64}$' OR p_idempotency !~ '^[A-Za-z0-9._:-]{8,200}$' THEN RAISE EXCEPTION 'WBS AutoRec execution request is invalid' USING ERRCODE='22023'; END IF;
  candidate:=p_intent->'review_candidate'; trace:=candidate->'trace'; cmd:=upper(coalesce(p_intent->>'command',''));
  candidate_id:=coalesce(candidate->>'review_candidate_id',''); stated:=upper(coalesce(p_intent->>'current_state','')); target:=upper(coalesce(p_intent->>'next_state',''));
  company:=coalesce(candidate->>'company_key',''); currency:=coalesce(candidate->>'currency',''); bank_account:=coalesce(candidate->>'bank_account_ref','');
  bank_id:=coalesce(trace->>'bank_source_record_id',''); bank_version:=coalesce(trace->>'bank_source_version',''); bank_hash:=coalesce(trace->>'bank_receipt_hash','');
  business_id:=coalesce(trace->>'business_source_record_id',''); business_version:=coalesce(trace->>'business_source_version',''); business_hash:=coalesce(trace->>'business_receipt_hash','');
  IF cmd NOT IN ('RESERVE','RELEASE') OR jsonb_typeof(candidate)<>'object' OR jsonb_typeof(trace)<>'object' OR candidate_id !~ '^sha256:[0-9a-f]{64}$' OR company='' OR currency !~ '^[A-Z]{3}$' OR bank_account='' OR bank_id='' OR bank_version='' OR bank_hash !~ '^sha256:[0-9a-f]{64}$' OR business_id='' OR business_version='' OR business_hash !~ '^sha256:[0-9a-f]{64}$' OR coalesce(candidate->>'allocated_amount','') !~ '^[0-9]+(\.[0-9]{1,4})?$' THEN RAISE EXCEPTION 'WBS AutoRec execution trace is incomplete' USING ERRCODE='22023'; END IF;
  requested:=(candidate->>'allocated_amount')::numeric(20,4);
  IF requested<=0 OR (cmd='RESERVE' AND (stated<>'REVIEW_REQUIRED' OR target<>'RESERVED')) OR (cmd='RELEASE' AND (stated<>'RESERVED' OR target<>'RELEASED')) THEN RAISE EXCEPTION 'WBS AutoRec execution transition is invalid' USING ERRCODE='22023'; END IF;
  INSERT INTO idempotency_receipt(tenant_id,operation_scope,idempotency_key,request_hash,status,actor_id)
  VALUES(p_tenant,'WBS_AUTOREC_EXECUTION:'||p_entity,p_idempotency,p_request_hash,'IN_PROGRESS',actor) ON CONFLICT DO NOTHING;
  SELECT * INTO rec FROM idempotency_receipt WHERE tenant_id=p_tenant AND operation_scope='WBS_AUTOREC_EXECUTION:'||p_entity AND idempotency_key=p_idempotency FOR UPDATE;
  IF rec.request_hash<>p_request_hash THEN RAISE EXCEPTION 'Idempotency key reused with different request' USING ERRCODE='23505'; END IF;
  IF rec.status='SUCCEEDED' THEN RETURN rec.response_body||jsonb_build_object('idempotent',true); END IF;
  -- Fixed source lock order prevents crossed Bank/Payable reservation deadlocks.
  PERFORM 1 FROM wbs_inbound_row row WHERE row.tenant_id=p_tenant AND row.entity_id=p_entity
    AND ((row.source_record_id=bank_id AND row.source_version=bank_version) OR (row.source_record_id=business_id AND row.source_version=business_version))
    ORDER BY row.source_record_id,row.source_version FOR UPDATE;
  SELECT abs((row.normalized->>'amount')::numeric(20,4)) INTO bank_amount FROM wbs_inbound_row row JOIN wbs_inbound_receipt receipt ON receipt.receipt_id=row.receipt_id
    WHERE row.tenant_id=p_tenant AND row.entity_id=p_entity AND row.source_record_id=bank_id AND row.source_version=bank_version AND row.normalized->>'source_type'='BANK_TRANSACTION' AND coalesce(row.normalized->>'company_key',row.raw->>'company_key')=company AND row.normalized->>'currency'=currency AND receipt.receipt_hash=bank_hash AND coalesce(row.normalized->>'bank_account_ref','')=bank_account AND coalesce(row.normalized->>'amount','') ~ '^-?[0-9]+(\.[0-9]{1,4})?$';
  SELECT abs((row.normalized->>'amount')::numeric(20,4)) INTO business_amount FROM wbs_inbound_row row JOIN wbs_inbound_receipt receipt ON receipt.receipt_id=row.receipt_id
    WHERE row.tenant_id=p_tenant AND row.entity_id=p_entity AND row.source_record_id=business_id AND row.source_version=business_version AND row.normalized->>'source_type' IN ('PAYABLE','AUTOREC_PAYMENT_DETAIL') AND coalesce(row.normalized->>'company_key',row.raw->>'company_key')=company AND row.normalized->>'currency'=currency AND receipt.receipt_hash=business_hash AND coalesce(row.normalized->>'amount','') ~ '^-?[0-9]+(\.[0-9]{1,4})?$';
  IF bank_amount IS NULL OR business_amount IS NULL OR bank_amount<=0 OR business_amount<=0 THEN RAISE EXCEPTION 'WBS AutoRec source receipt, scope, account, or amount is not authoritative' USING ERRCODE='22023'; END IF;
  IF NOT EXISTS(SELECT 1 FROM mapping_snapshot m WHERE m.tenant_id=p_tenant AND m.entity_id=p_entity AND m.family='WBS_AUTOREC' AND m.status='APPROVED' AND m.effective_from<=clock_timestamp() AND (m.effective_to IS NULL OR m.effective_to>clock_timestamp()) AND m.input_keys->>'company_key'=company AND m.input_keys->>'currency'=currency) THEN RAISE EXCEPTION 'WBS AutoRec requires an approved effective mapping' USING ERRCODE='22023'; END IF;
  SELECT * INTO current_event FROM wbs_autorec_execution_event e WHERE e.tenant_id=p_tenant AND e.entity_id=p_entity AND e.review_candidate_id=candidate_id ORDER BY e.version DESC LIMIT 1 FOR UPDATE;
  IF cmd='RESERVE' THEN
    IF current_event.execution_receipt_id IS NOT NULL THEN RAISE EXCEPTION 'WBS AutoRec candidate is no longer review-required' USING ERRCODE='23505'; END IF;
    SELECT coalesce(sum(allocated_amount),0) INTO reserved_bank FROM wbs_autorec_source_reservation WHERE tenant_id=p_tenant AND entity_id=p_entity AND source_type='BANK_TRANSACTION' AND source_record_id=bank_id AND source_version=bank_version;
    SELECT coalesce(sum(allocated_amount),0) INTO reserved_business FROM wbs_autorec_source_reservation WHERE tenant_id=p_tenant AND entity_id=p_entity AND source_record_id=business_id AND source_version=business_version;
    IF reserved_bank+requested>bank_amount+0.0001 OR reserved_business+requested>business_amount+0.0001 THEN RAISE EXCEPTION 'WBS AutoRec source capacity is already reserved' USING ERRCODE='23505'; END IF;
    next_version:=1;
  ELSE
    IF current_event.execution_receipt_id IS NULL OR current_event.next_state<>'RESERVED' OR coalesce(p_intent->'reservation_receipt'->>'reservation_id','')<>current_event.execution_receipt_id::text OR coalesce(p_intent->'reservation_receipt'->>'request_hash','')<>current_event.request_hash OR coalesce(p_intent->'reservation_receipt'->>'allocated_amount','') !~ '^[0-9]+(\.[0-9]{1,4})?$' OR (p_intent->'reservation_receipt'->>'allocated_amount')::numeric(20,4)<>requested THEN RAISE EXCEPTION 'WBS AutoRec release receipt is not authoritative' USING ERRCODE='22023'; END IF;
    SELECT coalesce(sum(allocated_amount),0) INTO reserved_bank FROM wbs_autorec_source_reservation WHERE tenant_id=p_tenant AND entity_id=p_entity AND source_type='BANK_TRANSACTION' AND source_record_id=bank_id AND source_version=bank_version;
    SELECT coalesce(sum(allocated_amount),0) INTO reserved_business FROM wbs_autorec_source_reservation WHERE tenant_id=p_tenant AND entity_id=p_entity AND source_type IN ('PAYABLE','AUTOREC_PAYMENT_DETAIL') AND source_record_id=business_id AND source_version=business_version;
    IF abs(reserved_bank-bank_amount)>0.0001 OR abs(reserved_business-business_amount)>0.0001 THEN RAISE EXCEPTION 'WBS AutoRec release requires fully reserved source capacity' USING ERRCODE='22023'; END IF;
    next_version:=current_event.version+1;
  END IF;
  INSERT INTO wbs_autorec_execution_event(tenant_id,entity_id,review_candidate_id,command,current_state,next_state,version,request_hash,idempotency_key,intent)
  VALUES(p_tenant,p_entity,candidate_id,cmd,stated,target,next_version,p_request_hash,p_idempotency,p_intent) RETURNING execution_receipt_id INTO event_id;
  IF cmd='RESERVE' THEN
    INSERT INTO wbs_autorec_source_reservation(tenant_id,entity_id,execution_receipt_id,review_candidate_id,source_side,source_type,source_record_id,source_version,currency,allocated_amount)
    VALUES(p_tenant,p_entity,event_id,candidate_id,'BANK','BANK_TRANSACTION',bank_id,bank_version,currency,requested),(p_tenant,p_entity,event_id,candidate_id,'BUSINESS',(SELECT row.normalized->>'source_type' FROM wbs_inbound_row row WHERE row.tenant_id=p_tenant AND row.entity_id=p_entity AND row.source_record_id=business_id AND row.source_version=business_version LIMIT 1),business_id,business_version,currency,requested);
  END IF;
  result:=jsonb_build_object('ok',true,'execution_receipt_id',event_id,'review_candidate_id',candidate_id,'idempotency_key',p_idempotency,'request_hash',p_request_hash,'control_hash',p_request_hash,'current_state',stated,'next_state',target,'version',next_version,'idempotent',false,'can_write_wbs',false,'can_dispatch',false,'can_create_draft',false,'can_post',false);
  INSERT INTO audit_event(tenant_id,entity_id,event_type,object_type,object_id,action,actor_id,actor_type,permission_used,request_id,correlation_id,idempotency_key,after_hash,metadata)
  VALUES(p_tenant,p_entity,'WBS_AUTOREC_EXECUTION_PERSISTED','WBS_AUTOREC_EXECUTION',event_id,cmd,actor,'USER','BANK.AUTOREC.MANAGE',p_idempotency,p_idempotency,p_idempotency,p_request_hash,jsonb_build_object('review_candidate_id',candidate_id,'current_state',stated,'next_state',target,'version',next_version));
  UPDATE idempotency_receipt SET status='SUCCEEDED',response_status=201,response_body=result,completed_at=clock_timestamp() WHERE tenant_id=p_tenant AND operation_scope='WBS_AUTOREC_EXECUTION:'||p_entity AND idempotency_key=p_idempotency;
  RETURN result;
END $$;

REVOKE ALL ON wbs_autorec_execution_event,wbs_autorec_source_reservation FROM PUBLIC,refs_app;
GRANT SELECT ON wbs_autorec_execution_event,wbs_autorec_source_reservation TO refs_app;
REVOKE ALL ON FUNCTION refs_execute_wbs_autorec_intent(uuid,uuid,jsonb,text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION refs_execute_wbs_autorec_intent(uuid,uuid,jsonb,text,text) TO refs_app;
COMMIT;
