BEGIN;

-- A recoverable human workflow needs a server-derived view of retained
-- decisions.  The ephemeral analysis endpoint is deliberately not a queue:
-- after a refresh it cannot prove which packet was retained, decided, or
-- converted into a Draft.  This reader joins only immutable retained evidence
-- and the current standard Journal state.  It grants no workflow transition.
CREATE FUNCTION refs_read_ai_accounting_decision_queue(
  p_tenant uuid,
  p_entity uuid,
  p_period uuid,
  p_limit integer DEFAULT 50,
  p_offset integer DEFAULT 0
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp
AS $$
DECLARE
  total_count integer;
  result_rows jsonb;
BEGIN
  PERFORM refs_assert_scope(p_tenant,p_entity,'GL.JE.VIEW');
  IF p_limit NOT BETWEEN 1 AND 200 OR p_offset<0 THEN
    RAISE EXCEPTION 'Decision queue page is invalid' USING ERRCODE='22023';
  END IF;
  IF NOT EXISTS(
    SELECT 1 FROM accounting_period
    WHERE tenant_id=p_tenant AND entity_id=p_entity AND period_id=p_period
  ) THEN
    RAISE EXCEPTION 'Decision queue period is unavailable' USING ERRCODE='22023';
  END IF;

  -- Never turn corrupted retained evidence into a plausible queue row.
  IF EXISTS(
    SELECT 1 FROM ai_accounting_decision d
    WHERE d.tenant_id=p_tenant AND d.entity_id=p_entity AND d.period_id=p_period
      AND (
        d.decision_hash<>refs_jsonb_hash(d.packet)
        OR d.packet->>'schema_version'<>'AI_ACCOUNTING_DECISION_PACKET_V1'
        OR d.packet_status<>d.packet->>'status'
        OR d.packet->>'tenant_id'<>p_tenant::text
        OR d.packet->>'entity_id'<>p_entity::text
        OR d.packet->>'accounting_period_id'<>p_period::text
        OR d.packet#>>'{action_flags,can_create_draft}'<>'false'
        OR d.packet#>>'{action_flags,can_review}'<>'false'
        OR d.packet#>>'{action_flags,can_approve}'<>'false'
        OR d.packet#>>'{action_flags,can_post}'<>'false'
      )
  ) THEN
    RAISE EXCEPTION 'Retained AI accounting decision evidence is invalid' USING ERRCODE='23514';
  END IF;
  IF EXISTS(
    SELECT 1
    FROM ai_accounting_human_decision h
    JOIN ai_accounting_decision d ON d.tenant_id=h.tenant_id AND d.entity_id=h.entity_id AND d.ai_accounting_decision_id=h.ai_accounting_decision_id
    WHERE h.tenant_id=p_tenant AND h.entity_id=p_entity AND d.period_id=p_period
      AND (
        h.decision_hash<>d.decision_hash
        OR h.evidence_hash<>refs_jsonb_hash(jsonb_build_object(
          'decision_id',d.ai_accounting_decision_id,
          'decision_hash',d.decision_hash,
          'outcome',h.decision,
          'reason',h.reason,
          'actor_id',h.decided_by
        ))
      )
  ) THEN
    RAISE EXCEPTION 'Retained human decision evidence is invalid' USING ERRCODE='23514';
  END IF;
  IF EXISTS(
    SELECT 1
    FROM ai_accounting_decision_draft_evidence de
    JOIN ai_accounting_decision d ON d.tenant_id=de.tenant_id AND d.entity_id=de.entity_id AND d.ai_accounting_decision_id=de.ai_accounting_decision_id
    JOIN ai_accounting_human_decision h ON h.tenant_id=de.tenant_id AND h.entity_id=de.entity_id AND h.ai_accounting_human_decision_id=de.ai_accounting_human_decision_id
    WHERE de.tenant_id=p_tenant AND de.entity_id=p_entity AND d.period_id=p_period
      AND (
        h.ai_accounting_decision_id<>d.ai_accounting_decision_id
        OR h.decision<>'ACCEPTED'
        OR de.decision_hash<>d.decision_hash
        OR de.acceptance_hash<>h.evidence_hash
        OR de.evidence_hash<>refs_jsonb_hash(jsonb_build_object(
          'decision_id',d.ai_accounting_decision_id,
          'decision_hash',d.decision_hash,
          'human_decision_id',h.ai_accounting_human_decision_id,
          'acceptance_hash',h.evidence_hash,
          'journal_entry_id',de.journal_entry_id,
          'maker',de.created_by
        ))
      )
  ) THEN
    RAISE EXCEPTION 'Retained AI Draft evidence is invalid' USING ERRCODE='23514';
  END IF;

  SELECT count(*) INTO total_count
  FROM ai_accounting_decision d
  WHERE d.tenant_id=p_tenant AND d.entity_id=p_entity AND d.period_id=p_period;

  WITH page AS (
    SELECT d.*
    FROM ai_accounting_decision d
    WHERE d.tenant_id=p_tenant AND d.entity_id=p_entity AND d.period_id=p_period
    ORDER BY d.created_at DESC,d.ai_accounting_decision_id DESC
    LIMIT p_limit OFFSET p_offset
  ), assembled AS (
    SELECT
      d.created_at,
      d.ai_accounting_decision_id,
      jsonb_build_object(
        'schema_version','AI_ACCOUNTING_DECISION_QUEUE_ITEM_V1',
        'ai_accounting_decision_id',d.ai_accounting_decision_id,
        'decision_hash',d.decision_hash,
        'packet_status',d.packet_status,
        'created_at',to_char(d.created_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
        'packet',d.packet,
        'workflow_state',CASE
          WHEN h.ai_accounting_human_decision_id IS NULL THEN 'AWAITING_HUMAN_DECISION'
          WHEN h.decision='REJECTED' THEN 'REJECTED'
          WHEN de.ai_accounting_decision_draft_evidence_id IS NULL THEN 'ACCEPTED_READY_FOR_DRAFT'
          WHEN je.status='DRAFT' THEN 'DRAFT_CREATED'
          WHEN je.status='PENDING_REVIEW' THEN 'PENDING_REVIEW'
          WHEN je.status='PENDING_APPROVAL' THEN 'PENDING_APPROVAL'
          WHEN je.status='APPROVED' THEN 'APPROVED'
          WHEN je.status='POSTED' THEN 'POSTED'
          ELSE 'JOURNAL_STATE_UNAVAILABLE'
        END,
        'human_decision',CASE WHEN h.ai_accounting_human_decision_id IS NULL THEN NULL ELSE jsonb_build_object(
          'ai_accounting_human_decision_id',h.ai_accounting_human_decision_id,
          'outcome',h.decision,
          'decision_hash',h.decision_hash,
          'evidence_hash',h.evidence_hash,
          'reason',h.reason,
          'decided_by',h.decided_by,
          'decided_at',to_char(h.decided_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
        ) END,
        'draft_evidence',CASE WHEN de.ai_accounting_decision_draft_evidence_id IS NULL THEN NULL ELSE jsonb_build_object(
          'ai_accounting_decision_draft_evidence_id',de.ai_accounting_decision_draft_evidence_id,
          'journal_entry_id',de.journal_entry_id,
          'evidence_hash',de.evidence_hash,
          'created_by',de.created_by,
          'created_at',to_char(de.created_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
          'journal_status',je.status,
          'journal_revision',je.revision
        ) END,
        'latest_posted_outcome_review',CASE WHEN review.ai_accounting_posted_outcome_review_id IS NULL THEN NULL ELSE jsonb_build_object(
          'ai_accounting_posted_outcome_review_id',review.ai_accounting_posted_outcome_review_id,
          'review_revision',review.review_revision,
          'status',review.review_status,
          'review_hash',review.review_hash,
          'reviewed_by',review.reviewed_by,
          'reviewed_at',to_char(review.reviewed_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
        ) END,
        'action_flags',jsonb_build_object(
          'can_accept_or_reject',h.ai_accounting_human_decision_id IS NULL AND refs_entity_has_permission(p_entity,'GL.JE.CREATE'),
          'can_create_draft',h.decision='ACCEPTED' AND de.ai_accounting_decision_draft_evidence_id IS NULL AND refs_entity_has_permission(p_entity,'GL.JE.CREATE'),
          'can_retain_posted_outcome',je.status='POSTED' AND refs_entity_has_permission(p_entity,'AI.ANALYSIS.EXPLAIN'),
          'can_submit',false,
          'can_review',false,
          'can_approve',false,
          'can_post',false
        )
      ) AS item
    FROM page d
    LEFT JOIN ai_accounting_human_decision h ON h.tenant_id=d.tenant_id AND h.entity_id=d.entity_id AND h.ai_accounting_decision_id=d.ai_accounting_decision_id
    LEFT JOIN ai_accounting_decision_draft_evidence de ON de.tenant_id=d.tenant_id AND de.entity_id=d.entity_id AND de.ai_accounting_decision_id=d.ai_accounting_decision_id
    LEFT JOIN journal_entry je ON je.tenant_id=de.tenant_id AND je.entity_id=de.entity_id AND je.journal_entry_id=de.journal_entry_id
    LEFT JOIN LATERAL (
      SELECT r.* FROM ai_accounting_posted_outcome_review r
      WHERE r.tenant_id=d.tenant_id AND r.entity_id=d.entity_id AND r.ai_accounting_decision_id=d.ai_accounting_decision_id
      ORDER BY r.review_revision DESC LIMIT 1
    ) review ON true
  )
  SELECT COALESCE(jsonb_agg(item ORDER BY created_at DESC,ai_accounting_decision_id DESC),'[]'::jsonb)
    INTO result_rows FROM assembled;

  RETURN jsonb_build_object(
    'schema_version','AI_ACCOUNTING_DECISION_QUEUE_V1',
    'scope',jsonb_build_object('tenant_id',p_tenant,'entity_id',p_entity,'accounting_period_id',p_period),
    'total_count',total_count,
    'read_count',jsonb_array_length(result_rows),
    'limit',p_limit,
    'offset',p_offset,
    'population_complete',p_offset+jsonb_array_length(result_rows)>=total_count,
    'rows',result_rows
  );
END $$;

REVOKE ALL ON FUNCTION refs_read_ai_accounting_decision_queue(uuid,uuid,uuid,integer,integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION refs_read_ai_accounting_decision_queue(uuid,uuid,uuid,integer,integer) TO refs_app;

COMMIT;
