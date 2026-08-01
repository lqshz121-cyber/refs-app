BEGIN;

ALTER TABLE attachment
  ADD COLUMN entity_id uuid,
  ADD COLUMN reserved_at timestamptz,
  ADD COLUMN upload_expires_at timestamptz,
  ADD COLUMN cleanup_status text NOT NULL DEFAULT 'NONE' CHECK (cleanup_status IN ('NONE','PENDING','COMPLETE','FAILED')),
  ADD COLUMN cleanup_attempts integer NOT NULL DEFAULT 0 CHECK (cleanup_attempts>=0),
  ADD COLUMN cleanup_claimed_at timestamptz,
  ADD COLUMN cleanup_claim_token uuid,
  ADD COLUMN cleanup_claimed_by text,
  ADD COLUMN cleaned_at timestamptz,
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
  ('ATTACHMENT.FINALIZE','ATTACHMENT','HIGH','ATTACHMENT_SCANNER'),
  ('ATTACHMENT.CLEANUP','ATTACHMENT','HIGH','ATTACHMENT_CLEANER');

REVOKE SELECT ON attachment FROM refs_app;

CREATE OR REPLACE FUNCTION refs_attachment_finalize_request_hash(p_tenant uuid,p_entity uuid,p_attachment uuid)
RETURNS text LANGUAGE sql IMMUTABLE SET search_path=pg_catalog,public,pg_temp AS $$
  SELECT refs_jsonb_hash(jsonb_build_object('tenant_id',p_tenant,'entity_id',p_entity,'attachment_id',p_attachment))
$$;

CREATE OR REPLACE FUNCTION refs_request_attachment_finalize(
  p_tenant uuid,p_entity uuid,p_attachment uuid,p_idempotency_key text,p_request_hash text
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE actor text:=refs_current_actor(); computed_hash text; receipt idempotency_receipt; current attachment; response jsonb; payload jsonb;
BEGIN
  PERFORM refs_assert_scope(p_tenant,p_entity,'ATTACHMENT.CREATE');
  computed_hash:=refs_attachment_finalize_request_hash(p_tenant,p_entity,p_attachment);
  IF p_request_hash<>computed_hash THEN RAISE EXCEPTION 'Attachment finalize request hash is not canonical' USING ERRCODE='22023'; END IF;
  INSERT INTO idempotency_receipt(tenant_id,operation_scope,idempotency_key,request_hash,status,actor_id)
    VALUES(p_tenant,'REQUEST_ATTACHMENT_FINALIZE:'||p_entity,p_idempotency_key,p_request_hash,'IN_PROGRESS',actor) ON CONFLICT DO NOTHING;
  SELECT * INTO receipt FROM idempotency_receipt WHERE tenant_id=p_tenant AND operation_scope='REQUEST_ATTACHMENT_FINALIZE:'||p_entity AND idempotency_key=p_idempotency_key FOR UPDATE;
  IF receipt.request_hash<>p_request_hash THEN RAISE EXCEPTION 'Idempotency key reused with different request hash' USING ERRCODE='23505'; END IF;
  IF receipt.status='SUCCEEDED' THEN
    SELECT * INTO current FROM attachment WHERE tenant_id=p_tenant AND entity_id=p_entity AND attachment_id=p_attachment;
    IF NOT FOUND THEN RAISE EXCEPTION 'Attachment not found' USING ERRCODE='P0002'; END IF;
    RETURN receipt.response_body||jsonb_build_object('finalization_status',current.finalization_status,'storage_version',current.storage_version,'idempotent',true);
  END IF;
  SELECT * INTO current FROM attachment WHERE tenant_id=p_tenant AND entity_id=p_entity AND attachment_id=p_attachment FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Attachment not found' USING ERRCODE='P0002'; END IF;
  IF current.finalization_status<>'PENDING' OR current.upload_expires_at<=clock_timestamp() THEN RAISE EXCEPTION 'Attachment is not pending within its upload window' USING ERRCODE='55000'; END IF;
  response:=jsonb_build_object('attachment_id',current.attachment_id,'entity_id',current.entity_id,'name',current.name,'media_type',current.media_type,
    'size_bytes',current.size_bytes,'content_hash',current.content_hash,'storage_ref',current.storage_ref,'storage_version',current.storage_version,
    'finalization_status',current.finalization_status,'upload_expires_at',current.upload_expires_at,'initiated_by',actor,'idempotent',false);
  INSERT INTO audit_event(tenant_id,entity_id,event_type,object_type,object_id,action,actor_id,actor_type,permission_used,request_id,correlation_id,idempotency_key,after_hash,metadata)
    VALUES(p_tenant,p_entity,'ATTACHMENT_FINALIZE_REQUESTED','ATTACHMENT',p_attachment,'REQUEST_FINALIZE',actor,'USER','ATTACHMENT.CREATE',p_idempotency_key,p_idempotency_key,p_idempotency_key,p_request_hash,
      jsonb_build_object('storage_version',current.storage_version));
  payload:=jsonb_build_object('attachment_id',p_attachment,'entity_id',p_entity,'status','SCAN_REQUESTED','initiated_by',actor,'storage_version',current.storage_version);
  INSERT INTO outbox_event(tenant_id,entity_id,aggregate_type,aggregate_id,event_type,payload,payload_hash)
    VALUES(p_tenant,p_entity,'ATTACHMENT',p_attachment,'ATTACHMENT_FINALIZE_REQUESTED',payload,refs_jsonb_hash(payload));
  UPDATE idempotency_receipt SET status='SUCCEEDED',response_status=200,response_body=response,completed_at=clock_timestamp() WHERE idempotency_receipt_id=receipt.idempotency_receipt_id;
  RETURN response;
END $$;

CREATE OR REPLACE FUNCTION refs_claim_expired_attachments(p_tenant uuid,p_entity uuid,p_limit integer)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE actor text:=refs_current_actor(); items jsonb;
BEGIN
  PERFORM refs_assert_scope(p_tenant,p_entity,'ATTACHMENT.CLEANUP');
  IF p_limit NOT BETWEEN 1 AND 100 THEN RAISE EXCEPTION 'Cleanup limit is invalid' USING ERRCODE='22023'; END IF;
  PERFORM set_config('refs.attachment_finalize','authorized',true);
  WITH candidates AS (
    SELECT attachment_id FROM attachment WHERE tenant_id=p_tenant AND entity_id=p_entity AND finalization_status='PENDING' AND upload_expires_at<=clock_timestamp()
      AND (cleanup_status IN ('NONE','FAILED') OR (cleanup_status='PENDING' AND cleanup_claimed_at<clock_timestamp()-interval '5 minutes'))
    ORDER BY upload_expires_at,attachment_id FOR UPDATE SKIP LOCKED LIMIT p_limit
  ), claimed AS (
    UPDATE attachment a SET cleanup_status='PENDING',cleanup_attempts=a.cleanup_attempts+1,cleanup_claimed_at=clock_timestamp(),cleanup_claim_token=gen_random_uuid(),cleanup_claimed_by=actor FROM candidates c WHERE a.attachment_id=c.attachment_id
    RETURNING a.attachment_id,a.storage_ref,a.storage_version,a.cleanup_attempts,a.cleanup_claim_token
  ) SELECT coalesce(jsonb_agg(jsonb_build_object('attachment_id',attachment_id,'storage_ref',storage_ref,'storage_version',storage_version,'cleanup_attempt',cleanup_attempts,'claim_token',cleanup_claim_token)),'[]'::jsonb) INTO items FROM claimed;
  PERFORM set_config('refs.attachment_finalize','',true);
  INSERT INTO audit_event(tenant_id,entity_id,event_type,object_type,object_id,action,actor_id,actor_type,permission_used,request_id,correlation_id,metadata)
    SELECT p_tenant,p_entity,'ATTACHMENT_CLEANUP_CLAIMED','ATTACHMENT',(item->>'attachment_id')::uuid,'CLAIM_EXPIRED',actor,'SERVICE_ACCOUNT','ATTACHMENT.CLEANUP',
      'cleanup:'||(item->>'attachment_id')||':'||(item->>'cleanup_attempt'),'cleanup:'||(item->>'attachment_id'),item-'storage_ref'-'storage_version' FROM jsonb_array_elements(items) item;
  INSERT INTO outbox_event(tenant_id,entity_id,aggregate_type,aggregate_id,event_type,payload,payload_hash)
    SELECT p_tenant,p_entity,'ATTACHMENT',(item->>'attachment_id')::uuid,'ATTACHMENT_CLEANUP_CLAIMED',item-'storage_ref'-'storage_version',refs_jsonb_hash(item-'storage_ref'-'storage_version') FROM jsonb_array_elements(items) item;
  RETURN items;
END $$;

CREATE OR REPLACE FUNCTION refs_complete_attachment_cleanup(p_tenant uuid,p_entity uuid,p_attachment uuid,p_claim_token uuid,p_deleted boolean,p_error text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE actor text:=refs_current_actor(); current attachment; response jsonb;
BEGIN
  PERFORM refs_assert_scope(p_tenant,p_entity,'ATTACHMENT.CLEANUP');
  SELECT * INTO current FROM attachment WHERE tenant_id=p_tenant AND entity_id=p_entity AND attachment_id=p_attachment FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Attachment not found' USING ERRCODE='P0002'; END IF;
  IF current.finalization_status<>'PENDING' OR current.cleanup_status<>'PENDING' OR current.cleanup_claim_token IS DISTINCT FROM p_claim_token OR current.cleanup_claimed_by IS DISTINCT FROM actor THEN
    RAISE EXCEPTION 'Attachment cleanup lease is absent, stale, or owned by another worker' USING ERRCODE='40001'; END IF;
  PERFORM set_config('refs.attachment_finalize','authorized',true);
  UPDATE attachment SET cleanup_status=CASE WHEN p_deleted THEN 'COMPLETE' ELSE 'FAILED' END,cleanup_claimed_at=NULL,cleanup_claim_token=NULL,cleanup_claimed_by=NULL,cleaned_at=CASE WHEN p_deleted THEN clock_timestamp() END,
    finalization_status=CASE WHEN p_deleted THEN 'REJECTED' ELSE finalization_status END,scan_status=CASE WHEN p_deleted THEN 'ERROR' ELSE scan_status END,
    finalized_at=CASE WHEN p_deleted THEN clock_timestamp() ELSE finalized_at END WHERE attachment_id=p_attachment;
  PERFORM set_config('refs.attachment_finalize','',true);
  response:=jsonb_build_object('attachment_id',p_attachment,'status',CASE WHEN p_deleted THEN 'CLEANED' ELSE 'CLEANUP_FAILED' END,'attempt',current.cleanup_attempts);
  INSERT INTO audit_event(tenant_id,entity_id,event_type,object_type,object_id,action,actor_id,actor_type,permission_used,request_id,correlation_id,metadata)
    VALUES(p_tenant,p_entity,CASE WHEN p_deleted THEN 'ATTACHMENT_CLEANED' ELSE 'ATTACHMENT_CLEANUP_FAILED' END,'ATTACHMENT',p_attachment,'CLEANUP',actor,'SERVICE_ACCOUNT','ATTACHMENT.CLEANUP',
      'cleanup:'||p_attachment||':'||current.cleanup_attempts,'cleanup:'||p_attachment,jsonb_build_object('error',p_error,'attempt',current.cleanup_attempts));
  INSERT INTO outbox_event(tenant_id,entity_id,aggregate_type,aggregate_id,event_type,payload,payload_hash)
    VALUES(p_tenant,p_entity,'ATTACHMENT',p_attachment,CASE WHEN p_deleted THEN 'ATTACHMENT_CLEANED' ELSE 'ATTACHMENT_CLEANUP_FAILED' END,response,refs_jsonb_hash(response));
  RETURN response;
END $$;

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
  p_tenant uuid,p_entity uuid,p_attachment uuid,p_storage_ref text,p_size_bytes bigint,p_content_hash text,p_media_type text,p_storage_version text,p_scan_clean boolean,p_scan_ref text
) RETURNS text LANGUAGE sql IMMUTABLE SET search_path=pg_catalog,public,pg_temp AS $$
  SELECT refs_jsonb_hash(jsonb_build_object('tenant_id',p_tenant,'entity_id',p_entity,'attachment_id',p_attachment,'storage_ref',p_storage_ref,'observed_size_bytes',p_size_bytes,
    'observed_content_hash',lower(p_content_hash),'observed_media_type',lower(btrim(p_media_type)),'storage_version',p_storage_version,'scan_clean',p_scan_clean,'scan_ref',p_scan_ref))
$$;

CREATE OR REPLACE FUNCTION refs_finalize_attachment(
  p_tenant uuid,p_entity uuid,p_attachment uuid,p_storage_ref text,p_size_bytes bigint,p_content_hash text,p_media_type text,p_storage_version text,p_scan_clean boolean,p_scan_ref text,
  p_idempotency_key text,p_request_hash text
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE actor text:=refs_current_actor(); computed_hash text; receipt idempotency_receipt; current attachment; accepted boolean; response jsonb; payload jsonb;
BEGIN
  PERFORM refs_assert_scope(p_tenant,p_entity,'ATTACHMENT.FINALIZE');
  computed_hash:=refs_attachment_finalize_hash(p_tenant,p_entity,p_attachment,p_storage_ref,p_size_bytes,p_content_hash,p_media_type,p_storage_version,p_scan_clean,p_scan_ref);
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
  IF current.storage_ref<>p_storage_ref THEN RAISE EXCEPTION 'Scanned object does not match attachment reservation' USING ERRCODE='23514'; END IF;
  accepted:=p_scan_clean AND p_scan_ref IS NOT NULL AND length(btrim(p_scan_ref))>0 AND current.size_bytes=p_size_bytes AND current.content_hash=lower(p_content_hash)
    AND current.media_type=lower(btrim(p_media_type)) AND p_storage_version!~'^pending:' AND length(btrim(p_storage_version))>0;
  PERFORM set_config('refs.attachment_finalize','authorized',true);
  UPDATE attachment SET storage_version=CASE WHEN accepted THEN p_storage_version ELSE storage_version END,verified_at=clock_timestamp(),scan_status=CASE WHEN accepted THEN 'CLEAN' ELSE 'REJECTED' END,
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
  IF (NEW.tenant_id,NEW.entity_id,NEW.name,NEW.media_type,NEW.size_bytes,NEW.content_hash,NEW.storage_ref,NEW.uploaded_by,NEW.uploaded_at,NEW.reserved_at,NEW.upload_expires_at)
    IS DISTINCT FROM (OLD.tenant_id,OLD.entity_id,OLD.name,OLD.media_type,OLD.size_bytes,OLD.content_hash,OLD.storage_ref,OLD.uploaded_by,OLD.uploaded_at,OLD.reserved_at,OLD.upload_expires_at) THEN
    RAISE EXCEPTION 'Attachment business metadata is immutable' USING ERRCODE='55000';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER attachment_evidence_immutable BEFORE UPDATE OR DELETE ON attachment FOR EACH ROW EXECUTE FUNCTION refs_protect_attachment_evidence();

REVOKE EXECUTE ON FUNCTION refs_attachment_reserve_hash(uuid,uuid,text,text,bigint,text,text,text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION refs_attachment_finalize_request_hash(uuid,uuid,uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION refs_request_attachment_finalize(uuid,uuid,uuid,text,text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION refs_claim_expired_attachments(uuid,uuid,integer) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION refs_complete_attachment_cleanup(uuid,uuid,uuid,uuid,boolean,text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION refs_reserve_attachment(uuid,uuid,text,text,bigint,text,text,text,text,text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION refs_attachment_finalize_hash(uuid,uuid,uuid,text,bigint,text,text,text,boolean,text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION refs_finalize_attachment(uuid,uuid,uuid,text,bigint,text,text,text,boolean,text,text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION refs_attachment_reserve_hash(uuid,uuid,text,text,bigint,text,text,text) TO refs_app;
GRANT EXECUTE ON FUNCTION refs_attachment_finalize_request_hash(uuid,uuid,uuid) TO refs_app;
GRANT EXECUTE ON FUNCTION refs_request_attachment_finalize(uuid,uuid,uuid,text,text) TO refs_app;
GRANT EXECUTE ON FUNCTION refs_claim_expired_attachments(uuid,uuid,integer) TO refs_app;
GRANT EXECUTE ON FUNCTION refs_complete_attachment_cleanup(uuid,uuid,uuid,uuid,boolean,text) TO refs_app;
GRANT EXECUTE ON FUNCTION refs_reserve_attachment(uuid,uuid,text,text,bigint,text,text,text,text,text) TO refs_app;
GRANT EXECUTE ON FUNCTION refs_attachment_finalize_hash(uuid,uuid,uuid,text,bigint,text,text,text,boolean,text) TO refs_app;
GRANT EXECUTE ON FUNCTION refs_finalize_attachment(uuid,uuid,uuid,text,bigint,text,text,text,boolean,text,text,text) TO refs_app;

COMMIT;
