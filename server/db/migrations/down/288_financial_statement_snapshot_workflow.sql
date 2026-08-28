BEGIN;
DO $$ BEGIN
  IF EXISTS(SELECT 1 FROM audit_event WHERE event_type IN('FINANCIAL_STATEMENT_SNAPSHOT_PROPOSED','FINANCIAL_STATEMENT_SNAPSHOT_APPROVED')) THEN
    RAISE EXCEPTION 'Cannot roll back retained financial statement snapshot workflow evidence' USING ERRCODE='55000';
  END IF;
END $$;
REVOKE EXECUTE ON FUNCTION refs_read_financial_statement_snapshot_proposal_queue(uuid,uuid,uuid,integer,integer),refs_read_financial_statement_snapshot_proposal(uuid,uuid,uuid,uuid) FROM refs_app;
DROP FUNCTION refs_read_financial_statement_snapshot_proposal(uuid,uuid,uuid,uuid);
DROP FUNCTION refs_read_financial_statement_snapshot_proposal_queue(uuid,uuid,uuid,integer,integer);
DROP FUNCTION refs_assert_financial_statement_snapshot_proposal(uuid,uuid,uuid);
DROP FUNCTION refs_financial_statement_snapshot_proposal_rows(uuid);
DO $$ DECLARE item record;BEGIN
  FOR item IN SELECT function_definition FROM financial_statement_snapshot_workflow_function_backup ORDER BY function_identity LOOP EXECUTE item.function_definition;END LOOP;
END $$;
DROP TABLE financial_statement_snapshot_workflow_function_backup;
COMMIT;
