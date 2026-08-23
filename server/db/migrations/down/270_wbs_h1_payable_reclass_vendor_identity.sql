BEGIN;

DO $migration$
DECLARE definition text;
BEGIN
  IF EXISTS(
    SELECT 1 FROM wbs_h1_payable_reclass_draft_evidence
    WHERE baseline_vendor_member_ref IS NOT NULL OR target_vendor_member_ref IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'Refusing to discard retained WBS H1 Payable vendor reclassification identity evidence' USING ERRCODE='55000';
  END IF;

  SELECT pg_get_functiondef(
    'public.refs_create_wbs_h1_payable_reclass_draft(uuid,uuid,uuid,text,text,text,text,text)'::regprocedure
  ) INTO definition;

  IF position('baseline_vendor_member_ref,target_vendor_member_ref)' IN definition)=0
     OR position('AND l.amount=source_row.amount AND l.party_ref=''WBS_TEST_VENDOR''' IN definition)=0
     OR position('WBS H1 Payable vendor reclassification must contain exactly four lines' IN definition)=0 THEN
    RAISE EXCEPTION 'Migration 270 down requires the exact migration 270 WBS H1 Payable Draft function' USING ERRCODE='55000';
  END IF;

  definition:=replace(definition,
    'OR to_char(source_row.amount,''FM999999999999990.0000'')<>proposal_row->>''amount''
     OR NULLIF(btrim(source_row.vendor_no),'''') IS NULL OR source_row.vendor_no=''WBS_TEST_VENDOR'' THEN',
    'OR to_char(source_row.amount,''FM999999999999990.0000'')<>proposal_row->>''amount'' THEN');
  definition:=replace(definition,
    'AND d.source_system=''WBS'' AND d.source_module=''payable'' AND d.document_type=''WBS_TEST_PAYABLE''
      AND l.source_line_id=d.source_record_id AND l.line_no=1 AND l.direction=''NONE''
      AND l.amount=source_row.amount AND l.party_ref=''WBS_TEST_VENDOR''
      AND l.external_dimension_refs->>''schema_version''=''WBS_TEST_IMPORT_LINE_V1''
      AND l.external_dimension_refs->>''test_only''=''true''
      AND l.external_dimension_refs->>''provenance_mode''=''UNSIGNED_TEST_ONLY''
      AND l.external_dimension_refs->>''observation_hash''=trace.observation_hash
      AND l.external_dimension_refs->>''source_record_hash''=p_source_record_hash
      AND l.external_dimension_refs->>''provider_content_sha256''=trace.provider_content_sha256
      AND (l.external_dimension_refs->>''row_index'')::integer=trace.row_index FOR SHARE OF d,l;',
    'AND l.amount=source_row.amount AND l.party_ref=source_row.vendor_no FOR SHARE OF d,l;');
  definition:=replace(definition,
    'AND journal_entry_id=trace.journal_entry_id AND account_code=''610000'' AND debit_amount=source_row.amount AND credit_amount=0
      AND member_ref IS NULL AND dimensions=''{}''::jsonb FOR SHARE;',
    'AND journal_entry_id=trace.journal_entry_id AND account_code=''610000'' AND debit_amount=source_row.amount AND credit_amount=0 FOR SHARE;');
  definition:=replace(definition,
    'AND member_ref=''WBS_TEST_VENDOR'' AND dimensions=''{}''::jsonb FOR SHARE;',
    'AND member_ref=source_row.vendor_no FOR SHARE;');
  definition:=replace(definition,
    'OR (SELECT count(*) FROM journal_line WHERE tenant_id=p_tenant AND entity_id=p_entity AND journal_entry_id=original.journal_entry_id)<>2
     OR (SELECT count(*) FROM source_link WHERE tenant_id=p_tenant AND entity_id=p_entity AND link_type=''SOURCE_TO_JE''
          AND source_document_id=trace.source_document_id AND journal_entry_id=original.journal_entry_id)<>1 THEN',
    'OR (SELECT count(*) FROM journal_line WHERE tenant_id=p_tenant AND entity_id=p_entity AND journal_entry_id=original.journal_entry_id)<>2 THEN');
  definition:=replace(definition,
    'debit_member:=debit_line->>''member_ref'';credit_member:=credit_line->>''member_ref'';
  IF credit_member IS DISTINCT FROM source_row.vendor_no OR credit_member=''WBS_TEST_VENDOR'' THEN
    RAISE EXCEPTION ''Approved WBS Payable credit member does not match the real staged vendor'' USING ERRCODE=''40001'';
  END IF;
  PERFORM 1 FROM member_master WHERE tenant_id=p_tenant AND entity_id=p_entity
    AND member_ref=credit_member AND member_type=''VENDOR'' AND active FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION ''Approved WBS Payable vendor member is unavailable'' USING ERRCODE=''23503''; END IF;
  PERFORM 1 FROM account_master WHERE tenant_id=p_tenant AND entity_id=p_entity
    AND account_code=credit_account AND active AND requires_member AND required_member_type=''VENDOR'' FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION ''Approved WBS Payable credit account is not an active Vendor-member account'' USING ERRCODE=''23503''; END IF;',
    'debit_member:=debit_line->>''member_ref'';credit_member:=credit_line->>''member_ref'';');
  definition:=replace(definition,
    'IF amount<>source_row.amount OR debit_account=credit_account THEN',
    'IF amount<>source_row.amount OR debit_account=credit_account OR debit_account=''610000'' AND credit_account=''291001'' THEN');
  definition:=replace(definition,
    'draft_lines:=draft_lines||jsonb_build_array(',
    'IF credit_account<>''291001'' OR credit_member IS DISTINCT FROM original_credit.member_ref OR credit_dimensions IS DISTINCT FROM original_credit.dimensions THEN
    draft_lines:=draft_lines||jsonb_build_array(');
  definition:=replace(definition,
    '    );
  IF jsonb_array_length(draft_lines)<>4 THEN
    RAISE EXCEPTION ''WBS H1 Payable vendor reclassification must contain exactly four lines'' USING ERRCODE=''23514'';
  END IF;

  child_key:=''wbs-h1-map:''||substr(p_request_hash,8,48);',
    '    );
  END IF;

  child_key:=''wbs-h1-map:''||substr(p_request_hash,8,48);');
  definition:=replace(definition,
    'original_journal_entry_id,journal_entry_id,request_hash,created_by,baseline_vendor_member_ref,target_vendor_member_ref)',
    'original_journal_entry_id,journal_entry_id,request_hash,created_by)');
  definition:=replace(definition,
    'trace.source_document_line_id,trace.attachment_id,original.journal_entry_id,journal_id,p_request_hash,actor,''WBS_TEST_VENDOR'',credit_member);',
    'trace.source_document_line_id,trace.attachment_id,original.journal_entry_id,journal_id,p_request_hash,actor);');
  definition:=replace(definition,
    '''source_document_id'',trace.source_document_id,''original_journal_entry_id'',original.journal_entry_id,''journal_entry_id'',journal_id,
    ''baseline_vendor_member_ref'',''WBS_TEST_VENDOR'',''target_vendor_member_ref'',credit_member,',
    '''source_document_id'',trace.source_document_id,''original_journal_entry_id'',original.journal_entry_id,''journal_entry_id'',journal_id,');

  EXECUTE definition;
END
$migration$;

ALTER TABLE wbs_h1_payable_reclass_draft_evidence
  DROP CONSTRAINT wbs_h1_payable_reclass_vendor_identity_ck,
  DROP COLUMN baseline_vendor_member_ref,
  DROP COLUMN target_vendor_member_ref;

COMMIT;
