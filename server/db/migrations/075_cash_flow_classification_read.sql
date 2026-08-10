BEGIN;

-- A statement of cash flows is not inferred from account names, account-code
-- prefixes, source labels, or a bank account.  Each posted cash movement is
-- classified only by one exact, approved (or historically retired) immutable
-- mapping snapshot.  Unsupported journal shapes and missing/ambiguous rules
-- stay visible as BLOCKED evidence and never contribute to O/I/F totals.
CREATE INDEX mapping_snapshot_cash_flow_exact_read_idx
  ON mapping_snapshot(tenant_id,entity_id,family,status,effective_from,effective_to,priority)
  WHERE family='CASH_FLOW_CLASSIFICATION';

CREATE FUNCTION refs_get_cash_flow_classification(
  p_tenant uuid,
  p_entity uuid,
  p_period uuid
)
RETURNS TABLE(
  period_id uuid,
  period_code text,
  period_start text,
  period_end text,
  classification text,
  mapping_status text,
  classification_basis text,
  cash_account_code text,
  counterpart_account_code text,
  cash_effect numeric(20,4),
  mapping_snapshot_id uuid,
  mapping_version text,
  mapping_snapshot_hash text,
  journal_entry_ids uuid[],
  journal_line_ids uuid[],
  ledger_line_ids uuid[],
  source_document_ids uuid[]
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
BEGIN
  PERFORM public.refs_assert_scope(p_tenant,p_entity,'GL.REPORT.VIEW');
  IF NOT EXISTS (
    SELECT 1 FROM public.accounting_period p
    WHERE p.tenant_id=p_tenant AND p.entity_id=p_entity AND p.period_id=p_period
  ) THEN
    RAISE EXCEPTION 'A valid entity-scoped accounting period is required' USING ERRCODE='22023';
  END IF;

  RETURN QUERY
  WITH selected_period AS (
    SELECT p.period_id,p.period_code,p.starts_on,p.ends_on
    FROM public.accounting_period p
    WHERE p.tenant_id=p_tenant AND p.entity_id=p_entity AND p.period_id=p_period
  ), posted_journal_lines AS (
    SELECT j.journal_entry_id,j.journal_date,l.ledger_line_id,l.journal_line_id,l.account_code,
      l.debit_amount,l.credit_amount,
      COALESCE(a.required_member_type='BANK',false) AS is_bank_cash
    FROM public.journal_entry j
    JOIN public.ledger_line l
      ON l.tenant_id=j.tenant_id AND l.entity_id=j.entity_id AND l.journal_entry_id=j.journal_entry_id
    LEFT JOIN public.account_master a
      ON a.tenant_id=l.tenant_id AND a.entity_id=l.entity_id AND a.account_code=l.account_code AND a.active
    CROSS JOIN selected_period p
    WHERE j.tenant_id=p_tenant AND j.entity_id=p_entity AND j.status='POSTED'
      AND j.journal_date BETWEEN p.starts_on AND p.ends_on
  ), cash_journals AS (
    SELECT l.journal_entry_id,l.journal_date,
      count(*) FILTER (WHERE l.is_bank_cash)::integer AS cash_line_count,
      min(l.account_code) FILTER (WHERE l.is_bank_cash) AS representative_cash_account,
      COALESCE(sum(l.debit_amount-l.credit_amount) FILTER (WHERE l.is_bank_cash),0)::numeric(20,4) AS cash_net,
      array_agg(DISTINCT l.journal_line_id ORDER BY l.journal_line_id) AS all_journal_line_ids,
      array_agg(DISTINCT l.ledger_line_id ORDER BY l.ledger_line_id) AS all_ledger_line_ids
    FROM posted_journal_lines l
    GROUP BY l.journal_entry_id,l.journal_date
    HAVING count(*) FILTER (WHERE l.is_bank_cash)>0
  ), valid_counterparts AS (
    SELECT c.journal_entry_id,c.journal_date,c.representative_cash_account AS cash_account_code,c.cash_net,
      l.account_code AS counterpart_account_code,
      sum(l.debit_amount-l.credit_amount)::numeric(20,4) AS counterpart_net,
      array_agg(DISTINCT l.journal_line_id ORDER BY l.journal_line_id) AS journal_line_ids,
      array_agg(DISTINCT l.ledger_line_id ORDER BY l.ledger_line_id) AS ledger_line_ids
    FROM cash_journals c
    JOIN posted_journal_lines l ON l.journal_entry_id=c.journal_entry_id AND NOT l.is_bank_cash
    WHERE c.cash_line_count=1 AND l.debit_amount<>l.credit_amount
    GROUP BY c.journal_entry_id,c.journal_date,c.representative_cash_account,c.cash_net,l.account_code
  ), mapped_counterparts AS (
    SELECT c.*,
      COALESCE(m.candidate_count,0)::integer AS candidate_count,
      m.mapping_snapshot_id,m.version AS mapping_version,m.snapshot_hash AS mapping_snapshot_hash,
      m.classification
    FROM valid_counterparts c
    LEFT JOIN LATERAL (
      WITH eligible AS (
        SELECT ms.*
        FROM public.mapping_snapshot ms
        WHERE ms.tenant_id=p_tenant AND ms.entity_id=p_entity
          AND ms.family='CASH_FLOW_CLASSIFICATION'
          AND ms.status IN ('APPROVED','RETIRED')
          AND ms.effective_from::date<=c.journal_date
          AND (ms.effective_to IS NULL OR ms.effective_to::date>c.journal_date)
          AND ms.input_keys=jsonb_build_object('cash_account_code',c.cash_account_code,'counterpart_account_code',c.counterpart_account_code)
      ), highest AS (
        SELECT * FROM eligible WHERE priority=(SELECT max(priority) FROM eligible)
      )
      SELECT count(*)::integer AS candidate_count,
        (array_agg(highest.mapping_snapshot_id ORDER BY highest.mapping_snapshot_id))[1] AS mapping_snapshot_id,
        (array_agg(highest.version::text ORDER BY highest.mapping_snapshot_id))[1] AS version,
        (array_agg(highest.snapshot_hash ORDER BY highest.mapping_snapshot_id))[1] AS snapshot_hash,
        (array_agg(highest.output_rules->>'classification' ORDER BY highest.mapping_snapshot_id))[1] AS classification
      FROM highest
    ) m ON true
  ), classified_rows AS (
    SELECT c.journal_entry_id,c.cash_account_code,c.counterpart_account_code,
      (CASE WHEN c.cash_net>0 THEN abs(c.counterpart_net) ELSE -abs(c.counterpart_net) END)::numeric(20,4) AS cash_effect,
      CASE
        WHEN c.candidate_count=0 THEN 'BLOCKED'
        WHEN c.candidate_count<>1 THEN 'BLOCKED'
        WHEN c.classification NOT IN ('OPERATING','INVESTING','FINANCING') THEN 'BLOCKED'
        ELSE c.classification
      END AS classification,
      CASE
        WHEN c.candidate_count=0 THEN 'BLOCKED_MAPPING_REQUIRED'
        WHEN c.candidate_count<>1 THEN 'BLOCKED_MAPPING_AMBIGUOUS'
        WHEN c.classification NOT IN ('OPERATING','INVESTING','FINANCING') THEN 'BLOCKED_MAPPING_RULE_INVALID'
        ELSE 'CLASSIFIED'
      END AS mapping_status,
      CASE
        WHEN c.candidate_count=1 AND c.classification IN ('OPERATING','INVESTING','FINANCING') THEN 'APPROVED_CASH_FLOW_MAPPING_SNAPSHOT_EXACT'
        ELSE 'CASH_FLOW_MAPPING_SNAPSHOT_REQUIRED'
      END AS classification_basis,
      CASE WHEN c.candidate_count=1 AND c.classification IN ('OPERATING','INVESTING','FINANCING') THEN c.mapping_snapshot_id ELSE NULL END AS mapping_snapshot_id,
      CASE WHEN c.candidate_count=1 AND c.classification IN ('OPERATING','INVESTING','FINANCING') THEN c.mapping_version ELSE NULL END AS mapping_version,
      CASE WHEN c.candidate_count=1 AND c.classification IN ('OPERATING','INVESTING','FINANCING') THEN c.mapping_snapshot_hash ELSE NULL END AS mapping_snapshot_hash,
      c.journal_line_ids,c.ledger_line_ids
    FROM mapped_counterparts c
    UNION ALL
    SELECT c.journal_entry_id,COALESCE(c.representative_cash_account,'UNRESOLVED_CASH_ACCOUNT'),
      'MULTIPLE_OR_MISSING_BANK_CASH_LINES',c.cash_net,'BLOCKED','BLOCKED_JOURNAL_SHAPE_REQUIRED',
      'EXACTLY_ONE_BANK_CASH_LINE_REQUIRED',NULL::uuid,NULL::text,NULL::text,c.all_journal_line_ids,c.all_ledger_line_ids
    FROM cash_journals c
    WHERE c.cash_line_count<>1
  ), evidence_rows AS (
    SELECT r.*,ARRAY(
      SELECT DISTINCT sl.source_document_id
      FROM public.source_link sl
      WHERE sl.tenant_id=p_tenant AND sl.entity_id=p_entity AND sl.source_document_id IS NOT NULL
        AND sl.journal_entry_id=r.journal_entry_id
      ORDER BY sl.source_document_id
    )::uuid[] AS source_document_ids
    FROM classified_rows r
  )
  SELECT p.period_id,p.period_code,to_char(p.starts_on,'YYYY-MM-DD'),to_char(p.ends_on,'YYYY-MM-DD'),
    r.classification,r.mapping_status,r.classification_basis,r.cash_account_code,r.counterpart_account_code,
    r.cash_effect,r.mapping_snapshot_id,r.mapping_version,r.mapping_snapshot_hash,
    ARRAY[r.journal_entry_id]::uuid[],r.journal_line_ids,r.ledger_line_ids,r.source_document_ids
  FROM evidence_rows r
  CROSS JOIN selected_period p
  ORDER BY CASE r.classification WHEN 'OPERATING' THEN 1 WHEN 'INVESTING' THEN 2 WHEN 'FINANCING' THEN 3 ELSE 4 END,
    r.cash_account_code,r.counterpart_account_code,r.journal_entry_id;
END;
$$;

REVOKE ALL ON FUNCTION refs_get_cash_flow_classification(uuid,uuid,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION refs_get_cash_flow_classification(uuid,uuid,uuid) TO refs_app;

COMMIT;
