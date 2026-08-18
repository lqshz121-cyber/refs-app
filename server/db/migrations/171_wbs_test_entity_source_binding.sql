BEGIN;

-- Keep the Stage-1 entity binding authoritative. Patch only the private
-- TEST_ONLY v168 writer so its child rows use their FK parent's source system.
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
  occurrences:=(length(definition)-length(replace(definition,old_fragment,'')))/length(old_fragment);
  IF occurrences<>2 THEN
    RAISE EXCEPTION 'Unexpected WBS test v168 source-system definition'
      USING ERRCODE='22023';
  END IF;
  definition:=replace(definition,old_fragment,new_fragment);
  EXECUTE definition;
END;
$migration$;

REVOKE ALL ON FUNCTION refs_create_wbs_test_payable_draft_v168(uuid,uuid,uuid,jsonb,jsonb,integer,text,text)
  FROM PUBLIC,refs_app;

COMMIT;
