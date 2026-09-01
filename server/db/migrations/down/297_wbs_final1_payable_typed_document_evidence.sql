BEGIN;
DO $$ BEGIN
  IF EXISTS(SELECT 1 FROM wbs_final1_payable_document_evidence) THEN
    RAISE EXCEPTION 'Cannot remove provider-signed payable document evidence' USING ERRCODE='55000';
  END IF;
END $$;
DROP FUNCTION IF EXISTS refs_read_ai_invoice_decision_population_page(uuid,uuid,uuid,date,uuid,integer,uuid,integer);
ALTER FUNCTION refs_read_ai_invoice_decision_population_page_v295(uuid,uuid,uuid,date,uuid,integer,uuid,integer) RENAME TO refs_read_ai_invoice_decision_population_page;
REVOKE ALL ON FUNCTION refs_read_ai_invoice_decision_population_page(uuid,uuid,uuid,date,uuid,integer,uuid,integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION refs_read_ai_invoice_decision_population_page(uuid,uuid,uuid,date,uuid,integer,uuid,integer) TO refs_app;
DROP FUNCTION IF EXISTS refs_read_ai_invoice_classification_source_v3(uuid,uuid,uuid,integer);
DROP FUNCTION IF EXISTS refs_retain_wbs_final1_source_evidence_with_signed_controls(uuid,uuid,jsonb,jsonb,jsonb,text,text);
ALTER FUNCTION refs_retain_wbs_final1_source_evidence_with_signed_controls_v167(uuid,uuid,jsonb,jsonb,jsonb,text,text) RENAME TO refs_retain_wbs_final1_source_evidence_with_signed_controls;
REVOKE ALL ON FUNCTION refs_retain_wbs_final1_source_evidence_with_signed_controls(uuid,uuid,jsonb,jsonb,jsonb,text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION refs_retain_wbs_final1_source_evidence_with_signed_controls(uuid,uuid,jsonb,jsonb,jsonb,text,text) TO refs_app;
DROP FUNCTION IF EXISTS refs_wbs_final1_payable_document_evidence_hash(uuid,uuid,uuid,uuid,uuid,text,text,text,text,text,text,date,date,text,text,text);
DROP TABLE wbs_final1_payable_document_evidence;
COMMIT;
