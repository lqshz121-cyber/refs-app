BEGIN;

REVOKE EXECUTE ON FUNCTION refs_get_financial_statements(uuid,uuid,uuid) FROM refs_app;
DROP FUNCTION refs_get_financial_statements(uuid,uuid,uuid);
DROP INDEX journal_entry_posted_report_scope_idx;
DROP INDEX ledger_line_financial_statement_scope_idx;
UPDATE permission_catalog
SET active=false,effective_to=COALESCE(effective_to,now()),version=version+1
WHERE permission_code='GL.REPORT.VIEW';

COMMIT;
