BEGIN;

DO $migration$
DECLARE definition text;
BEGIN
  SELECT pg_get_functiondef('public.refs_read_wbs_h1_import_inventory(uuid,uuid,integer,integer)'::regprocedure) INTO definition;
  IF position('LEFT JOIN wbs_h1_controlled_import_trace d' IN definition)=0
     OR position('FROM wbs_h1_controlled_import_trace td' IN definition)=0 THEN
    RAISE EXCEPTION 'Migration 448 down requires the modern inventory reader' USING ERRCODE='55000';
  END IF;
  definition:=replace(definition,'LEFT JOIN wbs_h1_controlled_import_trace d','LEFT JOIN wbs_test_import_draft d');
  definition:=replace(definition,'FROM wbs_h1_controlled_import_trace td','FROM wbs_test_import_draft td');
  definition:=replace(definition,'(d.source_record_hash IS NOT NULL) AS controlled_draft_present,
      coalesce(d.journal_status=''POSTED'',false) AS controlled_test_posted',
    '(d.source_record_hash IS NOT NULL) AS controlled_test_posted');
  definition:=replace(definition,'CASE WHEN controlled_test_posted THEN ''CONTROLLED_TEST_POSTED'' WHEN controlled_draft_present THEN ''CONTROLLED_TEST_DRAFT'' ELSE ''SOURCE_STAGED'' END',
    'CASE WHEN controlled_test_posted THEN ''CONTROLLED_TEST_POSTED'' ELSE ''SOURCE_STAGED'' END');
  definition:=replace(definition,'''mapping_match_count'',mapping_match_count,''mapping_state'',CASE','''mapping_state'',CASE');
  EXECUTE definition;
END
$migration$;
DROP VIEW wbs_h1_controlled_import_trace;

COMMIT;
