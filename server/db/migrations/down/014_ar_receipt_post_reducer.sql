BEGIN;
DROP TRIGGER IF EXISTS ar_receipt_occurrence_posted_reducer ON journal_entry;
DROP FUNCTION IF EXISTS refs_apply_ar_receipt_posted_occurrence();
COMMIT;
