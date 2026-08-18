BEGIN;

-- JSONB preserves numeric values as numbers.  The public Source Document DTO
-- requires fixed-scale accounting text, so emit the stored NUMERIC value as
-- text at the SQL projection boundary without changing retained evidence.
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
  occurrences:=(length(definition)-length(replace(definition,old_fragment,'')))/length(old_fragment);
  IF occurrences<>1 THEN
    RAISE EXCEPTION 'Unexpected Source Document detail amount projection'
      USING ERRCODE='22023';
  END IF;
  definition:=replace(definition,old_fragment,new_fragment);
  EXECUTE definition;
END;
$migration$;

REVOKE ALL ON FUNCTION refs_get_source_document_detail(uuid,uuid,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION refs_get_source_document_detail(uuid,uuid,uuid) TO refs_app;

COMMIT;
