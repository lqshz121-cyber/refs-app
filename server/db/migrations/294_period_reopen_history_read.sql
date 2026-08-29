BEGIN;

CREATE INDEX audit_event_period_reopen_history_idx
  ON audit_event(tenant_id,entity_id,object_id,
    (date_trunc('milliseconds',occurred_at AT TIME ZONE 'UTC')) DESC,audit_event_id DESC)
  WHERE event_type='PERIOD_REOPENED_V1' AND object_type='ACCOUNTING_PERIOD' AND action='REOPEN';

CREATE FUNCTION refs_read_period_reopen_history(
  p_tenant uuid,p_entity uuid,p_period uuid,p_limit integer DEFAULT 25,
  p_cursor_at timestamptz DEFAULT NULL,p_cursor_id uuid DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE
  v_rows jsonb;v_total bigint;v_read integer;v_page_count integer;v_has_more boolean;
  v_next_at timestamptz;v_next_id uuid;
BEGIN
  PERFORM refs_assert_scope(p_tenant,p_entity,'GL.REPORT.VIEW');
  IF p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 100 OR (p_cursor_at IS NULL)<>(p_cursor_id IS NULL) THEN
    RAISE EXCEPTION 'Period reopen history page is invalid' USING ERRCODE='22023';
  END IF;
  IF NOT EXISTS(SELECT 1 FROM accounting_period p WHERE p.tenant_id=p_tenant AND p.entity_id=p_entity AND p.period_id=p_period) THEN
    RAISE EXCEPTION 'Period not found' USING ERRCODE='P0002';
  END IF;

  IF EXISTS(
    SELECT 1 FROM audit_event a
     WHERE a.tenant_id=p_tenant AND a.entity_id=p_entity AND a.object_id=p_period
       AND a.event_type='PERIOD_REOPENED_V1' AND a.object_type='ACCOUNTING_PERIOD' AND a.action='REOPEN'
     GROUP BY a.metadata->>'version' HAVING count(*)<>1
  ) OR EXISTS(
    SELECT 1 FROM audit_event a
     WHERE a.tenant_id=p_tenant AND a.entity_id=p_entity AND a.object_id=p_period
       AND a.event_type='PERIOD_REOPENED_V1' AND a.object_type='ACCOUNTING_PERIOD' AND a.action='REOPEN'
     GROUP BY a.metadata->>'prior_close_audit_event_id' HAVING count(*)<>1
  ) OR EXISTS(
    SELECT 1 FROM audit_event a
     WHERE a.tenant_id=p_tenant AND a.entity_id=p_entity AND a.object_id=p_period
       AND a.event_type='PERIOD_REOPENED_V1' AND a.object_type='ACCOUNTING_PERIOD' AND a.action='REOPEN'
     GROUP BY a.idempotency_key HAVING count(*)<>1
  ) THEN
    RAISE EXCEPTION 'Period reopen history contains duplicate retained evidence' USING ERRCODE='23514';
  END IF;

  IF EXISTS(
    SELECT 1 FROM audit_event a
     WHERE a.tenant_id=p_tenant AND a.entity_id=p_entity AND a.object_id=p_period
       AND a.event_type='PERIOD_REOPENED_V1' AND a.object_type='ACCOUNTING_PERIOD' AND a.action='REOPEN'
       AND NOT EXISTS(
         SELECT 1
           FROM outbox_event ro
           JOIN audit_event c ON c.tenant_id=a.tenant_id AND c.entity_id=a.entity_id
             AND c.object_id=a.object_id AND c.audit_event_id::text=a.metadata->>'prior_close_audit_event_id'
             AND c.event_type='PERIOD_CLOSED_V2' AND c.object_type='ACCOUNTING_PERIOD' AND c.action='CLOSE'
           JOIN outbox_event co ON co.tenant_id=c.tenant_id AND co.entity_id=c.entity_id
             AND co.aggregate_type='ACCOUNTING_PERIOD' AND co.aggregate_id=c.object_id
             AND co.event_type=c.event_type AND co.payload=c.metadata
             AND co.payload_hash=refs_jsonb_hash(c.metadata)
          WHERE ro.tenant_id=a.tenant_id AND ro.entity_id=a.entity_id
            AND ro.aggregate_type='ACCOUNTING_PERIOD' AND ro.aggregate_id=a.object_id
            AND ro.event_type=a.event_type AND ro.payload=a.metadata
            AND ro.payload_hash=refs_jsonb_hash(a.metadata)
            AND a.permission_used='GL.PERIOD.REOPEN' AND a.actor_type='USER'
            AND a.actor_id IS NOT NULL AND a.actor_id=btrim(a.actor_id) AND length(a.actor_id) BETWEEN 1 AND 300
            AND a.reason IS NOT NULL AND a.reason=btrim(a.reason) AND length(a.reason) BETWEEN 8 AND 2000
            AND a.idempotency_key IS NOT NULL AND a.idempotency_key=btrim(a.idempotency_key)
            AND length(a.idempotency_key) BETWEEN 8 AND 512
            AND a.request_id=a.idempotency_key AND a.correlation_id=a.idempotency_key
            AND a.before_hash~'^sha256:[0-9a-f]{64}$' AND a.after_hash~'^sha256:[0-9a-f]{64}$'
            AND jsonb_typeof(a.metadata)='object'
            AND (SELECT count(*) FROM jsonb_object_keys(a.metadata))=11
            AND a.metadata->>'schema_version'='PERIOD_REOPENED_EVENT_V1'
            AND a.metadata->>'period_id'=p_period::text AND a.metadata->>'status'='OPEN'
            AND a.metadata->>'period_code' IS NOT NULL AND a.metadata->>'period_code'<>''
            AND a.metadata->>'version'~'^[2-9][0-9]*$|^1[0-9]+$'
            AND a.metadata->>'prior_close_audit_event_id'~*'^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
            AND a.metadata->>'prior_readiness_hash'=a.before_hash
            AND a.metadata->>'prior_closed_by' IS NOT NULL AND a.metadata->>'prior_closed_by'<>''
            AND CASE WHEN a.metadata->>'prior_closed_at'~'^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\.[0-9]{3}Z$'
              THEN to_char((a.metadata->>'prior_closed_at')::timestamptz AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')=a.metadata->>'prior_closed_at'
                AND (a.metadata->>'prior_closed_at')::timestamptz BETWEEN c.occurred_at AND a.occurred_at
              ELSE false END
            AND a.metadata->>'reason'=a.reason AND a.metadata->>'reopened_by'=a.actor_id
            AND a.after_hash=refs_jsonb_hash(a.metadata)
            AND c.permission_used='GL.PERIOD.CLOSE' AND c.actor_type='USER'
            AND c.actor_id=a.metadata->>'prior_closed_by' AND c.actor_id<>a.actor_id
            AND c.reason IS NOT NULL AND c.reason=btrim(c.reason) AND length(c.reason) BETWEEN 8 AND 2000
            AND c.idempotency_key IS NOT NULL AND c.idempotency_key=btrim(c.idempotency_key)
            AND length(c.idempotency_key) BETWEEN 8 AND 512
            AND c.request_id=c.idempotency_key AND c.correlation_id=c.idempotency_key
            AND c.after_hash=a.before_hash
            AND jsonb_typeof(c.metadata)='object'
            AND (SELECT count(*) FROM jsonb_object_keys(c.metadata))=17
            AND c.metadata->>'schema_version'='PERIOD_CLOSED_EVENT_V2'
            AND c.metadata->>'period_id'=p_period::text AND c.metadata->>'status'='CLOSED'
            AND c.metadata->>'period_code'=a.metadata->>'period_code'
            AND c.metadata->>'version'~'^[1-9][0-9]*$'
            AND CASE WHEN a.metadata->>'version'~'^[1-9][0-9]*$' AND c.metadata->>'version'~'^[1-9][0-9]*$'
              THEN (a.metadata->>'version')::numeric=(c.metadata->>'version')::numeric+1 ELSE false END
            AND c.metadata->>'readiness_hash'=c.after_hash AND c.metadata->>'closed_by'=c.actor_id
            AND c.metadata->>'reason'=c.reason
            AND c.metadata->>'settings_snapshot_id'~*'^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
            AND c.metadata->>'close_policy_snapshot_id'~*'^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
            AND c.metadata->>'financial_statement_snapshot_id'~*'^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
            AND c.metadata->>'settings_hash'~'^sha256:[0-9a-f]{64}$'
            AND c.metadata->>'close_policy_hash'~'^sha256:[0-9a-f]{64}$'
            AND c.metadata->>'financial_statement_snapshot_hash'~'^sha256:[0-9a-f]{64}$'
            AND c.metadata->>'ledger_evidence_hash'~'^sha256:[0-9a-f]{64}$'
            AND c.metadata->>'unposted_journal_count'='0'
            AND c.metadata->>'admitted_source_blocker_count'='0'
            AND NOT EXISTS(
              SELECT 1 FROM audit_event newer
               WHERE newer.tenant_id=c.tenant_id AND newer.entity_id=c.entity_id AND newer.object_id=c.object_id
                 AND newer.event_type='PERIOD_CLOSED_V2' AND newer.object_type='ACCOUNTING_PERIOD' AND newer.action='CLOSE'
                 AND newer.occurred_at<=a.occurred_at
                 AND (newer.occurred_at,newer.audit_event_id)>(c.occurred_at,c.audit_event_id)
            )
            AND ro.attempt_count>=0 AND ro.status IN('PENDING','PUBLISHED','FAILED')
            AND (ro.status='PUBLISHED')=(ro.published_at IS NOT NULL)
            AND co.attempt_count>=0 AND co.status IN('PENDING','PUBLISHED','FAILED')
            AND (co.status='PUBLISHED')=(co.published_at IS NOT NULL)
            AND (SELECT count(*) FROM outbox_event x WHERE x.tenant_id=a.tenant_id AND x.entity_id=a.entity_id
                  AND x.aggregate_type='ACCOUNTING_PERIOD' AND x.aggregate_id=a.object_id
                  AND x.event_type=a.event_type AND x.payload=a.metadata
                  AND x.payload_hash=refs_jsonb_hash(a.metadata))=1
            AND (SELECT count(*) FROM outbox_event x WHERE x.tenant_id=c.tenant_id AND x.entity_id=c.entity_id
                  AND x.aggregate_type='ACCOUNTING_PERIOD' AND x.aggregate_id=c.object_id
                  AND x.event_type=c.event_type AND x.payload=c.metadata
                  AND x.payload_hash=refs_jsonb_hash(c.metadata))=1
       )
  ) THEN RAISE EXCEPTION 'Period reopen history contains invalid retained evidence' USING ERRCODE='23514'; END IF;

  SELECT count(*) INTO v_total FROM audit_event a
   WHERE a.tenant_id=p_tenant AND a.entity_id=p_entity AND a.object_id=p_period
     AND a.event_type='PERIOD_REOPENED_V1' AND a.object_type='ACCOUNTING_PERIOD' AND a.action='REOPEN';

  SELECT count(*) INTO v_page_count FROM (
    SELECT 1 FROM audit_event a
     WHERE a.tenant_id=p_tenant AND a.entity_id=p_entity AND a.object_id=p_period
       AND a.event_type='PERIOD_REOPENED_V1' AND a.object_type='ACCOUNTING_PERIOD' AND a.action='REOPEN'
       AND (p_cursor_at IS NULL OR (date_trunc('milliseconds',a.occurred_at AT TIME ZONE 'UTC'),a.audit_event_id)
         <(p_cursor_at AT TIME ZONE 'UTC',p_cursor_id))
     ORDER BY date_trunc('milliseconds',a.occurred_at AT TIME ZONE 'UTC') DESC,a.audit_event_id DESC LIMIT p_limit+1
  ) page;
  v_has_more:=v_page_count>p_limit;

  WITH page AS (
    SELECT a.* FROM audit_event a
     WHERE a.tenant_id=p_tenant AND a.entity_id=p_entity AND a.object_id=p_period
       AND a.event_type='PERIOD_REOPENED_V1' AND a.object_type='ACCOUNTING_PERIOD' AND a.action='REOPEN'
       AND (p_cursor_at IS NULL OR (date_trunc('milliseconds',a.occurred_at AT TIME ZONE 'UTC'),a.audit_event_id)
         <(p_cursor_at AT TIME ZONE 'UTC',p_cursor_id))
     ORDER BY date_trunc('milliseconds',a.occurred_at AT TIME ZONE 'UTC') DESC,a.audit_event_id DESC LIMIT p_limit
  ), evidence AS (
    SELECT p.*,ro.outbox_event_id,ro.payload_hash AS outbox_payload_hash,ro.status AS delivery_status,
      ro.attempt_count,ro.published_at
      FROM page p JOIN LATERAL(
        SELECT x.* FROM outbox_event x WHERE x.tenant_id=p.tenant_id AND x.entity_id=p.entity_id
          AND x.aggregate_type='ACCOUNTING_PERIOD' AND x.aggregate_id=p.object_id
          AND x.event_type=p.event_type AND x.payload=p.metadata
          AND x.payload_hash=refs_jsonb_hash(p.metadata)
      ) ro ON true
  )
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'schema_version','PERIOD_REOPEN_HISTORY_ITEM_V1','audit_event_id',audit_event_id,
    'period_id',object_id,'period_code',metadata->>'period_code','version',metadata->>'version','status','OPEN',
    'recorded_at',to_char(occurred_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    'reopened_by',CASE WHEN actor_id~*'(bearer[[:space:]]+|api[_-]?key|access[_-]?token|refresh[_-]?token|private[_-]?key|password[[:space:]]*[:=]|secret[[:space:]]*[:=]|(sk|rk|pk)-[a-z0-9_-]{8,})' THEN '[REDACTED]' ELSE actor_id END,
    'reopened_by_hash',refs_jsonb_hash(to_jsonb(actor_id)),
    'prior_close_audit_event_id',metadata->>'prior_close_audit_event_id',
    'prior_readiness_hash',metadata->>'prior_readiness_hash',
    'prior_closed_by',CASE WHEN metadata->>'prior_closed_by'~*'(bearer[[:space:]]+|api[_-]?key|access[_-]?token|refresh[_-]?token|private[_-]?key|password[[:space:]]*[:=]|secret[[:space:]]*[:=]|(sk|rk|pk)-[a-z0-9_-]{8,})' THEN '[REDACTED]' ELSE metadata->>'prior_closed_by' END,
    'prior_closed_by_hash',refs_jsonb_hash(to_jsonb(metadata->>'prior_closed_by')),
    'prior_closed_at',metadata->>'prior_closed_at',
    'reason_hash',refs_jsonb_hash(to_jsonb(reason)),'command_reference_hash',refs_jsonb_hash(to_jsonb(idempotency_key)),
    'outbox_event_id',outbox_event_id,'outbox_payload_hash',outbox_payload_hash,
    'delivery',jsonb_build_object('status',delivery_status,'attempt_count',attempt_count,
      'published_at',CASE WHEN published_at IS NULL THEN NULL ELSE to_char(published_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') END),
    'integrity_verified',true,'separation_verified',true
  ) ORDER BY date_trunc('milliseconds',occurred_at AT TIME ZONE 'UTC') DESC,audit_event_id DESC),'[]'::jsonb),count(*)::integer
  INTO v_rows,v_read FROM evidence;

  IF v_has_more THEN
    SELECT (item->>'recorded_at')::timestamptz,(item->>'audit_event_id')::uuid INTO v_next_at,v_next_id
      FROM jsonb_array_elements(v_rows) WITH ORDINALITY x(item,ordinality) ORDER BY ordinality DESC LIMIT 1;
  END IF;
  RETURN jsonb_build_object(
    'schema_version','PERIOD_REOPEN_HISTORY_PAGE_V1',
    'scope',jsonb_build_object('tenant_id',p_tenant,'entity_id',p_entity,'period_id',p_period),
    'total_count',v_total,'read_count',v_read,'items',v_rows,'has_more',v_has_more,
    'next_cursor',CASE WHEN v_next_id IS NULL THEN NULL ELSE jsonb_build_object(
      'recorded_at',to_char(v_next_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),'audit_event_id',v_next_id) END,
    'redaction',jsonb_build_object('reason_hashed',true,'command_reference_hashed',true,'credential_shaped_actor_redacted',true),
    'action_flags',jsonb_build_object('can_create_draft',false,'can_review',false,'can_approve',false,'can_post',false)
  );
END $$;

REVOKE ALL ON FUNCTION refs_read_period_reopen_history(uuid,uuid,uuid,integer,timestamptz,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION refs_read_period_reopen_history(uuid,uuid,uuid,integer,timestamptz,uuid) TO refs_app;

COMMIT;
