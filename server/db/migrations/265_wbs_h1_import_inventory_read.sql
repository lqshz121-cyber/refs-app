BEGIN;

CREATE FUNCTION refs_read_wbs_h1_import_inventory(
  p_tenant uuid,p_entity uuid,p_limit integer DEFAULT 50,p_offset integer DEFAULT 0
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE result jsonb;
BEGIN
  PERFORM refs_assert_scope(p_tenant,p_entity,'WBS.AUTOREC.VIEW');
  IF p_limit IS NULL OR p_limit<1 OR p_limit>200 OR p_offset IS NULL OR p_offset<0 OR p_offset>10000000 THEN
    RAISE EXCEPTION 'WBS H1 inventory paging is invalid' USING ERRCODE='22023';
  END IF;

  WITH company AS (
    SELECT entity_code AS company_code,base_currency AS currency
    FROM entity
    WHERE tenant_id=p_tenant AND entity_id=p_entity AND active
      AND source_system='WBS' AND source_entity_id=entity_code
  ), source_rows AS (
    SELECT s.*,coalesce(c.cost_code,s.cost_code) AS exact_cost_code
    FROM wbs_h1_payable_mapping_source_stage s
    JOIN company c0 ON c0.company_code=s.company_code
    LEFT JOIN wbs_h1_payable_cost_code_stage c
      ON c.tenant_id=s.tenant_id AND c.entity_id=s.entity_id AND c.source_record_hash=s.source_record_hash
    WHERE s.tenant_id=p_tenant AND s.entity_id=p_entity
      AND s.period_code BETWEEN '2026-01' AND '2026-06'
      AND s.accounting_date BETWEEN DATE '2026-01-01' AND DATE '2026-06-30'
  ), classified AS (
    SELECT s.*,
      coalesce(m.mapping_match_count,0)::integer AS mapping_match_count,
      (d.source_record_hash IS NOT NULL) AS controlled_test_posted,
      coalesce(f.formal_mapping_posted,false) AS formal_mapping_posted
    FROM source_rows s
    LEFT JOIN LATERAL (
      SELECT count(*)::integer AS mapping_match_count
      FROM wbs_h1_accounting_setting_stage r
      WHERE r.tenant_id=s.tenant_id AND r.company_code=s.company_code
        AND r.business_type=4 AND r.category='Payable' AND r.setting_type='Debit'
        AND r.detail=coalesce(s.exact_cost_code,'')
        AND (r.project_codes='' OR s.project_code=ANY(regexp_split_to_array(r.project_codes,'\s*,\s*')))
        AND s.accounting_date BETWEEN r.effective_from AND r.effective_to
    ) m ON true
    LEFT JOIN wbs_test_import_draft d
      ON d.tenant_id=s.tenant_id AND d.entity_id=s.entity_id AND d.source_record_hash=s.source_record_hash
    LEFT JOIN LATERAL (
      SELECT true AS formal_mapping_posted
      FROM wbs_test_import_draft td
      JOIN source_link sl ON sl.tenant_id=td.tenant_id AND sl.entity_id=td.entity_id
        AND sl.source_document_id=td.source_document_id AND sl.link_type='SOURCE_TO_JE'
      JOIN journal_entry je ON je.tenant_id=sl.tenant_id AND je.entity_id=sl.entity_id
        AND je.journal_entry_id=sl.journal_entry_id AND je.status='POSTED' AND je.journal_number LIKE 'WBS-MAP-%'
      WHERE td.tenant_id=s.tenant_id AND td.entity_id=s.entity_id AND td.source_record_hash=s.source_record_hash
      LIMIT 1
    ) f ON true
  ), months AS (
    SELECT month_code,
      count(c.source_record_hash)::integer AS source_record_count,
      coalesce(to_char(sum(c.amount),'FM999999999999999999990.0000'),'0.0000') AS source_amount,
      count(*) FILTER(WHERE c.controlled_test_posted)::integer AS controlled_test_posted_count,
      count(*) FILTER(WHERE c.formal_mapping_posted)::integer AS formal_mapping_posted_count,
      count(*) FILTER(WHERE c.mapping_match_count=0)::integer AS mapping_missing_count,
      count(*) FILTER(WHERE c.mapping_match_count=1)::integer AS mapping_ready_count,
      count(*) FILTER(WHERE c.mapping_match_count>1)::integer AS mapping_ambiguous_count
    FROM (VALUES('2026-01'),('2026-02'),('2026-03'),('2026-04'),('2026-05'),('2026-06')) v(month_code)
    LEFT JOIN classified c ON c.period_code=v.month_code
    GROUP BY month_code
  ), totals AS (
    SELECT count(*)::integer AS source_record_count,
      coalesce(to_char(sum(amount),'FM999999999999999999990.0000'),'0.0000') AS source_amount,
      count(*) FILTER(WHERE controlled_test_posted)::integer AS controlled_test_posted_count,
      count(*) FILTER(WHERE formal_mapping_posted)::integer AS formal_mapping_posted_count,
      count(*) FILTER(WHERE mapping_match_count=0)::integer AS mapping_missing_count,
      count(*) FILTER(WHERE mapping_match_count=1)::integer AS mapping_ready_count,
      count(*) FILTER(WHERE mapping_match_count>1)::integer AS mapping_ambiguous_count
    FROM classified
  ), page AS (
    SELECT * FROM classified ORDER BY accounting_date,source_record_hash LIMIT p_limit OFFSET p_offset
  )
  SELECT jsonb_build_object(
    'schema_version','WBS_H1_IMPORT_INVENTORY_V1','company_code',c.company_code,'currency',c.currency,
    'date_from','2026-01-01','date_to','2026-06-30','limit',p_limit,'offset',p_offset,
    'totals',jsonb_build_object(
      'source_record_count',t.source_record_count,'source_amount',t.source_amount,
      'controlled_test_posted_count',t.controlled_test_posted_count,
      'formal_mapping_posted_count',t.formal_mapping_posted_count,
      'mapping_missing_count',t.mapping_missing_count,'mapping_ready_count',t.mapping_ready_count,
      'mapping_ambiguous_count',t.mapping_ambiguous_count),
    'months',(SELECT jsonb_agg(jsonb_build_object(
      'period_code',month_code,'source_record_count',source_record_count,'source_amount',source_amount,
      'controlled_test_posted_count',controlled_test_posted_count,'formal_mapping_posted_count',formal_mapping_posted_count,
      'mapping_missing_count',mapping_missing_count,'mapping_ready_count',mapping_ready_count,
      'mapping_ambiguous_count',mapping_ambiguous_count) ORDER BY month_code) FROM months),
    'rows',coalesce((SELECT jsonb_agg(jsonb_build_object(
      'source_record_hash',source_record_hash,'accounting_date',accounting_date::text,'amount',to_char(amount,'FM999999999999999999990.0000'),
      'project_code',project_code,'cost_code',exact_cost_code,'vendor_no',vendor_no,
      'import_state',CASE WHEN controlled_test_posted THEN 'CONTROLLED_TEST_POSTED' ELSE 'SOURCE_STAGED' END,
      'mapping_state',CASE WHEN formal_mapping_posted THEN 'FORMAL_MAPPING_POSTED' WHEN mapping_match_count=0 THEN 'MAPPING_MISSING' WHEN mapping_match_count=1 THEN 'MAPPING_READY_FOR_REVIEW' ELSE 'MAPPING_AMBIGUOUS' END
    ) ORDER BY accounting_date,source_record_hash) FROM page),'[]'::jsonb),
    'source_mode','REAL_WBS_STAGED','accounting_authority','NONE',
    'can_create_draft',false,'can_review',false,'can_approve',false,'can_post',false
  ) INTO result
  FROM company c CROSS JOIN totals t;

  IF result IS NULL THEN RAISE EXCEPTION 'WBS H1 company scope is unavailable' USING ERRCODE='P0002'; END IF;
  RETURN result;
END $$;

REVOKE ALL ON FUNCTION refs_read_wbs_h1_import_inventory(uuid,uuid,integer,integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION refs_read_wbs_h1_import_inventory(uuid,uuid,integer,integer) TO refs_app;

COMMIT;
