BEGIN;
DROP FUNCTION IF EXISTS refs_read_ai_fixed_asset_impairment_assessments(uuid,uuid,uuid);DROP FUNCTION IF EXISTS refs_review_fixed_asset_impairment(uuid,uuid,uuid,uuid,uuid,date,numeric,text,text,text,text,text);DROP FUNCTION IF EXISTS refs_review_fixed_asset_impairment_hash(uuid,uuid,uuid,uuid,uuid,date,numeric,text,text,text);DROP TABLE IF EXISTS fixed_asset_impairment_assessment_evidence;DELETE FROM permission_catalog WHERE permission_code IN('FIXED_ASSET.IMPAIRMENT.REVIEW','FIXED_ASSET.IMPAIRMENT.VIEW');
COMMIT;
