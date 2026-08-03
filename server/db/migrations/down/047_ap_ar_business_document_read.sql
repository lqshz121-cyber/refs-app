BEGIN;

REVOKE EXECUTE ON FUNCTION refs_list_business_documents(uuid,uuid,text) FROM refs_app;
DROP FUNCTION IF EXISTS refs_list_business_documents(uuid,uuid,text);
GRANT SELECT ON business_document TO refs_app;

COMMIT;
