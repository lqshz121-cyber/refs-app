BEGIN;

CREATE INDEX audit_event_period_close_history_idx
  ON audit_event(tenant_id,entity_id,object_id,occurred_at DESC,audit_event_id DESC)
  WHERE event_type='PERIOD_CLOSED_V2' AND object_type='ACCOUNTING_PERIOD' AND action='CLOSE';

CREATE FUNCTION refs_read_period_close_history(
  p_tenant uuid,p_entity uuid,p_period uuid,p_limit integer DEFAULT 25,
  p_cursor_at timestamptz DEFAULT NULL,p_cursor_id uuid DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE
  v_rows jsonb;v_total bigint;v_read integer;v_page_count integer;v_has_more boolean;
  v_next_at timestamptz;v_next_id uuid;
BEGIN
  PERFORM refs_assert_scope(p_tenant,p_entity,'GL.REPORT.VIEW');
  IF p_limit NOT BETWEEN 1 AND 100 OR (p_cursor_at IS NULL)<>(p_cursor_id IS NULL) THEN
    RAISE EXCEPTION 'Period close history page is invalid' USING ERRCODE='22023';
  END IF;
  IF NOT EXISTS(SELECT 1 FROM accounting_period p WHERE p.tenant_id=p_tenant AND p.entity_id=p_entity AND p.period_id=p_period) THEN
    RAISE EXCEPTION 'Period not found' USING ERRCODE='P0002';
  END IF;

  IF EXISTS(
    SELECT 1 FROM audit_event a
     WHERE a.tenant_id=p_tenant AND a.entity_id=p_entity AND a.object_id=p_period
       AND a.event_type='PERIOD_CLOSED_V2' AND a.object_type='ACCOUNTING_PERIOD' AND a.action='CLOSE'
       AND (
         a.permission_used<>'GL.PERIOD.CLOSE' OR a.actor_id IS NULL OR a.actor_id<>btrim(a.actor_id) OR length(a.actor_id) NOT BETWEEN 1 AND 300
         OR a.reason IS NULL OR a.reason<>btrim(a.reason) OR length(a.reason) NOT BETWEEN 8 AND 2000
         OR a.idempotency_key IS NULL OR a.idempotency_key<>btrim(a.idempotency_key) OR length(a.idempotency_key) NOT BETWEEN 8 AND 512
         OR a.after_hash !~ '^sha256:[0-9a-f]{64}$'
         OR CASE WHEN jsonb_typeof(a.metadata)='object' THEN (SELECT count(*) FROM jsonb_object_keys(a.metadata))<>17 ELSE true END
         OR a.metadata->>'schema_version'<>'PERIOD_CLOSED_EVENT_V2'
         OR a.metadata->>'period_id'<>p_period::text OR a.metadata->>'status'<>'CLOSED'
         OR a.metadata->>'period_code' IS NULL OR a.metadata->>'period_code'=''
         OR a.metadata->>'version' !~ '^[1-9][0-9]*$'
         OR a.metadata->>'readiness_hash'<>a.after_hash OR a.metadata->>'closed_by'<>a.actor_id
         OR a.metadata->>'reason'<>a.reason
         OR a.metadata->>'settings_snapshot_id' !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
         OR a.metadata->>'close_policy_snapshot_id' !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
         OR a.metadata->>'financial_statement_snapshot_id' !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
         OR a.metadata->>'settings_hash' !~ '^sha256:[0-9a-f]{64}$'
         OR a.metadata->>'close_policy_hash' !~ '^sha256:[0-9a-f]{64}$'
         OR a.metadata->>'financial_statement_snapshot_hash' !~ '^sha256:[0-9a-f]{64}$'
         OR a.metadata->>'ledger_evidence_hash' !~ '^sha256:[0-9a-f]{64}$'
         OR a.metadata->>'unposted_journal_count'<>'0' OR a.metadata->>'admitted_source_blocker_count'<>'0'
         OR (SELECT count(*) FROM outbox_event o WHERE o.tenant_id=a.tenant_id AND o.entity_id=a.entity_id
               AND o.aggregate_type='ACCOUNTING_PERIOD' AND o.aggregate_id=a.object_id
               AND o.event_type=a.event_type AND o.payload=a.metadata
               AND o.payload_hash=refs_jsonb_hash(a.metadata))<>1
         OR EXISTS(SELECT 1 FROM outbox_event o WHERE o.tenant_id=a.tenant_id AND o.entity_id=a.entity_id
               AND o.aggregate_type='ACCOUNTING_PERIOD' AND o.aggregate_id=a.object_id
               AND o.event_type=a.event_type AND o.payload=a.metadata
               AND o.payload_hash=refs_jsonb_hash(a.metadata)
               AND (o.attempt_count<0 OR (o.status='PUBLISHED')<>(o.published_at IS NOT NULL)))
       )
  ) THEN RAISE EXCEPTION 'Period close history contains invalid retained evidence' USING ERRCODE='23514'; END IF;

  SELECT count(*) INTO v_total FROM audit_event a
   WHERE a.tenant_id=p_tenant AND a.entity_id=p_entity AND a.object_id=p_period
     AND a.event_type='PERIOD_CLOSED_V2' AND a.object_type='ACCOUNTING_PERIOD' AND a.action='CLOSE';

  SELECT count(*) INTO v_page_count FROM (
    SELECT 1 FROM audit_event a
     WHERE a.tenant_id=p_tenant AND a.entity_id=p_entity AND a.object_id=p_period
       AND a.event_type='PERIOD_CLOSED_V2' AND a.object_type='ACCOUNTING_PERIOD' AND a.action='CLOSE'
       AND (p_cursor_at IS NULL OR (a.occurred_at,a.audit_event_id)<(p_cursor_at,p_cursor_id))
     ORDER BY a.occurred_at DESC,a.audit_event_id DESC LIMIT p_limit+1
  ) page;
  v_has_more:=v_page_count>p_limit;

  WITH page AS (
    SELECT a.* FROM audit_event a
     WHERE a.tenant_id=p_tenant AND a.entity_id=p_entity AND a.object_id=p_period
       AND a.event_type='PERIOD_CLOSED_V2' AND a.object_type='ACCOUNTING_PERIOD' AND a.action='CLOSE'
       AND (p_cursor_at IS NULL OR (a.occurred_at,a.audit_event_id)<(p_cursor_at,p_cursor_id))
     ORDER BY a.occurred_at DESC,a.audit_event_id DESC LIMIT p_limit
  ), evidence AS (
    SELECT p.*,o.outbox_event_id,o.payload_hash AS outbox_payload_hash,o.status AS delivery_status,
      o.attempt_count,o.published_at
      FROM page p JOIN LATERAL(
        SELECT x.* FROM outbox_event x WHERE x.tenant_id=p.tenant_id AND x.entity_id=p.entity_id
          AND x.aggregate_type='ACCOUNTING_PERIOD' AND x.aggregate_id=p.object_id
          AND x.event_type=p.event_type AND x.payload=p.metadata
          AND x.payload_hash=refs_jsonb_hash(p.metadata)
      ) o ON true
  )
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'schema_version','PERIOD_CLOSE_HISTORY_ITEM_V1','audit_event_id',audit_event_id,
    'period_id',object_id,'period_code',metadata->>'period_code','version',metadata->>'version','status','CLOSED',
    'recorded_at',to_char(occurred_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    'closed_by',CASE WHEN actor_id~*'(bearer[[:space:]]+|api[_-]?key|access[_-]?token|refresh[_-]?token|private[_-]?key|password[[:space:]]*[:=]|secret[[:space:]]*[:=]|(sk|rk|pk)-[a-z0-9_-]{8,})' THEN '[REDACTED]' ELSE actor_id END,
    'readiness_hash',after_hash,
    'settings_snapshot_id',metadata->>'settings_snapshot_id','settings_hash',metadata->>'settings_hash',
    'close_policy_snapshot_id',metadata->>'close_policy_snapshot_id','close_policy_hash',metadata->>'close_policy_hash',
    'financial_statement_snapshot_id',metadata->>'financial_statement_snapshot_id',
    'financial_statement_snapshot_hash',metadata->>'financial_statement_snapshot_hash',
    'ledger_evidence_hash',metadata->>'ledger_evidence_hash',
    'reason_hash',refs_jsonb_hash(to_jsonb(reason)),'command_reference_hash',refs_jsonb_hash(to_jsonb(idempotency_key)),
    'outbox_event_id',outbox_event_id,'outbox_payload_hash',outbox_payload_hash,
    'delivery',jsonb_build_object('status',delivery_status,'attempt_count',attempt_count,
      'published_at',CASE WHEN published_at IS NULL THEN NULL ELSE to_char(published_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') END),
    'integrity_verified',true
  ) ORDER BY occurred_at DESC,audit_event_id DESC),'[]'::jsonb),count(*)::integer
  INTO v_rows,v_read FROM evidence;

  IF v_has_more THEN
    SELECT (item->>'recorded_at')::timestamptz,(item->>'audit_event_id')::uuid INTO v_next_at,v_next_id
      FROM jsonb_array_elements(v_rows) WITH ORDINALITY x(item,ordinality) ORDER BY ordinality DESC LIMIT 1;
  END IF;
  RETURN jsonb_build_object(
    'schema_version','PERIOD_CLOSE_HISTORY_PAGE_V1',
    'scope',jsonb_build_object('tenant_id',p_tenant,'entity_id',p_entity,'period_id',p_period),
    'total_count',v_total,'read_count',v_read,'items',v_rows,'has_more',v_has_more,
    'next_cursor',CASE WHEN v_next_id IS NULL THEN NULL ELSE jsonb_build_object(
      'recorded_at',to_char(v_next_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),'audit_event_id',v_next_id) END,
    'redaction',jsonb_build_object('reason_hashed',true,'command_reference_hashed',true,'credential_shaped_actor_redacted',true),
    'action_flags',jsonb_build_object('can_create_draft',false,'can_review',false,'can_approve',false,'can_post',false)
  );
END $$;

REVOKE ALL ON FUNCTION refs_read_period_close_history(uuid,uuid,uuid,integer,timestamptz,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION refs_read_period_close_history(uuid,uuid,uuid,integer,timestamptz,uuid) TO refs_app;

COMMIT;
