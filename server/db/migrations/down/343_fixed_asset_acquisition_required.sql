BEGIN;
DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM fixed_asset_acquisition_binding) THEN
  RAISE EXCEPTION 'Retained acquisition bindings prevent removal of mandatory posting control' USING ERRCODE='55006';
 END IF;
END;$$;
DROP TRIGGER fixed_asset_acquisition_required_guard ON journal_entry;
DROP FUNCTION refs_require_asset_acquisition_on_post();
COMMIT;
