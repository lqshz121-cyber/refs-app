BEGIN;
-- Keep the expanded business scope allowlist on rollback; removing it would make
-- already-installed reversal commands fail closed after a partial rollback.
COMMIT;
