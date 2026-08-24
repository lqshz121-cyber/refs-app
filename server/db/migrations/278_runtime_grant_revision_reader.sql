BEGIN;

CREATE FUNCTION refs_current_actor_grant_set_version(p_tenant uuid,p_actor text,p_entity uuid)
RETURNS bigint
LANGUAGE plpgsql SECURITY DEFINER STABLE SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE current_version bigint;
BEGIN
  IF session_user<>'refs_grant_sync' THEN
    RAISE EXCEPTION 'Grant sync identity denied' USING ERRCODE='42501';
  END IF;
  IF p_tenant IS NULL OR p_entity IS NULL OR p_actor IS NULL OR length(btrim(p_actor))=0 THEN
    RAISE EXCEPTION 'Grant revision scope is invalid' USING ERRCODE='22023';
  END IF;
  IF NOT EXISTS(SELECT 1 FROM entity WHERE tenant_id=p_tenant AND entity_id=p_entity AND active) THEN
    RAISE EXCEPTION 'Grant entity is absent or outside tenant' USING ERRCODE='42501';
  END IF;
  SELECT version INTO current_version
  FROM runtime_actor_grant_set
  WHERE tenant_id=p_tenant AND actor_id=p_actor AND entity_id=p_entity;
  RETURN COALESCE(current_version,0);
END;
$$;

REVOKE ALL ON FUNCTION refs_current_actor_grant_set_version(uuid,text,uuid) FROM PUBLIC,refs_app,refs_runtime,refs_context_issuer;
GRANT EXECUTE ON FUNCTION refs_current_actor_grant_set_version(uuid,text,uuid) TO refs_grant_sync;

COMMIT;
