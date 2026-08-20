BEGIN;
DROP FUNCTION IF EXISTS refs_read_ai_reviewed_fixed_asset_disposals(uuid,uuid,uuid);
DROP FUNCTION IF EXISTS refs_review_fixed_asset_disposal(uuid,uuid,uuid,uuid,uuid,date,numeric,numeric,text,text,text);
DROP FUNCTION IF EXISTS refs_review_fixed_asset_disposal_hash(uuid,uuid,uuid,uuid,uuid,date,numeric,numeric,text);
DROP TABLE IF EXISTS fixed_asset_disposal_evidence;
DELETE FROM permission_catalog WHERE permission_code IN('FIXED_ASSET.DISPOSAL.REVIEW','FIXED_ASSET.DISPOSAL.VIEW');
COMMIT;
