BEGIN;

DO $$
BEGIN
  IF EXISTS(SELECT 1 FROM wbs_controlled_test_bank_import WHERE row_count>500)
    OR EXISTS(SELECT 1 FROM wbs_controlled_test_bank_import_row WHERE row_index>499) THEN
    RAISE EXCEPTION 'Cannot restore the 500-row WBS test Bank bound while larger retained batches exist' USING ERRCODE='55006';
  END IF;
END $$;

REVOKE ALL ON FUNCTION refs_get_reconciliation_worksheet_item(uuid,uuid,uuid,uuid) FROM PUBLIC,refs_app;
DROP FUNCTION refs_get_reconciliation_worksheet_item(uuid,uuid,uuid,uuid);

DO $migration$
DECLARE
  definition text;
  old_guard constant text:='IF rows_count NOT BETWEEN 1 AND 10000 OR (p_observation->>''record_count'')::integer<>rows_count THEN';
  new_guard constant text:='IF rows_count NOT BETWEEN 1 AND 500 OR (p_observation->>''record_count'')::integer<>rows_count THEN';
  old_message constant text:='Controlled test Bank observation must contain one to ten thousand rows';
  new_message constant text:='Controlled test Bank observation must contain one to five hundred rows';
BEGIN
  SELECT pg_get_functiondef(
    'public.refs_create_wbs_controlled_test_bank_scope(uuid,uuid,uuid,text,jsonb,text,text,text)'::regprocedure
  ) INTO definition;
  IF strpos(definition,old_guard)=0 OR strpos(definition,old_message)=0 THEN
    RAISE EXCEPTION 'Unexpected controlled test Bank batch guard' USING ERRCODE='22023';
  END IF;
  EXECUTE replace(replace(definition,old_guard,new_guard),old_message,new_message);
END;
$migration$;

ALTER TABLE wbs_controlled_test_bank_import DROP CONSTRAINT wbs_controlled_test_bank_import_row_count_check;
ALTER TABLE wbs_controlled_test_bank_import ADD CONSTRAINT wbs_controlled_test_bank_import_row_count_check CHECK(row_count BETWEEN 1 AND 500);
ALTER TABLE wbs_controlled_test_bank_import_row DROP CONSTRAINT wbs_controlled_test_bank_import_row_row_index_check;
ALTER TABLE wbs_controlled_test_bank_import_row ADD CONSTRAINT wbs_controlled_test_bank_import_row_row_index_check CHECK(row_index BETWEEN 0 AND 499);

COMMIT;
