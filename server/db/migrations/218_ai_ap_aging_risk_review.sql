BEGIN;
CREATE FUNCTION refs_read_ai_ap_aging_risk_policy(p_tenant uuid,p_entity uuid,p_as_of date) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE selected setting_snapshot;match_count integer;expected_keys text[]:=ARRAY['minimum_open_amount','policy_version','rule_id','schema_version','stale_days'];
BEGIN
  PERFORM refs_assert_ai_analysis_scope(p_tenant,p_entity);IF p_as_of IS NULL THEN RAISE EXCEPTION 'AP aging policy date is required' USING ERRCODE='22004';END IF;
  SELECT count(*) INTO match_count FROM setting_snapshot WHERE tenant_id=p_tenant AND entity_id=p_entity AND family='AI_AP_AGING_RISK_POLICY' AND scope_type='ENTITY' AND scope_key=p_entity::text AND status='APPROVED' AND effective_from<=p_as_of::timestamptz AND(effective_to IS NULL OR effective_to>p_as_of::timestamptz);
  IF match_count=0 THEN RETURN NULL;END IF;IF match_count<>1 THEN RAISE EXCEPTION 'AI AP aging policy scope is ambiguous' USING ERRCODE='23514';END IF;
  SELECT * INTO selected FROM setting_snapshot WHERE tenant_id=p_tenant AND entity_id=p_entity AND family='AI_AP_AGING_RISK_POLICY' AND scope_type='ENTITY' AND scope_key=p_entity::text AND status='APPROVED' AND effective_from<=p_as_of::timestamptz AND(effective_to IS NULL OR effective_to>p_as_of::timestamptz) FOR SHARE;
  IF selected.snapshot_hash IS DISTINCT FROM refs_jsonb_hash(selected.snapshot) OR ARRAY(SELECT jsonb_object_keys(selected.snapshot) ORDER BY 1) IS DISTINCT FROM expected_keys OR selected.snapshot->>'schema_version'<>'AI_AP_AGING_RISK_POLICY_SNAPSHOT_V1' OR selected.snapshot->>'rule_id'<>'AI_AP_AGING_RISK_REVIEW_V1' OR jsonb_typeof(selected.snapshot->'policy_version')<>'number' OR (selected.snapshot->>'policy_version')::integer<1 OR jsonb_typeof(selected.snapshot->'stale_days')<>'number' OR (selected.snapshot->>'stale_days')::integer NOT BETWEEN 30 AND 730 OR coalesce(selected.snapshot->>'minimum_open_amount','')!~'^(0|[1-9][0-9]*)\.[0-9]{4}$' OR (selected.snapshot->>'minimum_open_amount')::numeric<=0 THEN RAISE EXCEPTION 'Approved AI AP aging risk policy is malformed or hash-invalid' USING ERRCODE='23514';END IF;
  RETURN (selected.snapshot-'schema_version'-'rule_id')||jsonb_build_object('setting_snapshot_id',selected.setting_snapshot_id,'setting_snapshot_hash',selected.snapshot_hash);
END;$$;

CREATE FUNCTION refs_read_ai_ap_aging_risk_source(p_tenant uuid,p_entity uuid,p_as_of date)
RETURNS TABLE(tenant_id uuid,entity_id uuid,business_document_id uuid,source_document_id uuid,source_payload_hash text,posted_journal_entry_id uuid,movement_kind text,document_number text,vendor_ref text,vendor_name text,currency char(3),aging_date date,open_amount numeric(20,4))
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
BEGIN
  PERFORM refs_assert_ai_analysis_scope(p_tenant,p_entity);IF p_as_of IS NULL THEN RAISE EXCEPTION 'AP aging date is required' USING ERRCODE='22004';END IF;
  RETURN QUERY WITH allocations AS(SELECT business_adjustment_id,COALESCE(sum(amount)FILTER(WHERE status='ACTIVE'),0)::numeric(20,4) active_amount FROM business_allocation WHERE tenant_id=p_tenant AND entity_id=p_entity GROUP BY business_adjustment_id)
  SELECT d.tenant_id,d.entity_id,d.business_document_id,d.source_document_id,s.payload_hash,d.posted_journal_entry_id,'AP_BILL'::text,d.document_number,d.counterparty_ref,d.counterparty_name,d.currency,COALESCE(d.due_date,d.accounting_date),d.open_balance::numeric(20,4)
  FROM business_document d LEFT JOIN source_document s ON s.tenant_id=d.tenant_id AND s.entity_id=d.entity_id AND s.source_document_id=d.source_document_id
  WHERE d.tenant_id=p_tenant AND d.entity_id=p_entity AND d.document_kind='AP_BILL' AND d.status NOT IN('DRAFT','PENDING_POST','VOID','REVERSED') AND d.accounting_date<=p_as_of AND d.open_balance>0 AND d.posted_journal_entry_id IS NOT NULL
  UNION ALL
  SELECT a.tenant_id,a.entity_id,a.business_adjustment_id,NULL::uuid,NULL::text,a.posted_journal_entry_id,'AP_VENDOR_CREDIT',a.business_adjustment_id::text,'VENDOR_CREDIT','Vendor credit',a.currency,a.accounting_date,(-a.amount+COALESCE(al.active_amount,0))::numeric(20,4)
  FROM business_adjustment a LEFT JOIN allocations al ON al.business_adjustment_id=a.business_adjustment_id
  WHERE a.tenant_id=p_tenant AND a.entity_id=p_entity AND a.adjustment_kind='AP_VENDOR_CREDIT' AND a.status='POSTED' AND a.accounting_date<=p_as_of AND a.amount-COALESCE(al.active_amount,0)>0 AND a.posted_journal_entry_id IS NOT NULL
  ORDER BY aging_date,business_document_id;
END;$$;
REVOKE ALL ON FUNCTION refs_read_ai_ap_aging_risk_policy(uuid,uuid,date),refs_read_ai_ap_aging_risk_source(uuid,uuid,date) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION refs_read_ai_ap_aging_risk_policy(uuid,uuid,date),refs_read_ai_ap_aging_risk_source(uuid,uuid,date) TO refs_app;
COMMIT;
