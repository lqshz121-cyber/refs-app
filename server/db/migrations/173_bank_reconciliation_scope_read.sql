BEGIN;

CREATE FUNCTION refs_list_reconciliation_scopes(
  p_tenant uuid,
  p_entity uuid,
  p_limit integer DEFAULT 100
)
RETURNS TABLE(
  reconciliation_id uuid,
  bank_account_ref text,
  statement_ending_date date,
  currency char(3),
  status text,
  version bigint
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
BEGIN
  PERFORM public.refs_assert_scope(p_tenant,p_entity,'BANK.VIEW');
  IF p_limit IS NULL OR p_limit<1 OR p_limit>200 THEN
    RAISE EXCEPTION 'Reconciliation scope limit must be between 1 and 200' USING ERRCODE='22023';
  END IF;
  RETURN QUERY
    SELECT r.reconciliation_id,r.bank_account_ref,r.statement_ending_date,r.currency,r.status::text,r.version
    FROM public.reconciliation r
    WHERE r.tenant_id=p_tenant AND r.entity_id=p_entity
      AND r.status IN ('DRAFT','IN_REVIEW','REOPENED','RECONCILED')
    ORDER BY r.statement_ending_date DESC,r.bank_account_ref COLLATE "C",r.reconciliation_id DESC
    LIMIT p_limit;
END;
$$;

COMMENT ON FUNCTION refs_list_reconciliation_scopes(uuid,uuid,integer) IS
  'Discovers existing entity-scoped reconciliation account and cutoff keys for read/navigation only; it grants no lifecycle or accounting authority.';

REVOKE ALL ON FUNCTION refs_list_reconciliation_scopes(uuid,uuid,integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION refs_list_reconciliation_scopes(uuid,uuid,integer) TO refs_app;

COMMIT;
