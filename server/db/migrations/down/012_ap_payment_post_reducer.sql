BEGIN;

DROP TRIGGER IF EXISTS payment_occurrence_posted_reducer ON journal_entry;
DROP FUNCTION IF EXISTS refs_apply_ap_payment_posted_occurrence();

COMMIT;
