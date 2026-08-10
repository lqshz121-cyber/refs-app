BEGIN;

-- Intercompany balances are never paired from a shared account code, memo,
-- vendor, amount, or a label.  Both entities must publish one exact approved
-- mapping for the same account pair and each caller must have report access to
-- both entity scopes.  This is an evidence read only: it creates neither an
-- elimination entry nor an adjustment.
CREATE INDEX mapping_snapshot_intercompany_pair_read_idx
  ON mapping_snapshot(tenant_id,entity_id,family,status,effective_from,effective_to,priority)
  WHERE family='INTERCOMPANY_ACCOUNT_PAIR';

CREATE FUNCTION refs_get_intercompany_reconciliation(
  p_tenant uuid,
  p_entity uuid,
  p_period uuid,
  p_counterparty_entity uuid,
  p_counterparty_period uuid
)
RETURNS TABLE(
  period_id uuid,
  counterparty_period_id uuid,
  period_code text,
  period_start text,
  period_end text,
  account_code text,
  account_name text,
  counterparty_account_code text,
  counterparty_account_name text,
  mapping_status text,
  classification_basis text,
  current_closing_balance numeric(20,4),
  counterparty_closing_balance numeric(20,4),
  difference_amount numeric(20,4),
  in_balance boolean,
  mapping_snapshot_id uuid,
  mapping_version text,
  mapping_snapshot_hash text,
  counterparty_mapping_snapshot_id uuid,
  counterparty_mapping_version text,
  counterparty_mapping_snapshot_hash text,
  journal_entry_ids uuid[],
  journal_line_ids uuid[],
  ledger_line_ids uuid[],
  source_document_ids uuid[],
  counterparty_journal_entry_ids uuid[],
  counterparty_journal_line_ids uuid[],
  counterparty_ledger_line_ids uuid[],
  counterparty_source_document_ids uuid[]
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE v_period record; v_counterparty_period record;
BEGIN
  IF p_entity=p_counterparty_entity THEN
    RAISE EXCEPTION 'Intercompany reconciliation requires two distinct entities' USING ERRCODE='22023';
  END IF;
  PERFORM public.refs_assert_scope(p_tenant,p_entity,'GL.REPORT.VIEW');
  PERFORM public.refs_assert_scope(p_tenant,p_counterparty_entity,'GL.REPORT.VIEW');
  SELECT ap.period_id,ap.period_code,ap.starts_on,ap.ends_on INTO v_period
  FROM public.accounting_period ap WHERE ap.tenant_id=p_tenant AND ap.entity_id=p_entity AND ap.period_id=p_period;
  SELECT ap.period_id,ap.period_code,ap.starts_on,ap.ends_on INTO v_counterparty_period
  FROM public.accounting_period ap WHERE ap.tenant_id=p_tenant AND ap.entity_id=p_counterparty_entity AND ap.period_id=p_counterparty_period;
  IF NOT FOUND OR v_period.period_id IS NULL OR v_counterparty_period.period_id IS NULL THEN
    RAISE EXCEPTION 'Two valid entity-scoped accounting periods are required' USING ERRCODE='22023';
  END IF;
  IF v_period.starts_on<>v_counterparty_period.starts_on OR v_period.ends_on<>v_counterparty_period.ends_on THEN
    RAISE EXCEPTION 'Intercompany reconciliation requires exactly aligned period boundaries' USING ERRCODE='22023';
  END IF;

  RETURN QUERY
  WITH left_keys AS (
    SELECT DISTINCT ms.input_keys->>'account_code' AS account_code
    FROM public.mapping_snapshot ms
    WHERE ms.tenant_id=p_tenant AND ms.entity_id=p_entity
      AND ms.family='INTERCOMPANY_ACCOUNT_PAIR' AND ms.status IN ('APPROVED','RETIRED')
      AND ms.effective_from::date<=v_period.ends_on AND (ms.effective_to IS NULL OR ms.effective_to::date>v_period.ends_on)
      AND ms.input_keys @> jsonb_build_object('counterparty_entity_id',p_counterparty_entity::text)
      AND ms.input_keys ? 'account_code'
  ), left_map AS (
    SELECT k.account_code,COALESCE(x.candidate_count,0)::integer AS candidate_count,
      x.mapping_snapshot_id,x.mapping_version,x.mapping_snapshot_hash,x.classification,x.counterparty_account_code,x.counterparty_classification
    FROM left_keys k LEFT JOIN LATERAL (
      WITH eligible AS (
        SELECT ms.* FROM public.mapping_snapshot ms
        WHERE ms.tenant_id=p_tenant AND ms.entity_id=p_entity AND ms.family='INTERCOMPANY_ACCOUNT_PAIR'
          AND ms.status IN ('APPROVED','RETIRED') AND ms.effective_from::date<=v_period.ends_on
          AND (ms.effective_to IS NULL OR ms.effective_to::date>v_period.ends_on)
          AND ms.input_keys=jsonb_build_object('account_code',k.account_code,'counterparty_entity_id',p_counterparty_entity::text)
      ), highest AS (SELECT * FROM eligible WHERE priority=(SELECT max(priority) FROM eligible))
      SELECT count(*)::integer AS candidate_count,
        (array_agg(h.mapping_snapshot_id ORDER BY h.mapping_snapshot_id))[1] mapping_snapshot_id,
        (array_agg(h.version::text ORDER BY h.mapping_snapshot_id))[1] mapping_version,
        (array_agg(h.snapshot_hash ORDER BY h.mapping_snapshot_id))[1] mapping_snapshot_hash,
        (array_agg(h.output_rules->>'classification' ORDER BY h.mapping_snapshot_id))[1] classification,
        (array_agg(h.output_rules->>'counterparty_account_code' ORDER BY h.mapping_snapshot_id))[1] counterparty_account_code,
        (array_agg(h.output_rules->>'counterparty_classification' ORDER BY h.mapping_snapshot_id))[1] counterparty_classification
      FROM highest h
    ) x ON true
  ), paired_map AS (
    SELECT l.*,COALESCE(r.candidate_count,0)::integer AS counterparty_candidate_count,
      r.mapping_snapshot_id AS counterparty_mapping_snapshot_id,r.mapping_version AS counterparty_mapping_version,
      r.mapping_snapshot_hash AS counterparty_mapping_snapshot_hash,r.classification AS counterparty_mapping_classification,
      r.counterparty_account_code AS reverse_account_code,r.counterparty_classification AS reverse_classification
    FROM left_map l LEFT JOIN LATERAL (
      WITH eligible AS (
        SELECT ms.* FROM public.mapping_snapshot ms
        WHERE l.candidate_count=1
          AND l.counterparty_account_code~'^[0-9A-Za-z._-]{1,64}$'
          AND ms.tenant_id=p_tenant AND ms.entity_id=p_counterparty_entity AND ms.family='INTERCOMPANY_ACCOUNT_PAIR'
          AND ms.status IN ('APPROVED','RETIRED') AND ms.effective_from::date<=v_counterparty_period.ends_on
          AND (ms.effective_to IS NULL OR ms.effective_to::date>v_counterparty_period.ends_on)
          AND ms.input_keys=jsonb_build_object('account_code',l.counterparty_account_code,'counterparty_entity_id',p_entity::text)
      ), highest AS (SELECT * FROM eligible WHERE priority=(SELECT max(priority) FROM eligible))
      SELECT count(*)::integer AS candidate_count,
        (array_agg(h.mapping_snapshot_id ORDER BY h.mapping_snapshot_id))[1] mapping_snapshot_id,
        (array_agg(h.version::text ORDER BY h.mapping_snapshot_id))[1] mapping_version,
        (array_agg(h.snapshot_hash ORDER BY h.mapping_snapshot_id))[1] mapping_snapshot_hash,
        (array_agg(h.output_rules->>'classification' ORDER BY h.mapping_snapshot_id))[1] classification,
        (array_agg(h.output_rules->>'counterparty_account_code' ORDER BY h.mapping_snapshot_id))[1] counterparty_account_code,
        (array_agg(h.output_rules->>'counterparty_classification' ORDER BY h.mapping_snapshot_id))[1] counterparty_classification
      FROM highest h
    ) r ON true
  ), current_evidence AS (
    SELECT p.account_code,
      COALESCE(sum(l.debit_amount-l.credit_amount) FILTER (WHERE j.journal_date<=v_period.ends_on),0)::numeric(20,4) closing_balance,
      array_agg(DISTINCT l.journal_entry_id ORDER BY l.journal_entry_id) FILTER (WHERE j.journal_date<=v_period.ends_on) journal_entry_ids,
      array_agg(DISTINCT l.journal_line_id ORDER BY l.journal_line_id) FILTER (WHERE j.journal_date<=v_period.ends_on) journal_line_ids,
      array_agg(DISTINCT l.ledger_line_id ORDER BY l.ledger_line_id) FILTER (WHERE j.journal_date<=v_period.ends_on) ledger_line_ids
    FROM paired_map p LEFT JOIN public.ledger_line l ON l.tenant_id=p_tenant AND l.entity_id=p_entity AND l.account_code=p.account_code
    LEFT JOIN public.journal_entry j ON j.tenant_id=l.tenant_id AND j.entity_id=l.entity_id AND j.journal_entry_id=l.journal_entry_id AND j.status='POSTED'
    GROUP BY p.account_code
  ), counterparty_evidence AS (
    SELECT p.account_code,
      COALESCE(sum(l.debit_amount-l.credit_amount) FILTER (WHERE j.journal_date<=v_counterparty_period.ends_on),0)::numeric(20,4) closing_balance,
      array_agg(DISTINCT l.journal_entry_id ORDER BY l.journal_entry_id) FILTER (WHERE j.journal_date<=v_counterparty_period.ends_on) journal_entry_ids,
      array_agg(DISTINCT l.journal_line_id ORDER BY l.journal_line_id) FILTER (WHERE j.journal_date<=v_counterparty_period.ends_on) journal_line_ids,
      array_agg(DISTINCT l.ledger_line_id ORDER BY l.ledger_line_id) FILTER (WHERE j.journal_date<=v_counterparty_period.ends_on) ledger_line_ids
    FROM paired_map p LEFT JOIN public.ledger_line l ON l.tenant_id=p_tenant AND l.entity_id=p_counterparty_entity AND l.account_code=p.counterparty_account_code
    LEFT JOIN public.journal_entry j ON j.tenant_id=l.tenant_id AND j.entity_id=l.entity_id AND j.journal_entry_id=l.journal_entry_id AND j.status='POSTED'
    GROUP BY p.account_code
  )
  SELECT v_period.period_id,v_counterparty_period.period_id,v_period.period_code,to_char(v_period.starts_on,'YYYY-MM-DD'),to_char(v_period.ends_on,'YYYY-MM-DD'),
    p.account_code,COALESCE(a.account_name,'Unmapped account'),COALESCE(p.counterparty_account_code,'UNMAPPED'),COALESCE(ca.account_name,'Unmapped counterparty account'),
    CASE WHEN p.candidate_count<>1 THEN 'BLOCKED_MAPPING_AMBIGUOUS'
      WHEN p.classification NOT IN ('DUE_FROM','DUE_TO') OR p.counterparty_classification NOT IN ('DUE_FROM','DUE_TO') OR p.counterparty_account_code !~ '^[0-9A-Za-z._-]{1,64}$' THEN 'BLOCKED_MAPPING_RULE_INVALID'
      WHEN p.counterparty_candidate_count=0 THEN 'BLOCKED_COUNTERPARTY_MAPPING_REQUIRED'
      WHEN p.counterparty_candidate_count<>1 THEN 'BLOCKED_COUNTERPARTY_MAPPING_AMBIGUOUS'
      WHEN p.counterparty_mapping_classification<>p.counterparty_classification OR p.reverse_account_code<>p.account_code OR p.reverse_classification<>p.classification THEN 'BLOCKED_COUNTERPARTY_MAPPING_MISMATCH'
      WHEN ce.journal_entry_ids IS NULL THEN 'BLOCKED_CURRENT_POSTED_EVIDENCE_REQUIRED'
      WHEN cpe.journal_entry_ids IS NULL THEN 'BLOCKED_COUNTERPARTY_POSTED_EVIDENCE_REQUIRED'
      ELSE 'MAPPED_INTERCOMPANY_PAIR' END,
    CASE WHEN p.candidate_count=1 AND p.counterparty_candidate_count=1 AND p.classification IN ('DUE_FROM','DUE_TO') AND p.counterparty_classification IN ('DUE_FROM','DUE_TO') AND p.counterparty_mapping_classification=p.counterparty_classification AND p.reverse_account_code=p.account_code AND p.reverse_classification=p.classification AND ce.journal_entry_ids IS NOT NULL AND cpe.journal_entry_ids IS NOT NULL THEN 'APPROVED_BIDIRECTIONAL_INTERCOMPANY_MAPPING_SNAPSHOTS_EXACT' ELSE 'INTERCOMPANY_MAPPING_AND_POSTED_EVIDENCE_REQUIRED' END,
    CASE WHEN p.candidate_count=1 AND p.counterparty_candidate_count=1 AND p.classification IN ('DUE_FROM','DUE_TO') AND p.counterparty_classification IN ('DUE_FROM','DUE_TO') AND p.counterparty_mapping_classification=p.counterparty_classification AND p.reverse_account_code=p.account_code AND p.reverse_classification=p.classification AND ce.journal_entry_ids IS NOT NULL AND cpe.journal_entry_ids IS NOT NULL THEN ce.closing_balance ELSE NULL END,
    CASE WHEN p.candidate_count=1 AND p.counterparty_candidate_count=1 AND p.classification IN ('DUE_FROM','DUE_TO') AND p.counterparty_classification IN ('DUE_FROM','DUE_TO') AND p.counterparty_mapping_classification=p.counterparty_classification AND p.reverse_account_code=p.account_code AND p.reverse_classification=p.classification AND ce.journal_entry_ids IS NOT NULL AND cpe.journal_entry_ids IS NOT NULL THEN cpe.closing_balance ELSE NULL END,
    CASE WHEN p.candidate_count=1 AND p.counterparty_candidate_count=1 AND p.classification IN ('DUE_FROM','DUE_TO') AND p.counterparty_classification IN ('DUE_FROM','DUE_TO') AND p.counterparty_mapping_classification=p.counterparty_classification AND p.reverse_account_code=p.account_code AND p.reverse_classification=p.classification AND ce.journal_entry_ids IS NOT NULL AND cpe.journal_entry_ids IS NOT NULL THEN ce.closing_balance+cpe.closing_balance ELSE NULL END,
    CASE WHEN p.candidate_count=1 AND p.counterparty_candidate_count=1 AND p.classification IN ('DUE_FROM','DUE_TO') AND p.counterparty_classification IN ('DUE_FROM','DUE_TO') AND p.counterparty_mapping_classification=p.counterparty_classification AND p.reverse_account_code=p.account_code AND p.reverse_classification=p.classification AND ce.journal_entry_ids IS NOT NULL AND cpe.journal_entry_ids IS NOT NULL THEN ce.closing_balance+cpe.closing_balance=0 ELSE false END,
    CASE WHEN p.candidate_count=1 THEN p.mapping_snapshot_id ELSE NULL END,CASE WHEN p.candidate_count=1 THEN p.mapping_version ELSE NULL END,CASE WHEN p.candidate_count=1 THEN p.mapping_snapshot_hash ELSE NULL END,
    CASE WHEN p.counterparty_candidate_count=1 THEN p.counterparty_mapping_snapshot_id ELSE NULL END,CASE WHEN p.counterparty_candidate_count=1 THEN p.counterparty_mapping_version ELSE NULL END,CASE WHEN p.counterparty_candidate_count=1 THEN p.counterparty_mapping_snapshot_hash ELSE NULL END,
    ce.journal_entry_ids,ce.journal_line_ids,ce.ledger_line_ids,
    ARRAY(SELECT DISTINCT sl.source_document_id FROM public.source_link sl WHERE sl.tenant_id=p_tenant AND sl.entity_id=p_entity AND sl.source_document_id IS NOT NULL AND sl.journal_entry_id=ANY(COALESCE(ce.journal_entry_ids,ARRAY[]::uuid[])) ORDER BY sl.source_document_id)::uuid[],
    cpe.journal_entry_ids,cpe.journal_line_ids,cpe.ledger_line_ids,
    ARRAY(SELECT DISTINCT sl.source_document_id FROM public.source_link sl WHERE sl.tenant_id=p_tenant AND sl.entity_id=p_counterparty_entity AND sl.source_document_id IS NOT NULL AND sl.journal_entry_id=ANY(COALESCE(cpe.journal_entry_ids,ARRAY[]::uuid[])) ORDER BY sl.source_document_id)::uuid[]
  FROM paired_map p
  LEFT JOIN current_evidence ce ON ce.account_code=p.account_code
  LEFT JOIN counterparty_evidence cpe ON cpe.account_code=p.account_code
  LEFT JOIN public.account_master a ON a.tenant_id=p_tenant AND a.entity_id=p_entity AND a.account_code=p.account_code AND a.active
  LEFT JOIN public.account_master ca ON ca.tenant_id=p_tenant AND ca.entity_id=p_counterparty_entity AND ca.account_code=p.counterparty_account_code AND ca.active
  ORDER BY p.account_code;
END;
$$;

REVOKE ALL ON FUNCTION refs_get_intercompany_reconciliation(uuid,uuid,uuid,uuid,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION refs_get_intercompany_reconciliation(uuid,uuid,uuid,uuid,uuid) TO refs_app;

COMMIT;
