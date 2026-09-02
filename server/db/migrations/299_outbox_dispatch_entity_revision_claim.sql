BEGIN;

-- A release dispatcher is configured for an explicit tenant/entity set.  The
-- v2 claim accepted only a tenant and therefore could lease an event for a
-- sibling entity before the application checked its release allowlist.  v3
-- moves both the entity boundary and the grant-set revision check into the
-- same transaction that takes the row lock.
CREATE FUNCTION refs_claim_outbox_v3(
  p_tenant uuid,
  p_worker text,
  p_entity_ids uuid[],
  p_expected_grant_versions bigint[],
  p_limit integer DEFAULT 100,
  p_lease_seconds integer DEFAULT 300
)
RETURNS SETOF outbox_event
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE
  scope_count integer;
  locked_count integer;
  scoped record;
  access_evidence record;
BEGIN
  IF refs_current_tenant() IS DISTINCT FROM p_tenant OR refs_current_actor() IS DISTINCT FROM p_worker THEN
    RAISE EXCEPTION 'Outbox dispatch scope denied' USING ERRCODE='42501';
  END IF;
  scope_count:=cardinality(p_entity_ids);
  IF p_worker IS NULL OR btrim(p_worker)=''
     OR scope_count IS NULL OR scope_count<1 OR scope_count>100
     OR cardinality(p_expected_grant_versions) IS DISTINCT FROM scope_count
     OR p_limit IS NULL OR p_limit<1 OR p_limit>500
     OR p_lease_seconds IS NULL OR p_lease_seconds<5 OR p_lease_seconds>3600
     OR EXISTS(SELECT 1 FROM unnest(p_entity_ids) entity_id WHERE entity_id IS NULL)
     OR EXISTS(SELECT 1 FROM unnest(p_expected_grant_versions) version WHERE version IS NULL OR version<1)
     OR (SELECT count(DISTINCT entity_id) FROM unnest(p_entity_ids) entity_id)<>scope_count THEN
    RAISE EXCEPTION 'Outbox entity claim arguments are invalid' USING ERRCODE='22023';
  END IF;

  -- Lock every asserted grant-set revision in deterministic entity order.  A
  -- concurrent exact-role replacement must wait until this claim transaction
  -- commits, and a stale caller fails before any outbox row is touched.
  PERFORM grant_set.entity_id
  FROM runtime_actor_grant_set grant_set
  JOIN unnest(p_entity_ids,p_expected_grant_versions) expected(entity_id,grant_set_version)
    ON expected.entity_id=grant_set.entity_id AND expected.grant_set_version=grant_set.version
  JOIN entity scoped_entity
    ON scoped_entity.tenant_id=grant_set.tenant_id AND scoped_entity.entity_id=grant_set.entity_id AND scoped_entity.active
  WHERE grant_set.tenant_id=p_tenant AND grant_set.actor_id=p_worker
  ORDER BY grant_set.entity_id
  FOR SHARE OF grant_set;
  GET DIAGNOSTICS locked_count=ROW_COUNT;
  IF locked_count<>scope_count THEN
    RAISE EXCEPTION 'Outbox dispatcher grant revision changed' USING ERRCODE='40001';
  END IF;

  FOR scoped IN
    SELECT entity_id,grant_set_version
    FROM unnest(p_entity_ids,p_expected_grant_versions) expected(entity_id,grant_set_version)
    ORDER BY entity_id
  LOOP
    SELECT * INTO access_evidence FROM refs_read_current_actor_access(p_tenant,scoped.entity_id);
    IF access_evidence.actor_id IS DISTINCT FROM p_worker
       OR access_evidence.grant_set_version IS DISTINCT FROM scoped.grant_set_version
       OR access_evidence.session_refresh_required IS DISTINCT FROM false
       OR access_evidence.permissions IS DISTINCT FROM ARRAY['OUTBOX.DISPATCH']::text[]
       OR access_evidence.configured_permissions IS DISTINCT FROM ARRAY['OUTBOX.DISPATCH']::text[] THEN
      RAISE EXCEPTION 'Outbox dispatcher requires one exact current SERVICE permission' USING ERRCODE='42501';
    END IF;
    IF NOT EXISTS(
      SELECT 1 FROM runtime_actor_grant grant_row
      WHERE grant_row.tenant_id=p_tenant AND grant_row.actor_id=p_worker
        AND grant_row.entity_id=scoped.entity_id AND grant_row.permission='OUTBOX.DISPATCH'
        AND grant_row.authority_class='SERVICE' AND grant_row.revoked_at IS NULL
        AND (grant_row.valid_until IS NULL OR grant_row.valid_until>statement_timestamp())
    ) THEN
      RAISE EXCEPTION 'Outbox dispatcher SERVICE grant is absent or expired' USING ERRCODE='42501';
    END IF;
  END LOOP;

  RETURN QUERY
  WITH candidates AS (
    SELECT o.outbox_event_id
    FROM outbox_event o
    WHERE o.tenant_id=p_tenant
      AND o.entity_id=ANY(p_entity_ids)
      AND refs_entity_has_permission(o.entity_id,'OUTBOX.DISPATCH') IS TRUE
      AND o.status='PENDING'
      AND o.available_at<=clock_timestamp()
      AND (o.locked_by IS NULL OR o.locked_at<=clock_timestamp()-make_interval(secs=>p_lease_seconds))
    ORDER BY o.available_at,o.created_at,o.outbox_event_id
    FOR UPDATE SKIP LOCKED
    LIMIT p_limit
  )
  UPDATE outbox_event o
  SET locked_by=p_worker,locked_at=clock_timestamp(),attempt_count=o.attempt_count+1
  FROM candidates c
  WHERE o.outbox_event_id=c.outbox_event_id
  RETURNING o.*;
END;
$$;

REVOKE ALL ON FUNCTION refs_claim_outbox_v3(uuid,text,uuid[],bigint[],integer,integer) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION refs_claim_outbox_v2(uuid,text,integer,integer) FROM refs_app;
GRANT EXECUTE ON FUNCTION refs_claim_outbox_v3(uuid,text,uuid[],bigint[],integer,integer) TO refs_app;

COMMIT;
