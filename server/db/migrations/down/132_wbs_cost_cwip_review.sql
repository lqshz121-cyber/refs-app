BEGIN;
REVOKE EXECUTE ON FUNCTION refs_review_wbs_cost_cwip(uuid,uuid,uuid,uuid,text,text,text,uuid,uuid,text,text,text),refs_review_wbs_cost_cwip_hash(uuid,uuid,uuid,uuid,text,text,text,uuid,uuid,text),refs_wbs_cost_cwip_review_evidence_hash(uuid,text,text,text,jsonb,jsonb,jsonb,text) FROM refs_app;
DROP FUNCTION IF EXISTS refs_review_wbs_cost_cwip(uuid,uuid,uuid,uuid,text,text,text,uuid,uuid,text,text,text);
DROP FUNCTION IF EXISTS refs_review_wbs_cost_cwip_hash(uuid,uuid,uuid,uuid,text,text,text,uuid,uuid,text);
DROP FUNCTION IF EXISTS refs_wbs_cost_cwip_review_evidence_hash(uuid,text,text,text,jsonb,jsonb,jsonb,text);
DROP TABLE IF EXISTS wbs_cost_cwip_review_evidence;
DELETE FROM permission_catalog WHERE permission_code='WBS.COST.CWIP.REVIEW';
COMMIT;
