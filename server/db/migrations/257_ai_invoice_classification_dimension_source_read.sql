BEGIN;

CREATE FUNCTION refs_read_ai_invoice_classification_source_v2(p_tenant uuid,p_entity uuid,p_period uuid,p_limit integer DEFAULT 100)
RETURNS TABLE(source_document_id uuid,source_document_line_id uuid,source_payload_hash text,source_line_hash text,entity_id uuid,accounting_period_id uuid,accounting_date date,vendor_ref text,vendor_member_ref text,invoice_no text,invoice_date date,currency text,amount text,service_period_start date,service_period_end date,description text,project_ref text,property_ref text,member_ref text,charge_code text,contract_id text,service_frequency text,source_attachment_count integer,source_attachment_ids uuid[],source_attachment_evidence jsonb,accounting_status text,posted_debit_account_classes text[])
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
BEGIN
  PERFORM refs_assert_scope(p_tenant,p_entity,'AI.ANALYSIS.EXPLAIN');
  IF p_limit IS NULL OR p_limit<1 OR p_limit>500 THEN RAISE EXCEPTION 'AI invoice classification source limit must be between 1 and 500' USING ERRCODE='22023'; END IF;
  IF NOT EXISTS(SELECT 1 FROM accounting_period p WHERE p.tenant_id=p_tenant AND p.entity_id=p_entity AND p.period_id=p_period AND p.ledger_code='PRIMARY') THEN RAISE EXCEPTION 'Authoritative primary accounting period is unavailable' USING ERRCODE='22023'; END IF;
  IF (SELECT count(*) FROM wbs_final1_retained_source_row r WHERE r.tenant_id=p_tenant AND r.entity_id=p_entity AND r.accounting_period_id=p_period AND r.domain='PAYABLES')>p_limit THEN RAISE EXCEPTION 'Complete invoice population exceeds the bounded classification limit' USING ERRCODE='54000'; END IF;
  RETURN QUERY
  SELECT d.source_document_id,l.source_document_line_id,d.payload_hash,r.raw_row_hash,p_entity,p_period,d.accounting_date,
         l.party_ref,CASE WHEN EXISTS(SELECT 1 FROM member_master mm WHERE mm.tenant_id=p_tenant AND mm.entity_id=p_entity AND mm.member_ref=l.party_ref AND mm.member_type='VENDOR' AND mm.active) THEN l.party_ref ELSE NULL END,d.document_no,(l.external_dimension_refs->>'signed_invoice_date')::date,d.currency::text,
         abs(l.amount)::text,NULLIF(l.external_dimension_refs->>'signed_service_period_start','')::date,
         NULLIF(l.external_dimension_refs->>'signed_service_period_end','')::date,
         NULLIF(l.external_dimension_refs->>'signed_invoice_description',''),l.project_ref,l.property_ref,NULL::text,
         NULLIF(l.external_dimension_refs->>'signed_charge_code',''),NULLIF(l.external_dimension_refs->>'signed_contract_id',''),NULLIF(l.external_dimension_refs->>'signed_service_frequency',''),
         (SELECT count(*)::integer FROM source_link sal JOIN attachment a ON a.tenant_id=sal.tenant_id AND a.entity_id=sal.entity_id AND a.attachment_id=sal.attachment_id WHERE sal.tenant_id=p_tenant AND sal.entity_id=p_entity AND sal.source_document_id=d.source_document_id AND sal.link_type='SOURCE_ATTACHMENT'),
         ARRAY(SELECT a.attachment_id FROM source_link sal JOIN attachment a ON a.tenant_id=sal.tenant_id AND a.entity_id=sal.entity_id AND a.attachment_id=sal.attachment_id WHERE sal.tenant_id=p_tenant AND sal.entity_id=p_entity AND sal.source_document_id=d.source_document_id AND sal.link_type='SOURCE_ATTACHMENT' ORDER BY a.attachment_id),
         COALESCE((SELECT jsonb_agg(jsonb_build_object('attachment_id',a.attachment_id,'content_hash',a.content_hash,'finalization_status',a.finalization_status,'scan_status',a.scan_status,'storage_version',a.storage_version) ORDER BY a.attachment_id) FROM source_link sal JOIN attachment a ON a.tenant_id=sal.tenant_id AND a.entity_id=sal.entity_id AND a.attachment_id=sal.attachment_id WHERE sal.tenant_id=p_tenant AND sal.entity_id=p_entity AND sal.source_document_id=d.source_document_id AND sal.link_type='SOURCE_ATTACHMENT'),'[]'::jsonb),
         CASE WHEN EXISTS(SELECT 1 FROM source_link sl JOIN journal_entry j ON j.tenant_id=sl.tenant_id AND j.entity_id=sl.entity_id AND j.journal_entry_id=sl.journal_entry_id WHERE sl.tenant_id=p_tenant AND sl.entity_id=p_entity AND sl.source_document_id=d.source_document_id AND j.status='POSTED') THEN 'POSTED' WHEN EXISTS(SELECT 1 FROM source_link sl JOIN journal_entry j ON j.tenant_id=sl.tenant_id AND j.entity_id=sl.entity_id AND j.journal_entry_id=sl.journal_entry_id WHERE sl.tenant_id=p_tenant AND sl.entity_id=p_entity AND sl.source_document_id=d.source_document_id) THEN 'DRAFT' ELSE 'NOT_RECORDED' END,
         ARRAY(SELECT DISTINCT CASE WHEN jl.account_code LIKE '1%' THEN 'ASSET' WHEN jl.account_code LIKE '2%' THEN 'LIABILITY' WHEN jl.account_code LIKE '3%' THEN 'EQUITY' WHEN jl.account_code LIKE '4%' THEN 'REVENUE' WHEN jl.account_code~'^[5-9]' THEN 'EXPENSE' ELSE 'UNCLASSIFIED' END
                 FROM source_link sl JOIN journal_entry j ON j.tenant_id=sl.tenant_id AND j.entity_id=sl.entity_id AND j.journal_entry_id=sl.journal_entry_id
                 JOIN journal_line jl ON jl.tenant_id=j.tenant_id AND jl.entity_id=j.entity_id AND jl.journal_entry_id=sl.journal_entry_id AND (sl.journal_line_id IS NULL OR sl.journal_line_id=jl.journal_line_id)
                WHERE sl.tenant_id=p_tenant AND sl.entity_id=p_entity AND sl.source_document_id=d.source_document_id AND j.status='POSTED' AND jl.debit_amount>0 ORDER BY 1)
    FROM wbs_final1_retained_source_row r
    JOIN source_document d ON d.tenant_id=r.tenant_id AND d.entity_id=r.entity_id AND d.source_document_id=r.source_document_id
    JOIN source_document_line l ON l.tenant_id=r.tenant_id AND l.entity_id=r.entity_id AND l.source_document_line_id=r.source_document_line_id AND l.source_document_id=r.source_document_id
   WHERE r.tenant_id=p_tenant AND r.entity_id=p_entity AND r.accounting_period_id=p_period AND r.domain='PAYABLES'
   ORDER BY d.accounting_date,d.source_document_id,l.line_no,l.source_document_line_id
   LIMIT p_limit;
END; $$;

REVOKE ALL ON FUNCTION refs_read_ai_invoice_classification_source_v2(uuid,uuid,uuid,integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION refs_read_ai_invoice_classification_source_v2(uuid,uuid,uuid,integer) TO refs_app;

CREATE FUNCTION refs_read_ai_account_master_bindings(p_tenant uuid,p_entity uuid,p_account_codes text[])
RETURNS TABLE(account_code text,requires_member boolean,required_member_type text,active boolean)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
BEGIN
  PERFORM refs_assert_scope(p_tenant,p_entity,'AI.ANALYSIS.EXPLAIN');
  IF p_account_codes IS NULL OR cardinality(p_account_codes)<1 OR cardinality(p_account_codes)>500 OR cardinality(p_account_codes)<>(SELECT count(DISTINCT value) FROM unnest(p_account_codes) value) OR EXISTS(SELECT 1 FROM unnest(p_account_codes) value WHERE value IS NULL OR btrim(value)='' OR length(value)>64) THEN RAISE EXCEPTION 'AI account-master binding read requires 1 to 500 unique account codes' USING ERRCODE='22023'; END IF;
  RETURN QUERY SELECT a.account_code,a.requires_member,a.required_member_type,a.active FROM account_master a WHERE a.tenant_id=p_tenant AND a.entity_id=p_entity AND a.account_code=ANY(p_account_codes) ORDER BY a.account_code;
END; $$;
REVOKE ALL ON FUNCTION refs_read_ai_account_master_bindings(uuid,uuid,text[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION refs_read_ai_account_master_bindings(uuid,uuid,text[]) TO refs_app;

ALTER FUNCTION refs_create_wbs_payable_ap_draft(uuid,uuid,uuid,uuid,bigint,text,uuid,uuid[],text,text,text) RENAME TO refs_create_wbs_payable_ap_draft_v096;
REVOKE ALL ON FUNCTION refs_create_wbs_payable_ap_draft_v096(uuid,uuid,uuid,uuid,bigint,text,uuid,uuid[],text,text,text) FROM PUBLIC,refs_app;

CREATE FUNCTION refs_create_wbs_payable_ap_draft(
  p_tenant uuid,p_entity uuid,p_row uuid,p_review uuid,p_expected_revision bigint,
  p_expected_evidence_hash text,p_mapping uuid,p_attachment_ids uuid[],p_reason text,
  p_idempotency_key text,p_request_hash text
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE source_id uuid;
BEGIN
  PERFORM refs_assert_scope(p_tenant,p_entity,'AP.BILL.CREATE');
  SELECT source_document_id INTO source_id FROM wbs_payable_review_evidence
   WHERE tenant_id=p_tenant AND entity_id=p_entity AND wbs_payable_review_evidence_id=p_review;
  IF source_id IS NULL THEN RAISE EXCEPTION 'Reviewed WBS Payable evidence not found' USING ERRCODE='P0002'; END IF;
  PERFORM 1 FROM source_document WHERE tenant_id=p_tenant AND entity_id=p_entity AND source_document_id=source_id FOR UPDATE;
  IF EXISTS(SELECT 1 FROM source_link sl WHERE sl.tenant_id=p_tenant AND sl.entity_id=p_entity AND sl.source_document_id=source_id AND sl.journal_entry_id IS NOT NULL)
     AND NOT EXISTS(SELECT 1 FROM wbs_payable_draft_evidence e JOIN source_link sl ON sl.tenant_id=e.tenant_id AND sl.entity_id=e.entity_id AND sl.journal_entry_id=e.journal_entry_id WHERE e.tenant_id=p_tenant AND e.entity_id=p_entity AND e.wbs_payable_review_evidence_id=p_review AND sl.source_document_id=source_id) THEN
    RAISE EXCEPTION 'Source already has accounting evidence' USING ERRCODE='40001';
  END IF;
  RETURN refs_create_wbs_payable_ap_draft_v096(p_tenant,p_entity,p_row,p_review,p_expected_revision,p_expected_evidence_hash,p_mapping,p_attachment_ids,p_reason,p_idempotency_key,p_request_hash);
END; $$;
REVOKE ALL ON FUNCTION refs_create_wbs_payable_ap_draft(uuid,uuid,uuid,uuid,bigint,text,uuid,uuid[],text,text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION refs_create_wbs_payable_ap_draft(uuid,uuid,uuid,uuid,bigint,text,uuid,uuid[],text,text,text) TO refs_app;

ALTER FUNCTION refs_create_ai_accounting_decision_draft(uuid,uuid,uuid,text,text,text,text,text) RENAME TO refs_create_ai_accounting_decision_draft_v254;
REVOKE ALL ON FUNCTION refs_create_ai_accounting_decision_draft_v254(uuid,uuid,uuid,text,text,text,text,text) FROM PUBLIC,refs_app;

CREATE FUNCTION refs_create_ai_accounting_decision_draft(p_tenant uuid,p_entity uuid,p_decision uuid,p_expected_decision_hash text,p_expected_acceptance_hash text,p_reason text,p_idempotency_key text,p_request_hash text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE d ai_accounting_decision; expected_attachments jsonb; actual_attachments jsonb; expected_accounts jsonb; actual_accounts jsonb; account_codes text[];
BEGIN
  PERFORM refs_assert_scope(p_tenant,p_entity,'GL.JE.CREATE');
  IF p_decision IS NULL OR p_expected_decision_hash IS NULL OR p_expected_decision_hash!~'^sha256:[0-9a-f]{64}$' OR p_expected_acceptance_hash IS NULL OR p_expected_acceptance_hash!~'^sha256:[0-9a-f]{64}$' OR p_reason IS NULL OR length(btrim(p_reason)) NOT BETWEEN 8 AND 2000 OR p_idempotency_key IS NULL OR length(p_idempotency_key) NOT BETWEEN 8 AND 200 OR p_request_hash IS NULL OR p_request_hash!~'^sha256:[0-9a-f]{64}$' THEN RAISE EXCEPTION 'Draft request evidence is incomplete or invalid' USING ERRCODE='22023'; END IF;
  SELECT * INTO d FROM ai_accounting_decision WHERE tenant_id=p_tenant AND entity_id=p_entity AND ai_accounting_decision_id=p_decision FOR SHARE;
  IF NOT FOUND OR d.decision_hash<>p_expected_decision_hash OR d.packet_status<>'READY_FOR_HUMAN_REVIEW' THEN RAISE EXCEPTION 'Exact accepted decision evidence is required' USING ERRCODE='40001'; END IF;
  PERFORM 1 FROM source_document sd WHERE sd.tenant_id=p_tenant AND sd.entity_id=p_entity AND sd.source_document_id=d.source_document_id FOR UPDATE;
  PERFORM 1 FROM wbs_final1_retained_source_row r WHERE r.tenant_id=p_tenant AND r.entity_id=p_entity AND r.accounting_period_id=d.period_id AND r.domain='PAYABLES' AND r.source_document_id=d.source_document_id FOR SHARE;
  PERFORM 1 FROM source_document_line sl WHERE sl.tenant_id=p_tenant AND sl.entity_id=p_entity AND sl.source_document_id=d.source_document_id AND sl.source_document_line_id=(d.packet#>>'{source,source_document_line_id}')::uuid FOR SHARE;
  PERFORM 1 FROM source_link sal WHERE sal.tenant_id=p_tenant AND sal.entity_id=p_entity AND sal.source_document_id=d.source_document_id FOR UPDATE;
  PERFORM 1 FROM journal_entry j WHERE j.tenant_id=p_tenant AND j.entity_id=p_entity AND EXISTS(SELECT 1 FROM source_link sl WHERE sl.tenant_id=j.tenant_id AND sl.entity_id=j.entity_id AND sl.source_document_id=d.source_document_id AND sl.journal_entry_id=j.journal_entry_id) FOR SHARE;
  PERFORM 1 FROM attachment a WHERE a.tenant_id=p_tenant AND a.entity_id=p_entity AND EXISTS(SELECT 1 FROM source_link sal WHERE sal.tenant_id=a.tenant_id AND sal.entity_id=a.entity_id AND sal.attachment_id=a.attachment_id AND sal.source_document_id=d.source_document_id AND sal.link_type='SOURCE_ATTACHMENT') FOR SHARE;
  LOCK TABLE ai_duplicate_payable_finding IN SHARE MODE;
  PERFORM 1 FROM ai_duplicate_payable_finding f WHERE f.tenant_id=p_tenant AND f.entity_id=p_entity AND f.status='OPEN' AND d.source_document_id IN(f.source_document_id,f.candidate_source_document_id) FOR SHARE;
  IF FOUND THEN RAISE EXCEPTION 'Duplicate payable evidence changed after AI decision' USING ERRCODE='40001'; END IF;
  IF NOT EXISTS(
    SELECT 1 FROM wbs_final1_retained_source_row r
    JOIN source_document sd ON sd.tenant_id=r.tenant_id AND sd.entity_id=r.entity_id AND sd.source_document_id=r.source_document_id
    JOIN source_document_line sl ON sl.tenant_id=r.tenant_id AND sl.entity_id=r.entity_id AND sl.source_document_id=r.source_document_id AND sl.source_document_line_id=r.source_document_line_id
    WHERE r.tenant_id=p_tenant AND r.entity_id=p_entity AND r.accounting_period_id=d.period_id AND r.domain='PAYABLES'
      AND r.source_document_id=d.source_document_id AND sl.source_document_line_id=(d.packet#>>'{source,source_document_line_id}')::uuid
      AND sd.payload_hash=d.packet#>>'{source,source_payload_hash}' AND r.raw_row_hash=d.packet#>>'{source,source_line_hash}'
      AND sd.accounting_date=(d.packet->>'accounting_date')::date AND sd.currency::text=d.packet#>>'{source,currency}'
      AND round(abs(sl.amount),4)=(d.packet#>>'{source,amount}')::numeric
      AND sl.party_ref IS NOT DISTINCT FROM d.packet#>>'{source,vendor_ref}'
      AND sl.project_ref IS NOT DISTINCT FROM d.packet#>>'{source,project_ref}'
      AND sl.property_ref IS NOT DISTINCT FROM d.packet#>>'{source,property_ref}'
      AND NULLIF(sl.external_dimension_refs->>'signed_charge_code','') IS NOT DISTINCT FROM d.packet#>>'{source,cost_code_ref}'
      AND (sl.external_dimension_refs->>'signed_invoice_date')::date=(d.packet#>>'{source,source_detail,invoice_date}')::date
  ) THEN RAISE EXCEPTION 'Retained source evidence changed after AI decision' USING ERRCODE='40001'; END IF;
  IF EXISTS(SELECT 1 FROM source_link sl JOIN journal_entry j ON j.tenant_id=sl.tenant_id AND j.entity_id=sl.entity_id AND j.journal_entry_id=sl.journal_entry_id WHERE sl.tenant_id=p_tenant AND sl.entity_id=p_entity AND sl.source_document_id=d.source_document_id)
     AND NOT EXISTS(SELECT 1 FROM ai_accounting_decision_draft_evidence e JOIN source_link sl ON sl.tenant_id=e.tenant_id AND sl.entity_id=e.entity_id AND sl.journal_entry_id=e.journal_entry_id WHERE e.tenant_id=p_tenant AND e.entity_id=p_entity AND e.ai_accounting_decision_id=p_decision AND sl.source_document_id=d.source_document_id) THEN
    RAISE EXCEPTION 'Source acquired accounting evidence after AI decision' USING ERRCODE='40001';
  END IF;

  expected_attachments:=d.packet#>'{source,source_detail,execution_evidence,attachments}';
  SELECT COALESCE(jsonb_agg(jsonb_build_object('attachment_id',a.attachment_id,'content_hash',a.content_hash,'finalization_status',a.finalization_status,'scan_status',a.scan_status,'storage_version',a.storage_version) ORDER BY a.attachment_id),'[]'::jsonb)
    INTO actual_attachments
    FROM source_link sal JOIN attachment a ON a.tenant_id=sal.tenant_id AND a.entity_id=sal.entity_id AND a.attachment_id=sal.attachment_id
   WHERE sal.tenant_id=p_tenant AND sal.entity_id=p_entity AND sal.source_document_id=d.source_document_id AND sal.link_type='SOURCE_ATTACHMENT';
  IF expected_attachments IS NULL OR actual_attachments<>expected_attachments OR jsonb_array_length(actual_attachments)<1 OR EXISTS(SELECT 1 FROM jsonb_array_elements(actual_attachments) item WHERE item->>'scan_status'<>'CLEAN' OR item->>'finalization_status'<>'VERIFIED_CLEAN') THEN RAISE EXCEPTION 'Decision-bound source attachment evidence changed or is not clean' USING ERRCODE='40001'; END IF;

  expected_accounts:=d.packet#>'{source,source_detail,execution_evidence,account_master}';
  SELECT array_agg(value ORDER BY value) INTO account_codes FROM jsonb_array_elements_text(jsonb_path_query_array(d.packet,'$.approved_account_policies[*].account_code')) value;
  PERFORM 1 FROM account_master a WHERE a.tenant_id=p_tenant AND a.entity_id=p_entity AND a.account_code=ANY(account_codes) FOR SHARE;
  SELECT COALESCE(jsonb_agg(jsonb_build_object('account_code',a.account_code,'active',a.active,'required_member_type',a.required_member_type,'requires_member',a.requires_member) ORDER BY a.account_code),'[]'::jsonb)
    INTO actual_accounts FROM account_master a WHERE a.tenant_id=p_tenant AND a.entity_id=p_entity AND a.account_code=ANY(account_codes);
  IF expected_accounts IS NULL OR actual_accounts<>expected_accounts OR jsonb_array_length(actual_accounts)<>cardinality(account_codes) OR EXISTS(SELECT 1 FROM jsonb_array_elements(actual_accounts) item WHERE (item->>'active')::boolean IS DISTINCT FROM true) THEN RAISE EXCEPTION 'Decision-bound account-master evidence changed or is not executable' USING ERRCODE='40001'; END IF;

  RETURN refs_create_ai_accounting_decision_draft_v254(p_tenant,p_entity,p_decision,p_expected_decision_hash,p_expected_acceptance_hash,p_reason,p_idempotency_key,p_request_hash);
END; $$;
REVOKE ALL ON FUNCTION refs_create_ai_accounting_decision_draft(uuid,uuid,uuid,text,text,text,text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION refs_create_ai_accounting_decision_draft(uuid,uuid,uuid,text,text,text,text,text) TO refs_app;

COMMIT;
