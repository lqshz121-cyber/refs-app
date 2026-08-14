BEGIN;

CREATE TABLE wbs_provider_signed_payable_admission (
  wbs_provider_signed_payable_admission_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant(tenant_id),
  entity_id uuid NOT NULL,
  issuer text NOT NULL CHECK(length(btrim(issuer)) BETWEEN 1 AND 128),
  key_id text NOT NULL CHECK(length(btrim(key_id)) BETWEEN 1 AND 128),
  algorithm text NOT NULL CHECK(algorithm='Ed25519'),
  nonce text NOT NULL CHECK(length(btrim(nonce)) BETWEEN 1 AND 128),
  company_code text NOT NULL CHECK(length(btrim(company_code)) BETWEEN 1 AND 128),
  signed_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL,
  request_raw_hash text NOT NULL CHECK(request_raw_hash~'^sha256:[0-9a-f]{64}$'),
  response_raw_hash text NOT NULL CHECK(response_raw_hash~'^sha256:[0-9a-f]{64}$'),
  package_raw_hash text NOT NULL CHECK(package_raw_hash~'^sha256:[0-9a-f]{64}$'),
  package_hash text NOT NULL CHECK(package_hash~'^sha256:[0-9a-f]{64}$'),
  receipt_hash text NOT NULL CHECK(receipt_hash~'^sha256:[0-9a-f]{64}$'),
  snapshot_id uuid NOT NULL,
  import_batch_id uuid NOT NULL REFERENCES import_batch(import_batch_id),
  wbs_snapshot_import_id uuid NOT NULL REFERENCES wbs_snapshot_import(wbs_snapshot_import_id),
  admitted_by text NOT NULL,
  admitted_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE(tenant_id,issuer,key_id,nonce),
  UNIQUE(tenant_id,entity_id,snapshot_id),
  UNIQUE(tenant_id,entity_id,wbs_provider_signed_payable_admission_id),
  FOREIGN KEY(tenant_id,entity_id) REFERENCES entity(tenant_id,entity_id),
  FOREIGN KEY(tenant_id,import_batch_id) REFERENCES import_batch(tenant_id,import_batch_id),
  FOREIGN KEY(tenant_id,entity_id,wbs_snapshot_import_id)
    REFERENCES wbs_snapshot_import(tenant_id,entity_id,wbs_snapshot_import_id),
  CHECK(expires_at>signed_at AND expires_at-signed_at<=interval '15 minutes')
);

ALTER TABLE wbs_provider_signed_payable_admission ENABLE ROW LEVEL SECURITY;
CREATE POLICY wbs_provider_signed_payable_admission_scope ON wbs_provider_signed_payable_admission
  USING(tenant_id=refs_current_tenant() AND refs_entity_allowed(entity_id))
  WITH CHECK(tenant_id=refs_current_tenant() AND refs_entity_allowed(entity_id));
CREATE TRIGGER wbs_provider_signed_payable_admission_append_only
  BEFORE UPDATE OR DELETE ON wbs_provider_signed_payable_admission
  FOR EACH ROW EXECUTE FUNCTION reject_mutation();

CREATE FUNCTION refs_wbs_provider_signed_payable_admission_hash(
  p_tenant uuid,p_entity uuid,p_delivery jsonb,p_snapshot jsonb,p_groups jsonb
) RETURNS text
LANGUAGE sql IMMUTABLE SET search_path=pg_catalog,public,pg_temp AS $$
  SELECT refs_jsonb_hash(jsonb_build_object(
    'tenant_id',p_tenant,'entity_id',p_entity,'delivery',p_delivery,
    'snapshot',p_snapshot,'groups',p_groups
  ))
$$;

CREATE FUNCTION refs_admit_wbs_provider_signed_payables(
  p_tenant uuid,p_entity uuid,p_delivery jsonb,p_snapshot jsonb,p_groups jsonb,
  p_idempotency_key text,p_request_hash text
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE actor text:=refs_current_actor(); idem idempotency_receipt; computed_hash text;
DECLARE source_system text; source_entity_id text; snapshot_result jsonb; inbound_result jsonb;
DECLARE snapshot_hash text; inbound_hash text; snapshot_key text; inbound_key text;
DECLARE admission_id uuid:=gen_random_uuid(); response jsonb; event_payload jsonb;
BEGIN
  PERFORM refs_assert_scope(p_tenant,p_entity,'WBS.SNAPSHOT.IMPORT');
  IF actor IS NULL THEN RAISE EXCEPTION 'Authenticated service actor missing' USING ERRCODE='42501'; END IF;
  computed_hash:=refs_wbs_provider_signed_payable_admission_hash(p_tenant,p_entity,p_delivery,p_snapshot,p_groups);
  IF p_request_hash<>computed_hash THEN RAISE EXCEPTION 'Provider signed admission request hash is not canonical' USING ERRCODE='22023'; END IF;
  IF jsonb_typeof(p_delivery)<>'object' OR jsonb_typeof(p_snapshot)<>'object' OR jsonb_typeof(p_groups)<>'array'
     OR jsonb_array_length(p_groups)=0 OR p_snapshot->>'schema_version'<>'WBS_READONLY_SNAPSHOT_V2'
     OR p_snapshot->>'environment'<>'PRODUCTION' OR p_snapshot->>'source_system'<>'WBS'
     OR jsonb_array_length(p_snapshot->'views')<>1 OR p_snapshot->'views'->0->>'name'<>'BGDATA.payable'
     OR p_delivery->>'algorithm'<>'Ed25519'
     OR p_delivery->>'request_raw_hash'!~'^sha256:[0-9a-f]{64}$'
     OR p_delivery->>'response_raw_hash'!~'^sha256:[0-9a-f]{64}$'
     OR p_delivery->>'package_raw_hash'!~'^sha256:[0-9a-f]{64}$'
     OR p_delivery->>'package_hash'!~'^sha256:[0-9a-f]{64}$'
     OR p_delivery->>'receipt_hash'!~'^sha256:[0-9a-f]{64}$'
     OR p_delivery->>'package_hash' IS DISTINCT FROM p_snapshot->>'package_hash'
     OR p_delivery->>'snapshot_id' IS DISTINCT FROM p_snapshot->>'snapshot_id'
     OR p_delivery->>'company_code' IS DISTINCT FROM p_snapshot->'views'->0->>'company_key'
     OR (p_delivery->>'signed_at')::timestamptz>clock_timestamp()+interval '5 minutes'
     OR (p_delivery->>'expires_at')::timestamptz<=clock_timestamp()
     OR (p_delivery->>'expires_at')::timestamptz-(p_delivery->>'signed_at')::timestamptz>interval '15 minutes' THEN
    RAISE EXCEPTION 'Provider signed delivery is invalid, expired, or outside Payable scope' USING ERRCODE='22023';
  END IF;
  SELECT e.source_system,e.source_entity_id INTO source_system,source_entity_id
    FROM entity e WHERE e.tenant_id=p_tenant AND e.entity_id=p_entity AND e.active FOR SHARE;
  IF NOT FOUND OR source_system<>'WBS' OR source_entity_id IS DISTINCT FROM p_delivery->>'company_code' THEN
    RAISE EXCEPTION 'Provider signed delivery entity/company scope is denied' USING ERRCODE='42501';
  END IF;

  INSERT INTO idempotency_receipt(tenant_id,operation_scope,idempotency_key,request_hash,status,actor_id)
    VALUES(p_tenant,'WBS_PROVIDER_SIGNED_PAYABLE:'||p_entity,p_idempotency_key,p_request_hash,'IN_PROGRESS',actor)
    ON CONFLICT (tenant_id,operation_scope,idempotency_key) DO NOTHING;
  SELECT * INTO idem FROM idempotency_receipt WHERE tenant_id=p_tenant
    AND operation_scope='WBS_PROVIDER_SIGNED_PAYABLE:'||p_entity AND idempotency_key=p_idempotency_key FOR UPDATE;
  IF idem.request_hash<>p_request_hash THEN RAISE EXCEPTION 'Idempotency key reused with different signed delivery' USING ERRCODE='23505'; END IF;
  IF idem.status='SUCCEEDED' THEN RETURN idem.response_body||jsonb_build_object('idempotent',true); END IF;

  snapshot_key:='wbs-signed-snapshot:'||substr(replace(p_request_hash,'sha256:',''),1,32);
  snapshot_hash:=refs_wbs_snapshot_import_hash(
    p_tenant,p_entity,(p_snapshot->>'snapshot_id')::uuid,(p_snapshot->>'captured_at')::timestamptz,
    p_snapshot->>'environment',p_snapshot->>'dictionary_version',p_snapshot->>'package_hash',
    p_snapshot->'receipts',p_snapshot->'delivery_attestation'
  );
  snapshot_result:=refs_record_wbs_snapshot_receipts(
    p_tenant,p_entity,(p_snapshot->>'snapshot_id')::uuid,(p_snapshot->>'captured_at')::timestamptz,
    p_snapshot->>'environment',p_snapshot->>'dictionary_version',p_snapshot->>'package_hash',
    p_snapshot->'receipts',p_snapshot->'delivery_attestation',snapshot_key,snapshot_hash
  );
  inbound_key:='wbs-signed-inbound:'||substr(replace(p_request_hash,'sha256:',''),1,32);
  inbound_hash:=refs_jsonb_hash(jsonb_build_object(
    'tenant_id',p_tenant,'entity_id',p_entity,'import_batch_id',(snapshot_result->>'import_batch_id')::uuid,
    'groups',p_groups,'idempotency_key',inbound_key
  ));
  inbound_result:=refs_persist_wbs_inbound_snapshot_rows(
    p_tenant,p_entity,(snapshot_result->>'import_batch_id')::uuid,p_groups,inbound_key,inbound_hash
  );
  -- The nonce uniqueness check is in the same serializable transaction as
  -- both child writes. A concurrent/different replay loses here and its whole
  -- transaction rolls back, leaving no snapshot, inbound row, JE, or ledger.
  INSERT INTO wbs_provider_signed_payable_admission(
    wbs_provider_signed_payable_admission_id,tenant_id,entity_id,issuer,key_id,algorithm,nonce,company_code,
    signed_at,expires_at,request_raw_hash,response_raw_hash,package_raw_hash,package_hash,receipt_hash,
    snapshot_id,import_batch_id,wbs_snapshot_import_id,admitted_by
  ) VALUES(
    admission_id,p_tenant,p_entity,p_delivery->>'issuer',p_delivery->>'key_id','Ed25519',p_delivery->>'nonce',p_delivery->>'company_code',
    (p_delivery->>'signed_at')::timestamptz,(p_delivery->>'expires_at')::timestamptz,p_delivery->>'request_raw_hash',
    p_delivery->>'response_raw_hash',p_delivery->>'package_raw_hash',p_delivery->>'package_hash',p_delivery->>'receipt_hash',
    (p_delivery->>'snapshot_id')::uuid,(snapshot_result->>'import_batch_id')::uuid,
    (snapshot_result->>'wbs_snapshot_import_id')::uuid,actor
  );

  event_payload:=jsonb_build_object('admission_id',admission_id,'snapshot_id',p_delivery->>'snapshot_id',
    'issuer',p_delivery->>'issuer','key_id',p_delivery->>'key_id','nonce',p_delivery->>'nonce',
    'company_code',p_delivery->>'company_code','row_count',inbound_result->>'row_count','signature_verified',true);
  INSERT INTO audit_event(tenant_id,entity_id,event_type,object_type,object_id,action,actor_id,actor_type,permission_used,
    request_id,correlation_id,idempotency_key,after_hash,metadata)
    VALUES(p_tenant,p_entity,'WBS_PROVIDER_SIGNED_PAYABLE_ADMITTED','WBS_PROVIDER_SIGNED_PAYABLE',admission_id,'ADMIT',actor,
      'SERVICE_ACCOUNT','WBS.SNAPSHOT.IMPORT',p_idempotency_key,p_idempotency_key,p_idempotency_key,p_request_hash,event_payload);
  INSERT INTO outbox_event(tenant_id,entity_id,aggregate_type,aggregate_id,event_type,payload,payload_hash)
    VALUES(p_tenant,p_entity,'WBS_PROVIDER_SIGNED_PAYABLE',admission_id,'WBS_PROVIDER_SIGNED_PAYABLE_ADMITTED',event_payload,refs_jsonb_hash(event_payload));
  response:=jsonb_build_object('wbs_provider_signed_payable_admission_id',admission_id,'status','PERSISTED_PAYABLE_STAGING_REVIEW_REQUIRED',
    'signature_verified',true,'snapshot_id',p_delivery->>'snapshot_id','company_code',p_delivery->>'company_code',
    'import_batch_id',snapshot_result->>'import_batch_id','wbs_snapshot_import_id',snapshot_result->>'wbs_snapshot_import_id',
    'row_count',(inbound_result->>'row_count')::integer,'idempotent',false,'can_create_draft',false,'can_approve',false,'can_post',false);
  UPDATE idempotency_receipt SET status='SUCCEEDED',response_status=201,response_body=response,completed_at=clock_timestamp()
    WHERE idempotency_receipt_id=idem.idempotency_receipt_id;
  RETURN response;
END;
$$;

REVOKE ALL ON wbs_provider_signed_payable_admission FROM PUBLIC,refs_app;
GRANT SELECT ON wbs_provider_signed_payable_admission TO refs_app;
REVOKE ALL ON FUNCTION refs_wbs_provider_signed_payable_admission_hash(uuid,uuid,jsonb,jsonb,jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION refs_admit_wbs_provider_signed_payables(uuid,uuid,jsonb,jsonb,jsonb,text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION refs_wbs_provider_signed_payable_admission_hash(uuid,uuid,jsonb,jsonb,jsonb) TO refs_app;
GRANT EXECUTE ON FUNCTION refs_admit_wbs_provider_signed_payables(uuid,uuid,jsonb,jsonb,jsonb,text,text) TO refs_app;

COMMIT;
