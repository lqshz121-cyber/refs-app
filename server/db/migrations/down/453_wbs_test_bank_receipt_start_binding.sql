BEGIN;
DROP FUNCTION refs_start_wbs_test_bank_reconciliation(uuid,uuid,uuid,text,text);
ALTER FUNCTION refs_start_wbs_test_bank_reconciliation_453(uuid,uuid,uuid,text,text)
  RENAME TO refs_start_wbs_test_bank_reconciliation;
GRANT EXECUTE ON FUNCTION refs_start_wbs_test_bank_reconciliation(uuid,uuid,uuid,text,text) TO refs_app;
COMMIT;
