BEGIN;

DO $$ BEGIN
  IF EXISTS(SELECT 1 FROM wbs_autorec_g11_completion) THEN
    RAISE EXCEPTION 'Cannot remove retained G11 completion evidence';
  END IF;
END $$;

DROP FUNCTION IF EXISTS refs_get_wbs_autorec_g11_evidence(uuid,uuid,uuid);
DROP FUNCTION IF EXISTS refs_finalize_wbs_autorec_g11_incur(uuid,uuid,uuid,text,text,text,text);
DROP FUNCTION IF EXISTS refs_wbs_autorec_g11_incur_hash(uuid,uuid,uuid,text,text);
DROP TABLE IF EXISTS wbs_autorec_g11_completion_line;
DROP TABLE IF EXISTS wbs_autorec_g11_completion;
ALTER TABLE wbs_autorec_execution_event DROP CONSTRAINT IF EXISTS wbs_autorec_execution_event_transition_check;
ALTER TABLE wbs_autorec_execution_event DROP CONSTRAINT wbs_autorec_execution_event_command_check;
ALTER TABLE wbs_autorec_execution_event DROP CONSTRAINT wbs_autorec_execution_event_current_state_check;
ALTER TABLE wbs_autorec_execution_event DROP CONSTRAINT wbs_autorec_execution_event_next_state_check;
ALTER TABLE wbs_autorec_execution_event ADD CONSTRAINT wbs_autorec_execution_event_command_check CHECK(command IN ('RESERVE','RELEASE'));
ALTER TABLE wbs_autorec_execution_event ADD CONSTRAINT wbs_autorec_execution_event_current_state_check CHECK(current_state IN ('REVIEW_REQUIRED','RESERVED'));
ALTER TABLE wbs_autorec_execution_event ADD CONSTRAINT wbs_autorec_execution_event_next_state_check CHECK(next_state IN ('RESERVED','RELEASED'));
UPDATE permission_catalog SET active=false,version=version+1,effective_to=clock_timestamp() WHERE permission_code='BANK.AUTOREC.G11.INCUR';

COMMIT;
