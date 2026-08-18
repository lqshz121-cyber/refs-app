BEGIN;

DO $migration$
DECLARE
  definition text;
  old_fragment constant text:=',''WBS'',''payable'',entity_row.source_entity_id,';
  new_fragment constant text:=',entity_row.source_system,''payable'',entity_row.source_entity_id,';
  occurrences integer;
BEGIN
  SELECT pg_get_functiondef(
    'public.refs_create_wbs_test_payable_draft_v168(uuid,uuid,uuid,jsonb,jsonb,integer,text,text)'::regprocedure
  ) INTO definition;
  occurrences:=(length(definition)-length(replace(definition,new_fragment,'')))/length(new_fragment);
  IF occurrences<>2 THEN
    RAISE EXCEPTION 'Cannot restore unexpected WBS test v168 source-system definition'
      USING ERRCODE='55000';
  END IF;
  definition:=replace(definition,new_fragment,old_fragment);
  EXECUTE definition;
END;
$migration$;

REVOKE ALL ON FUNCTION refs_create_wbs_test_payable_draft_v168(uuid,uuid,uuid,jsonb,jsonb,integer,text,text)
  FROM PUBLIC,refs_app;

COMMIT;
