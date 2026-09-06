BEGIN;

-- Equivalent to the entity/period RLS scope predicate, resolved once as a
-- relation rather than repeatedly joining the context for every period row.
CREATE FUNCTION refs_read_accounting_scope_catalog(p_tenant uuid)
RETURNS TABLE(entity_id uuid,entity_name text,entity_code text,base_currency text,
  source_entity_id text,period_id uuid,period_code text,period_start date,
  period_end date,period_status text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
BEGIN
  RETURN QUERY
  WITH allowed_entities AS MATERIALIZED (
    SELECT DISTINCT g.entity_id
    FROM runtime_auth_context c
    CROSS JOIN LATERAL jsonb_array_elements(c.grants) scope
    JOIN runtime_actor_grant g
      ON g.tenant_id=c.tenant_id AND g.actor_id=c.actor_id
      AND g.entity_id=(scope->>'entity_id')::uuid AND g.permission=scope->>'permission'
      AND g.revoked_at IS NULL AND (g.valid_until IS NULL OR g.valid_until>clock_timestamp())
    JOIN permission_catalog pc ON pc.permission_code=g.permission
      AND pc.active AND pc.effective_from<=clock_timestamp()
      AND (pc.effective_to IS NULL OR pc.effective_to>clock_timestamp())
    WHERE c.tenant_id=p_tenant AND c.token_hash=current_setting('refs.context_hash',true)
      AND c.bound_login=session_user AND c.bound_backend_pid=pg_backend_pid()
      AND c.bound_txid=txid_current() AND c.revoked_at IS NULL AND c.expires_at>clock_timestamp()
  )
  SELECT e.entity_id,e.name,e.entity_code,e.base_currency::text,e.source_entity_id,
    p.period_id,p.period_code,p.starts_on,p.ends_on,p.status::text
  FROM allowed_entities a
  JOIN entity e ON e.tenant_id=p_tenant AND e.entity_id=a.entity_id AND e.active
  JOIN accounting_period p ON p.tenant_id=p_tenant AND p.entity_id=e.entity_id
  ORDER BY e.name,e.entity_code,p.starts_on DESC,p.period_id;
END;
$$;
REVOKE ALL ON FUNCTION refs_read_accounting_scope_catalog(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION refs_read_accounting_scope_catalog(uuid) TO refs_app;

COMMIT;
