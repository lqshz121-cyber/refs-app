BEGIN;

REVOKE EXECUTE ON FUNCTION refs_list_reconciliation_worksheet(uuid,uuid,uuid) FROM refs_app;
DROP FUNCTION refs_list_reconciliation_worksheet(uuid,uuid,uuid);
ALTER FUNCTION refs_list_reconciliation_worksheet_117(uuid,uuid,uuid)
  RENAME TO refs_list_reconciliation_worksheet;
GRANT EXECUTE ON FUNCTION refs_list_reconciliation_worksheet(uuid,uuid,uuid) TO refs_app;

COMMIT;
