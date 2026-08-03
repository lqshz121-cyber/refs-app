BEGIN;

-- A periodic WBS export has no revision/tombstone/replay contract.  It is an
-- immutable observation, not a current transactional source and must never be
-- promoted to a journal merely because it was received.
INSERT INTO permission_catalog(permission_code,domain,risk_class,sod_class)
  VALUES('WBS.SNAPSHOT.IMPORT','WBS','HIGH','WBS_INGEST_SERVICE')
  ON CONFLICT (permission_code) DO NOTHING;

CREATE TABLE wbs_snapshot_import (
  wbs_snapshot_import_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant(tenant_id),
  entity_id uuid NOT NULL,
  snapshot_id uuid NOT NULL,
  captured_at timestamptz NOT NULL,
  environment text NOT NULL CHECK (environment IN ('SANDBOX','PRODUCTION')),
  dictionary_version text NOT NULL CHECK (length(btrim(dictionary_version)) BETWEEN 1 AND 128),
  package_hash text NOT NULL CHECK (package_hash ~ '^sha256:[0-9a-f]{64}$'),
  import_batch_id uuid NOT NULL REFERENCES import_batch(import_batch_id),
  created_by text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE(tenant_id,entity_id,snapshot_id),
  UNIQUE(tenant_id,entity_id,wbs_snapshot_import_id),
  FOREIGN KEY(tenant_id,entity_id) REFERENCES entity(tenant_id,entity_id),
  FOREIGN KEY(tenant_id,import_batch_id) REFERENCES import_batch(tenant_id,import_batch_id)
);

CREATE TABLE wbs_snapshot_receipt (
  wbs_snapshot_receipt_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant(tenant_id),
  entity_id uuid NOT NULL,
  wbs_snapshot_import_id uuid NOT NULL REFERENCES wbs_snapshot_import(wbs_snapshot_import_id),
  source_module text NOT NULL CHECK (length(btrim(source_module)) BETWEEN 1 AND 96),
  source_entity_id text NOT NULL CHECK (length(btrim(source_entity_id)) BETWEEN 1 AND 128),
  source_record_id text NOT NULL CHECK (length(btrim(source_record_id)) BETWEEN 1 AND 128),
  source_version text NOT NULL CHECK (length(btrim(source_version)) BETWEEN 1 AND 128),
  payload_hash text NOT NULL CHECK (payload_hash ~ '^sha256:[0-9a-f]{64}$'),
  payload_ref text NOT NULL CHECK (payload_ref ~ '^object://wbs-snapshot/'),
  ingestion_kind text NOT NULL CHECK (ingestion_kind IN ('TRANSACTION_CANDIDATE','AUTOREC_CANDIDATE','CONTROL_SOURCE','LEDGER_EVIDENCE','CONTROL_EVIDENCE')),
  receipt_hash text NOT NULL CHECK (receipt_hash ~ '^sha256:[0-9a-f]{64}$'),
  received_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE(tenant_id,entity_id,wbs_snapshot_import_id,source_module,source_entity_id,source_record_id,source_version),
  FOREIGN KEY(tenant_id,entity_id) REFERENCES entity(tenant_id,entity_id),
  FOREIGN KEY(tenant_id,entity_id,wbs_snapshot_import_id) REFERENCES wbs_snapshot_import(tenant_id,entity_id,wbs_snapshot_import_id)
);

ALTER TABLE wbs_snapshot_import ENABLE ROW LEVEL SECURITY;
ALTER TABLE wbs_snapshot_receipt ENABLE ROW LEVEL SECURITY;
CREATE POLICY wbs_snapshot_import_scope_policy ON wbs_snapshot_import
  USING (tenant_id=refs_current_tenant() AND refs_entity_allowed(entity_id))
  WITH CHECK (tenant_id=refs_current_tenant() AND refs_entity_allowed(entity_id));
CREATE POLICY wbs_snapshot_receipt_scope_policy ON wbs_snapshot_receipt
  USING (tenant_id=refs_current_tenant() AND refs_entity_allowed(entity_id))
  WITH CHECK (tenant_id=refs_current_tenant() AND refs_entity_allowed(entity_id));
CREATE TRIGGER wbs_snapshot_import_append_only BEFORE UPDATE OR DELETE ON wbs_snapshot_import
  FOR EACH ROW EXECUTE FUNCTION reject_mutation();
CREATE TRIGGER wbs_snapshot_receipt_append_only BEFORE UPDATE OR DELETE ON wbs_snapshot_receipt
  FOR EACH ROW EXECUTE FUNCTION reject_mutation();

CREATE OR REPLACE FUNCTION refs_wbs_snapshot_import_hash(
  p_tenant uuid,p_entity uuid,p_snapshot uuid,p_captured_at timestamptz,p_environment text,
  p_dictionary_version text,p_package_hash text,p_receipts jsonb
) RETURNS text
LANGUAGE sql IMMUTABLE SET search_path=pg_catalog,public,pg_temp AS $$
  SELECT refs_jsonb_hash(jsonb_build_object(
    'tenant_id',p_tenant,'entity_id',p_entity,'snapshot_id',p_snapshot,'captured_at',p_captured_at,
    'environment',upper(btrim(p_environment)),'dictionary_version',btrim(p_dictionary_version),
    'package_hash',p_package_hash,'receipts',p_receipts
  ))
$$;

CREATE OR REPLACE FUNCTION refs_record_wbs_snapshot_receipts(
  p_tenant uuid,p_entity uuid,p_snapshot uuid,p_captured_at timestamptz,p_environment text,
  p_dictionary_version text,p_package_hash text,p_receipts jsonb,p_idempotency_key text,p_request_hash text
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE actor text:=refs_current_actor(); receipt idempotency_receipt; computed_hash text; batch_id uuid:=gen_random_uuid(); snapshot_import_id uuid:=gen_random_uuid();
DECLARE entity_source_system text; entity_source_id text; item jsonb; event_payload jsonb; response jsonb; count_rows integer:=0;
DECLARE item_module text; item_entity text; item_record text; item_version text; item_payload_hash text; item_payload_ref text; item_kind text; item_receipt_hash text;
BEGIN
  PERFORM refs_assert_scope(p_tenant,p_entity,'WBS.SNAPSHOT.IMPORT');
  IF actor IS NULL THEN RAISE EXCEPTION 'Authenticated actor missing' USING ERRCODE='42501'; END IF;
  computed_hash:=refs_wbs_snapshot_import_hash(p_tenant,p_entity,p_snapshot,p_captured_at,p_environment,p_dictionary_version,p_package_hash,p_receipts);
  IF p_request_hash<>computed_hash THEN RAISE EXCEPTION 'WBS snapshot request hash is not canonical' USING ERRCODE='22023'; END IF;
  INSERT INTO idempotency_receipt(tenant_id,operation_scope,idempotency_key,request_hash,status,actor_id)
    VALUES(p_tenant,'WBS_SNAPSHOT_IMPORT:'||p_entity,p_idempotency_key,p_request_hash,'IN_PROGRESS',actor)
    ON CONFLICT (tenant_id,operation_scope,idempotency_key) DO NOTHING;
  SELECT * INTO receipt FROM idempotency_receipt
    WHERE tenant_id=p_tenant AND operation_scope='WBS_SNAPSHOT_IMPORT:'||p_entity AND idempotency_key=p_idempotency_key
    FOR UPDATE;
  IF receipt.request_hash<>p_request_hash THEN RAISE EXCEPTION 'Idempotency key reused with different request hash' USING ERRCODE='23505'; END IF;
  IF receipt.status='SUCCEEDED' THEN RETURN receipt.response_body||jsonb_build_object('idempotent',true); END IF;
  IF p_captured_at>clock_timestamp()+interval '5 minutes' OR upper(btrim(p_environment)) NOT IN ('SANDBOX','PRODUCTION')
     OR length(btrim(p_dictionary_version))=0 OR p_package_hash !~ '^sha256:[0-9a-f]{64}$'
     OR jsonb_typeof(p_receipts)<>'array' OR jsonb_array_length(p_receipts)=0 THEN
    RAISE EXCEPTION 'WBS snapshot metadata is invalid' USING ERRCODE='22023';
  END IF;
  SELECT source_system,source_entity_id INTO entity_source_system,entity_source_id
    FROM entity WHERE tenant_id=p_tenant AND entity_id=p_entity FOR SHARE;
  IF NOT FOUND OR entity_source_system<>'WBS' THEN RAISE EXCEPTION 'WBS snapshot entity scope is invalid' USING ERRCODE='42501'; END IF;
  INSERT INTO import_batch(import_batch_id,tenant_id,entity_id,connector_code,source_module,source_entity_id,idempotency_key,request_hash,status,row_count,started_at,completed_at)
    VALUES(batch_id,p_tenant,p_entity,'WBS_SNAPSHOT','snapshot_observation',entity_source_id,p_idempotency_key,p_request_hash,'SUCCEEDED',jsonb_array_length(p_receipts),clock_timestamp(),clock_timestamp());
  INSERT INTO wbs_snapshot_import(wbs_snapshot_import_id,tenant_id,entity_id,snapshot_id,captured_at,environment,dictionary_version,package_hash,import_batch_id,created_by)
    VALUES(snapshot_import_id,p_tenant,p_entity,p_snapshot,p_captured_at,upper(btrim(p_environment)),btrim(p_dictionary_version),p_package_hash,batch_id,actor);
  FOR item IN SELECT value FROM jsonb_array_elements(p_receipts)
  LOOP
    item_module:=item->>'source_module'; item_entity:=item->>'source_entity_id'; item_record:=item->>'source_record_id'; item_version:=item->>'source_version';
    item_payload_hash:=item->>'payload_hash'; item_payload_ref:=item->>'payload_ref'; item_kind:=item->>'ingestion_kind';
    IF item->>'snapshot_id'<>p_snapshot::text OR item->>'source_system'<>'WBS' OR item_entity<>entity_source_id
       OR item_module IS NULL OR length(btrim(item_module))=0 OR item_record IS NULL OR length(btrim(item_record))=0
       OR item_version !~ ('^snapshot:'||p_snapshot::text||':') OR item_payload_hash !~ '^sha256:[0-9a-f]{64}$'
       OR item_payload_ref !~ '^object://wbs-snapshot/' OR item_kind NOT IN ('TRANSACTION_CANDIDATE','AUTOREC_CANDIDATE','CONTROL_SOURCE','LEDGER_EVIDENCE','CONTROL_EVIDENCE') THEN
      RAISE EXCEPTION 'WBS snapshot receipt is invalid or outside entity scope' USING ERRCODE='22023';
    END IF;
    item_receipt_hash:=refs_jsonb_hash(item);
    INSERT INTO wbs_snapshot_receipt(tenant_id,entity_id,wbs_snapshot_import_id,source_module,source_entity_id,source_record_id,source_version,payload_hash,payload_ref,ingestion_kind,receipt_hash)
      VALUES(p_tenant,p_entity,snapshot_import_id,item_module,item_entity,item_record,item_version,item_payload_hash,item_payload_ref,item_kind,item_receipt_hash);
    count_rows:=count_rows+1;
  END LOOP;
  event_payload:=jsonb_build_object('snapshot_id',p_snapshot,'import_batch_id',batch_id,'package_hash',p_package_hash,'receipt_count',count_rows,'environment',upper(btrim(p_environment)));
  INSERT INTO audit_event(tenant_id,entity_id,event_type,object_type,object_id,action,actor_id,actor_type,permission_used,request_id,correlation_id,idempotency_key,after_hash,metadata)
    VALUES(p_tenant,p_entity,'WBS_SNAPSHOT_OBSERVED','WBS_SNAPSHOT',snapshot_import_id,'IMPORT',actor,'SERVICE_ACCOUNT','WBS.SNAPSHOT.IMPORT',p_idempotency_key,p_idempotency_key,p_idempotency_key,refs_jsonb_hash(event_payload),jsonb_build_object('snapshot_id',p_snapshot,'receipt_count',count_rows,'environment',upper(btrim(p_environment))));
  INSERT INTO outbox_event(tenant_id,entity_id,aggregate_type,aggregate_id,event_type,payload,payload_hash)
    VALUES(p_tenant,p_entity,'WBS_SNAPSHOT',snapshot_import_id,'WBS_SNAPSHOT_OBSERVED',event_payload,refs_jsonb_hash(event_payload));
  response:=jsonb_build_object('wbs_snapshot_import_id',snapshot_import_id,'import_batch_id',batch_id,'snapshot_id',p_snapshot,'receipt_count',count_rows,'idempotent',false);
  UPDATE idempotency_receipt SET status='SUCCEEDED',response_status=201,response_body=response,completed_at=clock_timestamp()
    WHERE tenant_id=p_tenant AND operation_scope='WBS_SNAPSHOT_IMPORT:'||p_entity AND idempotency_key=p_idempotency_key;
  RETURN response;
END;
$$;

REVOKE ALL ON wbs_snapshot_import,wbs_snapshot_receipt FROM PUBLIC,refs_app;
GRANT SELECT ON wbs_snapshot_import,wbs_snapshot_receipt TO refs_app;
REVOKE EXECUTE ON FUNCTION refs_wbs_snapshot_import_hash(uuid,uuid,uuid,timestamptz,text,text,text,jsonb) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION refs_record_wbs_snapshot_receipts(uuid,uuid,uuid,timestamptz,text,text,text,jsonb,text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION refs_wbs_snapshot_import_hash(uuid,uuid,uuid,timestamptz,text,text,text,jsonb) TO refs_app;
GRANT EXECUTE ON FUNCTION refs_record_wbs_snapshot_receipts(uuid,uuid,uuid,timestamptz,text,text,text,jsonb,text,text) TO refs_app;

COMMIT;
