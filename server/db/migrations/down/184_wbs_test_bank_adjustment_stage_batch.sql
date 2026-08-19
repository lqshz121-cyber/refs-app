BEGIN;

REVOKE EXECUTE ON FUNCTION refs_wbs_test_bank_adjustment_post_clear_batch(uuid,uuid,uuid,uuid,uuid[],text,text) FROM refs_app;
REVOKE EXECUTE ON FUNCTION refs_wbs_test_bank_adjustment_approve_batch(uuid,uuid,uuid,uuid[],text) FROM refs_app;
REVOKE EXECUTE ON FUNCTION refs_wbs_test_bank_adjustment_review_batch(uuid,uuid,uuid,uuid[],text) FROM refs_app;
REVOKE EXECUTE ON FUNCTION refs_wbs_test_bank_adjustment_submit_batch(uuid,uuid,uuid,uuid[],text) FROM refs_app;
REVOKE EXECUTE ON FUNCTION refs_wbs_test_bank_adjustment_draft_batch(uuid,uuid,uuid,uuid,uuid[],uuid[],text,text) FROM refs_app;
DROP FUNCTION refs_wbs_test_bank_adjustment_post_clear_batch(uuid,uuid,uuid,uuid,uuid[],text,text);
DROP FUNCTION refs_wbs_test_bank_adjustment_approve_batch(uuid,uuid,uuid,uuid[],text);
DROP FUNCTION refs_wbs_test_bank_adjustment_review_batch(uuid,uuid,uuid,uuid[],text);
DROP FUNCTION refs_wbs_test_bank_adjustment_submit_batch(uuid,uuid,uuid,uuid[],text);
DROP FUNCTION refs_wbs_test_bank_adjustment_draft_batch(uuid,uuid,uuid,uuid,uuid[],uuid[],text,text);
DROP FUNCTION refs_private_wbs_test_bank_adjustment_transition_batch(uuid,uuid,uuid,uuid[],text,journal_status,journal_status[],text);
DROP FUNCTION refs_private_wbs_test_bank_adjustment_batch_ids(uuid,uuid,uuid,uuid[]);

COMMIT;
