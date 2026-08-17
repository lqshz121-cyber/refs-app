BEGIN;
DROP FUNCTION IF EXISTS refs_get_source_document_detail(uuid,uuid,uuid);
ALTER FUNCTION refs_get_source_document_detail_v164(uuid,uuid,uuid) RENAME TO refs_get_source_document_detail;
COMMIT;
