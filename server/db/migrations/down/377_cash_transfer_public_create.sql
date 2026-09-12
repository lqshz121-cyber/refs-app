BEGIN;
DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM cash_transfer) OR EXISTS(SELECT 1 FROM cash_transfer_bank_link) OR EXISTS(SELECT 1 FROM cash_transfer_bank_account_control) THEN RAISE EXCEPTION 'Cannot roll back Cash Transfer public create wrapper while retained Cash Transfer evidence exists' USING ERRCODE='55000'; END IF;
END $$;
REVOKE EXECUTE ON FUNCTION refs_create_cash_transfer_from_public_dto(uuid,uuid,uuid,date,text,char(3),text,text,text,text,numeric,uuid[],text,text) FROM refs_app;
DROP FUNCTION refs_create_cash_transfer_from_public_dto(uuid,uuid,uuid,date,text,char(3),text,text,text,text,numeric,uuid[],text,text);
COMMIT;