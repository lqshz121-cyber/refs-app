BEGIN;

-- This migration only corrects enum/text comparison compatibility in the retained Cash Transfer cancellation path. Reverting would reintroduce a runtime failure, so down is intentionally a no-op.

COMMIT;
