BEGIN;

DO $$
BEGIN
  IF EXISTS(SELECT 1 FROM source_document WHERE source_module='cost_general_ledger') THEN
    RAISE EXCEPTION 'Cannot remove the Cost General Ledger source-module allowlist while retained Cost-to-CWIP source evidence exists' USING ERRCODE='55000';
  END IF;
END $$;

ALTER TABLE source_document DROP CONSTRAINT source_document_source_module_check;
ALTER TABLE source_document ADD CONSTRAINT source_document_source_module_check
  CHECK (source_module IN ('bankFeed', 'payable', 'cost', 'loan', 'pmCharge', 'closing'));

COMMENT ON COLUMN source_document.source_module IS 'Normalized accounting sources are allowlisted. Reports and display/read-model modules remain raw evidence only and must be quarantined with REPORT_AS_SOURCE_REJECTED.';

COMMIT;
