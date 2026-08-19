BEGIN;

DO $$
BEGIN
  IF EXISTS(SELECT 1 FROM ai_amortization_schedule WHERE ai_invoice_accounting_classification_evidence_id IS NOT NULL) THEN
    RAISE EXCEPTION 'Cannot remove retained invoice classification lineage from amortization schedules' USING ERRCODE='55006';
  END IF;
END;
$$;

DROP TRIGGER ai_amortization_draft_require_invoice_classification ON ai_amortization_draft_evidence;
DROP FUNCTION refs_require_ai_amortization_classification_for_draft();
DROP TRIGGER ai_amortization_schedule_audit_invoice_classification ON ai_amortization_schedule;
DROP FUNCTION refs_audit_ai_amortization_invoice_classification();
DROP TRIGGER ai_amortization_schedule_bind_invoice_classification ON ai_amortization_schedule;
DROP FUNCTION refs_bind_ai_amortization_invoice_classification();
ALTER TABLE ai_amortization_schedule
  DROP CONSTRAINT ai_amortization_schedule_classification_line_fk,
  DROP CONSTRAINT ai_amortization_schedule_classification_evidence_fk,
  DROP CONSTRAINT ai_amortization_schedule_classification_all_or_none,
  DROP COLUMN invoice_classification_hash,
  DROP COLUMN source_document_line_id,
  DROP COLUMN ai_invoice_accounting_classification_evidence_id;

COMMIT;
