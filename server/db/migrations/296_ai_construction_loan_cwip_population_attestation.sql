BEGIN;

-- Derive the eligible universe from every account with current-period POSTED
-- ledger activity plus every effective highest-priority target mapping key.
-- Exact requested-period identity gates current activity; a date that merely
-- falls in an overlapping PRIMARY period cannot be relabelled. Unmapped
-- ledger accounts remain visible; an empty mapping table can never
-- manufacture NOT_APPLICABLE.
CREATE FUNCTION refs_read_ai_construction_loan_cwip_population_attestation(
  p_tenant uuid,p_entity uuid,p_period uuid
) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE v_result jsonb;
BEGIN
  PERFORM public.refs_assert_ai_analysis_scope(p_tenant,p_entity);
  WITH period_scope AS MATERIALIZED (
    SELECT p.period_id,p.period_code,p.starts_on,p.ends_on,e.base_currency::text currency
    FROM public.accounting_period p JOIN public.entity e ON e.tenant_id=p.tenant_id AND e.entity_id=p.entity_id
    WHERE p.tenant_id=p_tenant AND p.entity_id=p_entity AND p.period_id=p_period
      AND p.ledger_code='PRIMARY' AND e.active
  ), posted_lines AS MATERIALIZED (
    SELECT l.account_code,l.ledger_line_id,l.journal_line_id,l.journal_entry_id,l.posting_batch_id,
      l.debit_amount,l.credit_amount,j.journal_date,j.posted_at,
      (j.period_id=p.period_id OR l.period_id=p.period_id OR b.period_id=p.period_id OR j.journal_date BETWEEN p.starts_on AND p.ends_on) current_candidate,
      (j.period_id=p.period_id AND l.period_id=p.period_id AND b.period_id=p.period_id
        AND j.journal_date BETWEEN p.starts_on AND p.ends_on) current_exact,
      (j.period_id=l.period_id AND l.period_id=b.period_id AND hp.period_id=j.period_id AND hp.ledger_code='PRIMARY'
        AND j.journal_date BETWEEN hp.starts_on AND hp.ends_on AND j.currency::text=p.currency AND l.currency::text=p.currency
        AND (j.journal_date<p.starts_on OR (j.period_id=p.period_id AND l.period_id=p.period_id AND b.period_id=p.period_id))) history_valid,
      EXISTS(SELECT 1 FROM public.source_link sl WHERE sl.tenant_id=p_tenant
        AND sl.entity_id=p_entity AND sl.link_type='JE_LINE_TO_LEDGER' AND sl.journal_entry_id=l.journal_entry_id
        AND sl.journal_line_id=l.journal_line_id AND sl.posting_batch_id=l.posting_batch_id
        AND sl.ledger_line_id=l.ledger_line_id) has_line_link,
      EXISTS(SELECT 1 FROM public.source_link sl WHERE sl.tenant_id=p_tenant
        AND sl.entity_id=p_entity AND sl.journal_entry_id=j.journal_entry_id AND sl.source_document_id IS NOT NULL) has_source
    FROM public.ledger_line l JOIN public.journal_entry j ON j.tenant_id=l.tenant_id AND j.entity_id=l.entity_id
      AND j.journal_entry_id=l.journal_entry_id JOIN public.posting_batch b ON b.tenant_id=l.tenant_id
      AND b.entity_id=l.entity_id AND b.posting_batch_id=l.posting_batch_id
    LEFT JOIN public.accounting_period hp ON hp.tenant_id=l.tenant_id AND hp.entity_id=l.entity_id AND hp.period_id=j.period_id
    CROSS JOIN period_scope p
    WHERE l.tenant_id=p_tenant AND l.entity_id=p_entity AND j.status='POSTED' AND j.journal_date<=p.ends_on
  ), effective_mappings AS MATERIALIZED (
    SELECT m.input_keys->>'account_code' account_code,m.family,m.mapping_snapshot_id,m.version::text mapping_version,m.snapshot_hash,
      m.output_rules->>'classification' classification,m.priority,
      dense_rank()OVER(PARTITION BY m.input_keys->>'account_code',m.family ORDER BY m.priority DESC) priority_rank
    FROM period_scope p JOIN public.mapping_snapshot m ON m.tenant_id=p_tenant
      AND m.entity_id=p_entity AND m.family IN('CONSTRUCTION_LOAN_ACCOUNT_CLASSIFICATION','CWIP_ACCOUNT_CLASSIFICATION')
      AND m.status IN('APPROVED','RETIRED') AND jsonb_typeof(m.input_keys)='object'
      AND m.input_keys=jsonb_build_object('account_code',m.input_keys->>'account_code')
      AND NULLIF(btrim(m.input_keys->>'account_code'),'') IS NOT NULL
      AND m.effective_from::date<=p.ends_on AND(m.effective_to IS NULL OR m.effective_to::date>p.ends_on)
  ), highest AS MATERIALIZED (SELECT * FROM effective_mappings WHERE priority_rank=1), universe AS MATERIALIZED (
    SELECT DISTINCT l.account_code FROM posted_lines l WHERE l.current_candidate
    UNION SELECT DISTINCT h.account_code FROM highest h
  ), mapping_state AS MATERIALIZED (
    SELECT u.account_code,
      count(h.mapping_snapshot_id)FILTER(WHERE h.family='CONSTRUCTION_LOAN_ACCOUNT_CLASSIFICATION')::integer loan_candidates,
      count(h.mapping_snapshot_id)FILTER(WHERE h.family='CWIP_ACCOUNT_CLASSIFICATION')::integer cwip_candidates,
      (array_agg(h.mapping_snapshot_id ORDER BY h.mapping_snapshot_id)FILTER(WHERE h.family='CONSTRUCTION_LOAN_ACCOUNT_CLASSIFICATION'))[1] loan_mapping_id,
      min(h.mapping_version)FILTER(WHERE h.family='CONSTRUCTION_LOAN_ACCOUNT_CLASSIFICATION') loan_mapping_version,
      min(h.snapshot_hash)FILTER(WHERE h.family='CONSTRUCTION_LOAN_ACCOUNT_CLASSIFICATION') loan_mapping_hash,
      COALESCE(min(h.classification)FILTER(WHERE h.family='CONSTRUCTION_LOAN_ACCOUNT_CLASSIFICATION'),'') loan_classification,
      (array_agg(h.mapping_snapshot_id ORDER BY h.mapping_snapshot_id)FILTER(WHERE h.family='CWIP_ACCOUNT_CLASSIFICATION'))[1] cwip_mapping_id,
      min(h.mapping_version)FILTER(WHERE h.family='CWIP_ACCOUNT_CLASSIFICATION') cwip_mapping_version,
      min(h.snapshot_hash)FILTER(WHERE h.family='CWIP_ACCOUNT_CLASSIFICATION') cwip_mapping_hash,
      COALESCE(min(h.classification)FILTER(WHERE h.family='CWIP_ACCOUNT_CLASSIFICATION'),'') cwip_classification
    FROM universe u LEFT JOIN highest h ON h.account_code=u.account_code GROUP BY u.account_code
  ), evidence AS MATERIALIZED (
    SELECT s.*,p.currency,COALESCE(a.account_name,'Unmapped account') account_name,
      COALESCE(sum(CASE WHEN l.history_valid AND l.journal_date<p.starts_on THEN l.debit_amount-l.credit_amount ELSE 0 END),0)::numeric(20,4) debit_opening,
      COALESCE(sum(CASE WHEN l.history_valid AND l.journal_date<p.starts_on THEN l.credit_amount-l.debit_amount ELSE 0 END),0)::numeric(20,4) credit_opening,
      COALESCE(sum(CASE WHEN l.history_valid AND l.journal_date BETWEEN p.starts_on AND p.ends_on THEN l.debit_amount ELSE 0 END),0)::numeric(20,4) period_debit,
      COALESCE(sum(CASE WHEN l.history_valid AND l.journal_date BETWEEN p.starts_on AND p.ends_on THEN l.credit_amount ELSE 0 END),0)::numeric(20,4) period_credit,
      COALESCE(sum(CASE WHEN l.history_valid AND l.journal_date<=p.ends_on THEN l.debit_amount-l.credit_amount ELSE 0 END),0)::numeric(20,4) debit_closing,
      COALESCE(sum(CASE WHEN l.history_valid AND l.journal_date<=p.ends_on THEN l.credit_amount-l.debit_amount ELSE 0 END),0)::numeric(20,4) credit_closing,
      COALESCE(array_agg(DISTINCT l.journal_entry_id ORDER BY l.journal_entry_id)FILTER(WHERE l.history_valid),ARRAY[]::uuid[]) journal_entry_ids,
      COALESCE(array_agg(DISTINCT l.journal_line_id ORDER BY l.journal_line_id)FILTER(WHERE l.history_valid),ARRAY[]::uuid[]) journal_line_ids,
      COALESCE(array_agg(DISTINCT l.ledger_line_id ORDER BY l.ledger_line_id)FILTER(WHERE l.history_valid),ARRAY[]::uuid[]) ledger_line_ids,
      COALESCE(array_agg(DISTINCT l.posting_batch_id ORDER BY l.posting_batch_id)FILTER(WHERE l.history_valid),ARRAY[]::uuid[]) posting_batch_ids,
      count(l.ledger_line_id)FILTER(WHERE l.current_exact)::integer current_activity_line_count,
      COALESCE(bool_or(l.history_valid IS NOT TRUE OR NOT l.has_line_link OR NOT l.has_source)FILTER(WHERE l.ledger_line_id IS NOT NULL),false) missing_source_lineage,
      max(l.posted_at)FILTER(WHERE l.current_exact) posted_watermark
    FROM mapping_state s CROSS JOIN period_scope p LEFT JOIN posted_lines l ON l.account_code=s.account_code
    LEFT JOIN public.account_master a ON a.tenant_id=p_tenant AND a.entity_id=p_entity AND a.account_code=s.account_code AND a.active
    GROUP BY s.account_code,s.loan_candidates,s.cwip_candidates,s.loan_mapping_id,s.loan_mapping_version,
      s.loan_mapping_hash,s.loan_classification,s.cwip_mapping_id,s.cwip_mapping_version,s.cwip_mapping_hash,
      s.cwip_classification,p.currency,a.account_name
  ), classified AS MATERIALIZED (
    SELECT e.*,
      e.loan_candidates=1 AND e.cwip_candidates=1 AND e.loan_classification='CONSTRUCTION_LOAN'
        AND e.cwip_classification='NOT_CWIP' mapped_loan,
      e.cwip_candidates=1 AND e.loan_candidates=1 AND e.cwip_classification='CWIP'
        AND e.loan_classification='NOT_CONSTRUCTION_LOAN' mapped_cwip,
      e.loan_candidates=1 AND e.cwip_candidates=1 AND e.loan_classification='NOT_CONSTRUCTION_LOAN'
        AND e.cwip_classification='NOT_CWIP' explicit_non_target,
      e.loan_candidates>1 OR e.cwip_candidates>1 OR
        (e.loan_candidates=1 AND e.cwip_candidates=1 AND e.loan_classification='CONSTRUCTION_LOAN'
          AND e.cwip_classification='CWIP') ambiguous,
      NOT (e.loan_candidates=1 AND e.cwip_candidates=1 AND
        ((e.loan_classification='CONSTRUCTION_LOAN' AND e.cwip_classification='NOT_CWIP') OR
         (e.loan_classification='NOT_CONSTRUCTION_LOAN' AND e.cwip_classification='CWIP') OR
         (e.loan_classification='NOT_CONSTRUCTION_LOAN' AND e.cwip_classification='NOT_CWIP'))) missing_mapping
    FROM evidence e
  ), rows AS MATERIALIZED (
    SELECT
      COALESCE(jsonb_agg(jsonb_build_object('period_id',p.period_id,'period_code',p.period_code,
        'period_start',to_char(p.starts_on,'YYYY-MM-DD'),'period_end',to_char(p.ends_on,'YYYY-MM-DD'),
        'account_code',c.account_code,'account_name',c.account_name,'currency',c.currency,'mapping_status','MAPPED_CONSTRUCTION_LOAN_ACCOUNT',
        'activity_status',CASE WHEN c.current_activity_line_count=0 THEN 'ZERO_CURRENT_PERIOD_ACTIVITY' ELSE 'CURRENT_PERIOD_ACTIVITY' END,
        'current_activity_line_count',c.current_activity_line_count,
        'classification','CONSTRUCTION_LOAN','opposite_classification','NOT_CWIP',
        'classification_basis','APPROVED_CONSTRUCTION_LOAN_ACCOUNT_MAPPING_SNAPSHOT_EXACT',
        'opening_balance',to_char(c.credit_opening,'FM9999999999999990.0000'),
        'period_draws',to_char(c.period_credit,'FM9999999999999990.0000'),
        'period_repayments',to_char(c.period_debit,'FM9999999999999990.0000'),
        'closing_balance',to_char(c.credit_closing,'FM9999999999999990.0000'),
        'mapping_snapshot_id',c.loan_mapping_id,'mapping_version',c.loan_mapping_version,
        'mapping_snapshot_hash',c.loan_mapping_hash,'opposite_mapping_snapshot_id',c.cwip_mapping_id,
        'opposite_mapping_version',c.cwip_mapping_version,'opposite_mapping_snapshot_hash',c.cwip_mapping_hash,
        'journal_entry_ids',to_jsonb(c.journal_entry_ids),
        'journal_line_ids',to_jsonb(c.journal_line_ids),'ledger_line_ids',to_jsonb(c.ledger_line_ids),
        'posting_batch_ids',to_jsonb(c.posting_batch_ids),
        'lineage_complete',NOT c.missing_source_lineage,
        'source_document_ids',to_jsonb(ARRAY(SELECT DISTINCT sl.source_document_id FROM public.source_link sl
          WHERE sl.tenant_id=p_tenant AND sl.entity_id=p_entity AND sl.source_document_id IS NOT NULL
            AND sl.journal_entry_id=ANY(c.journal_entry_ids) ORDER BY sl.source_document_id)))
        ORDER BY c.account_code)FILTER(WHERE c.mapped_loan),'[]'::jsonb) loan_rows,
      COALESCE(jsonb_agg(jsonb_build_object('period_id',p.period_id,'period_code',p.period_code,
        'period_start',to_char(p.starts_on,'YYYY-MM-DD'),'period_end',to_char(p.ends_on,'YYYY-MM-DD'),
        'account_code',c.account_code,'account_name',c.account_name,'currency',c.currency,'mapping_status','MAPPED_CWIP_ACCOUNT',
        'activity_status',CASE WHEN c.current_activity_line_count=0 THEN 'ZERO_CURRENT_PERIOD_ACTIVITY' ELSE 'CURRENT_PERIOD_ACTIVITY' END,
        'current_activity_line_count',c.current_activity_line_count,
        'classification','CWIP','opposite_classification','NOT_CONSTRUCTION_LOAN',
        'classification_basis','APPROVED_CWIP_ACCOUNT_MAPPING_SNAPSHOT_EXACT',
        'opening_balance',to_char(c.debit_opening,'FM9999999999999990.0000'),
        'period_debit',to_char(c.period_debit,'FM9999999999999990.0000'),
        'period_credit',to_char(c.period_credit,'FM9999999999999990.0000'),
        'closing_balance',to_char(c.debit_closing,'FM9999999999999990.0000'),
        'mapping_snapshot_id',c.cwip_mapping_id,'mapping_version',c.cwip_mapping_version,
        'mapping_snapshot_hash',c.cwip_mapping_hash,'opposite_mapping_snapshot_id',c.loan_mapping_id,
        'opposite_mapping_version',c.loan_mapping_version,'opposite_mapping_snapshot_hash',c.loan_mapping_hash,
        'journal_entry_ids',to_jsonb(c.journal_entry_ids),
        'journal_line_ids',to_jsonb(c.journal_line_ids),'ledger_line_ids',to_jsonb(c.ledger_line_ids),
        'posting_batch_ids',to_jsonb(c.posting_batch_ids),
        'lineage_complete',NOT c.missing_source_lineage,
        'source_document_ids',to_jsonb(ARRAY(SELECT DISTINCT sl.source_document_id FROM public.source_link sl
          WHERE sl.tenant_id=p_tenant AND sl.entity_id=p_entity AND sl.source_document_id IS NOT NULL
            AND sl.journal_entry_id=ANY(c.journal_entry_ids) ORDER BY sl.source_document_id)))
        ORDER BY c.account_code)FILTER(WHERE c.mapped_cwip),'[]'::jsonb) cwip_rows,
      COALESCE(jsonb_agg(jsonb_build_object('period_id',p.period_id,'period_code',p.period_code,
        'period_start',to_char(p.starts_on,'YYYY-MM-DD'),'period_end',to_char(p.ends_on,'YYYY-MM-DD'),
        'account_code',c.account_code,'account_name',c.account_name,'currency',c.currency,
        'activity_status',CASE WHEN c.current_activity_line_count=0 THEN 'ZERO_CURRENT_PERIOD_ACTIVITY' ELSE 'CURRENT_PERIOD_ACTIVITY' END,
        'current_activity_line_count',c.current_activity_line_count,
        'mapping_status','EXPLICIT_NON_LOAN_CWIP_TARGET','loan_classification','NOT_CONSTRUCTION_LOAN',
        'cwip_classification','NOT_CWIP','loan_mapping_snapshot_id',c.loan_mapping_id,
        'loan_mapping_version',c.loan_mapping_version,'loan_mapping_snapshot_hash',c.loan_mapping_hash,
        'cwip_mapping_snapshot_id',c.cwip_mapping_id,'cwip_mapping_version',c.cwip_mapping_version,
        'cwip_mapping_snapshot_hash',c.cwip_mapping_hash,'journal_entry_ids',to_jsonb(c.journal_entry_ids),
        'journal_line_ids',to_jsonb(c.journal_line_ids),'ledger_line_ids',to_jsonb(c.ledger_line_ids),
        'posting_batch_ids',to_jsonb(c.posting_batch_ids),'lineage_complete',NOT c.missing_source_lineage,
        'source_document_ids',to_jsonb(ARRAY(SELECT DISTINCT sl.source_document_id FROM public.source_link sl
          WHERE sl.tenant_id=p_tenant AND sl.entity_id=p_entity AND sl.source_document_id IS NOT NULL
            AND sl.journal_entry_id=ANY(c.journal_entry_ids) ORDER BY sl.source_document_id)))
        ORDER BY c.account_code)FILTER(WHERE c.explicit_non_target),'[]'::jsonb) non_target_rows,
      COALESCE(jsonb_agg(jsonb_build_object('period_id',p.period_id,'period_code',p.period_code,
        'period_start',to_char(p.starts_on,'YYYY-MM-DD'),'period_end',to_char(p.ends_on,'YYYY-MM-DD'),
        'account_code',c.account_code,'account_name',c.account_name,'currency',c.currency,
        'activity_status',CASE WHEN c.current_activity_line_count=0 THEN 'ZERO_CURRENT_PERIOD_ACTIVITY' ELSE 'CURRENT_PERIOD_ACTIVITY' END,
        'current_activity_line_count',c.current_activity_line_count,
        'mapping_status',CASE WHEN c.ambiguous THEN 'BLOCKED_MAPPING_AMBIGUOUS' ELSE 'BLOCKED_MAPPING_REQUIRED' END,
        'journal_entry_ids',to_jsonb(c.journal_entry_ids),'journal_line_ids',to_jsonb(c.journal_line_ids),
        'ledger_line_ids',to_jsonb(c.ledger_line_ids),'posting_batch_ids',to_jsonb(c.posting_batch_ids),
        'lineage_complete',NOT c.missing_source_lineage,
        'source_document_ids',to_jsonb(ARRAY(SELECT DISTINCT sl.source_document_id
          FROM public.source_link sl WHERE sl.tenant_id=p_tenant AND sl.entity_id=p_entity AND sl.source_document_id IS NOT NULL
            AND sl.journal_entry_id=ANY(c.journal_entry_ids) ORDER BY sl.source_document_id)))
        ORDER BY c.account_code)FILTER(WHERE NOT c.mapped_loan AND NOT c.mapped_cwip AND NOT c.explicit_non_target),'[]'::jsonb) unclassified_rows,
      count(c.account_code)FILTER(WHERE NOT c.explicit_non_target)::integer eligible_count,
      count(c.account_code)FILTER(WHERE c.mapped_loan OR c.mapped_cwip)::integer mapped_count,
      count(c.account_code)FILTER(WHERE c.missing_mapping AND NOT c.ambiguous)::integer raw_missing_count,
      count(c.account_code)FILTER(WHERE c.ambiguous)::integer ambiguous_count,
      count(c.account_code)FILTER(WHERE c.missing_source_lineage)::integer invalid_lineage_count,
      count(c.account_code)FILTER(WHERE c.mapped_loan)::integer loan_row_count,
      count(c.account_code)FILTER(WHERE c.mapped_cwip)::integer cwip_row_count,
      count(c.account_code)FILTER(WHERE c.explicit_non_target)::integer non_target_count,
      COALESCE(sum(c.current_activity_line_count)FILTER(WHERE NOT c.explicit_non_target),0)::integer current_activity_line_count,
      count(c.account_code)FILTER(WHERE NOT c.explicit_non_target AND c.current_activity_line_count=0)::integer zero_activity_count,
      count(c.account_code)FILTER(WHERE NOT c.mapped_loan AND NOT c.mapped_cwip AND NOT c.explicit_non_target)::integer unclassified_count,
      count(c.account_code)::integer population_count,
      max(c.posted_watermark)FILTER(WHERE NOT c.explicit_non_target) population_watermark
    FROM period_scope p LEFT JOIN classified c ON true GROUP BY p.period_id,p.period_code,p.starts_on,p.ends_on,p.currency
  ), core AS (
    SELECT jsonb_build_object('schema_version','AI_CONSTRUCTION_LOAN_CWIP_POPULATION_ATTESTATION_V1',
      'tenant_id',p_tenant,'entity_id',p_entity,'accounting_period_id',p.period_id,'period_code',p.period_code,'currency',p.currency,
      'period_start',to_char(p.starts_on,'YYYY-MM-DD'),'period_end',to_char(p.ends_on,'YYYY-MM-DD'),
      'status',CASE WHEN (r.eligible_count=0 AND r.population_count=r.non_target_count AND r.raw_missing_count=0
        AND r.ambiguous_count=0 AND r.invalid_lineage_count=0) OR(r.mapped_count=r.eligible_count AND r.raw_missing_count=0
        AND r.ambiguous_count=0 AND r.invalid_lineage_count=0 AND r.loan_row_count BETWEEN 1 AND 500
        AND r.cwip_row_count BETWEEN 1 AND 500)THEN 'COMPLETE' ELSE 'INCOMPLETE' END,
      'applicable',r.eligible_count>0,
      'counts',jsonb_build_object('eligible_count',r.eligible_count,'mapped_count',r.mapped_count,
        'missing_count',r.raw_missing_count+CASE WHEN r.eligible_count>0 AND r.loan_row_count=0 THEN 1 ELSE 0 END
          +CASE WHEN r.eligible_count>0 AND r.cwip_row_count=0 THEN 1 ELSE 0 END,
        'ambiguous_count',r.ambiguous_count,'invalid_lineage_count',r.invalid_lineage_count,
        'current_activity_line_count',r.current_activity_line_count,'zero_activity_count',r.zero_activity_count,
        'loan_row_count',r.loan_row_count,'cwip_row_count',r.cwip_row_count,
        'non_target_count',r.non_target_count,'unclassified_count',r.unclassified_count,'population_count',r.population_count),
      'loan_rows',r.loan_rows,'cwip_rows',r.cwip_rows,'non_target_rows',r.non_target_rows,'unclassified_rows',r.unclassified_rows,
      'population_watermark',CASE WHEN r.eligible_count=0 OR r.population_watermark IS NULL THEN NULL ELSE
        to_char(r.population_watermark AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') END) value
    FROM period_scope p JOIN rows r ON true
  ) SELECT value||jsonb_build_object('population_hash',public.refs_jsonb_hash(value)) INTO v_result FROM core;
  IF v_result IS NULL THEN RAISE EXCEPTION 'A valid entity-scoped accounting period is required' USING ERRCODE='22023'; END IF;
  RETURN v_result;
END;
$$;
REVOKE ALL ON FUNCTION refs_read_ai_construction_loan_cwip_population_attestation(uuid,uuid,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION refs_read_ai_construction_loan_cwip_population_attestation(uuid,uuid,uuid) TO refs_app;
COMMIT;
