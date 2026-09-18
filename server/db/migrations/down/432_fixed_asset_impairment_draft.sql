BEGIN;
DROP FUNCTION IF EXISTS refs_create_fixed_asset_impairment_draft(uuid,uuid,uuid,text,date,text,text,uuid[],text,text);
DROP FUNCTION IF EXISTS refs_create_fixed_asset_impairment_draft_hash(uuid,uuid,uuid,text,date,text,text,uuid[]);
DROP TABLE IF EXISTS fixed_asset_impairment_draft_binding;
DELETE FROM runtime_human_permission_authority WHERE permission_code='FIXED_ASSET.IMPAIRMENT.DRAFT';
UPDATE permission_catalog SET active=false,effective_to=clock_timestamp() WHERE permission_code='FIXED_ASSET.IMPAIRMENT.DRAFT';
COMMIT;
