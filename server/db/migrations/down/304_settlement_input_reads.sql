BEGIN;
REVOKE ALL ON FUNCTION refs_read_settlement_context(uuid,uuid,text,uuid,uuid) FROM refs_app;
REVOKE ALL ON FUNCTION refs_read_settlement_bank_members(uuid,uuid,text,text,text,integer) FROM refs_app;
DROP FUNCTION refs_read_settlement_context(uuid,uuid,text,uuid,uuid);
DROP FUNCTION refs_read_settlement_bank_members(uuid,uuid,text,text,text,integer);
COMMIT;
