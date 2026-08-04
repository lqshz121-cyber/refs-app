BEGIN;
-- The corrected trigger function is retained on rollback because migration 014's
-- trigger depends on it; restoring the unsafe cross-occurrence guard is forbidden.
COMMIT;
