BEGIN;

-- Migration 176 used an actor type that has never been part of the core
-- audit_event contract.  Correct only the private TEST_ONLY source bridge;
-- do not widen the global audit actor allowlist.
DO $migration$
DECLARE definition text;
DECLARE old_fragment constant text:='actor,''SERVICE'',''AI.TEST.WORKFLOW''';
DECLARE new_fragment constant text:='actor,''SERVICE_ACCOUNT'',''AI.TEST.WORKFLOW''';
BEGIN
  SELECT pg_get_functiondef('refs_derive_controlled_test_ai_source(uuid,uuid,uuid,text,text,text)'::regprocedure)
    INTO definition;
  IF (length(definition)-length(replace(definition,old_fragment,'')))/length(old_fragment)<>1 THEN
    RAISE EXCEPTION 'Unexpected controlled-test AI source audit actor definition' USING ERRCODE='22023';
  END IF;
  EXECUTE replace(definition,old_fragment,new_fragment);
END $migration$;

COMMIT;
