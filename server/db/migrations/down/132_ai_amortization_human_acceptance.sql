BEGIN;
DO $$
BEGIN
  IF EXISTS(SELECT 1 FROM ai_amortization_schedule_acceptance) THEN
    RAISE EXCEPTION 'Cannot remove retained AI amortization acceptances' USING ERRCODE='55000';
  END IF;
END $$;
DROP FUNCTION IF EXISTS refs_accept_ai_amortization_schedule(uuid,uuid,uuid,uuid,uuid,text,text,text);
DROP FUNCTION IF EXISTS refs_accept_ai_amortization_schedule_hash(uuid,uuid,uuid,uuid,uuid,text);
DROP TABLE IF EXISTS ai_amortization_schedule_acceptance;
DELETE FROM permission_catalog WHERE permission_code='AI.AMORTIZATION.ACCEPT';
COMMIT;
