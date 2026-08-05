BEGIN;
DROP TRIGGER IF EXISTS ap_payment_reversal_posted_reducer ON journal_entry;
REVOKE EXECUTE ON FUNCTION refs_apply_ap_payment_reversal_posted() FROM PUBLIC,refs_app;
DROP FUNCTION IF EXISTS refs_apply_ap_payment_reversal_posted();
COMMIT;
