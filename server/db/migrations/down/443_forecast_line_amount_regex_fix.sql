BEGIN;

-- Restores the 388 amount check (double backslash) in refs_create_forecast_workflow.
DO $migration$
DECLARE
  definition text;
  old_check constant text:=$old$line->>'amount'!~'^(0|[1-9][0-9]{0,15})\\.[0-9]{4}$'$old$;
  new_check constant text:=$new$line->>'amount'!~'^(0|[1-9][0-9]{0,15})\.[0-9]{4}$'$new$;
BEGIN
  SELECT pg_get_functiondef('public.refs_create_forecast_workflow(uuid,uuid,uuid,text,text,jsonb,text,text,text)'::regprocedure) INTO definition;
  IF position(new_check IN definition)=0 OR position(new_check IN substr(definition,position(new_check IN definition)+1))>0 THEN
    RAISE EXCEPTION 'Down 443 requires the 443 amount check in refs_create_forecast_workflow' USING ERRCODE='55000';
  END IF;
  EXECUTE replace(definition,new_check,old_check);
END
$migration$;

COMMIT;
