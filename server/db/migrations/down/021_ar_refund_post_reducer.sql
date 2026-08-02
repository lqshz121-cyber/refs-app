BEGIN;
DROP TRIGGER IF EXISTS ar_refund_posted_reducer ON journal_entry;
REVOKE EXECUTE ON FUNCTION refs_apply_ar_refund_posted() FROM PUBLIC,refs_app;
DROP FUNCTION IF EXISTS refs_apply_ar_refund_posted();
COMMIT;
