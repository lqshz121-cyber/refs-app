BEGIN;

CREATE FUNCTION refs_read_ai_vendor_monthly_spend_population(p_tenant uuid,p_entity uuid,p_period uuid)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE
  current_period accounting_period;
  approved_policy jsonb;
  selected_period_ids uuid[];
  population_count integer;
  valid_population_count integer;
  source_rows jsonb;
  admission_proofs jsonb;
  selected_periods jsonb;
BEGIN
  PERFORM refs_assert_ai_analysis_scope(p_tenant,p_entity);
  SELECT * INTO current_period FROM accounting_period
   WHERE tenant_id=p_tenant AND entity_id=p_entity AND period_id=p_period AND ledger_code='PRIMARY' FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Authoritative primary accounting period is unavailable' USING ERRCODE='22023'; END IF;
  approved_policy:=refs_read_ai_vendor_invoice_anomaly_policy(p_tenant,p_entity,p_period);
  IF approved_policy IS NULL THEN RAISE EXCEPTION 'Approved vendor anomaly policy is unavailable' USING ERRCODE='P0002'; END IF;

  SELECT array_prepend(p_period,array_agg(period_id ORDER BY starts_on,period_id)) INTO selected_period_ids
    FROM (SELECT period_id,starts_on FROM accounting_period
           WHERE tenant_id=p_tenant AND entity_id=p_entity AND ledger_code='PRIMARY' AND ends_on<current_period.starts_on
           ORDER BY ends_on DESC,starts_on DESC,period_id DESC
           LIMIT (approved_policy->>'minimum_history_periods')::integer) selected;
  IF selected_period_ids IS NULL OR selected_period_ids[1]<>p_period OR cardinality(selected_period_ids)<>((approved_policy->>'minimum_history_periods')::integer+1) THEN
    RAISE EXCEPTION 'Complete vendor anomaly history period window is unavailable' USING ERRCODE='P0002';
  END IF;
  SELECT jsonb_agg(jsonb_build_object('period_id',ap.period_id,'period_code',ap.period_code,'period_start',ap.starts_on,'period_end',ap.ends_on) ORDER BY ap.starts_on,ap.period_id)
    INTO selected_periods FROM accounting_period ap WHERE ap.tenant_id=p_tenant AND ap.entity_id=p_entity AND ap.ledger_code='PRIMARY' AND ap.period_id=ANY(selected_period_ids);

  SELECT count(*) INTO population_count
    FROM wbs_final1_retained_source_row r
    JOIN raw_event e ON e.tenant_id=r.tenant_id AND e.entity_id=r.entity_id AND e.raw_event_id=r.raw_event_id AND e.source_record_id=r.source_record_id AND e.source_version=r.source_version AND e.is_current
   WHERE r.tenant_id=p_tenant AND r.entity_id=p_entity AND r.domain='PAYABLES' AND r.accounting_period_id=ANY(selected_period_ids);
  IF population_count>2000 THEN RAISE EXCEPTION 'Complete vendor monthly-spend population exceeds 2000 retained lines' USING ERRCODE='54000'; END IF;

  WITH exact_rows AS (
    SELECT r,d,l,ap,a,c
      FROM wbs_final1_retained_source_row r
      JOIN raw_event e ON e.tenant_id=r.tenant_id AND e.entity_id=r.entity_id AND e.raw_event_id=r.raw_event_id AND e.source_record_id=r.source_record_id AND e.source_version=r.source_version AND e.is_current
      JOIN wbs_final1_retained_evidence_admission a ON a.tenant_id=r.tenant_id AND a.entity_id=r.entity_id AND a.wbs_final1_retained_evidence_admission_id=r.wbs_final1_retained_evidence_admission_id AND a.domain=r.domain AND a.algorithm='Ed25519'
      JOIN wbs_final1_signed_control_total c ON c.tenant_id=a.tenant_id AND c.entity_id=a.entity_id AND c.wbs_final1_retained_evidence_admission_id=a.wbs_final1_retained_evidence_admission_id AND c.domain='PAYABLES'
      JOIN accounting_period ap ON ap.tenant_id=r.tenant_id AND ap.entity_id=r.entity_id AND ap.period_id=r.accounting_period_id AND ap.ledger_code='PRIMARY'
      JOIN source_document d ON d.tenant_id=r.tenant_id AND d.entity_id=r.entity_id AND d.source_document_id=r.source_document_id AND d.raw_event_id=e.raw_event_id AND d.source_record_id=r.source_record_id AND d.source_version=r.source_version AND d.source_system='WBS' AND d.source_module='payable' AND d.document_type='WBS_FINAL1_PAYABLE' AND d.payload_hash=r.raw_row_hash
      JOIN source_document_line l ON l.tenant_id=r.tenant_id AND l.entity_id=r.entity_id AND l.source_document_id=r.source_document_id AND l.source_document_line_id=r.source_document_line_id
     WHERE r.tenant_id=p_tenant AND r.entity_id=p_entity AND r.domain='PAYABLES' AND r.accounting_period_id=ANY(selected_period_ids)
       AND l.external_dimension_refs->>'schema_version'='WBS_FINAL1_RETAINED_SOURCE_LINE_V1'
       AND l.external_dimension_refs->>'domain'='PAYABLES'
       AND l.external_dimension_refs->>'snapshot_id'=a.snapshot_id::text
       AND l.external_dimension_refs->>'package_hash'=a.package_hash
       AND l.external_dimension_refs->>'raw_row_hash'=r.raw_row_hash
       AND l.external_dimension_refs->>'accounting_period_id'=r.accounting_period_id::text
       AND l.external_dimension_refs->>'accounting_period_resolution'='EXACT_PRIMARY_PERIOD'
       AND l.external_dimension_refs ?& ARRAY['source_surface','signed_invoice_no','signed_invoice_date','signed_business_id','signed_charge_code']
       AND l.external_dimension_refs->'source_surface'=jsonb_build_object('database','wbsdata','table','account_book_payable_info')
       AND d.document_no IS NOT DISTINCT FROM NULLIF(l.external_dimension_refs->>'signed_invoice_no','')
  )
  SELECT count(*),COALESCE(jsonb_agg(jsonb_build_object(
      'source_document_id',(x.d).source_document_id,'source_document_line_id',(x.l).source_document_line_id,
      'source_payload_hash',(x.d).payload_hash,'source_line_hash',(x.r).raw_row_hash,'entity_id',p_entity,
      'accounting_period_id',(x.r).accounting_period_id,'vendor_ref',(x.l).party_ref,'vendor_name',(x.l).party_ref,
      'currency',(x.d).currency::text,'amount',to_char(round(abs((x.l).amount),4),'FM999999999999999990.0000'),
      'invoice_date',(x.l).external_dimension_refs->'signed_invoice_date','project_ref',to_jsonb((x.l).project_ref),
      'property_ref',to_jsonb((x.l).property_ref),'cost_category_ref',to_jsonb(NULLIF((x.l).external_dimension_refs->>'signed_charge_code','')),
      'retained_outcome',(x.r).outcome,'exception_codes',(x.r).exception_codes,
      'source_admission_status','ADMITTED','signature_verified',true
    ) ORDER BY (x.ap).starts_on,(x.d).source_document_id,(x.l).line_no,(x.l).source_document_line_id),'[]'::jsonb)
    INTO valid_population_count,source_rows FROM exact_rows x;
  IF valid_population_count<>population_count OR jsonb_array_length(source_rows)<>population_count THEN RAISE EXCEPTION 'Vendor monthly-spend retained population is incomplete or drifted' USING ERRCODE='23514'; END IF;

  SELECT COALESCE(jsonb_agg(jsonb_build_object('admission_id',a.wbs_final1_retained_evidence_admission_id,'snapshot_id',a.snapshot_id,'request_hash',a.request_hash,'package_hash',a.package_hash,'package_raw_hash',a.package_raw_hash,'control_totals_hash',c.control_totals_hash,'row_count',a.row_count) ORDER BY a.wbs_final1_retained_evidence_admission_id),'[]'::jsonb)
    INTO admission_proofs
    FROM wbs_final1_retained_evidence_admission a
    JOIN wbs_final1_signed_control_total c ON c.tenant_id=a.tenant_id AND c.entity_id=a.entity_id AND c.wbs_final1_retained_evidence_admission_id=a.wbs_final1_retained_evidence_admission_id AND c.domain='PAYABLES'
   WHERE a.tenant_id=p_tenant AND a.entity_id=p_entity AND a.domain='PAYABLES'
     AND a.row_count=(c.control_totals->>'row_count')::integer
     AND a.row_count=(SELECT count(*) FROM wbs_final1_retained_source_row all_rows WHERE all_rows.tenant_id=a.tenant_id AND all_rows.entity_id=a.entity_id AND all_rows.wbs_final1_retained_evidence_admission_id=a.wbs_final1_retained_evidence_admission_id)
     AND EXISTS(SELECT 1 FROM wbs_final1_retained_source_row r JOIN raw_event e ON e.tenant_id=r.tenant_id AND e.entity_id=r.entity_id AND e.raw_event_id=r.raw_event_id AND e.is_current WHERE r.tenant_id=a.tenant_id AND r.entity_id=a.entity_id AND r.wbs_final1_retained_evidence_admission_id=a.wbs_final1_retained_evidence_admission_id AND r.accounting_period_id=ANY(selected_period_ids));

  IF jsonb_array_length(admission_proofs)<>(SELECT count(DISTINCT r.wbs_final1_retained_evidence_admission_id) FROM wbs_final1_retained_source_row r JOIN raw_event e ON e.tenant_id=r.tenant_id AND e.entity_id=r.entity_id AND e.raw_event_id=r.raw_event_id AND e.is_current WHERE r.tenant_id=p_tenant AND r.entity_id=p_entity AND r.domain='PAYABLES' AND r.accounting_period_id=ANY(selected_period_ids)) THEN RAISE EXCEPTION 'Vendor monthly-spend admission controls are incomplete' USING ERRCODE='23514'; END IF;
  RETURN jsonb_build_object('schema_version','AI_VENDOR_MONTHLY_SPEND_SOURCE_POPULATION_V1','current_accounting_period_id',p_period,'selected_period_ids',to_jsonb(selected_period_ids),'selected_periods',selected_periods,'history_period_count',cardinality(selected_period_ids)-1,'population_line_count',population_count,'population_complete',true,'admission_proofs',admission_proofs,'approved_policy',approved_policy,'rows',source_rows,'action_flags',jsonb_build_object('can_create_draft',false,'can_review',false,'can_approve',false,'can_post',false));
END; $$;

REVOKE ALL ON FUNCTION refs_read_ai_vendor_monthly_spend_population(uuid,uuid,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION refs_read_ai_vendor_monthly_spend_population(uuid,uuid,uuid) TO refs_app;
COMMIT;
