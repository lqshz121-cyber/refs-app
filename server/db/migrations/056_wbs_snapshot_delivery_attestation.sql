BEGIN;

-- A zero-row production view is meaningful only together with the signed,
-- complete extraction attestation that proves its scope.  Keep the
-- attestation separate from row receipts: it is immutable evidence, never a
-- source document, allocation, journal, or ledger mutation.
CREATE TABLE wbs_snapshot_delivery_attestation (
  wbs_snapshot_delivery_attestation_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant(tenant_id),
  entity_id uuid NOT NULL,
  wbs_snapshot_import_id uuid NOT NULL,
  attestation jsonb NOT NULL,
  attestation_hash text NOT NULL CHECK (attestation_hash ~ '^sha256:[0-9a-f]{64}$'),
  created_by text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE(tenant_id,entity_id,wbs_snapshot_import_id),
  UNIQUE(tenant_id,entity_id,wbs_snapshot_delivery_attestation_id),
  FOREIGN KEY(tenant_id,entity_id) REFERENCES entity(tenant_id,entity_id),
  FOREIGN KEY(tenant_id,entity_id,wbs_snapshot_import_id) REFERENCES wbs_snapshot_import(tenant_id,entity_id,wbs_snapshot_import_id)
);
ALTER TABLE wbs_snapshot_delivery_attestation ENABLE ROW LEVEL SECURITY;
CREATE POLICY wbs_snapshot_delivery_attestation_scope_policy ON wbs_snapshot_delivery_attestation
  USING (tenant_id=refs_current_tenant() AND refs_entity_allowed(entity_id))
  WITH CHECK (tenant_id=refs_current_tenant() AND refs_entity_allowed(entity_id));
CREATE TRIGGER wbs_snapshot_delivery_attestation_append_only BEFORE UPDATE OR DELETE ON wbs_snapshot_delivery_attestation
  FOR EACH ROW EXECUTE FUNCTION reject_mutation();
REVOKE ALL ON wbs_snapshot_delivery_attestation FROM PUBLIC,refs_app;
GRANT SELECT ON wbs_snapshot_delivery_attestation TO refs_app;

CREATE OR REPLACE FUNCTION refs_wbs_snapshot_import_hash(
  p_tenant uuid,p_entity uuid,p_snapshot uuid,p_captured_at timestamptz,p_environment text,
  p_dictionary_version text,p_package_hash text,p_receipts jsonb,p_delivery_attestation jsonb
) RETURNS text
LANGUAGE sql IMMUTABLE SET search_path=pg_catalog,public,pg_temp AS $$
  SELECT refs_jsonb_hash(jsonb_build_object(
    'tenant_id',p_tenant,'entity_id',p_entity,'snapshot_id',p_snapshot,'captured_at',p_captured_at,
    'environment',upper(btrim(p_environment)),'dictionary_version',btrim(p_dictionary_version),
    'package_hash',p_package_hash,'receipts',p_receipts,'delivery_attestation',p_delivery_attestation
  ))
$$;

CREATE OR REPLACE FUNCTION refs_record_wbs_snapshot_receipts(
  p_tenant uuid,p_entity uuid,p_snapshot uuid,p_captured_at timestamptz,p_environment text,
  p_dictionary_version text,p_package_hash text,p_receipts jsonb,p_delivery_attestation jsonb,p_idempotency_key text,p_request_hash text
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE computed_hash text; legacy_hash text; result jsonb; snapshot_import_id uuid; existing_hash text; delivery_hash text; actor text:=refs_current_actor(); source_entity text;
DECLARE view_item jsonb; view_count integer; view_name text; view_company text; view_rows integer; view_first text; view_last text; view_content_hash text;
BEGIN
  PERFORM refs_assert_scope(p_tenant,p_entity,'WBS.SNAPSHOT.IMPORT');
  IF actor IS NULL THEN RAISE EXCEPTION 'Authenticated actor missing' USING ERRCODE='42501'; END IF;
  computed_hash:=refs_wbs_snapshot_import_hash(p_tenant,p_entity,p_snapshot,p_captured_at,p_environment,p_dictionary_version,p_package_hash,p_receipts,p_delivery_attestation);
  IF p_request_hash<>computed_hash THEN RAISE EXCEPTION 'WBS snapshot delivery request hash is not canonical' USING ERRCODE='22023'; END IF;
  IF upper(btrim(p_environment))='PRODUCTION' AND p_delivery_attestation IS NULL THEN
    RAISE EXCEPTION 'Production WBS snapshot delivery attestation is required' USING ERRCODE='22023';
  END IF;
  IF p_delivery_attestation IS NOT NULL THEN
    IF jsonb_typeof(p_delivery_attestation)<>'object' OR p_delivery_attestation->>'schema_version'<>'WBS_READONLY_SNAPSHOT_V2'
       OR jsonb_typeof(p_delivery_attestation->'delivery')<>'object' OR (p_delivery_attestation->'delivery'->>'consistency')<>'COMPLETE'
       OR (p_delivery_attestation->'delivery'->>'pagination')<>'PRIMARY_KEY_SEEK'
       OR (p_delivery_attestation->'delivery'->>'read_consistency') NOT IN ('SNAPSHOT_ISOLATION','REPEATABLE_READ_TRANSACTION')
       OR jsonb_typeof(p_delivery_attestation->'views')<>'array' OR jsonb_array_length(p_delivery_attestation->'views')=0 THEN
      RAISE EXCEPTION 'WBS snapshot delivery attestation is invalid' USING ERRCODE='22023';
    END IF;
    SELECT source_entity_id INTO source_entity FROM entity WHERE tenant_id=p_tenant AND entity_id=p_entity FOR SHARE;
    FOR view_item IN SELECT value FROM jsonb_array_elements(p_delivery_attestation->'views') LOOP
      view_name:=view_item->>'name'; view_company:=view_item->>'company_key'; view_rows:=(view_item->>'row_count')::integer;
      view_first:=view_item->>'first_primary_key'; view_last:=view_item->>'last_primary_key'; view_content_hash:=view_item->>'content_hash';
      IF jsonb_typeof(view_item)<>'object' OR view_name IS NULL OR length(btrim(view_name))=0 OR view_company<>source_entity
         OR view_rows IS NULL OR view_rows<0 OR view_content_hash !~ '^sha256:[0-9a-f]{64}$'
         OR (view_rows=0 AND (view_first IS NOT NULL OR view_last IS NOT NULL))
         OR (view_rows>0 AND (view_first IS NULL OR view_last IS NULL)) THEN
        RAISE EXCEPTION 'WBS snapshot delivery view attestation is invalid' USING ERRCODE='22023';
      END IF;
    END LOOP;
  END IF;
  legacy_hash:=refs_wbs_snapshot_import_hash(p_tenant,p_entity,p_snapshot,p_captured_at,p_environment,p_dictionary_version,p_package_hash,p_receipts);
  result:=refs_record_wbs_snapshot_receipts(p_tenant,p_entity,p_snapshot,p_captured_at,p_environment,p_dictionary_version,p_package_hash,p_receipts,p_idempotency_key,legacy_hash);
  snapshot_import_id:=(result->>'wbs_snapshot_import_id')::uuid;
  IF p_delivery_attestation IS NULL THEN RETURN result; END IF;
  delivery_hash:=refs_jsonb_hash(p_delivery_attestation);
  SELECT attestation_hash INTO existing_hash FROM wbs_snapshot_delivery_attestation
    WHERE tenant_id=p_tenant AND entity_id=p_entity AND wbs_snapshot_import_id=snapshot_import_id FOR SHARE;
  IF FOUND THEN
    IF existing_hash<>delivery_hash THEN RAISE EXCEPTION 'WBS snapshot idempotency attestation conflict' USING ERRCODE='23505'; END IF;
    RETURN result;
  END IF;
  IF COALESCE((result->>'idempotent')::boolean,false) THEN
    RAISE EXCEPTION 'WBS snapshot delivery attestation is absent for an existing import' USING ERRCODE='23514';
  END IF;
  INSERT INTO wbs_snapshot_delivery_attestation(tenant_id,entity_id,wbs_snapshot_import_id,attestation,attestation_hash,created_by)
    VALUES(p_tenant,p_entity,snapshot_import_id,p_delivery_attestation,delivery_hash,actor);
  INSERT INTO audit_event(tenant_id,entity_id,event_type,object_type,object_id,action,actor_id,actor_type,permission_used,request_id,correlation_id,idempotency_key,after_hash,metadata)
    VALUES(p_tenant,p_entity,'WBS_SNAPSHOT_DELIVERY_ATTESTED','WBS_SNAPSHOT_DELIVERY',snapshot_import_id,'ATTEST',actor,'SERVICE_ACCOUNT','WBS.SNAPSHOT.IMPORT',p_idempotency_key,p_idempotency_key,p_idempotency_key,delivery_hash,jsonb_build_object('snapshot_id',p_snapshot,'attestation_hash',delivery_hash));
  INSERT INTO outbox_event(tenant_id,entity_id,aggregate_type,aggregate_id,event_type,payload,payload_hash)
    VALUES(p_tenant,p_entity,'WBS_SNAPSHOT',snapshot_import_id,'WBS_SNAPSHOT_DELIVERY_ATTESTED',jsonb_build_object('snapshot_id',p_snapshot,'attestation_hash',delivery_hash),refs_jsonb_hash(jsonb_build_object('snapshot_id',p_snapshot,'attestation_hash',delivery_hash)));
  RETURN result;
END;
$$;

REVOKE EXECUTE ON FUNCTION refs_wbs_snapshot_import_hash(uuid,uuid,uuid,timestamptz,text,text,text,jsonb,jsonb) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION refs_record_wbs_snapshot_receipts(uuid,uuid,uuid,timestamptz,text,text,text,jsonb,jsonb,text,text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION refs_record_wbs_snapshot_receipts(uuid,uuid,uuid,timestamptz,text,text,text,jsonb,text,text) FROM refs_app;
GRANT EXECUTE ON FUNCTION refs_wbs_snapshot_import_hash(uuid,uuid,uuid,timestamptz,text,text,text,jsonb,jsonb) TO refs_app;
GRANT EXECUTE ON FUNCTION refs_record_wbs_snapshot_receipts(uuid,uuid,uuid,timestamptz,text,text,text,jsonb,jsonb,text,text) TO refs_app;

COMMIT;
