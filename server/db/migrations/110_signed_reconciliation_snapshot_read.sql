BEGIN;

-- A signed reconciliation is no longer an open worksheet.  Historical
-- Bank-to-GL readback must use this immutable snapshot instead of querying
-- mutable operational rows.
CREATE FUNCTION refs_get_signed_reconciliation_snapshot(
  p_tenant uuid,
  p_entity uuid,
  p_reconciliation uuid
)
RETURNS TABLE(
  reconciliation_snapshot_id uuid,
  reconciliation_id uuid,
  reconciliation_version bigint,
  bank_account_ref text,
  statement_ending_date date,
  snapshot_hash text,
  signed_off_by text,
  signed_off_at timestamptz,
  snapshot_body jsonb
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
BEGIN
  PERFORM public.refs_assert_scope(p_tenant,p_entity,'BANK.VIEW');
  RETURN QUERY
    SELECT s.reconciliation_snapshot_id,s.reconciliation_id,s.reconciliation_version,
      r.bank_account_ref,s.statement_ending_date,s.snapshot_hash,s.signed_off_by,
      s.signed_off_at,s.snapshot_body
    FROM public.reconciliation_snapshot s
    JOIN public.reconciliation r
      ON r.tenant_id=s.tenant_id AND r.entity_id=s.entity_id
      AND r.reconciliation_id=s.reconciliation_id
    WHERE s.tenant_id=p_tenant AND s.entity_id=p_entity
      AND s.reconciliation_id=p_reconciliation
    ORDER BY s.reconciliation_version DESC,s.signed_off_at DESC,s.reconciliation_snapshot_id DESC
    LIMIT 1;
END;
$$;

REVOKE ALL ON FUNCTION refs_get_signed_reconciliation_snapshot(uuid,uuid,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION refs_get_signed_reconciliation_snapshot(uuid,uuid,uuid) TO refs_app;

COMMIT;
