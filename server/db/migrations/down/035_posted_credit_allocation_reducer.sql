BEGIN;
DROP TRIGGER IF EXISTS posted_credit_allocation_reducer ON business_allocation;
DROP FUNCTION IF EXISTS refs_activate_posted_credit_allocation();
COMMIT;
