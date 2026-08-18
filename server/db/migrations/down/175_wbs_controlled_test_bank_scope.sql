BEGIN;
DO $$ BEGIN
  IF EXISTS(SELECT 1 FROM wbs_controlled_test_bank_import) OR EXISTS(SELECT 1 FROM wbs_controlled_test_bank_import_row) THEN
    RAISE EXCEPTION 'Cannot roll back controlled test Bank bridge while retained evidence exists' USING ERRCODE='55006';
  END IF;
END $$;
REVOKE EXECUTE ON FUNCTION refs_create_wbs_controlled_test_bank_scope(uuid,uuid,uuid,text,jsonb,text,text,text) FROM refs_app;
REVOKE EXECUTE ON FUNCTION refs_create_wbs_controlled_test_bank_scope_hash(uuid,uuid,uuid,text,jsonb,text) FROM refs_app;
DROP FUNCTION refs_create_wbs_controlled_test_bank_scope(uuid,uuid,uuid,text,jsonb,text,text,text);
DROP FUNCTION refs_create_wbs_controlled_test_bank_scope_hash(uuid,uuid,uuid,text,jsonb,text);
DROP TRIGGER wbs_controlled_test_bank_import_row_append_only ON wbs_controlled_test_bank_import_row;
DROP TRIGGER wbs_controlled_test_bank_import_append_only ON wbs_controlled_test_bank_import;
DROP TABLE wbs_controlled_test_bank_import_row;
DROP TABLE wbs_controlled_test_bank_import;
COMMIT;
