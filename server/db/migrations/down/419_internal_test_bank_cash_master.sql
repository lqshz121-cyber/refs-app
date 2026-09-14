BEGIN;

DO $$
BEGIN
  IF EXISTS(
    SELECT 1 FROM cash_transfer_bank_account_control
    WHERE bank_member_ref='INTERNAL_TEST_BANK' OR cash_account_code='111990'
  ) THEN
    RAISE EXCEPTION 'Cannot roll back internal test bank/cash master while a controlled mapping references it' USING ERRCODE='55000';
  END IF;
  IF EXISTS(
    SELECT 1 FROM journal_line
    WHERE member_ref='INTERNAL_TEST_BANK' OR account_code='111990'
  ) THEN
    RAISE EXCEPTION 'Cannot roll back internal test bank/cash master while journal evidence references it' USING ERRCODE='55000';
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION refs_ensure_internal_test_bank_cash_master(uuid,uuid,text) FROM PUBLIC,refs_app;
DROP FUNCTION refs_ensure_internal_test_bank_cash_master(uuid,uuid,text);
DELETE FROM member_master WHERE member_ref='INTERNAL_TEST_BANK' AND member_type='BANK' AND display_name='INTERNAL TEST ONLY Bank';
DELETE FROM account_master WHERE account_code='111990' AND account_name='INTERNAL TEST ONLY Bank Cash' AND requires_member AND required_member_type='BANK';

COMMIT;