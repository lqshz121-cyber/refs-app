BEGIN;

-- R07 follow-up (found by CPD-3 once the parser policed the whole chain, 2026-09-24).
--
-- 270 meant to pin the controlled-import placeholder's debit line to "no member, no dimensions"
-- before a WBS H1 Payable reclassification Draft reverses it. Its replace() anchored on
--   ... AND journal_entry_id=trace.journal_entry_id AND account_code='610000' ...
-- but 269's function reads the baseline lines by original.journal_entry_id, so that replace never
-- matched and 270 had no position() check to notice. The sibling credit-line guard in 270 did
-- apply. Result: the debit placeholder is accepted even if it carries a member or dimensions,
-- which the two-line placeholder contract (and 270's own intent) forbids.
--
-- 270 is applied history and is not edited. This migration applies the intended guard against
-- the live anchor, fail-closed: it refuses if the anchor is missing or already rewritten.
DO $migration$
DECLARE
  definition text;
  anchor constant text:='AND journal_entry_id=original.journal_entry_id AND account_code=''610000'' AND debit_amount=source_row.amount AND credit_amount=0 FOR SHARE;';
  guarded constant text:='AND journal_entry_id=original.journal_entry_id AND account_code=''610000'' AND debit_amount=source_row.amount AND credit_amount=0
      AND member_ref IS NULL AND dimensions=''{}''::jsonb FOR SHARE;';
BEGIN
  SELECT pg_get_functiondef('public.refs_create_wbs_h1_payable_reclass_draft(uuid,uuid,uuid,text,text,text,text,text)'::regprocedure) INTO definition;
  IF position(anchor IN definition)=0 OR position('member_ref IS NULL AND dimensions=''{}''::jsonb FOR SHARE;' IN definition)>0 THEN
    RAISE EXCEPTION 'Migration 438 requires the exact 271 WBS H1 Payable reclass Draft function' USING ERRCODE='55000';
  END IF;
  definition:=replace(definition,anchor,guarded);
  EXECUTE definition;
END
$migration$;

COMMIT;
