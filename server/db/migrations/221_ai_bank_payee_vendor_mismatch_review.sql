BEGIN;

CREATE FUNCTION refs_read_ai_bank_payee_vendor_policy(p_tenant uuid,p_entity uuid,p_period uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE period_end date;selected setting_snapshot;match_count integer;aliases jsonb;
BEGIN
  PERFORM refs_assert_ai_analysis_scope(p_tenant,p_entity);
  SELECT ends_on INTO period_end FROM accounting_period WHERE tenant_id=p_tenant AND entity_id=p_entity AND period_id=p_period;
  IF NOT FOUND THEN RAISE EXCEPTION 'Accounting period is outside bank payee/vendor policy scope' USING ERRCODE='22023';END IF;
  SELECT count(*) INTO match_count FROM setting_snapshot WHERE tenant_id=p_tenant AND entity_id=p_entity AND family='AI_BANK_PAYEE_VENDOR_POLICY' AND scope_type='ENTITY' AND scope_key=p_entity::text AND status='APPROVED' AND effective_from<=period_end::timestamptz AND(effective_to IS NULL OR effective_to>period_end::timestamptz);
  IF match_count=0 THEN RETURN NULL;END IF;IF match_count<>1 THEN RAISE EXCEPTION 'AI bank payee/vendor policy scope is ambiguous' USING ERRCODE='23514';END IF;
  SELECT * INTO selected FROM setting_snapshot WHERE tenant_id=p_tenant AND entity_id=p_entity AND family='AI_BANK_PAYEE_VENDOR_POLICY' AND scope_type='ENTITY' AND scope_key=p_entity::text AND status='APPROVED' AND effective_from<=period_end::timestamptz AND(effective_to IS NULL OR effective_to>period_end::timestamptz) FOR SHARE;
  aliases:=selected.snapshot->'approved_aliases_by_vendor';
  IF selected.snapshot_hash IS DISTINCT FROM refs_jsonb_hash(selected.snapshot)
    OR ARRAY(SELECT jsonb_object_keys(selected.snapshot) ORDER BY 1) IS DISTINCT FROM ARRAY['approved_aliases_by_vendor','policy_version','rule_id','schema_version']
    OR selected.snapshot->>'schema_version'<>'AI_BANK_PAYEE_VENDOR_POLICY_SNAPSHOT_V1' OR selected.snapshot->>'rule_id'<>'AI_BANK_PAYEE_VENDOR_APPROVED_ALIAS_V1'
    OR jsonb_typeof(selected.snapshot->'policy_version')<>'number' OR (selected.snapshot->>'policy_version')::integer<1 OR jsonb_typeof(aliases)<>'object'
    OR EXISTS(SELECT 1 FROM jsonb_each(aliases) item WHERE length(btrim(item.key)) NOT BETWEEN 1 AND 200 OR jsonb_typeof(item.value)<>'array' OR jsonb_array_length(item.value) NOT BETWEEN 1 AND 50 OR EXISTS(SELECT 1 FROM jsonb_array_elements(item.value) alias WHERE jsonb_typeof(alias)<>'string' OR length(btrim(alias#>>'{}')) NOT BETWEEN 1 AND 300))
  THEN RAISE EXCEPTION 'Approved AI bank payee/vendor policy is malformed or hash-invalid' USING ERRCODE='23514';END IF;
  RETURN jsonb_build_object('schema_version','AI_BANK_PAYEE_VENDOR_POLICY_V1','setting_snapshot_id',selected.setting_snapshot_id,'setting_snapshot_hash',selected.snapshot_hash,'policy_version',(selected.snapshot->>'policy_version')::integer,'approved_aliases_by_vendor',aliases);
END;$$;

CREATE FUNCTION refs_read_ai_bank_payee_vendor_matches(p_tenant uuid,p_entity uuid,p_period uuid,p_limit integer DEFAULT 500)
RETURNS TABLE(bank_match_id uuid,bank_match_hash text,match_status text,entity_id uuid,accounting_period_id uuid,bank_account_ref text,external_bank_line_id text,transaction_date date,currency char(3),amount numeric(20,4),bank_payee_name text,vendor_ref text,vendor_name text,bank_source_trace jsonb,invoice_source_trace jsonb,bank_admission_status text,invoice_admission_status text,bank_signature_verified boolean,invoice_signature_verified boolean)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE selected_period accounting_period;
BEGIN
  PERFORM refs_assert_ai_analysis_scope(p_tenant,p_entity);
  IF p_limit IS NULL OR p_limit<1 OR p_limit>500 THEN RAISE EXCEPTION 'AI bank payee/vendor source limit must be between 1 and 500' USING ERRCODE='22023';END IF;
  SELECT period.* INTO selected_period FROM accounting_period period WHERE period.tenant_id=p_tenant AND period.entity_id=p_entity AND period.period_id=p_period;
  IF NOT FOUND THEN RAISE EXCEPTION 'AI bank payee/vendor accounting period was not found' USING ERRCODE='23503';END IF;
  IF EXISTS(SELECT 1 FROM bank_match m JOIN bank_source b ON b.tenant_id=m.tenant_id AND b.entity_id=m.entity_id AND b.bank_source_id=m.bank_source_id JOIN business_document d ON d.tenant_id=m.tenant_id AND d.entity_id=m.entity_id AND d.source_document_id=m.business_source_document_id AND d.document_kind='AP_BILL' WHERE m.tenant_id=p_tenant AND m.entity_id=p_entity AND m.status='ACTIVE' AND b.transaction_date BETWEEN selected_period.starts_on AND selected_period.ends_on AND (SELECT count(*) FROM source_document_line l WHERE l.tenant_id=m.tenant_id AND l.entity_id=m.entity_id AND l.source_document_id=m.business_source_document_id)<>1) THEN RAISE EXCEPTION 'Matched AP invoice source must contain exactly one retained line for payee/vendor review' USING ERRCODE='23514';END IF;
  RETURN QUERY SELECT m.bank_match_id,
    refs_jsonb_hash(jsonb_build_object('schema_version','AI_BANK_PAYEE_VENDOR_MATCH_V1','bank_match_id',m.bank_match_id,'bank_source_id',b.bank_source_id,'business_source_document_id',m.business_source_document_id,'version',m.version,'status',m.status)),m.status::text,b.entity_id,selected_period.period_id,b.bank_account_ref,b.external_bank_line_id,b.transaction_date,b.currency,b.amount,btrim(bank_line.party_ref),d.counterparty_ref,d.counterparty_name,
    jsonb_build_object('source_document_id',bank_doc.source_document_id,'source_document_line_id',bank_line.source_document_line_id,'source_payload_hash',bank_doc.payload_hash,'source_line_hash',refs_jsonb_hash(jsonb_build_object('schema_version','AI_BANK_PAYEE_SOURCE_LINE_V1','source_document_line_id',bank_line.source_document_line_id,'line_no',bank_line.line_no,'party_ref',bank_line.party_ref,'description',bank_line.description,'amount',b.amount))),
    jsonb_build_object('source_document_id',invoice_doc.source_document_id,'source_document_line_id',invoice_line.source_document_line_id,'source_payload_hash',invoice_doc.payload_hash,'source_line_hash',refs_jsonb_hash(jsonb_build_object('schema_version','AI_INVOICE_VENDOR_SOURCE_LINE_V1','source_document_line_id',invoice_line.source_document_line_id,'line_no',invoice_line.line_no,'party_ref',invoice_line.party_ref,'description',invoice_line.description,'amount',invoice_line.amount))),
    bank_receipt.admission_status,'ADMITTED'::text,bank_receipt.signature_verified,true
  FROM bank_match m JOIN bank_source b ON b.tenant_id=m.tenant_id AND b.entity_id=m.entity_id AND b.bank_source_id=m.bank_source_id
  JOIN source_document bank_doc ON bank_doc.tenant_id=b.tenant_id AND bank_doc.entity_id=b.entity_id AND bank_doc.source_document_id=b.source_document_id
  JOIN source_document_line bank_line ON bank_line.tenant_id=b.tenant_id AND bank_line.entity_id=b.entity_id AND bank_line.source_document_id=b.source_document_id AND bank_line.source_document_line_id=b.source_line_id
  JOIN wbs_bank_statement_transaction bank_txn ON bank_txn.tenant_id=b.tenant_id AND bank_txn.entity_id=b.entity_id AND bank_txn.bank_source_id=b.bank_source_id
  JOIN wbs_bank_statement_receipt bank_receipt ON bank_receipt.tenant_id=bank_txn.tenant_id AND bank_receipt.entity_id=bank_txn.entity_id AND bank_receipt.wbs_bank_statement_receipt_id=bank_txn.wbs_bank_statement_receipt_id
  JOIN business_document d ON d.tenant_id=m.tenant_id AND d.entity_id=m.entity_id AND d.source_document_id=m.business_source_document_id AND d.document_kind='AP_BILL'
  JOIN source_document invoice_doc ON invoice_doc.tenant_id=d.tenant_id AND invoice_doc.entity_id=d.entity_id AND invoice_doc.source_document_id=d.source_document_id
  JOIN source_document_line invoice_line ON invoice_line.tenant_id=invoice_doc.tenant_id AND invoice_line.entity_id=invoice_doc.entity_id AND invoice_line.source_document_id=invoice_doc.source_document_id
  JOIN wbs_payable_draft_evidence draft_evidence ON draft_evidence.tenant_id=d.tenant_id AND draft_evidence.entity_id=d.entity_id AND draft_evidence.business_document_id=d.business_document_id AND draft_evidence.source_document_id=d.source_document_id
  JOIN wbs_payable_review_evidence review_evidence ON review_evidence.tenant_id=draft_evidence.tenant_id AND review_evidence.entity_id=draft_evidence.entity_id AND review_evidence.wbs_payable_review_evidence_id=draft_evidence.wbs_payable_review_evidence_id
  JOIN wbs_provider_signed_payable_admission provider_admission ON provider_admission.tenant_id=review_evidence.tenant_id AND provider_admission.entity_id=review_evidence.entity_id AND provider_admission.wbs_snapshot_import_id=review_evidence.wbs_snapshot_import_id
  WHERE m.tenant_id=p_tenant AND m.entity_id=p_entity AND m.status='ACTIVE' AND b.amount<0 AND b.transaction_date BETWEEN selected_period.starts_on AND selected_period.ends_on AND bank_receipt.admission_status='ADMITTED' AND bank_receipt.signature_verified=true AND btrim(coalesce(bank_line.party_ref,''))<>'' AND bank_doc.payload_hash~'^sha256:[0-9a-f]{64}$' AND invoice_doc.payload_hash~'^sha256:[0-9a-f]{64}$'
  ORDER BY b.transaction_date,b.bank_source_id LIMIT p_limit;
END;$$;

REVOKE ALL ON FUNCTION refs_read_ai_bank_payee_vendor_policy(uuid,uuid,uuid),refs_read_ai_bank_payee_vendor_matches(uuid,uuid,uuid,integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION refs_read_ai_bank_payee_vendor_policy(uuid,uuid,uuid),refs_read_ai_bank_payee_vendor_matches(uuid,uuid,uuid,integer) TO refs_app;
COMMIT;
