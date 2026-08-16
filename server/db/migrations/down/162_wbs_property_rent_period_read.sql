BEGIN;
REVOKE EXECUTE ON FUNCTION refs_list_wbs_property_rent_pickup(uuid,uuid,uuid,integer) FROM refs_app;
DROP FUNCTION refs_list_wbs_property_rent_pickup(uuid,uuid,uuid,integer);
GRANT EXECUTE ON FUNCTION refs_list_wbs_property_rent_pickup(uuid,uuid,integer) TO refs_app;
COMMIT;
