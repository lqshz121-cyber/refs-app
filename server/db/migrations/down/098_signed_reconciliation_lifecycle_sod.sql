BEGIN;

DROP TRIGGER IF EXISTS signed_reconciliation_lifecycle_sod_guard ON reconciliation;
DROP FUNCTION IF EXISTS refs_guard_signed_reconciliation_lifecycle_sod();
DROP FUNCTION IF EXISTS refs_signed_reconciliation_actor_conflict(uuid,uuid,uuid,text,text);

COMMIT;
