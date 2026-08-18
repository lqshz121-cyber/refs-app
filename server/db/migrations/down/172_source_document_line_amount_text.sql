BEGIN;

DO $migration$
DECLARE
  definition text;
  old_fragment constant text:='''amount'',l.amount,''direction''';
  new_fragment constant text:='''amount'',l.amount::text,''direction''';
  occurrences integer;
BEGIN
  SELECT pg_get_functiondef(
    'public.refs_get_source_document_detail(uuid,uuid,uuid)'::regprocedure
  ) INTO definition;
  occurrences:=(length(definition)-length(replace(definition,new_fragment,'')))/length(new_fragment);
  IF occurrences<>1 THEN
    RAISE EXCEPTION 'Cannot restore unexpected Source Document detail amount projection'
      USING ERRCODE='55000';
  END IF;
  definition:=replace(definition,new_fragment,old_fragment);
  EXECUTE definition;
END;
$migration$;

REVOKE ALL ON FUNCTION refs_get_source_document_detail(uuid,uuid,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION refs_get_source_document_detail(uuid,uuid,uuid) TO refs_app;

COMMIT;
