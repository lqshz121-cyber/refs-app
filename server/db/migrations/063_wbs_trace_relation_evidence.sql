BEGIN;

CREATE TABLE wbs_trace_relation_evidence (
  relation_evidence_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant(tenant_id), entity_id uuid NOT NULL,
  company_key text NOT NULL, source_type text NOT NULL, source_record_id text NOT NULL, source_version text NOT NULL, source_receipt_hash text NOT NULL CHECK(source_receipt_hash ~ '^sha256:[0-9a-f]{64}$'),
  trace_receipt_ref text NOT NULL, trace_receipt_version text NOT NULL, trace_receipt_issued_at timestamptz NOT NULL,
  trace_manifest_hash text NOT NULL CHECK(trace_manifest_hash ~ '^sha256:[0-9a-f]{64}$'), trace_key_id text NOT NULL, trace_algorithm text NOT NULL CHECK(trace_algorithm='Ed25519'), trace_content_hash text NOT NULL CHECK(trace_content_hash ~ '^sha256:[0-9a-f]{64}$'),
  binding_hash text NOT NULL CHECK(binding_hash ~ '^sha256:[0-9a-f]{64}$'), created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE(tenant_id,entity_id,binding_hash), FOREIGN KEY(tenant_id,entity_id) REFERENCES entity(tenant_id,entity_id)
);
CREATE TABLE wbs_trace_relation_item (
  relation_evidence_id uuid NOT NULL REFERENCES wbs_trace_relation_evidence(relation_evidence_id), relation_id text NOT NULL, relation_type text NOT NULL,
  related_key_type text NOT NULL, related_key_value text NOT NULL, observed_version text NOT NULL, relation_payload jsonb NOT NULL CHECK(jsonb_typeof(relation_payload)='object'), created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY(relation_evidence_id,relation_id)
);
ALTER TABLE wbs_trace_relation_evidence ENABLE ROW LEVEL SECURITY; ALTER TABLE wbs_trace_relation_item ENABLE ROW LEVEL SECURITY;
CREATE POLICY wbs_trace_relation_evidence_scope ON wbs_trace_relation_evidence USING(tenant_id=refs_current_tenant() AND refs_entity_allowed(entity_id)) WITH CHECK(tenant_id=refs_current_tenant() AND refs_entity_allowed(entity_id));
CREATE POLICY wbs_trace_relation_item_scope ON wbs_trace_relation_item USING(EXISTS(SELECT 1 FROM wbs_trace_relation_evidence e WHERE e.relation_evidence_id=wbs_trace_relation_item.relation_evidence_id AND e.tenant_id=refs_current_tenant() AND refs_entity_allowed(e.entity_id))) WITH CHECK(EXISTS(SELECT 1 FROM wbs_trace_relation_evidence e WHERE e.relation_evidence_id=wbs_trace_relation_item.relation_evidence_id AND e.tenant_id=refs_current_tenant() AND refs_entity_allowed(e.entity_id)));
CREATE TRIGGER wbs_trace_relation_evidence_append_only BEFORE UPDATE OR DELETE ON wbs_trace_relation_evidence FOR EACH ROW EXECUTE FUNCTION reject_mutation();
CREATE TRIGGER wbs_trace_relation_item_append_only BEFORE UPDATE OR DELETE ON wbs_trace_relation_item FOR EACH ROW EXECUTE FUNCTION reject_mutation();

CREATE OR REPLACE FUNCTION refs_persist_wbs_trace_relation_evidence(p_tenant uuid,p_entity uuid,p_source jsonb,p_trace_receipt jsonb,p_relations jsonb,p_idempotency text,p_binding_hash text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE rec idempotency_receipt; actor text:=refs_current_actor(); evidence uuid; source_company text; relation jsonb; n integer:=0; result jsonb;
BEGIN
 PERFORM refs_assert_scope(p_tenant,p_entity,'WBS.SNAPSHOT.IMPORT'); IF actor IS NULL THEN RAISE EXCEPTION 'Authenticated actor missing' USING ERRCODE='42501'; END IF;
 IF jsonb_typeof(p_source)<>'object' OR jsonb_typeof(p_trace_receipt)<>'object' OR jsonb_typeof(p_relations)<>'array' OR jsonb_array_length(p_relations)=0 OR p_binding_hash!~'^sha256:[0-9a-f]{64}$' THEN RAISE EXCEPTION 'Trace relation payload is invalid' USING ERRCODE='22023'; END IF;
 IF coalesce(p_source->>'tenant_id','')<>p_tenant::text OR coalesce(p_source->>'entity_id','')<>p_entity::text OR coalesce(p_source->>'company_key','')='' OR coalesce(p_source->>'source_type','') NOT IN ('PAYABLE','BANK_TRANSACTION','AUTOREC_PAYMENT_DETAIL') OR coalesce(p_source->>'source_record_id','')='' OR coalesce(p_source->>'source_version','')='' OR coalesce(p_source->>'receipt_hash','')!~'^sha256:[0-9a-f]{64}$' OR coalesce(p_trace_receipt->>'ref','')='' OR coalesce(p_trace_receipt->>'version','')='' OR coalesce(p_trace_receipt->>'manifest_hash','')!~'^sha256:[0-9a-f]{64}$' OR coalesce(p_trace_receipt->>'content_hash','')!~'^sha256:[0-9a-f]{64}$' OR coalesce(p_trace_receipt->>'algorithm','')<>'Ed25519' OR coalesce(p_trace_receipt->>'key_id','')='' OR coalesce(p_trace_receipt->>'issued_at','') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T' THEN RAISE EXCEPTION 'Trace relation receipt or source scope is invalid' USING ERRCODE='22023'; END IF;
 SELECT coalesce(r.outcome->>'company_key',r.normalized->>'company_key',r.raw->>'company_key') INTO source_company FROM wbs_inbound_row r JOIN wbs_inbound_receipt i ON i.receipt_id=r.receipt_id WHERE r.tenant_id=p_tenant AND r.entity_id=p_entity AND r.source_record_id=p_source->>'source_record_id' AND r.source_version=p_source->>'source_version' AND i.receipt_hash=p_source->>'receipt_hash';
 IF source_company IS NULL OR source_company<>p_source->>'company_key' THEN RAISE EXCEPTION 'Trace relation source is not an exact persisted receipt-backed row' USING ERRCODE='22023'; END IF;
 INSERT INTO idempotency_receipt(tenant_id,operation_scope,idempotency_key,request_hash,status,actor_id) VALUES(p_tenant,'WBS_TRACE:'||p_entity,p_idempotency,p_binding_hash,'IN_PROGRESS',actor) ON CONFLICT DO NOTHING;
 SELECT * INTO rec FROM idempotency_receipt WHERE tenant_id=p_tenant AND operation_scope='WBS_TRACE:'||p_entity AND idempotency_key=p_idempotency FOR UPDATE;
 IF rec.request_hash<>p_binding_hash THEN RAISE EXCEPTION 'Idempotency key reused with different request' USING ERRCODE='23505'; END IF; IF rec.status='SUCCEEDED' THEN RETURN rec.response_body||jsonb_build_object('idempotent',true); END IF;
 INSERT INTO wbs_trace_relation_evidence(tenant_id,entity_id,company_key,source_type,source_record_id,source_version,source_receipt_hash,trace_receipt_ref,trace_receipt_version,trace_receipt_issued_at,trace_manifest_hash,trace_key_id,trace_algorithm,trace_content_hash,binding_hash) VALUES(p_tenant,p_entity,p_source->>'company_key',p_source->>'source_type',p_source->>'source_record_id',p_source->>'source_version',p_source->>'receipt_hash',p_trace_receipt->>'ref',p_trace_receipt->>'version',(p_trace_receipt->>'issued_at')::timestamptz,p_trace_receipt->>'manifest_hash',p_trace_receipt->>'key_id',p_trace_receipt->>'algorithm',p_trace_receipt->>'content_hash',p_binding_hash) RETURNING relation_evidence_id INTO evidence;
 FOR relation IN SELECT value FROM jsonb_array_elements(p_relations) LOOP
  IF jsonb_typeof(relation)<>'object' OR coalesce(relation->>'relation_id','')='' OR coalesce(relation->>'relation_type','')='' OR coalesce(relation->'related'->>'key_type','')='' OR coalesce(relation->'related'->>'key_value','')='' OR coalesce(relation->>'observed_version','')='' OR relation->>'can_use_as_source_key'<>'false' OR relation->>'can_match'<>'false' OR relation->>'can_transition'<>'false' OR relation->>'can_post'<>'false' THEN RAISE EXCEPTION 'Trace relation evidence is invalid' USING ERRCODE='22023'; END IF;
  INSERT INTO wbs_trace_relation_item(relation_evidence_id,relation_id,relation_type,related_key_type,related_key_value,observed_version,relation_payload) VALUES(evidence,relation->>'relation_id',relation->>'relation_type',relation->'related'->>'key_type',relation->'related'->>'key_value',relation->>'observed_version',relation); n:=n+1;
 END LOOP;
 result:=jsonb_build_object('relation_evidence_id',evidence,'relation_count',n,'idempotent',false,'can_create_transaction',false,'can_allocate',false,'can_create_draft',false,'can_post',false);
 INSERT INTO audit_event(tenant_id,entity_id,event_type,object_type,object_id,action,actor_id,actor_type,permission_used,request_id,correlation_id,idempotency_key,after_hash,metadata) VALUES(p_tenant,p_entity,'WBS_TRACE_RELATION_PERSISTED','WBS_TRACE_RELATION',evidence,'PERSIST',actor,'SERVICE_ACCOUNT','WBS.SNAPSHOT.IMPORT',p_idempotency,p_idempotency,p_idempotency,p_binding_hash,jsonb_build_object('relation_count',n));
 UPDATE idempotency_receipt SET status='SUCCEEDED',response_status=201,response_body=result,completed_at=clock_timestamp() WHERE tenant_id=p_tenant AND operation_scope='WBS_TRACE:'||p_entity AND idempotency_key=p_idempotency; RETURN result;
END $$;

CREATE OR REPLACE FUNCTION refs_read_wbs_trace_relation_evidence(p_tenant uuid,p_entity uuid,p_source jsonb)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE result jsonb;
BEGIN
 PERFORM refs_assert_scope(p_tenant,p_entity,'WBS.SNAPSHOT.IMPORT');
 IF jsonb_typeof(p_source)<>'object' OR coalesce(p_source->>'company_key','')='' OR coalesce(p_source->>'source_type','') NOT IN ('PAYABLE','BANK_TRANSACTION','AUTOREC_PAYMENT_DETAIL') OR coalesce(p_source->>'source_record_id','')='' OR coalesce(p_source->>'source_version','')='' OR coalesce(p_source->>'receipt_hash','')!~'^sha256:[0-9a-f]{64}$' THEN RAISE EXCEPTION 'Trace relation read scope is invalid' USING ERRCODE='22023'; END IF;
 SELECT jsonb_build_object(
   'relation_evidence_id',e.relation_evidence_id,'source',jsonb_build_object('tenant_id',e.tenant_id,'entity_id',e.entity_id,'company_key',e.company_key,'source_type',e.source_type,'source_record_id',e.source_record_id,'source_version',e.source_version,'receipt_hash',e.source_receipt_hash),
   'trace_receipt',jsonb_build_object('ref',e.trace_receipt_ref,'version',e.trace_receipt_version,'issued_at',e.trace_receipt_issued_at,'manifest_hash',e.trace_manifest_hash,'key_id',e.trace_key_id,'algorithm',e.trace_algorithm,'content_hash',e.trace_content_hash),
   'binding_hash',e.binding_hash,'relations',coalesce((SELECT jsonb_agg(i.relation_payload ORDER BY i.relation_id) FROM wbs_trace_relation_item i WHERE i.relation_evidence_id=e.relation_evidence_id),'[]'::jsonb),
   'can_create_transaction',false,'can_allocate',false,'can_create_draft',false,'can_post',false
 ) INTO result FROM wbs_trace_relation_evidence e
 WHERE e.tenant_id=p_tenant AND e.entity_id=p_entity AND e.company_key=p_source->>'company_key' AND e.source_type=p_source->>'source_type' AND e.source_record_id=p_source->>'source_record_id' AND e.source_version=p_source->>'source_version' AND e.source_receipt_hash=p_source->>'receipt_hash'
 ORDER BY e.created_at DESC,e.relation_evidence_id DESC LIMIT 1;
 RETURN result;
END $$;

REVOKE ALL ON FUNCTION refs_persist_wbs_trace_relation_evidence(uuid,uuid,jsonb,jsonb,jsonb,text,text) FROM PUBLIC; REVOKE ALL ON FUNCTION refs_read_wbs_trace_relation_evidence(uuid,uuid,jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION refs_persist_wbs_trace_relation_evidence(uuid,uuid,jsonb,jsonb,jsonb,text,text) TO refs_app;
GRANT EXECUTE ON FUNCTION refs_read_wbs_trace_relation_evidence(uuid,uuid,jsonb) TO refs_app;
COMMIT;
