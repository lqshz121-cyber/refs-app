BEGIN;

CREATE FUNCTION refs_read_wbs_h1_accounting_settings_proposal(
  p_tenant uuid,p_entity uuid,p_period uuid
) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE result jsonb;
BEGIN
  PERFORM refs_assert_scope(p_tenant,p_entity,'WBS.AUTOREC.VIEW');

  WITH scope AS (
    SELECT e.entity_code AS company_code,e.base_currency AS currency,
      p.period_id,p.period_code,p.starts_on,p.ends_on
    FROM entity e
    JOIN accounting_period p ON p.tenant_id=e.tenant_id AND p.entity_id=e.entity_id
    WHERE e.tenant_id=p_tenant AND e.entity_id=p_entity AND e.active
      AND e.source_system='WBS' AND e.source_entity_id=e.entity_code
      AND p.period_id=p_period AND p.ledger_code='PRIMARY'
  ), settings AS (
    SELECT r.*,a.account_code IS NOT NULL AS account_ready,
      (SELECT count(DISTINCT nullif(other.journal_code,''))
       FROM wbs_h1_accounting_setting_stage other
       WHERE other.tenant_id=r.tenant_id AND other.company_code=r.company_code
         AND other.business_type=r.business_type AND other.category=r.category
         AND other.setting_type=r.setting_type AND other.detail=r.detail
         AND other.project_codes=r.project_codes AND other.effective_from=r.effective_from
         AND other.effective_to=r.effective_to) AS selector_account_count
    FROM wbs_h1_accounting_setting_stage r
    JOIN scope s ON s.company_code=r.company_code
    LEFT JOIN account_master a ON a.tenant_id=p_tenant AND a.entity_id=p_entity
      AND a.account_code=r.journal_code AND a.active
    WHERE r.tenant_id=p_tenant AND r.business_type=4 AND r.category='Payable'
      AND r.setting_type='Debit' AND r.effective_from<=s.starts_on AND r.effective_to>=s.ends_on
  ), rules AS (
    SELECT setting_id,setting_hash,detail,project_codes,journal_code,account_name,supplementary,
      effective_from,effective_to,
      CASE WHEN journal_code='' AND detail='' THEN 'BLOCKED_DEFAULT'
           WHEN journal_code='' THEN 'MAPPING_MISSING'
           WHEN NOT account_ready THEN 'ACCOUNT_NOT_READY'
           WHEN selector_account_count>1 THEN 'MAPPING_AMBIGUOUS'
           ELSE 'READY_FOR_HUMAN_REVIEW' END AS decision
    FROM settings
  ), assembled AS (
    SELECT jsonb_build_object(
      'schema_version','WBS_H1_ACCOUNTING_SETTINGS_PROPOSAL_V1',
      'status',CASE WHEN count(*) FILTER(WHERE decision IN ('MAPPING_MISSING','ACCOUNT_NOT_READY','MAPPING_AMBIGUOUS'))>0 THEN 'EXCEPTION' ELSE 'READY_FOR_HUMAN_REVIEW' END,
      'company_code',s.company_code,'currency',s.currency,'period_id',s.period_id,
      'period_code',s.period_code,'period_start',s.starts_on::text,'period_end',s.ends_on::text,
      'source_setting_count',count(r.setting_id)::integer,
      'ready_rule_count',count(*) FILTER(WHERE r.decision='READY_FOR_HUMAN_REVIEW')::integer,
      'blocked_rule_count',count(*) FILTER(WHERE r.decision='BLOCKED_DEFAULT')::integer,
      'exception_count',count(*) FILTER(WHERE r.decision IN ('MAPPING_MISSING','ACCOUNT_NOT_READY','MAPPING_AMBIGUOUS'))::integer,
      'rules',coalesce(jsonb_agg(jsonb_build_object(
        'rule_id','WBS-'||r.setting_id::text,'wbs_setting_id',r.setting_id::text,
        'source_setting_hash',r.setting_hash,'selection_mode',CASE WHEN r.detail='' THEN 'BLOCKED_DEFAULT' ELSE 'COST_CODE' END,
        'decision',r.decision,'detail',r.detail,
        'project_codes',CASE WHEN r.project_codes='' THEN '[]'::jsonb ELSE to_jsonb(regexp_split_to_array(r.project_codes,'\s*,\s*')) END,
        'account_code',nullif(r.journal_code,''),'account_name',nullif(r.account_name,''),
        'supplementary',nullif(r.supplementary,''),'effective_from',r.effective_from::text,'effective_to',r.effective_to::text
      ) ORDER BY r.setting_id) FILTER(WHERE r.setting_id IS NOT NULL),'[]'::jsonb),
      'source_mode','REAL_WBS_STAGED','accounting_authority','NONE',
      'can_create_draft',false,'can_review',false,'can_approve',false,'can_post',false
    ) AS core
    FROM scope s LEFT JOIN rules r ON true
    GROUP BY s.company_code,s.currency,s.period_id,s.period_code,s.starts_on,s.ends_on
  )
  SELECT core||jsonb_build_object('proposal_hash',refs_jsonb_hash(core)) INTO result FROM assembled;

  IF result IS NULL THEN RAISE EXCEPTION 'WBS H1 Settings proposal scope is unavailable' USING ERRCODE='P0002'; END IF;
  RETURN result;
END $$;

REVOKE ALL ON FUNCTION refs_read_wbs_h1_accounting_settings_proposal(uuid,uuid,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION refs_read_wbs_h1_accounting_settings_proposal(uuid,uuid,uuid) TO refs_app;

COMMIT;
