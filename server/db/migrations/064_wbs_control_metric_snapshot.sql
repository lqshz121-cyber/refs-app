BEGIN;

CREATE TABLE wbs_control_metric_snapshot (
  wbs_control_metric_snapshot_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant(tenant_id),
  entity_id uuid NOT NULL,
  source_type text NOT NULL CHECK(source_type IN ('COST_GENERAL_LEDGER','PROPERTY_COMPARISON')),
  scope jsonb NOT NULL CHECK(jsonb_typeof(scope)='object'),
  scope_hash text NOT NULL CHECK(scope_hash ~ '^sha256:[0-9a-f]{64}$'),
  receipt_id uuid NOT NULL REFERENCES wbs_inbound_receipt(receipt_id),
  receipt_hash text NOT NULL CHECK(receipt_hash ~ '^sha256:[0-9a-f]{64}$'),
  receipt_ref text NOT NULL, receipt_version text NOT NULL,
  receipt_manifest_hash text NOT NULL CHECK(receipt_manifest_hash ~ '^sha256:[0-9a-f]{64}$'),
  receipt_key_id text NOT NULL, receipt_algorithm text NOT NULL CHECK(receipt_algorithm='Ed25519'),
  metrics jsonb NOT NULL CHECK(jsonb_typeof(metrics)='array' AND jsonb_array_length(metrics)>0),
  metrics_hash text NOT NULL CHECK(metrics_hash ~ '^sha256:[0-9a-f]{64}$'),
  binding_hash text NOT NULL CHECK(binding_hash ~ '^sha256:[0-9a-f]{64}$'),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE(tenant_id,entity_id,binding_hash),
  FOREIGN KEY(tenant_id,entity_id) REFERENCES entity(tenant_id,entity_id)
);
ALTER TABLE wbs_control_metric_snapshot ENABLE ROW LEVEL SECURITY;
CREATE POLICY wbs_control_metric_snapshot_scope ON wbs_control_metric_snapshot
  USING(tenant_id=refs_current_tenant() AND refs_entity_allowed(entity_id))
  WITH CHECK(tenant_id=refs_current_tenant() AND refs_entity_allowed(entity_id));
CREATE TRIGGER wbs_control_metric_snapshot_append_only BEFORE UPDATE OR DELETE ON wbs_control_metric_snapshot
  FOR EACH ROW EXECUTE FUNCTION reject_mutation();

CREATE OR REPLACE FUNCTION refs_persist_wbs_control_metric_snapshot(p_tenant uuid,p_entity uuid,p_source_type text,p_scope jsonb,p_receipt_id uuid,p_receipt jsonb,p_metrics jsonb,p_idempotency text,p_binding_hash text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE actor text:=refs_current_actor(); rec idempotency_receipt; snapshot_id uuid; result jsonb; receipt_row record; required text[];
BEGIN
 PERFORM refs_assert_scope(p_tenant,p_entity,'WBS.SNAPSHOT.IMPORT');
 IF actor IS NULL THEN RAISE EXCEPTION 'Authenticated actor missing' USING ERRCODE='42501'; END IF;
 IF p_source_type NOT IN ('COST_GENERAL_LEDGER','PROPERTY_COMPARISON') OR jsonb_typeof(p_scope)<>'object' OR jsonb_typeof(p_receipt)<>'object' OR jsonb_typeof(p_metrics)<>'array' OR jsonb_array_length(p_metrics)=0 OR p_binding_hash !~ '^sha256:[0-9a-f]{64}$' THEN RAISE EXCEPTION 'WBS control snapshot payload is invalid' USING ERRCODE='22023'; END IF;
 required:=CASE WHEN p_source_type='COST_GENERAL_LEDGER' THEN ARRAY['tenant_id','entity_id','company_key','period','currency'] ELSE ARRAY['tenant_id','entity_id','company_key','property_ref','period_start','period_end','currency','bank_account_ref'] END;
 IF EXISTS(SELECT 1 FROM unnest(required) key WHERE coalesce(p_scope->>key,'')='') OR p_scope->>'tenant_id'<>p_tenant::text OR p_scope->>'entity_id'<>p_entity::text OR coalesce(p_scope->>'currency','') !~ '^[A-Z]{3}$' OR (p_source_type='COST_GENERAL_LEDGER' AND coalesce(p_scope->>'period','') !~ '^[0-9]{4}-(0[1-9]|1[0-2])$') OR (p_source_type='PROPERTY_COMPARISON' AND (coalesce(p_scope->>'period_start','') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' OR coalesce(p_scope->>'period_end','') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' OR p_scope->>'period_start'>p_scope->>'period_end')) THEN RAISE EXCEPTION 'WBS control snapshot scope is invalid' USING ERRCODE='22023'; END IF;
 IF coalesce(p_receipt->>'hash','') !~ '^sha256:[0-9a-f]{64}$' OR coalesce(p_receipt->>'metrics_hash','') !~ '^sha256:[0-9a-f]{64}$' OR coalesce(p_receipt->>'ref','')='' OR coalesce(p_receipt->>'version','')='' OR p_receipt->>'signature_verified'<>'true' OR coalesce(p_receipt->>'manifest_hash','') !~ '^sha256:[0-9a-f]{64}$' OR coalesce(p_receipt->>'key_id','')='' OR coalesce(p_receipt->>'algorithm','')<>'Ed25519' OR p_receipt->'scope'<>p_scope THEN RAISE EXCEPTION 'WBS control snapshot receipt is invalid' USING ERRCODE='22023'; END IF;
 SELECT receipt_hash,payload_ref INTO receipt_row FROM wbs_inbound_receipt WHERE receipt_id=p_receipt_id AND tenant_id=p_tenant AND entity_id=p_entity FOR SHARE;
 IF NOT FOUND OR receipt_row.receipt_hash<>p_receipt->>'hash' OR receipt_row.payload_ref<>p_receipt->>'ref' THEN RAISE EXCEPTION 'WBS control snapshot receipt is not an exact persisted inbound receipt' USING ERRCODE='22023'; END IF;
 IF NOT EXISTS(SELECT 1 FROM wbs_inbound_row r WHERE r.receipt_id=p_receipt_id AND r.tenant_id=p_tenant AND r.entity_id=p_entity AND r.normalized->>'source_type'=p_source_type) THEN RAISE EXCEPTION 'WBS control snapshot receipt does not contain the requested source type' USING ERRCODE='22023'; END IF;
 IF EXISTS(SELECT 1 FROM jsonb_array_elements(p_metrics) item WHERE jsonb_typeof(item)<>'object' OR coalesce(item->>'metric_key','') !~ '^[A-Z][A-Z0-9_]{1,95}$' OR coalesce(item->>'amount','') !~ '^-?(0|[1-9][0-9]*)([.][0-9]{1,4})?$') THEN RAISE EXCEPTION 'WBS control snapshot metrics are invalid' USING ERRCODE='22023'; END IF;
 INSERT INTO idempotency_receipt(tenant_id,operation_scope,idempotency_key,request_hash,status,actor_id) VALUES(p_tenant,'WBS_CONTROL:'||p_entity,p_idempotency,p_binding_hash,'IN_PROGRESS',actor) ON CONFLICT DO NOTHING;
 SELECT * INTO rec FROM idempotency_receipt WHERE tenant_id=p_tenant AND operation_scope='WBS_CONTROL:'||p_entity AND idempotency_key=p_idempotency FOR UPDATE;
 IF rec.request_hash<>p_binding_hash THEN RAISE EXCEPTION 'Idempotency key reused with different request' USING ERRCODE='23505'; END IF;
 IF rec.status='SUCCEEDED' THEN RETURN rec.response_body||jsonb_build_object('idempotent',true); END IF;
 INSERT INTO wbs_control_metric_snapshot(tenant_id,entity_id,source_type,scope,scope_hash,receipt_id,receipt_hash,receipt_ref,receipt_version,receipt_manifest_hash,receipt_key_id,receipt_algorithm,metrics,metrics_hash,binding_hash)
 VALUES(p_tenant,p_entity,p_source_type,p_scope,refs_jsonb_hash(p_scope),p_receipt_id,p_receipt->>'hash',p_receipt->>'ref',p_receipt->>'version',p_receipt->>'manifest_hash',p_receipt->>'key_id',p_receipt->>'algorithm',p_metrics,p_receipt->>'metrics_hash',p_binding_hash) RETURNING wbs_control_metric_snapshot_id INTO snapshot_id;
 result:=jsonb_build_object('snapshot_id',snapshot_id,'source_type',p_source_type,'can_create_transaction',false,'can_allocate',false,'can_create_draft',false,'can_post',false,'idempotent',false);
 INSERT INTO audit_event(tenant_id,entity_id,event_type,object_type,object_id,action,actor_id,actor_type,permission_used,request_id,correlation_id,idempotency_key,after_hash,metadata) VALUES(p_tenant,p_entity,'WBS_CONTROL_METRIC_SNAPSHOT_PERSISTED','WBS_CONTROL_METRIC_SNAPSHOT',snapshot_id,'PERSIST',actor,'SERVICE_ACCOUNT','WBS.SNAPSHOT.IMPORT',p_idempotency,p_idempotency,p_idempotency,p_binding_hash,jsonb_build_object('source_type',p_source_type,'metric_count',jsonb_array_length(p_metrics)));
 UPDATE idempotency_receipt SET status='SUCCEEDED',response_status=201,response_body=result,completed_at=clock_timestamp() WHERE tenant_id=p_tenant AND operation_scope='WBS_CONTROL:'||p_entity AND idempotency_key=p_idempotency;
 RETURN result;
END $$;

CREATE OR REPLACE FUNCTION refs_read_wbs_control_metric_snapshot(p_tenant uuid,p_entity uuid,p_source_type text,p_scope jsonb)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE result jsonb;
BEGIN
 PERFORM refs_assert_scope(p_tenant,p_entity,'WBS.SNAPSHOT.IMPORT');
 IF p_source_type NOT IN ('COST_GENERAL_LEDGER','PROPERTY_COMPARISON') OR jsonb_typeof(p_scope)<>'object' OR p_scope->>'tenant_id'<>p_tenant::text OR p_scope->>'entity_id'<>p_entity::text THEN RAISE EXCEPTION 'WBS control snapshot read scope is invalid' USING ERRCODE='22023'; END IF;
 SELECT jsonb_build_object('snapshot_id',s.wbs_control_metric_snapshot_id,'tenant_id',s.tenant_id,'entity_id',s.entity_id,'source_type',s.source_type,'scope',s.scope,'receipt',jsonb_build_object('hash',s.receipt_hash,'metrics_hash',s.metrics_hash,'ref',s.receipt_ref,'version',s.receipt_version,'scope',s.scope,'signature_verified',true,'manifest_hash',s.receipt_manifest_hash,'key_id',s.receipt_key_id,'algorithm',s.receipt_algorithm),'metrics',s.metrics,'can_create_transaction',false,'can_allocate',false,'can_create_draft',false,'can_post',false) INTO result FROM wbs_control_metric_snapshot s WHERE s.tenant_id=p_tenant AND s.entity_id=p_entity AND s.source_type=p_source_type AND s.scope=p_scope ORDER BY s.created_at DESC,s.wbs_control_metric_snapshot_id DESC LIMIT 1;
 RETURN result;
END $$;

REVOKE ALL ON wbs_control_metric_snapshot FROM PUBLIC,refs_app;
GRANT SELECT ON wbs_control_metric_snapshot TO refs_app;
REVOKE ALL ON FUNCTION refs_persist_wbs_control_metric_snapshot(uuid,uuid,text,jsonb,uuid,jsonb,jsonb,text,text) FROM PUBLIC;
REVOKE ALL ON FUNCTION refs_read_wbs_control_metric_snapshot(uuid,uuid,text,jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION refs_persist_wbs_control_metric_snapshot(uuid,uuid,text,jsonb,uuid,jsonb,jsonb,text,text) TO refs_app;
GRANT EXECUTE ON FUNCTION refs_read_wbs_control_metric_snapshot(uuid,uuid,text,jsonb) TO refs_app;
COMMIT;
