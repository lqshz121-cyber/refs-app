BEGIN;

REVOKE EXECUTE ON FUNCTION refs_list_bank_transactions(uuid,uuid,text,date,date,integer) FROM refs_app;
REVOKE EXECUTE ON FUNCTION refs_get_reconciliation_summary(uuid,uuid,text,date) FROM refs_app;
DROP FUNCTION refs_list_bank_transactions(uuid,uuid,text,date,date,integer);
DROP FUNCTION refs_get_reconciliation_summary(uuid,uuid,text,date);
DROP INDEX reconciliation_reconciled_cutoff_idx;
DROP INDEX reconciliation_live_read_scope_idx;
DROP INDEX bank_source_read_scope_idx;
UPDATE permission_catalog
SET active=false,effective_to=COALESCE(effective_to,now()),version=version+1
WHERE permission_code='BANK.VIEW';

COMMIT;
