BEGIN;

ALTER TABLE attachment
  ADD COLUMN entity_id uuid,
  ADD COLUMN reserved_at timestamptz,
  ADD COLUMN upload_expires_at timestamptz,
  ADD CONSTRAINT attachment_entity_fk FOREIGN KEY(tenant_id,entity_id) REFERENCES entity(tenant_id,entity_id),
  ADD CONSTRAINT attachment_reservation_window_ck CHECK ((reserved_at IS NULL AND upload_expires_at IS NULL) OR (reserved_at IS NOT NULL AND upload_expires_at>reserved_at)),
  ADD CONSTRAINT attachment_verified_entity_ck CHECK (finalization_status<>'VERIFIED_CLEAN' OR entity_id IS NOT NULL);

UPDATE attachment a SET entity_id=resolved.entity_id
FROM (
  SELECT tenant_id,attachment_id,(array_agg(entity_id ORDER BY entity_id))[1] entity_id
  FROM source_link WHERE attachment_id IS NOT NULL GROUP BY tenant_id,attachment_id HAVING count(DISTINCT entity_id)=1
) resolved WHERE (a.tenant_id,a.attachment_id)=(resolved.tenant_id,resolved.attachment_id);

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM attachment WHERE finalization_status='VERIFIED_CLEAN' AND entity_id IS NULL) THEN
    RAISE EXCEPTION 'Verified legacy attachment has no unambiguous entity ownership';
  END IF;
END $$;

DROP POLICY attachment_tenant_policy ON attachment;
CREATE POLICY attachment_scope_policy ON attachment
  USING (tenant_id=refs_current_tenant() AND entity_id IS NOT NULL AND refs_entity_allowed(entity_id))
  WITH CHECK (tenant_id=refs_current_tenant() AND entity_id IS NOT NULL AND refs_entity_allowed(entity_id));

INSERT INTO permission_catalog(permission_code,domain,risk_class,sod_class) VALUES
  ('ATTACHMENT.CREATE','ATTACHMENT','MEDIUM','ATTACHMENT_UPLOADER'),
  ('ATTACHMENT.FINALIZE','ATTACHMENT','HIGH','ATTACHMENT_SCANNER');

CREATE OR REPLACE FUNCTION refs_attachment_reserve_hash(
  p_tenant uuid,p_entity uuid,p_name text,p_media_type text,p_size_bytes bigint,p_content_hash text,p_storage_ref text,p_storage_version text
) RETURNS text LANGUAGE sql IMMUTABLE SET search_path=pg_catalog,public,pg_temp AS $$
  SELECT refs_jsonb_hash(jsonb_build_object('tenant_id',p_tenant,'entity_id',p_entity,'name',btrim(p_name),'media_type',lower(btrim(p_media_type)),
    'size_bytes',p_size_bytes,'content_hash',lower(p_content_hash),'storage_ref',p_storage_ref,'storage_version',p_storage_version))
$$;

CREATE OR REPLACE FUNCTION refs_reserve_attachment(
  p_tenant uuid,p_entity uuid,p_name text,p_media_type text,p_size_bytes bigint,p_content_hash text,p_storage_ref text,p_storage_version text,
  p_idempotency_key text,p_request_hash text
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE actor text:=refs_current_actor(); computed_hash text; receipt idempotency_receipt; new_attachment_id uuid:=gen_random_uuid(); response jsonb; payload jsonb; expires_at timestamptz:=clock_timestamp()+interval '15 minutes';
BEGIN
  PERFORM refs_assert_scope(p_tenant,p_entity,'ATTACHMENT.CREATE');
  computed_hash:=refs_attachment_reserve_hash(p_tenant,p_entity,p_name,p_media_type,p_size_bytes,p_content_hash,p_storage_ref,p_storage_version);
  IF p_request_hash<>computed_hash THEN RAISE EXCEPTION 'Attachment reserve request hash is not canonical' USING ERRCODE='22023'; END IF;
  IF p_size_bytes<=0 OR p_size_bytes>52428800 OR p_content_hash!~'^sha256:[0-9a-f]{64}$' OR p_storage_ref!~'^(object|s3)://' OR
     length(btrim(p_name)) NOT BETWEEN 1 AND 255 OR p_name~'[/\\]' OR lower(btrim(p_media_type)) NOT IN ('application/pdf','image/png','image/jpeg','text/csv') THEN
    RAISE EXCEPTION 'Attachment metadata is invalid' USING ERRCODE='22023';
  END IF;
  INSERT INTO idempotency_receipt(tenant_id,operation_scope,idempotency_key,request_hash,status,actor_id)
    VALUES(p_tenant,'RESERVE_ATTACHMENT:'||p_entity,p_idempotency_key,p_request_hash,'IN_PROGRESS',actor) ON CONFLICT DO NOTHING;
  SELECT * INTO receipt FROM idempotency_receipt WHERE tenant_id=p_tenant AND operation_scope='RESERVE_ATTACHMENT:'||p_entity AND idempotency_key=p_idempotency_key FOR UPDATE;
  IF receipt.request_hash<>p_request_hash THEN RAISE EXCEPTION 'Idempotency key reused with different request hash' USING ERRCODE='23505'; END IF;
  IF receipt.status='SUCCEEDED' THEN RETURN receipt.response_body||jsonb_build_object('idempotent',true); END IF;
  INSERT INTO attachment(attachment_id,tenant_id,entity_id,name,media_type,size_bytes,content_hash,storage_ref,storage_version,uploaded_by,uploaded_at,reserved_at,upload_expires_at)
    VALUES(new_attachment_id,p_tenant,p_entity,btrim(p_name),lower(btrim(p_media_type)),p_size_bytes,lower(p_content_hash),p_storage_ref,p_storage_version,actor,clock_timestamp(),clock_timestamp(),expires_at);
  response:=jsonb_build_object('attachment_id',new_attachment_id,'entity_id',p_entity,'status','PENDING','upload_expires_at',expires_at,'idempotent',false);
  INSERT INTO audit_event(tenant_id,entity_id,event_type,object_type,object_id,action,actor_id,actor_type,permission_used,request_id,correlation_id,idempotency_key,after_hash)
    VALUES(p_tenant,p_entity,'ATTACHMENT_RESERVED','ATTACHMENT',new_attachment_id,'RESERVE',actor,'USER','ATTACHMENT.CREATE',p_idempotency_key,p_idempotency_key,p_idempotency_key,p_request_hash);
  payload:=jsonb_build_object('attachment_id',new_attachment_id,'entity_id',p_entity,'status','PENDING');
  INSERT INTO outbox_event(tenant_id,entity_id,aggregate_type,aggregate_id,event_type,payload,payload_hash)
    VALUES(p_tenant,p_entity,'ATTACHMENT',new_attachment_id,'ATTACHMENT_RESERVED',payload,refs_jsonb_hash(payload));
  UPDATE idempotency_receipt SET status='SUCCEEDED',response_status=201,response_body=response,completed_at=clock_timestamp() WHERE idempotency_receipt_id=receipt.idempotency_receipt_id;
  RETURN response;
END $$;

CREATE OR REPLACE FUNCTION refs_attachment_finalize_hash(
  p_tenant uuid,p_entity uuid,p_attachment uuid,p_size_bytes bigint,p_content_hash text,p_media_type text,p_storage_version text,p_scan_clean boolean,p_scan_ref text
) RETURNS text LANGUAGE sql IMMUTABLE SET search_path=pg_catalog,public,pg_temp AS $$
  SELECT refs_jsonb_hash(jsonb_build_object('tenant_id',p_tenant,'entity_id',p_entity,'attachment_id',p_attachment,'observed_size_bytes',p_size_bytes,
    'observed_content_hash',lower(p_content_hash),'observed_media_type',lower(btrim(p_media_type)),'storage_version',p_storage_version,'scan_clean',p_scan_clean,'scan_ref',p_scan_ref))
$$;

CREATE OR REPLACE FUNCTION refs_finalize_attachment(
  p_tenant uuid,p_entity uuid,p_attachment uuid,p_size_bytes bigint,p_content_hash text,p_media_type text,p_storage_version text,p_scan_clean boolean,p_scan_ref text,
  p_idempotency_key text,p_request_hash text
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE actor text:=refs_current_actor(); computed_hash text; receipt idempotency_receipt; current attachment; accepted boolean; response jsonb; payload jsonb;
BEGIN
  PERFORM refs_assert_scope(p_tenant,p_entity,'ATTACHMENT.FINALIZE');
  computed_hash:=refs_attachment_finalize_hash(p_tenant,p_entity,p_attachment,p_size_bytes,p_content_hash,p_media_type,p_storage_version,p_scan_clean,p_scan_ref);
  IF p_request_hash<>computed_hash THEN RAISE EXCEPTION 'Attachment finalize request hash is not canonical' USING ERRCODE='22023'; END IF;
  INSERT INTO idempotency_receipt(tenant_id,operation_scope,idempotency_key,request_hash,status,actor_id)
    VALUES(p_tenant,'FINALIZE_ATTACHMENT:'||p_entity,p_idempotency_key,p_request_hash,'IN_PROGRESS',actor) ON CONFLICT DO NOTHING;
  SELECT * INTO receipt FROM idempotency_receipt WHERE tenant_id=p_tenant AND operation_scope='FINALIZE_ATTACHMENT:'||p_entity AND idempotency_key=p_idempotency_key FOR UPDATE;
  IF receipt.request_hash<>p_request_hash THEN RAISE EXCEPTION 'Idempotency key reused with different request hash' USING ERRCODE='23505'; END IF;
  IF receipt.status='SUCCEEDED' THEN RETURN receipt.response_body||jsonb_build_object('idempotent',true); END IF;
  SELECT * INTO current FROM attachment WHERE tenant_id=p_tenant AND entity_id=p_entity AND attachment_id=p_attachment FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Attachment not found' USING ERRCODE='P0002'; END IF;
  IF current.finalization_status<>'PENDING' OR current.upload_expires_at<=clock_timestamp() THEN RAISE EXCEPTION 'Attachment is not pending within its upload window' USING ERRCODE='55000'; END IF;
  IF actor=current.uploaded_by THEN RAISE EXCEPTION 'Attachment scanner SoD violation' USING ERRCODE='42501'; END IF;
  accepted:=p_scan_clean AND p_scan_ref IS NOT NULL AND length(btrim(p_scan_ref))>0 AND current.size_bytes=p_size_bytes AND current.content_hash=lower(p_content_hash)
    AND current.media_type=lower(btrim(p_media_type)) AND current.storage_version=p_storage_version;
  PERFORM set_config('refs.attachment_finalize','authorized',true);
  UPDATE attachment SET verified_at=clock_timestamp(),scan_status=CASE WHEN accepted THEN 'CLEAN' ELSE 'REJECTED' END,
    finalization_status=CASE WHEN accepted THEN 'VERIFIED_CLEAN' ELSE 'REJECTED' END,finalized_at=clock_timestamp() WHERE attachment_id=p_attachment;
  PERFORM set_config('refs.attachment_finalize','',true);
  response:=jsonb_build_object('attachment_id',p_attachment,'entity_id',p_entity,'status',CASE WHEN accepted THEN 'VERIFIED_CLEAN' ELSE 'REJECTED' END,'idempotent',false);
  INSERT INTO audit_event(tenant_id,entity_id,event_type,object_type,object_id,action,actor_id,actor_type,permission_used,request_id,correlation_id,idempotency_key,after_hash,metadata)
    VALUES(p_tenant,p_entity,'ATTACHMENT_FINALIZED','ATTACHMENT',p_attachment,'FINALIZE',actor,'SERVICE_ACCOUNT','ATTACHMENT.FINALIZE',p_idempotency_key,p_idempotency_key,p_idempotency_key,p_request_hash,jsonb_build_object('scan_ref',p_scan_ref,'accepted',accepted));
  payload:=jsonb_build_object('attachment_id',p_attachment,'entity_id',p_entity,'status',CASE WHEN accepted THEN 'VERIFIED_CLEAN' ELSE 'REJECTED' END);
  INSERT INTO outbox_event(tenant_id,entity_id,aggregate_type,aggregate_id,event_type,payload,payload_hash)
    VALUES(p_tenant,p_entity,'ATTACHMENT',p_attachment,'ATTACHMENT_FINALIZED',payload,refs_jsonb_hash(payload));
  UPDATE idempotency_receipt SET status='SUCCEEDED',response_status=200,response_body=response,completed_at=clock_timestamp() WHERE idempotency_receipt_id=receipt.idempotency_receipt_id;
  RETURN response;
END $$;

CREATE OR REPLACE FUNCTION refs_protect_attachment_evidence() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,public,pg_temp AS $$
BEGIN
  IF TG_OP='DELETE' OR OLD.finalization_status<>'PENDING' THEN RAISE EXCEPTION 'Attachment evidence is immutable' USING ERRCODE='55000'; END IF;
  IF current_setting('refs.attachment_finalize',true)<>'authorized' THEN RAISE EXCEPTION 'Attachment transition requires controlled finalization' USING ERRCODE='42501'; END IF;
  IF (NEW.tenant_id,NEW.entity_id,NEW.name,NEW.media_type,NEW.size_bytes,NEW.content_hash,NEW.storage_ref,NEW.storage_version,NEW.uploaded_by,NEW.uploaded_at,NEW.reserved_at,NEW.upload_expires_at)
    IS DISTINCT FROM (OLD.tenant_id,OLD.entity_id,OLD.name,OLD.media_type,OLD.size_bytes,OLD.content_hash,OLD.storage_ref,OLD.storage_version,OLD.uploaded_by,OLD.uploaded_at,OLD.reserved_at,OLD.upload_expires_at) THEN
    RAISE EXCEPTION 'Attachment business metadata is immutable' USING ERRCODE='55000';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER attachment_evidence_immutable BEFORE UPDATE OR DELETE ON attachment FOR EACH ROW EXECUTE FUNCTION refs_protect_attachment_evidence();

REVOKE EXECUTE ON FUNCTION refs_attachment_reserve_hash(uuid,uuid,text,text,bigint,text,text,text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION refs_reserve_attachment(uuid,uuid,text,text,bigint,text,text,text,text,text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION refs_attachment_finalize_hash(uuid,uuid,uuid,bigint,text,text,text,boolean,text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION refs_finalize_attachment(uuid,uuid,uuid,bigint,text,text,text,boolean,text,text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION refs_attachment_reserve_hash(uuid,uuid,text,text,bigint,text,text,text) TO refs_app;
GRANT EXECUTE ON FUNCTION refs_reserve_attachment(uuid,uuid,text,text,bigint,text,text,text,text,text) TO refs_app;
GRANT EXECUTE ON FUNCTION refs_attachment_finalize_hash(uuid,uuid,uuid,bigint,text,text,text,boolean,text) TO refs_app;
GRANT EXECUTE ON FUNCTION refs_finalize_attachment(uuid,uuid,uuid,bigint,text,text,text,boolean,text,text,text) TO refs_app;

COMMIT;
