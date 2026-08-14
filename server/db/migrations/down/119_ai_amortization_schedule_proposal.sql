BEGIN;

DO $$
BEGIN
  IF EXISTS(SELECT 1 FROM ai_amortization_schedule) THEN
    RAISE EXCEPTION 'Cannot remove retained AI amortization proposals' USING ERRCODE='55000';
  END IF;
END $$;

DROP FUNCTION refs_propose_ai_amortization_schedule(uuid,uuid,uuid,text,date,date,text,text,jsonb,numeric,text,text,text);
DROP FUNCTION refs_propose_ai_amortization_schedule_hash(uuid,uuid,uuid,text,date,date,text,text,jsonb,numeric,text);
DROP TABLE ai_amortization_schedule_line;
DROP TABLE ai_amortization_schedule;
DELETE FROM permission_catalog WHERE permission_code='AI.AMORTIZATION.PROPOSE';

COMMIT;
