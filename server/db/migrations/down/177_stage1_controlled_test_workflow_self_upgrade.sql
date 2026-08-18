BEGIN;
REVOKE ALL ON FUNCTION refs_upgrade_stage1_controlled_test_workflow(uuid,text,uuid,text,text,bigint) FROM refs_grant_sync;
DROP FUNCTION IF EXISTS refs_upgrade_stage1_controlled_test_workflow(uuid,text,uuid,text,text,bigint);
COMMIT;
