BEGIN;

-- Line-level Journal Entry read.
-- This reuses the GL.JE.VIEW permission created by 057_journal_entry_read.sql. It
-- introduces no new permission, no new table, and no new index: the existing
-- journal_line UNIQUE (tenant_id, journal_entry_id, line_no) already covers the lookup.
-- journal_line is the authoritative line of record for every Journal Entry status, so
-- DRAFT lines are readable here. ledger_line is joined only as POSTED evidence and can
-- never fan out because of its UNIQUE (tenant_id, journal_line_id) constraint.

CREATE FUNCTION refs_get_journal_entry_lines(p_tenant uuid,p_entity uuid,p_journal_entry_id uuid)
RETURNS TABLE(
  journal_entry_id uuid,
  journal_line_id uuid,
  line_no integer,
  account_code text,
  account_name text,
  debit_amount numeric(20,4),
  credit_amount numeric(20,4),
  currency char(3),
  member_ref text,
  description text,
  dimensions jsonb,
  period_id uuid,
  ledger_line_id uuid,
  posted_at timestamptz,
  source_document_id uuid
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
BEGIN
  PERFORM public.refs_assert_scope(p_tenant,p_entity,'GL.JE.VIEW');
  RETURN QUERY
  WITH scoped_lines AS (
    SELECT jl.journal_entry_id,jl.journal_line_id,jl.line_no,jl.account_code,
      jl.debit_amount,jl.credit_amount,jl.member_ref,jl.description,jl.dimensions,
      jl.period_id,j.currency
    FROM public.journal_line jl
    JOIN public.journal_entry j
      ON j.tenant_id=jl.tenant_id AND j.entity_id=jl.entity_id AND j.journal_entry_id=jl.journal_entry_id
    WHERE jl.tenant_id=p_tenant AND jl.entity_id=p_entity AND jl.journal_entry_id=p_journal_entry_id
  ), line_evidence AS (
    -- Source evidence is resolved through source_link, never through a column on
    -- journal_entry. Both link levels are collected so ambiguity stays visible.
    SELECT l.journal_line_id,
      ARRAY(
        SELECT DISTINCT s.source_document_id FROM public.source_link s
        WHERE s.tenant_id=p_tenant AND s.entity_id=p_entity
          AND s.source_document_id IS NOT NULL AND s.journal_line_id=l.journal_line_id
      ) AS line_documents,
      ARRAY(
        SELECT DISTINCT s.source_document_id FROM public.source_link s
        WHERE s.tenant_id=p_tenant AND s.entity_id=p_entity
          AND s.source_document_id IS NOT NULL AND s.journal_line_id IS NULL
          AND s.journal_entry_id=l.journal_entry_id
      ) AS entry_documents
    FROM scoped_lines l
  )
  SELECT l.journal_entry_id,l.journal_line_id,l.line_no,l.account_code,
    COALESCE(am.account_name,'Unmapped account'),
    l.debit_amount,l.credit_amount,l.currency,l.member_ref,l.description,l.dimensions,
    l.period_id,ll.ledger_line_id,ll.posted_at,
    -- The line-level link wins over the entry-level link. When the winning level
    -- carries more than one distinct source document the value is NULL rather than an
    -- arbitrary pick: an ambiguous drill target is not evidence.
    CASE
      WHEN cardinality(e.line_documents)=1 THEN e.line_documents[1]
      WHEN cardinality(e.line_documents)=0 AND cardinality(e.entry_documents)=1 THEN e.entry_documents[1]
    END
  FROM scoped_lines l
  JOIN line_evidence e ON e.journal_line_id=l.journal_line_id
  LEFT JOIN public.ledger_line ll
    ON ll.tenant_id=p_tenant AND ll.entity_id=p_entity AND ll.journal_line_id=l.journal_line_id
  LEFT JOIN public.account_master am
    ON am.tenant_id=p_tenant AND am.entity_id=p_entity AND am.account_code=l.account_code AND am.active
  ORDER BY l.line_no;
END;
$$;

COMMENT ON FUNCTION refs_get_journal_entry_lines(uuid,uuid,uuid) IS 'Read-only entity-scoped Journal Entry line detail. Amounts stay numeric(20,4) and are never rounded, aggregated, or converted here.';

REVOKE ALL ON FUNCTION refs_get_journal_entry_lines(uuid,uuid,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION refs_get_journal_entry_lines(uuid,uuid,uuid) TO refs_app;

COMMIT;
