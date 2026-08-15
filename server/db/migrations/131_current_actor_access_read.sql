BEGIN;

CREATE OR REPLACE FUNCTION public.refs_read_current_actor_access(p_tenant uuid,p_entity uuid)
RETURNS TABLE(
  tenant_id uuid,
  entity_id uuid,
  actor_id text,
  grant_set_version bigint,
  permissions text[],
  configured_permissions text[],
  session_refresh_required boolean
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE
  v_actor text:=public.refs_current_actor();
  v_permissions text[];
  v_configured_permissions text[];
  v_version bigint;
BEGIN
  IF public.refs_current_tenant() IS DISTINCT FROM p_tenant
    OR v_actor IS NULL OR length(btrim(v_actor))=0 THEN
    RAISE EXCEPTION 'Current actor access scope denied' USING ERRCODE='42501';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.runtime_auth_context c
    CROSS JOIN LATERAL jsonb_array_elements(c.grants) g
    WHERE c.token_hash=current_setting('refs.context_hash',true)
      AND c.bound_login=session_user
      AND c.bound_backend_pid=pg_backend_pid()
      AND c.bound_txid=txid_current()
      AND c.revoked_at IS NULL
      AND c.expires_at>clock_timestamp()
      AND c.tenant_id=p_tenant
      AND CASE
        WHEN COALESCE(g->>'entity_id','') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
        THEN (g->>'entity_id')::uuid=p_entity
        ELSE false
      END
  ) THEN
    RAISE EXCEPTION 'Current actor access scope denied' USING ERRCODE='42501';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.entity e
    WHERE e.tenant_id=p_tenant AND e.entity_id=p_entity AND e.active
  ) THEN
    RAISE EXCEPTION 'Current actor entity is absent or inactive' USING ERRCODE='42501';
  END IF;

  SELECT COALESCE(array_agg(DISTINCT g->>'permission' ORDER BY g->>'permission'),'{}'::text[])
    INTO v_permissions
  FROM public.runtime_auth_context c
  CROSS JOIN LATERAL jsonb_array_elements(c.grants) g
  WHERE c.token_hash=current_setting('refs.context_hash',true)
    AND c.bound_login=session_user
    AND c.bound_backend_pid=pg_backend_pid()
    AND c.bound_txid=txid_current()
    AND c.revoked_at IS NULL
    AND c.expires_at>clock_timestamp()
    AND c.tenant_id=p_tenant
    AND CASE
      WHEN COALESCE(g->>'entity_id','') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      THEN (g->>'entity_id')::uuid=p_entity
      ELSE false
    END
    AND length(COALESCE(g->>'permission',''))>0;

  SELECT s.version INTO v_version
  FROM public.runtime_actor_grant_set s
  WHERE s.tenant_id=p_tenant AND s.entity_id=p_entity AND s.actor_id=v_actor;

  SELECT COALESCE(array_agg(g.permission ORDER BY g.permission),'{}'::text[])
    INTO v_configured_permissions
  FROM public.runtime_actor_grant g
  JOIN public.permission_catalog pc ON pc.permission_code=g.permission
  WHERE g.tenant_id=p_tenant AND g.entity_id=p_entity AND g.actor_id=v_actor
    AND g.revoked_at IS NULL AND (g.valid_until IS NULL OR g.valid_until>clock_timestamp())
    AND pc.active AND pc.effective_from<=clock_timestamp()
    AND (pc.effective_to IS NULL OR pc.effective_to>clock_timestamp());

  RETURN QUERY SELECT p_tenant,p_entity,v_actor,COALESCE(v_version,0),v_permissions,
    v_configured_permissions,v_permissions IS DISTINCT FROM v_configured_permissions;
END;
$$;

REVOKE ALL ON FUNCTION public.refs_read_current_actor_access(uuid,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.refs_read_current_actor_access(uuid,uuid) TO refs_app;

COMMIT;
