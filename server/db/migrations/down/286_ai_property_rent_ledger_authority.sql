BEGIN;

DO $$
DECLARE definition text;
BEGIN
  SELECT function_definition INTO STRICT definition
  FROM ai_property_rent_revenue_reader_function_backup
  WHERE function_identity='refs_read_ai_property_rent_revenue_review(uuid,uuid,uuid,integer)';
  EXECUTE definition;
END $$;

DROP TABLE ai_property_rent_revenue_reader_function_backup;

COMMIT;
