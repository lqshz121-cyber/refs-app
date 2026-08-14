BEGIN;

-- Operator-retained rows remain unsigned exception evidence.  This bridge
-- records only that a later, independently signed production snapshot contains
-- the exact same provider row.  It does not update either source, create a
-- review candidate, or confer any accounting authority.
CREATE TABLE wbs_operator_signed_source_link (
  wbs_operator_signed_source_link_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant(tenant_id),
  entity_id uuid NOT NULL,
  wbs_operator_payable_evidence_row_id uuid NOT NULL REFERENCES wbs_operator_payable_evidence_row(wbs_operator_payable_evidence_row_id),
  wbs_inbound_row_id uuid NOT NULL REFERENCES wbs_inbound_row(wbs_inbound_row_id),
  wbs_snapshot_import_id uuid NOT NULL REFERENCES wbs_snapshot_import(wbs_snapshot_import_id),
  wbs_snapshot_receipt_id uuid NOT NULL REFERENCES wbs_snapshot_receipt(wbs_snapshot_receipt_id),
  company_code text NOT NULL CHECK(length(btrim(company_code)) BETWEEN 1 AND 64),
  source_record_id text NOT NULL CHECK(length(btrim(source_record_id)) BETWEEN 1 AND 128),
  operator_source_version text NOT NULL CHECK(operator_source_version~'^operator:'),
  signed_source_version text NOT NULL CHECK(length(btrim(signed_source_version)) BETWEEN 1 AND 128 AND signed_source_version!~'^operator:'),
  raw_row_hash text NOT NULL CHECK(raw_row_hash~'^sha256:[0-9a-f]{64}$'),
  upstream_content_hash text NOT NULL CHECK(upstream_content_hash~'^sha256:[0-9a-f]{64}$'),
  request_hash text NOT NULL CHECK(request_hash~'^sha256:[0-9a-f]{64}$'),
  linked_by text NOT NULL,
  linked_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE(tenant_id,entity_id,wbs_operator_payable_evidence_row_id),
  UNIQUE(tenant_id,entity_id,wbs_inbound_row_id),
  UNIQUE(tenant_id,entity_id,wbs_operator_signed_source_link_id),
  CHECK(operator_source_version<>signed_source_version),
  FOREIGN KEY(tenant_id,entity_id) REFERENCES entity(tenant_id,entity_id)
);

-- Migration 105 deliberately recalculates row_hash with PostgreSQL's jsonb
-- canonical form before retaining an exception row.  The provider's signed
-- snapshot uses the provider canonical hash instead.  Preserve that original
-- server-computed provider hash separately; neither hash substitutes for the
-- other and both are required before a later signed delivery can be linked.
CREATE TABLE wbs_operator_payable_evidence_provider_hash (
  wbs_operator_payable_evidence_provider_hash_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant(tenant_id),
  entity_id uuid NOT NULL,
  wbs_operator_payable_evidence_row_id uuid NOT NULL REFERENCES wbs_operator_payable_evidence_row(wbs_operator_payable_evidence_row_id),
  provider_row_hash text NOT NULL CHECK(provider_row_hash~'^sha256:[0-9a-f]{64}$'),
  recorded_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE(tenant_id,entity_id,wbs_operator_payable_evidence_row_id),
  FOREIGN KEY(tenant_id,entity_id) REFERENCES entity(tenant_id,entity_id)
);

ALTER TABLE wbs_operator_payable_evidence_provider_hash ENABLE ROW LEVEL SECURITY;
CREATE POLICY wbs_operator_payable_evidence_provider_hash_scope ON wbs_operator_payable_evidence_provider_hash
  USING(tenant_id=refs_current_tenant() AND refs_entity_allowed(entity_id))
  WITH CHECK(tenant_id=refs_current_tenant() AND refs_entity_allowed(entity_id));
CREATE TRIGGER wbs_operator_payable_evidence_provider_hash_append_only
  BEFORE UPDATE OR DELETE ON wbs_operator_payable_evidence_provider_hash
  FOR EACH ROW EXECUTE FUNCTION reject_mutation();

ALTER FUNCTION refs_attest_wbs_operator_payables(uuid,uuid,timestamptz,text,text,jsonb,jsonb,text,text,text)
  RENAME TO refs_attest_wbs_operator_payables_105;

CREATE FUNCTION refs_attest_wbs_operator_payables(
  p_tenant uuid,p_entity uuid,p_captured_at timestamptz,p_provider_content_hash text,
  p_observation_hash text,p_company_codes jsonb,p_rows jsonb,p_reason text,
  p_idempotency_key text,p_request_hash text
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE result jsonb; attestation_id uuid; item jsonb; item_record text; item_version text;
DECLARE provider_hash text; stored_row wbs_operator_payable_evidence_row; stored_hash text;
BEGIN
  IF jsonb_typeof(p_rows)<>'array' THEN
    RAISE EXCEPTION 'WBS operator attestation rows are invalid' USING ERRCODE='22023';
  END IF;
  FOR item IN SELECT value FROM jsonb_array_elements(p_rows) LOOP
    item_record:=item->>'source_record_id'; item_version:=item->>'source_version'; provider_hash:=item->>'row_hash';
    IF jsonb_typeof(item)<>'object' OR jsonb_typeof(item->'raw')<>'object'
       OR length(btrim(COALESCE(item_record,''))) NOT BETWEEN 1 AND 128
       OR length(btrim(COALESCE(item_version,''))) NOT BETWEEN 1 AND 128
       OR provider_hash!~'^sha256:[0-9a-f]{64}$' THEN
      RAISE EXCEPTION 'WBS operator provider row provenance is invalid' USING ERRCODE='22023';
    END IF;
  END LOOP;
  result:=refs_attest_wbs_operator_payables_105(
    p_tenant,p_entity,p_captured_at,p_provider_content_hash,p_observation_hash,p_company_codes,p_rows,p_reason,
    p_idempotency_key,p_request_hash
  );
  attestation_id:=(result->>'wbs_operator_payable_attestation_id')::uuid;
  FOR item IN SELECT value FROM jsonb_array_elements(p_rows) LOOP
    item_record:=item->>'source_record_id'; item_version:=item->>'source_version'; provider_hash:=item->>'row_hash';
    SELECT * INTO stored_row FROM wbs_operator_payable_evidence_row
      WHERE tenant_id=p_tenant AND entity_id=p_entity AND wbs_operator_payable_attestation_id=attestation_id
        AND source_record_id=item_record AND source_version=item_version FOR SHARE;
    IF NOT FOUND OR stored_row.row_hash<>refs_jsonb_hash(stored_row.raw) THEN
      RAISE EXCEPTION 'WBS operator retained row provenance is not immutable' USING ERRCODE='23514';
    END IF;
    SELECT provider_row_hash INTO stored_hash FROM wbs_operator_payable_evidence_provider_hash
      WHERE tenant_id=p_tenant AND entity_id=p_entity
        AND wbs_operator_payable_evidence_row_id=stored_row.wbs_operator_payable_evidence_row_id FOR SHARE;
    IF FOUND THEN
      IF stored_hash<>provider_hash THEN
        RAISE EXCEPTION 'WBS operator provider row hash conflicts with immutable provenance' USING ERRCODE='23505';
      END IF;
    ELSE
      INSERT INTO wbs_operator_payable_evidence_provider_hash(
        tenant_id,entity_id,wbs_operator_payable_evidence_row_id,provider_row_hash
      ) VALUES(p_tenant,p_entity,stored_row.wbs_operator_payable_evidence_row_id,provider_hash);
    END IF;
  END LOOP;
  RETURN result;
END;
$$;

ALTER TABLE wbs_operator_signed_source_link ENABLE ROW LEVEL SECURITY;
CREATE POLICY wbs_operator_signed_source_link_scope ON wbs_operator_signed_source_link
  USING(tenant_id=refs_current_tenant() AND refs_entity_allowed(entity_id))
  WITH CHECK(tenant_id=refs_current_tenant() AND refs_entity_allowed(entity_id));
CREATE TRIGGER wbs_operator_signed_source_link_append_only
  BEFORE UPDATE OR DELETE ON wbs_operator_signed_source_link
  FOR EACH ROW EXECUTE FUNCTION reject_mutation();

CREATE FUNCTION refs_wbs_operator_signed_source_link_hash(
  p_tenant uuid,p_entity uuid,p_operator_row uuid,p_signed_row uuid
) RETURNS text
LANGUAGE sql IMMUTABLE SET search_path=pg_catalog,public,pg_temp AS $$
  SELECT refs_jsonb_hash(jsonb_build_object(
    'tenant_id',p_tenant,'entity_id',p_entity,
    'wbs_operator_payable_evidence_row_id',p_operator_row,
    'wbs_inbound_row_id',p_signed_row
  ))
$$;

CREATE FUNCTION refs_link_wbs_operator_evidence_to_signed_source(
  p_tenant uuid,p_entity uuid,p_operator_row uuid,p_signed_row uuid,
  p_idempotency_key text,p_request_hash text
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE actor text:=refs_current_actor(); idem idempotency_receipt; computed_hash text;
DECLARE operator_record wbs_operator_payable_evidence_row; operator_attestation wbs_operator_payable_attestation;
DECLARE operator_provider_hash wbs_operator_payable_evidence_provider_hash;
DECLARE signed_record wbs_inbound_row; inbound_receipt wbs_inbound_receipt; snapshot_import wbs_snapshot_import;
DECLARE snapshot_receipt wbs_snapshot_receipt; company_code text; link_id uuid:=gen_random_uuid(); response jsonb; event_payload jsonb;
BEGIN
  -- Deliberately not WBS.PAYABLE.OPERATOR_ATTEST: an operator cannot convert
  -- their own unsigned exception into signed source authority.
  PERFORM refs_assert_scope(p_tenant,p_entity,'WBS.SNAPSHOT.IMPORT');
  IF actor IS NULL THEN RAISE EXCEPTION 'Authenticated signed-source importer missing' USING ERRCODE='42501'; END IF;
  computed_hash:=refs_wbs_operator_signed_source_link_hash(p_tenant,p_entity,p_operator_row,p_signed_row);
  IF p_request_hash<>computed_hash THEN RAISE EXCEPTION 'WBS operator signed-source link request hash is not canonical' USING ERRCODE='22023'; END IF;

  INSERT INTO idempotency_receipt(tenant_id,operation_scope,idempotency_key,request_hash,status,actor_id)
    VALUES(p_tenant,'WBS_OPERATOR_SIGNED_SOURCE_LINK:'||p_entity,p_idempotency_key,p_request_hash,'IN_PROGRESS',actor)
    ON CONFLICT(tenant_id,operation_scope,idempotency_key) DO NOTHING;
  SELECT * INTO idem FROM idempotency_receipt
    WHERE tenant_id=p_tenant AND operation_scope='WBS_OPERATOR_SIGNED_SOURCE_LINK:'||p_entity
      AND idempotency_key=p_idempotency_key FOR UPDATE;
  IF idem.request_hash<>p_request_hash THEN RAISE EXCEPTION 'Idempotency key reused with different request hash' USING ERRCODE='23505'; END IF;
  IF idem.status='SUCCEEDED' THEN RETURN idem.response_body||jsonb_build_object('idempotent',true); END IF;

  SELECT * INTO operator_record FROM wbs_operator_payable_evidence_row
    WHERE tenant_id=p_tenant AND entity_id=p_entity AND wbs_operator_payable_evidence_row_id=p_operator_row FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Operator exception evidence row not found in scope' USING ERRCODE='P0002'; END IF;
  SELECT * INTO operator_attestation FROM wbs_operator_payable_attestation
    WHERE tenant_id=p_tenant AND entity_id=p_entity
      AND wbs_operator_payable_attestation_id=operator_record.wbs_operator_payable_attestation_id FOR SHARE;
  IF NOT FOUND OR operator_record.evidence_status<>'EXCEPTION_REVIEW_REQUIRED'
     OR operator_record.source_version!~'^operator:'
     OR operator_record.row_hash<>refs_jsonb_hash(operator_record.raw)
     OR jsonb_array_length(operator_attestation.company_codes)<>1 THEN
    RAISE EXCEPTION 'Operator exception evidence is not an exact immutable single-company row' USING ERRCODE='23514';
  END IF;
  SELECT * INTO operator_provider_hash FROM wbs_operator_payable_evidence_provider_hash
    WHERE tenant_id=p_tenant AND entity_id=p_entity
      AND wbs_operator_payable_evidence_row_id=operator_record.wbs_operator_payable_evidence_row_id FOR SHARE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Operator exception evidence lacks immutable provider row provenance' USING ERRCODE='23514';
  END IF;
  company_code:=btrim(operator_attestation.company_codes->>0);
  IF company_code='' OR btrim(COALESCE(operator_record.raw->>'company_code',''))<>company_code THEN
    RAISE EXCEPTION 'Operator exception evidence company is absent or ambiguous' USING ERRCODE='23514';
  END IF;

  SELECT * INTO signed_record FROM wbs_inbound_row
    WHERE tenant_id=p_tenant AND entity_id=p_entity AND wbs_inbound_row_id=p_signed_row FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Signed WBS inbound row not found in scope' USING ERRCODE='P0002'; END IF;
  SELECT * INTO inbound_receipt FROM wbs_inbound_receipt
    WHERE tenant_id=p_tenant AND entity_id=p_entity AND receipt_id=signed_record.receipt_id FOR SHARE;
  SELECT * INTO snapshot_import FROM wbs_snapshot_import
    WHERE tenant_id=p_tenant AND entity_id=p_entity AND import_batch_id=inbound_receipt.import_batch_id
      AND environment='PRODUCTION' FOR SHARE;
  IF NOT FOUND OR NOT EXISTS(
    SELECT 1 FROM wbs_snapshot_delivery_attestation delivery
    WHERE delivery.tenant_id=p_tenant AND delivery.entity_id=p_entity
      AND delivery.wbs_snapshot_import_id=snapshot_import.wbs_snapshot_import_id
  ) THEN
    RAISE EXCEPTION 'Signed source bridge requires an admitted signed production snapshot' USING ERRCODE='23514';
  END IF;
  SELECT * INTO snapshot_receipt FROM wbs_snapshot_receipt
    WHERE tenant_id=p_tenant AND entity_id=p_entity
      AND wbs_snapshot_import_id=snapshot_import.wbs_snapshot_import_id
      AND source_module='BGDATA.payable' AND ingestion_kind='TRANSACTION_CANDIDATE'
      AND source_entity_id=company_code
      AND source_record_id=signed_record.source_record_id AND source_version=signed_record.source_version
      AND payload_hash=inbound_receipt.receipt_hash AND payload_ref=inbound_receipt.payload_ref FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Signed inbound row is not backed by the exact Payable snapshot receipt' USING ERRCODE='23514'; END IF;

  IF signed_record.source_record_id<>operator_record.source_record_id
     OR signed_record.source_version=operator_record.source_version OR signed_record.source_version~'^operator:'
     OR btrim(COALESCE(signed_record.normalized->>'company_key',''))<>company_code
     OR signed_record.raw->>'mcp_row_hash' IS DISTINCT FROM operator_provider_hash.provider_row_hash
     OR signed_record.normalized->>'upstream_mcp_row_hash' IS DISTINCT FROM operator_provider_hash.provider_row_hash
     OR signed_record.raw->>'mcp_content_sha256' IS DISTINCT FROM operator_attestation.provider_content_hash
     OR signed_record.normalized->>'upstream_mcp_content_hash' IS DISTINCT FROM operator_attestation.provider_content_hash THEN
    RAISE EXCEPTION 'Operator row and signed source do not have exact identity, company, raw-row hash, and upstream content hash equivalence' USING ERRCODE='23514';
  END IF;

  INSERT INTO wbs_operator_signed_source_link(
    wbs_operator_signed_source_link_id,tenant_id,entity_id,wbs_operator_payable_evidence_row_id,wbs_inbound_row_id,
    wbs_snapshot_import_id,wbs_snapshot_receipt_id,company_code,source_record_id,operator_source_version,
    signed_source_version,raw_row_hash,upstream_content_hash,request_hash,linked_by
  ) VALUES(
    link_id,p_tenant,p_entity,p_operator_row,p_signed_row,snapshot_import.wbs_snapshot_import_id,
    snapshot_receipt.wbs_snapshot_receipt_id,company_code,operator_record.source_record_id,
    operator_record.source_version,signed_record.source_version,operator_record.row_hash,
    operator_attestation.provider_content_hash,p_request_hash,actor
  );
  event_payload:=jsonb_build_object(
    'wbs_operator_signed_source_link_id',link_id,
    'wbs_operator_payable_evidence_row_id',p_operator_row,'wbs_inbound_row_id',p_signed_row,
    'company_code',company_code,'source_record_id',operator_record.source_record_id,
    'operator_source_version',operator_record.source_version,'signed_source_version',signed_record.source_version,
    'raw_row_hash',operator_record.row_hash,'upstream_content_hash',operator_attestation.provider_content_hash,
    'operator_evidence_status','EXCEPTION_REVIEW_REQUIRED','signed_source_link_only',true,
    'can_review',false,'can_create_draft',false,'can_approve',false,'can_post',false
  );
  INSERT INTO audit_event(tenant_id,entity_id,event_type,object_type,object_id,action,actor_id,actor_type,permission_used,
    request_id,correlation_id,idempotency_key,after_hash,metadata)
    VALUES(p_tenant,p_entity,'WBS_OPERATOR_SIGNED_SOURCE_LINKED','WBS_OPERATOR_SIGNED_SOURCE_LINK',link_id,'LINK',actor,
      'SERVICE_ACCOUNT','WBS.SNAPSHOT.IMPORT',p_idempotency_key,p_idempotency_key,p_idempotency_key,
      refs_jsonb_hash(event_payload),event_payload);
  INSERT INTO outbox_event(tenant_id,entity_id,aggregate_type,aggregate_id,event_type,payload,payload_hash)
    VALUES(p_tenant,p_entity,'WBS_OPERATOR_SIGNED_SOURCE_LINK',link_id,'WBS_OPERATOR_SIGNED_SOURCE_LINKED',
      event_payload,refs_jsonb_hash(event_payload));
  response:=jsonb_build_object(
    'wbs_operator_signed_source_link_id',link_id,'status','SIGNED_SOURCE_EQUIVALENCE_RECORDED',
    'operator_evidence_status','EXCEPTION_REVIEW_REQUIRED','wbs_inbound_row_id',p_signed_row,
    'idempotent',false,'can_review',false,'can_create_draft',false,'can_approve',false,'can_post',false
  );
  UPDATE idempotency_receipt SET status='SUCCEEDED',response_status=201,response_body=response,completed_at=clock_timestamp()
    WHERE idempotency_receipt_id=idem.idempotency_receipt_id;
  RETURN response;
END;
$$;

REVOKE ALL ON wbs_operator_signed_source_link FROM PUBLIC,refs_app;
GRANT SELECT ON wbs_operator_signed_source_link TO refs_app;
REVOKE ALL ON wbs_operator_payable_evidence_provider_hash FROM PUBLIC,refs_app;
GRANT SELECT ON wbs_operator_payable_evidence_provider_hash TO refs_app;
REVOKE ALL ON FUNCTION refs_attest_wbs_operator_payables_105(uuid,uuid,timestamptz,text,text,jsonb,jsonb,text,text,text) FROM PUBLIC,refs_app;
REVOKE ALL ON FUNCTION refs_attest_wbs_operator_payables(uuid,uuid,timestamptz,text,text,jsonb,jsonb,text,text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION refs_attest_wbs_operator_payables(uuid,uuid,timestamptz,text,text,jsonb,jsonb,text,text,text) TO refs_app;
REVOKE ALL ON FUNCTION refs_wbs_operator_signed_source_link_hash(uuid,uuid,uuid,uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION refs_link_wbs_operator_evidence_to_signed_source(uuid,uuid,uuid,uuid,text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION refs_wbs_operator_signed_source_link_hash(uuid,uuid,uuid,uuid) TO refs_app;
GRANT EXECUTE ON FUNCTION refs_link_wbs_operator_evidence_to_signed_source(uuid,uuid,uuid,uuid,text,text) TO refs_app;

COMMIT;
