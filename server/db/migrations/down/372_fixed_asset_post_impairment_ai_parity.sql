BEGIN;

DO $$
DECLARE source_definition text;reconciliation_definition text;restored_definition text;
BEGIN
 IF to_regprocedure('refs_read_ai_fixed_asset_depreciation_source_pre_372(uuid,uuid,uuid)') IS NULL OR to_regprocedure('refs_read_ai_fixed_asset_posted_reconciliation_pre_372(uuid,uuid,uuid)') IS NULL THEN RAISE EXCEPTION 'Retained fixed asset AI functions are unavailable' USING ERRCODE='55000';END IF;
 source_definition:=pg_get_functiondef('refs_read_ai_fixed_asset_depreciation_source(uuid,uuid,uuid)'::regprocedure);
 reconciliation_definition:=pg_get_functiondef('refs_read_ai_fixed_asset_posted_reconciliation(uuid,uuid,uuid)'::regprocedure);
 IF source_definition NOT LIKE '%AI_FIXED_ASSET_DEPRECIATION_SOURCE_V2%' OR source_definition NOT LIKE '%refs_fixed_asset_depreciation_schedule_snapshot%' THEN RAISE EXCEPTION 'Refusing to overwrite an unexpected fixed asset depreciation AI source' USING ERRCODE='55000';END IF;
 IF reconciliation_definition NOT LIKE '%AI_FIXED_ASSET_POSTED_RECONCILIATION_V2%' OR reconciliation_definition NOT LIKE '%post_impairment_policy_identity%' THEN RAISE EXCEPTION 'Refusing to overwrite an unexpected fixed asset depreciation AI reconciliation' USING ERRCODE='55000';END IF;
 source_definition:=pg_get_functiondef('refs_read_ai_fixed_asset_depreciation_source_pre_372(uuid,uuid,uuid)'::regprocedure);
 restored_definition:=replace(source_definition,'public.refs_read_ai_fixed_asset_depreciation_source_pre_372(','public.refs_read_ai_fixed_asset_depreciation_source(');
 IF restored_definition=source_definition OR restored_definition LIKE '%AI_FIXED_ASSET_DEPRECIATION_SOURCE_V2%' THEN RAISE EXCEPTION 'Retained fixed asset depreciation AI source is not the 353 boundary' USING ERRCODE='55000';END IF;
 EXECUTE restored_definition;
 reconciliation_definition:=pg_get_functiondef('refs_read_ai_fixed_asset_posted_reconciliation_pre_372(uuid,uuid,uuid)'::regprocedure);
 restored_definition:=replace(reconciliation_definition,'public.refs_read_ai_fixed_asset_posted_reconciliation_pre_372(','public.refs_read_ai_fixed_asset_posted_reconciliation(');
 IF restored_definition=reconciliation_definition OR restored_definition LIKE '%AI_FIXED_ASSET_POSTED_RECONCILIATION_V2%' THEN RAISE EXCEPTION 'Retained fixed asset depreciation AI reconciliation is not the 354 boundary' USING ERRCODE='55000';END IF;
 EXECUTE restored_definition;
END $$;

DROP FUNCTION refs_read_ai_fixed_asset_depreciation_source_pre_372(uuid,uuid,uuid);
DROP FUNCTION refs_read_ai_fixed_asset_posted_reconciliation_pre_372(uuid,uuid,uuid);
REVOKE EXECUTE ON FUNCTION refs_read_ai_fixed_asset_depreciation_source(uuid,uuid,uuid),refs_read_ai_fixed_asset_posted_reconciliation(uuid,uuid,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION refs_read_ai_fixed_asset_depreciation_source(uuid,uuid,uuid),refs_read_ai_fixed_asset_posted_reconciliation(uuid,uuid,uuid) TO refs_app;

COMMIT;
