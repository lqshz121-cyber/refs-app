BEGIN;
DROP FUNCTION refs_list_expenses(uuid,uuid,uuid,uuid,integer);
DROP FUNCTION refs_read_expense(uuid,uuid,uuid);
DROP INDEX expense_period_id_idx;
DROP VIEW expense_detail_read;
COMMIT;
