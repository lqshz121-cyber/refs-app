CREATE FUNCTION refs_read_journal_upload_rows(
  p_tenant uuid,p_entity uuid,p_period uuid
)
RETURNS TABLE(
  journal_entry_id uuid,journal_number text,journal_type text,status text,journal_date date,
  currency char(3),description text,revision bigint,created_at timestamptz,posted_at timestamptz,
  line_no integer,journal_line_id uuid,account_code text,debit_amount numeric,credit_amount numeric,
  member_ref text,line_description text,dimensions jsonb,source_document_ids uuid[]
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE period_row public.accounting_period%ROWTYPE;
BEGIN
  PERFORM public.refs_assert_scope(p_tenant,p_entity,'GL.JE.VIEW');
  SELECT * INTO period_row FROM public.accounting_period
   WHERE tenant_id=p_tenant AND entity_id=p_entity AND period_id=p_period;
  IF NOT FOUND THEN RAISE EXCEPTION 'Accounting period is absent or outside the entity' USING ERRCODE='P0002'; END IF;
  IF (
    SELECT count(*) FROM public.journal_entry j
    WHERE j.tenant_id=p_tenant AND j.entity_id=p_entity AND j.period_id=p_period
      AND j.status='APPROVED' AND j.journal_date BETWEEN period_row.starts_on AND period_row.ends_on
  ) > 500 THEN
    RAISE EXCEPTION 'Journal upload population is saturated' USING ERRCODE='22023';
  END IF;
  RETURN QUERY
    SELECT j.journal_entry_id,j.journal_number,j.journal_type::text,j.status::text,j.journal_date,
      j.currency,j.description,j.revision,j.created_at,j.posted_at,l.line_no,l.journal_line_id,
      l.account_code,l.debit_amount,l.credit_amount,l.member_ref,l.description,l.dimensions,
      COALESCE((SELECT array_agg(DISTINCT source_document_id ORDER BY source_document_id)
        FROM public.source_link sl
        WHERE sl.tenant_id=p_tenant AND sl.entity_id=p_entity AND sl.source_document_id IS NOT NULL
          AND (sl.journal_line_id=l.journal_line_id OR (sl.journal_line_id IS NULL AND sl.journal_entry_id=j.journal_entry_id))),'{}'::uuid[])
    FROM public.journal_entry j
    JOIN public.journal_line l ON l.tenant_id=j.tenant_id AND l.entity_id=j.entity_id
      AND l.period_id=j.period_id AND l.journal_entry_id=j.journal_entry_id
    WHERE j.tenant_id=p_tenant AND j.entity_id=p_entity AND j.period_id=p_period
      AND j.status='APPROVED' AND j.journal_date BETWEEN period_row.starts_on AND period_row.ends_on
    ORDER BY j.journal_date,j.journal_entry_id,l.line_no;
END;
$$;
REVOKE ALL ON FUNCTION refs_read_journal_upload_rows(uuid,uuid,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION refs_read_journal_upload_rows(uuid,uuid,uuid) TO refs_app;
COMMIT;
