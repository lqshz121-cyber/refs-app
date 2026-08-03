BEGIN;

REVOKE EXECUTE ON FUNCTION refs_list_business_adjustments(uuid,uuid,text) FROM refs_app;
DROP FUNCTION refs_list_business_adjustments(uuid,uuid,text);

COMMIT;
