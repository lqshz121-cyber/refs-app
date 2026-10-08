BEGIN;
DROP FUNCTION refs_retain_wbs_test_payable_source(uuid,uuid,uuid,jsonb,jsonb,integer,text,text);
ALTER FUNCTION refs_retain_wbs_test_payable_source_454(uuid,uuid,uuid,jsonb,jsonb,integer,text,text)
  RENAME TO refs_retain_wbs_test_payable_source;
GRANT EXECUTE ON FUNCTION refs_retain_wbs_test_payable_source(uuid,uuid,uuid,jsonb,jsonb,integer,text,text) TO refs_app;
COMMIT;
