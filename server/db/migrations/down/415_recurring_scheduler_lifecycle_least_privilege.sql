BEGIN;
LOCK TABLE recurring_schedule IN SHARE MODE;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM recurring_schedule) THEN
    RAISE EXCEPTION 'Cannot restore recurring lifecycle view gates with retained schedules' USING ERRCODE='55006';
  END IF;
END; $$;

-- Restoring the old functions would reintroduce redundant view requirements.
COMMIT;