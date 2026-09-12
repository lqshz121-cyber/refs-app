BEGIN;
DO $$
BEGIN
 IF EXISTS(SELECT 1 FROM cash_transfer) OR EXISTS(SELECT 1 FROM cash_transfer_bank_link) OR EXISTS(SELECT 1 FROM cash_transfer_bank_account_control) THEN
  RAISE EXCEPTION 'Cannot roll back Cash Transfer read surfaces while retained Cash Transfer, bank-link, or bank-control evidence exists' USING ERRCODE='55000';
 END IF;
END $$;
REVOKE EXECUTE ON FUNCTION refs_cash_transfer_control_create_hash(uuid,uuid,text,text,char(3),date,date),refs_cash_transfer_control_approve_hash(uuid,uuid,uuid,bigint),refs_cash_transfer_control_retire_hash(uuid,uuid,uuid,bigint),refs_cash_transfer_bank_link_hash(uuid,uuid,uuid,text,uuid,bigint),refs_read_cash_transfer_create_options(uuid,uuid,uuid,date),refs_read_cash_transfer_detail(uuid,uuid,uuid),refs_read_cash_transfer_register(uuid,uuid,uuid,integer,date,uuid) FROM refs_app;
DROP FUNCTION refs_read_cash_transfer_register(uuid,uuid,uuid,integer,date,uuid);
DROP FUNCTION refs_read_cash_transfer_detail(uuid,uuid,uuid);
DROP FUNCTION refs_read_cash_transfer_create_options(uuid,uuid,uuid,date);
DROP FUNCTION refs_cash_transfer_bank_link_hash(uuid,uuid,uuid,text,uuid,bigint);
DROP FUNCTION refs_cash_transfer_control_retire_hash(uuid,uuid,uuid,bigint);
DROP FUNCTION refs_cash_transfer_control_approve_hash(uuid,uuid,uuid,bigint);
DROP FUNCTION refs_cash_transfer_control_create_hash(uuid,uuid,text,text,char(3),date,date);
COMMIT;