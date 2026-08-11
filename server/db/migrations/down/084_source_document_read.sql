BEGIN;
DROP FUNCTION IF EXISTS refs_get_source_document_detail(uuid,uuid,uuid);
DROP FUNCTION IF EXISTS refs_list_source_documents(uuid,uuid);
COMMIT;
