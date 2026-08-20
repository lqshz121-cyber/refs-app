BEGIN;

-- This is a read model only. Project completion is accepted exclusively from
-- one approved, canonically hashed entity snapshot; CWIP classification is
-- accepted exclusively from one effective highest-priority account mapping.
CREATE FUNCTION refs_read_ai_cwip_post_completion_source(
  p_tenant uuid,p_entity uuid,p_period uuid,p_limit integer DEFAULT 500
) RETURNS TABLE(
  entity_id uuid,accounting_period_id uuid,journal_entry_id uuid,
  journal_line_id uuid,ledger_line_id uuid,journal_status text,
  project_ref text,project_status text,completion_date text,posting_date text,
  cwip_account_code text,currency text,debit_amount text,credit_amount text,
  project_status_snapshot_hash text,account_mapping_snapshot_hash text,
  source_trace jsonb
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
BEGIN
  PERFORM refs_assert_scope(p_tenant,p_entity,'AI.ANALYSIS.EXPLAIN');
  IF p_limit IS NULL OR p_limit<1 OR p_limit>500 THEN RAISE EXCEPTION 'AI post-completion CWIP source limit must be between 1 and 500' USING ERRCODE='22023'; END IF;
  IF NOT EXISTS(SELECT 1 FROM accounting_period p WHERE p.tenant_id=p_tenant AND p.entity_id=p_entity AND p.period_id=p_period AND p.ledger_code='PRIMARY') THEN RAISE EXCEPTION 'Authoritative primary accounting period is unavailable' USING ERRCODE='22023'; END IF;

  RETURN QUERY
  WITH selected_period AS (
    SELECT p.starts_on,p.ends_on FROM accounting_period p
    WHERE p.tenant_id=p_tenant AND p.entity_id=p_entity AND p.period_id=p_period AND p.ledger_code='PRIMARY'
  ), lifecycle AS (
    SELECT count(*)::integer AS candidate_count,
      (array_agg(s.snapshot ORDER BY s.setting_snapshot_id))[1] AS snapshot,
      (array_agg(s.snapshot_hash ORDER BY s.setting_snapshot_id))[1] AS snapshot_hash
    FROM setting_snapshot s CROSS JOIN selected_period p
    WHERE s.tenant_id=p_tenant AND s.entity_id=p_entity
      AND s.family='AI_PROJECT_LIFECYCLE_EVIDENCE' AND s.scope_type='ENTITY'
      AND s.scope_key=p_entity::text AND s.status='APPROVED'
      AND s.effective_from::date<=p.ends_on AND (s.effective_to IS NULL OR s.effective_to::date>p.ends_on)
      AND s.snapshot_hash=refs_jsonb_hash(s.snapshot)
      AND s.snapshot->>'schema_version'='AI_PROJECT_LIFECYCLE_EVIDENCE_V1'
      AND jsonb_typeof(s.snapshot->'projects')='object'
  ), mapped_accounts AS (
    SELECT key.account_code,m.candidate_count,m.mapping_snapshot_hash,m.classification
    FROM (SELECT DISTINCT ms.input_keys->>'account_code' AS account_code
      FROM mapping_snapshot ms WHERE ms.tenant_id=p_tenant AND ms.entity_id=p_entity
        AND ms.family='CWIP_ACCOUNT_CLASSIFICATION' AND ms.input_keys?'account_code') key
    CROSS JOIN selected_period p
    LEFT JOIN LATERAL (
      WITH eligible AS (SELECT ms.* FROM mapping_snapshot ms
        WHERE ms.tenant_id=p_tenant AND ms.entity_id=p_entity AND ms.family='CWIP_ACCOUNT_CLASSIFICATION'
          AND ms.status IN('APPROVED','RETIRED') AND ms.input_keys=jsonb_build_object('account_code',key.account_code)
          AND ms.effective_from::date<=p.ends_on AND (ms.effective_to IS NULL OR ms.effective_to::date>p.ends_on)),
      highest AS (SELECT * FROM eligible WHERE priority=(SELECT max(priority) FROM eligible))
      SELECT count(*)::integer AS candidate_count,
        (array_agg(snapshot_hash ORDER BY mapping_snapshot_id))[1] AS mapping_snapshot_hash,
        (array_agg(output_rules->>'classification' ORDER BY mapping_snapshot_id))[1] AS classification FROM highest
    ) m ON true
  ), posted_cwip AS (
    SELECT l.*,j.status::text AS journal_status,j.journal_date,jl.dimensions->>'project_ref' AS project_ref
    FROM ledger_line l JOIN journal_entry j ON j.tenant_id=l.tenant_id AND j.entity_id=l.entity_id AND j.journal_entry_id=l.journal_entry_id
    JOIN journal_line jl ON jl.tenant_id=l.tenant_id AND jl.entity_id=l.entity_id AND jl.journal_line_id=l.journal_line_id
    JOIN mapped_accounts m ON m.account_code=l.account_code AND m.candidate_count=1 AND m.classification='CWIP'
    JOIN selected_period p ON j.journal_date BETWEEN p.starts_on AND p.ends_on
    WHERE l.tenant_id=p_tenant AND l.entity_id=p_entity AND l.period_id=p_period AND j.status='POSTED' AND l.debit_amount>0
  )
  SELECT l.entity_id,p_period,l.journal_entry_id,l.journal_line_id,l.ledger_line_id,l.journal_status,
    l.project_ref,CASE WHEN lifecycle.candidate_count=1 THEN project.entry->>'status' END,
    CASE WHEN lifecycle.candidate_count=1 THEN project.entry->>'completion_date' END,
    to_char(l.journal_date,'YYYY-MM-DD'),l.account_code,l.currency::text,
    to_char(l.debit_amount,'FM999999999999990.0000'),to_char(l.credit_amount,'FM999999999999990.0000'),
    CASE WHEN lifecycle.candidate_count=1 THEN lifecycle.snapshot_hash END,m.mapping_snapshot_hash,
    CASE WHEN trace.match_count=1 THEN jsonb_build_object('source_document_id',trace.source_document_id,'source_document_line_id',trace.source_document_line_id,'source_payload_hash',trace.source_payload_hash,'source_line_hash',trace.source_line_hash) END
  FROM posted_cwip l JOIN mapped_accounts m ON m.account_code=l.account_code
  CROSS JOIN lifecycle
  LEFT JOIN LATERAL (SELECT lifecycle.snapshot->'projects'->l.project_ref AS entry) project ON true
  LEFT JOIN LATERAL (
    SELECT count(*)::integer AS match_count,
      (array_agg(sd.source_document_id ORDER BY sd.source_document_id,sdl.source_document_line_id))[1] AS source_document_id,
      (array_agg(sdl.source_document_line_id ORDER BY sd.source_document_id,sdl.source_document_line_id))[1] AS source_document_line_id,
      (array_agg(sd.payload_hash ORDER BY sd.source_document_id,sdl.source_document_line_id))[1] AS source_payload_hash,
      (array_agg(refs_jsonb_hash(jsonb_build_object('source_document_line_id',sdl.source_document_line_id,'source_line_id',sdl.source_line_id,'line_no',sdl.line_no,'amount',sdl.amount,'direction',sdl.direction,'project_ref',sdl.project_ref,'property_ref',sdl.property_ref,'loan_ref',sdl.loan_ref,'cost_code_ref',sdl.cost_code_ref)) ORDER BY sd.source_document_id,sdl.source_document_line_id))[1] AS source_line_hash
    FROM source_link sl JOIN source_document sd ON sd.tenant_id=sl.tenant_id AND sd.entity_id=sl.entity_id AND sd.source_document_id=sl.source_document_id
    JOIN source_document_line sdl ON sdl.tenant_id=sl.tenant_id AND sdl.entity_id=sl.entity_id AND sdl.source_document_line_id=sl.source_document_line_id
    WHERE sl.tenant_id=l.tenant_id AND sl.entity_id=l.entity_id AND sl.journal_entry_id=l.journal_entry_id
      AND (sl.journal_line_id IS NULL OR sl.journal_line_id=l.journal_line_id)
      AND (sl.ledger_line_id IS NULL OR sl.ledger_line_id=l.ledger_line_id)
  ) trace ON true
  ORDER BY l.journal_date,l.ledger_line_id LIMIT p_limit;
END; $$;

REVOKE ALL ON FUNCTION refs_read_ai_cwip_post_completion_source(uuid,uuid,uuid,integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION refs_read_ai_cwip_post_completion_source(uuid,uuid,uuid,integer) TO refs_app;

COMMIT;
