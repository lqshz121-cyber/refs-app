BEGIN;

DROP TRIGGER reconciliation_adjustment_post_guard ON journal_entry;
CREATE TRIGGER reconciliation_adjustment_post_guard
  BEFORE UPDATE OF status ON journal_entry
  FOR EACH ROW EXECUTE FUNCTION refs_guard_reconciliation_adjustment_lifecycle();

COMMIT;
