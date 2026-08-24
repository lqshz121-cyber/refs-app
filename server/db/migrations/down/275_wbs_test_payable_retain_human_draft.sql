BEGIN;

DO $$ BEGIN
  IF EXISTS(SELECT 1 FROM wbs_test_payable_source_receipt) THEN
    RAISE EXCEPTION 'Refusing migration 275 rollback: retained WBS test Payable evidence exists';
  END IF;
END $$;

DROP FUNCTION refs_create_wbs_test_payable_draft(uuid,uuid,uuid,text,text,text);
DROP FUNCTION refs_create_wbs_test_payable_draft_hash(uuid,uuid,uuid,text);
DROP FUNCTION refs_retain_wbs_test_payable_source(uuid,uuid,uuid,jsonb,jsonb,integer,text,text);
DROP FUNCTION refs_retain_wbs_test_payable_source_hash(uuid,uuid,uuid,jsonb,jsonb,integer);
DROP TABLE wbs_test_payable_draft_evidence;
DROP TABLE wbs_test_payable_source_receipt;

GRANT EXECUTE ON FUNCTION refs_create_wbs_test_payable_draft(uuid,uuid,uuid,jsonb,jsonb,integer,text,text) TO refs_app;

COMMIT;
