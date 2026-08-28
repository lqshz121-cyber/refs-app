BEGIN;

-- AI balance review must receive scope facts from the database rather than
-- trusting a caller-composed GL DTO.  These readers deliberately duplicate
-- the report projection under the narrower AI permission so entity, primary
-- period, and functional currency are carried into every reviewed row.
CREATE FUNCTION refs_read_ai_construction_loan_gl_balances(
  p_tenant uuid,
  p_entity uuid,
  p_period uuid
)
RETURNS TABLE(
  entity_id uuid,
  currency char(3),
  period_id uuid,
  period_code text,
  period_start text,
  period_end text,
  account_code text,
  account_name text,
  mapping_status text,
  classification_basis text,
  opening_balance numeric(20,4),
  period_draws numeric(20,4),
  period_repayments numeric(20,4),
  closing_balance numeric(20,4),
  mapping_snapshot_id uuid,
  mapping_version text,
  mapping_snapshot_hash text,
  journal_entry_ids uuid[],
  journal_line_ids uuid[],
  ledger_line_ids uuid[],
  source_document_ids uuid[]
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp
AS $$
DECLARE
  v_period record;
BEGIN
  PERFORM public.refs_assert_ai_analysis_scope(p_tenant,p_entity);
  SELECT ap.period_id,ap.period_code,ap.starts_on,ap.ends_on,e.base_currency
    INTO v_period
  FROM public.accounting_period ap
  JOIN public.entity e
    ON e.tenant_id=ap.tenant_id AND e.entity_id=ap.entity_id
  WHERE ap.tenant_id=p_tenant
    AND ap.entity_id=p_entity
    AND ap.period_id=p_period
    AND ap.ledger_code='PRIMARY';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'AI construction-loan GL read requires one primary entity period'
      USING ERRCODE='22023';
  END IF;

  RETURN QUERY
  WITH keys AS (
    SELECT DISTINCT ms.input_keys->>'account_code' account_code
    FROM public.mapping_snapshot ms
    WHERE ms.tenant_id=p_tenant
      AND ms.entity_id=p_entity
      AND ms.family='CONSTRUCTION_LOAN_ACCOUNT_CLASSIFICATION'
      AND ms.status IN ('APPROVED','RETIRED')
      AND ms.effective_from::date<=v_period.ends_on
      AND (ms.effective_to IS NULL OR ms.effective_to::date>v_period.ends_on)
      AND ms.input_keys ? 'account_code'
  ), mapped AS (
    SELECT k.account_code,
      COALESCE(x.candidate_count,0)::integer candidate_count,
      x.mapping_snapshot_id,x.mapping_version,x.mapping_snapshot_hash,x.classification
    FROM keys k
    LEFT JOIN LATERAL (
      WITH eligible AS (
        SELECT ms.*
        FROM public.mapping_snapshot ms
        WHERE ms.tenant_id=p_tenant
          AND ms.entity_id=p_entity
          AND ms.family='CONSTRUCTION_LOAN_ACCOUNT_CLASSIFICATION'
          AND ms.status IN ('APPROVED','RETIRED')
          AND ms.effective_from::date<=v_period.ends_on
          AND (ms.effective_to IS NULL OR ms.effective_to::date>v_period.ends_on)
          AND ms.input_keys=jsonb_build_object('account_code',k.account_code)
      ), highest AS (
        SELECT * FROM eligible WHERE priority=(SELECT max(priority) FROM eligible)
      )
      SELECT count(*)::integer candidate_count,
        (array_agg(h.mapping_snapshot_id ORDER BY h.mapping_snapshot_id))[1] mapping_snapshot_id,
        (array_agg(h.version::text ORDER BY h.mapping_snapshot_id))[1] mapping_version,
        (array_agg(h.snapshot_hash ORDER BY h.mapping_snapshot_id))[1] mapping_snapshot_hash,
        (array_agg(h.output_rules->>'classification' ORDER BY h.mapping_snapshot_id))[1] classification
      FROM highest h
    ) x ON true
  ), lines AS (
    SELECT l.ledger_line_id,l.journal_entry_id,l.journal_line_id,l.account_code,
      l.debit_amount,l.credit_amount,j.journal_date
    FROM public.ledger_line l
    JOIN public.journal_entry j
      ON j.tenant_id=l.tenant_id
     AND j.entity_id=l.entity_id
     AND j.journal_entry_id=l.journal_entry_id
    WHERE l.tenant_id=p_tenant AND l.entity_id=p_entity AND j.status='POSTED'
  ), balances AS (
    SELECT m.*,a.account_name,
      COALESCE(sum(CASE WHEN l.journal_date<v_period.starts_on THEN l.credit_amount-l.debit_amount ELSE 0 END),0)::numeric(20,4) opening_balance,
      COALESCE(sum(CASE WHEN l.journal_date BETWEEN v_period.starts_on AND v_period.ends_on THEN l.credit_amount ELSE 0 END),0)::numeric(20,4) period_draws,
      COALESCE(sum(CASE WHEN l.journal_date BETWEEN v_period.starts_on AND v_period.ends_on THEN l.debit_amount ELSE 0 END),0)::numeric(20,4) period_repayments,
      COALESCE(sum(CASE WHEN l.journal_date<=v_period.ends_on THEN l.credit_amount-l.debit_amount ELSE 0 END),0)::numeric(20,4) closing_balance,
      array_agg(DISTINCT l.journal_entry_id ORDER BY l.journal_entry_id) FILTER(WHERE l.journal_date<=v_period.ends_on) journal_entry_ids,
      array_agg(DISTINCT l.journal_line_id ORDER BY l.journal_line_id) FILTER(WHERE l.journal_date<=v_period.ends_on) journal_line_ids,
      array_agg(DISTINCT l.ledger_line_id ORDER BY l.ledger_line_id) FILTER(WHERE l.journal_date<=v_period.ends_on) ledger_line_ids
    FROM mapped m
    LEFT JOIN lines l ON l.account_code=m.account_code
    LEFT JOIN public.account_master a
      ON a.tenant_id=p_tenant AND a.entity_id=p_entity
     AND a.account_code=m.account_code AND a.active
    GROUP BY m.account_code,m.candidate_count,m.mapping_snapshot_id,m.mapping_version,
      m.mapping_snapshot_hash,m.classification,a.account_name
  ), evidence AS (
    SELECT b.*,
      ARRAY(
        SELECT DISTINCT sl.source_document_id
        FROM public.source_link sl
        WHERE sl.tenant_id=p_tenant AND sl.entity_id=p_entity
          AND sl.source_document_id IS NOT NULL
          AND sl.journal_entry_id=ANY(COALESCE(b.journal_entry_ids,ARRAY[]::uuid[]))
        ORDER BY sl.source_document_id
      )::uuid[] source_document_ids
    FROM balances b
  )
  SELECT p_entity,v_period.base_currency,v_period.period_id,v_period.period_code,
    to_char(v_period.starts_on,'YYYY-MM-DD'),to_char(v_period.ends_on,'YYYY-MM-DD'),
    e.account_code,COALESCE(e.account_name,'Unmapped account'),
    CASE WHEN e.candidate_count=0 THEN 'BLOCKED_MAPPING_REQUIRED'
      WHEN e.candidate_count<>1 THEN 'BLOCKED_MAPPING_AMBIGUOUS'
      WHEN e.classification<>'CONSTRUCTION_LOAN' THEN 'BLOCKED_MAPPING_RULE_INVALID'
      ELSE 'MAPPED_CONSTRUCTION_LOAN_ACCOUNT' END,
    CASE WHEN e.candidate_count=1 AND e.classification='CONSTRUCTION_LOAN'
      THEN 'APPROVED_CONSTRUCTION_LOAN_ACCOUNT_MAPPING_SNAPSHOT_EXACT'
      ELSE 'CONSTRUCTION_LOAN_ACCOUNT_MAPPING_SNAPSHOT_REQUIRED' END,
    CASE WHEN e.candidate_count=1 AND e.classification='CONSTRUCTION_LOAN' THEN e.opening_balance END,
    CASE WHEN e.candidate_count=1 AND e.classification='CONSTRUCTION_LOAN' THEN e.period_draws END,
    CASE WHEN e.candidate_count=1 AND e.classification='CONSTRUCTION_LOAN' THEN e.period_repayments END,
    CASE WHEN e.candidate_count=1 AND e.classification='CONSTRUCTION_LOAN' THEN e.closing_balance END,
    CASE WHEN e.candidate_count=1 AND e.classification='CONSTRUCTION_LOAN' THEN e.mapping_snapshot_id END,
    CASE WHEN e.candidate_count=1 AND e.classification='CONSTRUCTION_LOAN' THEN e.mapping_version END,
    CASE WHEN e.candidate_count=1 AND e.classification='CONSTRUCTION_LOAN' THEN e.mapping_snapshot_hash END,
    e.journal_entry_ids,e.journal_line_ids,e.ledger_line_ids,e.source_document_ids
  FROM evidence e
  WHERE e.journal_entry_ids IS NOT NULL
  ORDER BY e.account_code;
END;
$$;

CREATE FUNCTION refs_read_ai_construction_loan_lender_balance_population(
  p_tenant uuid,
  p_entity uuid,
  p_period uuid
)
RETURNS TABLE(
  entity_id uuid,
  period_id uuid,
  period_code text,
  period_start text,
  period_end text,
  source_document_id uuid,
  source_document_line_id uuid,
  source_payload_hash text,
  source_line_hash text,
  loan_ref text,
  statement_date date,
  currency char(3),
  lender_closing_balance numeric(20,4),
  account_code text,
  mapping_snapshot_id uuid,
  mapping_version text,
  mapping_snapshot_hash text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp
AS $$
DECLARE
  v_period record;
BEGIN
  PERFORM public.refs_assert_ai_analysis_scope(p_tenant,p_entity);
  SELECT ap.period_id,ap.period_code,ap.starts_on,ap.ends_on,e.base_currency
    INTO v_period
  FROM public.accounting_period ap
  JOIN public.entity e
    ON e.tenant_id=ap.tenant_id AND e.entity_id=ap.entity_id
  WHERE ap.tenant_id=p_tenant
    AND ap.entity_id=p_entity
    AND ap.period_id=p_period
    AND ap.ledger_code='PRIMARY';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'AI lender balance read requires one primary entity period'
      USING ERRCODE='22023';
  END IF;

  RETURN QUERY
  WITH source_rows AS (
    SELECT d.entity_id,d.source_document_id,l.source_document_line_id,d.payload_hash,
      public.refs_jsonb_hash(jsonb_build_object(
        'schema_version','AI_LENDER_CLOSING_BALANCE_SOURCE_V1',
        'source_document_id',d.source_document_id,
        'source_document_line_id',l.source_document_line_id,
        'source_line_id',l.source_line_id,
        'line_no',l.line_no,
        'loan_ref',btrim(l.loan_ref),
        'statement_date',d.accounting_date,
        'currency',d.currency,
        'lender_closing_balance',l.amount,
        'statement_balance_kind',l.external_dimension_refs->>'statement_balance_kind')) source_line_hash,
      btrim(l.loan_ref) loan_ref,d.accounting_date statement_date,d.currency,
      l.amount lender_closing_balance
    FROM public.source_document d
    JOIN public.source_document_line l
      ON l.tenant_id=d.tenant_id AND l.entity_id=d.entity_id
     AND l.source_document_id=d.source_document_id
    WHERE d.tenant_id=p_tenant AND d.entity_id=p_entity
      AND d.source_module='loan' AND d.document_type='LOAN_STATEMENT'
      AND d.status='READY_FOR_DRAFT'
      AND d.accounting_date BETWEEN v_period.starts_on AND v_period.ends_on
      AND d.currency=v_period.base_currency
      AND d.payload_hash~'^sha256:[0-9a-f]{64}$'
      AND NULLIF(btrim(l.loan_ref),'') IS NOT NULL
      AND l.direction='NONE' AND l.amount>=0
      AND l.external_dimension_refs=jsonb_build_object('statement_balance_kind','CLOSING_PRINCIPAL_BALANCE')
  ), mapped AS (
    SELECT s.*,m.mapping_snapshot_id,m.version::text mapping_version,m.snapshot_hash,
      m.output_rules->>'account_code' account_code,
      count(*) OVER(PARTITION BY s.source_document_line_id) mapping_count,
      max(s.statement_date) OVER(PARTITION BY m.output_rules->>'account_code') latest_date
    FROM source_rows s
    JOIN public.mapping_snapshot m
      ON m.tenant_id=p_tenant AND m.entity_id=p_entity
     AND m.family='CONSTRUCTION_LOAN_STATEMENT_ACCOUNT_PAIR'
     AND m.status='APPROVED'
     AND m.effective_from::date<=s.statement_date
     AND (m.effective_to IS NULL OR m.effective_to::date>s.statement_date)
     AND m.input_keys=jsonb_build_object('loan_ref',s.loan_ref)
    WHERE m.snapshot_hash=public.refs_jsonb_hash(
      jsonb_build_object('input_keys',m.input_keys,'output_rules',m.output_rules)
    )
      AND m.output_rules ? 'account_code'
      AND m.output_rules->>'account_code'~'^[0-9A-Za-z._-]{1,64}$'
  )
  SELECT m.entity_id,v_period.period_id,v_period.period_code,
    to_char(v_period.starts_on,'YYYY-MM-DD'),to_char(v_period.ends_on,'YYYY-MM-DD'),
    m.source_document_id,m.source_document_line_id,m.payload_hash,m.source_line_hash,
    m.loan_ref,m.statement_date,m.currency,m.lender_closing_balance,m.account_code,
    m.mapping_snapshot_id,m.mapping_version,m.snapshot_hash
  FROM mapped m
  WHERE m.mapping_count=1 AND m.statement_date=m.latest_date
  ORDER BY m.account_code,m.source_document_line_id;
END;
$$;

REVOKE ALL ON FUNCTION refs_read_ai_construction_loan_gl_balances(uuid,uuid,uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION refs_read_ai_construction_loan_lender_balance_population(uuid,uuid,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION refs_read_ai_construction_loan_gl_balances(uuid,uuid,uuid) TO refs_app;
GRANT EXECUTE ON FUNCTION refs_read_ai_construction_loan_lender_balance_population(uuid,uuid,uuid) TO refs_app;

COMMIT;
