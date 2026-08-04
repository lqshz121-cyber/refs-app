BEGIN;

REVOKE EXECUTE ON FUNCTION refs_record_wbs_snapshot_receipts(uuid,uuid,uuid,timestamptz,text,text,text,jsonb,text,text) FROM refs_app;
REVOKE EXECUTE ON FUNCTION refs_wbs_snapshot_import_hash(uuid,uuid,uuid,timestamptz,text,text,text,jsonb) FROM refs_app;
DROP FUNCTION IF EXISTS refs_record_wbs_snapshot_receipts(uuid,uuid,uuid,timestamptz,text,text,text,jsonb,text,text);
DROP FUNCTION IF EXISTS refs_wbs_snapshot_import_hash(uuid,uuid,uuid,timestamptz,text,text,text,jsonb);
DROP TABLE IF EXISTS wbs_snapshot_receipt;
DROP TABLE IF EXISTS wbs_snapshot_import;
DELETE FROM permission_catalog WHERE permission_code='WBS.SNAPSHOT.IMPORT';

COMMIT;
