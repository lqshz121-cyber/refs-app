BEGIN;

CREATE FUNCTION refs_claim_outbox_v2(
  p_tenant uuid,
  p_worker text,
  p_limit integer DEFAULT 100,
  p_lease_seconds integer DEFAULT 300
)
RETURNS SETOF outbox_event
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
BEGIN
  IF refs_current_tenant() IS DISTINCT FROM p_tenant OR refs_current_actor() IS DISTINCT FROM p_worker THEN
    RAISE EXCEPTION 'Outbox dispatch scope denied' USING ERRCODE='42501';
  END IF;
  IF p_worker IS NULL OR btrim(p_worker)='' OR p_limit IS NULL OR p_limit<1 OR p_limit>500
     OR p_lease_seconds IS NULL OR p_lease_seconds<5 OR p_lease_seconds>3600 THEN
    RAISE EXCEPTION 'Outbox claim arguments are invalid' USING ERRCODE='22023';
  END IF;
  RETURN QUERY
  WITH candidates AS (
    SELECT o.outbox_event_id
    FROM outbox_event o
    WHERE o.tenant_id=p_tenant
      AND o.entity_id IS NOT NULL
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

CREATE FUNCTION refs_complete_outbox_v2(
  p_tenant uuid,
  p_event uuid,
  p_worker text,
  p_success boolean,
  p_retryable boolean DEFAULT false,
  p_error_code text DEFAULT NULL,
  p_max_attempts integer DEFAULT 8,
  p_retry_base_seconds integer DEFAULT 5
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE
  claimed outbox_event%ROWTYPE;
  next_status outbox_status;
  next_available timestamptz;
  safe_error text;
  response jsonb;
BEGIN
  IF refs_current_tenant() IS DISTINCT FROM p_tenant OR refs_current_actor() IS DISTINCT FROM p_worker THEN
    RAISE EXCEPTION 'Outbox dispatch scope denied' USING ERRCODE='42501';
  END IF;
  IF p_worker IS NULL OR btrim(p_worker)='' OR p_success IS NULL OR p_retryable IS NULL
     OR p_max_attempts IS NULL OR p_max_attempts<1 OR p_max_attempts>100
     OR p_retry_base_seconds IS NULL OR p_retry_base_seconds<1 OR p_retry_base_seconds>3600 THEN
    RAISE EXCEPTION 'Outbox completion arguments are invalid' USING ERRCODE='22023';
  END IF;
  safe_error:=CASE WHEN p_success THEN NULL ELSE upper(btrim(COALESCE(p_error_code,''))) END;
  IF NOT p_success AND (safe_error='' OR safe_error!~'^[A-Z][A-Z0-9_]{2,79}$') THEN
    RAISE EXCEPTION 'Outbox failure requires a closed error code' USING ERRCODE='22023';
  END IF;
  SELECT * INTO claimed
  FROM outbox_event o
  WHERE o.tenant_id=p_tenant AND o.outbox_event_id=p_event AND o.entity_id IS NOT NULL
    AND refs_entity_has_permission(o.entity_id,'OUTBOX.DISPATCH') IS TRUE
    AND o.status='PENDING' AND o.locked_by=p_worker
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Outbox claim not owned by worker' USING ERRCODE='42501'; END IF;

  IF p_success THEN
    next_status:='PUBLISHED';
    next_available:=claimed.available_at;
  ELSIF p_retryable AND claimed.attempt_count<p_max_attempts THEN
    next_status:='PENDING';
    next_available:=clock_timestamp()+make_interval(secs=>LEAST(86400,p_retry_base_seconds*(2^LEAST(claimed.attempt_count-1,14))::integer));
  ELSE
    next_status:='FAILED';
    next_available:=claimed.available_at;
  END IF;

  UPDATE outbox_event SET
    status=next_status,
    available_at=next_available,
    published_at=CASE WHEN p_success THEN clock_timestamp() ELSE NULL END,
    last_error=safe_error,
    locked_by=NULL,
    locked_at=NULL
  WHERE outbox_event_id=claimed.outbox_event_id;

  response:=jsonb_build_object(
    'schema_version','OUTBOX_DISPATCH_COMPLETION_V1',
    'outbox_event_id',claimed.outbox_event_id,
    'status',next_status,
    'attempt_count',claimed.attempt_count,
    'retry_scheduled',next_status='PENDING' AND NOT p_success,
    'available_at',to_char(next_available AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
  );
  RETURN response;
END;
$$;

REVOKE ALL ON FUNCTION refs_claim_outbox_v2(uuid,text,integer,integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION refs_complete_outbox_v2(uuid,uuid,text,boolean,boolean,text,integer,integer) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION refs_claim_outbox(uuid,text,integer) FROM refs_app;
REVOKE EXECUTE ON FUNCTION refs_complete_outbox(uuid,uuid,text,boolean,text) FROM refs_app;
GRANT EXECUTE ON FUNCTION refs_claim_outbox_v2(uuid,text,integer,integer) TO refs_app;
GRANT EXECUTE ON FUNCTION refs_complete_outbox_v2(uuid,uuid,text,boolean,boolean,text,integer,integer) TO refs_app;

COMMIT;
