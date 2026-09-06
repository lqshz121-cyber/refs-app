BEGIN;

CREATE FUNCTION refs_find_attachment_reservation(
  p_tenant uuid,p_entity uuid,p_name text,p_media_type text,p_size_bytes bigint,
  p_content_hash text,p_idempotency_key text
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE v_receipt idempotency_receipt;v_attachment attachment;v_actor text:=refs_current_actor();
BEGIN
  PERFORM refs_assert_scope(p_tenant,p_entity,'ATTACHMENT.CREATE');
  IF v_actor IS NULL OR p_idempotency_key IS NULL OR length(p_idempotency_key) NOT BETWEEN 8 AND 512
     OR p_name IS NULL OR length(btrim(p_name)) NOT BETWEEN 1 AND 255 OR p_name~'[/\\]'
     OR p_media_type IS NULL OR lower(btrim(p_media_type)) NOT IN ('application/pdf','image/png','image/jpeg','text/csv')
     OR p_size_bytes IS NULL OR p_size_bytes NOT BETWEEN 1 AND 52428800
     OR p_content_hash IS NULL OR lower(p_content_hash)!~'^sha256:[0-9a-f]{64}$' THEN
    RAISE EXCEPTION 'Attachment reservation metadata is invalid' USING ERRCODE='22023';
  END IF;
  SELECT * INTO v_receipt FROM idempotency_receipt
   WHERE tenant_id=p_tenant AND operation_scope='RESERVE_ATTACHMENT:'||p_entity
     AND idempotency_key=p_idempotency_key FOR SHARE;
  IF NOT FOUND THEN RETURN NULL; END IF;
  IF v_receipt.actor_id IS DISTINCT FROM v_actor THEN
    RAISE EXCEPTION 'Attachment reservation belongs to another uploader' USING ERRCODE='42501';
  END IF;
  IF v_receipt.status<>'SUCCEEDED' OR v_receipt.response_body->>'attachment_id' IS NULL THEN
    RAISE EXCEPTION 'Attachment reservation receipt is incomplete' USING ERRCODE='55000';
  END IF;
  SELECT * INTO v_attachment FROM attachment
   WHERE tenant_id=p_tenant AND entity_id=p_entity
     AND attachment_id=(v_receipt.response_body->>'attachment_id')::uuid FOR SHARE;
  IF NOT FOUND OR v_attachment.uploaded_by IS DISTINCT FROM v_actor THEN
    RAISE EXCEPTION 'Attachment reservation evidence is unavailable' USING ERRCODE='42501';
  END IF;
  -- Reservation metadata is immutable even after storage_version becomes the
  -- exact scanned version. Do not reconstruct a legacy random pending version.
  IF (v_attachment.name,v_attachment.media_type,v_attachment.size_bytes,v_attachment.content_hash)
     IS DISTINCT FROM (btrim(p_name),lower(btrim(p_media_type)),p_size_bytes,lower(p_content_hash)) THEN
    RAISE EXCEPTION 'Idempotency key reused with different attachment metadata' USING ERRCODE='23505';
  END IF;
  RETURN jsonb_build_object('attachment_id',v_attachment.attachment_id,'entity_id',p_entity,
    'status',v_attachment.finalization_status,'name',v_attachment.name,'media_type',v_attachment.media_type,
    'size_bytes',v_attachment.size_bytes,'content_hash',v_attachment.content_hash,
    'storage_ref',v_attachment.storage_ref,'storage_version',v_attachment.storage_version,
    'upload_expires_at',v_attachment.upload_expires_at,'cleanup_status',v_attachment.cleanup_status,'idempotent',true);
END;
$$;

REVOKE ALL ON FUNCTION refs_find_attachment_reservation(uuid,uuid,text,text,bigint,text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION refs_find_attachment_reservation(uuid,uuid,text,text,bigint,text,text) TO refs_app;

COMMIT;
