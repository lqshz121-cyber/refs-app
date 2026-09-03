BEGIN;

-- A page count alone cannot prove a stable population: a concurrent insert and
-- delete can preserve total_count while moving rows between offsets.  These
-- readers derive a content-addressed token from the complete ordered population
-- in the same PostgreSQL statement snapshot that produces the requested page.
-- Later pages must present the first token; any identity, revision, content,
-- scope, or filter drift fails closed.
CREATE FUNCTION refs_read_ai_accounting_decision_queue_snapshot(
  p_tenant uuid,p_entity uuid,p_period uuid,p_limit integer,p_offset integer,
  p_expected_population_hash text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE result jsonb; observed_count integer; population_hash text;
BEGIN
  PERFORM refs_assert_scope(p_tenant,p_entity,'GL.JE.VIEW');
  IF p_limit NOT BETWEEN 1 AND 200 OR p_offset<0 THEN RAISE EXCEPTION 'Decision queue snapshot page is invalid' USING ERRCODE='22023'; END IF;
  IF p_expected_population_hash IS NOT NULL AND p_expected_population_hash !~ '^sha256:[0-9a-f]{64}$' THEN RAISE EXCEPTION 'Decision queue snapshot token is invalid' USING ERRCODE='22023'; END IF;

  WITH ordered_population AS MATERIALIZED (
    SELECT d.created_at,d.ai_accounting_decision_id,
      jsonb_strip_nulls(jsonb_build_object(
        'ai_accounting_decision_id',d.ai_accounting_decision_id,
        'decision_hash',d.decision_hash,
        'created_at',to_char(d.created_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
        'human_decision_id',h.ai_accounting_human_decision_id,
        'human_evidence_hash',h.evidence_hash,
        'draft_evidence_id',de.ai_accounting_decision_draft_evidence_id,
        'draft_evidence_hash',de.evidence_hash,
        'journal_entry_id',de.journal_entry_id,
        'journal_status',je.status,
        'journal_revision',je.revision,
        'posted_outcome_review_id',review.ai_accounting_posted_outcome_review_id,
        'posted_outcome_review_hash',review.review_hash,
        'posted_outcome_review_revision',review.review_revision
      )) AS row_version
    FROM ai_accounting_decision d
    LEFT JOIN ai_accounting_human_decision h ON h.tenant_id=d.tenant_id AND h.entity_id=d.entity_id AND h.ai_accounting_decision_id=d.ai_accounting_decision_id
    LEFT JOIN ai_accounting_decision_draft_evidence de ON de.tenant_id=d.tenant_id AND de.entity_id=d.entity_id AND de.ai_accounting_decision_id=d.ai_accounting_decision_id
    LEFT JOIN journal_entry je ON je.tenant_id=de.tenant_id AND je.entity_id=de.entity_id AND je.journal_entry_id=de.journal_entry_id
    LEFT JOIN LATERAL (
      SELECT r.ai_accounting_posted_outcome_review_id,r.review_hash,r.review_revision
      FROM ai_accounting_posted_outcome_review r
      WHERE r.tenant_id=d.tenant_id AND r.entity_id=d.entity_id AND r.ai_accounting_decision_id=d.ai_accounting_decision_id
      ORDER BY r.review_revision DESC,r.ai_accounting_posted_outcome_review_id DESC LIMIT 1
    ) review ON true
    WHERE d.tenant_id=p_tenant AND d.entity_id=p_entity AND d.period_id=p_period
    ORDER BY d.created_at DESC,d.ai_accounting_decision_id DESC
    LIMIT 100001
  ), population AS MATERIALIZED (
    SELECT count(*)::integer AS total_count,
      COALESCE(jsonb_agg(row_version ORDER BY created_at DESC,ai_accounting_decision_id DESC),'[]'::jsonb) AS row_versions
    FROM ordered_population
  ), page AS MATERIALIZED (
    SELECT refs_read_ai_accounting_decision_queue(p_tenant,p_entity,p_period,p_limit,p_offset) AS body
  )
  SELECT page.body || jsonb_build_object(
      'schema_version','AI_ACCOUNTING_DECISION_QUEUE_SNAPSHOT_V1',
      'population_hash',refs_jsonb_hash(jsonb_build_object(
        'schema_version','AUTHORITATIVE_PAGED_POPULATION_V1',
        'population_kind','AI_ACCOUNTING_DECISION_QUEUE',
        'tenant_id',p_tenant,'entity_id',p_entity,'period_id',p_period,
        'filter',jsonb_build_object(),
        'total_count',population.total_count,
        'ordered_row_versions',population.row_versions
      )),
      'snapshot_token',refs_jsonb_hash(jsonb_build_object(
        'schema_version','AUTHORITATIVE_PAGED_POPULATION_V1',
        'population_kind','AI_ACCOUNTING_DECISION_QUEUE',
        'tenant_id',p_tenant,'entity_id',p_entity,'period_id',p_period,
        'filter',jsonb_build_object(),
        'total_count',population.total_count,
        'ordered_row_versions',population.row_versions
      ))
    ),population.total_count,
    refs_jsonb_hash(jsonb_build_object(
      'schema_version','AUTHORITATIVE_PAGED_POPULATION_V1',
      'population_kind','AI_ACCOUNTING_DECISION_QUEUE',
      'tenant_id',p_tenant,'entity_id',p_entity,'period_id',p_period,
      'filter',jsonb_build_object(),
      'total_count',population.total_count,
      'ordered_row_versions',population.row_versions
    ))
  INTO result,observed_count,population_hash FROM page CROSS JOIN population;

  IF observed_count>100000 THEN RAISE EXCEPTION 'Decision queue snapshot exceeds the safe population bound' USING ERRCODE='54000'; END IF;
  IF (result->>'total_count')::integer<>observed_count THEN RAISE EXCEPTION 'Decision queue snapshot count drifted inside the read' USING ERRCODE='40001'; END IF;
  IF p_expected_population_hash IS NOT NULL AND p_expected_population_hash<>population_hash THEN RAISE EXCEPTION 'Decision queue population hash changed between pages' USING ERRCODE='40001'; END IF;
  RETURN result;
END $$;

CREATE FUNCTION refs_read_general_ledger_snapshot(
  p_tenant uuid,p_entity uuid,p_period uuid,p_account_code text,p_query text,
  p_limit integer,p_offset integer,p_expected_population_hash text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE result jsonb; observed_count integer; population_hash text;
BEGIN
  PERFORM refs_assert_scope(p_tenant,p_entity,'GL.JE.VIEW');
  IF p_limit NOT BETWEEN 1 AND 200 OR p_offset<0 THEN RAISE EXCEPTION 'General Ledger snapshot page is invalid' USING ERRCODE='22023'; END IF;
  IF p_account_code IS NOT NULL AND (btrim(p_account_code)<>p_account_code OR p_account_code !~ '^[A-Za-z0-9._-]{1,64}$') THEN RAISE EXCEPTION 'Account code is invalid' USING ERRCODE='22023'; END IF;
  IF p_query IS NOT NULL AND (btrim(p_query)<>p_query OR length(p_query)>160 OR p_query ~ '[[:cntrl:]]') THEN RAISE EXCEPTION 'General Ledger query is invalid' USING ERRCODE='22023'; END IF;
  IF p_expected_population_hash IS NOT NULL AND p_expected_population_hash !~ '^sha256:[0-9a-f]{64}$' THEN RAISE EXCEPTION 'General Ledger snapshot token is invalid' USING ERRCODE='22023'; END IF;

  WITH selected_period AS MATERIALIZED (
    SELECT period_id,period_code,starts_on,ends_on FROM accounting_period
    WHERE tenant_id=p_tenant AND entity_id=p_entity AND period_id=p_period
  ), ordered_population AS MATERIALIZED (
    SELECT l.posted_at,j.journal_date,l.ledger_line_id,
      jsonb_build_object(
        'ledger_line_id',l.ledger_line_id,'journal_entry_id',l.journal_entry_id,
        'journal_revision',j.revision,'journal_line_id',l.journal_line_id,
        'account_code',l.account_code,'account_name',m.account_name,'currency',l.currency,
        'journal_date',to_char(j.journal_date,'YYYY-MM-DD'),'journal_number',j.journal_number,
        'member_ref',l.member_ref,'description',jl.description,
        'debit_amount',to_char(l.debit_amount,'FM9999999999999990.0000'),
        'credit_amount',to_char(l.credit_amount,'FM9999999999999990.0000'),
        'source_document_ids',ARRAY(SELECT DISTINCT sl.source_document_id FROM source_link sl
          WHERE sl.tenant_id=p_tenant AND sl.entity_id=p_entity AND sl.journal_entry_id=l.journal_entry_id
            AND sl.source_document_id IS NOT NULL ORDER BY sl.source_document_id)
      ) AS row_version
    FROM ledger_line l
    JOIN journal_entry j ON j.tenant_id=l.tenant_id AND j.entity_id=l.entity_id AND j.journal_entry_id=l.journal_entry_id
    JOIN account_master m ON m.tenant_id=l.tenant_id AND m.entity_id=l.entity_id AND m.account_code=l.account_code
    LEFT JOIN journal_line jl ON jl.tenant_id=l.tenant_id AND jl.entity_id=l.entity_id AND jl.journal_line_id=l.journal_line_id
    CROSS JOIN selected_period ap
    WHERE l.tenant_id=p_tenant AND l.entity_id=p_entity AND j.status='POSTED'
      AND j.journal_date BETWEEN ap.starts_on AND ap.ends_on
      AND (p_account_code IS NULL OR l.account_code=p_account_code)
      AND (p_query IS NULL OR l.account_code ILIKE '%'||p_query||'%' OR j.journal_number ILIKE '%'||p_query||'%' OR COALESCE(jl.description,'') ILIKE '%'||p_query||'%')
    ORDER BY j.journal_date,l.posted_at,l.ledger_line_id
    LIMIT 100001
  ), population AS MATERIALIZED (
    SELECT count(*)::integer total_count,
      COALESCE(jsonb_agg(row_version ORDER BY journal_date,posted_at,ledger_line_id),'[]'::jsonb) row_versions
    FROM ordered_population
  ), page AS MATERIALIZED (
    SELECT COALESCE(jsonb_agg(
      row_version || jsonb_build_object(
        'period_id',p_period,
        'period_code',ap.period_code,
        'period_start',to_char(ap.starts_on,'YYYY-MM-DD'),
        'period_end',to_char(ap.ends_on,'YYYY-MM-DD'),
        'total_count',population.total_count
      ) ORDER BY journal_date,posted_at,ledger_line_id
    ),'[]'::jsonb) rows
    FROM (
      SELECT * FROM ordered_population
      ORDER BY journal_date,posted_at,ledger_line_id
      OFFSET p_offset LIMIT p_limit
    ) selected
    CROSS JOIN selected_period ap
    CROSS JOIN population
  )
  SELECT jsonb_build_object(
      'schema_version','GENERAL_LEDGER_SNAPSHOT_PAGE_V1',
      'scope',jsonb_build_object('tenant_id',p_tenant,'entity_id',p_entity,'period_id',p_period),
      'filter',jsonb_build_object('account_code',p_account_code,'query',p_query),
      'limit',p_limit,'offset',p_offset,'total_count',population.total_count,
      'read_count',jsonb_array_length(page.rows),
      'population_complete',p_offset+jsonb_array_length(page.rows)>=population.total_count,
      'population_hash',refs_jsonb_hash(jsonb_build_object(
        'schema_version','AUTHORITATIVE_PAGED_POPULATION_V1','population_kind','GENERAL_LEDGER',
        'tenant_id',p_tenant,'entity_id',p_entity,'period_id',p_period,
        'filter',jsonb_build_object('account_code',p_account_code,'query',p_query),
        'total_count',population.total_count,'ordered_row_versions',population.row_versions
      )),
      'snapshot_token',refs_jsonb_hash(jsonb_build_object(
        'schema_version','AUTHORITATIVE_PAGED_POPULATION_V1','population_kind','GENERAL_LEDGER',
        'tenant_id',p_tenant,'entity_id',p_entity,'period_id',p_period,
        'filter',jsonb_build_object('account_code',p_account_code,'query',p_query),
        'total_count',population.total_count,'ordered_row_versions',population.row_versions
      )),
      'rows',page.rows
    ),population.total_count,
    refs_jsonb_hash(jsonb_build_object(
      'schema_version','AUTHORITATIVE_PAGED_POPULATION_V1','population_kind','GENERAL_LEDGER',
      'tenant_id',p_tenant,'entity_id',p_entity,'period_id',p_period,
      'filter',jsonb_build_object('account_code',p_account_code,'query',p_query),
      'total_count',population.total_count,'ordered_row_versions',population.row_versions
    ))
  INTO result,observed_count,population_hash FROM page CROSS JOIN population;

  IF NOT EXISTS(SELECT 1 FROM accounting_period WHERE tenant_id=p_tenant AND entity_id=p_entity AND period_id=p_period) THEN RAISE EXCEPTION 'A valid entity-scoped accounting period is required' USING ERRCODE='22023'; END IF;
  IF observed_count>100000 THEN RAISE EXCEPTION 'General Ledger snapshot exceeds the safe population bound' USING ERRCODE='54000'; END IF;
  IF p_expected_population_hash IS NOT NULL AND p_expected_population_hash<>population_hash THEN RAISE EXCEPTION 'General Ledger population hash changed between pages' USING ERRCODE='40001'; END IF;
  RETURN result;
END $$;

REVOKE ALL ON FUNCTION refs_read_ai_accounting_decision_queue_snapshot(uuid,uuid,uuid,integer,integer,text) FROM PUBLIC;
REVOKE ALL ON FUNCTION refs_read_general_ledger_snapshot(uuid,uuid,uuid,text,text,integer,integer,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION refs_read_ai_accounting_decision_queue_snapshot(uuid,uuid,uuid,integer,integer,text) TO refs_app;
GRANT EXECUTE ON FUNCTION refs_read_general_ledger_snapshot(uuid,uuid,uuid,text,text,integer,integer,text) TO refs_app;

COMMIT;
