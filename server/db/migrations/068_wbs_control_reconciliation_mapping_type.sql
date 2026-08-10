BEGIN;

-- The read composition validates the mapping family before comparing metrics.
-- Return it as immutable read evidence instead of trusting the HTTP caller to
-- classify a mapping row.
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
 SELECT jsonb_build_object('mapping_id',m.mapping_snapshot_id,'tenant_id',m.tenant_id,'entity_id',m.entity_id,'status',m.status,'mapping_type',m.family,'version',m.version::text,'snapshot_hash',m.snapshot_hash,'scope',p_scope,'metric_keys',m.output_rules->'metric_keys') INTO result FROM mapping_snapshot m WHERE m.tenant_id=p_tenant AND m.entity_id=p_entity AND m.family=family_name AND m.status='APPROVED' AND m.effective_from<=clock_timestamp() AND (m.effective_to IS NULL OR m.effective_to>clock_timestamp()) AND m.input_keys=p_scope ORDER BY m.priority DESC,m.mapping_snapshot_id LIMIT 1;
 RETURN result;
END $$;

REVOKE ALL ON FUNCTION refs_read_wbs_control_reconciliation_mapping(uuid,uuid,text,jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION refs_read_wbs_control_reconciliation_mapping(uuid,uuid,text,jsonb) TO refs_app;
COMMIT;
