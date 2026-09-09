BEGIN;
-- Like installation, rollback requires drained accounting writers.
LOCK TABLE source_document,source_document_line,source_link,fixed_asset_acquisition_binding IN ACCESS EXCLUSIVE MODE;
DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM fixed_asset_acquisition_binding) THEN
  RAISE EXCEPTION 'Retained acquisitions require canonical attachment identity' USING ERRCODE='55006';
 END IF;
END;$$;
DROP TRIGGER asset_attachment_document_history_guard ON fixed_asset_acquisition_binding;
DROP FUNCTION refs_guard_asset_attachment_document_history();
DROP FUNCTION refs_check_asset_attachment_document_history(uuid,uuid,uuid);
DROP TRIGGER asset_source_attachment_identity_guard ON source_link;
DROP FUNCTION refs_normalize_source_attachment_document();
DROP TRIGGER source_line_identity_guard ON source_document_line;
DROP FUNCTION refs_preserve_source_line_identity();
COMMIT;
