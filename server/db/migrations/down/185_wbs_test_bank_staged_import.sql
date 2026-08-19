BEGIN;
DO $$ BEGIN
  IF EXISTS(SELECT 1 FROM wbs_test_bank_import_stage) THEN RAISE EXCEPTION 'Cannot roll back staged WBS Bank import while retained checkpoints exist' USING ERRCODE='55006'; END IF;
END $$;
REVOKE ALL ON FUNCTION refs_begin_wbs_test_bank_staged_import(uuid,uuid,uuid,text,jsonb,text,text,text),refs_append_wbs_test_bank_staged_chunk(uuid,uuid,uuid,integer,jsonb,text),refs_finalize_wbs_test_bank_staged_import(uuid,uuid,uuid) FROM refs_app;
DROP FUNCTION refs_finalize_wbs_test_bank_staged_import(uuid,uuid,uuid);
DROP FUNCTION refs_append_wbs_test_bank_staged_chunk(uuid,uuid,uuid,integer,jsonb,text);
DROP FUNCTION refs_begin_wbs_test_bank_staged_import(uuid,uuid,uuid,text,jsonb,text,text,text);
DROP TABLE wbs_test_bank_import_stage_final,wbs_test_bank_import_stage_row,wbs_test_bank_import_stage_chunk,wbs_test_bank_import_stage;
COMMIT;
