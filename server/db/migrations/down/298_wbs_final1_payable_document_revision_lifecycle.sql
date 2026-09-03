BEGIN;

-- Backfill-only state is reversible.  A signed revision retained through 298
-- is business evidence and must never be removed by a rollback.
DO $$ BEGIN
  IF EXISTS(
    SELECT 1 FROM wbs_final1_payable_document_revision
    WHERE retention_origin='SIGNED_FINAL1_298'
  ) THEN
    RAISE EXCEPTION 'Cannot remove retained signed payable document revisions'
      USING ERRCODE='55000';
  END IF;
END $$;

DROP FUNCTION IF EXISTS refs_retain_ai_accounting_decision_batch(uuid,uuid,uuid,jsonb,integer,text,text,text);
ALTER FUNCTION refs_retain_ai_accounting_decision_batch_v297(uuid,uuid,uuid,jsonb,integer,text,text,text)
  RENAME TO refs_retain_ai_accounting_decision_batch;
REVOKE ALL ON FUNCTION refs_retain_ai_accounting_decision_batch(uuid,uuid,uuid,jsonb,integer,text,text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION refs_retain_ai_accounting_decision_batch(uuid,uuid,uuid,jsonb,integer,text,text,text) TO refs_app;

DROP FUNCTION IF EXISTS refs_read_ai_invoice_decision_population_page(uuid,uuid,uuid,date,uuid,integer,uuid,integer);
ALTER FUNCTION refs_read_ai_invoice_decision_population_page_v297(uuid,uuid,uuid,date,uuid,integer,uuid,integer)
  RENAME TO refs_read_ai_invoice_decision_population_page;
REVOKE ALL ON FUNCTION refs_read_ai_invoice_decision_population_page(uuid,uuid,uuid,date,uuid,integer,uuid,integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION refs_read_ai_invoice_decision_population_page(uuid,uuid,uuid,date,uuid,integer,uuid,integer) TO refs_app;

DROP FUNCTION IF EXISTS refs_read_ai_invoice_classification_source_v4(uuid,uuid,uuid,integer);
DROP FUNCTION IF EXISTS refs_read_wbs_final1_payable_document_revisions(uuid,uuid,text,integer);

DROP FUNCTION IF EXISTS refs_create_ai_accounting_decision_draft(uuid,uuid,uuid,text,text,text,text,text);
ALTER FUNCTION refs_create_ai_accounting_decision_draft_v298_prior(uuid,uuid,uuid,text,text,text,text,text)
  RENAME TO refs_create_ai_accounting_decision_draft;
REVOKE ALL ON FUNCTION refs_create_ai_accounting_decision_draft(uuid,uuid,uuid,text,text,text,text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION refs_create_ai_accounting_decision_draft(uuid,uuid,uuid,text,text,text,text,text) TO refs_app;

DROP FUNCTION IF EXISTS refs_retain_wbs_final1_source_evidence_with_signed_controls(uuid,uuid,jsonb,jsonb,jsonb,text,text);
ALTER FUNCTION refs_retain_wbs_final1_source_evidence_with_signed_controls_v297(uuid,uuid,jsonb,jsonb,jsonb,text,text)
  RENAME TO refs_retain_wbs_final1_source_evidence_with_signed_controls;
REVOKE ALL ON FUNCTION refs_retain_wbs_final1_source_evidence_with_signed_controls(uuid,uuid,jsonb,jsonb,jsonb,text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION refs_retain_wbs_final1_source_evidence_with_signed_controls(uuid,uuid,jsonb,jsonb,jsonb,text,text) TO refs_app;

DROP VIEW wbs_final1_payable_document_revision_current;
DROP TABLE wbs_final1_payable_document_revision;
DROP FUNCTION refs_wbs_final1_payable_document_revision_hash(uuid,uuid,uuid,uuid,uuid,uuid,uuid,text,text,text,text,text,text,integer,text,text,text,text,text,text,integer,uuid,text,text,integer,text);
DROP FUNCTION refs_wbs_final1_payable_document_identity_hash(uuid,uuid,integer,text,text,text);
DROP FUNCTION refs_wbs_final1_payable_document_identity_component(text);

DROP INDEX wbs_final1_payable_tax_statement_identity_idx;
CREATE UNIQUE INDEX wbs_final1_payable_tax_statement_identity_uniq ON wbs_final1_payable_document_evidence(
  tenant_id,entity_id,taxing_jurisdiction,tax_statement_identifier,controlled_property_ref,parcel_identifier,tax_coverage_period_start,tax_coverage_period_end
) WHERE document_kind='TAX_STATEMENT';

COMMIT;
