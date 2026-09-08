BEGIN;

INSERT INTO permission_catalog(permission_code,domain,risk_class,sod_class) VALUES
 ('MASTER.COUNTERPARTY.PROPOSE','MASTER','HIGH','COUNTERPARTY_MAKER'),
 ('MASTER.COUNTERPARTY.APPROVE','MASTER','HIGH','COUNTERPARTY_APPROVER');
INSERT INTO runtime_human_permission_authority(permission_code,authority_class) VALUES
 ('MASTER.COUNTERPARTY.PROPOSE','DRAFT'),('MASTER.COUNTERPARTY.APPROVE','APPROVE');

ALTER TABLE member_master ADD COLUMN counterparty_version bigint NOT NULL DEFAULT 0 CHECK(counterparty_version>=0);
CREATE FUNCTION refs_counterparty_version_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog,public,pg_temp AS $$
BEGIN
 IF OLD.member_type IN ('VENDOR','CUSTOMER') OR NEW.member_type IN ('VENDOR','CUSTOMER') THEN
  IF (NEW.tenant_id,NEW.entity_id,NEW.member_ref,NEW.member_type) IS DISTINCT FROM
     (OLD.tenant_id,OLD.entity_id,OLD.member_ref,OLD.member_type) THEN
   RAISE EXCEPTION 'Counterparty identity is immutable' USING ERRCODE='23514';
  END IF;
  NEW.counterparty_version:=OLD.counterparty_version+1;
 ELSE NEW.counterparty_version:=OLD.counterparty_version;
 END IF;
 RETURN NEW;
END; $$;
CREATE TRIGGER counterparty_version_guard BEFORE UPDATE ON member_master
 FOR EACH ROW EXECUTE FUNCTION refs_counterparty_version_guard();

CREATE TABLE counterparty_change (
 counterparty_change_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 tenant_id uuid NOT NULL,entity_id uuid NOT NULL,
 member_ref text NOT NULL CHECK(length(member_ref) BETWEEN 1 AND 128),
 member_type text NOT NULL CHECK(member_type IN ('VENDOR','CUSTOMER')),
 change_type text NOT NULL CHECK(change_type IN ('CREATE','UPDATE')),
 expected_version bigint NOT NULL CHECK(expected_version>=0),
 before_state jsonb,desired_state jsonb NOT NULL,
 reason text NOT NULL,proposed_by text NOT NULL,created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 status text NOT NULL DEFAULT 'PENDING' CHECK(status IN ('PENDING','APPROVED','REJECTED')),
 version bigint NOT NULL DEFAULT 0 CHECK(version>=0),
 reviewed_by text,review_reason text,reviewed_at timestamptz,
 FOREIGN KEY(tenant_id,entity_id) REFERENCES entity(tenant_id,entity_id),
 CHECK((change_type='CREATE')=(before_state IS NULL)),
 CHECK((status='PENDING' AND reviewed_by IS NULL AND reviewed_at IS NULL AND review_reason IS NULL AND version=0)
    OR (status<>'PENDING' AND reviewed_by IS NOT NULL AND reviewed_at IS NOT NULL AND review_reason IS NOT NULL AND version=1)),
 CHECK(reviewed_by IS NULL OR reviewed_by<>proposed_by)
);
CREATE INDEX counterparty_change_scope_idx ON counterparty_change(tenant_id,entity_id,member_ref,created_at,counterparty_change_id);
REVOKE ALL ON counterparty_change FROM PUBLIC,refs_app,refs_runtime;

CREATE FUNCTION refs_propose_counterparty_change(p_tenant uuid,p_entity uuid,p_kind text,p_ref text,
 p_change_type text,p_expected_version bigint,p_display_name text,p_active boolean,p_reason text,p_idempotency_key text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE actor text:=refs_current_actor();request_hash text;receipt idempotency_receipt;
 master member_master;before_state jsonb;desired jsonb;change_id uuid:=gen_random_uuid();response jsonb;event_payload jsonb;
BEGIN
 PERFORM refs_assert_scope(p_tenant,p_entity,'MASTER.COUNTERPARTY.PROPOSE');
 IF p_kind IS NULL OR p_kind NOT IN ('VENDOR','CUSTOMER') OR p_change_type IS NULL OR p_change_type NOT IN ('CREATE','UPDATE')
  OR p_ref IS NULL OR length(p_ref) NOT BETWEEN 1 AND 128 OR p_ref<>btrim(p_ref) OR p_ref~'[[:cntrl:]]'
  OR p_expected_version IS NULL OR p_expected_version<0 OR p_expected_version>9007199254740991
  OR p_display_name IS NULL OR length(p_display_name) NOT BETWEEN 1 AND 256 OR p_display_name<>btrim(p_display_name) OR p_display_name~'[[:cntrl:]]'
  OR p_active IS NULL OR p_reason IS NULL OR length(p_reason) NOT BETWEEN 8 AND 2000 OR p_reason<>btrim(p_reason) OR p_reason~'[[:cntrl:]]'
  OR p_idempotency_key IS NULL OR p_idempotency_key!~'^[A-Za-z0-9._:-]{8,128}$'
  OR (p_change_type='CREATE' AND (p_expected_version<>0 OR NOT p_active)) THEN
  RAISE EXCEPTION 'Counterparty change requires valid identity, revision, fields and reason' USING ERRCODE='22023';
 END IF;
 desired:=jsonb_build_object('display_name',p_display_name,'active',p_active);
 request_hash:=refs_jsonb_hash(jsonb_build_object('tenant_id',p_tenant,'entity_id',p_entity,'actor_id',actor,
  'kind',p_kind,'member_ref',p_ref,'change_type',p_change_type,'expected_version',p_expected_version,'desired',desired,'reason',p_reason));
 INSERT INTO idempotency_receipt(tenant_id,operation_scope,idempotency_key,request_hash,status,actor_id)
  VALUES(p_tenant,'COUNTERPARTY_PROPOSE:'||p_entity,p_idempotency_key,request_hash,'IN_PROGRESS',actor)
  ON CONFLICT(tenant_id,operation_scope,idempotency_key) DO NOTHING;
 SELECT * INTO receipt FROM idempotency_receipt WHERE tenant_id=p_tenant AND operation_scope='COUNTERPARTY_PROPOSE:'||p_entity
  AND idempotency_key=p_idempotency_key FOR UPDATE;
 IF receipt.request_hash<>request_hash OR receipt.actor_id<>actor THEN RAISE EXCEPTION 'Idempotency key conflicts with counterparty change' USING ERRCODE='23505'; END IF;
 IF receipt.status='SUCCEEDED' THEN RETURN receipt.response_body||jsonb_build_object('idempotent',true); END IF;
 SELECT * INTO master FROM member_master WHERE tenant_id=p_tenant AND entity_id=p_entity AND member_ref=p_ref FOR SHARE;
 IF p_change_type='CREATE' THEN
  IF FOUND THEN RAISE EXCEPTION 'Counterparty reference already exists' USING ERRCODE='23505'; END IF;
 ELSE
  IF NOT FOUND OR master.member_type<>p_kind THEN RAISE EXCEPTION 'Counterparty is unavailable in this company' USING ERRCODE='23503'; END IF;
  IF master.counterparty_version<>p_expected_version THEN RAISE EXCEPTION 'Counterparty revision changed' USING ERRCODE='55000'; END IF;
  before_state:=jsonb_build_object('display_name',master.display_name,'active',master.active,'revision',master.counterparty_version);
  IF desired=before_state-'revision' THEN RAISE EXCEPTION 'Counterparty change has no changed fields' USING ERRCODE='22023'; END IF;
 END IF;
 INSERT INTO counterparty_change(counterparty_change_id,tenant_id,entity_id,member_ref,member_type,change_type,expected_version,before_state,desired_state,reason,proposed_by)
  VALUES(change_id,p_tenant,p_entity,p_ref,p_kind,p_change_type,p_expected_version,before_state,desired,p_reason,actor);
 response:=jsonb_build_object('counterparty_change_id',change_id,'entity_id',p_entity,'member_ref',p_ref,'kind',p_kind,'status','PENDING','revision',0,'idempotent',false);
 INSERT INTO audit_event(tenant_id,entity_id,event_type,object_type,object_id,action,actor_id,actor_type,permission_used,request_id,correlation_id,idempotency_key,before_hash,after_hash)
  VALUES(p_tenant,p_entity,'COUNTERPARTY_CHANGE_PROPOSED','COUNTERPARTY_CHANGE',change_id,'PROPOSE_COUNTERPARTY_CHANGE',actor,'USER','MASTER.COUNTERPARTY.PROPOSE',p_idempotency_key,p_idempotency_key,p_idempotency_key,
   CASE WHEN before_state IS NOT NULL THEN refs_jsonb_hash(before_state) END,request_hash);
 event_payload:=response-'idempotent';
 INSERT INTO outbox_event(tenant_id,entity_id,aggregate_type,aggregate_id,event_type,payload,payload_hash)
  VALUES(p_tenant,p_entity,'COUNTERPARTY_CHANGE',change_id,'COUNTERPARTY_CHANGE_PROPOSED',event_payload,refs_jsonb_hash(event_payload));
 UPDATE idempotency_receipt SET status='SUCCEEDED',response_status=201,response_body=response,completed_at=clock_timestamp()
  WHERE tenant_id=p_tenant AND operation_scope='COUNTERPARTY_PROPOSE:'||p_entity AND idempotency_key=p_idempotency_key;
 RETURN response;
END; $$;

CREATE FUNCTION refs_review_counterparty_change(p_tenant uuid,p_entity uuid,p_change_id uuid,
 p_expected_version bigint,p_decision text,p_reason text,p_idempotency_key text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE actor text:=refs_current_actor();request_hash text;receipt idempotency_receipt;proposal counterparty_change;
 master member_master;response jsonb;event_payload jsonb;applied_version bigint;
BEGIN
 PERFORM refs_assert_scope(p_tenant,p_entity,'MASTER.COUNTERPARTY.APPROVE');
 IF p_change_id IS NULL OR p_expected_version IS NULL OR p_expected_version<>0 OR p_decision IS NULL OR p_decision NOT IN ('APPROVE','REJECT')
  OR p_reason IS NULL OR length(p_reason) NOT BETWEEN 8 AND 2000 OR p_reason<>btrim(p_reason) OR p_reason~'[[:cntrl:]]'
  OR p_idempotency_key IS NULL OR p_idempotency_key!~'^[A-Za-z0-9._:-]{8,128}$' THEN
  RAISE EXCEPTION 'Counterparty review requires exact revision, decision and reason' USING ERRCODE='22023';
 END IF;
 request_hash:=refs_jsonb_hash(jsonb_build_object('tenant_id',p_tenant,'entity_id',p_entity,'actor_id',actor,
  'change_id',p_change_id,'expected_version',p_expected_version,'decision',p_decision,'reason',p_reason));
 INSERT INTO idempotency_receipt(tenant_id,operation_scope,idempotency_key,request_hash,status,actor_id)
  VALUES(p_tenant,'COUNTERPARTY_REVIEW:'||p_entity,p_idempotency_key,request_hash,'IN_PROGRESS',actor)
  ON CONFLICT(tenant_id,operation_scope,idempotency_key) DO NOTHING;
 SELECT * INTO receipt FROM idempotency_receipt WHERE tenant_id=p_tenant AND operation_scope='COUNTERPARTY_REVIEW:'||p_entity
  AND idempotency_key=p_idempotency_key FOR UPDATE;
 IF receipt.request_hash<>request_hash OR receipt.actor_id<>actor THEN RAISE EXCEPTION 'Idempotency key conflicts with counterparty review' USING ERRCODE='23505'; END IF;
 IF receipt.status='SUCCEEDED' THEN RETURN receipt.response_body||jsonb_build_object('idempotent',true); END IF;
 SELECT * INTO proposal FROM counterparty_change WHERE tenant_id=p_tenant AND entity_id=p_entity AND counterparty_change_id=p_change_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Counterparty change is unavailable in this company' USING ERRCODE='23503'; END IF;
 IF proposal.proposed_by=actor THEN RAISE EXCEPTION 'Counterparty maker cannot review their own change' USING ERRCODE='42501'; END IF;
 IF proposal.status<>'PENDING' OR proposal.version<>p_expected_version THEN RAISE EXCEPTION 'Counterparty change is no longer pending at this revision' USING ERRCODE='55000'; END IF;
 IF p_decision='APPROVE' THEN
  IF proposal.change_type='CREATE' THEN
   INSERT INTO member_master(tenant_id,entity_id,member_ref,member_type,display_name,active)
    VALUES(p_tenant,p_entity,proposal.member_ref,proposal.member_type,proposal.desired_state->>'display_name',(proposal.desired_state->>'active')::boolean)
    RETURNING counterparty_version INTO applied_version;
  ELSE
   SELECT * INTO master FROM member_master WHERE tenant_id=p_tenant AND entity_id=p_entity AND member_ref=proposal.member_ref FOR UPDATE;
   IF NOT FOUND OR master.member_type<>proposal.member_type THEN RAISE EXCEPTION 'Counterparty is unavailable in this company' USING ERRCODE='23503'; END IF;
   IF master.counterparty_version<>proposal.expected_version OR
    jsonb_build_object('display_name',master.display_name,'active',master.active,'revision',master.counterparty_version)<>proposal.before_state THEN
    RAISE EXCEPTION 'Counterparty changed since proposal; review a new change' USING ERRCODE='55000';
   END IF;
   UPDATE member_master SET display_name=proposal.desired_state->>'display_name',active=(proposal.desired_state->>'active')::boolean
    WHERE tenant_id=p_tenant AND entity_id=p_entity AND member_ref=proposal.member_ref RETURNING counterparty_version INTO applied_version;
  END IF;
 END IF;
 UPDATE counterparty_change SET status=CASE p_decision WHEN 'APPROVE' THEN 'APPROVED' ELSE 'REJECTED' END,
  version=version+1,reviewed_by=actor,review_reason=p_reason,reviewed_at=clock_timestamp() WHERE counterparty_change_id=p_change_id;
 response:=jsonb_build_object('counterparty_change_id',p_change_id,'entity_id',p_entity,'member_ref',proposal.member_ref,'kind',proposal.member_type,
  'status',CASE p_decision WHEN 'APPROVE' THEN 'APPROVED' ELSE 'REJECTED' END,'revision',1,'member_revision',applied_version,'idempotent',false);
 INSERT INTO audit_event(tenant_id,entity_id,event_type,object_type,object_id,action,actor_id,actor_type,permission_used,request_id,correlation_id,idempotency_key,before_hash,after_hash)
  VALUES(p_tenant,p_entity,'COUNTERPARTY_CHANGE_REVIEWED','COUNTERPARTY_CHANGE',p_change_id,'REVIEW_COUNTERPARTY_CHANGE',actor,'USER','MASTER.COUNTERPARTY.APPROVE',p_idempotency_key,p_idempotency_key,p_idempotency_key,refs_jsonb_hash(to_jsonb(proposal)),request_hash);
 event_payload:=response-'idempotent';
 INSERT INTO outbox_event(tenant_id,entity_id,aggregate_type,aggregate_id,event_type,payload,payload_hash)
  VALUES(p_tenant,p_entity,'COUNTERPARTY_CHANGE',p_change_id,'COUNTERPARTY_CHANGE_REVIEWED',event_payload,refs_jsonb_hash(event_payload));
 UPDATE idempotency_receipt SET status='SUCCEEDED',response_status=200,response_body=response,completed_at=clock_timestamp()
  WHERE tenant_id=p_tenant AND operation_scope='COUNTERPARTY_REVIEW:'||p_entity AND idempotency_key=p_idempotency_key;
 RETURN response;
END; $$;
REVOKE ALL ON FUNCTION refs_counterparty_version_guard(),
 refs_propose_counterparty_change(uuid,uuid,text,text,text,bigint,text,boolean,text,text),
 refs_review_counterparty_change(uuid,uuid,uuid,bigint,text,text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION refs_propose_counterparty_change(uuid,uuid,text,text,text,bigint,text,boolean,text,text),
 refs_review_counterparty_change(uuid,uuid,uuid,bigint,text,text,text) TO refs_app;
COMMIT;
