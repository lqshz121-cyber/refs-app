BEGIN;

DO $migration$
DECLARE definition text;
DECLARE anchor constant text:=$old$SELECT * INTO trace FROM wbs_test_import_draft WHERE tenant_id=p_tenant AND entity_id=p_entity
    AND source_document_id=p_source_document AND business_document_id=p_business_document AND journal_entry_id=p_journal_entry FOR SHARE;$old$;
DECLARE replacement constant text:=$new$SELECT * INTO trace FROM wbs_test_import_draft WHERE tenant_id=p_tenant AND entity_id=p_entity
    AND source_document_id=p_source_document AND business_document_id=p_business_document AND journal_entry_id=p_journal_entry FOR SHARE;
  IF NOT FOUND THEN
    SELECT r.*,e.wbs_test_payable_draft_evidence_id INTO trace
      FROM wbs_test_payable_source_receipt r JOIN wbs_test_payable_draft_evidence e
        ON (e.tenant_id,e.entity_id,e.wbs_test_payable_source_receipt_id)=(r.tenant_id,r.entity_id,r.wbs_test_payable_source_receipt_id)
      JOIN business_document b ON (b.tenant_id,b.entity_id,b.business_document_id)=(e.tenant_id,e.entity_id,e.business_document_id)
      WHERE r.tenant_id=p_tenant AND r.entity_id=p_entity AND r.source_document_id=p_source_document
        AND e.business_document_id=p_business_document AND e.journal_entry_id=p_journal_entry
        AND e.receipt_hash=r.receipt_hash AND e.created_by<>r.created_by AND b.created_by=e.created_by
        AND b.source_document_id=r.source_document_id AND b.draft_journal_entry_id IS NULL
        AND b.posted_journal_entry_id=e.journal_entry_id
        AND b.gross_amount=r.amount AND b.currency=r.currency AND b.accounting_date=r.posting_accounting_date
      FOR SHARE OF r,e,b;
    modern_trace:=true;
  END IF;$new$;
DECLARE event_anchor constant text:=$old$event_payload:=jsonb_build_object('wbs_test_import_draft_id',trace.wbs_test_import_draft_id,'source_document_id',p_source_document,
    'business_document_id',p_business_document,'journal_entry_id',p_journal_entry,'status','POSTED','test_only',true);$old$;
DECLARE event_replacement constant text:=$new$IF modern_trace THEN
    event_payload:=jsonb_build_object('schema_version','WBS_TEST_SOURCE_POSTED_V2',
      'wbs_test_payable_source_receipt_id',trace.wbs_test_payable_source_receipt_id,
      'wbs_test_payable_draft_evidence_id',trace.wbs_test_payable_draft_evidence_id,
      'source_document_id',p_source_document,'business_document_id',p_business_document,
      'journal_entry_id',p_journal_entry,'status','POSTED','test_only',true);
  ELSE
    event_payload:=jsonb_build_object('wbs_test_import_draft_id',trace.wbs_test_import_draft_id,'source_document_id',p_source_document,
    'business_document_id',p_business_document,'journal_entry_id',p_journal_entry,'status','POSTED','test_only',true);
  END IF;$new$;
BEGIN
  SELECT pg_get_functiondef('public.refs_finalize_wbs_test_import_source(uuid,uuid,uuid,uuid,uuid,text,text)'::regprocedure) INTO definition;
  IF position(anchor IN definition)=0 OR position(event_anchor IN definition)=0 OR position('trace wbs_test_import_draft;' IN definition)=0 THEN
    RAISE EXCEPTION 'Migration 449 requires historical source finalization' USING ERRCODE='55000';
  END IF;
  definition:=replace(definition,'trace wbs_test_import_draft;','trace record; modern_trace boolean:=false;');
  definition:=replace(definition,anchor,replacement);
  definition:=replace(definition,event_anchor,event_replacement);
  EXECUTE definition;
END
$migration$;

COMMIT;
