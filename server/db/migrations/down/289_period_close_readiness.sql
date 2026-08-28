BEGIN;
DO $$ BEGIN
  IF EXISTS(SELECT 1 FROM audit_event WHERE event_type='PERIOD_CLOSED_V2') THEN
    RAISE EXCEPTION 'Cannot roll back retained period-close evidence' USING ERRCODE='55000';
  END IF;
END $$;
REVOKE EXECUTE ON FUNCTION refs_read_period_close_readiness(uuid,uuid,uuid),refs_close_period_v2(uuid,uuid,uuid,bigint,text,text,text,text) FROM refs_app;
DROP FUNCTION refs_close_period_v2(uuid,uuid,uuid,bigint,text,text,text,text);
DROP FUNCTION refs_read_period_close_readiness(uuid,uuid,uuid);
GRANT EXECUTE ON FUNCTION refs_close_period(uuid,uuid,uuid,bigint,text,text,text) TO refs_app;
COMMIT;
