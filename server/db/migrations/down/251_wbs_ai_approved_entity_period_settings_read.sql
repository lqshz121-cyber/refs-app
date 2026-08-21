BEGIN;
DO $$ BEGIN
  IF EXISTS(SELECT 1 FROM runtime_actor_grant WHERE permission='AI.ACCOUNTING.SETTINGS.VIEW') THEN
    RAISE EXCEPTION 'Cannot remove AI settings-view permission while grants remain' USING ERRCODE='55006';
  END IF;
END $$;
DROP FUNCTION refs_read_wbs_ai_approved_entity_period_settings(uuid,uuid,uuid);
DROP FUNCTION refs_wbs_ai_settings_dates_are_valid(jsonb);
UPDATE permission_catalog SET active=false,effective_to=COALESCE(effective_to,clock_timestamp()),version=version+1 WHERE permission_code='AI.ACCOUNTING.SETTINGS.VIEW' AND active=true;
COMMIT;
