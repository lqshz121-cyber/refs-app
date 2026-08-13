BEGIN;

-- A signed reconciliation is no longer an open worksheet.  Read it only from
-- the immutable snapshot written by SIGN_OFF; this function has no command
-- authority and never reconstructs a mutable worksheet.
CREATE FUNCTION refs_get_reconciled_snapshot(
  p_tenant uuid,p_entity uuid,p_reconciliation uuid
)
RETURNS TABLE(
  reconciliation_snapshot_id uuid,reconciliation_id uuid,reconciliation_version bigint,
  statement_ending_date text,snapshot_hash text,signed_off_by text,signed_off_at timestamptz,
  snapshot_body jsonb
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
BEGIN
  PERFORM public.refs_assert_scope(p_tenant,p_entity,'BANK.VIEW');
  IF p_reconciliation IS NULL THEN
    RAISE EXCEPTION 'A reconciliation identifier is required' USING ERRCODE='22023';
  END IF;
  RETURN QUERY
    SELECT s.reconciliation_snapshot_id,s.reconciliation_id,s.reconciliation_version,
      pg_catalog.to_char(s.statement_ending_date,'YYYY-MM-DD'),s.snapshot_hash,s.signed_off_by,s.signed_off_at,
      s.snapshot_body
    FROM public.reconciliation_snapshot s
    JOIN public.reconciliation r
      ON r.tenant_id=s.tenant_id AND r.entity_id=s.entity_id AND r.reconciliation_id=s.reconciliation_id
    WHERE s.tenant_id=p_tenant AND s.entity_id=p_entity AND s.reconciliation_id=p_reconciliation
      AND r.status='RECONCILED'
    ORDER BY s.reconciliation_version DESC
    LIMIT 1;
END;
$$;

REVOKE ALL ON FUNCTION refs_get_reconciled_snapshot(uuid,uuid,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION refs_get_reconciled_snapshot(uuid,uuid,uuid) TO refs_app;

COMMIT;
