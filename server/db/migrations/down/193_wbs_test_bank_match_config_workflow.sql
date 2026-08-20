BEGIN;

DO $$ BEGIN
  IF EXISTS(SELECT 1 FROM setting_snapshot WHERE family='BANK' AND snapshot->>'schema_version'='WBS_TEST_BANK_MATCH_SETTING_V1')
    OR EXISTS(SELECT 1 FROM mapping_snapshot WHERE family='BANK' AND input_keys->>'schema_version'='WBS_TEST_BANK_MATCH_MAPPING_INPUT_V1') THEN
    RAISE EXCEPTION 'Cannot remove migration 193 while controlled test Bank Match configuration evidence exists' USING ERRCODE='55006';
  END IF;
END $$;

REVOKE EXECUTE ON FUNCTION refs_approve_wbs_test_bank_match_config(uuid,uuid,uuid,uuid) FROM refs_app;
REVOKE EXECUTE ON FUNCTION refs_propose_wbs_test_bank_match_config(uuid,uuid) FROM refs_app;
DROP FUNCTION refs_approve_wbs_test_bank_match_config(uuid,uuid,uuid,uuid);
DROP FUNCTION refs_propose_wbs_test_bank_match_config(uuid,uuid);

COMMIT;
