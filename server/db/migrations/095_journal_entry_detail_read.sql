BEGIN;

CREATE FUNCTION refs_get_journal_entry_detail(
  p_tenant uuid,p_entity uuid,p_period uuid,p_journal uuid
)
RETURNS TABLE(
  entity_id uuid,period_id uuid,journal_entry_id uuid,journal_number text,journal_type text,status text,
  journal_date date,currency char(3),journal_description text,revision bigint,created_at timestamptz,posted_at timestamptz,
  line_no integer,journal_line_id uuid,ledger_line_id uuid,account_code text,debit_amount numeric(20,4),credit_amount numeric(20,4),
  member_ref text,line_description text,dimensions jsonb,source_document_ids uuid[]
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
BEGIN
  PERFORM public.refs_assert_scope(p_tenant,p_entity,'GL.JE.VIEW');

  PERFORM 1 FROM public.accounting_period ap
  WHERE ap.tenant_id=p_tenant AND ap.entity_id=p_entity AND ap.period_id=p_period;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Journal entry was not found' USING ERRCODE='P0002';
  END IF;

  PERFORM 1 FROM public.journal_entry j
  WHERE j.tenant_id=p_tenant AND j.entity_id=p_entity AND j.period_id=p_period AND j.journal_entry_id=p_journal;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Journal entry was not found' USING ERRCODE='P0002';
  END IF;

  RETURN QUERY
  SELECT
    j.entity_id,j.period_id,j.journal_entry_id,j.journal_number,j.journal_type,j.status::text,
    j.journal_date,j.currency,j.description,j.revision,j.created_at,j.posted_at,
    jl.line_no,jl.journal_line_id,
    CASE WHEN j.status='POSTED' THEN ll.ledger_line_id ELSE NULL END,
    jl.account_code,jl.debit_amount::numeric(20,4),jl.credit_amount::numeric(20,4),
    jl.member_ref,jl.description,jl.dimensions,
    ARRAY(
      SELECT DISTINCT sl.source_document_id
      FROM public.source_link sl
      WHERE sl.tenant_id=p_tenant AND sl.entity_id=p_entity
        AND sl.journal_entry_id=j.journal_entry_id AND sl.source_document_id IS NOT NULL
        AND (
          (sl.journal_line_id IS NOT NULL AND sl.journal_line_id=jl.journal_line_id)
          OR (sl.ledger_line_id IS NOT NULL AND ll.ledger_line_id IS NOT NULL AND sl.ledger_line_id=ll.ledger_line_id)
          OR (sl.journal_line_id IS NULL AND sl.ledger_line_id IS NULL)
        )
      ORDER BY sl.source_document_id
    )::uuid[]
  FROM public.journal_entry j
  JOIN public.journal_line jl
    ON jl.tenant_id=j.tenant_id AND jl.entity_id=j.entity_id AND jl.period_id=j.period_id AND jl.journal_entry_id=j.journal_entry_id
  LEFT JOIN public.ledger_line ll
    ON j.status='POSTED' AND ll.tenant_id=jl.tenant_id AND ll.entity_id=jl.entity_id
      AND ll.period_id=jl.period_id AND ll.journal_entry_id=jl.journal_entry_id AND ll.journal_line_id=jl.journal_line_id
  WHERE j.tenant_id=p_tenant AND j.entity_id=p_entity AND j.period_id=p_period AND j.journal_entry_id=p_journal
  ORDER BY jl.line_no,jl.journal_line_id;
END;
$$;

REVOKE ALL ON FUNCTION refs_get_journal_entry_detail(uuid,uuid,uuid,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION refs_get_journal_entry_detail(uuid,uuid,uuid,uuid) TO refs_app;

COMMIT;
