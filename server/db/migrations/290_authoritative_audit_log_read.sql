BEGIN;

INSERT INTO permission_catalog(permission_code,domain,risk_class,sod_class)
VALUES('AUDIT.VIEW','AUDIT','MEDIUM','AUDIT_READER')
ON CONFLICT(permission_code) DO UPDATE SET active=true,domain=EXCLUDED.domain,risk_class=EXCLUDED.risk_class,
  sod_class=EXCLUDED.sod_class,version=permission_catalog.version+1,effective_to=NULL;

CREATE INDEX audit_event_entity_timeline_idx
  ON audit_event(tenant_id,entity_id,occurred_at DESC,audit_event_id DESC);

CREATE FUNCTION refs_read_authoritative_audit_log(
  p_tenant uuid,p_entity uuid,p_limit integer DEFAULT 50,
  p_cursor_at timestamptz DEFAULT NULL,p_cursor_id uuid DEFAULT NULL,
  p_event_type text DEFAULT NULL,p_actor_id text DEFAULT NULL,p_object_type text DEFAULT NULL,
  p_from timestamptz DEFAULT NULL,p_to timestamptz DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE v_rows jsonb;v_total bigint;v_read integer;v_has_more boolean;v_next_at text;v_next_id uuid;
BEGIN
  PERFORM refs_assert_scope(p_tenant,p_entity,'AUDIT.VIEW');
  IF p_limit NOT BETWEEN 1 AND 100 OR (p_cursor_at IS NULL)<>(p_cursor_id IS NULL)
     OR p_from IS NOT NULL AND p_to IS NOT NULL AND p_from>p_to
     OR p_event_type IS NOT NULL AND (p_event_type<>btrim(p_event_type) OR length(p_event_type) NOT BETWEEN 1 AND 128)
     OR p_actor_id IS NOT NULL AND (p_actor_id<>btrim(p_actor_id) OR length(p_actor_id) NOT BETWEEN 1 AND 200)
     OR p_object_type IS NOT NULL AND (p_object_type<>btrim(p_object_type) OR length(p_object_type) NOT BETWEEN 1 AND 128) THEN
    RAISE EXCEPTION 'Audit log page or filter is invalid' USING ERRCODE='22023';
  END IF;

  SELECT count(*) INTO v_total FROM audit_event e
   WHERE e.tenant_id=p_tenant AND e.entity_id=p_entity
     AND (p_event_type IS NULL OR e.event_type=p_event_type)
     AND (p_actor_id IS NULL OR e.actor_id=p_actor_id)
     AND (p_object_type IS NULL OR e.object_type=p_object_type)
     AND (p_from IS NULL OR e.occurred_at>=p_from) AND (p_to IS NULL OR e.occurred_at<=p_to);

  WITH page AS (
    SELECT e.* FROM audit_event e
     WHERE e.tenant_id=p_tenant AND e.entity_id=p_entity
       AND (p_event_type IS NULL OR e.event_type=p_event_type)
       AND (p_actor_id IS NULL OR e.actor_id=p_actor_id)
       AND (p_object_type IS NULL OR e.object_type=p_object_type)
       AND (p_from IS NULL OR e.occurred_at>=p_from) AND (p_to IS NULL OR e.occurred_at<=p_to)
       AND (p_cursor_at IS NULL OR (e.occurred_at,e.audit_event_id)<(p_cursor_at,p_cursor_id))
     ORDER BY e.occurred_at DESC,e.audit_event_id DESC LIMIT p_limit+1
  ), bounded AS (
    SELECT * FROM page ORDER BY occurred_at DESC,audit_event_id DESC LIMIT p_limit
  )
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'schema_version','AUTHORITATIVE_AUDIT_EVENT_V1','audit_event_id',audit_event_id,
    'occurred_at',to_char(occurred_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    'event_type',event_type,'object_type',object_type,'object_id',object_id,'action',action,
    'actor_id',CASE WHEN actor_id~*'(bearer[[:space:]]+[^[:space:]]+|(api[_-]?key|access[_-]?token|password|secret)[[:space:]]*[:=])' THEN '[REDACTED]' ELSE actor_id END,
    'actor_type',actor_type,'permission_used',permission_used,
    'request_ref_hash',refs_jsonb_hash(to_jsonb(request_id)),
    'correlation_ref_hash',refs_jsonb_hash(to_jsonb(correlation_id)),
    'idempotency_ref_hash',CASE WHEN idempotency_key IS NULL THEN NULL ELSE refs_jsonb_hash(to_jsonb(idempotency_key)) END,
    'before_hash',before_hash,'after_hash',after_hash
  ) ORDER BY occurred_at DESC,audit_event_id DESC),'[]'::jsonb),count(*)::integer
  INTO v_rows,v_read FROM bounded;

  v_has_more:=v_total>v_read+CASE WHEN p_cursor_at IS NULL THEN 0 ELSE (
    SELECT count(*) FROM audit_event e WHERE e.tenant_id=p_tenant AND e.entity_id=p_entity
      AND (p_event_type IS NULL OR e.event_type=p_event_type) AND (p_actor_id IS NULL OR e.actor_id=p_actor_id)
      AND (p_object_type IS NULL OR e.object_type=p_object_type) AND (p_from IS NULL OR e.occurred_at>=p_from)
      AND (p_to IS NULL OR e.occurred_at<=p_to) AND (e.occurred_at,e.audit_event_id)>=(p_cursor_at,p_cursor_id)
  ) END;
  IF v_read=p_limit AND v_has_more THEN
    SELECT item->>'occurred_at',(item->>'audit_event_id')::uuid INTO v_next_at,v_next_id
      FROM jsonb_array_elements(v_rows) WITH ORDINALITY x(item,ordinality) ORDER BY ordinality DESC LIMIT 1;
  END IF;
  RETURN jsonb_build_object(
    'schema_version','AUTHORITATIVE_AUDIT_LOG_PAGE_V1',
    'scope',jsonb_build_object('tenant_id',p_tenant,'entity_id',p_entity),
    'filters',jsonb_build_object('event_type',p_event_type,'actor_id',p_actor_id,'object_type',p_object_type,
      'from',CASE WHEN p_from IS NULL THEN NULL ELSE to_char(p_from AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') END,
      'to',CASE WHEN p_to IS NULL THEN NULL ELSE to_char(p_to AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') END),
    'total_count',v_total,'read_count',v_read,'events',v_rows,'has_more',v_has_more,
    'next_cursor',CASE WHEN v_next_id IS NULL THEN NULL ELSE jsonb_build_object('occurred_at',v_next_at,'audit_event_id',v_next_id) END,
    'redaction',jsonb_build_object('metadata_excluded',true,'reason_excluded',true,'request_references_hashed',true),
    'action_flags',jsonb_build_object('can_create_draft',false,'can_review',false,'can_approve',false,'can_post',false)
  );
END $$;

REVOKE ALL ON FUNCTION refs_read_authoritative_audit_log(uuid,uuid,integer,timestamptz,uuid,text,text,text,timestamptz,timestamptz) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION refs_read_authoritative_audit_log(uuid,uuid,integer,timestamptz,uuid,text,text,text,timestamptz,timestamptz) TO refs_app;

COMMIT;
