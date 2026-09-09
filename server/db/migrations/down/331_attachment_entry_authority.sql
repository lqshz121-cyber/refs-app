BEGIN;
LOCK TABLE runtime_grant_sync_receipt IN SHARE MODE;
DO $$ BEGIN
  IF EXISTS(SELECT 1 FROM runtime_grant_sync_receipt WHERE grant_policy_version='SOD_FINITE_V2') THEN
    RAISE EXCEPTION 'Cannot remove attachment entry authority with retained V2 grant evidence' USING ERRCODE='55006';
  END IF;
END; $$;
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


DROP FUNCTION refs_reconcile_actor_grants_v3(uuid,text,uuid,text[],text,timestamptz,bigint,text,text);
DROP FUNCTION refs_grant_request_hash_v3(uuid,text,uuid,text[],text,timestamptz,bigint);
DROP TABLE runtime_human_additive_permission_authority;
ALTER TABLE runtime_grant_sync_receipt DROP CONSTRAINT runtime_grant_sync_policy_ck;
ALTER TABLE runtime_grant_sync_receipt ADD CONSTRAINT runtime_grant_sync_policy_ck CHECK(
  (grant_policy_version IS NULL AND authority_class IS NULL AND valid_until IS NULL)
  OR (grant_policy_version IN('SOD_FINITE_V1') AND authority_class<>'LEGACY'
    AND authority_class ~ '^(?:SERVICE|[A-Z][A-Z0-9_]{1,39})$'
    AND (authority_class='SERVICE' OR valid_until IS NOT NULL))
);

COMMIT;
