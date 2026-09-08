BEGIN;
CREATE INDEX fixed_asset_register_scope_page ON fixed_asset_register_evidence(tenant_id,entity_id,fixed_asset_register_evidence_id);
CREATE INDEX fixed_asset_ledger_scope_dimension ON ledger_line(tenant_id,entity_id,(dimensions->>'fixed_asset_register_evidence_id'),journal_entry_id);
CREATE FUNCTION refs_read_fixed_asset_register(p_tenant uuid,p_entity uuid,p_as_of date,p_limit integer DEFAULT 50,p_after uuid DEFAULT NULL,p_asset uuid DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE result jsonb;
BEGIN
 PERFORM refs_assert_scope(p_tenant,p_entity,'GL.REPORT.VIEW');
 IF p_as_of IS NULL OR p_limit IS NULL OR p_limit<1 OR p_limit>100 OR (p_asset IS NOT NULL AND p_after IS NOT NULL) THEN RAISE EXCEPTION 'Invalid fixed asset read date or pagination' USING ERRCODE='22023';END IF;
 WITH candidates AS MATERIALIZED(
  SELECT a.* FROM fixed_asset_register_evidence a WHERE a.tenant_id=p_tenant AND a.entity_id=p_entity
   AND (p_after IS NULL OR a.fixed_asset_register_evidence_id>p_after) AND (p_asset IS NULL OR a.fixed_asset_register_evidence_id=p_asset)
  ORDER BY a.fixed_asset_register_evidence_id LIMIT p_limit+1
 ), page AS MATERIALIZED(SELECT * FROM candidates ORDER BY fixed_asset_register_evidence_id LIMIT p_limit),
 rows AS(
  SELECT a.fixed_asset_register_evidence_id,jsonb_build_object(
   'fixed_asset_register_evidence_id',a.fixed_asset_register_evidence_id,'tenant_id',a.tenant_id,'entity_id',a.entity_id,
   'asset_tag',a.asset_tag,'asset_class',a.asset_class,'currency',a.currency,'cost_basis',a.cost_basis::text,'salvage_value',a.salvage_value::text,
   'placed_in_service_date',a.placed_in_service_date,'useful_life_months',a.useful_life_months,'depreciation_method',a.depreciation_method,'depreciation_convention',a.depreciation_convention,
   'asset_account_code',a.asset_account_code,'accumulated_depreciation_account_code',a.accumulated_depreciation_account_code,'depreciation_expense_account_code',a.depreciation_expense_account_code,
   'capitalization_proposal_id',a.capitalization_proposal_id,'source_document_id',a.source_document_id,'source_payload_hash',a.source_payload_hash,
   'register_evidence_hash',a.register_evidence_hash,'reviewed_by',a.reviewed_by,'reviewed_at',a.reviewed_at,'member_trace',a.member_trace,
   'posted_cost_balance',balances.cost::numeric(20,4)::text,'accumulated_depreciation',balances.depreciation::numeric(20,4)::text,
   'accumulated_impairment',balances.impairment::numeric(20,4)::text,'net_book_value',(balances.cost-balances.depreciation-balances.impairment)::numeric(20,4)::text,
   'posted_ledger_line_count',balances.line_count,'as_of_date',p_as_of,
   'status',CASE WHEN reviewed.fixed_asset_disposal_evidence_id IS NOT NULL THEN 'DISPOSED_REVIEWED' WHEN posted.journal_entry_id IS NOT NULL THEN 'DISPOSAL_POSTED' WHEN balances.line_count=0 THEN 'REGISTERED' ELSE 'ACTIVE' END,
   'disposal_journal_entry_id',posted.journal_entry_id,'disposal_binding_id',posted.binding_id,'fixed_asset_disposal_evidence_id',reviewed.fixed_asset_disposal_evidence_id,
   'disposal_date',coalesce(reviewed.disposal_date,posted.journal_date),'disposal_source_document_id',coalesce(reviewed.disposal_source_document_id,posted.source_document_id)
  ) row_data
  FROM page a
  LEFT JOIN LATERAL(
   SELECT coalesce(sum(l.debit_amount-l.credit_amount) FILTER(WHERE l.account_code=a.asset_account_code),0) cost,
    coalesce(sum(l.credit_amount-l.debit_amount) FILTER(WHERE l.account_code=a.accumulated_depreciation_account_code),0) depreciation,
    coalesce(sum(l.credit_amount-l.debit_amount) FILTER(WHERE l.account_code IN(SELECT e.accumulated_impairment_account_code FROM fixed_asset_impairment_assessment_evidence e WHERE e.tenant_id=p_tenant AND e.entity_id=p_entity AND e.fixed_asset_register_evidence_id=a.fixed_asset_register_evidence_id AND e.assessment_date<=p_as_of)),0) impairment,
    count(*) line_count
   FROM ledger_line l JOIN journal_entry j ON j.tenant_id=l.tenant_id AND j.entity_id=l.entity_id AND j.journal_entry_id=l.journal_entry_id AND j.status='POSTED' AND j.journal_date<=p_as_of
   JOIN accounting_period ap ON ap.tenant_id=j.tenant_id AND ap.entity_id=j.entity_id AND ap.period_id=j.period_id AND ap.ledger_code='PRIMARY'
   WHERE l.tenant_id=p_tenant AND l.entity_id=p_entity AND l.currency=a.currency AND l.dimensions->>'fixed_asset_register_evidence_id'=a.fixed_asset_register_evidence_id::text
  ) balances ON true
  LEFT JOIN LATERAL(
   SELECT p.journal_entry_id,p.binding_id,j.journal_date,b.source_document_id FROM fixed_asset_disposal_posting p
   JOIN journal_entry j ON j.tenant_id=p.tenant_id AND j.entity_id=p.entity_id AND j.journal_entry_id=p.journal_entry_id AND j.status='POSTED' AND j.journal_date<=p_as_of
   JOIN fixed_asset_disposal_source_binding b ON b.binding_id=p.binding_id
   WHERE p.tenant_id=p_tenant AND p.entity_id=p_entity AND p.fixed_asset_register_evidence_id=a.fixed_asset_register_evidence_id
  ) posted ON true
  LEFT JOIN fixed_asset_disposal_evidence reviewed ON reviewed.tenant_id=p_tenant AND reviewed.entity_id=p_entity AND reviewed.fixed_asset_register_evidence_id=a.fixed_asset_register_evidence_id AND reviewed.disposal_date<=p_as_of
 )
 SELECT jsonb_build_object('schema_version','FIXED_ASSET_REGISTER_READ_V1','tenant_id',p_tenant,'entity_id',p_entity,'as_of_date',p_as_of,
  'basis','POSTED_PRIMARY_LEDGER','rows',coalesce((SELECT jsonb_agg(row_data ORDER BY fixed_asset_register_evidence_id) FROM rows),'[]'::jsonb),
  'next_cursor',CASE WHEN (SELECT count(*) FROM candidates)>p_limit THEN (SELECT fixed_asset_register_evidence_id FROM page ORDER BY fixed_asset_register_evidence_id DESC LIMIT 1) ELSE NULL END)
 INTO result;RETURN result;
END;$$;
REVOKE ALL ON FUNCTION refs_read_fixed_asset_register(uuid,uuid,date,integer,uuid,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION refs_read_fixed_asset_register(uuid,uuid,date,integer,uuid,uuid) TO refs_app;
COMMIT;
