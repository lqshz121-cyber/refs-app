BEGIN;
DROP FUNCTION refs_read_fixed_asset_register(uuid,uuid,date,integer,uuid,uuid);
DROP INDEX fixed_asset_ledger_scope_dimension;
DROP INDEX fixed_asset_register_scope_page;
COMMIT;
