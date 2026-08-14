BEGIN;

DO $$
BEGIN
  IF EXISTS(SELECT 1 FROM ai_amortization_coverage_evidence) THEN
    RAISE EXCEPTION 'Cannot remove retained AI amortization coverage evidence' USING ERRCODE='55000';
  END IF;
END $$;

DROP FUNCTION refs_record_ai_amortization_coverage_evidence(uuid,uuid,uuid,text,date,date,text,text,text,text,text);
DROP FUNCTION refs_ai_amortization_coverage_evidence_hash(uuid,uuid,uuid,text,date,date,text,text,text);
DROP TABLE ai_amortization_coverage_evidence;

COMMIT;
