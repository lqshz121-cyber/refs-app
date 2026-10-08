BEGIN;
DROP FUNCTION refs_create_wbs_test_payable_draft(uuid,uuid,uuid,text,text,text);
ALTER FUNCTION refs_create_wbs_test_payable_draft_455(uuid,uuid,uuid,text,text,text) RENAME TO refs_create_wbs_test_payable_draft;
DROP FUNCTION refs_retain_wbs_test_payable_source(uuid,uuid,uuid,jsonb,jsonb,integer,text,text);
ALTER FUNCTION refs_retain_wbs_test_payable_source_455(uuid,uuid,uuid,jsonb,jsonb,integer,text,text) RENAME TO refs_retain_wbs_test_payable_source;
DROP TABLE wbs_test_payable_original_sign_evidence;
GRANT EXECUTE ON FUNCTION refs_retain_wbs_test_payable_source(uuid,uuid,uuid,jsonb,jsonb,integer,text,text),refs_create_wbs_test_payable_draft(uuid,uuid,uuid,text,text,text) TO refs_app;
COMMIT;
