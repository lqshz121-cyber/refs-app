BEGIN;

INSERT INTO permission_catalog(permission_code,domain,risk_class,sod_class)
VALUES ('GL.JE.VIEW','GL','LOW','JE_READER')
ON CONFLICT (permission_code) DO UPDATE
  SET active=true,domain=EXCLUDED.domain,risk_class=EXCLUDED.risk_class,sod_class=EXCLUDED.sod_class,
      version=permission_catalog.version+1,effective_to=NULL;

CREATE FUNCTION refs_list_journal_entries(p_tenant uuid,p_entity uuid)
RETURNS TABLE(
  journal_entry_id uuid,
  journal_number text,
  journal_type text,
  status text,
  journal_date date,
  currency char(3),
  description text,
  revision bigint,
  created_at timestamptz,
  posted_at timestamptz,
  ledger_line_count bigint
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
BEGIN
  PERFORM public.refs_assert_scope(p_tenant,p_entity,'GL.JE.VIEW');
  RETURN QUERY
    SELECT j.journal_entry_id,j.journal_number,j.journal_type,j.status,j.journal_date,j.currency,
      j.description,j.revision,j.created_at,j.posted_at,
      count(l.ledger_line_id)::bigint
    FROM public.journal_entry j
    LEFT JOIN public.ledger_line l
      ON l.tenant_id=j.tenant_id AND l.entity_id=j.entity_id AND l.journal_entry_id=j.journal_entry_id
    WHERE j.tenant_id=p_tenant AND j.entity_id=p_entity
    GROUP BY j.journal_entry_id
    ORDER BY j.journal_date DESC,j.created_at DESC,j.journal_entry_id DESC;
END;
$$;

REVOKE ALL ON FUNCTION refs_list_journal_entries(uuid,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION refs_list_journal_entries(uuid,uuid) TO refs_app;

COMMIT;
