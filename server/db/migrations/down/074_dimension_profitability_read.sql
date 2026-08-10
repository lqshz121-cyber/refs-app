BEGIN;

REVOKE EXECUTE ON FUNCTION refs_get_dimension_profitability(uuid,uuid,uuid,text,text) FROM refs_app;
DROP FUNCTION refs_get_dimension_profitability(uuid,uuid,uuid,text,text);
DROP INDEX ledger_line_dimension_profitability_gin_idx;

COMMIT;
