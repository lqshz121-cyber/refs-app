BEGIN;

DROP TRIGGER IF EXISTS business_adjustment_posted_reducer ON journal_entry;
DROP FUNCTION IF EXISTS refs_apply_ap_ar_posted_adjustment();

COMMIT;
