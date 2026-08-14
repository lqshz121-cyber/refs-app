BEGIN;
DROP FUNCTION refs_read_ai_amortization_schedules(uuid,uuid,integer);
DELETE FROM permission_catalog WHERE permission_code='AI.AMORTIZATION.VIEW';
COMMIT;
