BEGIN;

INSERT INTO permission_catalog(permission_code,domain,risk_class,sod_class)
VALUES ('GL.REPORT.VIEW','GL','LOW','GL_REPORT_READER')
ON CONFLICT (permission_code) DO UPDATE
  SET active=true,domain=EXCLUDED.domain,risk_class=EXCLUDED.risk_class,sod_class=EXCLUDED.sod_class,
      version=permission_catalog.version+1,effective_to=NULL;

CREATE INDEX ledger_line_financial_statement_scope_idx
  ON ledger_line(tenant_id,entity_id,account_code,journal_entry_id);
CREATE INDEX journal_entry_posted_report_scope_idx
  ON journal_entry(tenant_id,entity_id,journal_date,journal_entry_id)
  WHERE status='POSTED';

CREATE FUNCTION refs_get_financial_statements(
  p_tenant uuid,
  p_entity uuid,
  p_period uuid
)
RETURNS TABLE(
  period_id uuid,
  period_code text,
  period_start date,
  period_end date,
  statement_type text,
  statement_section text,
  classification_basis text,
  account_code text,
  account_name text,
  opening_debit numeric(20,4),
  opening_credit numeric(20,4),
  period_debit numeric(20,4),
  period_credit numeric(20,4),
  ending_debit numeric(20,4),
  ending_credit numeric(20,4),
  display_balance numeric(20,4),
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
  ), posted_lines AS (
    SELECT l.ledger_line_id,l.journal_entry_id,l.journal_line_id,l.account_code,
      l.debit_amount,l.credit_amount,j.journal_date
    FROM public.ledger_line l
    JOIN public.journal_entry j
      ON j.tenant_id=l.tenant_id AND j.entity_id=l.entity_id AND j.journal_entry_id=l.journal_entry_id
    CROSS JOIN selected_period p
    WHERE l.tenant_id=p_tenant AND l.entity_id=p_entity AND j.status='POSTED' AND j.journal_date<=p.ends_on
  ), account_totals AS (
    SELECT l.account_code,a.account_name,a.required_member_type,
      CASE
        WHEN l.account_code LIKE '1%' THEN 'ASSET'
        WHEN l.account_code LIKE '2%' THEN 'LIABILITY'
        WHEN l.account_code LIKE '3%' THEN 'EQUITY'
        WHEN l.account_code LIKE '4%' THEN 'REVENUE'
        WHEN l.account_code ~ '^[5-9]' THEN 'EXPENSE'
        ELSE 'UNCLASSIFIED'
      END AS account_class,
      COALESCE(sum(l.debit_amount) FILTER (WHERE l.journal_date<p.starts_on),0)::numeric(20,4) AS opening_debit,
      COALESCE(sum(l.credit_amount) FILTER (WHERE l.journal_date<p.starts_on),0)::numeric(20,4) AS opening_credit,
      COALESCE(sum(l.debit_amount) FILTER (WHERE l.journal_date BETWEEN p.starts_on AND p.ends_on),0)::numeric(20,4) AS period_debit,
      COALESCE(sum(l.credit_amount) FILTER (WHERE l.journal_date BETWEEN p.starts_on AND p.ends_on),0)::numeric(20,4) AS period_credit,
      COALESCE(sum(l.debit_amount),0)::numeric(20,4) AS ending_debit,
      COALESCE(sum(l.credit_amount),0)::numeric(20,4) AS ending_credit,
      array_agg(DISTINCT l.journal_entry_id ORDER BY l.journal_entry_id) AS journal_entry_ids,
      array_agg(DISTINCT l.journal_line_id ORDER BY l.journal_line_id) AS journal_line_ids,
      array_agg(DISTINCT l.ledger_line_id ORDER BY l.ledger_line_id) AS ledger_line_ids
    FROM posted_lines l
    CROSS JOIN selected_period p
    LEFT JOIN public.account_master a
      ON a.tenant_id=p_tenant AND a.entity_id=p_entity AND a.account_code=l.account_code AND a.active
    GROUP BY l.account_code,a.account_name,a.required_member_type,p.starts_on,p.ends_on
  ), account_evidence AS (
    SELECT a.*,
      ARRAY(
        SELECT DISTINCT s.source_document_id
        FROM public.source_link s
        WHERE s.tenant_id=p_tenant AND s.entity_id=p_entity
          AND s.source_document_id IS NOT NULL
          AND s.journal_entry_id=ANY(a.journal_entry_ids)
        ORDER BY s.source_document_id
      )::uuid[] AS source_document_ids
    FROM account_totals a
  ), statement_rows AS (
    SELECT a.*,v.statement_type,v.statement_section
    FROM account_evidence a
    CROSS JOIN LATERAL (
      VALUES
        ('TRIAL_BALANCE'::text,'ALL_ACCOUNTS'::text),
        ('BALANCE_SHEET'::text,CASE a.account_class WHEN 'ASSET' THEN 'ASSETS' WHEN 'LIABILITY' THEN 'LIABILITIES' WHEN 'EQUITY' THEN 'EQUITY' WHEN 'REVENUE' THEN 'CURRENT_EARNINGS' WHEN 'EXPENSE' THEN 'CURRENT_EARNINGS' ELSE 'UNCLASSIFIED' END),
        ('INCOME_STATEMENT'::text,CASE a.account_class WHEN 'REVENUE' THEN 'REVENUE' WHEN 'EXPENSE' THEN 'EXPENSES' ELSE NULL END),
        -- Compatibility keeps the existing statement_type, but this is deliberately
        -- direct cash-account movement evidence, not an indirect cash-flow statement.
        ('CASH_FLOW'::text,CASE WHEN a.required_member_type='BANK' THEN 'DIRECT_CASH_MOVEMENT' ELSE NULL END)
    ) v(statement_type,statement_section)
    WHERE v.statement_section IS NOT NULL
  )
  SELECT p.period_id,p.period_code,p.starts_on,p.ends_on,
    r.statement_type,r.statement_section,'ACCOUNT_CODE_PREFIX_AND_BANK_MEMBER'::text,
    r.account_code,COALESCE(r.account_name,'Unmapped account'),
    r.opening_debit,r.opening_credit,r.period_debit,r.period_credit,r.ending_debit,r.ending_credit,
    CASE r.statement_type
      WHEN 'TRIAL_BALANCE' THEN r.ending_debit-r.ending_credit
      WHEN 'BALANCE_SHEET' THEN CASE WHEN r.account_class='ASSET' THEN r.ending_debit-r.ending_credit ELSE r.ending_credit-r.ending_debit END
      WHEN 'INCOME_STATEMENT' THEN CASE WHEN r.account_class='REVENUE' THEN r.period_credit-r.period_debit ELSE r.period_debit-r.period_credit END
      -- A positive value is a direct increase in retained cash-account evidence.
      -- Operating/investing/financing classification is not inferred here.
      WHEN 'CASH_FLOW' THEN r.period_debit-r.period_credit
    END::numeric(20,4),
    r.journal_entry_ids,r.journal_line_ids,r.ledger_line_ids,r.source_document_ids
  FROM statement_rows r
  CROSS JOIN selected_period p
  ORDER BY r.statement_type,r.statement_section,r.account_code;
END;
$$;

REVOKE ALL ON FUNCTION refs_get_financial_statements(uuid,uuid,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION refs_get_financial_statements(uuid,uuid,uuid) TO refs_app;

COMMIT;
