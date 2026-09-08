BEGIN;
LOCK TABLE source_document,source_document_line,wbs_final1_retained_source_row,wbs_payable_original_row_evidence IN ACCESS EXCLUSIVE MODE;
DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM wbs_payable_original_row_evidence) THEN RAISE EXCEPTION 'Original payable evidence must remain protected' USING ERRCODE='55006';END IF;
END;$$;
DROP FUNCTION refs_retain_wbs_final1_source_evidence_with_signed_controls(uuid,uuid,jsonb,jsonb,jsonb,text,text);
ALTER FUNCTION refs_retain_final1_signed_source_v298(uuid,uuid,jsonb,jsonb,jsonb,text,text) RENAME TO refs_retain_wbs_final1_source_evidence_with_signed_controls;
GRANT EXECUTE ON FUNCTION refs_retain_wbs_final1_source_evidence_with_signed_controls(uuid,uuid,jsonb,jsonb,jsonb,text,text) TO refs_app;
DROP TRIGGER original_payable_line_guard ON source_document_line;
DROP FUNCTION refs_guard_original_payable_line();
DROP TRIGGER original_payable_document_guard ON source_document;
DROP FUNCTION refs_guard_original_payable_document();
DROP TABLE wbs_payable_original_row_evidence;
COMMIT;
