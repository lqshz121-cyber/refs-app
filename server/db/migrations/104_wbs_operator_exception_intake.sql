BEGIN;

ALTER TABLE wbs_operator_payable_attestation
  ADD COLUMN company_scope_status text NOT NULL DEFAULT 'ENTITY_SCOPE_MATCHED'
  CHECK(company_scope_status IN ('UNASSIGNED_COMPANY','MIXED_COMPANY','SINGLE_COMPANY_UNASSIGNED','ENTITY_SCOPE_MATCHED'));

CREATE OR REPLACE FUNCTION refs_attest_wbs_operator_payables(
  p_tenant uuid,p_entity uuid,p_captured_at timestamptz,p_provider_content_hash text,
  p_observation_hash text,p_company_codes jsonb,p_rows jsonb,p_reason text,
  p_idempotency_key text,p_request_hash text
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE actor text:=refs_current_actor(); idem idempotency_receipt; entity_row entity; item jsonb;
DECLARE computed_hash text; attestation_id uuid:=gen_random_uuid(); response jsonb; event_payload jsonb;
DECLARE item_record text; item_version text; item_hash text; item_raw jsonb; inserted_count integer:=0;
DECLARE company_count integer; company_scope_status text;
BEGIN
  PERFORM refs_assert_scope(p_tenant,p_entity,'WBS.PAYABLE.OPERATOR_ATTEST');
  IF actor IS NULL THEN RAISE EXCEPTION 'Authenticated actor missing' USING ERRCODE='42501'; END IF;
  computed_hash:=refs_wbs_operator_payable_attest_hash(p_tenant,p_entity,p_captured_at,p_provider_content_hash,p_observation_hash,p_company_codes,p_rows,p_reason);
  IF p_request_hash<>computed_hash THEN RAISE EXCEPTION 'WBS operator attestation request hash is not canonical' USING ERRCODE='22023'; END IF;
  IF p_captured_at>clock_timestamp()+interval '5 minutes' OR p_provider_content_hash!~'^sha256:[0-9a-f]{64}$'
     OR p_observation_hash!~'^sha256:[0-9a-f]{64}$' OR jsonb_typeof(p_company_codes)<>'array'
     OR jsonb_array_length(p_company_codes)>10 OR jsonb_typeof(p_rows)<>'array'
     OR jsonb_array_length(p_rows) NOT BETWEEN 1 AND 10 OR length(btrim(COALESCE(p_reason,''))) NOT BETWEEN 8 AND 2000 THEN
    RAISE EXCEPTION 'WBS operator attestation evidence is invalid' USING ERRCODE='22023';
  END IF;
  IF EXISTS(
    SELECT 1 FROM jsonb_array_elements(p_company_codes) c
    WHERE jsonb_typeof(c)<>'string' OR (c#>>'{}')!~'^[A-Za-z0-9][A-Za-z0-9_:-]{0,63}$'
  ) OR (SELECT count(*) FROM jsonb_array_elements_text(p_company_codes))
       <> (SELECT count(DISTINCT value) FROM jsonb_array_elements_text(p_company_codes))
    OR p_company_codes IS DISTINCT FROM COALESCE((
      SELECT jsonb_agg(value ORDER BY value) FROM jsonb_array_elements_text(p_company_codes)
    ),'[]'::jsonb) THEN
    RAISE EXCEPTION 'WBS operator attestation company evidence is invalid' USING ERRCODE='22023';
  END IF;
  SELECT * INTO entity_row FROM entity WHERE tenant_id=p_tenant AND entity_id=p_entity AND active FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'WBS operator attestation entity scope is invalid' USING ERRCODE='42501'; END IF;
  company_count:=jsonb_array_length(p_company_codes);
  company_scope_status:=CASE
    WHEN company_count=0 THEN 'UNASSIGNED_COMPANY'
    WHEN company_count>1 THEN 'MIXED_COMPANY'
    WHEN entity_row.source_system='WBS' AND entity_row.source_entity_id=p_company_codes->>0 THEN 'ENTITY_SCOPE_MATCHED'
    ELSE 'SINGLE_COMPANY_UNASSIGNED'
  END;
  INSERT INTO idempotency_receipt(tenant_id,operation_scope,idempotency_key,request_hash,status,actor_id)
    VALUES(p_tenant,'WBS_PAYABLE_OPERATOR_ATTEST:'||p_entity,p_idempotency_key,p_request_hash,'IN_PROGRESS',actor)
    ON CONFLICT (tenant_id,operation_scope,idempotency_key) DO NOTHING;
  SELECT * INTO idem FROM idempotency_receipt WHERE tenant_id=p_tenant
    AND operation_scope='WBS_PAYABLE_OPERATOR_ATTEST:'||p_entity AND idempotency_key=p_idempotency_key FOR UPDATE;
  IF idem.request_hash<>p_request_hash THEN RAISE EXCEPTION 'Idempotency key reused with different request hash' USING ERRCODE='23505'; END IF;
  IF idem.status='SUCCEEDED' THEN RETURN idem.response_body||jsonb_build_object('idempotent',true); END IF;

  INSERT INTO wbs_operator_payable_attestation(
    wbs_operator_payable_attestation_id,tenant_id,entity_id,source_tool,captured_at,provider_content_hash,
    observation_hash,company_codes,row_count,attestation_reason,attested_by,request_hash,company_scope_status
  ) VALUES(attestation_id,p_tenant,p_entity,'list_payables',p_captured_at,p_provider_content_hash,
    p_observation_hash,p_company_codes,jsonb_array_length(p_rows),btrim(p_reason),actor,p_request_hash,company_scope_status);
  FOR item IN SELECT value FROM jsonb_array_elements(p_rows) LOOP
    IF jsonb_typeof(item)<>'object' OR jsonb_typeof(item->'raw')<>'object' THEN
      RAISE EXCEPTION 'WBS operator attestation row is invalid' USING ERRCODE='22023';
    END IF;
    item_record:=item->>'source_record_id';item_version:=item->>'source_version';item_hash:=item->>'row_hash';item_raw:=item->'raw';
    IF length(btrim(COALESCE(item_record,''))) NOT BETWEEN 1 AND 128 OR item_record IS DISTINCT FROM btrim(item_raw->>'ap_guid')
       OR length(btrim(COALESCE(item_version,''))) NOT BETWEEN 1 AND 128 OR item_version!~'^operator:'
       OR item_hash!~'^sha256:[0-9a-f]{64}$' OR item_hash<>refs_jsonb_hash(item_raw)
       OR (btrim(COALESCE(item_raw->>'company_code',''))<>'' AND NOT p_company_codes ? btrim(item_raw->>'company_code')) THEN
      RAISE EXCEPTION 'WBS operator attestation row hash, identity, or company evidence is invalid' USING ERRCODE='22023';
    END IF;
    INSERT INTO wbs_operator_payable_evidence_row(
      tenant_id,entity_id,wbs_operator_payable_attestation_id,source_record_id,source_version,row_hash,raw
    ) VALUES(p_tenant,p_entity,attestation_id,item_record,item_version,item_hash,item_raw);
    inserted_count:=inserted_count+1;
  END LOOP;
  event_payload:=jsonb_build_object('wbs_operator_payable_attestation_id',attestation_id,'source_tool','list_payables',
    'captured_at',p_captured_at,'provider_content_hash',p_provider_content_hash,'observation_hash',p_observation_hash,
    'company_codes',p_company_codes,'company_scope_status',company_scope_status,'row_count',inserted_count,
    'evidence_status','EXCEPTION_REVIEW_REQUIRED','provenance_mode','OPERATOR_ATTESTED','signature_verified',false,
    'can_import_to_staging',false,'can_review',false,'can_create_draft',false,'can_approve',false,'can_post',false);
  INSERT INTO audit_event(tenant_id,entity_id,event_type,object_type,object_id,action,actor_id,actor_type,permission_used,
    request_id,correlation_id,idempotency_key,after_hash,reason,metadata)
    VALUES(p_tenant,p_entity,'WBS_PAYABLE_OPERATOR_ATTESTED','WBS_PAYABLE_OPERATOR_ATTESTATION',attestation_id,'ATTEST',actor,'USER',
      'WBS.PAYABLE.OPERATOR_ATTEST',p_idempotency_key,p_idempotency_key,p_idempotency_key,p_request_hash,btrim(p_reason),event_payload);
  INSERT INTO outbox_event(tenant_id,entity_id,aggregate_type,aggregate_id,event_type,payload,payload_hash)
    VALUES(p_tenant,p_entity,'WBS_PAYABLE_OPERATOR_ATTESTATION',attestation_id,'WBS_PAYABLE_OPERATOR_ATTESTED',event_payload,refs_jsonb_hash(event_payload));
  response:=jsonb_build_object('wbs_operator_payable_attestation_id',attestation_id,'status','EXCEPTION_REVIEW_REQUIRED',
    'provenance_mode','OPERATOR_ATTESTED','signature_verified',false,'company_scope_status',company_scope_status,
    'row_count',inserted_count,'idempotent',false,'can_import_to_staging',false,'can_review',false,'can_create_draft',false,
    'can_approve',false,'can_post',false);
  UPDATE idempotency_receipt SET status='SUCCEEDED',response_status=201,response_body=response,completed_at=clock_timestamp()
    WHERE idempotency_receipt_id=idem.idempotency_receipt_id;
  RETURN response;
END;
$$;

DROP FUNCTION refs_read_wbs_operator_payable_attestations(uuid,uuid,integer);
CREATE FUNCTION refs_read_wbs_operator_payable_attestations(
  p_tenant uuid,p_entity uuid,p_limit integer DEFAULT 50
) RETURNS TABLE(
  wbs_operator_payable_attestation_id uuid,captured_at timestamptz,company_code text,company_codes jsonb,
  company_scope_status text,row_count integer,
  provenance_mode text,signature_verified boolean,evidence_status text,can_create_draft boolean,can_post boolean,attested_at timestamptz
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
BEGIN
  PERFORM refs_assert_scope(p_tenant,p_entity,'WBS.PAYABLE.OPERATOR_ATTEST');
  IF p_limit IS NULL OR p_limit<1 OR p_limit>50 THEN RAISE EXCEPTION 'WBS operator attestation limit must be between 1 and 50' USING ERRCODE='22023'; END IF;
  RETURN QUERY SELECT a.wbs_operator_payable_attestation_id,a.captured_at,
    CASE jsonb_array_length(a.company_codes) WHEN 1 THEN a.company_codes->>0 ELSE NULL END,
    a.company_codes,a.company_scope_status,a.row_count,'OPERATOR_ATTESTED'::text,false,
    'EXCEPTION_REVIEW_REQUIRED'::text,false,false,a.attested_at
  FROM wbs_operator_payable_attestation a WHERE a.tenant_id=p_tenant AND a.entity_id=p_entity
  ORDER BY a.attested_at DESC,a.wbs_operator_payable_attestation_id DESC LIMIT p_limit;
END;
$$;

REVOKE ALL ON FUNCTION refs_attest_wbs_operator_payables(uuid,uuid,timestamptz,text,text,jsonb,jsonb,text,text,text) FROM PUBLIC;
REVOKE ALL ON FUNCTION refs_read_wbs_operator_payable_attestations(uuid,uuid,integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION refs_attest_wbs_operator_payables(uuid,uuid,timestamptz,text,text,jsonb,jsonb,text,text,text) TO refs_app;
GRANT EXECUTE ON FUNCTION refs_read_wbs_operator_payable_attestations(uuid,uuid,integer) TO refs_app;

COMMIT;
