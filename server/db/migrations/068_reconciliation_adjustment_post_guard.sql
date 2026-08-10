BEGIN;

-- refs_post_journal writes ledger rows before changing journal status.  The
-- exact-difference guard must therefore run after the status transition so it
-- includes the current adjustment in the POSTED-ledger balance proof.
DROP TRIGGER reconciliation_adjustment_post_guard ON journal_entry;
CREATE TRIGGER reconciliation_adjustment_post_guard
  AFTER UPDATE OF status ON journal_entry
  FOR EACH ROW EXECUTE FUNCTION refs_guard_reconciliation_adjustment_lifecycle();

COMMIT;
