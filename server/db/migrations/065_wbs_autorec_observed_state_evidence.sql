BEGIN;

CREATE TABLE wbs_autorec_observed_state_event (
  wbs_autorec_observed_state_event_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant(tenant_id), entity_id uuid NOT NULL,
  company_key text NOT NULL, source_record_id text NOT NULL, source_version text NOT NULL,
  receipt_id uuid NOT NULL REFERENCES wbs_inbound_receipt(receipt_id),
  receipt_hash text NOT NULL CHECK(receipt_hash ~ '^sha256:[0-9a-f]{64}$'),
  observed_at timestamptz NOT NULL,
  observed_state text NOT NULL CHECK(observed_state IN ('NOT_MATCHED','RELEASED','INCURRED')),
  observed_workflow_step text NOT NULL CHECK(observed_workflow_step IN ('DATA_PROCESSING_RELEASE','INCURRED_LIST')),
  source_status_code text, source_match_status_code text,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE(tenant_id,entity_id,company_key,source_record_id,source_version,receipt_id),
  FOREIGN KEY(tenant_id,entity_id) REFERENCES entity(tenant_id,entity_id)
);
ALTER TABLE wbs_autorec_observed_state_event ENABLE ROW LEVEL SECURITY;
CREATE POLICY wbs_autorec_observed_state_event_scope ON wbs_autorec_observed_state_event
  USING(tenant_id=refs_current_tenant() AND refs_entity_allowed(entity_id))
  WITH CHECK(tenant_id=refs_current_tenant() AND refs_entity_allowed(entity_id));
CREATE TRIGGER wbs_autorec_observed_state_event_append_only BEFORE UPDATE OR DELETE ON wbs_autorec_observed_state_event
  FOR EACH ROW EXECUTE FUNCTION reject_mutation();

CREATE OR REPLACE FUNCTION refs_persist_wbs_autorec_observed_state_evidence(p_tenant uuid,p_entity uuid,p_observations jsonb,p_idempotency text,p_request_hash text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE actor text:=refs_current_actor(); rec idempotency_receipt; item jsonb; inserted integer:=0; result jsonb;
BEGIN
 PERFORM refs_assert_scope(p_tenant,p_entity,'WBS.SNAPSHOT.IMPORT');
 IF actor IS NULL THEN RAISE EXCEPTION 'Authenticated actor missing' USING ERRCODE='42501'; END IF;
 IF jsonb_typeof(p_observations)<>'array' OR jsonb_array_length(p_observations)=0 OR jsonb_array_length(p_observations)>500 OR p_request_hash !~ '^sha256:[0-9a-f]{64}$' OR p_idempotency !~ '^[A-Za-z0-9._:-]{8,200}$' THEN RAISE EXCEPTION 'WBS observed-state payload is invalid' USING ERRCODE='22023'; END IF;
 INSERT INTO idempotency_receipt(tenant_id,operation_scope,idempotency_key,request_hash,status,actor_id)
 VALUES(p_tenant,'WBS_AUTOREC_OBSERVED_STATE:'||p_entity,p_idempotency,p_request_hash,'IN_PROGRESS',actor) ON CONFLICT DO NOTHING;
 SELECT * INTO rec FROM idempotency_receipt WHERE tenant_id=p_tenant AND operation_scope='WBS_AUTOREC_OBSERVED_STATE:'||p_entity AND idempotency_key=p_idempotency FOR UPDATE;
 IF rec.request_hash<>p_request_hash THEN RAISE EXCEPTION 'Idempotency key reused with different request' USING ERRCODE='23505'; END IF;
 IF rec.status='SUCCEEDED' THEN RETURN rec.response_body||jsonb_build_object('idempotent',true); END IF;
 FOR item IN SELECT value FROM jsonb_array_elements(p_observations) LOOP
   IF jsonb_typeof(item)<>'object' OR coalesce(item->>'company_key','')='' OR coalesce(item->>'source_record_id','')='' OR coalesce(item->>'source_version','')='' OR coalesce(item->>'receipt_id','') !~ '^[0-9a-fA-F-]{36}$' OR coalesce(item->>'receipt_hash','') !~ '^sha256:[0-9a-f]{64}$' OR coalesce(item->>'observed_at','') !~ '^20[0-9]{2}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(\.[0-9]{1,6})?Z$' OR item->>'observed_state' NOT IN ('NOT_MATCHED','RELEASED','INCURRED') OR (item->>'observed_state' IN ('NOT_MATCHED','RELEASED') AND item->>'observed_workflow_step'<>'DATA_PROCESSING_RELEASE') OR (item->>'observed_state'='INCURRED' AND item->>'observed_workflow_step'<>'INCURRED_LIST') OR coalesce(item->>'source_status_code','') ~ '[[:cntrl:]]' OR coalesce(item->>'source_match_status_code','') ~ '[[:cntrl:]]' OR length(coalesce(item->>'source_status_code',''))>64 OR length(coalesce(item->>'source_match_status_code',''))>64 THEN RAISE EXCEPTION 'WBS observed-state row is invalid' USING ERRCODE='22023'; END IF;
   IF NOT EXISTS(SELECT 1 FROM wbs_inbound_row r JOIN wbs_inbound_receipt receipt ON receipt.receipt_id=r.receipt_id AND receipt.tenant_id=r.tenant_id AND receipt.entity_id=r.entity_id WHERE r.tenant_id=p_tenant AND r.entity_id=p_entity AND r.source_record_id=item->>'source_record_id' AND r.source_version=item->>'source_version' AND r.normalized->>'source_type'='AUTOREC_PAYMENT_DETAIL' AND coalesce(r.normalized->>'company_key',r.raw->>'company_key')=item->>'company_key' AND r.receipt_id=(item->>'receipt_id')::uuid AND receipt.receipt_hash=item->>'receipt_hash') THEN RAISE EXCEPTION 'WBS observed-state row lacks an exact persisted AutoRec detail receipt' USING ERRCODE='22023'; END IF;
   INSERT INTO wbs_autorec_observed_state_event(tenant_id,entity_id,company_key,source_record_id,source_version,receipt_id,receipt_hash,observed_at,observed_state,observed_workflow_step,source_status_code,source_match_status_code)
   VALUES(p_tenant,p_entity,item->>'company_key',item->>'source_record_id',item->>'source_version',(item->>'receipt_id')::uuid,item->>'receipt_hash',(item->>'observed_at')::timestamptz,item->>'observed_state',item->>'observed_workflow_step',nullif(item->>'source_status_code',''),nullif(item->>'source_match_status_code','')) ON CONFLICT DO NOTHING;
   inserted:=inserted+1;
 END LOOP;
 result:=jsonb_build_object('observation_count',jsonb_array_length(p_observations),'accepted_count',inserted,'can_transition_refs',false,'can_release',false,'can_incur',false,'can_create_draft',false,'can_post',false,'idempotent',false);
 INSERT INTO audit_event(tenant_id,entity_id,event_type,object_type,object_id,action,actor_id,actor_type,permission_used,request_id,correlation_id,idempotency_key,after_hash,metadata)
 VALUES(p_tenant,p_entity,'WBS_AUTOREC_OBSERVED_STATE_PERSISTED','WBS_AUTOREC_OBSERVED_STATE',p_entity,'PERSIST',actor,'SERVICE_ACCOUNT','WBS.SNAPSHOT.IMPORT',p_idempotency,p_idempotency,p_idempotency,p_request_hash,jsonb_build_object('observation_count',jsonb_array_length(p_observations)));
 UPDATE idempotency_receipt SET status='SUCCEEDED',response_status=201,response_body=result,completed_at=clock_timestamp() WHERE tenant_id=p_tenant AND operation_scope='WBS_AUTOREC_OBSERVED_STATE:'||p_entity AND idempotency_key=p_idempotency;
 RETURN result;
END $$;

CREATE OR REPLACE FUNCTION refs_read_wbs_autorec_observed_state_evidence(p_tenant uuid,p_entity uuid,p_company text,p_source_records text[])
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE result jsonb;
BEGIN
 PERFORM refs_assert_scope(p_tenant,p_entity,'WBS.SNAPSHOT.IMPORT');
 IF btrim(coalesce(p_company,''))='' OR cardinality(p_source_records)=0 OR EXISTS(SELECT 1 FROM unnest(p_source_records) key WHERE btrim(coalesce(key,''))='') THEN RAISE EXCEPTION 'WBS observed-state read scope is invalid' USING ERRCODE='22023'; END IF;
 SELECT coalesce(jsonb_agg(jsonb_build_object('tenant_id',e.tenant_id,'entity_id',e.entity_id,'company_key',e.company_key,'source_record_id',e.source_record_id,'source_version',e.source_version,'receipt_id',e.receipt_id,'receipt_hash',e.receipt_hash,'observed_at',to_char(e.observed_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS"Z"'),'observed_state',e.observed_state,'observed_workflow_step',e.observed_workflow_step,'source_status_code',e.source_status_code,'source_match_status_code',e.source_match_status_code,'can_transition_refs',false,'can_release',false,'can_incur',false,'can_create_draft',false,'can_post',false) ORDER BY e.observed_at,e.source_version,e.wbs_autorec_observed_state_event_id),'[]'::jsonb) INTO result FROM wbs_autorec_observed_state_event e WHERE e.tenant_id=p_tenant AND e.entity_id=p_entity AND e.company_key=p_company AND e.source_record_id=ANY(p_source_records);
 RETURN result;
END $$;

REVOKE ALL ON wbs_autorec_observed_state_event FROM PUBLIC,refs_app;
GRANT SELECT ON wbs_autorec_observed_state_event TO refs_app;
REVOKE ALL ON FUNCTION refs_persist_wbs_autorec_observed_state_evidence(uuid,uuid,jsonb,text,text) FROM PUBLIC;
REVOKE ALL ON FUNCTION refs_read_wbs_autorec_observed_state_evidence(uuid,uuid,text,text[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION refs_persist_wbs_autorec_observed_state_evidence(uuid,uuid,jsonb,text,text) TO refs_app;
GRANT EXECUTE ON FUNCTION refs_read_wbs_autorec_observed_state_evidence(uuid,uuid,text,text[]) TO refs_app;
COMMIT;
