BEGIN;
DROP FUNCTION refs_read_wbs_h1_month_completion(uuid,uuid,text,text);
DROP INDEX wbs_controlled_test_bank_import_completion_scope_idx;
DROP INDEX wbs_test_import_draft_completion_scope_idx;
COMMIT;
