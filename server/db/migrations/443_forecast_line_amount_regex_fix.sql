BEGIN;

-- R12 follow-up (found by the 441 forecast end-to-end test, 2026-09-25).
--
-- 388 validates a forecast line amount with '^(0|[1-9][0-9]{0,15})\\.[0-9]{4}$' in an ordinary
-- (standard_conforming_strings) literal, so the regex receives a double backslash: an escaped
-- backslash followed by any character. Every canonical amount such as 150.0000 is rejected with
-- "Forecast lines must bind approved budget and posted actual evidence", so no forecast Draft can
-- be created. 413 repaired the identical defect in the recurring scheduler; this is the same fix.
-- Fail-closed: refuses unless the exact 388 text is present exactly once.
DO $migration$
DECLARE
  definition text;
  old_check constant text:=$old$line->>'amount'!~'^(0|[1-9][0-9]{0,15})\\.[0-9]{4}$'$old$;
  new_check constant text:=$new$line->>'amount'!~'^(0|[1-9][0-9]{0,15})\.[0-9]{4}$'$new$;
BEGIN
  SELECT pg_get_functiondef('public.refs_create_forecast_workflow(uuid,uuid,uuid,text,text,jsonb,text,text,text)'::regprocedure) INTO definition;
  IF position(old_check IN definition)=0 OR position(old_check IN substr(definition,position(old_check IN definition)+1))>0 THEN
    RAISE EXCEPTION 'Migration 443 requires the exact 388 amount check in refs_create_forecast_workflow' USING ERRCODE='55000';
  END IF;
  EXECUTE replace(definition,old_check,new_check);
END
$migration$;

COMMIT;
