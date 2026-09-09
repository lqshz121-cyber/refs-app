BEGIN;

CREATE OR REPLACE FUNCTION refs_read_fixed_asset_movements(p_tenant uuid,p_entity uuid,p_asset uuid,p_as_of date,p_limit integer DEFAULT 50,p_cursor text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE asset fixed_asset_register_evidence;payload jsonb;after_id uuid;result jsonb;last_id uuid;
BEGIN
 PERFORM refs_assert_scope(p_tenant,p_entity,'FIXED_ASSET.REGISTER.VIEW');
 IF p_as_of IS NULL OR p_limit IS NULL OR p_limit<1 OR p_limit>100 THEN RAISE EXCEPTION 'Invalid asset movement read arguments' USING ERRCODE='22023';END IF;
 SELECT * INTO asset FROM fixed_asset_register_evidence WHERE tenant_id=p_tenant AND entity_id=p_entity AND fixed_asset_register_evidence_id=p_asset AND placed_in_service_date<=p_as_of;
 IF NOT FOUND THEN RAISE EXCEPTION 'Scoped effective asset is missing' USING ERRCODE='P0002';END IF;
 IF p_cursor IS NOT NULL THEN
  payload:=refs_asset_trace_cursor_read(p_cursor);BEGIN after_id:=(payload->>'after')::uuid;EXCEPTION WHEN OTHERS THEN RAISE EXCEPTION 'Invalid movement ordering key' USING ERRCODE='22023';END;
  IF payload IS DISTINCT FROM jsonb_build_object('version',1,'kind','ASSET_MOVEMENTS','tenant',p_tenant,'entity',p_entity,'asset',p_asset,'as_of',p_as_of,'after',after_id)
   OR NOT EXISTS(SELECT 1 FROM ledger_line l JOIN journal_entry j ON j.tenant_id=l.tenant_id AND j.entity_id=l.entity_id AND j.journal_entry_id=l.journal_entry_id AND j.status='POSTED' AND j.journal_date<=p_as_of JOIN accounting_period p ON p.tenant_id=j.tenant_id AND p.entity_id=j.entity_id AND p.period_id=j.period_id AND p.ledger_code='PRIMARY' WHERE l.tenant_id=p_tenant AND l.entity_id=p_entity AND l.ledger_line_id=after_id AND l.currency=asset.currency AND l.dimensions->>'fixed_asset_register_evidence_id'=p_asset::text) THEN RAISE EXCEPTION 'Asset movement cursor scope changed' USING ERRCODE='22023';END IF;
 END IF;
 WITH candidates AS MATERIALIZED(
  SELECT l.*,j.journal_number,j.journal_date,j.journal_type,j.posted_by
  FROM ledger_line l JOIN journal_entry j ON j.tenant_id=l.tenant_id AND j.entity_id=l.entity_id AND j.journal_entry_id=l.journal_entry_id AND j.status='POSTED' AND j.journal_date<=p_as_of
  JOIN accounting_period p ON p.tenant_id=j.tenant_id AND p.entity_id=j.entity_id AND p.period_id=j.period_id AND p.ledger_code='PRIMARY'
  WHERE l.tenant_id=p_tenant AND l.entity_id=p_entity AND l.currency=asset.currency AND l.dimensions->>'fixed_asset_register_evidence_id'=p_asset::text AND (after_id IS NULL OR l.ledger_line_id>after_id)
  ORDER BY l.ledger_line_id LIMIT p_limit+1
 ),page AS MATERIALIZED(SELECT * FROM candidates ORDER BY ledger_line_id LIMIT p_limit),journal_totals AS MATERIALIZED(
 SELECT jl.journal_entry_id,sum(jl.debit_amount)::text total_debit,sum(jl.credit_amount)::text total_credit,count(*) line_count FROM ledger_line jl JOIN (SELECT DISTINCT journal_entry_id FROM page) selected USING(journal_entry_id) WHERE jl.tenant_id=p_tenant AND jl.entity_id=p_entity GROUP BY jl.journal_entry_id
 ),rows AS(
 SELECT l.ledger_line_id,jsonb_build_object('ledger_line_id',l.ledger_line_id,'journal_line_id',l.journal_line_id,'journal_entry_id',l.journal_entry_id,'posting_batch_id',l.posting_batch_id,'accounting_period_id',l.period_id,
  'tenant_id',p_tenant,'entity_id',p_entity,'fixed_asset_register_evidence_id',p_asset,'as_of_date',p_as_of,'journal_number',l.journal_number,'journal_date',l.journal_date,'journal_type',l.journal_type,'journal_status','POSTED','posted_at',l.posted_at,'posted_by',l.posted_by,
  'journal_total_debit',totals.total_debit,'journal_total_credit',totals.total_credit,'journal_ledger_line_count',totals.line_count,
  'account_code',l.account_code,'currency',l.currency,'debit_amount',l.debit_amount::text,'credit_amount',l.credit_amount::text,'dimensions',l.dimensions,
  'account_role',CASE WHEN l.account_code=asset.asset_account_code THEN 'ASSET_COST' WHEN l.account_code=asset.accumulated_depreciation_account_code THEN 'ACCUMULATED_DEPRECIATION' WHEN l.account_code IN(SELECT accumulated_impairment_account_code FROM fixed_asset_impairment_assessment_evidence WHERE tenant_id=p_tenant AND entity_id=p_entity AND fixed_asset_register_evidence_id=p_asset AND assessment_date<=p_as_of) THEN 'ACCUMULATED_IMPAIRMENT' ELSE 'OTHER' END,
  'impairment_assessment_reference',l.dimensions->>'fixed_asset_impairment_assessment_evidence_id','impairment_assessment_evidence_id',assessment.fixed_asset_impairment_assessment_evidence_id,'valuation_source_document_id',assessment.valuation_source_document_id,'valuation_source_payload_hash',assessment.valuation_source_payload_hash,'impairment_assessment_hash',assessment.impairment_assessment_hash,'assessment_lineage_status',CASE WHEN assessment.fixed_asset_impairment_assessment_evidence_id IS NOT NULL THEN 'EXACT_RETAINED_ASSESSMENT' WHEN l.dimensions->>'fixed_asset_impairment_assessment_evidence_id' IS NOT NULL THEN 'BLOCKED_UNRESOLVED_REFERENCE' ELSE 'NOT_REFERENCED' END,
  'source_binding_status',CASE WHEN binding.binding_id IS NOT NULL AND sl.source_link_id IS NOT NULL THEN 'EXACT_DISPOSAL_SOURCE' ELSE 'BLOCKED_MISSING_EXACT_SOURCE_BINDING' END,
  'source_document_id',CASE WHEN sl.source_link_id IS NOT NULL THEN binding.source_document_id END,'source_payload_hash',CASE WHEN sl.source_link_id IS NOT NULL THEN binding.source_payload_hash END,'source_document_version',CASE WHEN sl.source_link_id IS NOT NULL THEN binding.source_document_version END,'source_link_id',sl.source_link_id,'disposal_binding_id',CASE WHEN sl.source_link_id IS NOT NULL THEN binding.binding_id END,
  'posting_audit_event_id',audit.audit_event_id,'posting_audit_event_count',coalesce(audit.event_count,0),
  'ledger_lineage_status',CASE WHEN ledger_trace.link_count=1 THEN 'EXACT' WHEN ledger_trace.link_count>1 THEN 'BLOCKED_AMBIGUOUS' ELSE 'BLOCKED_MISSING' END,'ledger_source_link_id',CASE WHEN ledger_trace.link_count=1 THEN ledger_trace.source_link_id END,'ledger_source_link_count',coalesce(ledger_trace.link_count,0)
 ) row_data
 FROM page l JOIN journal_totals totals ON totals.journal_entry_id=l.journal_entry_id
 LEFT JOIN fixed_asset_disposal_source_binding binding ON binding.tenant_id=p_tenant AND binding.entity_id=p_entity AND binding.fixed_asset_register_evidence_id=p_asset AND binding.journal_entry_id=l.journal_entry_id
 LEFT JOIN source_link sl ON sl.source_link_id=binding.source_link_id AND sl.tenant_id=p_tenant AND sl.entity_id=p_entity AND sl.link_type='SOURCE_TO_JE' AND sl.source_document_id=binding.source_document_id AND sl.journal_entry_id=l.journal_entry_id
 LEFT JOIN fixed_asset_impairment_assessment_evidence assessment ON assessment.tenant_id=p_tenant AND assessment.entity_id=p_entity AND assessment.fixed_asset_register_evidence_id=p_asset AND assessment.fixed_asset_impairment_assessment_evidence_id::text=l.dimensions->>'fixed_asset_impairment_assessment_evidence_id'
 LEFT JOIN LATERAL(SELECT link.source_link_id,count(*) OVER() link_count FROM source_link link WHERE link.tenant_id=p_tenant AND link.entity_id=p_entity AND link.link_type='JE_LINE_TO_LEDGER' AND link.journal_entry_id=l.journal_entry_id AND link.journal_line_id=l.journal_line_id AND link.posting_batch_id=l.posting_batch_id AND link.ledger_line_id=l.ledger_line_id ORDER BY link.source_link_id LIMIT 1) ledger_trace ON true
 LEFT JOIN LATERAL(SELECT a.audit_event_id,count(*) OVER() event_count FROM audit_event a WHERE a.tenant_id=p_tenant AND a.entity_id=p_entity AND a.object_id=l.journal_entry_id AND a.event_type='JOURNAL_POSTED' ORDER BY a.audit_event_id LIMIT 1) audit ON true
 ) SELECT jsonb_build_object('schema_version','FIXED_ASSET_MOVEMENTS_V1','tenant_id',p_tenant,'entity_id',p_entity,'fixed_asset_register_evidence_id',p_asset,'as_of_date',p_as_of,'basis','POSTED_PRIMARY_LEDGER','rows',coalesce((SELECT jsonb_agg(row_data ORDER BY ledger_line_id) FROM rows),'[]'::jsonb),'next_cursor',CASE WHEN (SELECT count(*) FROM candidates)>p_limit THEN (SELECT ledger_line_id FROM page ORDER BY ledger_line_id DESC LIMIT 1) ELSE NULL END) INTO result;
 last_id:=(result->>'next_cursor')::uuid;
 IF last_id IS NOT NULL THEN result:=jsonb_set(result,'{next_cursor}',to_jsonb(refs_asset_trace_cursor(jsonb_build_object('version',1,'kind','ASSET_MOVEMENTS','tenant',p_tenant,'entity',p_entity,'asset',p_asset,'as_of',p_as_of,'after',last_id))));END IF;
 RETURN result;
END;$$;
REVOKE ALL ON FUNCTION refs_read_fixed_asset_movements(uuid,uuid,uuid,date,integer,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION refs_read_fixed_asset_movements(uuid,uuid,uuid,date,integer,text) TO refs_app;

COMMIT;
