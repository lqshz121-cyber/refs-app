BEGIN;

REVOKE ALL ON FUNCTION refs_create_wbs_test_payable_draft(uuid,uuid,uuid,jsonb,jsonb,integer,text,text)
  FROM PUBLIC,refs_app;
DROP FUNCTION refs_create_wbs_test_payable_draft(uuid,uuid,uuid,jsonb,jsonb,integer,text,text);

ALTER FUNCTION refs_create_wbs_test_payable_draft_v168(uuid,uuid,uuid,jsonb,jsonb,integer,text,text)
  RENAME TO refs_create_wbs_test_payable_draft;

REVOKE ALL ON FUNCTION refs_create_wbs_test_payable_draft(uuid,uuid,uuid,jsonb,jsonb,integer,text,text)
  FROM PUBLIC;
GRANT EXECUTE ON FUNCTION refs_create_wbs_test_payable_draft(uuid,uuid,uuid,jsonb,jsonb,integer,text,text)
  TO refs_app;

COMMIT;
