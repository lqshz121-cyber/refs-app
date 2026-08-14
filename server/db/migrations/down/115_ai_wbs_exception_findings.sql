BEGIN;

DO $$
BEGIN
  IF EXISTS(SELECT 1 FROM ai_finding) THEN
    RAISE EXCEPTION 'Cannot remove persisted AI findings' USING ERRCODE='55000';
  END IF;
END $$;

DROP TRIGGER materialize_ai_wbs_exception_finding ON wbs_operator_payable_evidence_row;
DROP FUNCTION refs_read_ai_wbs_exception_findings(uuid,uuid,integer);
DROP FUNCTION refs_materialize_ai_wbs_exception_finding_trigger();
DROP FUNCTION refs_materialize_ai_wbs_exception_finding(uuid);
DROP TABLE ai_finding;

COMMIT;
