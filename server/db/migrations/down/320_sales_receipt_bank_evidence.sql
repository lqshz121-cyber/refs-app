BEGIN;
DO $$ BEGIN
  IF EXISTS(SELECT 1 FROM bank_match WHERE sales_receipt_id IS NOT NULL) THEN
    RAISE EXCEPTION 'Retained sales receipt bank match history prevents destructive rollback' USING ERRCODE='23514';
  END IF;
END $$;
DROP FUNCTION refs_read_sales_receipt_bank_candidates(uuid,uuid,uuid,uuid,integer);
DROP INDEX sales_receipt_bank_candidate_idx;
DROP INDEX bank_match_one_active_sales_receipt_uq;
ALTER TABLE bank_match DROP CONSTRAINT bank_match_sales_receipt_trace_ck,
  DROP CONSTRAINT bank_match_sales_receipt_fk,DROP CONSTRAINT bank_match_business_evidence_ck,
  ADD CONSTRAINT bank_match_business_evidence_ck CHECK(business_source_document_id IS NOT NULL OR payment_occurrence_id IS NOT NULL),
  DROP COLUMN sales_receipt_id;
COMMIT;
