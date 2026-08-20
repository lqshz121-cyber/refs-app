BEGIN;
REVOKE EXECUTE ON FUNCTION refs_read_ai_property_rent_revenue_review(uuid,uuid,uuid,integer) FROM refs_app;
DROP FUNCTION refs_read_ai_property_rent_revenue_review(uuid,uuid,uuid,integer);
COMMIT;
