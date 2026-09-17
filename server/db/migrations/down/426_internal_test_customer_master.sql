BEGIN;

DO $$
BEGIN
  IF EXISTS(SELECT 1 FROM journal_line WHERE member_ref='INTERNAL_TEST_CUSTOMER') THEN
    RAISE EXCEPTION 'Cannot roll back internal test customer master while journal evidence references it' USING ERRCODE='55000';
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION refs_ensure_internal_test_customer_master(uuid,uuid,text) FROM PUBLIC,refs_app;
DROP FUNCTION refs_ensure_internal_test_customer_master(uuid,uuid,text);
DELETE FROM member_master WHERE member_ref='INTERNAL_TEST_CUSTOMER' AND member_type='CUSTOMER' AND display_name='INTERNAL TEST ONLY Customer';

COMMIT;
