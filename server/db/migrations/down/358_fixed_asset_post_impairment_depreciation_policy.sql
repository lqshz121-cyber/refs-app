BEGIN;
LOCK TABLE fixed_asset_post_impairment_depreciation_policy IN ACCESS EXCLUSIVE MODE;
DO $$BEGIN
 IF EXISTS(SELECT 1 FROM fixed_asset_post_impairment_depreciation_policy) THEN RAISE EXCEPTION 'Cannot remove retained post-impairment depreciation policy evidence' USING ERRCODE='55000';END IF;
END$$;
REVOKE ALL ON FUNCTION refs_review_fixed_asset_post_impairment_policy_hash(uuid,uuid,uuid,uuid,uuid,integer,text,text),refs_review_fixed_asset_post_impairment_policy(uuid,uuid,uuid,uuid,uuid,integer,text,text,text,text) FROM PUBLIC,refs_app;
DROP FUNCTION refs_review_fixed_asset_post_impairment_policy(uuid,uuid,uuid,uuid,uuid,integer,text,text,text,text);
DROP FUNCTION refs_review_fixed_asset_post_impairment_policy_hash(uuid,uuid,uuid,uuid,uuid,integer,text,text);
DROP TABLE fixed_asset_post_impairment_depreciation_policy;
UPDATE permission_catalog SET active=false,effective_to=clock_timestamp(),version=version+1 WHERE permission_code='FIXED_ASSET.DEPRECIATION.POLICY.REVIEW';
COMMIT;
