BEGIN;

CREATE TABLE wbs_payable_attachment_upload_intent (
  tenant_id uuid NOT NULL,
  entity_id uuid NOT NULL,
  wbs_inbound_row_id uuid NOT NULL,
  attachment_id uuid NOT NULL,
  source_version text NOT NULL,
  receipt_hash text NOT NULL CHECK(receipt_hash ~ '^sha256:[0-9a-f]{64}$'),
  provider_receipt_hash text NOT NULL CHECK(provider_receipt_hash ~ '^sha256:[0-9a-f]{64}$'),
  evidence_hash text NOT NULL CHECK(evidence_hash ~ '^sha256:[0-9a-f]{64}$'),
  created_by text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY(tenant_id,entity_id,wbs_inbound_row_id,attachment_id),
  UNIQUE(tenant_id,entity_id,attachment_id),
  FOREIGN KEY(tenant_id,entity_id) REFERENCES entity(tenant_id,entity_id),
  FOREIGN KEY(tenant_id,entity_id,wbs_inbound_row_id) REFERENCES wbs_inbound_row(tenant_id,entity_id,wbs_inbound_row_id),
  FOREIGN KEY(tenant_id,entity_id,attachment_id) REFERENCES attachment(tenant_id,entity_id,attachment_id)
);
ALTER TABLE wbs_payable_attachment_upload_intent ENABLE ROW LEVEL SECURITY;
CREATE POLICY wbs_payable_attachment_upload_intent_scope ON wbs_payable_attachment_upload_intent
  USING(tenant_id=refs_current_tenant() AND refs_entity_allowed(entity_id))
  WITH CHECK(tenant_id=refs_current_tenant() AND refs_entity_allowed(entity_id));
CREATE TRIGGER wbs_payable_attachment_upload_intent_append_only
  BEFORE UPDATE OR DELETE ON wbs_payable_attachment_upload_intent
  FOR EACH ROW EXECUTE FUNCTION reject_mutation();

CREATE FUNCTION refs_reserve_wbs_payable_attachment_hash(
  p_tenant uuid,p_entity uuid,p_row uuid,p_name text,p_media_type text,p_size_bytes bigint,
  p_content_hash text,p_storage_ref text,p_storage_version text
) RETURNS text LANGUAGE sql IMMUTABLE SET search_path=pg_catalog,public,pg_temp AS $$
  SELECT refs_jsonb_hash(jsonb_build_object('tenant_id',p_tenant,'entity_id',p_entity,'wbs_inbound_row_id',p_row,
    'name',btrim(p_name),'media_type',lower(btrim(p_media_type)),'size_bytes',p_size_bytes,'content_hash',lower(p_content_hash),
    'storage_ref',p_storage_ref,'storage_version',p_storage_version))
$$;

CREATE FUNCTION refs_reserve_wbs_payable_attachment(
  p_tenant uuid,p_entity uuid,p_row uuid,p_name text,p_media_type text,p_size_bytes bigint,
  p_content_hash text,p_storage_ref text,p_storage_version text,p_idempotency_key text,p_request_hash text
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE actor text:=refs_current_actor(); inbound wbs_inbound_row; receipt wbs_inbound_receipt;
DECLARE imported wbs_snapshot_import; provider wbs_snapshot_receipt; evidence text; attachment_result jsonb; computed text;
DECLARE idem idempotency_receipt; response jsonb;
BEGIN
  PERFORM refs_assert_scope(p_tenant,p_entity,'ATTACHMENT.CREATE');
  PERFORM refs_assert_scope(p_tenant,p_entity,'AP.VIEW');
  computed:=refs_reserve_wbs_payable_attachment_hash(p_tenant,p_entity,p_row,p_name,p_media_type,p_size_bytes,p_content_hash,p_storage_ref,p_storage_version);
  IF computed<>p_request_hash THEN RAISE EXCEPTION 'Row-bound attachment reservation hash is not canonical' USING ERRCODE='22023'; END IF;
  INSERT INTO idempotency_receipt(tenant_id,operation_scope,idempotency_key,request_hash,status,actor_id)
    VALUES(p_tenant,'WBS_PAYABLE_ATTACHMENT_RESERVE:'||p_entity,p_idempotency_key,p_request_hash,'IN_PROGRESS',actor)
    ON CONFLICT DO NOTHING;
  SELECT * INTO idem FROM idempotency_receipt WHERE tenant_id=p_tenant
    AND operation_scope='WBS_PAYABLE_ATTACHMENT_RESERVE:'||p_entity AND idempotency_key=p_idempotency_key FOR UPDATE;
  IF idem.request_hash<>p_request_hash THEN RAISE EXCEPTION 'Idempotency key reused with a different Payable row or file' USING ERRCODE='23505'; END IF;
  IF idem.status='SUCCEEDED' THEN RETURN idem.response_body||jsonb_build_object('idempotent',true); END IF;
  SELECT * INTO inbound FROM wbs_inbound_row WHERE tenant_id=p_tenant AND entity_id=p_entity AND wbs_inbound_row_id=p_row FOR SHARE;
  IF NOT FOUND OR inbound.outcome_kind<>'STAGING' OR inbound.outcome->>'stage' IS DISTINCT FROM 'STAGING_REVIEW_REQUIRED'
    OR inbound.normalized->>'source_system' IS DISTINCT FROM 'WBS' OR inbound.normalized->>'source_type' IS DISTINCT FROM 'PAYABLE'
  THEN RAISE EXCEPTION 'Only an admitted WBS Payable review row accepts support evidence' USING ERRCODE='23514'; END IF;
  SELECT * INTO receipt FROM wbs_inbound_receipt WHERE tenant_id=p_tenant AND entity_id=p_entity AND receipt_id=inbound.receipt_id FOR SHARE;
  SELECT * INTO imported FROM wbs_snapshot_import WHERE tenant_id=p_tenant AND entity_id=p_entity
    AND import_batch_id=receipt.import_batch_id AND environment='PRODUCTION' FOR SHARE;
  SELECT * INTO provider FROM wbs_snapshot_receipt WHERE tenant_id=p_tenant AND entity_id=p_entity
    AND wbs_snapshot_import_id=imported.wbs_snapshot_import_id AND source_module='BGDATA.payable'
    AND ingestion_kind='TRANSACTION_CANDIDATE' AND source_record_id=inbound.source_record_id
    AND source_version=inbound.source_version AND payload_hash=receipt.receipt_hash AND payload_ref=receipt.payload_ref FOR SHARE;
  IF imported.wbs_snapshot_import_id IS NULL OR provider.wbs_snapshot_receipt_id IS NULL OR NOT EXISTS(
    SELECT 1 FROM wbs_snapshot_delivery_attestation d WHERE d.tenant_id=p_tenant AND d.entity_id=p_entity
      AND d.wbs_snapshot_import_id=imported.wbs_snapshot_import_id
  ) THEN RAISE EXCEPTION 'Row-bound attachment reservation requires an admitted signed production Payable' USING ERRCODE='23514'; END IF;
  evidence:=refs_wbs_payable_review_evidence_hash(inbound.wbs_inbound_row_id,inbound.source_record_id,inbound.source_version,
    receipt.receipt_hash,inbound.raw,inbound.normalized,inbound.outcome,inbound.outcome_kind);
  attachment_result:=refs_reserve_attachment(p_tenant,p_entity,p_name,p_media_type,p_size_bytes,p_content_hash,p_storage_ref,
    p_storage_version,p_idempotency_key||':object',refs_attachment_reserve_hash(p_tenant,p_entity,p_name,p_media_type,p_size_bytes,p_content_hash,p_storage_ref,p_storage_version));
  INSERT INTO wbs_payable_attachment_upload_intent(tenant_id,entity_id,wbs_inbound_row_id,attachment_id,source_version,
    receipt_hash,provider_receipt_hash,evidence_hash,created_by)
  VALUES(p_tenant,p_entity,p_row,(attachment_result->>'attachment_id')::uuid,inbound.source_version,receipt.receipt_hash,
    provider.receipt_hash,evidence,actor) ON CONFLICT DO NOTHING;
  IF NOT EXISTS(SELECT 1 FROM wbs_payable_attachment_upload_intent i WHERE i.tenant_id=p_tenant AND i.entity_id=p_entity
    AND i.wbs_inbound_row_id=p_row AND i.attachment_id=(attachment_result->>'attachment_id')::uuid
    AND i.source_version=inbound.source_version AND i.receipt_hash=receipt.receipt_hash
    AND i.provider_receipt_hash=provider.receipt_hash AND i.evidence_hash=evidence) THEN
    RAISE EXCEPTION 'Attachment reservation replay does not match the exact WBS Payable row' USING ERRCODE='23505';
  END IF;
  response:=attachment_result||jsonb_build_object('wbs_inbound_row_id',p_row,'purpose','WBS_PAYABLE_SUPPORT_EVIDENCE');
  UPDATE idempotency_receipt SET status='SUCCEEDED',response_status=201,response_body=response,completed_at=clock_timestamp()
    WHERE idempotency_receipt_id=idem.idempotency_receipt_id;
  RETURN response;
END;
$$;

CREATE FUNCTION refs_read_wbs_payable_attachment_uploads(p_tenant uuid,p_entity uuid,p_row uuid)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE items jsonb; can_upload boolean:=refs_entity_has_permission(p_entity,'ATTACHMENT.CREATE');
DECLARE can_bind_scope boolean:=refs_entity_has_permission(p_entity,'WBS.PAYABLE.REVIEW');
BEGIN
  PERFORM refs_assert_scope(p_tenant,p_entity,'AP.VIEW');
  IF refs_entity_has_permission(p_entity,'ATTACHMENT.CREATE') IS NOT TRUE
     AND refs_entity_has_permission(p_entity,'WBS.PAYABLE.REVIEW') IS NOT TRUE THEN
    RAISE EXCEPTION 'Row-bound attachment access denied' USING ERRCODE='42501';
  END IF;
  IF NOT EXISTS(SELECT 1 FROM wbs_inbound_row r WHERE r.tenant_id=p_tenant AND r.entity_id=p_entity
    AND r.wbs_inbound_row_id=p_row AND r.outcome_kind='STAGING'
    AND r.outcome->>'stage'='STAGING_REVIEW_REQUIRED' AND r.normalized->>'source_system'='WBS'
    AND r.normalized->>'source_type'='PAYABLE') THEN
    RAISE EXCEPTION 'Admitted WBS Payable row not found' USING ERRCODE='P0002';
  END IF;
  SELECT coalesce(jsonb_agg(jsonb_build_object('attachment_id',a.attachment_id,'name',a.name,'media_type',a.media_type,
    'status',CASE WHEN b.attachment_id IS NOT NULL THEN 'BOUND' ELSE a.finalization_status END,
    'verified_at',a.verified_at,'can_bind',can_bind_scope AND b.attachment_id IS NULL
      AND a.finalization_status='VERIFIED_CLEAN' AND a.scan_status='CLEAN'
      AND a.uploaded_by IS DISTINCT FROM refs_current_actor()
      AND NOT EXISTS(SELECT 1 FROM audit_event scan WHERE scan.tenant_id=i.tenant_id AND scan.entity_id=i.entity_id
        AND scan.object_type='ATTACHMENT' AND scan.object_id=i.attachment_id AND scan.event_type='ATTACHMENT_FINALIZED'
        AND scan.metadata->>'accepted'='true' AND scan.actor_id=refs_current_actor())
      AND NOT EXISTS(SELECT 1 FROM wbs_inbound_row wr JOIN wbs_inbound_receipt ir
        ON (ir.tenant_id,ir.entity_id,ir.receipt_id)=(wr.tenant_id,wr.entity_id,wr.receipt_id)
        JOIN wbs_snapshot_import wi ON (wi.tenant_id,wi.entity_id,wi.import_batch_id)=(ir.tenant_id,ir.entity_id,ir.import_batch_id)
        WHERE wr.tenant_id=i.tenant_id AND wr.entity_id=i.entity_id AND wr.wbs_inbound_row_id=i.wbs_inbound_row_id
          AND wi.created_by=refs_current_actor())) ORDER BY i.created_at DESC,i.attachment_id),'[]'::jsonb)
    INTO items
  FROM wbs_payable_attachment_upload_intent i
  JOIN attachment a ON (a.tenant_id,a.entity_id,a.attachment_id)=(i.tenant_id,i.entity_id,i.attachment_id)
  LEFT JOIN wbs_payable_attachment_binding b ON (b.tenant_id,b.entity_id,b.wbs_inbound_row_id,b.attachment_id)=
    (i.tenant_id,i.entity_id,i.wbs_inbound_row_id,i.attachment_id)
  WHERE i.tenant_id=p_tenant AND i.entity_id=p_entity AND i.wbs_inbound_row_id=p_row
  ;
  can_bind_scope:=can_bind_scope AND EXISTS(
    SELECT 1 FROM jsonb_array_elements(items) item WHERE coalesce((item->>'can_bind')::boolean,false)
  );
  RETURN jsonb_build_object('entity_id',p_entity,'wbs_inbound_row_id',p_row,'can_upload',can_upload,
    'can_bind',can_bind_scope,'attachments',items);
END;
$$;

CREATE FUNCTION refs_bind_wbs_payable_uploaded_attachment_hash(
  p_tenant uuid,p_entity uuid,p_row uuid,p_attachment uuid,p_expected_revision bigint,p_reason text
) RETURNS text LANGUAGE sql IMMUTABLE SET search_path=pg_catalog,public,pg_temp AS $$
  SELECT refs_jsonb_hash(jsonb_build_object('tenant_id',p_tenant,'entity_id',p_entity,'wbs_inbound_row_id',p_row,
    'attachment_id',p_attachment,'expected_revision',p_expected_revision,'reason',btrim(p_reason)))
$$;

CREATE FUNCTION refs_bind_wbs_payable_uploaded_attachment(
  p_tenant uuid,p_entity uuid,p_row uuid,p_attachment uuid,p_expected_revision bigint,
  p_reason text,p_idempotency_key text,p_request_hash text
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE intent wbs_payable_attachment_upload_intent; current_attachment attachment; computed text;
BEGIN
  PERFORM refs_assert_scope(p_tenant,p_entity,'WBS.PAYABLE.REVIEW');
  PERFORM refs_assert_scope(p_tenant,p_entity,'AP.VIEW');
  computed:=refs_bind_wbs_payable_uploaded_attachment_hash(p_tenant,p_entity,p_row,p_attachment,p_expected_revision,p_reason);
  IF computed<>p_request_hash THEN RAISE EXCEPTION 'Safe row-bound binding hash is not canonical' USING ERRCODE='22023'; END IF;
  SELECT * INTO intent FROM wbs_payable_attachment_upload_intent WHERE tenant_id=p_tenant AND entity_id=p_entity
    AND wbs_inbound_row_id=p_row AND attachment_id=p_attachment FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Attachment is not reserved for this WBS Payable row' USING ERRCODE='23503'; END IF;
  IF intent.created_by=refs_current_actor() THEN RAISE EXCEPTION 'WBS Payable attachment binding SoD violation' USING ERRCODE='42501'; END IF;
  SELECT * INTO current_attachment FROM attachment WHERE tenant_id=p_tenant AND entity_id=p_entity
    AND attachment_id=p_attachment FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Attachment not found' USING ERRCODE='P0002'; END IF;
  RETURN refs_bind_wbs_payable_attachment(p_tenant,p_entity,p_row,p_attachment,p_expected_revision,intent.source_version,
    intent.receipt_hash,intent.provider_receipt_hash,intent.evidence_hash,current_attachment.content_hash,
    current_attachment.storage_version,p_reason,p_idempotency_key,
    refs_bind_wbs_payable_attachment_hash(p_tenant,p_entity,p_row,p_attachment,p_expected_revision,intent.source_version,
      intent.receipt_hash,intent.provider_receipt_hash,intent.evidence_hash,current_attachment.content_hash,
      current_attachment.storage_version,p_reason));
END;
$$;

REVOKE ALL ON wbs_payable_attachment_upload_intent FROM PUBLIC,refs_app;
REVOKE ALL ON FUNCTION refs_reserve_wbs_payable_attachment_hash(uuid,uuid,uuid,text,text,bigint,text,text,text) FROM PUBLIC;
REVOKE ALL ON FUNCTION refs_reserve_wbs_payable_attachment(uuid,uuid,uuid,text,text,bigint,text,text,text,text,text) FROM PUBLIC;
REVOKE ALL ON FUNCTION refs_read_wbs_payable_attachment_uploads(uuid,uuid,uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION refs_bind_wbs_payable_uploaded_attachment(uuid,uuid,uuid,uuid,bigint,text,text,text) FROM PUBLIC;
REVOKE ALL ON FUNCTION refs_bind_wbs_payable_uploaded_attachment_hash(uuid,uuid,uuid,uuid,bigint,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION refs_reserve_wbs_payable_attachment_hash(uuid,uuid,uuid,text,text,bigint,text,text,text) TO refs_app;
GRANT EXECUTE ON FUNCTION refs_reserve_wbs_payable_attachment(uuid,uuid,uuid,text,text,bigint,text,text,text,text,text) TO refs_app;
GRANT EXECUTE ON FUNCTION refs_read_wbs_payable_attachment_uploads(uuid,uuid,uuid) TO refs_app;
GRANT EXECUTE ON FUNCTION refs_bind_wbs_payable_uploaded_attachment(uuid,uuid,uuid,uuid,bigint,text,text,text) TO refs_app;
GRANT EXECUTE ON FUNCTION refs_bind_wbs_payable_uploaded_attachment_hash(uuid,uuid,uuid,uuid,bigint,text) TO refs_app;

COMMIT;
