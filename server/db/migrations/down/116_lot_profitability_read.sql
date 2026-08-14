BEGIN;
REVOKE EXECUTE ON FUNCTION refs_get_lot_profitability(uuid,uuid,uuid,text) FROM refs_app;
DROP FUNCTION refs_get_lot_profitability(uuid,uuid,uuid,text);
COMMIT;
