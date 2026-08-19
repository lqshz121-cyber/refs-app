BEGIN;

REVOKE ALL ON FUNCTION refs_list_controlled_test_ai_sources(uuid,uuid,uuid,integer) FROM refs_app;
DROP FUNCTION IF EXISTS refs_list_controlled_test_ai_sources(uuid,uuid,uuid,integer);
DROP INDEX IF EXISTS source_link_source_document_posted_journal_lookup_idx;
DROP INDEX IF EXISTS source_document_wbs_test_payable_posted_period_idx;

COMMIT;
