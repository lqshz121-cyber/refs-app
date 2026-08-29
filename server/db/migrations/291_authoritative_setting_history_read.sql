BEGIN;

CREATE INDEX setting_snapshot_entity_family_history_idx
  ON setting_snapshot(tenant_id,entity_id,family,version DESC,setting_snapshot_id DESC)
  WHERE status IN ('APPROVED','RETIRED');

CREATE FUNCTION refs_read_authoritative_setting_history(
  p_tenant uuid,p_entity uuid,p_family text,p_limit integer DEFAULT 25,
  p_cursor_version bigint DEFAULT NULL,p_cursor_id uuid DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE
  v_rows jsonb;v_total bigint;v_read integer;v_page_count integer;v_has_more boolean;
  v_next_version bigint;v_next_id uuid;
  v_families constant text[]:=ARRAY[
    'AI_ACCOUNTING_COA_V1','AI_ACCOUNTING_VENDOR_TREATMENT_V1','AI_ACCOUNTING_PROJECT_PROPERTY_COST_CODE_V1',
    'AI_ACCOUNTING_PERIOD_CLOSE_POLICY_V1','AI_ACCOUNTING_TAX_V1','AI_ACCOUNTING_INTERCOMPANY_V1',
    'AI_ACCOUNTING_MATERIALITY_V1','AI_ACCOUNTING_APPROVAL_THRESHOLDS_V1',
    'AI_ACCOUNTING_REPORT_MAPPING_V1','AI_ACCOUNTING_LOAN_CAPITALIZATION_POLICY_V1'
  ];
BEGIN
  PERFORM refs_assert_scope(p_tenant,p_entity,'AI.ACCOUNTING.SETTINGS.VIEW');
  IF p_family IS NULL OR p_family<>btrim(p_family) OR NOT p_family=ANY(v_families)
     OR p_limit NOT BETWEEN 1 AND 100
     OR (p_cursor_version IS NULL)<>(p_cursor_id IS NULL)
     OR p_cursor_version IS NOT NULL AND p_cursor_version<1 THEN
    RAISE EXCEPTION 'Setting history family or page is invalid' USING ERRCODE='22023';
  END IF;

  IF EXISTS(
    SELECT 1 FROM setting_snapshot s
     WHERE s.tenant_id=p_tenant AND s.entity_id=p_entity AND s.family=p_family
       AND s.status IN ('APPROVED','RETIRED')
       AND (s.scope_type<>'ENTITY' OR s.scope_key<>p_entity::text OR s.snapshot_hash<>refs_jsonb_hash(s.snapshot)
         OR s.approved_by IS NULL OR s.approved_at IS NULL
         OR (s.status='RETIRED' AND (s.retired_by IS NULL OR s.retired_at IS NULL OR s.retire_reason IS NULL)))
  ) THEN RAISE EXCEPTION 'Setting history contains invalid retained evidence' USING ERRCODE='23514'; END IF;

  SELECT count(*) INTO v_total FROM setting_snapshot s
   WHERE s.tenant_id=p_tenant AND s.entity_id=p_entity AND s.family=p_family
     AND s.scope_type='ENTITY' AND s.scope_key=p_entity::text AND s.status IN ('APPROVED','RETIRED');

  SELECT count(*) INTO v_page_count FROM (
    SELECT 1 FROM setting_snapshot s
     WHERE s.tenant_id=p_tenant AND s.entity_id=p_entity AND s.family=p_family
       AND s.scope_type='ENTITY' AND s.scope_key=p_entity::text AND s.status IN ('APPROVED','RETIRED')
       AND (p_cursor_version IS NULL OR (s.version,s.setting_snapshot_id)<(p_cursor_version,p_cursor_id))
     ORDER BY s.version DESC,s.setting_snapshot_id DESC LIMIT p_limit+1
  ) page;
  v_has_more:=v_page_count>p_limit;

  WITH page AS (
    SELECT s.* FROM setting_snapshot s
     WHERE s.tenant_id=p_tenant AND s.entity_id=p_entity AND s.family=p_family
       AND s.scope_type='ENTITY' AND s.scope_key=p_entity::text AND s.status IN ('APPROVED','RETIRED')
       AND (p_cursor_version IS NULL OR (s.version,s.setting_snapshot_id)<(p_cursor_version,p_cursor_id))
     ORDER BY s.version DESC,s.setting_snapshot_id DESC LIMIT p_limit
  ), evidence AS (
    SELECT p.*,
      (SELECT count(*)::bigint FROM setting_snapshot parent
        WHERE parent.tenant_id=p.tenant_id AND parent.entity_id=p.entity_id
          AND parent.family='AI_ACCOUNTING_ENTITY_PERIOD_SETTINGS_V1' AND parent.status IN ('APPROVED','RETIRED')
          AND EXISTS(SELECT 1 FROM jsonb_each(parent.snapshot) x WHERE jsonb_typeof(x.value)='object' AND x.value->>'setting_snapshot_id'=p.setting_snapshot_id::text)) AS binding_count,
      (SELECT count(*)::bigint FROM rule_evaluation r WHERE r.tenant_id=p.tenant_id AND r.setting_snapshot_id=p.setting_snapshot_id) AS rule_count,
      (SELECT count(*)::bigint FROM staging_item i WHERE i.tenant_id=p.tenant_id AND i.entity_id=p.entity_id AND i.setting_snapshot_id=p.setting_snapshot_id) AS staging_count,
      ((SELECT count(*) FROM wbs_payable_review_evidence x WHERE x.tenant_id=p.tenant_id AND x.entity_id=p.entity_id AND x.setting_snapshot_id=p.setting_snapshot_id)
       +(SELECT count(*) FROM wbs_cost_cwip_review_evidence x WHERE x.tenant_id=p.tenant_id AND x.entity_id=p.entity_id AND x.setting_snapshot_id=p.setting_snapshot_id)
       +(SELECT count(*) FROM wbs_property_rent_review_evidence x WHERE x.tenant_id=p.tenant_id AND x.entity_id=p.entity_id AND x.setting_snapshot_id=p.setting_snapshot_id)
       +(SELECT count(*) FROM insurance_prepaid_amortization_review x WHERE x.tenant_id=p.tenant_id AND x.entity_id=p.entity_id AND x.amortization_setting_snapshot_id=p.setting_snapshot_id))::bigint AS wbs_review_count,
      ((SELECT count(*) FROM ai_invoice_accounting_classification_evidence x WHERE x.tenant_id=p.tenant_id AND x.entity_id=p.entity_id AND x.policy_snapshot_id=p.setting_snapshot_id)
       +(SELECT count(*) FROM ai_invoice_capitalization_proposal x WHERE x.tenant_id=p.tenant_id AND x.entity_id=p.entity_id AND x.policy_snapshot_id=p.setting_snapshot_id)
       +(SELECT count(*) FROM ai_invoice_expense_proposal x WHERE x.tenant_id=p.tenant_id AND x.entity_id=p.entity_id AND x.policy_snapshot_id=p.setting_snapshot_id)
       +(SELECT count(*) FROM ai_vendor_invoice_amount_anomaly_finding x WHERE x.tenant_id=p.tenant_id AND x.entity_id=p.entity_id AND x.policy_snapshot_id=p.setting_snapshot_id)
       +(SELECT count(*) FROM ai_vendor_invoice_frequency_anomaly_finding x WHERE x.tenant_id=p.tenant_id AND x.entity_id=p.entity_id AND x.policy_snapshot_id=p.setting_snapshot_id)
       +(SELECT count(*) FROM ai_vendor_invoice_amount_drop_finding x WHERE x.tenant_id=p.tenant_id AND x.entity_id=p.entity_id AND x.policy_snapshot_id=p.setting_snapshot_id)
       +(SELECT count(*) FROM ai_vendor_invoice_near_duplicate_finding x WHERE x.tenant_id=p.tenant_id AND x.entity_id=p.entity_id AND x.policy_snapshot_id=p.setting_snapshot_id)
       +(SELECT count(*) FROM ai_manual_journal_risk_finding x WHERE x.tenant_id=p.tenant_id AND x.entity_id=p.entity_id AND x.policy_snapshot_id=p.setting_snapshot_id))::bigint AS ai_evidence_count
    FROM page p
  )
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'schema_version','AUTHORITATIVE_SETTING_HISTORY_ITEM_V1',
    'setting_snapshot_id',setting_snapshot_id,'family',family,'version',version,'status',status,
    'effective_from',to_char(effective_from AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    'effective_to',CASE WHEN effective_to IS NULL THEN NULL ELSE to_char(effective_to AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') END,
    'snapshot_hash',snapshot_hash,'lifecycle_revision',lifecycle_revision,
    'created_by',CASE WHEN created_by~*'(bearer[[:space:]]+|api[_-]?key|access[_-]?token|refresh[_-]?token|private[_-]?key|password[[:space:]]*[:=]|secret[[:space:]]*[:=]|(sk|rk|pk)-[a-z0-9_-]{8,})' THEN '[REDACTED]' ELSE created_by END,
    'approved_by',CASE WHEN approved_by~*'(bearer[[:space:]]+|api[_-]?key|access[_-]?token|refresh[_-]?token|private[_-]?key|password[[:space:]]*[:=]|secret[[:space:]]*[:=]|(sk|rk|pk)-[a-z0-9_-]{8,})' THEN '[REDACTED]' ELSE approved_by END,
    'approved_at',to_char(approved_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    'retirement',CASE WHEN status<>'RETIRED' THEN NULL ELSE jsonb_build_object(
      'retired_by',CASE WHEN retired_by~*'(bearer[[:space:]]+|api[_-]?key|access[_-]?token|refresh[_-]?token|private[_-]?key|password[[:space:]]*[:=]|secret[[:space:]]*[:=]|(sk|rk|pk)-[a-z0-9_-]{8,})' THEN '[REDACTED]' ELSE retired_by END,
      'retired_at',to_char(retired_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
      'reason_hash',refs_jsonb_hash(to_jsonb(retire_reason))) END,
    'reference_counts',jsonb_build_object(
      'entity_period_bindings',binding_count,'rule_evaluations',rule_count,'staging_items',staging_count,
      'wbs_reviews',wbs_review_count,'ai_evidence',ai_evidence_count,
      'total',binding_count+rule_count+staging_count+wbs_review_count+ai_evidence_count),
    'integrity_verified',true
  ) ORDER BY version DESC,setting_snapshot_id DESC),'[]'::jsonb),count(*)::integer
  INTO v_rows,v_read FROM evidence;

  IF v_has_more THEN
    SELECT (item->>'version')::bigint,(item->>'setting_snapshot_id')::uuid INTO v_next_version,v_next_id
      FROM jsonb_array_elements(v_rows) WITH ORDINALITY x(item,ordinality) ORDER BY ordinality DESC LIMIT 1;
  END IF;
  RETURN jsonb_build_object(
    'schema_version','AUTHORITATIVE_SETTING_HISTORY_PAGE_V1',
    'scope',jsonb_build_object('tenant_id',p_tenant,'entity_id',p_entity,'family',p_family),
    'total_count',v_total,'read_count',v_read,'items',v_rows,'has_more',v_has_more,
    'next_cursor',CASE WHEN v_next_id IS NULL THEN NULL ELSE jsonb_build_object('version',v_next_version,'setting_snapshot_id',v_next_id) END,
    'reference_classes',jsonb_build_array('ENTITY_PERIOD_BINDING','RULE_EVALUATION','STAGING_ITEM','WBS_REVIEW','AI_EVIDENCE'),
    'redaction',jsonb_build_object('snapshot_body_excluded',true,'retirement_reason_hashed',true,'credential_shaped_actor_redacted',true),
    'action_flags',jsonb_build_object('can_create_draft',false,'can_review',false,'can_approve',false,'can_post',false)
  );
END $$;

REVOKE ALL ON FUNCTION refs_read_authoritative_setting_history(uuid,uuid,text,integer,bigint,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION refs_read_authoritative_setting_history(uuid,uuid,text,integer,bigint,uuid) TO refs_app;

COMMIT;
