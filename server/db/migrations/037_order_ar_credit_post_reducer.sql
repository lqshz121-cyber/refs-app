BEGIN;
-- The generic AP reducer has a defensive status guard before its kind branch.
-- Ensure it sees an AR Draft first; then the AR reducer performs the post.
DROP TRIGGER IF EXISTS ar_credit_memo_posted_reducer ON journal_entry;
CREATE TRIGGER zz_ar_credit_memo_posted_reducer AFTER UPDATE OF status ON journal_entry
FOR EACH ROW EXECUTE FUNCTION refs_apply_ar_credit_memo_posted();
COMMIT;
