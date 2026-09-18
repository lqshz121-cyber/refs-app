BEGIN;
DROP FUNCTION IF EXISTS refs_read_outbox_health(uuid,uuid,integer);
DROP INDEX IF EXISTS outbox_event_health_idx;
UPDATE permission_catalog SET active=false,effective_to=clock_timestamp() WHERE permission_code='OPS.OUTBOX.VIEW';
COMMIT;
