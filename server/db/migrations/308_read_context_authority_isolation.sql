BEGIN;

-- A read fallback carries only existing, active database read permissions.
-- Every authority check validates exact permissions carried by this context.
CREATE OR REPLACE FUNCTION refs_guard_runtime_context_sod() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE grant_expiry timestamptz;
BEGIN
  IF EXISTS(SELECT 1 FROM runtime_actor_grant g JOIN permission_catalog pc ON pc.permission_code=g.permission
    LEFT JOIN runtime_human_permission_authority p ON p.permission_code=g.permission
    WHERE g.tenant_id=NEW.tenant_id AND g.actor_id=NEW.actor_id AND g.revoked_at IS NULL AND g.authority_class<>'SERVICE'
      AND EXISTS(SELECT 1 FROM jsonb_array_elements(NEW.grants) scope WHERE (scope->>'entity_id')::uuid=g.entity_id AND scope->>'permission'=g.permission)
      AND (p.permission_code IS NOT NULL OR (pc.sod_class NOT IN('READ','VIEWER') AND pc.sod_class !~ '_READER$') OR g.permission='AI.ANALYSIS.EXPLAIN')
      AND (g.authority_class='LEGACY' OR g.valid_until IS NULL OR g.valid_until<=statement_timestamp())) THEN
    RAISE EXCEPTION 'Human write authority requires a finite exact-role grant' USING ERRCODE='42501';
  END IF;
  IF EXISTS(
    SELECT 1 FROM runtime_actor_grant g
    JOIN runtime_service_only_permission service ON service.permission_code=g.permission
    WHERE g.tenant_id=NEW.tenant_id AND g.actor_id=NEW.actor_id
      AND g.revoked_at IS NULL AND (g.valid_until IS NULL OR g.valid_until>statement_timestamp())
      AND EXISTS(SELECT 1 FROM jsonb_array_elements(NEW.grants) scope WHERE (scope->>'entity_id')::uuid=g.entity_id AND scope->>'permission'=g.permission)
      AND g.authority_class<>'SERVICE'
  ) THEN
    RAISE EXCEPTION 'Service-only permission requires an exact SERVICE authority grant' USING ERRCODE='42501';
  END IF;
  IF EXISTS(
    SELECT 1 FROM runtime_actor_grant g
    JOIN runtime_human_permission_authority expected ON expected.permission_code=g.permission
    WHERE g.tenant_id=NEW.tenant_id AND g.actor_id=NEW.actor_id
      AND g.revoked_at IS NULL AND (g.valid_until IS NULL OR g.valid_until>statement_timestamp())
      AND EXISTS(SELECT 1 FROM jsonb_array_elements(NEW.grants) scope WHERE (scope->>'entity_id')::uuid=g.entity_id AND scope->>'permission'=g.permission)
      AND g.authority_class<>expected.authority_class
  ) THEN
    RAISE EXCEPTION 'Human permission grant authority does not match its frozen workflow class' USING ERRCODE='42501';
  END IF;
  IF EXISTS(
    SELECT 1 FROM runtime_actor_grant g
    LEFT JOIN runtime_service_only_permission service ON service.permission_code=g.permission
    WHERE g.tenant_id=NEW.tenant_id AND g.actor_id=NEW.actor_id
      AND g.revoked_at IS NULL AND (g.valid_until IS NULL OR g.valid_until>statement_timestamp())
      AND EXISTS(SELECT 1 FROM jsonb_array_elements(NEW.grants) scope WHERE (scope->>'entity_id')::uuid=g.entity_id AND scope->>'permission'=g.permission)
      AND g.authority_class='SERVICE' AND service.permission_code IS NULL
  ) THEN
    RAISE EXCEPTION 'Service authority contains a non-service permission' USING ERRCODE='42501';
  END IF;
  IF EXISTS(
    SELECT 1 FROM runtime_actor_grant g
    JOIN permission_catalog pc ON pc.permission_code=g.permission
    LEFT JOIN runtime_service_only_permission service ON service.permission_code=g.permission
    LEFT JOIN runtime_human_permission_authority human ON human.permission_code=g.permission
    WHERE g.tenant_id=NEW.tenant_id AND g.actor_id=NEW.actor_id
      AND g.revoked_at IS NULL AND (g.valid_until IS NULL OR g.valid_until>statement_timestamp())
      AND EXISTS(SELECT 1 FROM jsonb_array_elements(NEW.grants) scope WHERE (scope->>'entity_id')::uuid=g.entity_id AND scope->>'permission'=g.permission)
      AND pc.sod_class NOT IN('READ','VIEWER') AND pc.sod_class !~ '_READER$'
      AND service.permission_code IS NULL AND human.permission_code IS NULL
  ) THEN
    RAISE EXCEPTION 'Writable permission is outside the closed authority matrix' USING ERRCODE='42501';
  END IF;
  IF EXISTS(
    SELECT 1 FROM runtime_actor_grant g
    JOIN runtime_human_permission_authority p ON p.permission_code=g.permission
    WHERE g.tenant_id=NEW.tenant_id AND g.actor_id=NEW.actor_id AND g.revoked_at IS NULL
      AND (g.valid_until IS NULL OR g.valid_until>statement_timestamp()) AND g.authority_class<>'SERVICE'
      AND EXISTS(SELECT 1 FROM jsonb_array_elements(NEW.grants) scope WHERE (scope->>'entity_id')::uuid=g.entity_id AND scope->>'permission'=g.permission)
    GROUP BY g.entity_id HAVING count(DISTINCT p.authority_class)>1
  ) THEN RAISE EXCEPTION 'Actor has mutually exclusive workflow authorities in one entity' USING ERRCODE='42501'; END IF;
  SELECT min(g.valid_until) INTO grant_expiry
    FROM runtime_actor_grant g
    JOIN LATERAL jsonb_array_elements(NEW.grants) scope
      ON (scope->>'entity_id')::uuid=g.entity_id AND scope->>'permission'=g.permission
    WHERE g.tenant_id=NEW.tenant_id AND g.actor_id=NEW.actor_id AND g.revoked_at IS NULL
      AND (g.valid_until IS NULL OR g.valid_until>statement_timestamp());
  IF grant_expiry IS NOT NULL THEN NEW.expires_at:=LEAST(NEW.expires_at,grant_expiry); END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION refs_issue_read_context(p_actor text,p_tenant uuid,p_token_hash text,p_ttl_seconds integer DEFAULT 300)
RETURNS runtime_auth_context
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE issued runtime_auth_context; allowed_grants jsonb;
BEGIN
  IF session_user<>'refs_context_issuer' THEN RAISE EXCEPTION 'Context issuer identity denied' USING ERRCODE='42501'; END IF;
  IF p_token_hash!~'^sha256:[0-9a-f]{64}$' OR p_ttl_seconds<30 OR p_ttl_seconds>300 THEN
    RAISE EXCEPTION 'Invalid context token hash or TTL' USING ERRCODE='22023';
  END IF;
  SELECT jsonb_agg(jsonb_build_object('entity_id',g.entity_id,'permission',g.permission) ORDER BY g.entity_id,g.permission)
    INTO allowed_grants FROM runtime_actor_grant g JOIN permission_catalog pc ON pc.permission_code=g.permission
    WHERE g.tenant_id=p_tenant AND g.actor_id=p_actor AND g.revoked_at IS NULL
      AND (g.valid_until IS NULL OR g.valid_until>clock_timestamp())
      AND (pc.sod_class IN('READ','VIEWER') OR pc.sod_class ~ '_READER<=clock_timestamp() AND (pc.effective_to IS NULL OR pc.effective_to>clock_timestamp());
  IF allowed_grants IS NULL THEN RAISE EXCEPTION 'Actor has no active DB authorization grant' USING ERRCODE='42501'; END IF;
  INSERT INTO runtime_auth_context(token_hash,tenant_id,grants,actor_id,bound_login,expires_at)
    VALUES(p_token_hash,p_tenant,allowed_grants,p_actor,'refs_runtime',clock_timestamp()+make_interval(secs=>p_ttl_seconds))
    RETURNING * INTO issued;
  INSERT INTO audit_event(tenant_id,event_type,object_type,object_id,action,actor_id,actor_type,permission_used,request_id,correlation_id,after_hash,metadata)
    VALUES(p_tenant,'RUNTIME_CONTEXT_ISSUED','RUNTIME_AUTH_CONTEXT',issued.auth_context_id,'ISSUE',p_actor,'SYSTEM','AUTH.CONTEXT.ISSUE',issued.auth_context_id::text,issued.auth_context_id::text,p_token_hash,jsonb_build_object('expires_at',issued.expires_at,'issuer',session_user,'read_only',true));
  RETURN issued;
END;
$$;)
      AND g.permission<>'AI.ANALYSIS.EXPLAIN'
      AND NOT EXISTS(SELECT 1 FROM runtime_human_permission_authority h WHERE h.permission_code=g.permission)
      AND NOT EXISTS(SELECT 1 FROM runtime_service_only_permission s WHERE s.permission_code=g.permission)
      AND pc.active AND pc.effective_from<=clock_timestamp() AND (pc.effective_to IS NULL OR pc.effective_to>clock_timestamp());
  IF allowed_grants IS NULL THEN RAISE EXCEPTION 'Actor has no active DB authorization grant' USING ERRCODE='42501'; END IF;
  INSERT INTO runtime_auth_context(token_hash,tenant_id,grants,actor_id,bound_login,expires_at)
    VALUES(p_token_hash,p_tenant,allowed_grants,p_actor,'refs_runtime',clock_timestamp()+make_interval(secs=>p_ttl_seconds))
    RETURNING * INTO issued;
  INSERT INTO audit_event(tenant_id,event_type,object_type,object_id,action,actor_id,actor_type,permission_used,request_id,correlation_id,after_hash,metadata)
    VALUES(p_tenant,'RUNTIME_CONTEXT_ISSUED','RUNTIME_AUTH_CONTEXT',issued.auth_context_id,'ISSUE',p_actor,'SYSTEM','AUTH.CONTEXT.ISSUE',issued.auth_context_id::text,issued.auth_context_id::text,p_token_hash,jsonb_build_object('expires_at',issued.expires_at,'issuer',session_user));
  RETURN issued;
END;
$$;

REVOKE ALL ON FUNCTION refs_issue_read_context(text,uuid,text,integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION refs_issue_read_context(text,uuid,text,integer) TO refs_context_issuer;

COMMIT;
