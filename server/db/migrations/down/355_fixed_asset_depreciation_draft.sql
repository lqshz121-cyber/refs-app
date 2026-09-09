BEGIN;
LOCK TABLE journal_entry,fixed_asset_depreciation_binding,fixed_asset_depreciation_posting IN ACCESS EXCLUSIVE MODE;
DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM fixed_asset_depreciation_binding) OR EXISTS(SELECT 1 FROM fixed_asset_depreciation_posting) THEN RAISE EXCEPTION 'Cannot remove fixed asset depreciation schema while business evidence exists' USING ERRCODE='55000';END IF;
END;$$;
DROP TRIGGER fixed_asset_depreciation_post_guard ON journal_entry;
DROP FUNCTION refs_guard_bound_fixed_asset_depreciation_post();
DROP FUNCTION refs_read_fixed_asset_depreciation_options(uuid,uuid,uuid,uuid);
DROP FUNCTION refs_create_fixed_asset_depreciation(uuid,uuid,uuid,uuid,text,date,text,text,text,text,text);
DROP FUNCTION refs_create_fixed_asset_depreciation_hash(uuid,uuid,uuid,uuid,text,date,text,text,text);
DROP FUNCTION refs_asset_depreciation_journal_snapshot(uuid,uuid,uuid);
DROP FUNCTION refs_validate_fixed_asset_depreciation_ready(uuid,uuid,uuid,uuid,date);
DROP FUNCTION refs_fixed_asset_depreciation_schedule_snapshot(uuid,uuid,uuid,uuid);
DROP TABLE fixed_asset_depreciation_posting;
DROP TABLE fixed_asset_depreciation_binding;
UPDATE permission_catalog SET active=false,effective_to=COALESCE(effective_to,clock_timestamp()),version=version+1 WHERE permission_code='FIXED_ASSET.DEPRECIATION.DRAFT';
COMMIT;
