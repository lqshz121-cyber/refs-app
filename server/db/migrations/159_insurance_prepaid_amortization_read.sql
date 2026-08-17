BEGIN;

-- Readiness is derived from the same retained facts consumed by migration 141.
-- It never upgrades an AI proposal into reviewed evidence and never creates a JE.
CREATE FUNCTION refs_read_insurance_prepaid_amortization(
  p_tenant uuid,p_entity uuid,p_period uuid,p_limit integer DEFAULT 50
) RETURNS SETOF jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
BEGIN
  PERFORM refs_assert_scope(p_tenant,p_entity,'GL.REPORT.VIEW');
  IF p_limit IS NULL OR p_limit<1 OR p_limit>100 THEN
    RAISE EXCEPTION 'Insurance prepaid amortization limit must be between 1 and 100' USING ERRCODE='22023';
  END IF;

  RETURN QUERY
  WITH evidence AS (
    SELECT s.*,sl.ai_amortization_schedule_line_id,sl.amortization_month,sl.amount,
      sl.status AS schedule_line_status,p.period_id,p.status AS period_status,
      d.payload_hash AS current_source_payload_hash,d.version AS current_source_version,d.status AS source_status,
      c.ai_amortization_coverage_evidence_id,c.coverage_hash,c.created_by AS coverage_created_by,
      a.wbs_provider_signed_payable_admission_id,
      ss.setting_snapshot_id,ss.snapshot_hash AS setting_snapshot_hash,
      ms.mapping_snapshot_id,ms.snapshot_hash AS mapping_snapshot_hash,
      cap.journal_entry_id AS capitalization_journal_entry_id,cap.journal_line_id AS capitalization_journal_line_id,
      cap.ledger_line_id AS capitalization_ledger_line_id,cap.created_by AS capitalization_created_by,
      cap.reviewed_by AS capitalization_reviewed_by,cap.approved_by AS capitalization_approved_by,cap.posted_by AS capitalization_posted_by,
      r.insurance_prepaid_amortization_review_id,r.evidence_hash AS review_evidence_hash,r.reviewed_by,r.reviewed_at,
      r.source_payload_hash AS reviewed_source_payload_hash,r.source_document_version AS reviewed_source_document_version,
      r.proposal_hash AS reviewed_proposal_hash,r.period_id AS reviewed_period_id,r.amortization_month AS reviewed_amortization_month,r.amount AS reviewed_amount,
      r.amortization_setting_snapshot_id AS reviewed_setting_snapshot_id,r.amortization_setting_snapshot_hash AS reviewed_setting_snapshot_hash,
      r.prepaid_mapping_snapshot_id AS reviewed_mapping_snapshot_id,r.prepaid_mapping_snapshot_hash AS reviewed_mapping_snapshot_hash,
      de.insurance_prepaid_amortization_draft_evidence_id,de.evidence_hash AS draft_evidence_hash,de.journal_entry_id,
      de.derived_source_document_id,de.created_by AS draft_created_by,de.created_at AS draft_created_at,
      je.status AS journal_status,je.revision AS journal_revision,
      (a.wbs_provider_signed_payable_admission_id IS NOT NULL
        AND c.ai_amortization_coverage_evidence_id IS NOT NULL
        AND c.source_payload_hash=s.source_payload_hash AND c.coverage_hash~'^sha256:[0-9a-f]{64}$'
        AND c.coverage_start=s.coverage_start AND c.coverage_end=s.coverage_end
        AND d.source_system='WBS' AND d.source_module='payable' AND d.document_type='WBS_PAYABLE'
        AND d.status IN ('READY_FOR_DRAFT','DRAFT_CREATED','PENDING_JE_REVIEW','PENDING_JE_APPROVAL','APPROVED','POSTED')
        AND d.payload_hash=s.source_payload_hash AND d.version>=s.source_document_version AND d.gross_amount=s.original_amount
        AND s.status='PROPOSED' AND sl.status='PROPOSED' AND sl.source_payload_hash=s.source_payload_hash
        AND ss.setting_snapshot_id IS NOT NULL AND ms.mapping_snapshot_id IS NOT NULL
        AND cap.ledger_line_id IS NOT NULL) AS review_chain_ready
    FROM ai_amortization_schedule s
    JOIN ai_amortization_schedule_line sl ON sl.tenant_id=s.tenant_id AND sl.entity_id=s.entity_id AND sl.ai_amortization_schedule_id=s.ai_amortization_schedule_id
    JOIN source_document d ON d.tenant_id=s.tenant_id AND d.entity_id=s.entity_id AND d.source_document_id=s.source_document_id
    JOIN accounting_period p ON p.tenant_id=s.tenant_id AND p.entity_id=s.entity_id AND p.period_id=p_period AND sl.amortization_month BETWEEN p.starts_on AND p.ends_on
    LEFT JOIN ai_amortization_coverage_evidence c ON c.tenant_id=s.tenant_id AND c.entity_id=s.entity_id AND c.source_document_id=s.source_document_id AND c.source_document_version=s.source_document_version
    LEFT JOIN LATERAL (
      SELECT admission.wbs_provider_signed_payable_admission_id
      FROM raw_event raw
      JOIN wbs_provider_signed_payable_admission admission ON admission.tenant_id=raw.tenant_id AND admission.entity_id=raw.entity_id AND admission.import_batch_id=raw.import_batch_id
      WHERE raw.tenant_id=d.tenant_id AND raw.entity_id=d.entity_id AND raw.raw_event_id=d.raw_event_id
      ORDER BY admission.admitted_at DESC,admission.wbs_provider_signed_payable_admission_id DESC LIMIT 1
    ) a ON true
    LEFT JOIN LATERAL (
      SELECT setting.setting_snapshot_id,setting.snapshot_hash
      FROM setting_snapshot setting
      WHERE setting.tenant_id=s.tenant_id AND setting.entity_id=s.entity_id
        AND setting.family='PREPAID_AMORTIZATION_POLICY' AND setting.status IN ('APPROVED','RETIRED')
        AND setting.snapshot->>'rule_id'='PREPAID_AMORTIZATION_V1' AND setting.snapshot->>'frequency'='MONTHLY'
        AND setting.snapshot_hash=refs_jsonb_hash(setting.snapshot)
        AND setting.effective_from::date<=p.ends_on AND (setting.effective_to IS NULL OR setting.effective_to::date>p.ends_on)
      ORDER BY setting.effective_from DESC,setting.version DESC,setting.setting_snapshot_id DESC LIMIT 1
    ) ss ON true
    LEFT JOIN LATERAL (
      SELECT mapping.mapping_snapshot_id,mapping.snapshot_hash
      FROM mapping_snapshot mapping
      WHERE mapping.tenant_id=s.tenant_id AND mapping.entity_id=s.entity_id
        AND mapping.family='PREPAID_ACCOUNT_CLASSIFICATION' AND mapping.status IN ('APPROVED','RETIRED')
        AND mapping.input_keys=jsonb_build_object('account_code',s.prepaid_account_code)
        AND mapping.output_rules->>'classification'='PREPAID' AND mapping.output_rules->>'prepaid_type'='INSURANCE'
        AND mapping.snapshot_hash=refs_jsonb_hash(jsonb_build_object('input_keys',mapping.input_keys,'output_rules',mapping.output_rules))
        AND mapping.effective_from::date<=p.ends_on AND (mapping.effective_to IS NULL OR mapping.effective_to::date>p.ends_on)
      ORDER BY mapping.priority DESC,mapping.effective_from DESC,mapping.version DESC,mapping.mapping_snapshot_id DESC LIMIT 1
    ) ms ON true
    LEFT JOIN LATERAL (
      SELECT j.journal_entry_id,j.created_by,j.reviewed_by,j.approved_by,j.posted_by,jl.journal_line_id,ll.ledger_line_id
      FROM source_link link
      JOIN journal_entry j ON j.tenant_id=link.tenant_id AND j.entity_id=link.entity_id AND j.journal_entry_id=link.journal_entry_id AND j.status='POSTED'
      JOIN journal_line jl ON jl.tenant_id=j.tenant_id AND jl.entity_id=j.entity_id AND jl.journal_entry_id=j.journal_entry_id
        AND jl.account_code=s.prepaid_account_code AND jl.debit_amount=s.original_amount AND jl.credit_amount=0
      JOIN ledger_line ll ON ll.tenant_id=jl.tenant_id AND ll.entity_id=jl.entity_id AND ll.journal_entry_id=jl.journal_entry_id
        AND ll.journal_line_id=jl.journal_line_id AND ll.account_code=jl.account_code AND ll.debit_amount=jl.debit_amount AND ll.credit_amount=0
      WHERE link.tenant_id=s.tenant_id AND link.entity_id=s.entity_id AND link.source_document_id=s.source_document_id
      ORDER BY j.posted_at DESC,j.journal_entry_id DESC LIMIT 1
    ) cap ON true
    LEFT JOIN insurance_prepaid_amortization_review r ON r.tenant_id=s.tenant_id AND r.entity_id=s.entity_id AND r.ai_amortization_schedule_line_id=sl.ai_amortization_schedule_line_id
    LEFT JOIN insurance_prepaid_amortization_draft_evidence de ON de.tenant_id=s.tenant_id AND de.entity_id=s.entity_id AND de.insurance_prepaid_amortization_review_id=r.insurance_prepaid_amortization_review_id
    LEFT JOIN journal_entry je ON je.tenant_id=de.tenant_id AND je.entity_id=de.entity_id AND je.journal_entry_id=de.journal_entry_id
    WHERE s.tenant_id=p_tenant AND s.entity_id=p_entity
    ORDER BY sl.amortization_month,s.ai_amortization_schedule_id,sl.line_no
    LIMIT p_limit
  ), readiness AS (
    SELECT evidence.*,
      (insurance_prepaid_amortization_review_id IS NOT NULL
        AND insurance_prepaid_amortization_draft_evidence_id IS NULL AND period_status='OPEN'
        AND reviewed_source_payload_hash=source_payload_hash AND current_source_payload_hash=reviewed_source_payload_hash
        AND reviewed_source_document_version=source_document_version AND current_source_version>=reviewed_source_document_version
        AND reviewed_proposal_hash=proposal_hash AND schedule_line_status='PROPOSED'
        AND reviewed_period_id=period_id AND reviewed_amortization_month=amortization_month AND reviewed_amount=amount
        AND reviewed_setting_snapshot_id=setting_snapshot_id AND reviewed_setting_snapshot_hash=setting_snapshot_hash
        AND reviewed_mapping_snapshot_id=mapping_snapshot_id AND reviewed_mapping_snapshot_hash=mapping_snapshot_hash) AS draft_chain_ready
    FROM evidence
  )
  SELECT jsonb_build_object(
    'ai_amortization_schedule_id',ai_amortization_schedule_id,'ai_amortization_schedule_line_id',ai_amortization_schedule_line_id,
    'source_document_id',source_document_id,'source_payload_hash',source_payload_hash,'source_document_version',source_document_version,
    'wbs_provider_signed_payable_admission_id',wbs_provider_signed_payable_admission_id,
    'ai_amortization_coverage_evidence_id',ai_amortization_coverage_evidence_id,'coverage_hash',coverage_hash,
    'proposal_hash',proposal_hash,'period_id',period_id,'period_status',period_status,'amortization_month',amortization_month,
    'amount',to_char(amount,'FM999999999999990.0000'),'currency',currency,'prepaid_account_code',prepaid_account_code,'expense_account_code',expense_account_code,
    'amortization_setting_snapshot_id',setting_snapshot_id,'amortization_setting_snapshot_hash',setting_snapshot_hash,
    'prepaid_mapping_snapshot_id',mapping_snapshot_id,'prepaid_mapping_snapshot_hash',mapping_snapshot_hash,
    'capitalization_journal_entry_id',capitalization_journal_entry_id,'capitalization_journal_line_id',capitalization_journal_line_id,'capitalization_ledger_line_id',capitalization_ledger_line_id,
    'insurance_prepaid_amortization_review_id',insurance_prepaid_amortization_review_id,'review_evidence_hash',review_evidence_hash,'reviewed_by',reviewed_by,'reviewed_at',reviewed_at,
    'insurance_prepaid_amortization_draft_evidence_id',insurance_prepaid_amortization_draft_evidence_id,'draft_evidence_hash',draft_evidence_hash,
    'journal_entry_id',journal_entry_id,'journal_status',journal_status,'journal_revision',journal_revision,
    'derived_source_document_id',derived_source_document_id,'draft_created_by',draft_created_by,'draft_created_at',draft_created_at,
    'readiness_status',CASE WHEN insurance_prepaid_amortization_draft_evidence_id IS NOT NULL THEN 'DRAFT_CREATED' WHEN draft_chain_ready THEN 'INDEPENDENTLY_REVIEWED' WHEN insurance_prepaid_amortization_review_id IS NOT NULL THEN 'REVIEWED_BLOCKED' WHEN review_chain_ready THEN 'READY_FOR_INDEPENDENT_REVIEW' ELSE 'BLOCKED' END,
    'blocked_reasons',to_jsonb(array_remove(ARRAY[
      CASE WHEN wbs_provider_signed_payable_admission_id IS NULL THEN 'SIGNED_ADMISSION_MISSING' END,
      CASE WHEN ai_amortization_coverage_evidence_id IS NULL THEN 'COVERAGE_EVIDENCE_MISSING' END,
      CASE WHEN setting_snapshot_id IS NULL THEN 'APPROVED_MONTHLY_SETTING_MISSING' END,
      CASE WHEN mapping_snapshot_id IS NULL THEN 'APPROVED_INSURANCE_PREPAID_MAPPING_MISSING' END,
      CASE WHEN capitalization_ledger_line_id IS NULL THEN 'POSTED_CAPITALIZATION_MISSING' END,
      CASE WHEN insurance_prepaid_amortization_review_id IS NULL AND NOT review_chain_ready
        AND wbs_provider_signed_payable_admission_id IS NOT NULL AND ai_amortization_coverage_evidence_id IS NOT NULL
        AND setting_snapshot_id IS NOT NULL AND mapping_snapshot_id IS NOT NULL AND capitalization_ledger_line_id IS NOT NULL
        THEN 'SOURCE_OR_PROPOSAL_CHAIN_MISMATCH' END,
      CASE WHEN insurance_prepaid_amortization_review_id IS NOT NULL AND period_status<>'OPEN' AND insurance_prepaid_amortization_draft_evidence_id IS NULL THEN 'PERIOD_NOT_OPEN' END,
      CASE WHEN insurance_prepaid_amortization_review_id IS NOT NULL AND NOT draft_chain_ready AND insurance_prepaid_amortization_draft_evidence_id IS NULL THEN 'REVIEWED_CHAIN_NOT_DRAFT_READY' END
    ]::text[],NULL)),
    'can_independently_review',insurance_prepaid_amortization_review_id IS NULL AND review_chain_ready
      AND refs_has_permission('PREPAID.AMORTIZATION.REVIEW')
      AND refs_current_actor() IS DISTINCT FROM created_by AND refs_current_actor() IS DISTINCT FROM coverage_created_by
      AND refs_current_actor() IS DISTINCT FROM capitalization_created_by AND refs_current_actor() IS DISTINCT FROM capitalization_reviewed_by
      AND refs_current_actor() IS DISTINCT FROM capitalization_approved_by AND refs_current_actor() IS DISTINCT FROM capitalization_posted_by,
    'can_create_draft',draft_chain_ready AND refs_has_permission('PREPAID.AMORTIZATION.DRAFT') AND refs_has_permission('GL.JE.AUTO.CREATE') AND refs_current_actor() IS DISTINCT FROM reviewed_by,
    'can_submit',false,'can_approve',false,'can_post',false
  )
  FROM readiness;
END;
$$;

REVOKE ALL ON FUNCTION refs_read_insurance_prepaid_amortization(uuid,uuid,uuid,integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION refs_read_insurance_prepaid_amortization(uuid,uuid,uuid,integer) TO refs_app;

COMMIT;
