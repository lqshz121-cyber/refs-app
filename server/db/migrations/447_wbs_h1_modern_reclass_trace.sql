BEGIN;

-- Extend the authoritative reclass command, not the legacy import table.
-- Modern receipts must describe the exact selected month: clamped dates and
-- mismatched human Draft evidence remain ineligible for reclassification.
DO $migration$
DECLARE definition text;
DECLARE old_trace constant text:=$old$SELECT * INTO trace FROM wbs_test_import_draft
    WHERE tenant_id=p_tenant AND entity_id=p_entity AND period_id=p_period AND source_record_hash=p_source_record_hash FOR SHARE;$old$;
DECLARE new_trace constant text:=$new$SELECT * INTO trace FROM wbs_test_import_draft
    WHERE tenant_id=p_tenant AND entity_id=p_entity AND period_id=p_period AND source_record_hash=p_source_record_hash FOR SHARE;
  IF NOT FOUND THEN
    SELECT r.*,e.journal_entry_id,e.business_document_id INTO trace
      FROM wbs_test_payable_source_receipt r
      JOIN wbs_test_payable_draft_evidence e
        ON (e.tenant_id,e.entity_id,e.wbs_test_payable_source_receipt_id)=(r.tenant_id,r.entity_id,r.wbs_test_payable_source_receipt_id)
      JOIN business_document b ON (b.tenant_id,b.entity_id,b.business_document_id)=(e.tenant_id,e.entity_id,e.business_document_id)
      WHERE r.tenant_id=p_tenant AND r.entity_id=p_entity AND r.period_id=p_period AND r.source_record_hash=p_source_record_hash
        AND r.receipt_hash=e.receipt_hash AND r.source_accounting_date=source_row.accounting_date
        AND r.posting_accounting_date=r.source_accounting_date AND r.amount=source_row.amount
        AND r.currency=page_doc->>'currency' AND e.created_by<>r.created_by
        AND b.status IN ('OPEN','PARTIALLY_PAID','PAID') AND b.document_kind='AP_BILL' AND b.source_document_id=r.source_document_id
        AND b.posted_journal_entry_id=e.journal_entry_id
        AND b.draft_journal_entry_id IS NULL AND b.created_by=e.created_by
        AND b.gross_amount=r.amount AND b.currency=r.currency AND b.accounting_date=r.posting_accounting_date
        AND b.counterparty_ref='WBS_TEST_VENDOR'
      FOR SHARE OF r,e,b;
    trace_schema:='WBS_TEST_IMPORT_LINE_V2';
  END IF;$new$;
BEGIN
  SELECT pg_get_functiondef('public.refs_create_wbs_h1_payable_reclass_draft(uuid,uuid,uuid,text,text,text,text,text)'::regprocedure) INTO definition;
  IF position('trace wbs_test_import_draft;' IN definition)=0 OR position(old_trace IN definition)=0
     OR position('l.external_dimension_refs->>''schema_version''=''WBS_TEST_IMPORT_LINE_V1''' IN definition)=0 THEN
    RAISE EXCEPTION 'Migration 447 requires the guarded historical reclass definition' USING ERRCODE='55000';
  END IF;
  definition:=replace(definition,'trace wbs_test_import_draft;','trace record; trace_schema text:=''WBS_TEST_IMPORT_LINE_V1'';');
  definition:=replace(definition,old_trace,new_trace);
  definition:=replace(definition,'l.external_dimension_refs->>''schema_version''=''WBS_TEST_IMPORT_LINE_V1''',
    'l.external_dimension_refs->>''schema_version''=trace_schema
      AND d.accounting_date=source_row.accounting_date AND d.business_date=source_row.accounting_date');
  EXECUTE definition;
END
$migration$;

COMMIT;
