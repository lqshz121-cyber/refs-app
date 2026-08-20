BEGIN;
CREATE FUNCTION refs_read_ai_balance_sheet_aging_policy(p_tenant uuid,p_entity uuid,p_period uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE period_end date;selected setting_snapshot;match_count integer;expected_keys text[]:=ARRAY['dormant_days','minimum_absolute_balance','policy_version','rule_id','schema_version'];
BEGIN
  PERFORM refs_assert_ai_analysis_scope(p_tenant,p_entity);
  SELECT ends_on INTO period_end FROM accounting_period WHERE tenant_id=p_tenant AND entity_id=p_entity AND period_id=p_period;
  IF NOT FOUND THEN RAISE EXCEPTION 'Accounting period is outside balance-sheet aging policy scope' USING ERRCODE='22023';END IF;
  SELECT count(*) INTO match_count FROM setting_snapshot WHERE tenant_id=p_tenant AND entity_id=p_entity AND family='AI_BALANCE_SHEET_AGING_POLICY' AND scope_type='ENTITY' AND scope_key=p_entity::text AND status='APPROVED' AND effective_from<=period_end::timestamptz AND(effective_to IS NULL OR effective_to>period_end::timestamptz);
  IF match_count=0 THEN RETURN NULL;END IF;IF match_count<>1 THEN RAISE EXCEPTION 'AI balance-sheet aging policy scope is ambiguous' USING ERRCODE='23514';END IF;
  SELECT * INTO selected FROM setting_snapshot WHERE tenant_id=p_tenant AND entity_id=p_entity AND family='AI_BALANCE_SHEET_AGING_POLICY' AND scope_type='ENTITY' AND scope_key=p_entity::text AND status='APPROVED' AND effective_from<=period_end::timestamptz AND(effective_to IS NULL OR effective_to>period_end::timestamptz) FOR SHARE;
  IF selected.snapshot_hash IS DISTINCT FROM refs_jsonb_hash(selected.snapshot) OR ARRAY(SELECT jsonb_object_keys(selected.snapshot) ORDER BY 1) IS DISTINCT FROM expected_keys OR selected.snapshot->>'schema_version'<>'AI_BALANCE_SHEET_AGING_POLICY_SNAPSHOT_V1' OR selected.snapshot->>'rule_id'<>'AI_BALANCE_SHEET_DORMANT_NONZERO_BALANCE_V1' OR jsonb_typeof(selected.snapshot->'policy_version')<>'number' OR (selected.snapshot->>'policy_version')::integer<1 OR jsonb_typeof(selected.snapshot->'dormant_days')<>'number' OR (selected.snapshot->>'dormant_days')::integer NOT BETWEEN 30 AND 3650 OR coalesce(selected.snapshot->>'minimum_absolute_balance','')!~'^(0|[1-9][0-9]*)\.[0-9]{4}$' OR (selected.snapshot->>'minimum_absolute_balance')::numeric<=0 THEN RAISE EXCEPTION 'Approved AI balance-sheet aging policy is malformed or hash-invalid' USING ERRCODE='23514';END IF;
  RETURN (selected.snapshot-'schema_version'-'rule_id')||jsonb_build_object('setting_snapshot_id',selected.setting_snapshot_id,'setting_snapshot_hash',selected.snapshot_hash);
END;$$;

CREATE FUNCTION refs_read_ai_balance_sheet_account_aging_source(p_tenant uuid,p_entity uuid,p_period uuid)
RETURNS TABLE(tenant_id uuid,entity_id uuid,accounting_period_id uuid,period_end date,account_class text,account_code text,account_name text,currency text,ending_balance text,last_activity_date date,journal_entry_ids uuid[],journal_line_ids uuid[],ledger_line_ids uuid[],source_document_ids uuid[])
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
BEGIN
  PERFORM refs_assert_ai_analysis_scope(p_tenant,p_entity);
  IF NOT EXISTS(SELECT 1 FROM accounting_period WHERE tenant_id=p_tenant AND entity_id=p_entity AND period_id=p_period) THEN RAISE EXCEPTION 'Accounting period is outside balance-sheet aging source scope' USING ERRCODE='22023';END IF;
  RETURN QUERY WITH selected AS(
    SELECT period_id,ends_on FROM accounting_period WHERE tenant_id=p_tenant AND entity_id=p_entity AND period_id=p_period
  ),balances AS(
    SELECT l.account_code,l.currency::text,COALESCE(a.account_name,'Unmapped account') account_name,
      CASE WHEN l.account_code LIKE '1%' THEN 'ASSET' WHEN l.account_code LIKE '2%' THEN 'LIABILITY' WHEN l.account_code LIKE '3%' THEN 'EQUITY' END account_class,
      sum(l.debit_amount-l.credit_amount)::numeric(20,4) balance,max(j.journal_date) last_activity,
      array_agg(DISTINCT l.journal_entry_id ORDER BY l.journal_entry_id) je_ids,array_agg(DISTINCT l.journal_line_id ORDER BY l.journal_line_id) jl_ids,array_agg(DISTINCT l.ledger_line_id ORDER BY l.ledger_line_id) ll_ids
    FROM ledger_line l JOIN journal_entry j ON j.tenant_id=l.tenant_id AND j.entity_id=l.entity_id AND j.journal_entry_id=l.journal_entry_id CROSS JOIN selected p
    LEFT JOIN account_master a ON a.tenant_id=l.tenant_id AND a.entity_id=l.entity_id AND a.account_code=l.account_code AND a.active
    WHERE l.tenant_id=p_tenant AND l.entity_id=p_entity AND j.status='POSTED' AND j.journal_date<=p.ends_on AND l.account_code~'^[123]'
    GROUP BY l.account_code,l.currency,a.account_name HAVING sum(l.debit_amount-l.credit_amount)<>0
  ) SELECT p_tenant,p_entity,p.period_id,p.ends_on,b.account_class,b.account_code,b.account_name,b.currency,to_char(b.balance,'FM999999999999990.0000'),b.last_activity,b.je_ids,b.jl_ids,b.ll_ids,
    ARRAY(SELECT DISTINCT s.source_document_id FROM source_link s WHERE s.tenant_id=p_tenant AND s.entity_id=p_entity AND s.source_document_id IS NOT NULL AND s.journal_entry_id=ANY(b.je_ids) ORDER BY s.source_document_id)::uuid[]
  FROM balances b CROSS JOIN selected p ORDER BY b.account_code,b.currency;
END;$$;
REVOKE ALL ON FUNCTION refs_read_ai_balance_sheet_aging_policy(uuid,uuid,uuid),refs_read_ai_balance_sheet_account_aging_source(uuid,uuid,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION refs_read_ai_balance_sheet_aging_policy(uuid,uuid,uuid),refs_read_ai_balance_sheet_account_aging_source(uuid,uuid,uuid) TO refs_app;
COMMIT;
