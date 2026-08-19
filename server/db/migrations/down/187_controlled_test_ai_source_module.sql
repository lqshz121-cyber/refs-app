BEGIN;

DO $$
BEGIN
  IF EXISTS(SELECT 1 FROM source_document WHERE source_module='ai_test_prepaid') THEN
    RAISE EXCEPTION 'Cannot remove the controlled-test AI source module after derived evidence exists' USING ERRCODE='55006';
  END IF;
END $$;

ALTER TABLE source_document DROP CONSTRAINT source_document_source_module_check;
ALTER TABLE source_document ADD CONSTRAINT source_document_source_module_check
  CHECK (source_module IN ('bankFeed', 'payable', 'cost', 'cost_general_ledger', 'loan', 'pmCharge', 'closing'));

COMMIT;
