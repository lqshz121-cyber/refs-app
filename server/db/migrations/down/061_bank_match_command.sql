BEGIN;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM bank_match WHERE business_source_document_id IS NULL) THEN
    RAISE EXCEPTION '061 rollback blocked: retained native payment matches cannot be represented by the pre-061 schema; preserve or migrate that evidence before rollback' USING ERRCODE='55000';
  END IF;
END;
$$;

DROP TRIGGER business_adjustment_active_bank_match_guard ON business_adjustment;
DROP FUNCTION refs_block_reversal_for_active_bank_match();
REVOKE EXECUTE ON FUNCTION refs_unmatch_bank_payment(uuid,uuid,uuid,uuid,bigint,text,text,text) FROM refs_app;
REVOKE EXECUTE ON FUNCTION refs_bank_unmatch_hash(uuid,uuid,uuid,uuid,bigint,text) FROM refs_app;
DROP FUNCTION refs_unmatch_bank_payment(uuid,uuid,uuid,uuid,bigint,text,text,text);
DROP FUNCTION refs_bank_unmatch_hash(uuid,uuid,uuid,uuid,bigint,text);
REVOKE EXECUTE ON FUNCTION refs_create_bank_payment_match(uuid,uuid,uuid,uuid,bigint,bigint,text,text,text) FROM refs_app;
REVOKE EXECUTE ON FUNCTION refs_bank_match_hash(uuid,uuid,uuid,uuid,bigint,bigint,text) FROM refs_app;
DROP FUNCTION refs_create_bank_payment_match(uuid,uuid,uuid,uuid,bigint,bigint,text,text,text);
DROP FUNCTION refs_bank_match_hash(uuid,uuid,uuid,uuid,bigint,bigint,text);
DROP INDEX bank_match_one_active_payment_occurrence_uq;
ALTER TABLE bank_match
  DROP CONSTRAINT bank_match_ledger_line_fk,
  DROP CONSTRAINT bank_match_payment_occurrence_fk,
  DROP CONSTRAINT bank_match_payment_trace_ck,
  DROP CONSTRAINT bank_match_business_evidence_ck,
  DROP COLUMN ledger_line_id,
  DROP COLUMN payment_occurrence_id,
  ALTER COLUMN business_source_document_id SET NOT NULL;
UPDATE permission_catalog
SET active=false,effective_to=COALESCE(effective_to,now()),version=version+1
WHERE permission_code IN ('BANK.MATCH.CREATE','BANK.MATCH.UNMATCH');

COMMIT;
