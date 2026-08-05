BEGIN;
DROP TRIGGER IF EXISTS ar_credit_memo_posted_reducer ON journal_entry;
REVOKE EXECUTE ON FUNCTION refs_apply_ar_credit_memo_posted() FROM PUBLIC,refs_app;
DROP FUNCTION IF EXISTS refs_apply_ar_credit_memo_posted();
COMMIT;
