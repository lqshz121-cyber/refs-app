BEGIN;
DROP TRIGGER IF EXISTS zz_ar_credit_memo_posted_reducer ON journal_entry;
CREATE TRIGGER ar_credit_memo_posted_reducer AFTER UPDATE OF status ON journal_entry
FOR EACH ROW EXECUTE FUNCTION refs_apply_ar_credit_memo_posted();
COMMIT;
