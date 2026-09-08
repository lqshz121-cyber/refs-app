BEGIN;
DROP FUNCTION refs_list_bank_transactions_v2(uuid,uuid,text,date,date,integer,integer);
DROP FUNCTION refs_list_reconciliation_worksheet_v2(uuid,uuid,uuid);
DROP FUNCTION refs_get_reconciliation_worksheet_item_v2(uuid,uuid,uuid,uuid);
COMMIT;
