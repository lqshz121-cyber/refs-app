BEGIN;

-- Migration 132 creates the reviewed Cost-to-CWIP source document from the
-- provider's row-level Cost General Ledger export. Preserve that exact
-- provenance as a canonical, allowlisted accounting source rather than
-- weakening the source-document boundary or relabelling it as an unrelated
-- cost feed.
ALTER TABLE source_document DROP CONSTRAINT source_document_source_module_check;
ALTER TABLE source_document ADD CONSTRAINT source_document_source_module_check
  CHECK (source_module IN ('bankFeed', 'payable', 'cost', 'cost_general_ledger', 'loan', 'pmCharge', 'closing'));

COMMENT ON COLUMN source_document.source_module IS 'Normalized accounting sources are allowlisted. Reports and display/read-model modules remain raw evidence only and must be quarantined with REPORT_AS_SOURCE_REJECTED.';

COMMIT;
