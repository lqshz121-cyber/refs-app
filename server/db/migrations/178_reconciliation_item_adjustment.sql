BEGIN;

-- A reconciliation difference covers the whole statement.  Each adjustment,
-- however, binds one unresolved bank row, so its bank-account line must match
-- that row rather than the aggregate statement difference.
DO $migration$
DECLARE
  definition text;
  old_source_guard constant text:='OR bank.transaction_date>rec.statement_ending_date OR bank.amount<>rec.difference THEN';
  new_source_guard constant text:='OR bank.transaction_date>rec.statement_ending_date THEN';
  old_line_guard constant text:='bank_delta<>rec.difference';
  new_line_guard constant text:='bank_delta<>bank.amount';
  occurrences integer;
BEGIN
  SELECT pg_get_functiondef(
    'public.refs_create_reconciliation_adjustment_draft_105(uuid,uuid,uuid,uuid,bigint,uuid,text,date,character,text,jsonb,uuid[],text,text,text)'::regprocedure
  ) INTO definition;

  occurrences:=(length(definition)-length(replace(definition,old_source_guard,'')))/length(old_source_guard);
  IF occurrences<>1 THEN
    RAISE EXCEPTION 'Unexpected reconciliation adjustment source guard' USING ERRCODE='22023';
  END IF;
  definition:=replace(definition,old_source_guard,new_source_guard);

  occurrences:=(length(definition)-length(replace(definition,old_line_guard,'')))/length(old_line_guard);
  IF occurrences<>1 THEN
    RAISE EXCEPTION 'Unexpected reconciliation adjustment line guard' USING ERRCODE='22023';
  END IF;
  definition:=replace(definition,old_line_guard,new_line_guard);
  EXECUTE definition;
END;
$migration$;

REVOKE ALL ON FUNCTION refs_create_reconciliation_adjustment_draft_105(uuid,uuid,uuid,uuid,bigint,uuid,text,date,char,text,jsonb,uuid[],text,text,text)
  FROM PUBLIC,refs_app;

COMMIT;
