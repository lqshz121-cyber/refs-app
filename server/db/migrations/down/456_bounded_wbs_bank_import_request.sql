-- Bounded human Bank import request; distinct from service execution.
BEGIN;
DO $$ BEGIN
  IF EXISTS(SELECT 1 FROM runtime_actor_grant WHERE permission='WBS.TEST.BANK.IMPORT.REQUEST') THEN
    RAISE EXCEPTION 'Retained Bank request grants prevent rollback' USING ERRCODE='55000';
  END IF;
END $$;
DROP FUNCTION refs_assert_bounded_wbs_bank_import_request(uuid,uuid,uuid,text,date,date,integer);
DROP FUNCTION refs_bounded_wbs_bank_request_ready();
DELETE FROM runtime_human_permission_authority WHERE permission_code='WBS.TEST.BANK.IMPORT.REQUEST';
UPDATE permission_catalog SET active=false,effective_to=COALESCE(effective_to,clock_timestamp()),version=version+1
WHERE permission_code='WBS.TEST.BANK.IMPORT.REQUEST' AND active;
COMMIT;
