BEGIN;

INSERT INTO permission_catalog(permission_code,domain,risk_class,sod_class)
  VALUES('WBS.PAYABLE.OPERATOR_ATTEST','WBS','HIGH','WBS_PAYABLE_OPERATOR_ATTESTER')
  ON CONFLICT (permission_code) DO NOTHING;

CREATE TABLE wbs_operator_payable_attestation (
  wbs_operator_payable_attestation_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant(tenant_id),
  entity_id uuid NOT NULL,
  source_tool text NOT NULL CHECK(source_tool='list_payables'),
  captured_at timestamptz NOT NULL,
  provider_content_hash text NOT NULL CHECK(provider_content_hash~'^sha256:[0-9a-f]{64}$'),
  observation_hash text NOT NULL CHECK(observation_hash~'^sha256:[0-9a-f]{64}$'),
  company_codes jsonb NOT NULL,
  row_count integer NOT NULL CHECK(row_count BETWEEN 1 AND 10),
  attestation_reason text NOT NULL CHECK(length(btrim(attestation_reason)) BETWEEN 8 AND 2000),
  attested_by text NOT NULL,
  request_hash text NOT NULL CHECK(request_hash~'^sha256:[0-9a-f]{64}$'),
  attested_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE(tenant_id,entity_id,wbs_operator_payable_attestation_id),
  UNIQUE(tenant_id,entity_id,observation_hash),
  FOREIGN KEY(tenant_id,entity_id) REFERENCES entity(tenant_id,entity_id)
);

CREATE TABLE wbs_operator_payable_evidence_row (
  wbs_operator_payable_evidence_row_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  entity_id uuid NOT NULL,
  wbs_operator_payable_attestation_id uuid NOT NULL,
  source_record_id text NOT NULL CHECK(length(btrim(source_record_id)) BETWEEN 1 AND 128),
  source_version text NOT NULL CHECK(length(btrim(source_version)) BETWEEN 1 AND 128),
  row_hash text NOT NULL CHECK(row_hash~'^sha256:[0-9a-f]{64}$'),
  raw jsonb NOT NULL,
  evidence_status text NOT NULL DEFAULT 'EXCEPTION_REVIEW_REQUIRED' CHECK(evidence_status='EXCEPTION_REVIEW_REQUIRED'),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE(tenant_id,entity_id,wbs_operator_payable_attestation_id,source_record_id,source_version),
  UNIQUE(tenant_id,entity_id,wbs_operator_payable_evidence_row_id),
  FOREIGN KEY(tenant_id,entity_id,wbs_operator_payable_attestation_id)
    REFERENCES wbs_operator_payable_attestation(tenant_id,entity_id,wbs_operator_payable_attestation_id)
);

ALTER TABLE wbs_operator_payable_attestation ENABLE ROW LEVEL SECURITY;
ALTER TABLE wbs_operator_payable_evidence_row ENABLE ROW LEVEL SECURITY;
CREATE POLICY wbs_operator_payable_attestation_scope ON wbs_operator_payable_attestation
  USING(tenant_id=refs_current_tenant() AND refs_entity_allowed(entity_id))
  WITH CHECK(tenant_id=refs_current_tenant() AND refs_entity_allowed(entity_id));
CREATE POLICY wbs_operator_payable_evidence_row_scope ON wbs_operator_payable_evidence_row
  USING(tenant_id=refs_current_tenant() AND refs_entity_allowed(entity_id))
  WITH CHECK(tenant_id=refs_current_tenant() AND refs_entity_allowed(entity_id));
CREATE TRIGGER wbs_operator_payable_attestation_append_only BEFORE UPDATE OR DELETE ON wbs_operator_payable_attestation
  FOR EACH ROW EXECUTE FUNCTION reject_mutation();
CREATE TRIGGER wbs_operator_payable_evidence_row_append_only BEFORE UPDATE OR DELETE ON wbs_operator_payable_evidence_row
  FOR EACH ROW EXECUTE FUNCTION reject_mutation();

CREATE FUNCTION refs_wbs_operator_payable_attest_hash(
  p_tenant uuid,p_entity uuid,p_captured_at timestamptz,p_provider_content_hash text,
  p_observation_hash text,p_company_codes jsonb,p_rows jsonb,p_reason text
) RETURNS text
LANGUAGE sql IMMUTABLE SET search_path=pg_catalog,public,pg_temp AS $$
  SELECT refs_jsonb_hash(jsonb_build_object(
    'tenant_id',p_tenant,'entity_id',p_entity,'source_tool','list_payables','captured_at',p_captured_at,
    'provider_content_hash',p_provider_content_hash,'observation_hash',p_observation_hash,
    'company_codes',p_company_codes,'rows',p_rows,'reason',btrim(p_reason)
  ))
$$;

CREATE FUNCTION refs_attest_wbs_operator_payables(
  p_tenant uuid,p_entity uuid,p_captured_at timestamptz,p_provider_content_hash text,
  p_observation_hash text,p_company_codes jsonb,p_rows jsonb,p_reason text,
  p_idempotency_key text,p_request_hash text
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE actor text:=refs_current_actor(); idem idempotency_receipt; entity_row entity; item jsonb;
DECLARE computed_hash text; attestation_id uuid:=gen_random_uuid(); response jsonb; event_payload jsonb;
DECLARE item_record text; item_version text; item_hash text; item_raw jsonb; inserted_count integer:=0;
BEGIN
  PERFORM refs_assert_scope(p_tenant,p_entity,'WBS.PAYABLE.OPERATOR_ATTEST');
  IF actor IS NULL THEN RAISE EXCEPTION 'Authenticated actor missing' USING ERRCODE='42501'; END IF;
  computed_hash:=refs_wbs_operator_payable_attest_hash(p_tenant,p_entity,p_captured_at,p_provider_content_hash,p_observation_hash,p_company_codes,p_rows,p_reason);
  IF p_request_hash<>computed_hash THEN RAISE EXCEPTION 'WBS operator attestation request hash is not canonical' USING ERRCODE='22023'; END IF;
  IF p_captured_at>clock_timestamp()+interval '5 minutes' OR p_provider_content_hash!~'^sha256:[0-9a-f]{64}$'
     OR p_observation_hash!~'^sha256:[0-9a-f]{64}$' OR jsonb_typeof(p_company_codes)<>'array'
     OR jsonb_array_length(p_company_codes)<>1 OR jsonb_typeof(p_rows)<>'array'
     OR jsonb_array_length(p_rows) NOT BETWEEN 1 AND 10 OR length(btrim(COALESCE(p_reason,''))) NOT BETWEEN 8 AND 2000 THEN
    RAISE EXCEPTION 'WBS operator attestation evidence is invalid' USING ERRCODE='22023';
  END IF;
  SELECT * INTO entity_row FROM entity WHERE tenant_id=p_tenant AND entity_id=p_entity AND active FOR SHARE;
  IF NOT FOUND OR entity_row.source_system<>'WBS' OR entity_row.source_entity_id IS DISTINCT FROM p_company_codes->>0 THEN
    RAISE EXCEPTION 'WBS operator attestation company scope is invalid' USING ERRCODE='42501';
  END IF;
  INSERT INTO idempotency_receipt(tenant_id,operation_scope,idempotency_key,request_hash,status,actor_id)
    VALUES(p_tenant,'WBS_PAYABLE_OPERATOR_ATTEST:'||p_entity,p_idempotency_key,p_request_hash,'IN_PROGRESS',actor)
    ON CONFLICT (tenant_id,operation_scope,idempotency_key) DO NOTHING;
  SELECT * INTO idem FROM idempotency_receipt WHERE tenant_id=p_tenant
    AND operation_scope='WBS_PAYABLE_OPERATOR_ATTEST:'||p_entity AND idempotency_key=p_idempotency_key FOR UPDATE;
  IF idem.request_hash<>p_request_hash THEN RAISE EXCEPTION 'Idempotency key reused with different request hash' USING ERRCODE='23505'; END IF;
  IF idem.status='SUCCEEDED' THEN RETURN idem.response_body||jsonb_build_object('idempotent',true); END IF;

  INSERT INTO wbs_operator_payable_attestation(
    wbs_operator_payable_attestation_id,tenant_id,entity_id,source_tool,captured_at,provider_content_hash,
    observation_hash,company_codes,row_count,attestation_reason,attested_by,request_hash
  ) VALUES(attestation_id,p_tenant,p_entity,'list_payables',p_captured_at,p_provider_content_hash,
    p_observation_hash,p_company_codes,jsonb_array_length(p_rows),btrim(p_reason),actor,p_request_hash);
  FOR item IN SELECT value FROM jsonb_array_elements(p_rows) LOOP
    IF jsonb_typeof(item)<>'object' OR jsonb_typeof(item->'raw')<>'object' THEN
      RAISE EXCEPTION 'WBS operator attestation row is invalid' USING ERRCODE='22023';
    END IF;
    item_record:=item->>'source_record_id';item_version:=item->>'source_version';item_hash:=item->>'row_hash';item_raw:=item->'raw';
    IF length(btrim(COALESCE(item_record,''))) NOT BETWEEN 1 AND 128 OR item_record IS DISTINCT FROM btrim(item_raw->>'ap_guid')
       OR length(btrim(COALESCE(item_version,''))) NOT BETWEEN 1 AND 128 OR item_version!~'^operator:'
       OR item_hash!~'^sha256:[0-9a-f]{64}$' OR item_hash<>refs_jsonb_hash(item_raw) THEN
      RAISE EXCEPTION 'WBS operator attestation row hash or identity is invalid' USING ERRCODE='22023';
    END IF;
    INSERT INTO wbs_operator_payable_evidence_row(
      tenant_id,entity_id,wbs_operator_payable_attestation_id,source_record_id,source_version,row_hash,raw
    ) VALUES(p_tenant,p_entity,attestation_id,item_record,item_version,item_hash,item_raw);
    inserted_count:=inserted_count+1;
  END LOOP;
  event_payload:=jsonb_build_object('wbs_operator_payable_attestation_id',attestation_id,'source_tool','list_payables',
    'captured_at',p_captured_at,'provider_content_hash',p_provider_content_hash,'observation_hash',p_observation_hash,
    'row_count',inserted_count,'evidence_status','EXCEPTION_REVIEW_REQUIRED','provenance_mode','OPERATOR_ATTESTED',
    'signature_verified',false,'can_create_draft',false,'can_post',false);
  INSERT INTO audit_event(tenant_id,entity_id,event_type,object_type,object_id,action,actor_id,actor_type,permission_used,
    request_id,correlation_id,idempotency_key,after_hash,reason,metadata)
    VALUES(p_tenant,p_entity,'WBS_PAYABLE_OPERATOR_ATTESTED','WBS_PAYABLE_OPERATOR_ATTESTATION',attestation_id,'ATTEST',actor,'USER',
      'WBS.PAYABLE.OPERATOR_ATTEST',p_idempotency_key,p_idempotency_key,p_idempotency_key,p_request_hash,btrim(p_reason),event_payload);
  INSERT INTO outbox_event(tenant_id,entity_id,aggregate_type,aggregate_id,event_type,payload,payload_hash)
    VALUES(p_tenant,p_entity,'WBS_PAYABLE_OPERATOR_ATTESTATION',attestation_id,'WBS_PAYABLE_OPERATOR_ATTESTED',event_payload,refs_jsonb_hash(event_payload));
  response:=jsonb_build_object('wbs_operator_payable_attestation_id',attestation_id,'status','EXCEPTION_REVIEW_REQUIRED',
    'provenance_mode','OPERATOR_ATTESTED','signature_verified',false,'row_count',inserted_count,'idempotent',false,
    'can_import_to_staging',false,'can_create_draft',false,'can_approve',false,'can_post',false);
  UPDATE idempotency_receipt SET status='SUCCEEDED',response_status=201,response_body=response,completed_at=clock_timestamp()
    WHERE idempotency_receipt_id=idem.idempotency_receipt_id;
  RETURN response;
END;
$$;

CREATE FUNCTION refs_read_wbs_operator_payable_attestations(
  p_tenant uuid,p_entity uuid,p_limit integer DEFAULT 50
) RETURNS TABLE(
  wbs_operator_payable_attestation_id uuid,captured_at timestamptz,company_code text,row_count integer,
  provenance_mode text,signature_verified boolean,evidence_status text,can_create_draft boolean,can_post boolean,attested_at timestamptz
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
BEGIN
  PERFORM refs_assert_scope(p_tenant,p_entity,'WBS.PAYABLE.OPERATOR_ATTEST');
  IF p_limit IS NULL OR p_limit<1 OR p_limit>50 THEN RAISE EXCEPTION 'WBS operator attestation limit must be between 1 and 50' USING ERRCODE='22023'; END IF;
  RETURN QUERY SELECT a.wbs_operator_payable_attestation_id,a.captured_at,a.company_codes->>0,a.row_count,
    'OPERATOR_ATTESTED'::text,false,'EXCEPTION_REVIEW_REQUIRED'::text,false,false,a.attested_at
  FROM wbs_operator_payable_attestation a WHERE a.tenant_id=p_tenant AND a.entity_id=p_entity
  ORDER BY a.attested_at DESC,a.wbs_operator_payable_attestation_id DESC LIMIT p_limit;
END;
$$;

REVOKE ALL ON wbs_operator_payable_attestation,wbs_operator_payable_evidence_row FROM PUBLIC,refs_app;
REVOKE ALL ON FUNCTION refs_wbs_operator_payable_attest_hash(uuid,uuid,timestamptz,text,text,jsonb,jsonb,text) FROM PUBLIC;
REVOKE ALL ON FUNCTION refs_attest_wbs_operator_payables(uuid,uuid,timestamptz,text,text,jsonb,jsonb,text,text,text) FROM PUBLIC;
REVOKE ALL ON FUNCTION refs_read_wbs_operator_payable_attestations(uuid,uuid,integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION refs_wbs_operator_payable_attest_hash(uuid,uuid,timestamptz,text,text,jsonb,jsonb,text) TO refs_app;
GRANT EXECUTE ON FUNCTION refs_attest_wbs_operator_payables(uuid,uuid,timestamptz,text,text,jsonb,jsonb,text,text,text) TO refs_app;
GRANT EXECUTE ON FUNCTION refs_read_wbs_operator_payable_attestations(uuid,uuid,integer) TO refs_app;

COMMIT;
