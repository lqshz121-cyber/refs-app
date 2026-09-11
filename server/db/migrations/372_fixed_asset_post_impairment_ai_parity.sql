BEGIN;

DO $$
DECLARE source_definition text;reconciliation_definition text;retained_definition text;
BEGIN
 IF to_regprocedure('refs_read_ai_fixed_asset_depreciation_source_pre_372(uuid,uuid,uuid)') IS NOT NULL
  OR to_regprocedure('refs_read_ai_fixed_asset_posted_reconciliation_pre_372(uuid,uuid,uuid)') IS NOT NULL THEN
  RAISE EXCEPTION 'Retained fixed asset AI functions already exist' USING ERRCODE='55000';
 END IF;
 source_definition:=pg_get_functiondef('refs_read_ai_fixed_asset_depreciation_source(uuid,uuid,uuid)'::regprocedure);
 reconciliation_definition:=pg_get_functiondef('refs_read_ai_fixed_asset_posted_reconciliation(uuid,uuid,uuid)'::regprocedure);
 IF source_definition NOT LIKE '%expected_net_book_value%' OR source_definition LIKE '%AI_FIXED_ASSET_DEPRECIATION_SOURCE_V2%' THEN RAISE EXCEPTION 'Unexpected fixed asset depreciation AI source predecessor' USING ERRCODE='55000';END IF;
 IF reconciliation_definition NOT LIKE '%ASSET_ID_BOUND_POSTED%' OR reconciliation_definition LIKE '%AI_FIXED_ASSET_POSTED_RECONCILIATION_V2%' THEN RAISE EXCEPTION 'Unexpected fixed asset depreciation AI reconciliation predecessor' USING ERRCODE='55000';END IF;
 retained_definition:=replace(source_definition,'public.refs_read_ai_fixed_asset_depreciation_source(','public.refs_read_ai_fixed_asset_depreciation_source_pre_372(');
 IF retained_definition=source_definition THEN RAISE EXCEPTION 'Unable to retain fixed asset depreciation AI source' USING ERRCODE='55000';END IF;
 EXECUTE retained_definition;
 retained_definition:=replace(reconciliation_definition,'public.refs_read_ai_fixed_asset_posted_reconciliation(','public.refs_read_ai_fixed_asset_posted_reconciliation_pre_372(');
 IF retained_definition=reconciliation_definition THEN RAISE EXCEPTION 'Unable to retain fixed asset depreciation AI reconciliation' USING ERRCODE='55000';END IF;
 EXECUTE retained_definition;
END $$;

CREATE OR REPLACE FUNCTION refs_read_ai_fixed_asset_depreciation_source(p_tenant uuid,p_entity uuid,p_period uuid) RETURNS SETOF jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE asset fixed_asset_register_evidence;schedule jsonb;policy jsonb;policy_identity jsonb;actual_impairment numeric(20,4);expected_accumulated numeric(20,4);
BEGIN
 PERFORM refs_assert_scope(p_tenant,p_entity,'AI.ANALYSIS.EXPLAIN');
 FOR asset IN SELECT * FROM fixed_asset_register_evidence WHERE tenant_id=p_tenant AND entity_id=p_entity AND status='ACTIVE' ORDER BY asset_tag,fixed_asset_register_evidence_id LOOP
  schedule:=refs_fixed_asset_depreciation_schedule_snapshot(p_tenant,p_entity,asset.fixed_asset_register_evidence_id,p_period);
  IF schedule IS NULL OR schedule->>'schema_version'<>'FIXED_ASSET_DEPRECIATION_SCHEDULE_SNAPSHOT_V2' THEN RAISE EXCEPTION 'Authoritative fixed asset depreciation schedule is unavailable' USING ERRCODE='23514';END IF;
  IF coalesce((schedule->>'impairment_recorded')::boolean,false) AND NOT coalesce((schedule->>'post_impairment_policy_valid')::boolean,false) THEN RAISE EXCEPTION 'Authoritative post-impairment depreciation policy is invalid' USING ERRCODE='23514';END IF;
  policy:=schedule->'post_impairment_policy';
  IF policy IS NULL OR policy='null'::jsonb THEN policy:=NULL;policy_identity:=NULL;
  ELSE
   IF policy->>'policy_evidence_hash' IS NULL OR policy->>'policy_evidence_hash' !~ '^sha256:[a-f0-9]{64}$' THEN RAISE EXCEPTION 'Authoritative post-impairment policy evidence is unavailable' USING ERRCODE='23514';END IF;
   policy_identity:=jsonb_build_object('policy_id',policy->'policy_id','impairment_assessment_evidence_id',policy->'impairment_assessment_evidence_id','impairment_journal_entry_id',policy->'impairment_journal_entry_id','effective_period_id',policy->'effective_period_id');
  END IF;
  IF coalesce((schedule->>'impairment_recorded')::boolean,false) AND policy_identity IS NULL THEN RAISE EXCEPTION 'Authoritative post-impairment policy identity is unavailable' USING ERRCODE='23514';END IF;
  SELECT coalesce(sum(l.credit_amount-l.debit_amount),0)::numeric(20,4) INTO actual_impairment
  FROM ledger_line l JOIN journal_entry j ON j.tenant_id=l.tenant_id AND j.entity_id=l.entity_id AND j.journal_entry_id=l.journal_entry_id AND j.status='POSTED'
  WHERE l.tenant_id=p_tenant AND l.entity_id=p_entity AND l.dimensions->>'fixed_asset_register_evidence_id'=asset.fixed_asset_register_evidence_id::text AND j.journal_date<=(schedule->>'period_ends_on')::date
   AND l.account_code IN(SELECT DISTINCT e.accumulated_impairment_account_code FROM fixed_asset_impairment_assessment_evidence e WHERE e.tenant_id=p_tenant AND e.entity_id=p_entity AND e.fixed_asset_register_evidence_id=asset.fixed_asset_register_evidence_id);
  expected_accumulated:=(schedule->>'expected_accumulated_depreciation')::numeric(20,4);
  RETURN NEXT jsonb_build_object(
   'schema_version','AI_FIXED_ASSET_DEPRECIATION_SOURCE_V2','period_id',schedule->'period_id','period_code',schedule->'period_code','period_starts_on',schedule->'period_starts_on','period_ends_on',schedule->'period_ends_on',
   'fixed_asset_register_evidence_id',asset.fixed_asset_register_evidence_id,'source_document_id',asset.source_document_id,'source_payload_hash',asset.source_payload_hash,'capitalization_proposal_id',asset.capitalization_proposal_id,'register_evidence_hash',asset.register_evidence_hash,
   'schedule_basis',schedule->'schedule_basis','schedule_snapshot_hash',refs_jsonb_hash(schedule),'post_impairment_policy_evidence_hash',CASE WHEN policy IS NULL THEN NULL ELSE policy->>'policy_evidence_hash' END,'post_impairment_policy_identity',policy_identity,
   'asset_tag',asset.asset_tag,'asset_class',asset.asset_class,'depreciation_method',asset.depreciation_method,'depreciation_convention',asset.depreciation_convention,'placed_in_service_date',to_char(asset.placed_in_service_date,'YYYY-MM-DD'),'useful_life_months',asset.useful_life_months,
   'currency',asset.currency,'cost_basis',to_char(asset.cost_basis,'FM999999999999990.0000'),'salvage_value',to_char(asset.salvage_value,'FM999999999999990.0000'),'depreciable_basis',to_char(CASE WHEN schedule->>'schedule_basis'='POST_IMPAIRMENT_REVISED' THEN (policy->>'revised_depreciable_basis')::numeric ELSE asset.cost_basis-asset.salvage_value END,'FM999999999999990.0000'),
   'actual_posted_accumulated_impairment',to_char(actual_impairment,'FM999999999999990.0000'),'expected_period_depreciation',schedule->'expected_period_depreciation','expected_accumulated_depreciation',schedule->'expected_accumulated_depreciation','expected_net_book_value',to_char(asset.cost_basis-expected_accumulated-actual_impairment,'FM999999999999990.0000'),
   'asset_account_code',asset.asset_account_code,'accumulated_depreciation_account_code',asset.accumulated_depreciation_account_code,'depreciation_expense_account_code',asset.depreciation_expense_account_code,'status',asset.status);
 END LOOP;
END;$$;

CREATE OR REPLACE FUNCTION refs_read_ai_fixed_asset_posted_reconciliation(p_tenant uuid,p_entity uuid,p_period uuid) RETURNS SETOF jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
BEGIN
 PERFORM refs_assert_scope(p_tenant,p_entity,'AI.ANALYSIS.EXPLAIN');
 RETURN QUERY WITH expected AS (
  SELECT source.data,(source.data->>'fixed_asset_register_evidence_id')::uuid fixed_asset_register_evidence_id,(source.data->>'expected_period_depreciation')::numeric(20,4) expected_period,(source.data->>'expected_accumulated_depreciation')::numeric(20,4) expected_accumulated
  FROM refs_read_ai_fixed_asset_depreciation_source(p_tenant,p_entity,p_period) source(data)
 ),posted AS (
  SELECT expected.fixed_asset_register_evidence_id,
   coalesce(sum(CASE WHEN j.journal_date BETWEEN (expected.data->>'period_starts_on')::date AND (expected.data->>'period_ends_on')::date AND l.account_code=expected.data->>'depreciation_expense_account_code' THEN l.debit_amount-l.credit_amount ELSE 0 END),0)::numeric(20,4) posted_period,
   coalesce(sum(CASE WHEN j.journal_date<=(expected.data->>'period_ends_on')::date AND l.account_code=expected.data->>'accumulated_depreciation_account_code' THEN l.credit_amount-l.debit_amount ELSE 0 END),0)::numeric(20,4) posted_accumulated,
   array_agg(DISTINCT l.journal_entry_id ORDER BY l.journal_entry_id) FILTER(WHERE j.journal_entry_id IS NOT NULL) journal_entry_ids,array_agg(DISTINCT l.journal_line_id ORDER BY l.journal_line_id) FILTER(WHERE j.journal_entry_id IS NOT NULL) journal_line_ids,array_agg(DISTINCT l.ledger_line_id ORDER BY l.ledger_line_id) FILTER(WHERE j.journal_entry_id IS NOT NULL) ledger_line_ids
  FROM expected LEFT JOIN ledger_line l ON l.tenant_id=p_tenant AND l.entity_id=p_entity AND l.dimensions->>'fixed_asset_register_evidence_id'=expected.fixed_asset_register_evidence_id::text AND l.account_code IN(expected.data->>'accumulated_depreciation_account_code',expected.data->>'depreciation_expense_account_code')
  LEFT JOIN journal_entry j ON j.tenant_id=l.tenant_id AND j.entity_id=l.entity_id AND j.journal_entry_id=l.journal_entry_id AND j.status='POSTED'
  GROUP BY expected.fixed_asset_register_evidence_id
 )
 SELECT jsonb_build_object(
  'schema_version','AI_FIXED_ASSET_POSTED_RECONCILIATION_V2','period_id',expected.data->'period_id','period_code',expected.data->'period_code','fixed_asset_register_evidence_id',expected.fixed_asset_register_evidence_id,'register_evidence_hash',expected.data->'register_evidence_hash',
  'schedule_basis',expected.data->'schedule_basis','schedule_snapshot_hash',expected.data->'schedule_snapshot_hash','post_impairment_policy_evidence_hash',expected.data->'post_impairment_policy_evidence_hash','post_impairment_policy_identity',expected.data->'post_impairment_policy_identity',
  'asset_tag',expected.data->'asset_tag','currency',expected.data->'currency','expected_period_depreciation',to_char(expected.expected_period,'FM999999999999990.0000'),'expected_accumulated_depreciation',to_char(expected.expected_accumulated,'FM999999999999990.0000'),
  'posted_period_depreciation_expense',to_char(posted.posted_period,'FM999999999999990.0000'),'posted_accumulated_depreciation',to_char(posted.posted_accumulated,'FM999999999999990.0000'),'period_variance',to_char(posted.posted_period-expected.expected_period,'FM999999999999990.0000'),'accumulated_variance',to_char(posted.posted_accumulated-expected.expected_accumulated,'FM999999999999990.0000'),
  'journal_entry_ids',coalesce(posted.journal_entry_ids,ARRAY[]::uuid[]),'journal_line_ids',coalesce(posted.journal_line_ids,ARRAY[]::uuid[]),'ledger_line_ids',coalesce(posted.ledger_line_ids,ARRAY[]::uuid[]),'lineage_status','ASSET_ID_BOUND_POSTED')
 FROM expected JOIN posted USING(fixed_asset_register_evidence_id) ORDER BY expected.data->>'asset_tag',expected.fixed_asset_register_evidence_id;
END;$$;

REVOKE ALL ON FUNCTION refs_read_ai_fixed_asset_depreciation_source_pre_372(uuid,uuid,uuid),refs_read_ai_fixed_asset_posted_reconciliation_pre_372(uuid,uuid,uuid) FROM PUBLIC,refs_app;
REVOKE EXECUTE ON FUNCTION refs_read_ai_fixed_asset_depreciation_source(uuid,uuid,uuid),refs_read_ai_fixed_asset_posted_reconciliation(uuid,uuid,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION refs_read_ai_fixed_asset_depreciation_source(uuid,uuid,uuid),refs_read_ai_fixed_asset_posted_reconciliation(uuid,uuid,uuid) TO refs_app;

COMMIT;
