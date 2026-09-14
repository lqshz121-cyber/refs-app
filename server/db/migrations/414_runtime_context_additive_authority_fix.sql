BEGIN;

-- The grant synchronizer already permits an additive permission only when the
-- same finite authority has its native anchor.  The context guard must enforce
-- the identical rule or valid lifecycle roles cannot receive their read scope.
CREATE OR REPLACE FUNCTION refs_guard_runtime_context_sod() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE grant_expiry timestamptz;
BEGIN
  IF EXISTS(
    SELECT 1 FROM runtime_actor_grant g JOIN permission_catalog pc ON pc.permission_code=g.permission
    LEFT JOIN runtime_human_permission_authority p ON p.permission_code=g.permission
    WHERE g.tenant_id=NEW.tenant_id AND g.actor_id=NEW.actor_id AND g.revoked_at IS NULL AND g.authority_class<>'SERVICE'
      AND EXISTS(SELECT 1 FROM jsonb_array_elements(NEW.grants) scope WHERE (scope->>'entity_id')::uuid=g.entity_id AND scope->>'permission'=g.permission)
      AND (p.permission_code IS NOT NULL OR (pc.sod_class NOT IN('READ','VIEWER') AND pc.sod_class !~ '_READER$') OR g.permission='AI.ANALYSIS.EXPLAIN')
      AND (g.authority_class='LEGACY' OR g.valid_until IS NULL OR g.valid_until<=statement_timestamp())
  ) THEN RAISE EXCEPTION 'Human write authority requires a finite exact-role grant' USING ERRCODE='42501'; END IF;
  IF EXISTS(
    SELECT 1 FROM runtime_actor_grant g JOIN runtime_service_only_permission service ON service.permission_code=g.permission
    WHERE g.tenant_id=NEW.tenant_id AND g.actor_id=NEW.actor_id AND g.revoked_at IS NULL AND (g.valid_until IS NULL OR g.valid_until>statement_timestamp())
      AND EXISTS(SELECT 1 FROM jsonb_array_elements(NEW.grants) scope WHERE (scope->>'entity_id')::uuid=g.entity_id AND scope->>'permission'=g.permission) AND g.authority_class<>'SERVICE'
  ) THEN RAISE EXCEPTION 'Service-only permission requires an exact SERVICE authority grant' USING ERRCODE='42501'; END IF;
  IF EXISTS(
    SELECT 1 FROM runtime_actor_grant g JOIN runtime_human_permission_authority expected ON expected.permission_code=g.permission
    WHERE g.tenant_id=NEW.tenant_id AND g.actor_id=NEW.actor_id AND g.revoked_at IS NULL AND (g.valid_until IS NULL OR g.valid_until>statement_timestamp())
      AND EXISTS(SELECT 1 FROM jsonb_array_elements(NEW.grants) scope WHERE (scope->>'entity_id')::uuid=g.entity_id AND scope->>'permission'=g.permission)
      AND g.authority_class<>expected.authority_class
      AND NOT EXISTS(
        SELECT 1 FROM runtime_human_additive_permission_authority support
        WHERE support.permission_code=g.permission AND support.authority_class=g.authority_class
          AND EXISTS(
            SELECT 1 FROM runtime_actor_grant anchor JOIN runtime_human_permission_authority native ON native.permission_code=anchor.permission JOIN permission_catalog pc ON pc.permission_code=anchor.permission
            WHERE anchor.tenant_id=g.tenant_id AND anchor.entity_id=g.entity_id AND anchor.actor_id=g.actor_id AND anchor.authority_class=g.authority_class AND native.authority_class=g.authority_class
              AND anchor.revoked_at IS NULL AND anchor.valid_until>statement_timestamp() AND pc.active AND pc.effective_from<=statement_timestamp() AND (pc.effective_to IS NULL OR pc.effective_to>statement_timestamp())
              AND EXISTS(SELECT 1 FROM jsonb_array_elements(NEW.grants) scope WHERE (scope->>'entity_id')::uuid=anchor.entity_id AND scope->>'permission'=anchor.permission)
          )
      )
  ) THEN RAISE EXCEPTION 'Human permission grant authority does not match its frozen workflow class' USING ERRCODE='42501'; END IF;
  IF EXISTS(
    SELECT 1 FROM runtime_actor_grant g LEFT JOIN runtime_service_only_permission service ON service.permission_code=g.permission
    WHERE g.tenant_id=NEW.tenant_id AND g.actor_id=NEW.actor_id AND g.revoked_at IS NULL AND (g.valid_until IS NULL OR g.valid_until>statement_timestamp())
      AND EXISTS(SELECT 1 FROM jsonb_array_elements(NEW.grants) scope WHERE (scope->>'entity_id')::uuid=g.entity_id AND scope->>'permission'=g.permission) AND g.authority_class='SERVICE' AND service.permission_code IS NULL
  ) THEN RAISE EXCEPTION 'Service authority contains a non-service permission' USING ERRCODE='42501'; END IF;
  IF EXISTS(
    SELECT 1 FROM runtime_actor_grant g JOIN permission_catalog pc ON pc.permission_code=g.permission LEFT JOIN runtime_service_only_permission service ON service.permission_code=g.permission LEFT JOIN runtime_human_permission_authority human ON human.permission_code=g.permission
    WHERE g.tenant_id=NEW.tenant_id AND g.actor_id=NEW.actor_id AND g.revoked_at IS NULL AND (g.valid_until IS NULL OR g.valid_until>statement_timestamp())
      AND EXISTS(SELECT 1 FROM jsonb_array_elements(NEW.grants) scope WHERE (scope->>'entity_id')::uuid=g.entity_id AND scope->>'permission'=g.permission)
      AND pc.sod_class NOT IN('READ','VIEWER') AND pc.sod_class !~ '_READER$' AND service.permission_code IS NULL AND human.permission_code IS NULL
  ) THEN RAISE EXCEPTION 'Writable permission is outside the closed authority matrix' USING ERRCODE='42501'; END IF;
  IF EXISTS(
    SELECT 1 FROM runtime_actor_grant g JOIN runtime_human_permission_authority p ON p.permission_code=g.permission
    WHERE g.tenant_id=NEW.tenant_id AND g.actor_id=NEW.actor_id AND g.revoked_at IS NULL AND (g.valid_until IS NULL OR g.valid_until>statement_timestamp()) AND g.authority_class<>'SERVICE'
      AND EXISTS(SELECT 1 FROM jsonb_array_elements(NEW.grants) scope WHERE (scope->>'entity_id')::uuid=g.entity_id AND scope->>'permission'=g.permission)
    GROUP BY g.entity_id HAVING count(DISTINCT CASE WHEN EXISTS(SELECT 1 FROM runtime_human_additive_permission_authority support WHERE support.permission_code=g.permission AND support.authority_class=g.authority_class) THEN NULL ELSE p.authority_class END)>1
  ) THEN RAISE EXCEPTION 'Actor has mutually exclusive workflow authorities in one entity' USING ERRCODE='42501'; END IF;
  SELECT min(g.valid_until) INTO grant_expiry FROM runtime_actor_grant g JOIN LATERAL jsonb_array_elements(NEW.grants) scope ON (scope->>'entity_id')::uuid=g.entity_id AND scope->>'permission'=g.permission
    WHERE g.tenant_id=NEW.tenant_id AND g.actor_id=NEW.actor_id AND g.revoked_at IS NULL AND (g.valid_until IS NULL OR g.valid_until>statement_timestamp());
  IF grant_expiry IS NOT NULL THEN NEW.expires_at:=LEAST(NEW.expires_at,grant_expiry); END IF;
  RETURN NEW;
END;
$$;

COMMIT;
