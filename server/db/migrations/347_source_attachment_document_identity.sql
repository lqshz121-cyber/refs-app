BEGIN;
-- Run with accounting writers drained; this is a blocking schema migration.
LOCK TABLE source_document,source_document_line,source_link,fixed_asset_acquisition_binding IN ACCESS EXCLUSIVE MODE;
-- Stable source identity cannot be moved underneath retained references.
CREATE FUNCTION refs_preserve_source_line_identity() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog,public,pg_temp AS $$
BEGIN
 IF ROW(NEW.tenant_id,NEW.entity_id,NEW.source_document_id,NEW.source_document_line_id) IS DISTINCT FROM ROW(OLD.tenant_id,OLD.entity_id,OLD.source_document_id,OLD.source_document_line_id) THEN
  RAISE EXCEPTION 'Source line identity is immutable; retain a new source version' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END;$$;
CREATE TRIGGER source_line_identity_guard BEFORE UPDATE OF tenant_id,entity_id,source_document_id,source_document_line_id ON source_document_line FOR EACH ROW EXECUTE FUNCTION refs_preserve_source_line_identity();
REVOKE EXECUTE ON FUNCTION refs_preserve_source_line_identity() FROM PUBLIC,refs_app;
CREATE FUNCTION refs_normalize_source_attachment_document() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE document uuid;locked_document uuid;
BEGIN
 IF NEW.source_document_line_id IS NOT NULL THEN
  SELECT source_document_id INTO document FROM source_document_line WHERE tenant_id=NEW.tenant_id AND entity_id=NEW.entity_id AND source_document_line_id=NEW.source_document_line_id;
  IF NOT FOUND OR (NEW.source_document_id IS NOT NULL AND NEW.source_document_id<>document) THEN
   RAISE EXCEPTION 'Attachment source line and document scope disagree' USING ERRCODE='23514';
  END IF;
  -- Match native acquisition lock order; recheck identity after any wait.
  PERFORM 1 FROM source_document WHERE tenant_id=NEW.tenant_id AND entity_id=NEW.entity_id AND source_document_id=document FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Attachment source document is unavailable' USING ERRCODE='23514';END IF;
  SELECT source_document_id INTO locked_document FROM source_document_line WHERE tenant_id=NEW.tenant_id AND entity_id=NEW.entity_id AND source_document_line_id=NEW.source_document_line_id FOR SHARE;
  IF NOT FOUND OR locked_document IS DISTINCT FROM document THEN
   RAISE EXCEPTION 'Attachment source line identity changed while locking' USING ERRCODE='40001';
  END IF;
  NEW.source_document_id:=document;
 END IF;
 IF NEW.source_document_id IS NULL OR NEW.attachment_id IS NULL THEN
  RAISE EXCEPTION 'Source attachment requires a scoped source document and attachment' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END;$$;
-- Alphabetical order is deliberate: canonical identity precedes the 346 lock/fence.
CREATE TRIGGER asset_source_attachment_identity_guard BEFORE INSERT ON source_link
 FOR EACH ROW WHEN(NEW.link_type='SOURCE_ATTACHMENT') EXECUTE FUNCTION refs_normalize_source_attachment_document();
CREATE FUNCTION refs_check_asset_attachment_document_history(p_tenant uuid,p_entity uuid,p_document uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
BEGIN
 IF EXISTS(SELECT 1 FROM source_link sl LEFT JOIN source_document_line l
  ON l.tenant_id=sl.tenant_id AND l.entity_id=sl.entity_id AND l.source_document_line_id=sl.source_document_line_id
  WHERE sl.tenant_id=p_tenant AND sl.entity_id=p_entity AND sl.link_type='SOURCE_ATTACHMENT'
  AND (sl.source_document_id=p_document OR l.source_document_id=p_document)
  AND (sl.source_document_id IS NULL OR sl.attachment_id IS NULL OR
   (sl.source_document_line_id IS NOT NULL AND l.source_document_id IS DISTINCT FROM sl.source_document_id))) THEN
  RAISE EXCEPTION 'Retained source attachment identity is ambiguous; acquisition evidence must be corrected' USING ERRCODE='55006';
 END IF;
END;$$;
DO $$ DECLARE binding record; BEGIN
 FOR binding IN SELECT DISTINCT tenant_id,entity_id,source_document_id FROM fixed_asset_acquisition_binding LOOP
  PERFORM refs_check_asset_attachment_document_history(binding.tenant_id,binding.entity_id,binding.source_document_id);
 END LOOP;
END;$$;
CREATE FUNCTION refs_guard_asset_attachment_document_history() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
BEGIN
 PERFORM refs_check_asset_attachment_document_history(NEW.tenant_id,NEW.entity_id,NEW.source_document_id);
 RETURN NEW;
END;$$;
CREATE TRIGGER asset_attachment_document_history_guard BEFORE INSERT ON fixed_asset_acquisition_binding
 FOR EACH ROW EXECUTE FUNCTION refs_guard_asset_attachment_document_history();
REVOKE EXECUTE ON FUNCTION refs_normalize_source_attachment_document(),refs_check_asset_attachment_document_history(uuid,uuid,uuid),refs_guard_asset_attachment_document_history() FROM PUBLIC,refs_app;
COMMIT;
