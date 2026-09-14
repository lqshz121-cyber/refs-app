BEGIN;

INSERT INTO permission_catalog(permission_code,domain,risk_class,sod_class)
VALUES ('BANK.AUTOREC.G11.REVERSE_DRAFT','BANK','CRITICAL','WBS_AUTOREC_G11_REVERSE_DRAFT'),
       ('BANK.AUTOREC.G11.REVERSE','BANK','CRITICAL','WBS_AUTOREC_G11_REVERSE')
ON CONFLICT(permission_code) DO UPDATE SET active=true,domain=EXCLUDED.domain,risk_class=EXCLUDED.risk_class,sod_class=EXCLUDED.sod_class,version=permission_catalog.version+1,effective_to=NULL;

ALTER TABLE wbs_autorec_execution_event DROP CONSTRAINT IF EXISTS wbs_autorec_execution_event_command_check;
ALTER TABLE wbs_autorec_execution_event DROP CONSTRAINT IF EXISTS wbs_autorec_execution_event_current_state_check;
ALTER TABLE wbs_autorec_execution_event DROP CONSTRAINT IF EXISTS wbs_autorec_execution_event_next_state_check;
ALTER TABLE wbs_autorec_execution_event DROP CONSTRAINT IF EXISTS wbs_autorec_execution_event_transition_check;
ALTER TABLE wbs_autorec_execution_event ADD CONSTRAINT wbs_autorec_execution_event_command_check CHECK(command IN ('RESERVE','RELEASE','INCUR','REQUEST_REVERSE','COMPLETE_REVERSE'));
ALTER TABLE wbs_autorec_execution_event ADD CONSTRAINT wbs_autorec_execution_event_current_state_check CHECK(current_state IN ('REVIEW_REQUIRED','RESERVED','RELEASED','INCURRED','REVERSE_DRAFT_REQUIRED'));
ALTER TABLE wbs_autorec_execution_event ADD CONSTRAINT wbs_autorec_execution_event_next_state_check CHECK(next_state IN ('RESERVED','RELEASED','INCURRED','REVERSE_DRAFT_REQUIRED','REVERSED'));
ALTER TABLE wbs_autorec_execution_event ADD CONSTRAINT wbs_autorec_execution_event_transition_check CHECK(
  (command='RESERVE' AND current_state='REVIEW_REQUIRED' AND next_state='RESERVED') OR
  (command='RELEASE' AND current_state='RESERVED' AND next_state='RELEASED') OR
  (command='INCUR' AND current_state='RELEASED' AND next_state='INCURRED') OR
  (command='REQUEST_REVERSE' AND current_state='INCURRED' AND next_state='REVERSE_DRAFT_REQUIRED') OR
  (command='COMPLETE_REVERSE' AND current_state='REVERSE_DRAFT_REQUIRED' AND next_state='REVERSED'));

ALTER TABLE journal_entry DROP CONSTRAINT IF EXISTS journal_entry_journal_type_check;
ALTER TABLE journal_entry ADD CONSTRAINT journal_entry_journal_type_check CHECK (journal_type IN ('MANUAL','AUTO','REVERSAL','RECLASS','WBS_AUTOREC_REVERSAL'));

CREATE TABLE wbs_autorec_reversal (
  wbs_autorec_reversal_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL, entity_id uuid NOT NULL, wbs_autorec_match_review_id uuid NOT NULL,
  event_type text NOT NULL CHECK(event_type IN ('PAYABLE_INCUR','AUTOC')),
  original_journal_entry_id uuid NOT NULL, reversal_journal_entry_id uuid NOT NULL,
  reason text NOT NULL CHECK(length(btrim(reason)) BETWEEN 8 AND 2000),
  created_by text NOT NULL, created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  request_hash text NOT NULL CHECK(request_hash ~ '^sha256:[0-9a-f]{64}$'), idempotency_key text NOT NULL,
  UNIQUE(tenant_id,entity_id,wbs_autorec_match_review_id,event_type),
  UNIQUE(tenant_id,entity_id,original_journal_entry_id),
  UNIQUE(tenant_id,entity_id,reversal_journal_entry_id),
  FOREIGN KEY(tenant_id,entity_id) REFERENCES entity(tenant_id,entity_id),
  FOREIGN KEY(tenant_id,entity_id,wbs_autorec_match_review_id) REFERENCES wbs_autorec_match_review(tenant_id,entity_id,wbs_autorec_match_review_id),
  FOREIGN KEY(tenant_id,entity_id,original_journal_entry_id) REFERENCES journal_entry(tenant_id,entity_id,journal_entry_id),
  FOREIGN KEY(tenant_id,entity_id,reversal_journal_entry_id) REFERENCES journal_entry(tenant_id,entity_id,journal_entry_id)
);
ALTER TABLE wbs_autorec_reversal ENABLE ROW LEVEL SECURITY;
CREATE POLICY wbs_autorec_reversal_scope ON wbs_autorec_reversal USING(tenant_id=refs_current_tenant() AND refs_entity_allowed(entity_id)) WITH CHECK(tenant_id=refs_current_tenant() AND refs_entity_allowed(entity_id));
CREATE TRIGGER wbs_autorec_reversal_append_only BEFORE UPDATE OR DELETE ON wbs_autorec_reversal FOR EACH ROW EXECUTE FUNCTION reject_mutation();

CREATE OR REPLACE FUNCTION refs_validate_wbs_autorec_reversal_je() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE original journal_entry; ol record; rl record;
BEGIN
  IF NEW.journal_type<>'WBS_AUTOREC_REVERSAL' OR NEW.status<>'POSTED' THEN RETURN NEW; END IF;
  SELECT * INTO original FROM journal_entry WHERE tenant_id=NEW.tenant_id AND entity_id=NEW.entity_id AND journal_entry_id=NEW.reversal_of_id;
  IF NOT FOUND OR original.status<>'POSTED' OR original.journal_type<>'AUTO' THEN RAISE EXCEPTION 'AutoRec reversal must point to a Posted AUTO journal' USING ERRCODE='23514'; END IF;
  IF NOT EXISTS(SELECT 1 FROM wbs_autorec_reversal r WHERE r.tenant_id=NEW.tenant_id AND r.entity_id=NEW.entity_id AND r.reversal_journal_entry_id=NEW.journal_entry_id) THEN RAISE EXCEPTION 'AutoRec reversal evidence row is missing' USING ERRCODE='23514'; END IF;
  IF EXISTS(SELECT 1 FROM journal_line ol FULL JOIN journal_line rl ON rl.tenant_id=NEW.tenant_id AND rl.entity_id=NEW.entity_id AND rl.journal_entry_id=NEW.journal_entry_id AND rl.line_no=ol.line_no
    WHERE ol.tenant_id=NEW.tenant_id AND ol.entity_id=NEW.entity_id AND ol.journal_entry_id=original.journal_entry_id
      AND (rl.journal_line_id IS NULL OR rl.account_code<>ol.account_code OR rl.member_ref IS DISTINCT FROM ol.member_ref OR rl.debit_amount<>ol.credit_amount OR rl.credit_amount<>ol.debit_amount OR rl.dimensions<>ol.dimensions))
    OR (SELECT count(*) FROM journal_line WHERE tenant_id=NEW.tenant_id AND entity_id=NEW.entity_id AND journal_entry_id=NEW.journal_entry_id)<>(SELECT count(*) FROM journal_line WHERE tenant_id=NEW.tenant_id AND entity_id=NEW.entity_id AND journal_entry_id=original.journal_entry_id) THEN
    RAISE EXCEPTION 'AutoRec reversal lines must be the exact inverse of the original' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER wbs_autorec_reversal_je_guard BEFORE UPDATE ON journal_entry FOR EACH ROW WHEN (NEW.journal_type='WBS_AUTOREC_REVERSAL' AND NEW.status='POSTED') EXECUTE FUNCTION refs_validate_wbs_autorec_reversal_je();

CREATE FUNCTION refs_wbs_autorec_reverse_request_hash(p_tenant uuid,p_entity uuid,p_review uuid,p_reason text) RETURNS text LANGUAGE sql IMMUTABLE SET search_path=pg_catalog,public,pg_temp AS $$ SELECT refs_jsonb_hash(jsonb_build_object('tenant_id',p_tenant,'entity_id',p_entity,'review_id',p_review,'reason',btrim(p_reason))) $$;
CREATE FUNCTION refs_request_wbs_autorec_reverse(p_tenant uuid,p_entity uuid,p_review uuid,p_reason text,p_idempotency text,p_request_hash text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE actor text:=refs_current_actor(); r wbs_autorec_match_review; e wbs_autorec_execution_event; rec idempotency_receipt; id uuid:=gen_random_uuid(); v integer; out jsonb;
BEGIN
  PERFORM refs_assert_scope(p_tenant,p_entity,'BANK.AUTOREC.G11.REVERSE');
  IF actor IS NULL OR p_request_hash<>refs_wbs_autorec_reverse_request_hash(p_tenant,p_entity,p_review,p_reason) OR coalesce(length(btrim(p_reason)),0) NOT BETWEEN 8 AND 2000 THEN RAISE EXCEPTION 'AutoRec reverse request is invalid' USING ERRCODE='22023'; END IF;
  SELECT * INTO r FROM wbs_autorec_match_review WHERE tenant_id=p_tenant AND entity_id=p_entity AND wbs_autorec_match_review_id=p_review AND decision='ACCEPTED';
  IF NOT FOUND OR NOT EXISTS(SELECT 1 FROM wbs_autorec_g11_completion WHERE tenant_id=p_tenant AND entity_id=p_entity AND wbs_autorec_match_review_id=p_review) THEN RAISE EXCEPTION 'Reverse requires completed G11 INCUR evidence' USING ERRCODE='P0002'; END IF;
  INSERT INTO idempotency_receipt(tenant_id,operation_scope,idempotency_key,request_hash,status,actor_id) VALUES(p_tenant,'WBS_AUTOREC_REVERSE_REQUEST:'||p_entity,p_idempotency,p_request_hash,'IN_PROGRESS',actor) ON CONFLICT DO NOTHING;
  SELECT * INTO rec FROM idempotency_receipt WHERE tenant_id=p_tenant AND operation_scope='WBS_AUTOREC_REVERSE_REQUEST:'||p_entity AND idempotency_key=p_idempotency FOR UPDATE;
  IF rec.request_hash<>p_request_hash THEN RAISE EXCEPTION 'Idempotency key reused with a different request' USING ERRCODE='23505'; END IF; IF rec.status='SUCCEEDED' THEN RETURN rec.response_body||jsonb_build_object('idempotent',true); END IF;
  SELECT * INTO e FROM wbs_autorec_execution_event WHERE tenant_id=p_tenant AND entity_id=p_entity AND review_candidate_id=r.review_candidate_id ORDER BY version DESC LIMIT 1 FOR UPDATE;
  IF e.command<>'INCUR' OR e.next_state<>'INCURRED' THEN RAISE EXCEPTION 'Reverse requires latest INCURRED execution' USING ERRCODE='23514'; END IF;
  v:=e.version+1;
  INSERT INTO wbs_autorec_execution_event(execution_receipt_id,tenant_id,entity_id,review_candidate_id,command,current_state,next_state,version,request_hash,idempotency_key,intent) VALUES(id,p_tenant,p_entity,r.review_candidate_id,'REQUEST_REVERSE','INCURRED','REVERSE_DRAFT_REQUIRED',v,p_request_hash,p_idempotency,jsonb_build_object('wbs_autorec_match_review_id',p_review,'reason',btrim(p_reason)));
  out:=jsonb_build_object('execution_receipt_id',id,'review_id',p_review,'command','REQUEST_REVERSE','current_state','INCURRED','next_state','REVERSE_DRAFT_REQUIRED','version',v,'can_create_reverse_draft',true,'can_post',false,'idempotent',false);
  INSERT INTO audit_event(tenant_id,entity_id,event_type,object_type,object_id,action,actor_id,actor_type,permission_used,request_id,correlation_id,idempotency_key,after_hash,reason) VALUES(p_tenant,p_entity,'WBS_AUTOREC_REVERSE_REQUESTED','WBS_AUTOREC_EXECUTION',id,'REQUEST_REVERSE',actor,'USER','BANK.AUTOREC.G11.REVERSE',p_idempotency,p_idempotency,p_idempotency,refs_jsonb_hash(out-'idempotent'),btrim(p_reason));
  UPDATE idempotency_receipt SET status='SUCCEEDED',response_status=201,response_body=out,completed_at=clock_timestamp() WHERE tenant_id=p_tenant AND operation_scope='WBS_AUTOREC_REVERSE_REQUEST:'||p_entity AND idempotency_key=p_idempotency; RETURN out;
END $$;

CREATE FUNCTION refs_wbs_autorec_reverse_draft_hash(p_tenant uuid,p_entity uuid,p_review uuid,p_event_type text,p_original uuid,p_period uuid,p_reason text) RETURNS text LANGUAGE sql IMMUTABLE SET search_path=pg_catalog,public,pg_temp AS $$ SELECT refs_jsonb_hash(jsonb_build_object('tenant_id',p_tenant,'entity_id',p_entity,'review_id',p_review,'event_type',upper(p_event_type),'original_journal_entry_id',p_original,'period_id',p_period,'reason',btrim(p_reason))) $$;
CREATE FUNCTION refs_create_wbs_autorec_reverse_draft(p_tenant uuid,p_entity uuid,p_review uuid,p_event_type text,p_original uuid,p_period uuid,p_reason text,p_idempotency text,p_request_hash text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE actor text:=refs_current_actor(); r wbs_autorec_match_review; c wbs_autorec_g11_completion; e wbs_autorec_execution_event; o journal_entry; jid uuid:=gen_random_uuid(); rid uuid:=gen_random_uuid(); rec idempotency_receipt; out jsonb; perm text:='BANK.AUTOREC.G11.REVERSE_DRAFT';
BEGIN
  PERFORM refs_assert_scope(p_tenant,p_entity,perm); IF actor IS NULL OR p_request_hash<>refs_wbs_autorec_reverse_draft_hash(p_tenant,p_entity,p_review,p_event_type,p_original,p_period,p_reason) THEN RAISE EXCEPTION 'AutoRec reverse draft request is invalid' USING ERRCODE='22023'; END IF;
  SELECT * INTO r FROM wbs_autorec_match_review WHERE tenant_id=p_tenant AND entity_id=p_entity AND wbs_autorec_match_review_id=p_review AND decision='ACCEPTED'; SELECT * INTO c FROM wbs_autorec_g11_completion WHERE tenant_id=p_tenant AND entity_id=p_entity AND wbs_autorec_match_review_id=p_review;
  SELECT * INTO e FROM wbs_autorec_execution_event WHERE tenant_id=p_tenant AND entity_id=p_entity AND review_candidate_id=r.review_candidate_id ORDER BY version DESC LIMIT 1;
  IF e.command<>'REQUEST_REVERSE' OR c.wbs_autorec_g11_completion_id IS NULL OR upper(p_event_type) NOT IN ('PAYABLE_INCUR','AUTOC') THEN RAISE EXCEPTION 'Reverse Draft requires a pending reverse request' USING ERRCODE='23514'; END IF;
  IF p_original<>CASE WHEN upper(p_event_type)='PAYABLE_INCUR' THEN c.payable_incur_journal_entry_id ELSE c.autoc_journal_entry_id END THEN RAISE EXCEPTION 'Original journal is not the selected G11 journal' USING ERRCODE='23514'; END IF;
  SELECT * INTO o FROM journal_entry WHERE tenant_id=p_tenant AND entity_id=p_entity AND journal_entry_id=p_original FOR SHARE; IF o.status<>'POSTED' OR o.journal_type<>'AUTO' THEN RAISE EXCEPTION 'Original G11 journal must be POSTED AUTO' USING ERRCODE='23514'; END IF;
  PERFORM 1 FROM accounting_period WHERE tenant_id=p_tenant AND entity_id=p_entity AND period_id=p_period AND status='OPEN' AND o.journal_date BETWEEN starts_on AND ends_on FOR SHARE; IF NOT FOUND THEN RAISE EXCEPTION 'Reverse Draft requires an OPEN period' USING ERRCODE='55000'; END IF;
  INSERT INTO idempotency_receipt(tenant_id,operation_scope,idempotency_key,request_hash,status,actor_id) VALUES(p_tenant,'WBS_AUTOREC_REVERSE_DRAFT:'||p_entity,p_idempotency,p_request_hash,'IN_PROGRESS',actor) ON CONFLICT DO NOTHING;
  SELECT * INTO rec FROM idempotency_receipt WHERE tenant_id=p_tenant AND operation_scope='WBS_AUTOREC_REVERSE_DRAFT:'||p_entity AND idempotency_key=p_idempotency FOR UPDATE; IF rec.request_hash<>p_request_hash THEN RAISE EXCEPTION 'Idempotency key reused with a different request' USING ERRCODE='23505'; END IF; IF rec.status='SUCCEEDED' THEN RETURN rec.response_body||jsonb_build_object('idempotent',true); END IF;
  IF EXISTS(SELECT 1 FROM wbs_autorec_reversal WHERE tenant_id=p_tenant AND entity_id=p_entity AND original_journal_entry_id=p_original) THEN RAISE EXCEPTION 'A reversal Draft already exists for this G11 journal' USING ERRCODE='23505'; END IF;
  INSERT INTO journal_entry(journal_entry_id,tenant_id,entity_id,period_id,journal_number,journal_type,status,journal_date,currency,description,created_by,reversal_of_id) VALUES(jid,p_tenant,p_entity,p_period,'WBS-REV-'||substr(replace(jid::text,'-',''),1,20),'WBS_AUTOREC_REVERSAL','DRAFT',o.journal_date,o.currency,'WBS AutoRec reversal: '||btrim(p_reason),actor,p_original);
  INSERT INTO journal_line(tenant_id,entity_id,period_id,journal_entry_id,line_no,account_code,debit_amount,credit_amount,member_ref,description,dimensions) SELECT p_tenant,p_entity,p_period,jid,line_no,account_code,credit_amount,debit_amount,member_ref,description,dimensions FROM journal_line WHERE tenant_id=p_tenant AND entity_id=p_entity AND journal_entry_id=p_original;
  INSERT INTO wbs_autorec_reversal(wbs_autorec_reversal_id,tenant_id,entity_id,wbs_autorec_match_review_id,event_type,original_journal_entry_id,reversal_journal_entry_id,reason,created_by,request_hash,idempotency_key) VALUES(rid,p_tenant,p_entity,p_review,upper(p_event_type),p_original,jid,btrim(p_reason),actor,p_request_hash,p_idempotency);
  out:=jsonb_build_object('wbs_autorec_reversal_id',rid,'review_id',p_review,'event_type',upper(p_event_type),'original_journal_entry_id',p_original,'reversal_journal_entry_id',jid,'journal_type','WBS_AUTOREC_REVERSAL','status','DRAFT','can_post',false,'idempotent',false);
  INSERT INTO audit_event(tenant_id,entity_id,event_type,object_type,object_id,action,actor_id,actor_type,permission_used,request_id,correlation_id,idempotency_key,after_hash,reason) VALUES(p_tenant,p_entity,'WBS_AUTOREC_REVERSE_DRAFT_CREATED','WBS_AUTOREC_REVERSAL',rid,'CREATE_REVERSE_DRAFT',actor,'USER',perm,p_idempotency,p_idempotency,p_idempotency,refs_jsonb_hash(out-'idempotent'),btrim(p_reason));
  UPDATE idempotency_receipt SET status='SUCCEEDED',response_status=201,response_body=out,completed_at=clock_timestamp() WHERE tenant_id=p_tenant AND operation_scope='WBS_AUTOREC_REVERSE_DRAFT:'||p_entity AND idempotency_key=p_idempotency; RETURN out;
END $$;

CREATE FUNCTION refs_complete_wbs_autorec_reverse(p_tenant uuid,p_entity uuid,p_review uuid,p_reason text,p_idempotency text,p_request_hash text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE actor text:=refs_current_actor(); r wbs_autorec_match_review; e wbs_autorec_execution_event; rec idempotency_receipt; v integer; id uuid:=gen_random_uuid(); out jsonb; prior_actor text;
BEGIN
  PERFORM refs_assert_scope(p_tenant,p_entity,'BANK.AUTOREC.G11.REVERSE'); IF actor IS NULL OR p_request_hash<>refs_wbs_autorec_reverse_request_hash(p_tenant,p_entity,p_review,p_reason) THEN RAISE EXCEPTION 'AutoRec reverse completion request is invalid' USING ERRCODE='22023'; END IF;
  INSERT INTO idempotency_receipt(tenant_id,operation_scope,idempotency_key,request_hash,status,actor_id) VALUES(p_tenant,'WBS_AUTOREC_REVERSE_COMPLETE:'||p_entity,p_idempotency,p_request_hash,'IN_PROGRESS',actor) ON CONFLICT DO NOTHING;
  SELECT * INTO rec FROM idempotency_receipt WHERE tenant_id=p_tenant AND operation_scope='WBS_AUTOREC_REVERSE_COMPLETE:'||p_entity AND idempotency_key=p_idempotency FOR UPDATE; IF rec.request_hash<>p_request_hash THEN RAISE EXCEPTION 'Idempotency key reused with a different request' USING ERRCODE='23505'; END IF; IF rec.status='SUCCEEDED' THEN RETURN rec.response_body||jsonb_build_object('idempotent',true); END IF;
  SELECT * INTO r FROM wbs_autorec_match_review WHERE tenant_id=p_tenant AND entity_id=p_entity AND wbs_autorec_match_review_id=p_review AND decision='ACCEPTED'; SELECT * INTO e FROM wbs_autorec_execution_event WHERE tenant_id=p_tenant AND entity_id=p_entity AND review_candidate_id=r.review_candidate_id ORDER BY version DESC LIMIT 1 FOR UPDATE;
  IF e.command<>'REQUEST_REVERSE' OR (SELECT count(*) FROM wbs_autorec_reversal x WHERE x.tenant_id=p_tenant AND x.entity_id=p_entity AND x.wbs_autorec_match_review_id=p_review AND EXISTS(SELECT 1 FROM journal_entry j WHERE j.journal_entry_id=x.reversal_journal_entry_id AND j.status='POSTED'))<>2 THEN RAISE EXCEPTION 'Reverse completion requires two Posted reversal journals' USING ERRCODE='23514'; END IF;
  SELECT x.created_by INTO prior_actor FROM wbs_autorec_reversal x WHERE x.tenant_id=p_tenant AND x.entity_id=p_entity AND x.wbs_autorec_match_review_id=p_review AND x.created_by=actor LIMIT 1;
  IF prior_actor IS NOT NULL OR actor IN (r.candidate_prepared_by,r.matched_by,r.reviewed_by) THEN RAISE EXCEPTION 'AutoRec reverse finalizer SoD violation' USING ERRCODE='42501'; END IF;
  v:=e.version+1; INSERT INTO wbs_autorec_execution_event(execution_receipt_id,tenant_id,entity_id,review_candidate_id,command,current_state,next_state,version,request_hash,idempotency_key,intent) VALUES(id,p_tenant,p_entity,r.review_candidate_id,'COMPLETE_REVERSE','REVERSE_DRAFT_REQUIRED','REVERSED',v,p_request_hash,p_idempotency,jsonb_build_object('wbs_autorec_match_review_id',p_review,'reason',btrim(p_reason)));
  out:=jsonb_build_object('execution_receipt_id',id,'review_id',p_review,'command','COMPLETE_REVERSE','current_state','REVERSE_DRAFT_REQUIRED','next_state','REVERSED','version',v,'reversed',true,'can_post',false,'idempotent',false);
  INSERT INTO audit_event(tenant_id,entity_id,event_type,object_type,object_id,action,actor_id,actor_type,permission_used,request_id,correlation_id,idempotency_key,after_hash,reason) VALUES(p_tenant,p_entity,'WBS_AUTOREC_REVERSED','WBS_AUTOREC_EXECUTION',id,'COMPLETE_REVERSE',actor,'USER','BANK.AUTOREC.G11.REVERSE',p_idempotency,p_idempotency,p_idempotency,refs_jsonb_hash(out-'idempotent'),btrim(p_reason));
  UPDATE idempotency_receipt SET status='SUCCEEDED',response_status=201,response_body=out,completed_at=clock_timestamp() WHERE tenant_id=p_tenant AND operation_scope='WBS_AUTOREC_REVERSE_COMPLETE:'||p_entity AND idempotency_key=p_idempotency; RETURN out;
END $$;

REVOKE ALL ON TABLE wbs_autorec_reversal FROM PUBLIC,refs_app; GRANT SELECT ON TABLE wbs_autorec_reversal TO refs_app;
GRANT EXECUTE ON FUNCTION refs_request_wbs_autorec_reverse(uuid,uuid,uuid,text,text,text),refs_create_wbs_autorec_reverse_draft(uuid,uuid,uuid,text,uuid,uuid,text,text,text),refs_complete_wbs_autorec_reverse(uuid,uuid,uuid,text,text,text) TO refs_app;
COMMIT;
