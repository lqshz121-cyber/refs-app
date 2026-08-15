BEGIN;
REVOKE EXECUTE ON FUNCTION refs_create_wbs_cost_cwip_draft(uuid,uuid,uuid,text,text,text,text),refs_create_wbs_cost_cwip_draft_hash(uuid,uuid,uuid,text,text) FROM refs_app;
DROP FUNCTION refs_create_wbs_cost_cwip_draft(uuid,uuid,uuid,text,text,text,text);
DROP FUNCTION refs_create_wbs_cost_cwip_draft_hash(uuid,uuid,uuid,text,text);
DELETE FROM permission_catalog WHERE permission_code='WBS.COST.CWIP.DRAFT';
COMMIT;
