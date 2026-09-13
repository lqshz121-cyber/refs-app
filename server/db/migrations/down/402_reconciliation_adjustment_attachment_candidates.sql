BEGIN;

REVOKE ALL ON FUNCTION refs_read_reconciliation_adjustment_attachment_candidates(uuid,uuid,integer) FROM refs_app;
DROP FUNCTION refs_read_reconciliation_adjustment_attachment_candidates(uuid,uuid,integer);

COMMIT;
