BEGIN;

INSERT INTO permission_catalog(permission_code,domain,risk_class,sod_class) VALUES
 ('WBS.INSURANCE.PC_MAPPING.VIEW','WBS','LOW','READ'),
 ('WBS.INSURANCE.PC_MAPPING.PROPOSE','WBS','HIGH','WBS_INSURANCE_PC_MAPPING_PROPOSER'),
 ('WBS.INSURANCE.PC_MAPPING.APPROVE','WBS','CRITICAL','WBS_INSURANCE_PC_MAPPING_APPROVER')
ON CONFLICT(permission_code) DO UPDATE SET active=true,effective_to=NULL,domain=EXCLUDED.domain,
 risk_class=EXCLUDED.risk_class,sod_class=EXCLUDED.sod_class,version=permission_catalog.version+1;

CREATE TABLE wbs_insurance_pc_mapping_pre_admission_observation (
 observation_id uuid PRIMARY KEY,
 tenant_id uuid NOT NULL,
 entity_id uuid NOT NULL,
 observation_hash text NOT NULL CHECK(observation_hash~'^sha256:[0-9a-f]{64}$'),
 source_evidence_hash text NOT NULL CHECK(source_evidence_hash~'^sha256:[0-9a-f]{64}$'),
 artifact_set_hash text NOT NULL CHECK(artifact_set_hash~'^sha256:[0-9a-f]{64}$'),
 package_hash text NOT NULL CHECK(package_hash~'^sha256:[0-9a-f]{64}$'),
 source_payload_hash text NOT NULL CHECK(source_payload_hash~'^sha256:[0-9a-f]{64}$'),
 canonical_set_hash text NOT NULL CHECK(canonical_set_hash~'^sha256:[0-9a-f]{64}$'),
 captured_at timestamptz NOT NULL,
 record_count bigint NOT NULL CHECK(record_count>0),
 null_pc_code_row_count bigint NOT NULL CHECK(null_pc_code_row_count BETWEEN 0 AND record_count),
 scope_pc_code_count integer NOT NULL CHECK(scope_pc_code_count BETWEEN 1 AND 5000),
 artifact_document jsonb NOT NULL CHECK(jsonb_typeof(artifact_document)='object'),
 observation_document jsonb NOT NULL CHECK(jsonb_typeof(observation_document)='object'),
 observed_by text NOT NULL CHECK(length(btrim(observed_by)) BETWEEN 1 AND 256),
 observed_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 UNIQUE(tenant_id,entity_id,observation_id),
 UNIQUE(tenant_id,entity_id,observation_hash),
 FOREIGN KEY(tenant_id,entity_id) REFERENCES entity(tenant_id,entity_id),
 CHECK(observation_hash=refs_jsonb_hash(observation_document)),
 CHECK(observation_document->>'schema_version'='REFS_INSURANCE_PRE_ADMISSION_OBSERVATION_V1'
   AND observation_document->>'status'='PRE_ADMISSION_OBSERVATION'
   AND observation_document->>'admission_state'='NOT_ADMITTED'
   AND observation_document->>'source_kind'='PRE_ADMISSION_OBSERVATION'
   AND observation_document->>'scope_kind'='FIRST_PACKAGE_WBPA'
   AND (observation_document->>'scope_pc_code_count')::integer=scope_pc_code_count
   AND observation_document->>'signature_algorithm'='Ed25519'
   AND (observation_document->>'signature_verified')::boolean
   AND observation_document->>'observation_id'=observation_id::text
   AND observation_document->>'source_evidence_hash'=source_evidence_hash
   AND observation_document->>'artifact_set_hash'=artifact_set_hash
   AND observation_document->>'package_hash'=package_hash
   AND observation_document->>'source_payload_hash'=source_payload_hash
   AND observation_document->>'canonical_set_hash'=canonical_set_hash)
);

CREATE FUNCTION refs_validate_wbs_insurance_pre_admission_observation() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE artifact_name text;artifact_value jsonb;
BEGIN
 IF NEW.observation_document->'artifacts' IS DISTINCT FROM NEW.artifact_document
    OR jsonb_typeof(NEW.artifact_document)<>'object' OR (SELECT count(*) FROM jsonb_each(NEW.artifact_document))<>4
    OR NOT (NEW.artifact_document ?& ARRAY['receipt','request','response','package'])
    OR (NEW.observation_document#>>'{write_delta,admission}')::integer<>0 OR (NEW.observation_document#>>'{write_delta,retention}')::integer<>0
    OR (NEW.observation_document#>>'{write_delta,coverage}')::integer<>0 OR (NEW.observation_document#>>'{write_delta,staging}')::integer<>0
    OR (NEW.observation_document#>>'{write_delta,journal_entry}')::integer<>0 OR (NEW.observation_document#>>'{write_delta,ledger}')::integer<>0
    OR (NEW.observation_document#>>'{write_delta,audit}')::integer<>0 OR (NEW.observation_document#>>'{write_delta,outbox}')::integer<>0
    OR (NEW.observation_document#>>'{write_delta,model_call}')::integer<>0 OR (NEW.observation_document#>>'{write_delta,storage_action}')::integer<>0
    OR (NEW.observation_document#>>'{actions,can_propose_amortization}')::boolean OR (NEW.observation_document#>>'{actions,can_create_draft}')::boolean
    OR (NEW.observation_document#>>'{actions,can_review}')::boolean OR (NEW.observation_document#>>'{actions,can_approve}')::boolean OR (NEW.observation_document#>>'{actions,can_post}')::boolean THEN
   RAISE EXCEPTION 'Insurance pre-admission observation is not exact zero-action evidence' USING ERRCODE='23514';
 END IF;
 FOR artifact_name,artifact_value IN SELECT key,value FROM jsonb_each(NEW.artifact_document) LOOP
  IF jsonb_typeof(artifact_value)<>'object' OR artifact_value->>'storage_ref'!~'^s3://' OR coalesce(artifact_value->>'storage_version','')='' OR artifact_value->>'storage_version'~'^pending:'
    OR artifact_value->>'content_hash'!~'^sha256:[0-9a-f]{64}$' OR coalesce((artifact_value->>'size_bytes')::bigint,0)<=0
    OR artifact_value->>'object_lock_mode'<>'COMPLIANCE' OR (artifact_value->>'retain_until')::timestamptz<=clock_timestamp()
    OR artifact_value->>'scan_disposition'<>'CLEAN' OR artifact_value->>'scan_hash'!~'^sha256:[0-9a-f]{64}$' OR coalesce(artifact_value->>'scan_ref','')='' THEN
   RAISE EXCEPTION 'Insurance pre-admission artifact is not exact ObjectLock clean evidence' USING ERRCODE='23514';
  END IF;
 END LOOP;RETURN NEW;
END $$;
CREATE TRIGGER wbs_insurance_pc_mapping_pre_admission_validate BEFORE INSERT ON wbs_insurance_pc_mapping_pre_admission_observation FOR EACH ROW EXECUTE FUNCTION refs_validate_wbs_insurance_pre_admission_observation();

CREATE TABLE wbs_insurance_pc_mapping_pre_admission_row (
 observation_row_id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL,entity_id uuid NOT NULL,
 observation_id uuid NOT NULL,row_ordinal integer NOT NULL CHECK(row_ordinal>=0),
 pc_code text NOT NULL CHECK(pc_code=btrim(pc_code) AND length(pc_code) BETWEEN 1 AND 128 AND pc_code!~'[[:cntrl:]]'),
 observed_row_count bigint NOT NULL CHECK(observed_row_count>0),row_hash text NOT NULL CHECK(row_hash~'^sha256:[0-9a-f]{64}$'),
 UNIQUE(tenant_id,entity_id,observation_id,row_ordinal),UNIQUE(tenant_id,entity_id,observation_id,pc_code),
 UNIQUE(tenant_id,entity_id,observation_row_id),
 FOREIGN KEY(tenant_id,entity_id,observation_id) REFERENCES wbs_insurance_pc_mapping_pre_admission_observation(tenant_id,entity_id,observation_id)
);

CREATE TABLE wbs_insurance_pc_mapping_proposal (
 proposal_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),tenant_id uuid NOT NULL,entity_id uuid NOT NULL,observation_id uuid NOT NULL,
 revision bigint NOT NULL DEFAULT 0 CHECK(revision=0),observation_hash text NOT NULL CHECK(observation_hash~'^sha256:[0-9a-f]{64}$'),
 canonical_set_hash text NOT NULL CHECK(canonical_set_hash~'^sha256:[0-9a-f]{64}$'),proposal_document jsonb NOT NULL CHECK(jsonb_typeof(proposal_document)='object'),
 proposal_hash text NOT NULL CHECK(proposal_hash~'^sha256:[0-9a-f]{64}$' AND proposal_hash=refs_jsonb_hash(proposal_document)),
 reason text NOT NULL CHECK(length(btrim(reason)) BETWEEN 8 AND 2000),proposed_by text NOT NULL,proposed_at timestamptz NOT NULL DEFAULT clock_timestamp(),request_hash text NOT NULL CHECK(request_hash~'^sha256:[0-9a-f]{64}$'),
 UNIQUE(tenant_id,entity_id,proposal_id),UNIQUE(tenant_id,entity_id,observation_id),
 FOREIGN KEY(tenant_id,entity_id,observation_id) REFERENCES wbs_insurance_pc_mapping_pre_admission_observation(tenant_id,entity_id,observation_id),
 FOREIGN KEY(tenant_id,entity_id) REFERENCES entity(tenant_id,entity_id)
);

CREATE TABLE wbs_insurance_pc_mapping_approval (
 approval_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),tenant_id uuid NOT NULL,entity_id uuid NOT NULL,proposal_id uuid NOT NULL,
 revision bigint NOT NULL CHECK(revision=1),observation_hash text NOT NULL,proposal_hash text NOT NULL,canonical_set_hash text NOT NULL,
 catalog_decision_id uuid NOT NULL,company_mapping_hash text NOT NULL CHECK(company_mapping_hash~'^sha256:[0-9a-f]{64}$'),
 effective_from date NOT NULL,effective_to date,decision_hash text NOT NULL CHECK(decision_hash~'^sha256:[0-9a-f]{64}$'),
 approval_document jsonb NOT NULL CHECK(jsonb_typeof(approval_document)='object'),approved_by text NOT NULL,approved_at timestamptz NOT NULL DEFAULT clock_timestamp(),reason text NOT NULL,request_hash text NOT NULL,
 UNIQUE(tenant_id,entity_id,approval_id),UNIQUE(tenant_id,entity_id,proposal_id),
 FOREIGN KEY(tenant_id,entity_id,proposal_id) REFERENCES wbs_insurance_pc_mapping_proposal(tenant_id,entity_id,proposal_id),
 FOREIGN KEY(tenant_id,entity_id,catalog_decision_id) REFERENCES wbs_company_catalog_controller_decision(tenant_id,entity_id,wbs_company_catalog_controller_decision_id),
 CHECK(effective_to IS NULL OR effective_to>=effective_from),CHECK(decision_hash=refs_jsonb_hash(approval_document))
);

CREATE TABLE wbs_insurance_pc_mapping_decision_trace (
 tenant_id uuid NOT NULL,entity_id uuid NOT NULL,approval_id uuid NOT NULL,proposal_id uuid NOT NULL,observation_id uuid NOT NULL,
 observation_row_id uuid NOT NULL,wbs_insurance_pc_company_mapping_decision_id uuid NOT NULL,
 pc_code text NOT NULL,observation_hash text NOT NULL,proposal_hash text NOT NULL,decision_hash text NOT NULL,company_mapping_hash text NOT NULL,
 PRIMARY KEY(tenant_id,entity_id,wbs_insurance_pc_company_mapping_decision_id),UNIQUE(tenant_id,entity_id,approval_id,pc_code),
 FOREIGN KEY(tenant_id,entity_id,approval_id) REFERENCES wbs_insurance_pc_mapping_approval(tenant_id,entity_id,approval_id),
 FOREIGN KEY(tenant_id,entity_id,proposal_id) REFERENCES wbs_insurance_pc_mapping_proposal(tenant_id,entity_id,proposal_id),
 FOREIGN KEY(tenant_id,entity_id,observation_row_id) REFERENCES wbs_insurance_pc_mapping_pre_admission_row(tenant_id,entity_id,observation_row_id),
 FOREIGN KEY(wbs_insurance_pc_company_mapping_decision_id) REFERENCES wbs_insurance_pc_company_mapping_decision(wbs_insurance_pc_company_mapping_decision_id)
);

DO $$ DECLARE n text; BEGIN FOREACH n IN ARRAY ARRAY['wbs_insurance_pc_mapping_pre_admission_observation','wbs_insurance_pc_mapping_pre_admission_row','wbs_insurance_pc_mapping_proposal','wbs_insurance_pc_mapping_approval','wbs_insurance_pc_mapping_decision_trace'] LOOP
 EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY',n);
 EXECUTE format('CREATE POLICY %I ON %I USING(tenant_id=refs_current_tenant() AND refs_entity_allowed(entity_id)) WITH CHECK(tenant_id=refs_current_tenant() AND refs_entity_allowed(entity_id))',n||'_scope',n);
 EXECUTE format('CREATE TRIGGER %I BEFORE UPDATE OR DELETE ON %I FOR EACH ROW EXECUTE FUNCTION reject_mutation()',n||'_append_only',n);
 EXECUTE format('REVOKE ALL ON %I FROM PUBLIC,refs_app',n); EXECUTE format('GRANT SELECT ON %I TO refs_app',n);
 END LOOP; END $$;

CREATE FUNCTION refs_propose_wbs_insurance_pc_mapping_hash(p_tenant uuid,p_entity uuid,p_observation uuid,p_expected_observation_hash text,p_reason text) RETURNS text LANGUAGE sql IMMUTABLE SET search_path=pg_catalog,public,pg_temp AS $$
 SELECT refs_jsonb_hash(jsonb_build_object('tenant_id',p_tenant,'entity_id',p_entity,'observation_id',p_observation,'expected_observation_hash',p_expected_observation_hash,'reason',btrim(p_reason))) $$;

CREATE FUNCTION refs_create_wbs_insurance_pc_mapping_proposal(p_tenant uuid,p_entity uuid,p_observation uuid,p_expected_observation_hash text,p_reason text,p_idempotency_key text,p_request_hash text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE actor text:=refs_current_actor();obs wbs_insurance_pc_mapping_pre_admission_observation;idem idempotency_receipt;new_id uuid:=gen_random_uuid();doc jsonb;doc_hash text;response jsonb;event_payload jsonb;row_count integer;observed_count bigint;computed_set_hash text;
BEGIN
 PERFORM refs_assert_scope(p_tenant,p_entity,'WBS.INSURANCE.PC_MAPPING.PROPOSE');
 IF actor IS NULL OR p_request_hash IS DISTINCT FROM refs_propose_wbs_insurance_pc_mapping_hash(p_tenant,p_entity,p_observation,p_expected_observation_hash,p_reason) OR p_expected_observation_hash!~'^sha256:[0-9a-f]{64}$' OR length(btrim(coalesce(p_reason,''))) NOT BETWEEN 8 AND 2000 THEN RAISE EXCEPTION 'Insurance PC mapping proposal request is invalid' USING ERRCODE='22023'; END IF;
 SELECT * INTO obs FROM wbs_insurance_pc_mapping_pre_admission_observation WHERE tenant_id=p_tenant AND entity_id=p_entity AND observation_id=p_observation FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Pre-admission observation not found' USING ERRCODE='P0002'; END IF;
 IF obs.observation_hash IS DISTINCT FROM p_expected_observation_hash OR obs.observation_document->>'admission_state'<>'NOT_ADMITTED' OR actor=obs.observed_by THEN RAISE EXCEPTION 'Pre-admission observation changed or SoD failed' USING ERRCODE='42501'; END IF;
 SELECT count(*)::integer,coalesce(sum(observed_row_count),0),refs_jsonb_hash(jsonb_build_object('pc_codes',jsonb_agg(jsonb_build_object('pc_code',pc_code,'observed_row_count',observed_row_count) ORDER BY pc_code))) INTO row_count,observed_count,computed_set_hash FROM wbs_insurance_pc_mapping_pre_admission_row WHERE tenant_id=p_tenant AND entity_id=p_entity AND observation_id=p_observation;
 IF row_count<>obs.scope_pc_code_count OR observed_count+obs.null_pc_code_row_count<>obs.record_count OR computed_set_hash IS DISTINCT FROM obs.canonical_set_hash THEN RAISE EXCEPTION 'Pre-admission PC aggregate is missing, ambiguous, or non-canonical' USING ERRCODE='23514';END IF;
 INSERT INTO idempotency_receipt(tenant_id,operation_scope,idempotency_key,request_hash,status,actor_id) VALUES(p_tenant,'WBS_INSURANCE_PC_MAPPING_PROPOSE:'||p_entity,p_idempotency_key,p_request_hash,'IN_PROGRESS',actor) ON CONFLICT DO NOTHING;
 SELECT * INTO idem FROM idempotency_receipt WHERE tenant_id=p_tenant AND operation_scope='WBS_INSURANCE_PC_MAPPING_PROPOSE:'||p_entity AND idempotency_key=p_idempotency_key FOR UPDATE;
 IF idem.actor_id IS DISTINCT FROM actor OR idem.request_hash IS DISTINCT FROM p_request_hash THEN RAISE EXCEPTION 'Insurance PC mapping proposal idempotency conflict' USING ERRCODE='23505'; END IF;
 IF idem.status='SUCCEEDED' THEN RETURN idem.response_body||jsonb_build_object('idempotent',true); END IF;
 doc:=jsonb_build_object('schema_version','REFS_INSURANCE_PC_MAPPING_PROPOSAL_V1','proposal_id',new_id,'observation_id',obs.observation_id,'observation_hash',obs.observation_hash,'canonical_set_hash',obs.canonical_set_hash,'source_kind','PRE_ADMISSION_OBSERVATION','admission_state','NOT_ADMITTED','reason',btrim(p_reason),'proposed_by',actor);doc_hash:=refs_jsonb_hash(doc);
 INSERT INTO wbs_insurance_pc_mapping_proposal(proposal_id,tenant_id,entity_id,observation_id,observation_hash,canonical_set_hash,proposal_document,proposal_hash,reason,proposed_by,request_hash) VALUES(new_id,p_tenant,p_entity,obs.observation_id,obs.observation_hash,obs.canonical_set_hash,doc,doc_hash,btrim(p_reason),actor,p_request_hash);
 response:=jsonb_build_object('proposal_id',new_id,'observation_id',obs.observation_id,'revision',0,'status','PENDING_CONTROLLER_APPROVAL','source_kind','PRE_ADMISSION_OBSERVATION','admission_state','NOT_ADMITTED','observation_hash',obs.observation_hash,'proposal_hash',doc_hash,'canonical_set_hash',obs.canonical_set_hash,'idempotent',false);event_payload:=response-'idempotent';
 INSERT INTO audit_event(tenant_id,entity_id,event_type,object_type,object_id,action,actor_id,actor_type,permission_used,request_id,correlation_id,idempotency_key,after_hash,reason,metadata) VALUES(p_tenant,p_entity,'WBS_INSURANCE_PC_MAPPING_PROPOSED','WBS_INSURANCE_PC_MAPPING_PROPOSAL',new_id,'PROPOSE',actor,'USER','WBS.INSURANCE.PC_MAPPING.PROPOSE',p_idempotency_key,p_idempotency_key,p_idempotency_key,doc_hash,btrim(p_reason),event_payload);
 INSERT INTO outbox_event(tenant_id,entity_id,aggregate_type,aggregate_id,event_type,payload,payload_hash) VALUES(p_tenant,p_entity,'WBS_INSURANCE_PC_MAPPING_PROPOSAL',new_id,'WBS_INSURANCE_PC_MAPPING_PROPOSED',event_payload,refs_jsonb_hash(event_payload));
 UPDATE idempotency_receipt SET status='SUCCEEDED',response_status=201,response_body=response,completed_at=clock_timestamp() WHERE idempotency_receipt_id=idem.idempotency_receipt_id;RETURN response;
END $$;

CREATE FUNCTION refs_approve_wbs_insurance_pc_mapping_hash(p_tenant uuid,p_entity uuid,p_proposal uuid,p_expected_revision bigint,p_expected_observation_hash text,p_expected_proposal_hash text,p_catalog_decision uuid,p_expected_company_mapping_hash text,p_effective_from date,p_effective_to date,p_reason text) RETURNS text LANGUAGE sql IMMUTABLE SET search_path=pg_catalog,public,pg_temp AS $$
 SELECT refs_jsonb_hash(jsonb_build_object('tenant_id',p_tenant,'entity_id',p_entity,'proposal_id',p_proposal,'expected_revision',p_expected_revision,'expected_observation_hash',p_expected_observation_hash,'expected_proposal_hash',p_expected_proposal_hash,'catalog_decision_id',p_catalog_decision,'expected_company_mapping_hash',p_expected_company_mapping_hash,'effective_from',p_effective_from,'effective_to',p_effective_to,'reason',btrim(p_reason))) $$;

CREATE FUNCTION refs_approve_wbs_insurance_pc_mapping_proposal(p_tenant uuid,p_entity uuid,p_proposal uuid,p_expected_revision bigint,p_expected_observation_hash text,p_expected_proposal_hash text,p_catalog_decision uuid,p_expected_company_mapping_hash text,p_effective_from date,p_effective_to date,p_reason text,p_idempotency_key text,p_request_hash text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE actor text:=refs_current_actor();prop wbs_insurance_pc_mapping_proposal;obs wbs_insurance_pc_mapping_pre_admission_observation;catalog wbs_company_catalog_controller_decision;ent entity;idem idempotency_receipt;approval_id uuid:=gen_random_uuid();approved_at timestamptz:=clock_timestamp();approval_doc jsonb;approval_hash text;response jsonb;event_payload jsonb;r wbs_insurance_pc_mapping_pre_admission_row;decision_id uuid;decision_doc jsonb;row_decision_hash text;decision_count integer:=0;
BEGIN
 PERFORM refs_assert_scope(p_tenant,p_entity,'WBS.INSURANCE.PC_MAPPING.APPROVE');
 IF actor IS NULL OR p_request_hash IS DISTINCT FROM refs_approve_wbs_insurance_pc_mapping_hash(p_tenant,p_entity,p_proposal,p_expected_revision,p_expected_observation_hash,p_expected_proposal_hash,p_catalog_decision,p_expected_company_mapping_hash,p_effective_from,p_effective_to,p_reason) OR p_expected_revision<>0 OR p_effective_from IS NULL OR (p_effective_to IS NOT NULL AND p_effective_to<p_effective_from) OR length(btrim(coalesce(p_reason,''))) NOT BETWEEN 8 AND 2000 THEN RAISE EXCEPTION 'Insurance PC mapping approval request is invalid' USING ERRCODE='22023'; END IF;
 SELECT * INTO prop FROM wbs_insurance_pc_mapping_proposal WHERE tenant_id=p_tenant AND entity_id=p_entity AND proposal_id=p_proposal FOR SHARE;IF NOT FOUND THEN RAISE EXCEPTION 'Insurance PC mapping proposal not found' USING ERRCODE='P0002';END IF;
 SELECT * INTO obs FROM wbs_insurance_pc_mapping_pre_admission_observation WHERE tenant_id=p_tenant AND entity_id=p_entity AND observation_id=prop.observation_id FOR SHARE;
 SELECT * INTO catalog FROM wbs_company_catalog_controller_decision WHERE tenant_id=p_tenant AND entity_id=p_entity AND wbs_company_catalog_controller_decision_id=p_catalog_decision FOR SHARE;
 SELECT * INTO ent FROM entity WHERE tenant_id=p_tenant AND entity_id=p_entity FOR SHARE;
 IF prop.revision<>p_expected_revision OR prop.observation_hash IS DISTINCT FROM p_expected_observation_hash OR prop.proposal_hash IS DISTINCT FROM p_expected_proposal_hash THEN RAISE EXCEPTION 'Insurance PC mapping proposal evidence changed' USING ERRCODE='40001';END IF;
 IF catalog.wbs_company_catalog_controller_decision_id IS NULL OR ent.entity_id IS NULL OR catalog.decision_type<>'APPROVED' OR catalog.company_code<>'WBPA' OR catalog.active_status<>'ACTIVE' OR catalog.base_currency<>'USD' OR catalog.mapping_hash IS DISTINCT FROM p_expected_company_mapping_hash OR catalog.effective_from>p_effective_from OR (catalog.effective_to IS NOT NULL AND (p_effective_to IS NULL OR catalog.effective_to<p_effective_to)) OR NOT ent.active OR ent.source_system<>'WBS' OR ent.source_entity_id<>'WBPA' OR ent.base_currency<>'USD' THEN RAISE EXCEPTION 'Active WBPA USD catalog authority must cover the complete mapping range' USING ERRCODE='23514';END IF;
 IF actor IN (obs.observed_by,prop.proposed_by,catalog.decided_by) THEN RAISE EXCEPTION 'Observation, proposal, catalog, and mapping approval actors must be distinct' USING ERRCODE='42501';END IF;
 INSERT INTO idempotency_receipt(tenant_id,operation_scope,idempotency_key,request_hash,status,actor_id) VALUES(p_tenant,'WBS_INSURANCE_PC_MAPPING_APPROVE:'||p_entity||':'||p_proposal,p_idempotency_key,p_request_hash,'IN_PROGRESS',actor) ON CONFLICT DO NOTHING;
 SELECT * INTO idem FROM idempotency_receipt WHERE tenant_id=p_tenant AND operation_scope='WBS_INSURANCE_PC_MAPPING_APPROVE:'||p_entity||':'||p_proposal AND idempotency_key=p_idempotency_key FOR UPDATE;
 IF idem.actor_id IS DISTINCT FROM actor OR idem.request_hash IS DISTINCT FROM p_request_hash THEN RAISE EXCEPTION 'Insurance PC mapping approval idempotency conflict' USING ERRCODE='23505';END IF;IF idem.status='SUCCEEDED' THEN RETURN idem.response_body||jsonb_build_object('idempotent',true);END IF;
 IF EXISTS(SELECT 1 FROM wbs_insurance_pc_mapping_approval WHERE tenant_id=p_tenant AND entity_id=p_entity AND proposal_id=p_proposal) THEN RAISE EXCEPTION 'Insurance PC mapping proposal was already decided' USING ERRCODE='40001';END IF;
 approval_doc:=jsonb_build_object('schema_version','REFS_INSURANCE_PC_MAPPING_APPROVAL_V1','approval_id',approval_id,'proposal_id',p_proposal,'observation_hash',prop.observation_hash,'proposal_hash',prop.proposal_hash,'canonical_set_hash',prop.canonical_set_hash,'catalog_decision_id',p_catalog_decision,'company_mapping_hash',p_expected_company_mapping_hash,'effective_from',to_char(p_effective_from,'YYYY-MM-DD'),'effective_to',CASE WHEN p_effective_to IS NULL THEN NULL ELSE to_jsonb(to_char(p_effective_to,'YYYY-MM-DD')) END,'approved_by',actor,'approved_at',to_char(approved_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'));approval_hash:=refs_jsonb_hash(approval_doc);
 INSERT INTO wbs_insurance_pc_mapping_approval VALUES(approval_id,p_tenant,p_entity,p_proposal,1,prop.observation_hash,prop.proposal_hash,prop.canonical_set_hash,p_catalog_decision,p_expected_company_mapping_hash,p_effective_from,p_effective_to,approval_hash,approval_doc,actor,approved_at,btrim(p_reason),p_request_hash);
 FOR r IN SELECT * FROM wbs_insurance_pc_mapping_pre_admission_row WHERE tenant_id=p_tenant AND entity_id=p_entity AND observation_id=prop.observation_id ORDER BY row_ordinal FOR SHARE LOOP
  decision_id:=gen_random_uuid();decision_doc:=jsonb_build_object('tenant_id',p_tenant,'entity_id',p_entity,'pc_code',r.pc_code,'company_code','WBPA','company_mapping_hash',p_expected_company_mapping_hash,'controller_decision_id',p_catalog_decision,'approval_status','APPROVED','effective_from',to_char(p_effective_from,'YYYY-MM-DD'),'effective_to',CASE WHEN p_effective_to IS NULL THEN NULL ELSE to_jsonb(to_char(p_effective_to,'YYYY-MM-DD')) END,'decided_by',actor);row_decision_hash:=refs_jsonb_hash(decision_doc);
  INSERT INTO wbs_insurance_pc_company_mapping_decision(wbs_insurance_pc_company_mapping_decision_id,tenant_id,entity_id,pc_code,company_code,company_mapping_hash,wbs_company_catalog_controller_decision_id,approval_status,effective_from,effective_to,decision_document,decision_hash,decided_by,decided_at) VALUES(decision_id,p_tenant,p_entity,r.pc_code,'WBPA',p_expected_company_mapping_hash,p_catalog_decision,'APPROVED',p_effective_from,p_effective_to,decision_doc,row_decision_hash,actor,approved_at);
  INSERT INTO wbs_insurance_pc_mapping_decision_trace VALUES(p_tenant,p_entity,approval_id,p_proposal,prop.observation_id,r.observation_row_id,decision_id,r.pc_code,prop.observation_hash,prop.proposal_hash,row_decision_hash,p_expected_company_mapping_hash);decision_count:=decision_count+1;
 END LOOP;IF decision_count=0 THEN RAISE EXCEPTION 'Insurance PC mapping proposal contains no authoritative PC rows' USING ERRCODE='23514';END IF;
 response:=jsonb_build_object('proposal_id',p_proposal,'observation_id',prop.observation_id,'revision',1,'status','APPROVED','source_kind','PRE_ADMISSION_OBSERVATION','admission_state','NOT_ADMITTED','observation_hash',prop.observation_hash,'proposal_hash',prop.proposal_hash,'decision_hash',approval_hash,'company_mapping_hash',p_expected_company_mapping_hash,'match_count',decision_count,'approved_by',actor,'approved_at',to_char(approved_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),'idempotent',false);event_payload:=response-'idempotent';
 INSERT INTO audit_event(tenant_id,entity_id,event_type,object_type,object_id,action,actor_id,actor_type,permission_used,request_id,correlation_id,idempotency_key,before_hash,after_hash,reason,metadata) VALUES(p_tenant,p_entity,'WBS_INSURANCE_PC_MAPPING_APPROVED','WBS_INSURANCE_PC_MAPPING_APPROVAL',approval_id,'APPROVE',actor,'USER','WBS.INSURANCE.PC_MAPPING.APPROVE',p_idempotency_key,p_idempotency_key,p_idempotency_key,prop.proposal_hash,approval_hash,btrim(p_reason),event_payload);
 INSERT INTO outbox_event(tenant_id,entity_id,aggregate_type,aggregate_id,event_type,payload,payload_hash) VALUES(p_tenant,p_entity,'WBS_INSURANCE_PC_MAPPING_APPROVAL',approval_id,'WBS_INSURANCE_PC_MAPPING_APPROVED',event_payload,refs_jsonb_hash(event_payload));UPDATE idempotency_receipt SET status='SUCCEEDED',response_status=201,response_body=response,completed_at=clock_timestamp() WHERE idempotency_receipt_id=idem.idempotency_receipt_id;RETURN response;
END $$;

CREATE FUNCTION refs_read_wbs_insurance_pc_mapping_proposal(p_tenant uuid,p_entity uuid,p_proposal uuid) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$ DECLARE result jsonb;BEGIN PERFORM refs_assert_scope(p_tenant,p_entity,'WBS.INSURANCE.PC_MAPPING.VIEW');SELECT jsonb_build_object('proposal_id',p.proposal_id,'observation_id',p.observation_id,'revision',CASE WHEN a.approval_id IS NULL THEN 0 ELSE 1 END,'status',CASE WHEN a.approval_id IS NULL THEN 'PENDING_CONTROLLER_APPROVAL' ELSE 'APPROVED' END,'source_kind','PRE_ADMISSION_OBSERVATION','admission_state','NOT_ADMITTED','observation_hash',p.observation_hash,'proposal_hash',p.proposal_hash,'canonical_set_hash',p.canonical_set_hash,'proposed_by',p.proposed_by,'proposed_at',to_char(p.proposed_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),'rows',(SELECT jsonb_agg(jsonb_build_object('proposal_row_id',r.observation_row_id,'pc_code',r.pc_code,'observed_row_count',r.observed_row_count,'row_hash',r.row_hash) ORDER BY r.row_ordinal) FROM wbs_insurance_pc_mapping_pre_admission_row r WHERE r.tenant_id=p.tenant_id AND r.entity_id=p.entity_id AND r.observation_id=p.observation_id),'decision_hash',a.decision_hash,'company_mapping_hash',a.company_mapping_hash,'approved_by',a.approved_by,'approved_at',CASE WHEN a.approved_at IS NULL THEN NULL ELSE to_char(a.approved_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') END) INTO result FROM wbs_insurance_pc_mapping_proposal p LEFT JOIN wbs_insurance_pc_mapping_approval a ON a.tenant_id=p.tenant_id AND a.entity_id=p.entity_id AND a.proposal_id=p.proposal_id WHERE p.tenant_id=p_tenant AND p.entity_id=p_entity AND p.proposal_id=p_proposal;IF result IS NULL THEN RAISE EXCEPTION 'Insurance PC mapping proposal not found' USING ERRCODE='P0002';END IF;RETURN jsonb_strip_nulls(result);END $$;

CREATE FUNCTION refs_read_wbs_insurance_pc_mapping_trace(p_tenant uuid,p_entity uuid,p_pc_code text,p_accounting_date date) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$ DECLARE matched integer;result jsonb;BEGIN PERFORM refs_assert_scope(p_tenant,p_entity,'WBS.INSURANCE.PC_MAPPING.VIEW');IF p_pc_code IS NULL OR p_pc_code<>btrim(p_pc_code) OR length(p_pc_code) NOT BETWEEN 1 AND 128 OR p_accounting_date IS NULL THEN RAISE EXCEPTION 'Insurance PC mapping trace selection is invalid' USING ERRCODE='22023';END IF;SELECT count(*)::integer INTO matched FROM wbs_insurance_pc_company_mapping_decision d WHERE d.tenant_id=p_tenant AND d.entity_id=p_entity AND d.pc_code=p_pc_code AND d.approval_status='APPROVED' AND d.effective_from<=p_accounting_date AND (d.effective_to IS NULL OR d.effective_to>=p_accounting_date);IF matched<>1 THEN RETURN jsonb_build_object('pc_code',p_pc_code,'accounting_date',to_char(p_accounting_date,'YYYY-MM-DD'),'match_count',matched,'mapping_status',CASE WHEN matched=0 THEN 'MISSING' ELSE 'AMBIGUOUS' END);END IF;SELECT jsonb_build_object('pc_code',d.pc_code,'accounting_date',to_char(p_accounting_date,'YYYY-MM-DD'),'match_count',1,'mapping_status','CONTROLLER_APPROVED','company_code',d.company_code,'effective_from',to_char(d.effective_from,'YYYY-MM-DD'),'effective_to',CASE WHEN d.effective_to IS NULL THEN NULL ELSE to_jsonb(to_char(d.effective_to,'YYYY-MM-DD')) END,'observation_hash',t.observation_hash,'proposal_hash',t.proposal_hash,'decision_hash',t.decision_hash,'company_mapping_hash',t.company_mapping_hash,'catalog_decision_id',d.wbs_company_catalog_controller_decision_id,'approved_by',d.decided_by,'approved_at',to_char(d.decided_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')) INTO result FROM wbs_insurance_pc_company_mapping_decision d JOIN wbs_insurance_pc_mapping_decision_trace t ON t.tenant_id=d.tenant_id AND t.entity_id=d.entity_id AND t.wbs_insurance_pc_company_mapping_decision_id=d.wbs_insurance_pc_company_mapping_decision_id WHERE d.tenant_id=p_tenant AND d.entity_id=p_entity AND d.pc_code=p_pc_code AND d.approval_status='APPROVED' AND d.effective_from<=p_accounting_date AND (d.effective_to IS NULL OR d.effective_to>=p_accounting_date);RETURN jsonb_strip_nulls(result);END $$;

REVOKE EXECUTE ON FUNCTION refs_propose_wbs_insurance_pc_mapping_hash(uuid,uuid,uuid,text,text),refs_create_wbs_insurance_pc_mapping_proposal(uuid,uuid,uuid,text,text,text,text),refs_approve_wbs_insurance_pc_mapping_hash(uuid,uuid,uuid,bigint,text,text,uuid,text,date,date,text),refs_approve_wbs_insurance_pc_mapping_proposal(uuid,uuid,uuid,bigint,text,text,uuid,text,date,date,text,text,text),refs_read_wbs_insurance_pc_mapping_proposal(uuid,uuid,uuid),refs_read_wbs_insurance_pc_mapping_trace(uuid,uuid,text,date) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION refs_propose_wbs_insurance_pc_mapping_hash(uuid,uuid,uuid,text,text),refs_create_wbs_insurance_pc_mapping_proposal(uuid,uuid,uuid,text,text,text,text),refs_approve_wbs_insurance_pc_mapping_hash(uuid,uuid,uuid,bigint,text,text,uuid,text,date,date,text),refs_approve_wbs_insurance_pc_mapping_proposal(uuid,uuid,uuid,bigint,text,text,uuid,text,date,date,text,text,text),refs_read_wbs_insurance_pc_mapping_proposal(uuid,uuid,uuid),refs_read_wbs_insurance_pc_mapping_trace(uuid,uuid,text,date) TO refs_app;

COMMIT;
