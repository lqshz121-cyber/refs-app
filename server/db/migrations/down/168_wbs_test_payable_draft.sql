BEGIN;
DO $$ BEGIN
  IF EXISTS(SELECT 1 FROM wbs_test_import_draft) THEN
    RAISE EXCEPTION 'Cannot remove WBS test import while test lineage exists' USING ERRCODE='55006';
  END IF;
END $$;
REVOKE EXECUTE ON FUNCTION refs_finalize_wbs_test_import_source(uuid,uuid,uuid,uuid,uuid,text,text) FROM refs_app;
REVOKE EXECUTE ON FUNCTION refs_finalize_wbs_test_import_source_hash(uuid,uuid,uuid,uuid,uuid) FROM refs_app;
REVOKE EXECUTE ON FUNCTION refs_create_wbs_test_payable_draft(uuid,uuid,uuid,jsonb,jsonb,integer,text,text) FROM refs_app;
REVOKE EXECUTE ON FUNCTION refs_create_wbs_test_payable_draft_hash(uuid,uuid,uuid,jsonb,jsonb,integer) FROM refs_app;
DROP FUNCTION refs_create_wbs_test_payable_draft(uuid,uuid,uuid,jsonb,jsonb,integer,text,text);
DROP FUNCTION refs_create_wbs_test_payable_draft_hash(uuid,uuid,uuid,jsonb,jsonb,integer);
DROP FUNCTION refs_finalize_wbs_test_import_source(uuid,uuid,uuid,uuid,uuid,text,text);
DROP FUNCTION refs_finalize_wbs_test_import_source_hash(uuid,uuid,uuid,uuid,uuid);
DROP TABLE wbs_test_import_draft;
DELETE FROM permission_catalog WHERE permission_code='WBS.TEST.IMPORT';
COMMIT;
