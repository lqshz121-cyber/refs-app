BEGIN;
LOCK TABLE recurring_schedule IN SHARE MODE;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM recurring_schedule) THEN
    RAISE EXCEPTION 'Cannot remove recurring command payload authority fix with retained schedules' USING ERRCODE='55006';
  END IF;
END; $$;
COMMIT;
