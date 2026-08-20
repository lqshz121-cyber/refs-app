BEGIN;
CREATE FUNCTION refs_read_ai_security_deposit_liability_review(p_tenant uuid,p_entity uuid,p_period uuid) RETURNS SETOF jsonb LANGUAGE plpgsql SECURITY DEFINER STABLE SET search_path=pg_catalog,public,pg_temp AS $$
BEGIN
  PERFORM refs_assert_scope(p_tenant,p_entity,'AI.ANALYSIS.EXPLAIN');
  RETURN QUERY WITH eligible AS (
    SELECT sd.source_document_id,sdl.source_document_line_id,sd.payload_hash source_payload_hash,
      refs_jsonb_hash(jsonb_build_object('source_document_line_id',sdl.source_document_line_id,'source_line_id',sdl.source_line_id,'line_no',sdl.line_no,'amount',sdl.amount,'party_ref',sdl.party_ref,'property_ref',sdl.property_ref,'unit_ref',sdl.unit_ref,'external_dimension_refs',sdl.external_dimension_refs)) source_line_hash,
      sdl.amount deposit_amount,sdl.property_ref,sdl.unit_ref,sdl.external_dimension_refs->>'lease_ref' lease_ref,sdl.party_ref tenant_ref,sd.currency,re.mapping_snapshot_id,ms.snapshot_hash mapping_snapshot_hash,re.result->>'revenue_account_code' revenue_account_code,re.result->>'security_deposit_liability_account_code' liability_account_code
    FROM source_document sd JOIN source_document_line sdl ON sdl.tenant_id=sd.tenant_id AND sdl.entity_id=sd.entity_id AND sdl.source_document_id=sd.source_document_id
    JOIN rule_evaluation re ON re.tenant_id=sd.tenant_id AND re.source_document_id=sd.source_document_id AND re.rule_code='SECURITY_DEPOSIT_CLASSIFICATION_V1'
    JOIN mapping_snapshot ms ON ms.tenant_id=re.tenant_id AND ms.mapping_snapshot_id=re.mapping_snapshot_id AND ms.status='APPROVED' AND ms.family='SECURITY_DEPOSIT_ACCOUNTING' AND ms.entity_id=p_entity AND sd.accounting_date>=ms.effective_from::date AND (ms.effective_to IS NULL OR sd.accounting_date<ms.effective_to::date)
    WHERE sd.tenant_id=p_tenant AND sd.entity_id=p_entity AND sdl.external_dimension_refs->>'transaction_kind'='SECURITY_DEPOSIT' AND re.result->>'classification'='SECURITY_DEPOSIT_LIABILITY' AND jsonb_typeof(re.result)='object'
      AND EXISTS(SELECT 1 FROM accounting_period p WHERE p.tenant_id=p_tenant AND p.entity_id=p_entity AND p.period_id=p_period AND sd.accounting_date BETWEEN p.starts_on AND p.ends_on)
  ), posted AS (
    SELECT e.source_document_line_id,
      COALESCE(sum(CASE WHEN ll.account_code=e.revenue_account_code THEN ll.credit_amount-ll.debit_amount ELSE 0 END),0)::numeric(20,4) posted_revenue,
      COALESCE(sum(CASE WHEN ll.account_code=e.liability_account_code THEN ll.credit_amount-ll.debit_amount ELSE 0 END),0)::numeric(20,4) posted_liability,
      array_agg(DISTINCT ll.journal_entry_id ORDER BY ll.journal_entry_id) FILTER(WHERE ll.ledger_line_id IS NOT NULL) je_ids,array_agg(DISTINCT ll.journal_line_id ORDER BY ll.journal_line_id) FILTER(WHERE ll.ledger_line_id IS NOT NULL) jl_ids,array_agg(DISTINCT ll.ledger_line_id ORDER BY ll.ledger_line_id) FILTER(WHERE ll.ledger_line_id IS NOT NULL) ledger_ids
    FROM eligible e LEFT JOIN source_link sl ON sl.tenant_id=p_tenant AND sl.entity_id=p_entity AND sl.source_document_line_id=e.source_document_line_id AND sl.ledger_line_id IS NOT NULL
    LEFT JOIN ledger_line ll ON ll.tenant_id=sl.tenant_id AND ll.entity_id=sl.entity_id AND ll.ledger_line_id=sl.ledger_line_id
    LEFT JOIN journal_entry je ON je.tenant_id=ll.tenant_id AND je.entity_id=ll.entity_id AND je.journal_entry_id=ll.journal_entry_id AND je.period_id=p_period AND je.status='POSTED'
    WHERE ll.ledger_line_id IS NULL OR je.journal_entry_id IS NOT NULL GROUP BY e.source_document_line_id
  ) SELECT jsonb_build_object(
    'source_classification','SECURITY_DEPOSIT','mapping_status','APPROVED_EXACT','period_id',p_period,'source_document_id',e.source_document_id,'source_document_line_id',e.source_document_line_id,'source_payload_hash',e.source_payload_hash,'source_line_hash',e.source_line_hash,'mapping_snapshot_id',e.mapping_snapshot_id,'mapping_snapshot_hash',e.mapping_snapshot_hash,'property_ref',e.property_ref,'unit_ref',e.unit_ref,'lease_ref',e.lease_ref,'tenant_ref',e.tenant_ref,'currency',e.currency,'deposit_amount',to_char(e.deposit_amount,'FM999999999999990.0000'),'posted_revenue_amount',to_char(COALESCE(x.posted_revenue,0),'FM999999999999990.0000'),'posted_liability_amount',to_char(COALESCE(x.posted_liability,0),'FM999999999999990.0000'),'revenue_account_code',e.revenue_account_code,'security_deposit_liability_account_code',e.liability_account_code,'journal_entry_ids',COALESCE(x.je_ids,ARRAY[]::uuid[]),'journal_line_ids',COALESCE(x.jl_ids,ARRAY[]::uuid[]),'ledger_line_ids',COALESCE(x.ledger_ids,ARRAY[]::uuid[]),'lineage_status','SOURCE_LINE_BOUND_POSTED'
  ) FROM eligible e LEFT JOIN posted x ON x.source_document_line_id=e.source_document_line_id ORDER BY e.source_document_line_id;
END;$$;
REVOKE EXECUTE ON FUNCTION refs_read_ai_security_deposit_liability_review(uuid,uuid,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION refs_read_ai_security_deposit_liability_review(uuid,uuid,uuid) TO refs_app;
COMMIT;
