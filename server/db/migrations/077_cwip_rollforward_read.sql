BEGIN;

-- CWIP is never inferred from an account label, account-code prefix, project
-- name, source header, or WBS status.  An account enters this read only when
-- one effective immutable mapping snapshot explicitly classifies that exact
-- account as CWIP.  This read is an account rollforward, not a capitalization
-- or transfer conclusion: debit and credit movements retain their ledger form.
CREATE INDEX mapping_snapshot_cwip_account_read_idx
  ON mapping_snapshot(tenant_id,entity_id,family,status,effective_from,effective_to,priority)
  WHERE family='CWIP_ACCOUNT_CLASSIFICATION';

CREATE FUNCTION refs_get_cwip_rollforward(
  p_tenant uuid,
  p_entity uuid,
  p_period uuid
)
RETURNS TABLE(
  period_id uuid,
  period_code text,
  period_start text,
  period_end text,
  account_code text,
  account_name text,
  mapping_status text,
  classification_basis text,
  opening_balance numeric(20,4),
  period_debit numeric(20,4),
  period_credit numeric(20,4),
  closing_balance numeric(20,4),
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
  IF NOT EXISTS (SELECT 1 FROM public.accounting_period p WHERE p.tenant_id=p_tenant AND p.entity_id=p_entity AND p.period_id=p_period) THEN
    RAISE EXCEPTION 'A valid entity-scoped accounting period is required' USING ERRCODE='22023';
  END IF;

  RETURN QUERY
  WITH selected_period AS (
    SELECT p.period_id,p.period_code,p.starts_on,p.ends_on
    FROM public.accounting_period p WHERE p.tenant_id=p_tenant AND p.entity_id=p_entity AND p.period_id=p_period
  ), mapping_keys AS (
    SELECT DISTINCT ms.input_keys->>'account_code' AS account_code
    FROM public.mapping_snapshot ms CROSS JOIN selected_period p
    WHERE ms.tenant_id=p_tenant AND ms.entity_id=p_entity
      AND ms.family='CWIP_ACCOUNT_CLASSIFICATION' AND ms.status IN ('APPROVED','RETIRED')
      AND ms.effective_from::date<=p.ends_on AND (ms.effective_to IS NULL OR ms.effective_to::date>p.ends_on)
      AND ms.input_keys ? 'account_code'
  ), mapped_accounts AS (
    SELECT k.account_code,COALESCE(m.candidate_count,0)::integer AS candidate_count,
      m.mapping_snapshot_id,m.mapping_version,m.mapping_snapshot_hash,m.classification
    FROM mapping_keys k CROSS JOIN selected_period p
    LEFT JOIN LATERAL (
      WITH eligible AS (
        SELECT ms.* FROM public.mapping_snapshot ms
        WHERE ms.tenant_id=p_tenant AND ms.entity_id=p_entity AND ms.family='CWIP_ACCOUNT_CLASSIFICATION'
          AND ms.status IN ('APPROVED','RETIRED') AND ms.effective_from::date<=p.ends_on
          AND (ms.effective_to IS NULL OR ms.effective_to::date>p.ends_on)
          AND ms.input_keys=jsonb_build_object('account_code',k.account_code)
      ), highest AS (SELECT * FROM eligible WHERE priority=(SELECT max(priority) FROM eligible))
      SELECT count(*)::integer AS candidate_count,
        (array_agg(h.mapping_snapshot_id ORDER BY h.mapping_snapshot_id))[1] AS mapping_snapshot_id,
        (array_agg(h.version::text ORDER BY h.mapping_snapshot_id))[1] AS mapping_version,
        (array_agg(h.snapshot_hash ORDER BY h.mapping_snapshot_id))[1] AS mapping_snapshot_hash,
        (array_agg(h.output_rules->>'classification' ORDER BY h.mapping_snapshot_id))[1] AS classification
      FROM highest h
    ) m ON true
  ), posted_lines AS (
    SELECT l.ledger_line_id,l.journal_entry_id,l.journal_line_id,l.account_code,l.debit_amount,l.credit_amount,j.journal_date
    FROM public.ledger_line l JOIN public.journal_entry j ON j.tenant_id=l.tenant_id AND j.entity_id=l.entity_id AND j.journal_entry_id=l.journal_entry_id
    WHERE l.tenant_id=p_tenant AND l.entity_id=p_entity AND j.status='POSTED'
  ), account_evidence AS (
    SELECT m.*,a.account_name,
      COALESCE(sum(CASE WHEN l.journal_date<p.starts_on THEN l.debit_amount-l.credit_amount ELSE 0 END),0)::numeric(20,4) AS opening_balance,
      COALESCE(sum(CASE WHEN l.journal_date BETWEEN p.starts_on AND p.ends_on THEN l.debit_amount ELSE 0 END),0)::numeric(20,4) AS period_debit,
      COALESCE(sum(CASE WHEN l.journal_date BETWEEN p.starts_on AND p.ends_on THEN l.credit_amount ELSE 0 END),0)::numeric(20,4) AS period_credit,
      COALESCE(sum(CASE WHEN l.journal_date<=p.ends_on THEN l.debit_amount-l.credit_amount ELSE 0 END),0)::numeric(20,4) AS closing_balance,
      array_agg(DISTINCT l.journal_entry_id ORDER BY l.journal_entry_id) FILTER (WHERE l.journal_date<=p.ends_on) AS journal_entry_ids,
      array_agg(DISTINCT l.journal_line_id ORDER BY l.journal_line_id) FILTER (WHERE l.journal_date<=p.ends_on) AS journal_line_ids,
      array_agg(DISTINCT l.ledger_line_id ORDER BY l.ledger_line_id) FILTER (WHERE l.journal_date<=p.ends_on) AS ledger_line_ids
    FROM mapped_accounts m CROSS JOIN selected_period p
    LEFT JOIN posted_lines l ON l.account_code=m.account_code
    LEFT JOIN public.account_master a ON a.tenant_id=p_tenant AND a.entity_id=p_entity AND a.account_code=m.account_code AND a.active
    GROUP BY m.account_code,m.candidate_count,m.mapping_snapshot_id,m.mapping_version,m.mapping_snapshot_hash,m.classification,a.account_name
  ), retained_evidence AS (
    SELECT e.*,ARRAY(SELECT DISTINCT sl.source_document_id FROM public.source_link sl WHERE sl.tenant_id=p_tenant AND sl.entity_id=p_entity
      AND sl.source_document_id IS NOT NULL AND sl.journal_entry_id=ANY(COALESCE(e.journal_entry_ids,ARRAY[]::uuid[])) ORDER BY sl.source_document_id)::uuid[] AS source_document_ids
    FROM account_evidence e
  )
  SELECT p.period_id,p.period_code,to_char(p.starts_on,'YYYY-MM-DD'),to_char(p.ends_on,'YYYY-MM-DD'),
    e.account_code,COALESCE(e.account_name,'Unmapped account'),
    CASE WHEN e.candidate_count=0 THEN 'BLOCKED_MAPPING_REQUIRED' WHEN e.candidate_count<>1 THEN 'BLOCKED_MAPPING_AMBIGUOUS'
         WHEN e.classification<>'CWIP' THEN 'BLOCKED_MAPPING_RULE_INVALID' ELSE 'MAPPED_CWIP_ACCOUNT' END,
    CASE WHEN e.candidate_count=1 AND e.classification='CWIP' THEN 'APPROVED_CWIP_ACCOUNT_MAPPING_SNAPSHOT_EXACT' ELSE 'CWIP_ACCOUNT_MAPPING_SNAPSHOT_REQUIRED' END,
    CASE WHEN e.candidate_count=1 AND e.classification='CWIP' THEN e.opening_balance ELSE NULL END,
    CASE WHEN e.candidate_count=1 AND e.classification='CWIP' THEN e.period_debit ELSE NULL END,
    CASE WHEN e.candidate_count=1 AND e.classification='CWIP' THEN e.period_credit ELSE NULL END,
    CASE WHEN e.candidate_count=1 AND e.classification='CWIP' THEN e.closing_balance ELSE NULL END,
    CASE WHEN e.candidate_count=1 AND e.classification='CWIP' THEN e.mapping_snapshot_id ELSE NULL END,
    CASE WHEN e.candidate_count=1 AND e.classification='CWIP' THEN e.mapping_version ELSE NULL END,
    CASE WHEN e.candidate_count=1 AND e.classification='CWIP' THEN e.mapping_snapshot_hash ELSE NULL END,
    e.journal_entry_ids,e.journal_line_ids,e.ledger_line_ids,e.source_document_ids
  FROM retained_evidence e CROSS JOIN selected_period p
  WHERE e.journal_entry_ids IS NOT NULL
  ORDER BY e.account_code;
END;
$$;

REVOKE ALL ON FUNCTION refs_get_cwip_rollforward(uuid,uuid,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION refs_get_cwip_rollforward(uuid,uuid,uuid) TO refs_app;

COMMIT;
