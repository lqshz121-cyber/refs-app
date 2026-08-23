BEGIN;

INSERT INTO permission_catalog(permission_code,domain,risk_class,sod_class) VALUES
 ('WBS.H1.SETTINGS.DECIDE','WBS','CRITICAL','WBS_H1_SETTINGS_CONTROLLER')
ON CONFLICT(permission_code) DO UPDATE SET active=true,effective_to=NULL,domain=EXCLUDED.domain,
 risk_class=EXCLUDED.risk_class,sod_class=EXCLUDED.sod_class,version=permission_catalog.version+1;

CREATE TABLE wbs_h1_accounting_settings_human_decision(
  decision_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL, entity_id uuid NOT NULL, period_id uuid NOT NULL,
  proposal_hash text NOT NULL CHECK(proposal_hash~'^sha256:[0-9a-f]{64}$'),
  outcome text NOT NULL CHECK(outcome IN ('APPROVED','REJECTED')),
  decision_document jsonb NOT NULL CHECK(jsonb_typeof(decision_document)='object'),
  decision_hash text NOT NULL CHECK(decision_hash~'^sha256:[0-9a-f]{64}$' AND decision_hash=refs_jsonb_hash(decision_document)),
  reason text NOT NULL CHECK(reason=btrim(reason) AND length(reason) BETWEEN 8 AND 2000),
  decided_by text NOT NULL CHECK(length(btrim(decided_by)) BETWEEN 1 AND 256),
  decided_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  idempotency_key text NOT NULL CHECK(length(idempotency_key) BETWEEN 8 AND 200),
  request_hash text NOT NULL CHECK(request_hash~'^sha256:[0-9a-f]{64}$'),
  UNIQUE(tenant_id,entity_id,period_id,proposal_hash),
  UNIQUE(tenant_id,entity_id,idempotency_key),
  FOREIGN KEY(tenant_id,entity_id) REFERENCES entity(tenant_id,entity_id),
  FOREIGN KEY(tenant_id,entity_id,period_id) REFERENCES accounting_period(tenant_id,entity_id,period_id)
);
ALTER TABLE wbs_h1_accounting_settings_human_decision ENABLE ROW LEVEL SECURITY;
CREATE POLICY wbs_h1_accounting_settings_human_decision_scope ON wbs_h1_accounting_settings_human_decision
  USING(tenant_id=refs_current_tenant() AND refs_entity_allowed(entity_id))
  WITH CHECK(tenant_id=refs_current_tenant() AND refs_entity_allowed(entity_id));
CREATE TRIGGER wbs_h1_accounting_settings_human_decision_append_only BEFORE UPDATE OR DELETE
  ON wbs_h1_accounting_settings_human_decision FOR EACH ROW EXECUTE FUNCTION reject_mutation();
REVOKE ALL ON wbs_h1_accounting_settings_human_decision FROM PUBLIC,refs_app;
GRANT SELECT ON wbs_h1_accounting_settings_human_decision TO refs_app;

CREATE FUNCTION refs_wbs_h1_accounting_settings_decision_request_hash(
 p_tenant uuid,p_entity uuid,p_period uuid,p_proposal_hash text,p_outcome text,p_reason text
) RETURNS text LANGUAGE sql IMMUTABLE SET search_path=pg_catalog,public,pg_temp AS $$
 SELECT refs_jsonb_hash(jsonb_build_object('tenant_id',p_tenant,'entity_id',p_entity,'period_id',p_period,
  'expected_proposal_hash',p_proposal_hash,'outcome',p_outcome,'reason',btrim(p_reason)))
$$;

CREATE FUNCTION refs_decide_wbs_h1_accounting_settings(
 p_tenant uuid,p_entity uuid,p_period uuid,p_proposal_hash text,p_outcome text,p_reason text,p_idempotency_key text,p_request_hash text
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE actor text:=refs_current_actor(); proposal jsonb; stored wbs_h1_accounting_settings_human_decision;
 doc jsonb; response jsonb; event_payload jsonb; expected_hash text;
BEGIN
 PERFORM refs_assert_scope(p_tenant,p_entity,'WBS.AUTOREC.VIEW');
 PERFORM refs_assert_scope(p_tenant,p_entity,'WBS.H1.SETTINGS.DECIDE');
 expected_hash:=refs_wbs_h1_accounting_settings_decision_request_hash(p_tenant,p_entity,p_period,p_proposal_hash,p_outcome,p_reason);
 IF actor IS NULL OR p_request_hash IS DISTINCT FROM expected_hash OR p_proposal_hash!~'^sha256:[0-9a-f]{64}$'
   OR p_outcome NOT IN ('APPROVED','REJECTED') OR p_idempotency_key IS NULL OR length(p_idempotency_key) NOT BETWEEN 8 AND 200
   OR p_reason IS NULL OR length(btrim(p_reason)) NOT BETWEEN 8 AND 2000 THEN
   RAISE EXCEPTION 'WBS H1 Settings decision request is invalid' USING ERRCODE='22023';
 END IF;
 proposal:=refs_read_wbs_h1_accounting_settings_proposal(p_tenant,p_entity,p_period);
 IF proposal->>'proposal_hash' IS DISTINCT FROM p_proposal_hash THEN
   RAISE EXCEPTION 'WBS H1 Settings proposal changed' USING ERRCODE='40001';
 END IF;
 IF p_outcome='APPROVED' AND (proposal->>'status'<>'READY_FOR_HUMAN_REVIEW'
    OR (proposal->>'exception_count')::integer<>0 OR (proposal->>'ready_rule_count')::integer<1) THEN
   RAISE EXCEPTION 'Only an exception-free WBS H1 Settings proposal may be approved' USING ERRCODE='23514';
 END IF;
 SELECT * INTO stored FROM wbs_h1_accounting_settings_human_decision
  WHERE tenant_id=p_tenant AND entity_id=p_entity AND idempotency_key=p_idempotency_key FOR SHARE;
 IF FOUND THEN
   IF stored.request_hash IS DISTINCT FROM p_request_hash OR stored.decided_by IS DISTINCT FROM actor THEN
    RAISE EXCEPTION 'WBS H1 Settings decision idempotency conflict' USING ERRCODE='23505';
   END IF;
   RETURN jsonb_build_object('schema_version','WBS_H1_ACCOUNTING_SETTINGS_HUMAN_DECISION_V1','decision_id',stored.decision_id,
    'period_id',stored.period_id,'proposal_hash',stored.proposal_hash,'outcome',stored.outcome,'decision_hash',stored.decision_hash,
    'decided_by',stored.decided_by,'decided_at',to_char(stored.decided_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    'approved_rule_count',CASE WHEN stored.outcome='APPROVED' THEN (stored.decision_document->>'approved_rule_count')::integer ELSE 0 END,
    'can_create_draft',false,'can_review',false,'can_approve',false,'can_post',false,'idempotent',true);
 END IF;
 IF EXISTS(SELECT 1 FROM wbs_h1_accounting_settings_human_decision WHERE tenant_id=p_tenant AND entity_id=p_entity AND period_id=p_period AND proposal_hash=p_proposal_hash) THEN
   RAISE EXCEPTION 'WBS H1 Settings proposal already has a human decision' USING ERRCODE='23505';
 END IF;
 doc:=jsonb_build_object('schema_version','WBS_H1_ACCOUNTING_SETTINGS_HUMAN_DECISION_V1','tenant_id',p_tenant,'entity_id',p_entity,
  'period_id',p_period,'proposal_hash',p_proposal_hash,'outcome',p_outcome,
  'approved_rule_count',CASE WHEN p_outcome='APPROVED' THEN (proposal->>'ready_rule_count')::integer ELSE 0 END,
  'approved_rule_ids',CASE WHEN p_outcome='APPROVED' THEN (SELECT coalesce(jsonb_agg(r->>'rule_id' ORDER BY r->>'rule_id'),'[]'::jsonb) FROM jsonb_array_elements(proposal->'rules') r WHERE r->>'decision'='READY_FOR_HUMAN_REVIEW') ELSE '[]'::jsonb END,
  'source_mode','REAL_WBS_STAGED','accounting_authority','SETTINGS_ONLY','can_create_draft',false,'can_review',false,'can_approve',false,'can_post',false);
 INSERT INTO wbs_h1_accounting_settings_human_decision(tenant_id,entity_id,period_id,proposal_hash,outcome,decision_document,decision_hash,reason,decided_by,idempotency_key,request_hash)
 VALUES(p_tenant,p_entity,p_period,p_proposal_hash,p_outcome,doc,refs_jsonb_hash(doc),btrim(p_reason),actor,p_idempotency_key,p_request_hash) RETURNING * INTO stored;
 event_payload:=jsonb_build_object('decision_id',stored.decision_id,'entity_id',p_entity,'period_id',p_period,'proposal_hash',p_proposal_hash,'outcome',p_outcome,'decision_hash',stored.decision_hash);
 INSERT INTO audit_event(tenant_id,entity_id,event_type,object_type,object_id,action,actor_id,actor_type,permission_used,request_id,correlation_id,idempotency_key,after_hash,reason,metadata)
 VALUES(p_tenant,p_entity,'WBS_H1_ACCOUNTING_SETTINGS_DECIDED','WBS_H1_ACCOUNTING_SETTINGS',stored.decision_id,'DECIDE',actor,'USER','WBS.H1.SETTINGS.DECIDE',p_idempotency_key,p_idempotency_key,p_idempotency_key,stored.decision_hash,btrim(p_reason),event_payload);
 INSERT INTO outbox_event(tenant_id,entity_id,aggregate_type,aggregate_id,event_type,payload,payload_hash)
 VALUES(p_tenant,p_entity,'WBS_H1_ACCOUNTING_SETTINGS',stored.decision_id,'WBS_H1_ACCOUNTING_SETTINGS_DECIDED',event_payload,refs_jsonb_hash(event_payload));
 RETURN jsonb_build_object('schema_version','WBS_H1_ACCOUNTING_SETTINGS_HUMAN_DECISION_V1','decision_id',stored.decision_id,
  'period_id',stored.period_id,'proposal_hash',stored.proposal_hash,'outcome',stored.outcome,'decision_hash',stored.decision_hash,
  'decided_by',stored.decided_by,'decided_at',to_char(stored.decided_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
  'approved_rule_count',CASE WHEN stored.outcome='APPROVED' THEN (doc->>'approved_rule_count')::integer ELSE 0 END,
  'can_create_draft',false,'can_review',false,'can_approve',false,'can_post',false,'idempotent',false);
END $$;

CREATE FUNCTION refs_read_wbs_h1_accounting_settings_decision(p_tenant uuid,p_entity uuid,p_period uuid,p_proposal_hash text)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE stored wbs_h1_accounting_settings_human_decision;
BEGIN
 PERFORM refs_assert_scope(p_tenant,p_entity,'WBS.AUTOREC.VIEW');
 IF p_proposal_hash!~'^sha256:[0-9a-f]{64}$' THEN RAISE EXCEPTION 'Proposal hash is invalid' USING ERRCODE='22023';END IF;
 SELECT * INTO stored FROM wbs_h1_accounting_settings_human_decision WHERE tenant_id=p_tenant AND entity_id=p_entity AND period_id=p_period AND proposal_hash=p_proposal_hash;
 IF NOT FOUND THEN RETURN NULL;END IF;
 RETURN jsonb_build_object('schema_version','WBS_H1_ACCOUNTING_SETTINGS_HUMAN_DECISION_V1','decision_id',stored.decision_id,
  'period_id',stored.period_id,'proposal_hash',stored.proposal_hash,'outcome',stored.outcome,'decision_hash',stored.decision_hash,
  'decided_by',stored.decided_by,'decided_at',to_char(stored.decided_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
  'approved_rule_count',CASE WHEN stored.outcome='APPROVED' THEN (stored.decision_document->>'approved_rule_count')::integer ELSE 0 END,
  'can_create_draft',false,'can_review',false,'can_approve',false,'can_post',false,'idempotent',false);
END $$;

REVOKE EXECUTE ON FUNCTION refs_wbs_h1_accounting_settings_decision_request_hash(uuid,uuid,uuid,text,text,text),refs_decide_wbs_h1_accounting_settings(uuid,uuid,uuid,text,text,text,text,text),refs_read_wbs_h1_accounting_settings_decision(uuid,uuid,uuid,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION refs_wbs_h1_accounting_settings_decision_request_hash(uuid,uuid,uuid,text,text,text),refs_decide_wbs_h1_accounting_settings(uuid,uuid,uuid,text,text,text,text,text),refs_read_wbs_h1_accounting_settings_decision(uuid,uuid,uuid,text) TO refs_app;

COMMIT;
