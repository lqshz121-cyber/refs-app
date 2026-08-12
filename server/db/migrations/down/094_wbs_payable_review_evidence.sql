BEGIN;

REVOKE EXECUTE ON FUNCTION refs_review_wbs_payable(uuid,uuid,uuid,uuid,bigint,text,text,text,uuid,uuid,uuid[],text,text,text) FROM refs_app;
REVOKE EXECUTE ON FUNCTION refs_review_wbs_payable_hash(uuid,uuid,uuid,uuid,bigint,text,text,text,uuid,uuid,uuid[],text) FROM refs_app;
REVOKE EXECUTE ON FUNCTION refs_wbs_payable_review_evidence_hash(uuid,text,text,text,jsonb,jsonb,jsonb,text) FROM refs_app;
DROP FUNCTION refs_review_wbs_payable(uuid,uuid,uuid,uuid,bigint,text,text,text,uuid,uuid,uuid[],text,text,text);
DROP FUNCTION refs_review_wbs_payable_hash(uuid,uuid,uuid,uuid,bigint,text,text,text,uuid,uuid,uuid[],text);
DROP FUNCTION refs_wbs_payable_review_evidence_hash(uuid,text,text,text,jsonb,jsonb,jsonb,text);
DROP TABLE wbs_payable_review_attachment;
DROP TABLE wbs_payable_review_evidence;
DROP INDEX attachment_tenant_entity_id_uq;
DROP INDEX wbs_inbound_row_tenant_entity_id_uq;
DROP INDEX wbs_inbound_receipt_tenant_entity_id_uq;
DELETE FROM permission_catalog WHERE permission_code='WBS.PAYABLE.REVIEW';

COMMIT;
