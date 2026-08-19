BEGIN;

-- Migration 176 deliberately gives the derived TEST_ONLY prepaid source its
-- own provenance module. Keep that module explicit and allowlisted instead of
-- relabelling the derived source as a production payable feed.
ALTER TABLE source_document DROP CONSTRAINT source_document_source_module_check;
ALTER TABLE source_document ADD CONSTRAINT source_document_source_module_check
  CHECK (source_module IN ('bankFeed', 'payable', 'cost', 'cost_general_ledger', 'loan', 'pmCharge', 'closing', 'ai_test_prepaid'));

COMMIT;
