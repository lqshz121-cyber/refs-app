BEGIN;

-- Read projection only: never backfill or manufacture legacy import rows.
CREATE VIEW wbs_h1_controlled_import_trace WITH (security_barrier=true) AS
  SELECT d.tenant_id,d.entity_id,d.period_id,d.source_record_hash,d.source_document_id,
    d.source_document_line_id,d.attachment_id,d.journal_entry_id,j.status::text AS journal_status
  FROM wbs_test_import_draft d
  JOIN journal_entry j ON (j.tenant_id,j.entity_id,j.journal_entry_id)=(d.tenant_id,d.entity_id,d.journal_entry_id)
  UNION ALL
  SELECT r.tenant_id,r.entity_id,r.period_id,r.source_record_hash,r.source_document_id,
    r.source_document_line_id,r.attachment_id,e.journal_entry_id,j.status::text
  FROM wbs_test_payable_source_receipt r
  JOIN wbs_test_payable_draft_evidence e
    ON (e.tenant_id,e.entity_id,e.wbs_test_payable_source_receipt_id)=(r.tenant_id,r.entity_id,r.wbs_test_payable_source_receipt_id)
    AND e.receipt_hash=r.receipt_hash
  JOIN business_document b ON (b.tenant_id,b.entity_id,b.business_document_id)=(e.tenant_id,e.entity_id,e.business_document_id)
    AND b.source_document_id=r.source_document_id
    AND (b.draft_journal_entry_id=e.journal_entry_id OR b.posted_journal_entry_id=e.journal_entry_id)
    AND b.created_by=e.created_by AND e.created_by<>r.created_by
  JOIN journal_entry j ON (j.tenant_id,j.entity_id,j.journal_entry_id)=(e.tenant_id,e.entity_id,e.journal_entry_id)
  WHERE NOT EXISTS(SELECT 1 FROM wbs_test_import_draft d
    WHERE (d.tenant_id,d.entity_id,d.source_record_hash)=(r.tenant_id,r.entity_id,r.source_record_hash));
REVOKE ALL ON wbs_h1_controlled_import_trace FROM PUBLIC,refs_app;

DO $migration$
DECLARE definition text;
BEGIN
  SELECT pg_get_functiondef('public.refs_read_wbs_h1_import_inventory(uuid,uuid,integer,integer)'::regprocedure) INTO definition;
  IF position('LEFT JOIN wbs_test_import_draft d' IN definition)=0
     OR position('FROM wbs_test_import_draft td' IN definition)=0
     OR position('(d.source_record_hash IS NOT NULL) AS controlled_test_posted' IN definition)=0 THEN
    RAISE EXCEPTION 'Migration 448 requires the historical inventory reader' USING ERRCODE='55000';
  END IF;
  definition:=replace(definition,'LEFT JOIN wbs_test_import_draft d','LEFT JOIN wbs_h1_controlled_import_trace d');
  definition:=replace(definition,'FROM wbs_test_import_draft td','FROM wbs_h1_controlled_import_trace td');
  definition:=replace(definition,'(d.source_record_hash IS NOT NULL) AS controlled_test_posted',
    '(d.source_record_hash IS NOT NULL) AS controlled_draft_present,
      coalesce(d.journal_status=''POSTED'',false) AS controlled_test_posted');
  definition:=replace(definition,'CASE WHEN controlled_test_posted THEN ''CONTROLLED_TEST_POSTED'' ELSE ''SOURCE_STAGED'' END',
    'CASE WHEN controlled_test_posted THEN ''CONTROLLED_TEST_POSTED'' WHEN controlled_draft_present THEN ''CONTROLLED_TEST_DRAFT'' ELSE ''SOURCE_STAGED'' END');
  definition:=replace(definition,'''mapping_state'',CASE','''mapping_match_count'',mapping_match_count,''mapping_state'',CASE');
  EXECUTE definition;
END
$migration$;

COMMIT;
