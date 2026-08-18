BEGIN;

DO $$
BEGIN
  IF EXISTS(SELECT 1 FROM controlled_test_ai_source) THEN
    RAISE EXCEPTION 'Cannot remove controlled-test AI workflow after derived evidence exists' USING ERRCODE='55000';
  END IF;
END $$;

DO $migration$
DECLARE definition text;
DECLARE old_fragment constant text:='description:=CASE WHEN EXISTS(SELECT 1 FROM controlled_test_ai_source c WHERE c.tenant_id=p_tenant AND c.entity_id=p_entity AND c.derived_source_document_id=source.source_document_id AND c.test_only AND c.provenance_mode=''UNSIGNED_TEST_ONLY'') THEN ''UNSIGNED TEST ONLY AI amortization for '' ELSE ''Human-reviewed AI amortization for '' END||to_char(schedule_line.amortization_month,''YYYY-MM'');';
DECLARE new_fragment constant text:='description:=''Human-reviewed AI amortization for ''||to_char(schedule_line.amortization_month,''YYYY-MM'');';
BEGIN
  SELECT pg_get_functiondef('refs_create_ai_amortization_draft(uuid,uuid,uuid,uuid,uuid,text,uuid[],text,text,text)'::regprocedure) INTO definition;
  IF (length(definition)-length(replace(definition,old_fragment,'')))/length(old_fragment)<>1 THEN
    RAISE EXCEPTION 'Unexpected controlled-test AI Draft definition' USING ERRCODE='22023';
  END IF;
  EXECUTE replace(definition,old_fragment,new_fragment);
END $migration$;

REVOKE ALL ON FUNCTION refs_derive_controlled_test_ai_source_hash(uuid,uuid,uuid,text),
  refs_derive_controlled_test_ai_source(uuid,uuid,uuid,text,text,text) FROM PUBLIC,refs_app;
DROP FUNCTION refs_derive_controlled_test_ai_source(uuid,uuid,uuid,text,text,text);
DROP FUNCTION refs_derive_controlled_test_ai_source_hash(uuid,uuid,uuid,text);
DROP TABLE controlled_test_ai_source;
DELETE FROM runtime_actor_grant WHERE permission='AI.TEST.WORKFLOW';
DELETE FROM permission_catalog WHERE permission_code='AI.TEST.WORKFLOW';

COMMIT;
