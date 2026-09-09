BEGIN;
DROP TRIGGER fixed_asset_acquisition_post_guard ON journal_entry;
DROP FUNCTION refs_guard_bound_asset_acquisition_post();
DROP FUNCTION refs_create_fixed_asset_acquisition(uuid,uuid,uuid,uuid,text,date,bigint,uuid[],text,text,text);
DROP FUNCTION refs_create_fixed_asset_acquisition_hash(uuid,uuid,uuid,uuid,text,date,bigint,uuid[],text);
DROP FUNCTION refs_asset_acquisition_journal_snapshot(uuid,uuid,uuid);
DROP TABLE fixed_asset_acquisition_posting;
DROP TABLE fixed_asset_acquisition_binding;
COMMIT;
