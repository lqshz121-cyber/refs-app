BEGIN;

-- P10: the outbox backlog has no read path.
--
-- 001 defines outbox_event, 279 adds lease/attempt/retry dispatch, S23 pins the
-- dispatch contract, and every command writes an event.  What is missing is any
-- way to see the queue: O10 found that answering "how far behind is the worker,
-- and is anything dead-lettered" required a direct DB session, because no route
-- and no read model exposes it.  The staging worker has been Suspended since
-- 2026-09-02 with the backlog growing unobserved.
--
-- This read is deliberately operational, not accounting: it exposes counts,
-- ages and attempt distribution, plus the event_type breakdown, and it never
-- exposes a payload.  Payloads can carry business detail, so the read returns
-- only the payload hash for the oldest blocked events.

INSERT INTO permission_catalog(permission_code,domain,risk_class,sod_class) VALUES
  ('OPS.OUTBOX.VIEW','OPS','LOW','READ')
ON CONFLICT(permission_code) DO UPDATE SET active=true,version=permission_catalog.version+1,effective_to=NULL;

CREATE INDEX IF NOT EXISTS outbox_event_health_idx ON outbox_event(tenant_id,entity_id,status,available_at);

CREATE FUNCTION refs_read_outbox_health(p_tenant uuid,p_entity uuid,p_stale_minutes integer DEFAULT 15)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE totals jsonb; by_type jsonb; oldest jsonb; now_ts timestamptz:=clock_timestamp();
BEGIN
  PERFORM refs_assert_scope(p_tenant,p_entity,'OPS.OUTBOX.VIEW');
  IF p_stale_minutes IS NULL OR p_stale_minutes<1 OR p_stale_minutes>10080 THEN
    RAISE EXCEPTION 'stale_minutes must be between 1 and 10080' USING ERRCODE='22023';
  END IF;

  SELECT jsonb_build_object(
    'pending_count',count(*) FILTER(WHERE status='PENDING'),
    'published_count',count(*) FILTER(WHERE status='PUBLISHED'),
    'failed_count',count(*) FILTER(WHERE status='FAILED'),
    'due_now_count',count(*) FILTER(WHERE status='PENDING' AND available_at<=now_ts),
    'deferred_count',count(*) FILTER(WHERE status='PENDING' AND available_at>now_ts),
    'stale_pending_count',count(*) FILTER(WHERE status='PENDING' AND created_at<now_ts-make_interval(mins=>p_stale_minutes)),
    'retried_count',count(*) FILTER(WHERE status='PENDING' AND attempt_count>0),
    'max_attempt_count',COALESCE(max(attempt_count) FILTER(WHERE status<>'PUBLISHED'),0),
    'errored_count',count(*) FILTER(WHERE status<>'PUBLISHED' AND last_error IS NOT NULL),
    'oldest_pending_created_at',min(created_at) FILTER(WHERE status='PENDING'),
    'oldest_pending_age_seconds',COALESCE(round(extract(epoch FROM now_ts-min(created_at) FILTER(WHERE status='PENDING')))::bigint,0),
    'newest_published_at',max(published_at) FILTER(WHERE status='PUBLISHED'))
  INTO totals FROM outbox_event WHERE tenant_id=p_tenant AND entity_id=p_entity;

  SELECT COALESCE(jsonb_agg(jsonb_build_object('event_type',event_type,'pending_count',pending,'failed_count',failed,
    'max_attempt_count',max_attempts,'oldest_pending_age_seconds',oldest_age) ORDER BY pending DESC,event_type),'[]'::jsonb)
  INTO by_type FROM (
    SELECT event_type,
      count(*) FILTER(WHERE status='PENDING')::bigint AS pending,
      count(*) FILTER(WHERE status='FAILED')::bigint AS failed,
      COALESCE(max(attempt_count) FILTER(WHERE status<>'PUBLISHED'),0)::integer AS max_attempts,
      COALESCE(round(extract(epoch FROM now_ts-min(created_at) FILTER(WHERE status='PENDING')))::bigint,0) AS oldest_age
    FROM outbox_event WHERE tenant_id=p_tenant AND entity_id=p_entity
    GROUP BY event_type HAVING count(*) FILTER(WHERE status<>'PUBLISHED')>0
  ) t;

  -- Identity and failure reason only; never the payload.
  SELECT COALESCE(jsonb_agg(jsonb_build_object('outbox_event_id',outbox_event_id,'event_type',event_type,
    'aggregate_type',aggregate_type,'status',status,'attempt_count',attempt_count,'created_at',created_at,
    'available_at',available_at,'payload_hash',payload_hash,'last_error',left(last_error,200)) ORDER BY created_at,outbox_event_id),'[]'::jsonb)
  INTO oldest FROM (
    SELECT * FROM outbox_event WHERE tenant_id=p_tenant AND entity_id=p_entity AND status<>'PUBLISHED'
    ORDER BY created_at,outbox_event_id LIMIT 20
  ) o;

  RETURN jsonb_build_object('schema_version','OUTBOX_HEALTH_V1','accounting_authority','NONE','can_dispatch',false,'can_delete',false,
    'entity_id',p_entity,'observed_at',now_ts,'stale_minutes',p_stale_minutes,
    'totals',totals,'by_event_type',by_type,'oldest_unpublished',oldest,
    'backlog_state',CASE
      WHEN (totals->>'pending_count')::bigint=0 AND (totals->>'failed_count')::bigint=0 THEN 'DRAINED'
      WHEN (totals->>'failed_count')::bigint>0 THEN 'FAILED_EVENTS_PRESENT'
      WHEN (totals->>'stale_pending_count')::bigint>0 THEN 'STALE_BACKLOG'
      ELSE 'PENDING_WITHIN_WINDOW' END);
END;$$;

REVOKE ALL ON FUNCTION refs_read_outbox_health(uuid,uuid,integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION refs_read_outbox_health(uuid,uuid,integer) TO refs_app;

COMMIT;
