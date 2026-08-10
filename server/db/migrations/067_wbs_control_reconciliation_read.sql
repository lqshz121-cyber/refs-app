BEGIN;

-- This is a REFS-owned, immutable read model for the ledger-side control
-- snapshot.  It deliberately does not create a journal or consume a WBS
-- record.  The accounting close process owns population of this table.
CREATE TABLE refs_control_metric_snapshot (
  refs_control_metric_snapshot_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant(tenant_id),
  entity_id uuid NOT NULL,
  source_type text NOT NULL CHECK(source_type IN ('COST_GENERAL_LEDGER','PROPERTY_COMPARISON')),
  scope jsonb NOT NULL CHECK(jsonb_typeof(scope)='object'),
  scope_hash text NOT NULL CHECK(scope_hash ~ '^sha256:[0-9a-f]{64}$'),
  receipt_hash text NOT NULL CHECK(receipt_hash ~ '^sha256:[0-9a-f]{64}$'),
  receipt_ref text NOT NULL CHECK(length(btrim(receipt_ref))>0),
  receipt_version text NOT NULL CHECK(length(btrim(receipt_version))>0),
  metrics jsonb NOT NULL CHECK(jsonb_typeof(metrics)='array' AND jsonb_array_length(metrics)>0),
  metrics_hash text NOT NULL CHECK(metrics_hash ~ '^sha256:[0-9a-f]{64}$'),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  FOREIGN KEY(tenant_id,entity_id) REFERENCES entity(tenant_id,entity_id),
  UNIQUE(tenant_id,entity_id,source_type,scope_hash,receipt_hash)
);
ALTER TABLE refs_control_metric_snapshot ENABLE ROW LEVEL SECURITY;
CREATE POLICY refs_control_metric_snapshot_scope ON refs_control_metric_snapshot
  USING(tenant_id=refs_current_tenant() AND refs_entity_allowed(entity_id))
  WITH CHECK(tenant_id=refs_current_tenant() AND refs_entity_allowed(entity_id));
CREATE TRIGGER refs_control_metric_snapshot_append_only BEFORE UPDATE OR DELETE ON refs_control_metric_snapshot
  FOR EACH ROW EXECUTE FUNCTION reject_mutation();

CREATE OR REPLACE FUNCTION refs_read_refs_control_metric_snapshot(p_tenant uuid,p_entity uuid,p_source_type text,p_scope jsonb)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE result jsonb;
BEGIN
 PERFORM refs_assert_scope(p_tenant,p_entity,'WBS.SNAPSHOT.IMPORT');
 IF p_source_type NOT IN ('COST_GENERAL_LEDGER','PROPERTY_COMPARISON') OR jsonb_typeof(p_scope)<>'object' OR p_scope->>'tenant_id'<>p_tenant::text OR p_scope->>'entity_id'<>p_entity::text THEN RAISE EXCEPTION 'REFS control snapshot read scope is invalid' USING ERRCODE='22023'; END IF;
 SELECT jsonb_build_object('snapshot_id',s.refs_control_metric_snapshot_id,'tenant_id',s.tenant_id,'entity_id',s.entity_id,'source_type',s.source_type,'scope',s.scope,'receipt',jsonb_build_object('hash',s.receipt_hash,'ref',s.receipt_ref,'version',s.receipt_version,'scope',s.scope),'metrics',s.metrics,'can_create_transaction',false,'can_allocate',false,'can_create_draft',false,'can_post',false)
 INTO result FROM refs_control_metric_snapshot s WHERE s.tenant_id=p_tenant AND s.entity_id=p_entity AND s.source_type=p_source_type AND s.scope=p_scope ORDER BY s.created_at DESC,s.refs_control_metric_snapshot_id DESC LIMIT 1;
 RETURN result;
END $$;

CREATE OR REPLACE FUNCTION refs_read_wbs_control_reconciliation_mapping(p_tenant uuid,p_entity uuid,p_source_type text,p_scope jsonb)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE family_name text; result jsonb; candidate_count integer;
BEGIN
 PERFORM refs_assert_scope(p_tenant,p_entity,'WBS.SNAPSHOT.IMPORT');
 IF p_source_type='COST_GENERAL_LEDGER' THEN family_name:='WBS_COST_GL_CONTROL_RECONCILIATION';
 ELSIF p_source_type='PROPERTY_COMPARISON' THEN family_name:='WBS_PROPERTY_CONTROL_RECONCILIATION';
 ELSE RAISE EXCEPTION 'WBS control mapping source type is invalid' USING ERRCODE='22023'; END IF;
 IF jsonb_typeof(p_scope)<>'object' OR p_scope->>'tenant_id'<>p_tenant::text OR p_scope->>'entity_id'<>p_entity::text THEN RAISE EXCEPTION 'WBS control mapping scope is invalid' USING ERRCODE='22023'; END IF;
 SELECT count(*) INTO candidate_count FROM mapping_snapshot m WHERE m.tenant_id=p_tenant AND m.entity_id=p_entity AND m.family=family_name AND m.status='APPROVED' AND m.effective_from<=clock_timestamp() AND (m.effective_to IS NULL OR m.effective_to>clock_timestamp()) AND m.input_keys=p_scope AND m.priority=(SELECT max(priority) FROM mapping_snapshot x WHERE x.tenant_id=p_tenant AND x.entity_id=p_entity AND x.family=family_name AND x.status='APPROVED' AND x.effective_from<=clock_timestamp() AND (x.effective_to IS NULL OR x.effective_to>clock_timestamp()) AND x.input_keys=p_scope);
 IF candidate_count<>1 THEN RETURN NULL; END IF;
 SELECT jsonb_build_object('mapping_id',m.mapping_snapshot_id,'tenant_id',m.tenant_id,'entity_id',m.entity_id,'status',m.status,'version',m.version::text,'snapshot_hash',m.snapshot_hash,'scope',p_scope,'metric_keys',m.output_rules->'metric_keys') INTO result FROM mapping_snapshot m WHERE m.tenant_id=p_tenant AND m.entity_id=p_entity AND m.family=family_name AND m.status='APPROVED' AND m.effective_from<=clock_timestamp() AND (m.effective_to IS NULL OR m.effective_to>clock_timestamp()) AND m.input_keys=p_scope ORDER BY m.priority DESC,m.mapping_snapshot_id LIMIT 1;
 RETURN result;
END $$;

REVOKE ALL ON refs_control_metric_snapshot FROM PUBLIC,refs_app;
GRANT SELECT ON refs_control_metric_snapshot TO refs_app;
REVOKE ALL ON FUNCTION refs_read_refs_control_metric_snapshot(uuid,uuid,text,jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION refs_read_wbs_control_reconciliation_mapping(uuid,uuid,text,jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION refs_read_refs_control_metric_snapshot(uuid,uuid,text,jsonb) TO refs_app;
GRANT EXECUTE ON FUNCTION refs_read_wbs_control_reconciliation_mapping(uuid,uuid,text,jsonb) TO refs_app;
COMMIT;
