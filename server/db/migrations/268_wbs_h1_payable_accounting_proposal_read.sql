BEGIN;

CREATE FUNCTION refs_read_wbs_h1_payable_accounting_proposal(
  p_tenant uuid,p_entity uuid,p_period uuid,p_limit integer,p_offset integer
) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE result jsonb; settings_proposal jsonb; settings_decision jsonb;
BEGIN
  PERFORM refs_assert_scope(p_tenant,p_entity,'WBS.AUTOREC.VIEW');
  IF p_limit NOT BETWEEN 1 AND 200 OR p_offset<0 THEN
    RAISE EXCEPTION 'WBS H1 Payable proposal page is invalid' USING ERRCODE='22023';
  END IF;

  settings_proposal:=refs_read_wbs_h1_accounting_settings_proposal(p_tenant,p_entity,p_period);
  settings_decision:=refs_read_wbs_h1_accounting_settings_decision(
    p_tenant,p_entity,p_period,settings_proposal->>'proposal_hash');

  WITH scope AS (
    SELECT e.entity_code company_code,e.base_currency::text currency,p.period_code,
      p.starts_on,p.ends_on
    FROM entity e JOIN accounting_period p
      ON p.tenant_id=e.tenant_id AND p.entity_id=e.entity_id
    WHERE e.tenant_id=p_tenant AND e.entity_id=p_entity AND e.active
      AND e.source_system='WBS' AND e.source_entity_id=e.entity_code
      AND p.period_id=p_period AND p.ledger_code='PRIMARY'
  ), source_rows AS (
    SELECT s.*,coalesce(c.cost_code,s.cost_code) exact_cost_code
    FROM wbs_h1_payable_mapping_source_stage s
    JOIN scope x ON x.company_code=s.company_code AND x.period_code=s.period_code
    LEFT JOIN wbs_h1_payable_cost_code_stage c
      ON (c.tenant_id,c.entity_id,c.source_record_hash)=(s.tenant_id,s.entity_id,s.source_record_hash)
    WHERE s.tenant_id=p_tenant AND s.entity_id=p_entity
      AND s.accounting_date BETWEEN x.starts_on AND x.ends_on
  ), matched AS (
    SELECT s.*,
      d.match_count debit_match_count,d.setting_id debit_setting_id,d.setting_hash debit_setting_hash,
      d.journal_code debit_account_code,d.account_name debit_account_name,d.supplementary debit_supplementary,
      cr.match_count credit_match_count,cr.setting_id credit_setting_id,cr.setting_hash credit_setting_hash,
      cr.journal_code credit_account_code,cr.account_name credit_account_name,cr.supplementary credit_supplementary
    FROM source_rows s
    LEFT JOIN LATERAL (
      SELECT count(*)::integer match_count,min(r.setting_id) setting_id,min(r.setting_hash) setting_hash,
        min(r.journal_code) journal_code,min(r.account_name) account_name,min(r.supplementary) supplementary
      FROM wbs_h1_accounting_setting_stage r
      WHERE r.tenant_id=s.tenant_id AND r.company_code=s.company_code
        AND r.business_type=4 AND r.category='Payable' AND r.setting_type='Debit'
        AND r.detail=coalesce(s.exact_cost_code,'')
        AND (r.project_codes='' OR s.project_code=ANY(regexp_split_to_array(r.project_codes,'\s*,\s*')))
        AND s.accounting_date BETWEEN r.effective_from AND r.effective_to
    ) d ON true
    LEFT JOIN LATERAL (
      SELECT count(*)::integer match_count,min(r.setting_id) setting_id,min(r.setting_hash) setting_hash,
        min(r.journal_code) journal_code,min(r.account_name) account_name,min(r.supplementary) supplementary
      FROM wbs_h1_accounting_setting_stage r
      WHERE r.tenant_id=s.tenant_id AND r.company_code=s.company_code
        AND r.business_type=4 AND r.category='Payable' AND r.setting_type='Credit'
        AND (r.detail='' OR r.detail=coalesce(s.exact_cost_code,''))
        AND (r.project_codes='' OR s.project_code=ANY(regexp_split_to_array(r.project_codes,'\s*,\s*')))
        AND s.accounting_date BETWEEN r.effective_from AND r.effective_to
    ) cr ON true
  ), classified AS (
    SELECT m.*,
      da.active debit_active,da.requires_member debit_requires_member,da.required_member_type::text debit_member_type,
      ca.active credit_active,ca.requires_member credit_requires_member,ca.required_member_type::text credit_member_type,
      EXISTS(SELECT 1 FROM member_master vm WHERE vm.tenant_id=p_tenant AND vm.entity_id=p_entity
        AND vm.member_ref=m.vendor_no AND vm.member_type='VENDOR' AND vm.active) vendor_ready,
      array_remove(ARRAY[
        CASE WHEN settings_decision IS NULL OR settings_decision->>'outcome'<>'APPROVED' THEN 'SETTINGS_NOT_APPROVED' END,
        CASE WHEN m.exact_cost_code IS NULL THEN 'COST_CODE_MISSING' END,
        CASE WHEN m.project_code IS NULL AND (m.debit_supplementary='Project' OR m.credit_supplementary='Project') THEN 'PROJECT_MISSING' END,
        CASE WHEN m.vendor_no IS NULL THEN 'VENDOR_MISSING' END,
        CASE WHEN m.debit_match_count=0 THEN 'DEBIT_MAPPING_MISSING' WHEN m.debit_match_count>1 THEN 'DEBIT_MAPPING_AMBIGUOUS' END,
        CASE WHEN m.credit_match_count=0 THEN 'CREDIT_MAPPING_MISSING' WHEN m.credit_match_count>1 THEN 'CREDIT_MAPPING_AMBIGUOUS' END,
        CASE WHEN m.debit_match_count=1 AND (m.debit_account_code='' OR da.account_code IS NULL OR NOT da.active) THEN 'DEBIT_ACCOUNT_NOT_READY' END,
        CASE WHEN m.credit_match_count=1 AND (m.credit_account_code='' OR ca.account_code IS NULL OR NOT ca.active) THEN 'CREDIT_ACCOUNT_NOT_READY' END,
        CASE WHEN m.debit_match_count=1 AND da.requires_member AND da.required_member_type<>'VENDOR' THEN 'DEBIT_MEMBER_POLICY_UNSUPPORTED' END,
        CASE WHEN m.credit_match_count=1 AND ca.requires_member AND ca.required_member_type<>'VENDOR' THEN 'CREDIT_MEMBER_POLICY_UNSUPPORTED' END,
        CASE WHEN ((da.requires_member AND da.required_member_type='VENDOR') OR (ca.requires_member AND ca.required_member_type='VENDOR'))
          AND NOT EXISTS(SELECT 1 FROM member_master vm WHERE vm.tenant_id=p_tenant AND vm.entity_id=p_entity
            AND vm.member_ref=m.vendor_no AND vm.member_type='VENDOR' AND vm.active) THEN 'VENDOR_MEMBER_NOT_READY' END,
        CASE WHEN m.debit_match_count=1 AND m.debit_supplementary NOT IN ('','Vendor','Project') THEN 'DEBIT_DIMENSION_UNSUPPORTED' END,
        CASE WHEN m.credit_match_count=1 AND m.credit_supplementary NOT IN ('','Vendor','Project') THEN 'CREDIT_DIMENSION_UNSUPPORTED' END
      ],NULL)::text[] exception_codes
    FROM matched m
    LEFT JOIN account_master da ON da.tenant_id=p_tenant AND da.entity_id=p_entity AND da.account_code=m.debit_account_code
    LEFT JOIN account_master ca ON ca.tenant_id=p_tenant AND ca.entity_id=p_entity AND ca.account_code=m.credit_account_code
  ), shaped AS (
    SELECT c.*,
      CASE WHEN cardinality(exception_codes)=0 THEN 'READY_FOR_CONTROLLER_REVIEW' ELSE 'EXCEPTION' END row_status,
      CASE WHEN cardinality(exception_codes)=0 THEN
        CASE WHEN amount>0 THEN jsonb_build_array(
          jsonb_build_object('line_number',1,'side','DEBIT','account_code',debit_account_code,'account_name',debit_account_name,
            'amount',to_char(amount,'FM999999999999990.0000'),'member_ref',CASE WHEN debit_requires_member THEN vendor_no END,
            'project_ref',CASE WHEN debit_supplementary='Project' THEN project_code END,'cost_code_ref',exact_cost_code),
          jsonb_build_object('line_number',2,'side','CREDIT','account_code',credit_account_code,'account_name',credit_account_name,
            'amount',to_char(amount,'FM999999999999990.0000'),'member_ref',CASE WHEN credit_requires_member THEN vendor_no END,
            'project_ref',CASE WHEN credit_supplementary='Project' THEN project_code END,'cost_code_ref',NULL)
        ) ELSE jsonb_build_array(
          jsonb_build_object('line_number',1,'side','DEBIT','account_code',credit_account_code,'account_name',credit_account_name,
            'amount',to_char(abs(amount),'FM999999999999990.0000'),'member_ref',CASE WHEN credit_requires_member THEN vendor_no END,
            'project_ref',CASE WHEN credit_supplementary='Project' THEN project_code END,'cost_code_ref',NULL),
          jsonb_build_object('line_number',2,'side','CREDIT','account_code',debit_account_code,'account_name',debit_account_name,
            'amount',to_char(abs(amount),'FM999999999999990.0000'),'member_ref',CASE WHEN debit_requires_member THEN vendor_no END,
            'project_ref',CASE WHEN debit_supplementary='Project' THEN project_code END,'cost_code_ref',exact_cost_code)
        ) END ELSE '[]'::jsonb END proposed_lines
    FROM classified c
  ), row_docs AS (
    SELECT s.*,(jsonb_build_object(
      'source_record_hash',source_record_hash,'wbs_uuid',wbs_uuid,'accounting_date',accounting_date::text,
      'amount',to_char(amount,'FM999999999999990.0000'),'project_code',project_code,'cost_code',exact_cost_code,
      'vendor_no',vendor_no,'status',row_status,'exception_codes',to_jsonb(exception_codes),
      'debit_setting_id',debit_setting_id::text,'debit_setting_hash',debit_setting_hash,
      'credit_setting_id',credit_setting_id::text,'credit_setting_hash',credit_setting_hash,
      'proposed_lines',proposed_lines,'report_impact',CASE WHEN row_status='READY_FOR_CONTROLLER_REVIEW'
        THEN jsonb_build_object('trial_balance',true,'profit_and_loss',left(debit_account_code,1) IN ('4','5','6','7','8','9'),
          'balance_sheet',left(debit_account_code,1) IN ('1','2','3'),'cash_flow','CLASSIFICATION_REQUIRED') ELSE '{}'::jsonb END,
      'can_create_draft',false,'can_review',false,'can_approve',false,'can_post',false
    )) row_core
    FROM shaped s
  ), totals AS (
    SELECT count(*)::integer source_record_count,
      count(*) FILTER(WHERE row_status='READY_FOR_CONTROLLER_REVIEW')::integer ready_count,
      count(*) FILTER(WHERE row_status='EXCEPTION')::integer exception_count
    FROM row_docs
  ), page AS (
    SELECT row_core||jsonb_build_object('proposal_hash',refs_jsonb_hash(row_core)) row_doc
    FROM row_docs ORDER BY accounting_date,source_record_hash LIMIT p_limit OFFSET p_offset
  ), assembled AS (
    SELECT jsonb_build_object('schema_version','WBS_H1_PAYABLE_ACCOUNTING_PROPOSAL_V1',
      'company_code',x.company_code,'currency',x.currency,'period_id',p_period,'period_code',x.period_code,
      'period_start',x.starts_on::text,'period_end',x.ends_on::text,
      'settings_proposal_hash',settings_proposal->>'proposal_hash',
      'settings_decision_hash',settings_decision->>'decision_hash',
      'settings_outcome',coalesce(settings_decision->>'outcome','NOT_DECIDED'),
      'source_record_count',t.source_record_count,'ready_count',t.ready_count,'exception_count',t.exception_count,
      'limit',p_limit,'offset',p_offset,'rows',coalesce((SELECT jsonb_agg(row_doc) FROM page),'[]'::jsonb),
      'source_mode','REAL_WBS_STAGED','accounting_authority','PROPOSAL_ONLY',
      'can_create_draft',false,'can_review',false,'can_approve',false,'can_post',false) core
    FROM scope x CROSS JOIN totals t
  )
  SELECT core||jsonb_build_object('proposal_hash',refs_jsonb_hash(core)) INTO result FROM assembled;

  IF result IS NULL THEN RAISE EXCEPTION 'WBS H1 Payable proposal scope is unavailable' USING ERRCODE='P0002'; END IF;
  RETURN result;
END $$;

REVOKE ALL ON FUNCTION refs_read_wbs_h1_payable_accounting_proposal(uuid,uuid,uuid,integer,integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION refs_read_wbs_h1_payable_accounting_proposal(uuid,uuid,uuid,integer,integer) TO refs_app;

COMMIT;
