BEGIN;

REVOKE EXECUTE ON FUNCTION refs_admit_wbs_signed_bank_statement(uuid,uuid,uuid,text,text,text,text,jsonb,jsonb,text,text) FROM refs_app;
REVOKE EXECUTE ON FUNCTION refs_wbs_signed_bank_admission_hash(uuid,uuid,uuid,text,text,text,text,jsonb,jsonb) FROM refs_app;
DROP FUNCTION refs_admit_wbs_signed_bank_statement(uuid,uuid,uuid,text,text,text,text,jsonb,jsonb,text,text);
DROP FUNCTION refs_wbs_signed_bank_admission_hash(uuid,uuid,uuid,text,text,text,text,jsonb,jsonb);
DROP TABLE wbs_bank_statement_transaction;
DROP TABLE wbs_bank_statement_receipt;
DROP INDEX wbs_snapshot_receipt_tenant_entity_id_uq;
DELETE FROM permission_catalog WHERE permission_code='WBS.BANK.ADMIT';

COMMIT;
