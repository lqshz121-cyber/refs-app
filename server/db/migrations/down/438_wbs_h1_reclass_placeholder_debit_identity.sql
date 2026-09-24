BEGIN;

-- Removes the placeholder debit-line identity guard added by 438, restoring the 271 definition.
DO $migration$
DECLARE
  definition text;
  anchor constant text:='AND journal_entry_id=original.journal_entry_id AND account_code=''610000'' AND debit_amount=source_row.amount AND credit_amount=0 FOR SHARE;';
  guarded constant text:='AND journal_entry_id=original.journal_entry_id AND account_code=''610000'' AND debit_amount=source_row.amount AND credit_amount=0
      AND member_ref IS NULL AND dimensions=''{}''::jsonb FOR SHARE;';
BEGIN
  SELECT pg_get_functiondef('public.refs_create_wbs_h1_payable_reclass_draft(uuid,uuid,uuid,text,text,text,text,text)'::regprocedure) INTO definition;
  IF position(guarded IN definition)=0 THEN
    RAISE EXCEPTION 'Migration 438 down requires the 438 guard to be present' USING ERRCODE='55000';
  END IF;
  definition:=replace(definition,guarded,anchor);
  EXECUTE definition;
END
$migration$;

COMMIT;
