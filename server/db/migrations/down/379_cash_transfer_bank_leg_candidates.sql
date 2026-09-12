BEGIN;
DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM cash_transfer) OR EXISTS(SELECT 1 FROM cash_transfer_bank_link) OR EXISTS(SELECT 1 FROM cash_transfer_bank_account_control) THEN
  RAISE EXCEPTION 'Cannot roll back Cash Transfer bank-leg candidates while retained Cash Transfer evidence exists' USING ERRCODE='55000';
 END IF;
END $$;
REVOKE EXECUTE ON FUNCTION refs_read_cash_transfer_bank_leg_candidates(uuid,uuid,uuid,text,integer,text,uuid) FROM refs_app;
DROP FUNCTION refs_read_cash_transfer_bank_leg_candidates(uuid,uuid,uuid,text,integer,text,uuid);
COMMIT;
