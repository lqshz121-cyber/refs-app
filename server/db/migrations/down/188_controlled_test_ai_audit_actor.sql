BEGIN;

DO $migration$
DECLARE definition text;
DECLARE old_fragment constant text:='actor,''SERVICE_ACCOUNT'',''AI.TEST.WORKFLOW''';
DECLARE new_fragment constant text:='actor,''SERVICE'',''AI.TEST.WORKFLOW''';
BEGIN
  IF EXISTS(SELECT 1 FROM source_document WHERE source_module='ai_test_prepaid') THEN
    RAISE EXCEPTION 'Cannot restore the invalid controlled-test AI audit actor after derived evidence exists' USING ERRCODE='55006';
  END IF;
  SELECT pg_get_functiondef('refs_derive_controlled_test_ai_source(uuid,uuid,uuid,text,text,text)'::regprocedure)
    INTO definition;
  IF (length(definition)-length(replace(definition,old_fragment,'')))/length(old_fragment)<>1 THEN
    RAISE EXCEPTION 'Unexpected controlled-test AI source audit actor definition' USING ERRCODE='22023';
  END IF;
  EXECUTE replace(definition,old_fragment,new_fragment);
END $migration$;

COMMIT;
