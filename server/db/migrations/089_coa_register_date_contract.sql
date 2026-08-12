BEGIN;

-- PostgreSQL DATE values are parsed by node-postgres as local-time Date
-- objects. JSON serialization can therefore change the calendar day and does
-- not satisfy the API's YYYY-MM-DD contract. Recreate the read functions with
-- explicit date-only text at the database boundary.

DROP FUNCTION refs_list_account_register(uuid,uuid,uuid,text);
DROP FUNCTION refs_list_chart_of_accounts(uuid,uuid,uuid);

CREATE FUNCTION refs_list_chart_of_accounts(p_tenant uuid,p_entity uuid,p_period uuid)
RETURNS TABLE(
  period_id uuid,
  period_code text,
  period_start text,
  period_end text,
  account_code text,
  account_name text,
  requires_member boolean,
  required_member_type text,
  active boolean,
  currency char(3),
  opening_balance numeric(20,4),
  period_debit numeric(20,4),
  period_credit numeric(20,4),
  ending_balance numeric(20,4),
  posted_ledger_line_count bigint
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE selected_period record;
BEGIN
  PERFORM public.refs_assert_scope(p_tenant,p_entity,'GL.REPORT.VIEW');
  SELECT p.period_id,p.period_code,p.starts_on,p.ends_on INTO selected_period
  FROM public.accounting_period p
  WHERE p.tenant_id=p_tenant AND p.entity_id=p_entity AND p.period_id=p_period;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'A valid entity-scoped accounting period is required' USING ERRCODE='22023';
  END IF;

  RETURN QUERY
  WITH posted AS (
    SELECT l.account_code,l.currency,l.debit_amount,l.credit_amount,j.journal_date
    FROM public.ledger_line l
    JOIN public.journal_entry j
      ON j.tenant_id=l.tenant_id AND j.entity_id=l.entity_id AND j.journal_entry_id=l.journal_entry_id
    WHERE l.tenant_id=p_tenant AND l.entity_id=p_entity
      AND j.status='POSTED' AND j.journal_date<=selected_period.ends_on
  ), balances AS (
    SELECT posted.account_code,posted.currency,
      COALESCE(sum(posted.debit_amount-posted.credit_amount) FILTER(WHERE posted.journal_date<selected_period.starts_on),0)::numeric(20,4) AS opening_balance,
      COALESCE(sum(posted.debit_amount) FILTER(WHERE posted.journal_date BETWEEN selected_period.starts_on AND selected_period.ends_on),0)::numeric(20,4) AS period_debit,
      COALESCE(sum(posted.credit_amount) FILTER(WHERE posted.journal_date BETWEEN selected_period.starts_on AND selected_period.ends_on),0)::numeric(20,4) AS period_credit,
      COALESCE(sum(posted.debit_amount-posted.credit_amount),0)::numeric(20,4) AS ending_balance,
      count(*)::bigint AS posted_ledger_line_count
    FROM posted
    GROUP BY posted.account_code,posted.currency
  )
  SELECT selected_period.period_id,selected_period.period_code,
    to_char(selected_period.starts_on,'YYYY-MM-DD'),to_char(selected_period.ends_on,'YYYY-MM-DD'),
    a.account_code,a.account_name,a.requires_member,a.required_member_type,a.active,
    b.currency,b.opening_balance,b.period_debit,b.period_credit,b.ending_balance,
    COALESCE(b.posted_ledger_line_count,0)::bigint
  FROM public.account_master a
  LEFT JOIN balances b ON b.account_code=a.account_code
  WHERE a.tenant_id=p_tenant AND a.entity_id=p_entity
  ORDER BY a.account_code,b.currency NULLS LAST;
END;
$$;

CREATE FUNCTION refs_list_account_register(p_tenant uuid,p_entity uuid,p_period uuid,p_account_code text)
RETURNS TABLE(
  period_id uuid,
  period_code text,
  period_start text,
  period_end text,
  account_code text,
  account_name text,
  currency char(3),
  journal_date text,
  journal_entry_id uuid,
  journal_number text,
  journal_line_id uuid,
  ledger_line_id uuid,
  member_ref text,
  description text,
  debit_amount numeric(20,4),
  credit_amount numeric(20,4),
  opening_balance numeric(20,4),
  running_balance numeric(20,4),
  source_document_ids uuid[]
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE selected_period record;
BEGIN
  PERFORM public.refs_assert_scope(p_tenant,p_entity,'GL.JE.VIEW');
  IF p_account_code IS NULL OR btrim(p_account_code)<>p_account_code OR length(p_account_code)=0 OR length(p_account_code)>64 THEN
    RAISE EXCEPTION 'Account code is invalid' USING ERRCODE='22023';
  END IF;
  SELECT p.period_id,p.period_code,p.starts_on,p.ends_on INTO selected_period
  FROM public.accounting_period p
  WHERE p.tenant_id=p_tenant AND p.entity_id=p_entity AND p.period_id=p_period;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'A valid entity-scoped accounting period is required' USING ERRCODE='22023';
  END IF;
  IF NOT EXISTS(SELECT 1 FROM public.account_master m WHERE m.tenant_id=p_tenant AND m.entity_id=p_entity AND m.account_code=p_account_code) THEN
    RAISE EXCEPTION 'Account is absent or outside the entity' USING ERRCODE='P0002';
  END IF;

  RETURN QUERY
  WITH account AS (
    SELECT m.account_code,m.account_name FROM public.account_master m
    WHERE m.tenant_id=p_tenant AND m.entity_id=p_entity AND m.account_code=p_account_code
  ), history AS (
    SELECT l.ledger_line_id,l.journal_entry_id,l.journal_line_id,l.member_ref,l.currency,l.debit_amount,l.credit_amount,
      l.posted_at,j.journal_date,j.journal_number,jl.description
    FROM public.ledger_line l
    JOIN public.journal_entry j ON j.tenant_id=l.tenant_id AND j.entity_id=l.entity_id AND j.journal_entry_id=l.journal_entry_id
    LEFT JOIN public.journal_line jl ON jl.tenant_id=l.tenant_id AND jl.entity_id=l.entity_id AND jl.journal_line_id=l.journal_line_id
    WHERE l.tenant_id=p_tenant AND l.entity_id=p_entity AND l.account_code=p_account_code
      AND j.status='POSTED' AND j.journal_date<=selected_period.ends_on
  ), opening AS (
    SELECT h.currency,COALESCE(sum(h.debit_amount-h.credit_amount),0)::numeric(20,4) AS opening_balance
    FROM history h WHERE h.journal_date<selected_period.starts_on GROUP BY h.currency
  ), scoped AS (
    SELECT h.*,COALESCE(o.opening_balance,0)::numeric(20,4) AS opening_balance
    FROM history h LEFT JOIN opening o ON o.currency=h.currency
    WHERE h.journal_date BETWEEN selected_period.starts_on AND selected_period.ends_on
  )
  SELECT selected_period.period_id,selected_period.period_code,
    to_char(selected_period.starts_on,'YYYY-MM-DD'),to_char(selected_period.ends_on,'YYYY-MM-DD'),
    a.account_code,a.account_name,s.currency,to_char(s.journal_date,'YYYY-MM-DD'),s.journal_entry_id,s.journal_number,s.journal_line_id,s.ledger_line_id,
    s.member_ref,s.description,s.debit_amount,s.credit_amount,s.opening_balance,
    (s.opening_balance + sum(s.debit_amount-s.credit_amount) OVER(PARTITION BY s.currency ORDER BY s.journal_date,s.posted_at,s.ledger_line_id ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW))::numeric(20,4),
    ARRAY(SELECT DISTINCT link.source_document_id FROM public.source_link link
      WHERE link.tenant_id=p_tenant AND link.entity_id=p_entity AND link.journal_entry_id=s.journal_entry_id
        AND link.source_document_id IS NOT NULL ORDER BY link.source_document_id)::uuid[]
  FROM scoped s CROSS JOIN account a
  ORDER BY s.currency,s.journal_date,s.posted_at,s.ledger_line_id;
END;
$$;

REVOKE ALL ON FUNCTION refs_list_chart_of_accounts(uuid,uuid,uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION refs_list_account_register(uuid,uuid,uuid,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION refs_list_chart_of_accounts(uuid,uuid,uuid) TO refs_app;
GRANT EXECUTE ON FUNCTION refs_list_account_register(uuid,uuid,uuid,text) TO refs_app;

COMMIT;
