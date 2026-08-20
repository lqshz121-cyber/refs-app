BEGIN;

CREATE FUNCTION refs_read_ai_prepaid_balance_reconciliation_source(p_tenant uuid,p_entity uuid,p_period uuid)
RETURNS SETOF jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
BEGIN
  PERFORM refs_assert_scope(p_tenant,p_entity,'AI.ANALYSIS.EXPLAIN');
  IF NOT EXISTS(SELECT 1 FROM accounting_period WHERE tenant_id=p_tenant AND entity_id=p_entity AND period_id=p_period) THEN RAISE EXCEPTION 'Exact accounting period is required' USING ERRCODE='22023'; END IF;
  RETURN QUERY WITH period AS (
    SELECT period_id,period_code,ends_on FROM accounting_period WHERE tenant_id=p_tenant AND entity_id=p_entity AND period_id=p_period
  ), schedules AS (
    SELECT s.*,d.payload_hash current_payload_hash,d.version current_version,d.status source_status,p.period_id,p.period_code,p.ends_on,
      COALESCE((SELECT sum(sl.amount) FROM ai_amortization_schedule_line sl WHERE sl.tenant_id=s.tenant_id AND sl.entity_id=s.entity_id AND sl.ai_amortization_schedule_id=s.ai_amortization_schedule_id AND sl.amortization_month<=p.ends_on),0)::numeric(20,4) scheduled_recognized
    FROM ai_amortization_schedule s JOIN source_document d ON d.tenant_id=s.tenant_id AND d.entity_id=s.entity_id AND d.source_document_id=s.source_document_id CROSS JOIN period p
    WHERE s.tenant_id=p_tenant AND s.entity_id=p_entity AND s.rule_id='PREPAID_AMORTIZATION_V1' AND s.analysis_mode='DETERMINISTIC_EVIDENCE_BACKED'
  ), evidence AS (
    SELECT s.*,
      cap.amount capitalization_amount,cap.journal_entry_ids capitalization_je_ids,cap.journal_line_ids capitalization_jl_ids,cap.ledger_line_ids capitalization_ll_ids,
      COALESCE(amort.amount,0)::numeric(20,4) amortization_amount,COALESCE(amort.journal_entry_ids,ARRAY[]::uuid[]) amortization_je_ids,COALESCE(amort.journal_line_ids,ARRAY[]::uuid[]) amortization_jl_ids,COALESCE(amort.ledger_line_ids,ARRAY[]::uuid[]) amortization_ll_ids,COALESCE(amort.derived_source_document_ids,ARRAY[]::uuid[]) derived_source_ids
    FROM schedules s
    LEFT JOIN LATERAL (
      SELECT sum(ll.debit_amount)::numeric(20,4) amount,array_agg(DISTINCT j.journal_entry_id ORDER BY j.journal_entry_id) journal_entry_ids,array_agg(DISTINCT jl.journal_line_id ORDER BY jl.journal_line_id) journal_line_ids,array_agg(DISTINCT ll.ledger_line_id ORDER BY ll.ledger_line_id) ledger_line_ids
      FROM source_link link JOIN journal_entry j ON j.tenant_id=link.tenant_id AND j.entity_id=link.entity_id AND j.journal_entry_id=link.journal_entry_id AND j.status='POSTED' JOIN journal_line jl ON jl.tenant_id=j.tenant_id AND jl.entity_id=j.entity_id AND jl.journal_entry_id=j.journal_entry_id AND jl.account_code=s.prepaid_account_code AND jl.credit_amount=0 JOIN ledger_line ll ON ll.tenant_id=jl.tenant_id AND ll.entity_id=jl.entity_id AND ll.journal_entry_id=jl.journal_entry_id AND ll.journal_line_id=jl.journal_line_id AND ll.account_code=jl.account_code AND ll.debit_amount=jl.debit_amount AND ll.credit_amount=0
      WHERE link.tenant_id=s.tenant_id AND link.entity_id=s.entity_id AND link.source_document_id=s.source_document_id
    ) cap ON true
    LEFT JOIN LATERAL (
      SELECT sum(ll.credit_amount)::numeric(20,4) amount,array_agg(DISTINCT j.journal_entry_id ORDER BY j.journal_entry_id) journal_entry_ids,array_agg(DISTINCT jl.journal_line_id ORDER BY jl.journal_line_id) journal_line_ids,array_agg(DISTINCT ll.ledger_line_id ORDER BY ll.ledger_line_id) ledger_line_ids,array_agg(DISTINCT de.derived_source_document_id ORDER BY de.derived_source_document_id) derived_source_document_ids
      FROM ai_amortization_schedule_line sl JOIN insurance_prepaid_amortization_draft_evidence de ON de.tenant_id=sl.tenant_id AND de.entity_id=sl.entity_id AND de.ai_amortization_schedule_line_id=sl.ai_amortization_schedule_line_id JOIN journal_entry j ON j.tenant_id=de.tenant_id AND j.entity_id=de.entity_id AND j.journal_entry_id=de.journal_entry_id AND j.status='POSTED' AND j.journal_date<=s.ends_on JOIN journal_line jl ON jl.tenant_id=j.tenant_id AND jl.entity_id=j.entity_id AND jl.journal_entry_id=j.journal_entry_id AND jl.account_code=s.prepaid_account_code AND jl.debit_amount=0 JOIN ledger_line ll ON ll.tenant_id=jl.tenant_id AND ll.entity_id=jl.entity_id AND ll.journal_entry_id=jl.journal_entry_id AND ll.journal_line_id=jl.journal_line_id AND ll.account_code=jl.account_code AND ll.credit_amount=jl.credit_amount AND ll.debit_amount=0
      WHERE sl.tenant_id=s.tenant_id AND sl.entity_id=s.entity_id AND sl.ai_amortization_schedule_id=s.ai_amortization_schedule_id
    ) amort ON true
  )
  SELECT jsonb_build_object('period_id',period_id,'period_code',period_code,'ai_amortization_schedule_id',ai_amortization_schedule_id,'source_document_id',source_document_id,'source_payload_hash',source_payload_hash,'source_document_version',source_document_version,'currency',currency,'prepaid_account_code',prepaid_account_code,
    'reconciliation_status',CASE WHEN current_payload_hash<>source_payload_hash OR current_version<source_document_version OR source_status NOT IN('READY_FOR_DRAFT','DRAFT_CREATED','PENDING_JE_REVIEW','PENDING_JE_APPROVAL','APPROVED','POSTED') THEN 'BLOCKED_SOURCE_CHAIN' WHEN capitalization_amount IS NULL OR capitalization_je_ids IS NULL THEN 'BLOCKED_POSTED_CAPITALIZATION' WHEN amortization_amount<>0 AND amortization_je_ids='{}'::uuid[] THEN 'BLOCKED_POSTED_AMORTIZATION_LINEAGE' ELSE 'RECONCILED' END,
    'original_amount',CASE WHEN capitalization_amount IS NOT NULL THEN to_char(original_amount,'FM999999999999990.0000') END,'scheduled_recognized_to_date',CASE WHEN capitalization_amount IS NOT NULL THEN to_char(scheduled_recognized,'FM999999999999990.0000') END,'expected_unamortized_balance',CASE WHEN capitalization_amount IS NOT NULL THEN to_char(original_amount-scheduled_recognized,'FM999999999999990.0000') END,'posted_capitalization_amount',CASE WHEN capitalization_amount IS NOT NULL THEN to_char(capitalization_amount,'FM999999999999990.0000') END,'posted_amortization_to_date',CASE WHEN capitalization_amount IS NOT NULL THEN to_char(amortization_amount,'FM999999999999990.0000') END,'actual_source_bound_balance',CASE WHEN capitalization_amount IS NOT NULL THEN to_char(capitalization_amount-amortization_amount,'FM999999999999990.0000') END,'variance_amount',CASE WHEN capitalization_amount IS NOT NULL THEN to_char((capitalization_amount-amortization_amount)-(original_amount-scheduled_recognized),'FM999999999999990.0000') END,
    'capitalization_journal_entry_ids',COALESCE(capitalization_je_ids,ARRAY[]::uuid[]),'capitalization_journal_line_ids',COALESCE(capitalization_jl_ids,ARRAY[]::uuid[]),'capitalization_ledger_line_ids',COALESCE(capitalization_ll_ids,ARRAY[]::uuid[]),'amortization_journal_entry_ids',amortization_je_ids,'amortization_journal_line_ids',amortization_jl_ids,'amortization_ledger_line_ids',amortization_ll_ids,'derived_source_document_ids',derived_source_ids)
  FROM evidence ORDER BY ai_amortization_schedule_id;
END;$$;
REVOKE ALL ON FUNCTION refs_read_ai_prepaid_balance_reconciliation_source(uuid,uuid,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION refs_read_ai_prepaid_balance_reconciliation_source(uuid,uuid,uuid) TO refs_app;
COMMIT;
