BEGIN;

CREATE TABLE refs_deployment_identity (
  singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
  installation_id uuid NOT NULL,
  deployment_environment text NOT NULL CHECK (deployment_environment IN ('staging','production')),
  database_name text NOT NULL CHECK (length(database_name)>0),
  initialized_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
REVOKE ALL ON refs_deployment_identity FROM PUBLIC,refs_app,refs_runtime,refs_context_issuer,refs_grant_sync;

-- The permanent fence row detects a seal committed after a SERIALIZABLE
-- snapshot was established. The retained installation itself is append-only.
CREATE TABLE refs_deployment_identity_fence (
  singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
  generation integer NOT NULL CHECK (generation IN (0,1))
);
INSERT INTO refs_deployment_identity_fence(singleton,generation) VALUES(true,0);
REVOKE ALL ON refs_deployment_identity_fence FROM PUBLIC,refs_app,refs_runtime,refs_context_issuer,refs_grant_sync;

CREATE FUNCTION refs_deployment_identity_immutable() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog,public,pg_temp AS $$
BEGIN
  RAISE EXCEPTION 'Deployment identity is immutable' USING ERRCODE='42501';
END;
$$;
CREATE TRIGGER deployment_identity_no_change BEFORE UPDATE OR DELETE ON refs_deployment_identity
FOR EACH STATEMENT EXECUTE FUNCTION refs_deployment_identity_immutable();
CREATE TRIGGER deployment_identity_no_truncate BEFORE TRUNCATE ON refs_deployment_identity
FOR EACH STATEMENT EXECUTE FUNCTION refs_deployment_identity_immutable();

CREATE FUNCTION refs_initialize_deployment_identity(p_installation uuid,p_environment text,p_database text,p_confirmation text)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
BEGIN
  IF session_user<>current_user OR session_user IN ('refs_app','refs_runtime','refs_context_issuer','refs_grant_sync') THEN
    RAISE EXCEPTION 'Independent migrator required' USING ERRCODE='42501';
  END IF;
  IF p_installation IS NULL OR p_environment IS NULL OR p_environment NOT IN ('staging','production')
    OR p_database IS DISTINCT FROM current_database() OR p_confirmation IS DISTINCT FROM 'INITIALIZE_IMMUTABLE_DEPLOYMENT_IDENTITY' THEN
    RAISE EXCEPTION 'Deployment initialization scope denied' USING ERRCODE='22023';
  END IF;
  LOCK TABLE public.refs_deployment_identity IN EXCLUSIVE MODE;
  IF EXISTS(SELECT 1 FROM public.refs_deployment_identity) THEN
    IF NOT EXISTS(SELECT 1 FROM public.refs_deployment_identity WHERE installation_id=p_installation AND deployment_environment=p_environment AND database_name=p_database) THEN
      RAISE EXCEPTION 'Deployment identity drift denied' USING ERRCODE='42501';
    END IF;
    RETURN false;
  END IF;
  INSERT INTO public.refs_deployment_identity(installation_id,deployment_environment,database_name) VALUES(p_installation,p_environment,p_database);
  UPDATE public.refs_deployment_identity_fence SET generation=1 WHERE singleton AND generation=0;
  IF NOT FOUND THEN RAISE EXCEPTION 'Deployment identity fence denied' USING ERRCODE='42501'; END IF;
  RETURN true;
END;
$$;
REVOKE ALL ON FUNCTION refs_initialize_deployment_identity(uuid,text,text,text) FROM PUBLIC,refs_app,refs_runtime,refs_context_issuer,refs_grant_sync;

CREATE FUNCTION refs_assert_deployment_identity(p_installation uuid,p_environment text,p_database text)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER VOLATILE SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE fence_generation integer;
BEGIN
  IF session_user<>'refs_grant_sync' THEN
    RAISE EXCEPTION 'Grant sync identity denied' USING ERRCODE='42501';
  END IF;
  LOCK TABLE public.refs_deployment_identity IN SHARE MODE;
  SELECT generation INTO fence_generation FROM public.refs_deployment_identity_fence WHERE singleton FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Deployment identity fence denied' USING ERRCODE='42501'; END IF;
  IF (fence_generation=0 AND EXISTS(SELECT 1 FROM public.refs_deployment_identity))
    OR (fence_generation=1 AND NOT EXISTS(SELECT 1 FROM public.refs_deployment_identity)) THEN
    RAISE EXCEPTION 'Deployment identity fence drift denied' USING ERRCODE='42501';
  END IF;
  IF p_database IS DISTINCT FROM current_database() OR NOT EXISTS(
    SELECT 1 FROM public.refs_deployment_identity WHERE installation_id=p_installation AND deployment_environment=p_environment AND database_name=p_database
  ) THEN
    RAISE EXCEPTION 'Deployment identity assertion denied' USING ERRCODE='42501';
  END IF;
  RETURN true;
END;
$$;
REVOKE ALL ON FUNCTION refs_assert_deployment_identity(uuid,text,text) FROM PUBLIC,refs_app,refs_runtime,refs_context_issuer;
GRANT EXECUTE ON FUNCTION refs_assert_deployment_identity(uuid,text,text) TO refs_grant_sync;

-- Uninitialized legacy staging remains compatible; sealed databases require
-- explicit staging identity and can never be relabeled by caller variables.
CREATE FUNCTION refs_assert_staging_deployment_target(p_installation uuid,p_database text)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER VOLATILE SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE fence_generation integer;
BEGIN
  IF session_user<>'refs_grant_sync' THEN
    RAISE EXCEPTION 'Grant sync identity denied' USING ERRCODE='42501';
  END IF;
  LOCK TABLE public.refs_deployment_identity IN SHARE MODE;
  SELECT generation INTO fence_generation FROM public.refs_deployment_identity_fence WHERE singleton FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Deployment identity fence denied' USING ERRCODE='42501'; END IF;
  IF (fence_generation=0 AND EXISTS(SELECT 1 FROM public.refs_deployment_identity))
    OR (fence_generation=1 AND NOT EXISTS(SELECT 1 FROM public.refs_deployment_identity)) THEN
    RAISE EXCEPTION 'Deployment identity fence drift denied' USING ERRCODE='42501';
  END IF;
  IF NOT EXISTS(SELECT 1 FROM public.refs_deployment_identity) THEN RETURN true; END IF;
  IF p_database IS DISTINCT FROM current_database() OR NOT EXISTS(
    SELECT 1 FROM public.refs_deployment_identity WHERE installation_id=p_installation AND deployment_environment='staging' AND database_name=p_database
  ) THEN
    RAISE EXCEPTION 'Staging deployment target denied' USING ERRCODE='42501';
  END IF;
  RETURN true;
END;
$$;
REVOKE ALL ON FUNCTION refs_assert_staging_deployment_target(uuid,text) FROM PUBLIC,refs_app,refs_runtime,refs_context_issuer;
GRANT EXECUTE ON FUNCTION refs_assert_staging_deployment_target(uuid,text) TO refs_grant_sync;
REVOKE ALL ON FUNCTION refs_deployment_identity_immutable() FROM PUBLIC,refs_app,refs_runtime,refs_context_issuer,refs_grant_sync;
COMMIT;
