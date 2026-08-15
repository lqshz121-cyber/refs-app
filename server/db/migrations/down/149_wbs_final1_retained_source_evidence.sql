BEGIN;
DO $$ BEGIN
  IF EXISTS(SELECT 1 FROM wbs_final1_retained_evidence_admission) THEN
    RAISE EXCEPTION 'Cannot remove retained WBS Final-1 evidence' USING ERRCODE='55000';
  END IF;
END $$;
DROP FUNCTION refs_retain_wbs_final1_source_evidence(uuid,uuid,jsonb,jsonb,jsonb,text,text);
DROP FUNCTION refs_wbs_final1_retained_evidence_hash(uuid,uuid,jsonb,jsonb,jsonb);
DROP TABLE wbs_final1_retained_source_row;
DROP TABLE wbs_final1_retained_evidence_admission;
COMMIT;
