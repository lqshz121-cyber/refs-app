BEGIN;
DROP TRIGGER IF EXISTS ar_refund_posted_reducer ON journal_entry;
CREATE TRIGGER zz_ar_refund_posted_reducer AFTER UPDATE OF status ON journal_entry FOR EACH ROW EXECUTE FUNCTION refs_apply_ar_refund_posted();
COMMIT;
