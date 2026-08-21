BEGIN;
CREATE FUNCTION refs_read_ai_fixed_asset_disposal_gap_source(p_tenant uuid,p_entity uuid,p_period uuid)
RETURNS SETOF jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
BEGIN
  PERFORM refs_assert_scope(p_tenant,p_entity,'AI.ANALYSIS.EXPLAIN');
  RETURN QUERY WITH p AS (
    SELECT period_id,period_code,starts_on,ends_on FROM accounting_period WHERE tenant_id=p_tenant AND entity_id=p_entity AND period_id=p_period AND ledger_code='PRIMARY'
  ), credits AS (
    SELECT r.fixed_asset_register_evidence_id,r.source_document_id,r.source_payload_hash,r.register_evidence_hash,r.asset_tag,r.currency,
      sum(l.credit_amount-l.debit_amount)::numeric(20,4) posted_credit,
      array_agg(DISTINCT l.journal_entry_id ORDER BY l.journal_entry_id) journal_entry_ids,
      array_agg(DISTINCT l.journal_line_id ORDER BY l.journal_line_id) journal_line_ids,
      array_agg(DISTINCT l.ledger_line_id ORDER BY l.ledger_line_id) ledger_line_ids
    FROM fixed_asset_register_evidence r CROSS JOIN p
    JOIN ledger_line l ON l.tenant_id=r.tenant_id AND l.entity_id=r.entity_id AND l.account_code=r.asset_account_code AND l.dimensions->>'fixed_asset_register_evidence_id'=r.fixed_asset_register_evidence_id::text
    JOIN journal_entry j ON j.tenant_id=l.tenant_id AND j.entity_id=l.entity_id AND j.journal_entry_id=l.journal_entry_id AND j.status='POSTED'
    WHERE r.tenant_id=p_tenant AND r.entity_id=p_entity AND r.status='ACTIVE' AND j.journal_date BETWEEN p.starts_on AND p.ends_on AND l.credit_amount>l.debit_amount
    GROUP BY r.fixed_asset_register_evidence_id,r.source_document_id,r.source_payload_hash,r.register_evidence_hash,r.asset_tag,r.currency
    HAVING sum(l.credit_amount-l.debit_amount)>0
  )
  SELECT jsonb_build_object('period_id',p.period_id,'period_code',p.period_code,'fixed_asset_register_evidence_id',c.fixed_asset_register_evidence_id,'source_document_id',c.source_document_id,'source_payload_hash',c.source_payload_hash,'register_evidence_hash',c.register_evidence_hash,'asset_tag',c.asset_tag,'currency',c.currency,'posted_asset_credit',to_char(c.posted_credit,'FM999999999999990.0000'),'journal_entry_ids',c.journal_entry_ids,'journal_line_ids',c.journal_line_ids,'ledger_line_ids',c.ledger_line_ids,'posted_source_document_ids',COALESCE((SELECT array_agg(DISTINCT sl.source_document_id ORDER BY sl.source_document_id) FROM source_link sl WHERE sl.tenant_id=p_tenant AND sl.entity_id=p_entity AND sl.journal_entry_id=ANY(c.journal_entry_ids) AND sl.source_document_id IS NOT NULL),ARRAY[]::uuid[]),'disposal_evidence_status','NOT_ESTABLISHED','lineage_status','ASSET_ID_BOUND_POSTED') FROM credits c CROSS JOIN p ORDER BY c.asset_tag;
END;$$;
REVOKE EXECUTE ON FUNCTION refs_read_ai_fixed_asset_disposal_gap_source(uuid,uuid,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION refs_read_ai_fixed_asset_disposal_gap_source(uuid,uuid,uuid) TO refs_app;
COMMIT;
