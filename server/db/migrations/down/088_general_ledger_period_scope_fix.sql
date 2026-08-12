BEGIN;

-- Restore the migration 085 definition exactly for reversible migration tests.
CREATE OR REPLACE FUNCTION refs_list_general_ledger(
  p_tenant uuid,p_entity uuid,p_period uuid,p_account_code text,p_query text,p_limit integer,p_offset integer
)
RETURNS TABLE(
  period_id uuid, period_code text, period_start date, period_end date,
  account_code text, account_name text, currency char(3), journal_date date,
  journal_entry_id uuid, journal_number text, journal_line_id uuid, ledger_line_id uuid,
  member_ref text, description text, debit_amount numeric(20,4), credit_amount numeric(20,4),
  source_document_ids uuid[], total_count bigint
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE selected_period record;
BEGIN
  PERFORM public.refs_assert_scope(p_tenant,p_entity,'GL.JE.VIEW');
  IF p_account_code IS NOT NULL AND (btrim(p_account_code)<>p_account_code OR p_account_code !~ '^[A-Za-z0-9._-]{1,64}$') THEN
    RAISE EXCEPTION 'Account code is invalid' USING ERRCODE='22023';
  END IF;
  IF p_query IS NOT NULL AND (btrim(p_query)<>p_query OR length(p_query)>160 OR p_query ~ '[[:cntrl:]]') THEN
    RAISE EXCEPTION 'General Ledger query is invalid' USING ERRCODE='22023';
  END IF;
  IF p_limit IS NULL OR p_limit < 1 OR p_limit > 200 OR p_offset IS NULL OR p_offset < 0 THEN
    RAISE EXCEPTION 'General Ledger page is invalid' USING ERRCODE='22023';
  END IF;
  SELECT period_id,period_code,starts_on,ends_on INTO selected_period
  FROM public.accounting_period WHERE tenant_id=p_tenant AND entity_id=p_entity AND period_id=p_period;
  IF NOT FOUND THEN RAISE EXCEPTION 'A valid entity-scoped accounting period is required' USING ERRCODE='22023'; END IF;

  RETURN QUERY
  WITH scoped AS (
    SELECT l.ledger_line_id,l.journal_entry_id,l.journal_line_id,l.account_code,l.member_ref,l.currency,l.debit_amount,l.credit_amount,
      l.posted_at,j.journal_date,j.journal_number,jl.description,m.account_name,
      ARRAY(SELECT DISTINCT link.source_document_id FROM public.source_link link
        WHERE link.tenant_id=p_tenant AND link.entity_id=p_entity AND link.journal_entry_id=l.journal_entry_id
          AND link.source_document_id IS NOT NULL ORDER BY link.source_document_id)::uuid[] AS source_document_ids
    FROM public.ledger_line l
    JOIN public.journal_entry j ON j.tenant_id=l.tenant_id AND j.entity_id=l.entity_id AND j.journal_entry_id=l.journal_entry_id
    JOIN public.account_master m ON m.tenant_id=l.tenant_id AND m.entity_id=l.entity_id AND m.account_code=l.account_code
    LEFT JOIN public.journal_line jl ON jl.tenant_id=l.tenant_id AND jl.entity_id=l.entity_id AND jl.journal_line_id=l.journal_line_id
    WHERE l.tenant_id=p_tenant AND l.entity_id=p_entity AND j.status='POSTED'
      AND j.journal_date BETWEEN selected_period.starts_on AND selected_period.ends_on
      AND (p_account_code IS NULL OR l.account_code=p_account_code)
      AND (p_query IS NULL OR l.account_code ILIKE '%'||p_query||'%' OR j.journal_number ILIKE '%'||p_query||'%' OR COALESCE(jl.description,'') ILIKE '%'||p_query||'%')
  ), numbered AS (
    SELECT scoped.*,count(*) OVER()::bigint AS total_count FROM scoped
  )
  SELECT selected_period.period_id,selected_period.period_code,selected_period.starts_on,selected_period.ends_on,
    n.account_code,n.account_name,n.currency,n.journal_date,n.journal_entry_id,n.journal_number,n.journal_line_id,n.ledger_line_id,
    n.member_ref,n.description,n.debit_amount::numeric(20,4),n.credit_amount::numeric(20,4),n.source_document_ids,n.total_count
  FROM numbered n ORDER BY n.journal_date,n.posted_at,n.ledger_line_id LIMIT p_limit OFFSET p_offset;
END;
$$;

REVOKE ALL ON FUNCTION refs_list_general_ledger(uuid,uuid,uuid,text,text,integer,integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION refs_list_general_ledger(uuid,uuid,uuid,text,text,integer,integer) TO refs_app;
COMMIT;
