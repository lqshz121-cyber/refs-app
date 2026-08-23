BEGIN;

ALTER TABLE wbs_h1_payable_reclass_draft_evidence
  ADD COLUMN baseline_vendor_member_ref text,
  ADD COLUMN target_vendor_member_ref text,
  ADD CONSTRAINT wbs_h1_payable_reclass_vendor_identity_ck CHECK (
    (baseline_vendor_member_ref IS NULL AND target_vendor_member_ref IS NULL)
    OR (
      baseline_vendor_member_ref='WBS_TEST_VENDOR'
      AND NULLIF(btrim(target_vendor_member_ref),'') IS NOT NULL
      AND target_vendor_member_ref<>'WBS_TEST_VENDOR'
    )
  );

DO $migration$
DECLARE definition text;
BEGIN
  SELECT pg_get_functiondef(
    'public.refs_create_wbs_h1_payable_reclass_draft(uuid,uuid,uuid,text,text,text,text,text)'::regprocedure
  ) INTO definition;

  IF position('OR to_char(source_row.amount,''FM999999999999990.0000'')<>proposal_row->>''amount'' THEN' IN definition)=0
     OR position('AND l.amount=source_row.amount AND l.party_ref=source_row.vendor_no FOR SHARE OF d,l;' IN definition)=0
     OR position('AND member_ref=source_row.vendor_no FOR SHARE;' IN definition)=0
     OR position('IF credit_account<>''291001'' OR credit_member IS DISTINCT FROM original_credit.member_ref OR credit_dimensions IS DISTINCT FROM original_credit.dimensions THEN' IN definition)=0
     OR position('original_journal_entry_id,journal_entry_id,request_hash,created_by)' IN definition)=0 THEN
    RAISE EXCEPTION 'Migration 270 requires the exact migration 269 WBS H1 Payable Draft function' USING ERRCODE='55000';
  END IF;

  definition:=replace(definition,
    'OR to_char(source_row.amount,''FM999999999999990.0000'')<>proposal_row->>''amount'' THEN',
    'OR to_char(source_row.amount,''FM999999999999990.0000'')<>proposal_row->>''amount''
     OR NULLIF(btrim(source_row.vendor_no),'''') IS NULL OR source_row.vendor_no=''WBS_TEST_VENDOR'' THEN');

  definition:=replace(definition,
    'AND l.amount=source_row.amount AND l.party_ref=source_row.vendor_no FOR SHARE OF d,l;',
    'AND d.source_system=''WBS'' AND d.source_module=''payable'' AND d.document_type=''WBS_TEST_PAYABLE''
      AND l.source_line_id=d.source_record_id AND l.line_no=1 AND l.direction=''NONE''
      AND l.amount=source_row.amount AND l.party_ref=''WBS_TEST_VENDOR''
      AND l.external_dimension_refs->>''schema_version''=''WBS_TEST_IMPORT_LINE_V1''
      AND l.external_dimension_refs->>''test_only''=''true''
      AND l.external_dimension_refs->>''provenance_mode''=''UNSIGNED_TEST_ONLY''
      AND l.external_dimension_refs->>''observation_hash''=trace.observation_hash
      AND l.external_dimension_refs->>''source_record_hash''=p_source_record_hash
      AND l.external_dimension_refs->>''provider_content_sha256''=trace.provider_content_sha256
      AND (l.external_dimension_refs->>''row_index'')::integer=trace.row_index FOR SHARE OF d,l;');

  definition:=replace(definition,
    'AND journal_entry_id=trace.journal_entry_id AND account_code=''610000'' AND debit_amount=source_row.amount AND credit_amount=0 FOR SHARE;',
    'AND journal_entry_id=trace.journal_entry_id AND account_code=''610000'' AND debit_amount=source_row.amount AND credit_amount=0
      AND member_ref IS NULL AND dimensions=''{}''::jsonb FOR SHARE;');
  definition:=replace(definition,
    'AND member_ref=source_row.vendor_no FOR SHARE;',
    'AND member_ref=''WBS_TEST_VENDOR'' AND dimensions=''{}''::jsonb FOR SHARE;');
  definition:=replace(definition,
    'OR (SELECT count(*) FROM journal_line WHERE tenant_id=p_tenant AND entity_id=p_entity AND journal_entry_id=original.journal_entry_id)<>2 THEN',
    'OR (SELECT count(*) FROM journal_line WHERE tenant_id=p_tenant AND entity_id=p_entity AND journal_entry_id=original.journal_entry_id)<>2
     OR (SELECT count(*) FROM source_link WHERE tenant_id=p_tenant AND entity_id=p_entity AND link_type=''SOURCE_TO_JE''
          AND source_document_id=trace.source_document_id AND journal_entry_id=original.journal_entry_id)<>1 THEN');

  definition:=replace(definition,
    'debit_member:=debit_line->>''member_ref'';credit_member:=credit_line->>''member_ref'';',
    'debit_member:=debit_line->>''member_ref'';credit_member:=credit_line->>''member_ref'';
  IF credit_member IS DISTINCT FROM source_row.vendor_no OR credit_member=''WBS_TEST_VENDOR'' THEN
    RAISE EXCEPTION ''Approved WBS Payable credit member does not match the real staged vendor'' USING ERRCODE=''40001'';
  END IF;
  PERFORM 1 FROM member_master WHERE tenant_id=p_tenant AND entity_id=p_entity
    AND member_ref=credit_member AND member_type=''VENDOR'' AND active FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION ''Approved WBS Payable vendor member is unavailable'' USING ERRCODE=''23503''; END IF;
  PERFORM 1 FROM account_master WHERE tenant_id=p_tenant AND entity_id=p_entity
    AND account_code=credit_account AND active AND requires_member AND required_member_type=''VENDOR'' FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION ''Approved WBS Payable credit account is not an active Vendor-member account'' USING ERRCODE=''23503''; END IF;');

  definition:=replace(definition,
    'OR debit_account=''610000'' AND credit_account=''291001'' THEN',
    'THEN');

  definition:=replace(definition,
    'IF credit_account<>''291001'' OR credit_member IS DISTINCT FROM original_credit.member_ref OR credit_dimensions IS DISTINCT FROM original_credit.dimensions THEN
    draft_lines:=draft_lines||jsonb_build_array(',
    'draft_lines:=draft_lines||jsonb_build_array(');
  definition:=replace(definition,
    '    );
  END IF;

  child_key:=''wbs-h1-map:''||substr(p_request_hash,8,48);',
    '    );
  IF jsonb_array_length(draft_lines)<>4 THEN
    RAISE EXCEPTION ''WBS H1 Payable vendor reclassification must contain exactly four lines'' USING ERRCODE=''23514'';
  END IF;

  child_key:=''wbs-h1-map:''||substr(p_request_hash,8,48);');

  definition:=replace(definition,
    'original_journal_entry_id,journal_entry_id,request_hash,created_by)',
    'original_journal_entry_id,journal_entry_id,request_hash,created_by,baseline_vendor_member_ref,target_vendor_member_ref)');
  definition:=replace(definition,
    'trace.source_document_line_id,trace.attachment_id,original.journal_entry_id,journal_id,p_request_hash,actor);',
    'trace.source_document_line_id,trace.attachment_id,original.journal_entry_id,journal_id,p_request_hash,actor,''WBS_TEST_VENDOR'',credit_member);');
  definition:=replace(definition,
    '''source_document_id'',trace.source_document_id,''original_journal_entry_id'',original.journal_entry_id,''journal_entry_id'',journal_id,',
    '''source_document_id'',trace.source_document_id,''original_journal_entry_id'',original.journal_entry_id,''journal_entry_id'',journal_id,
    ''baseline_vendor_member_ref'',''WBS_TEST_VENDOR'',''target_vendor_member_ref'',credit_member,');

  EXECUTE definition;
END
$migration$;

COMMIT;
