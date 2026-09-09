BEGIN;

CREATE FUNCTION refs_validated_fixed_asset_post_impairment_policy_for_assessment(p_tenant uuid,p_entity uuid,p_asset uuid,p_assessment uuid,p_period_end date) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER STABLE SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE asset fixed_asset_register_evidence;assessment fixed_asset_impairment_assessment_evidence;policy fixed_asset_post_impairment_depreciation_policy;
 assessment_period accounting_period;effective accounting_period;source source_document;posting record;live_snapshot jsonb;live_snapshot_hash text;expected_policy_hash text;
 cost_balance numeric(20,4):=0;prior_depreciation numeric(20,4):=0;accumulated_impairment numeric(20,4):=0;carrying numeric(20,4);basis numeric(20,4);regular numeric(20,4);final_amount numeric(20,4);
BEGIN
 SELECT * INTO asset FROM fixed_asset_register_evidence WHERE tenant_id=p_tenant AND entity_id=p_entity AND fixed_asset_register_evidence_id=p_asset;
 IF NOT FOUND THEN RETURN NULL;END IF;
 SELECT * INTO assessment FROM fixed_asset_impairment_assessment_evidence
  WHERE tenant_id=p_tenant AND entity_id=p_entity AND fixed_asset_register_evidence_id=p_asset AND fixed_asset_impairment_assessment_evidence_id=p_assessment
   AND status='INDEPENDENTLY_REVIEWED' AND impairment_loss>0 AND assessment_date<=p_period_end;
 IF NOT FOUND THEN RETURN NULL;END IF;
 SELECT * INTO policy FROM fixed_asset_post_impairment_depreciation_policy
  WHERE tenant_id=p_tenant AND entity_id=p_entity AND fixed_asset_register_evidence_id=p_asset AND impairment_assessment_evidence_id=assessment.fixed_asset_impairment_assessment_evidence_id AND status='INDEPENDENTLY_REVIEWED';
 IF NOT FOUND OR policy.impairment_assessment_hash<>assessment.impairment_assessment_hash OR policy.salvage_value<>asset.salvage_value
  OR policy.reviewed_by IN(asset.reviewed_by,assessment.reviewed_by) THEN RETURN NULL;END IF;
 SELECT * INTO source FROM source_document WHERE tenant_id=p_tenant AND entity_id=p_entity AND source_document_id=assessment.valuation_source_document_id;
 IF NOT FOUND OR source.payload_hash<>assessment.valuation_source_payload_hash
  OR assessment.impairment_assessment_hash<>refs_review_fixed_asset_impairment_hash(p_tenant,p_entity,p_asset,assessment.accounting_period_id,assessment.valuation_source_document_id,assessment.assessment_date,assessment.recoverable_amount,assessment.impairment_expense_account_code,assessment.accumulated_impairment_account_code,assessment.review_reason) THEN RETURN NULL;END IF;
 SELECT * INTO assessment_period FROM accounting_period WHERE tenant_id=p_tenant AND entity_id=p_entity AND period_id=assessment.accounting_period_id AND ledger_code='PRIMARY';
 SELECT * INTO effective FROM accounting_period WHERE tenant_id=p_tenant AND entity_id=p_entity AND period_id=policy.effective_period_id AND ledger_code='PRIMARY';
 IF assessment_period.period_id IS NULL OR effective.period_id IS NULL OR policy.effective_from<>effective.starts_on OR effective.starts_on<>assessment_period.ends_on+1 OR policy.convention<>'NEXT_PERIOD_FULL_MONTH' THEN RETURN NULL;END IF;
 SELECT j.journal_entry_id,j.period_id,j.journal_date,j.created_by,j.reviewed_by,j.approved_by,j.posted_at,j.posted_by,
  count(*) line_count,count(*) FILTER(WHERE l.account_code=assessment.impairment_expense_account_code) expense_line_count,count(*) FILTER(WHERE l.account_code=assessment.accumulated_impairment_account_code) accumulated_line_count,
  bool_and((l.dimensions->>'fixed_asset_register_evidence_id' IS NOT DISTINCT FROM p_asset::text) AND (l.dimensions->>'fixed_asset_impairment_assessment_evidence_id' IS NOT DISTINCT FROM assessment.fixed_asset_impairment_assessment_evidence_id::text)) dimensions_exact,
  array_agg(l.journal_line_id ORDER BY l.journal_line_id) journal_line_ids,array_agg(l.ledger_line_id ORDER BY l.ledger_line_id) ledger_line_ids,
  sum(CASE WHEN l.account_code=assessment.impairment_expense_account_code THEN l.debit_amount-l.credit_amount ELSE 0 END)::numeric(20,4) expense_amount,
  sum(CASE WHEN l.account_code=assessment.accumulated_impairment_account_code THEN l.credit_amount-l.debit_amount ELSE 0 END)::numeric(20,4) accumulated_amount
 INTO posting FROM journal_entry j JOIN ledger_line l ON l.tenant_id=j.tenant_id AND l.entity_id=j.entity_id AND l.journal_entry_id=j.journal_entry_id
 WHERE j.tenant_id=p_tenant AND j.entity_id=p_entity AND j.journal_entry_id=policy.impairment_journal_entry_id AND j.status='POSTED'
 GROUP BY j.journal_entry_id,j.period_id,j.journal_date,j.created_by,j.reviewed_by,j.approved_by,j.posted_at,j.posted_by;
 IF posting.journal_entry_id IS NULL OR posting.period_id<>assessment.accounting_period_id OR posting.journal_date NOT BETWEEN assessment.assessment_date AND assessment_period.ends_on
  OR posting.line_count<>2 OR posting.expense_line_count<>1 OR posting.accumulated_line_count<>1 OR posting.dimensions_exact IS DISTINCT FROM true
  OR posting.expense_amount<>assessment.impairment_loss OR posting.accumulated_amount<>assessment.impairment_loss
  OR posting.created_by IS NULL OR posting.reviewed_by IS NULL OR posting.approved_by IS NULL OR posting.posted_by IS NULL
  OR cardinality(ARRAY(SELECT DISTINCT workflow_actor FROM unnest(ARRAY[posting.created_by,posting.reviewed_by,posting.approved_by,posting.posted_by]) workflow_actor))<>4
  OR policy.reviewed_by=ANY(ARRAY[posting.created_by,posting.reviewed_by,posting.approved_by,posting.posted_by]) THEN RETURN NULL;END IF;
 live_snapshot:=jsonb_build_object('schema_version','FIXED_ASSET_IMPAIRMENT_POSTING_SNAPSHOT_V1','tenant_id',p_tenant,'entity_id',p_entity,'fixed_asset_register_evidence_id',p_asset,'impairment_assessment_evidence_id',assessment.fixed_asset_impairment_assessment_evidence_id,'impairment_assessment_hash',assessment.impairment_assessment_hash,'journal_entry_id',posting.journal_entry_id,'period_id',posting.period_id,'journal_date',posting.journal_date,'created_by',posting.created_by,'reviewed_by',posting.reviewed_by,'approved_by',posting.approved_by,'posted_at',posting.posted_at,'posted_by',posting.posted_by,'journal_line_ids',posting.journal_line_ids,'ledger_line_ids',posting.ledger_line_ids,'expense_amount',to_char(posting.expense_amount,'FM999999999999990.0000'),'accumulated_amount',to_char(posting.accumulated_amount,'FM999999999999990.0000'));
 live_snapshot_hash:=refs_jsonb_hash(live_snapshot);
 IF policy.impairment_posting_snapshot IS DISTINCT FROM live_snapshot OR policy.impairment_posting_snapshot_hash<>live_snapshot_hash THEN RETURN NULL;END IF;
 SELECT coalesce(sum(CASE WHEN l.account_code=asset.asset_account_code THEN l.debit_amount-l.credit_amount ELSE 0 END),0),
  coalesce(sum(CASE WHEN l.account_code=asset.accumulated_depreciation_account_code THEN l.credit_amount-l.debit_amount ELSE 0 END),0),
  coalesce(sum(CASE WHEN l.account_code IN(SELECT DISTINCT e.accumulated_impairment_account_code FROM fixed_asset_impairment_assessment_evidence e WHERE e.tenant_id=p_tenant AND e.entity_id=p_entity AND e.fixed_asset_register_evidence_id=p_asset) THEN l.credit_amount-l.debit_amount ELSE 0 END),0)
 INTO cost_balance,prior_depreciation,accumulated_impairment
 FROM ledger_line l JOIN journal_entry j ON j.tenant_id=l.tenant_id AND j.entity_id=l.entity_id AND j.journal_entry_id=l.journal_entry_id AND j.status='POSTED'
 WHERE l.tenant_id=p_tenant AND l.entity_id=p_entity AND l.dimensions->>'fixed_asset_register_evidence_id'=p_asset::text AND j.journal_date<effective.starts_on;
 carrying:=cost_balance-prior_depreciation-accumulated_impairment;basis:=carrying-asset.salvage_value;regular:=round(basis/policy.remaining_useful_life_months,4);final_amount:=basis-regular*(policy.remaining_useful_life_months-1);
 IF cost_balance<>asset.cost_basis OR cost_balance<>policy.posted_cost_balance OR prior_depreciation<>policy.prior_accumulated_depreciation OR accumulated_impairment<>policy.posted_accumulated_impairment
  OR carrying<>assessment.recoverable_amount OR carrying<>policy.revised_carrying_value OR basis<>policy.revised_depreciable_basis OR regular<>policy.regular_period_amount OR final_amount<>policy.final_period_amount OR regular<=0 OR final_amount<=0 THEN RETURN NULL;END IF;
 expected_policy_hash:=refs_jsonb_hash(jsonb_build_object('schema_version','FIXED_ASSET_POST_IMPAIRMENT_DEPRECIATION_POLICY_V1','tenant_id',p_tenant,'entity_id',p_entity,'policy_id',policy.policy_id,'fixed_asset_register_evidence_id',p_asset,'impairment_assessment_evidence_id',assessment.fixed_asset_impairment_assessment_evidence_id,'impairment_assessment_hash',assessment.impairment_assessment_hash,'impairment_posting_snapshot_hash',live_snapshot_hash,'effective_period_id',policy.effective_period_id,'effective_from',policy.effective_from,'convention',policy.convention,'remaining_useful_life_months',policy.remaining_useful_life_months,'posted_cost_balance',to_char(policy.posted_cost_balance,'FM999999999999990.0000'),'prior_accumulated_depreciation',to_char(policy.prior_accumulated_depreciation,'FM999999999999990.0000'),'posted_accumulated_impairment',to_char(policy.posted_accumulated_impairment,'FM999999999999990.0000'),'revised_carrying_value',to_char(policy.revised_carrying_value,'FM999999999999990.0000'),'salvage_value',to_char(policy.salvage_value,'FM999999999999990.0000'),'revised_depreciable_basis',to_char(policy.revised_depreciable_basis,'FM999999999999990.0000'),'regular_period_amount',to_char(policy.regular_period_amount,'FM999999999999990.0000'),'final_period_amount',to_char(policy.final_period_amount,'FM999999999999990.0000'),'reviewed_by',policy.reviewed_by,'review_reason',policy.review_reason,'status',policy.status));
 IF policy.policy_evidence_hash<>expected_policy_hash THEN RETURN NULL;END IF;
 RETURN jsonb_build_object('schema_version','FIXED_ASSET_POST_IMPAIRMENT_DEPRECIATION_POLICY_V1','policy_id',policy.policy_id,'policy_evidence_hash',policy.policy_evidence_hash,'status',policy.status,
  'fixed_asset_register_evidence_id',p_asset,'impairment_assessment_evidence_id',assessment.fixed_asset_impairment_assessment_evidence_id,'impairment_assessment_hash',assessment.impairment_assessment_hash,
  'impairment_journal_entry_id',policy.impairment_journal_entry_id,'impairment_posting_snapshot',live_snapshot,'impairment_posting_snapshot_hash',live_snapshot_hash,
  'effective_period_id',policy.effective_period_id,'effective_from',policy.effective_from,'convention',policy.convention,'remaining_useful_life_months',policy.remaining_useful_life_months,
  'posted_cost_balance',to_char(policy.posted_cost_balance,'FM999999999999990.0000'),'prior_accumulated_depreciation',to_char(policy.prior_accumulated_depreciation,'FM999999999999990.0000'),'posted_accumulated_impairment',to_char(policy.posted_accumulated_impairment,'FM999999999999990.0000'),
  'revised_carrying_value',to_char(policy.revised_carrying_value,'FM999999999999990.0000'),'salvage_value',to_char(policy.salvage_value,'FM999999999999990.0000'),'revised_depreciable_basis',to_char(policy.revised_depreciable_basis,'FM999999999999990.0000'),
  'regular_period_amount',to_char(policy.regular_period_amount,'FM999999999999990.0000'),'final_period_amount',to_char(policy.final_period_amount,'FM999999999999990.0000'),'reviewed_by',policy.reviewed_by,'reviewed_at',policy.reviewed_at,'review_reason',policy.review_reason);
END;$$;
REVOKE EXECUTE ON FUNCTION refs_validated_fixed_asset_post_impairment_policy_for_assessment(uuid,uuid,uuid,uuid,date) FROM PUBLIC,refs_app;

CREATE FUNCTION refs_validated_fixed_asset_post_impairment_policy(p_tenant uuid,p_entity uuid,p_asset uuid,p_period_end date) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER STABLE SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE assessment_id uuid;
BEGIN
 SELECT fixed_asset_impairment_assessment_evidence_id INTO assessment_id FROM fixed_asset_impairment_assessment_evidence
  WHERE tenant_id=p_tenant AND entity_id=p_entity AND fixed_asset_register_evidence_id=p_asset AND status='INDEPENDENTLY_REVIEWED' AND impairment_loss>0 AND assessment_date<=p_period_end
  ORDER BY assessment_date DESC,fixed_asset_impairment_assessment_evidence_id DESC LIMIT 1;
 IF assessment_id IS NULL THEN RETURN NULL;END IF;
 RETURN refs_validated_fixed_asset_post_impairment_policy_for_assessment(p_tenant,p_entity,p_asset,assessment_id,p_period_end);
END;$$;
REVOKE EXECUTE ON FUNCTION refs_validated_fixed_asset_post_impairment_policy(uuid,uuid,uuid,date) FROM PUBLIC,refs_app;

CREATE OR REPLACE FUNCTION refs_fixed_asset_depreciation_schedule_snapshot(p_tenant uuid,p_entity uuid,p_asset uuid,p_period uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE row record;assessment fixed_asset_impairment_assessment_evidence;active_assessment fixed_asset_impairment_assessment_evidence;coverage_policy jsonb;post_policy jsonb;monthly numeric(20,4);original_elapsed integer;revised_elapsed integer:=NULL;
 basis numeric(20,4);expected_period numeric(20,4):=0;expected_accumulated numeric(20,4):=0;expected_prior numeric(20,4):=0;actual_impairment numeric(20,4):=0;schedule_basis text:='ORIGINAL_REGISTER';policy_public jsonb:=NULL;policy_covered boolean:=false;active_policy_valid boolean:=true;
BEGIN
 SELECT a.*,p.period_id,p.period_code,p.starts_on,p.ends_on,p.status period_status,proposal.policy_snapshot_id,proposal.policy_snapshot_hash,
  policy.version policy_snapshot_version,(policy.snapshot->>'policy_version')::bigint policy_version INTO row
 FROM fixed_asset_register_evidence a JOIN accounting_period p ON p.tenant_id=a.tenant_id AND p.entity_id=a.entity_id
 JOIN ai_invoice_capitalization_proposal proposal ON proposal.tenant_id=a.tenant_id AND proposal.entity_id=a.entity_id AND proposal.ai_invoice_capitalization_proposal_id=a.capitalization_proposal_id
 JOIN setting_snapshot policy ON policy.tenant_id=a.tenant_id AND policy.setting_snapshot_id=proposal.policy_snapshot_id
 WHERE a.tenant_id=p_tenant AND a.entity_id=p_entity AND a.fixed_asset_register_evidence_id=p_asset AND p.period_id=p_period AND p.ledger_code='PRIMARY'
  AND policy.snapshot_hash=refs_jsonb_hash(policy.snapshot) AND policy.snapshot_hash=proposal.policy_snapshot_hash AND policy.family='AI_CAPITALIZATION_POLICY' AND policy.status IN('APPROVED','RETIRED')
  AND policy.entity_id=p_entity AND policy.scope_type='ENTITY' AND policy.scope_key=p_entity::text;
 IF NOT FOUND THEN RETURN NULL;END IF;
 SELECT * INTO assessment FROM fixed_asset_impairment_assessment_evidence WHERE tenant_id=p_tenant AND entity_id=p_entity AND fixed_asset_register_evidence_id=p_asset AND status='INDEPENDENTLY_REVIEWED' AND impairment_loss>0 AND assessment_date<=row.ends_on ORDER BY assessment_date DESC,fixed_asset_impairment_assessment_evidence_id DESC LIMIT 1;
 IF FOUND THEN
  coverage_policy:=refs_validated_fixed_asset_post_impairment_policy_for_assessment(p_tenant,p_entity,p_asset,assessment.fixed_asset_impairment_assessment_evidence_id,row.ends_on);
  SELECT e.* INTO active_assessment FROM fixed_asset_impairment_assessment_evidence e JOIN fixed_asset_post_impairment_depreciation_policy p
   ON p.tenant_id=e.tenant_id AND p.entity_id=e.entity_id AND p.fixed_asset_register_evidence_id=e.fixed_asset_register_evidence_id AND p.impairment_assessment_evidence_id=e.fixed_asset_impairment_assessment_evidence_id
   WHERE e.tenant_id=p_tenant AND e.entity_id=p_entity AND e.fixed_asset_register_evidence_id=p_asset AND e.status='INDEPENDENTLY_REVIEWED' AND e.impairment_loss>0 AND e.assessment_date<=row.ends_on
    AND p.status='INDEPENDENTLY_REVIEWED' AND p.effective_from<=row.starts_on
   ORDER BY p.effective_from DESC,e.assessment_date DESC,e.fixed_asset_impairment_assessment_evidence_id DESC LIMIT 1;
  IF FOUND THEN post_policy:=refs_validated_fixed_asset_post_impairment_policy_for_assessment(p_tenant,p_entity,p_asset,active_assessment.fixed_asset_impairment_assessment_evidence_id,row.ends_on);active_policy_valid:=post_policy IS NOT NULL;END IF;
  SELECT coalesce(sum(l.credit_amount-l.debit_amount),0) INTO actual_impairment FROM ledger_line l JOIN journal_entry j
   ON j.tenant_id=l.tenant_id AND j.entity_id=l.entity_id AND j.journal_entry_id=l.journal_entry_id AND j.status='POSTED'
   WHERE l.tenant_id=p_tenant AND l.entity_id=p_entity AND l.dimensions->>'fixed_asset_register_evidence_id'=p_asset::text AND j.journal_date<=row.ends_on
    AND l.account_code IN(SELECT DISTINCT e.accumulated_impairment_account_code FROM fixed_asset_impairment_assessment_evidence e WHERE e.tenant_id=p_tenant AND e.entity_id=p_entity AND e.fixed_asset_register_evidence_id=p_asset);
  policy_covered:=coverage_policy IS NOT NULL AND actual_impairment=(coverage_policy->>'posted_accumulated_impairment')::numeric AND active_policy_valid;
 END IF;
 basis:=row.cost_basis-row.salvage_value;monthly:=round(basis/row.useful_life_months,4);
 original_elapsed:=greatest(0,((extract(year from row.ends_on)::int-extract(year from row.placed_in_service_date)::int)*12+extract(month from row.ends_on)::int-extract(month from row.placed_in_service_date)::int+1));
 expected_accumulated:=CASE WHEN original_elapsed>=row.useful_life_months THEN basis ELSE least(basis,monthly*original_elapsed) END;
 IF row.starts_on>=(row.placed_in_service_date-date_part('day',row.placed_in_service_date)::int+1) AND original_elapsed BETWEEN 1 AND row.useful_life_months THEN
  expected_prior:=least(basis,monthly*greatest(0,original_elapsed-1));expected_period:=expected_accumulated-expected_prior;
 ELSE expected_period:=0;expected_prior:=expected_accumulated;END IF;
 IF policy_covered AND post_policy IS NOT NULL AND row.starts_on>=(post_policy->>'effective_from')::date THEN
  schedule_basis:='POST_IMPAIRMENT_REVISED';revised_elapsed:=greatest(0,((extract(year from row.ends_on)::int-extract(year from (post_policy->>'effective_from')::date)::int)*12+extract(month from row.ends_on)::int-extract(month from (post_policy->>'effective_from')::date)::int+1));
  IF revised_elapsed BETWEEN 1 AND (post_policy->>'remaining_useful_life_months')::integer THEN expected_period:=CASE WHEN revised_elapsed=(post_policy->>'remaining_useful_life_months')::integer THEN (post_policy->>'final_period_amount')::numeric ELSE (post_policy->>'regular_period_amount')::numeric END;ELSE expected_period:=0;END IF;
  expected_accumulated:=(post_policy->>'prior_accumulated_depreciation')::numeric+CASE WHEN revised_elapsed<=0 THEN 0 WHEN revised_elapsed<(post_policy->>'remaining_useful_life_months')::integer THEN (post_policy->>'regular_period_amount')::numeric*revised_elapsed ELSE (post_policy->>'revised_depreciable_basis')::numeric END;
  expected_prior:=expected_accumulated-expected_period;
 END IF;
 IF policy_covered THEN IF post_policy IS NOT NULL THEN policy_public:=post_policy-'impairment_posting_snapshot';ELSE policy_public:=coverage_policy-'impairment_posting_snapshot';END IF;END IF;
 RETURN jsonb_build_object('schema_version','FIXED_ASSET_DEPRECIATION_SCHEDULE_SNAPSHOT_V2','tenant_id',row.tenant_id,'entity_id',row.entity_id,'fixed_asset_register_evidence_id',row.fixed_asset_register_evidence_id,'register_evidence_hash',row.register_evidence_hash,
  'asset_tag',row.asset_tag,'asset_class',row.asset_class,'asset_status',row.status,'period_id',row.period_id,'period_code',row.period_code,'period_starts_on',row.starts_on,'period_ends_on',row.ends_on,'period_status',row.period_status,'placed_in_service_date',row.placed_in_service_date,
  'depreciation_method',row.depreciation_method,'depreciation_convention',row.depreciation_convention,'useful_life_months',row.useful_life_months,'member_trace',row.member_trace,'schedule_basis',schedule_basis,'revised_period_number',revised_elapsed,
  'impairment_recorded',assessment.fixed_asset_impairment_assessment_evidence_id IS NOT NULL,'post_impairment_policy_valid',policy_covered,'post_impairment_policy',policy_public,
  'policy_snapshot_id',row.policy_snapshot_id,'policy_snapshot_hash',row.policy_snapshot_hash,'policy_snapshot_version',row.policy_snapshot_version,'policy_version',row.policy_version,
  'currency',row.currency,'cost_basis',to_char(row.cost_basis,'FM999999999999990.0000'),'salvage_value',to_char(row.salvage_value,'FM999999999999990.0000'),
  'expected_period_depreciation',to_char(expected_period,'FM999999999999990.0000'),'expected_accumulated_depreciation',to_char(expected_accumulated,'FM999999999999990.0000'),'expected_prior_accumulated_depreciation',to_char(expected_prior,'FM999999999999990.0000'),
  'asset_account_code',row.asset_account_code,'accumulated_depreciation_account_code',row.accumulated_depreciation_account_code,'depreciation_expense_account_code',row.depreciation_expense_account_code);
END;$$;
REVOKE EXECUTE ON FUNCTION refs_fixed_asset_depreciation_schedule_snapshot(uuid,uuid,uuid,uuid) FROM PUBLIC,refs_app;

CREATE OR REPLACE FUNCTION refs_validate_fixed_asset_depreciation_ready(p_tenant uuid,p_entity uuid,p_asset uuid,p_period uuid,p_date date) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE asset fixed_asset_register_evidence;period accounting_period;posting fixed_asset_acquisition_posting;acquisition fixed_asset_acquisition_binding;
 source source_document;original wbs_payable_original_row_evidence;schedule jsonb;actual_cost numeric(20,4);actual_prior numeric(20,4);current_lines integer;source_link_count integer;
BEGIN
 SELECT * INTO asset FROM fixed_asset_register_evidence WHERE tenant_id=p_tenant AND entity_id=p_entity AND fixed_asset_register_evidence_id=p_asset FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Scoped depreciation asset missing' USING ERRCODE='P0002';END IF;
 SELECT * INTO period FROM accounting_period WHERE tenant_id=p_tenant AND entity_id=p_entity AND period_id=p_period AND ledger_code='PRIMARY' FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Scoped depreciation period missing' USING ERRCODE='P0002';END IF;
 schedule:=refs_fixed_asset_depreciation_schedule_snapshot(p_tenant,p_entity,p_asset,p_period);
 IF schedule IS NULL THEN RAISE EXCEPTION 'Depreciation schedule evidence is unavailable' USING ERRCODE='23514';END IF;
 IF asset.status<>'ACTIVE' OR asset.depreciation_method<>'STRAIGHT_LINE' OR asset.depreciation_convention<>'FULL_MONTH' THEN RAISE EXCEPTION 'Depreciation requires an active straight-line full-month asset' USING ERRCODE='23514';END IF;
 IF period.status<>'OPEN' OR p_date IS DISTINCT FROM period.ends_on THEN RAISE EXCEPTION 'Depreciation requires the exact OPEN period end date' USING ERRCODE='55000';END IF;
 IF coalesce((schedule->>'impairment_recorded')::boolean,false) AND NOT coalesce((schedule->>'post_impairment_policy_valid')::boolean,false) THEN RAISE EXCEPTION 'Exact independently reviewed post-impairment depreciation policy is required' USING ERRCODE='23514';END IF;
 IF (schedule->>'expected_period_depreciation')::numeric<=0 THEN RAISE EXCEPTION 'No depreciation is due for this asset and period' USING ERRCODE='23514';END IF;
 SELECT * INTO posting FROM fixed_asset_acquisition_posting WHERE tenant_id=p_tenant AND entity_id=p_entity AND asset_id=p_asset;
 IF NOT FOUND THEN RAISE EXCEPTION 'Posted acquisition is required before depreciation' USING ERRCODE='23514';END IF;
 SELECT * INTO acquisition FROM fixed_asset_acquisition_binding WHERE tenant_id=p_tenant AND entity_id=p_entity AND binding_id=posting.binding_id AND journal_entry_id=posting.journal_entry_id;
 IF NOT FOUND THEN RAISE EXCEPTION 'Posted acquisition binding is missing' USING ERRCODE='23514';END IF;
 SELECT * INTO source FROM source_document WHERE tenant_id=p_tenant AND entity_id=p_entity AND source_document_id=acquisition.source_document_id FOR SHARE;
 IF NOT FOUND OR source.version<>acquisition.source_document_version OR source.payload_hash<>acquisition.source_payload_hash OR source.currency<>asset.currency THEN RAISE EXCEPTION 'Acquisition source changed before depreciation' USING ERRCODE='40001';END IF;
 SELECT count(*) INTO source_link_count FROM source_link WHERE source_link_id=acquisition.source_link_id AND tenant_id=p_tenant AND entity_id=p_entity AND source_document_id=source.source_document_id AND journal_entry_id=posting.journal_entry_id AND link_type='SOURCE_TO_JE';
 IF source_link_count<>1 OR acquisition.attachment_snapshot_hash IS NULL OR acquisition.attachment_ids IS NULL OR cardinality(acquisition.attachment_ids)=0 OR acquisition.attachment_snapshot_hash<>refs_asset_acquisition_attachment_snapshot(p_tenant,p_entity,source.source_document_id) THEN RAISE EXCEPTION 'Posted acquisition evidence is incomplete or changed' USING ERRCODE='23514';END IF;
 original:=refs_validate_asset_original_source(p_tenant,p_entity,p_asset);
 IF acquisition.source_document_line_id<>original.source_document_line_id OR acquisition.source_line_snapshot_hash<>refs_jsonb_hash(original.source_line_snapshot)
  OR NOT EXISTS(SELECT 1 FROM fixed_asset_original_source_binding b WHERE b.binding_id=acquisition.binding_id AND b.tenant_id=p_tenant AND b.entity_id=p_entity AND b.original_evidence_id=original.evidence_id AND b.original_evidence_hash=original.evidence_hash)
  OR schedule->>'policy_snapshot_id' IS NULL OR schedule->>'policy_snapshot_hash' IS NULL OR schedule->>'policy_snapshot_version' IS NULL OR schedule->>'policy_version' IS NULL THEN RAISE EXCEPTION 'Acquisition source line or policy evidence changed before depreciation' USING ERRCODE='23514';END IF;
 IF EXISTS(SELECT 1 FROM fixed_asset_disposal_evidence WHERE tenant_id=p_tenant AND entity_id=p_entity AND fixed_asset_register_evidence_id=p_asset AND disposal_date<=period.ends_on)
  OR EXISTS(SELECT 1 FROM fixed_asset_disposal_posting d JOIN journal_entry j ON j.tenant_id=d.tenant_id AND j.entity_id=d.entity_id AND j.journal_entry_id=d.journal_entry_id WHERE d.tenant_id=p_tenant AND d.entity_id=p_entity AND d.fixed_asset_register_evidence_id=p_asset AND j.journal_date<=period.ends_on) THEN RAISE EXCEPTION 'Disposed asset cannot receive depreciation for this period' USING ERRCODE='23514';END IF;
 IF EXISTS(SELECT 1 FROM fixed_asset_depreciation_posting WHERE tenant_id=p_tenant AND entity_id=p_entity AND fixed_asset_register_evidence_id=p_asset AND accounting_period_id=p_period) THEN RAISE EXCEPTION 'Asset already has Posted depreciation for this period' USING ERRCODE='23514';END IF;
 SELECT coalesce(sum(l.debit_amount-l.credit_amount),0) INTO actual_cost FROM ledger_line l JOIN journal_entry j ON j.tenant_id=l.tenant_id AND j.entity_id=l.entity_id AND j.journal_entry_id=l.journal_entry_id AND j.status='POSTED' WHERE l.tenant_id=p_tenant AND l.entity_id=p_entity AND l.dimensions->>'fixed_asset_register_evidence_id'=p_asset::text AND l.account_code=asset.asset_account_code AND j.journal_date<=period.ends_on;
 IF actual_cost<>asset.cost_basis THEN RAISE EXCEPTION 'Posted asset cost does not reconcile to the register' USING ERRCODE='23514';END IF;
 SELECT coalesce(sum(l.credit_amount-l.debit_amount),0) INTO actual_prior FROM ledger_line l JOIN journal_entry j ON j.tenant_id=l.tenant_id AND j.entity_id=l.entity_id AND j.journal_entry_id=l.journal_entry_id AND j.status='POSTED' WHERE l.tenant_id=p_tenant AND l.entity_id=p_entity AND l.dimensions->>'fixed_asset_register_evidence_id'=p_asset::text AND l.account_code=asset.accumulated_depreciation_account_code AND j.journal_date<period.starts_on;
 IF actual_prior<>(schedule->>'expected_prior_accumulated_depreciation')::numeric THEN RAISE EXCEPTION 'Prior Posted depreciation does not reconcile to the retained schedule' USING ERRCODE='23514';END IF;
 SELECT count(*) INTO current_lines FROM ledger_line l JOIN journal_entry j ON j.tenant_id=l.tenant_id AND j.entity_id=l.entity_id AND j.journal_entry_id=l.journal_entry_id AND j.status='POSTED' WHERE l.tenant_id=p_tenant AND l.entity_id=p_entity AND l.dimensions->>'fixed_asset_register_evidence_id'=p_asset::text AND l.account_code IN(asset.depreciation_expense_account_code,asset.accumulated_depreciation_account_code) AND j.journal_date BETWEEN period.starts_on AND period.ends_on;
 IF current_lines<>0 THEN RAISE EXCEPTION 'Asset already has Posted depreciation lines in this period' USING ERRCODE='23514';END IF;
 RETURN schedule||jsonb_build_object('acquisition_binding_id',acquisition.binding_id,'acquisition_journal_entry_id',acquisition.journal_entry_id,'source_document_id',acquisition.source_document_id,'source_document_version',acquisition.source_document_version,'source_payload_hash',acquisition.source_payload_hash,'source_document_line_id',acquisition.source_document_line_id,'source_line_snapshot_hash',acquisition.source_line_snapshot_hash,'original_evidence_id',original.evidence_id,'original_evidence_hash',original.evidence_hash,'attachment_ids',acquisition.attachment_ids,'attachment_snapshot_hash',acquisition.attachment_snapshot_hash,'actual_posted_cost',to_char(actual_cost,'FM999999999999990.0000'),'actual_prior_accumulated_depreciation',to_char(actual_prior,'FM999999999999990.0000'));
END;$$;
REVOKE EXECUTE ON FUNCTION refs_validate_fixed_asset_depreciation_ready(uuid,uuid,uuid,uuid,date) FROM PUBLIC,refs_app;

CREATE OR REPLACE FUNCTION refs_read_fixed_asset_depreciation_options(p_tenant uuid,p_entity uuid,p_asset uuid,p_period uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE asset fixed_asset_register_evidence;period accounting_period;schedule jsonb;posting fixed_asset_acquisition_posting;acquisition fixed_asset_acquisition_binding;original fixed_asset_original_source_binding;verified_original wbs_payable_original_row_evidence;source source_document;actual_cost numeric(20,4):=0;actual_prior numeric(20,4):=0;current_lines integer:=0;pending jsonb;more_pending boolean;impairment boolean;policy_covered boolean;disposal boolean;source_ready boolean:=false;readiness text;
BEGIN
 PERFORM refs_assert_scope(p_tenant,p_entity,'FIXED_ASSET.DEPRECIATION.DRAFT');PERFORM refs_assert_scope(p_tenant,p_entity,'GL.JE.VIEW');
 SELECT * INTO asset FROM fixed_asset_register_evidence WHERE tenant_id=p_tenant AND entity_id=p_entity AND fixed_asset_register_evidence_id=p_asset;IF NOT FOUND THEN RAISE EXCEPTION 'Scoped depreciation asset missing' USING ERRCODE='P0002';END IF;
 SELECT * INTO period FROM accounting_period WHERE tenant_id=p_tenant AND entity_id=p_entity AND period_id=p_period AND ledger_code='PRIMARY';IF NOT FOUND THEN RAISE EXCEPTION 'Scoped depreciation period missing' USING ERRCODE='P0002';END IF;
 schedule:=refs_fixed_asset_depreciation_schedule_snapshot(p_tenant,p_entity,p_asset,p_period);IF schedule IS NULL THEN RAISE EXCEPTION 'Depreciation schedule evidence is unavailable' USING ERRCODE='23514';END IF;
 SELECT * INTO posting FROM fixed_asset_acquisition_posting WHERE tenant_id=p_tenant AND entity_id=p_entity AND asset_id=p_asset;IF FOUND THEN SELECT * INTO acquisition FROM fixed_asset_acquisition_binding WHERE tenant_id=p_tenant AND entity_id=p_entity AND binding_id=posting.binding_id AND journal_entry_id=posting.journal_entry_id;END IF;
 IF acquisition.binding_id IS NOT NULL THEN
  SELECT * INTO original FROM fixed_asset_original_source_binding WHERE binding_id=acquisition.binding_id AND tenant_id=p_tenant AND entity_id=p_entity;SELECT * INTO source FROM source_document WHERE tenant_id=p_tenant AND entity_id=p_entity AND source_document_id=acquisition.source_document_id;
  source_ready:=coalesce(source.source_document_id IS NOT NULL AND source.version=acquisition.source_document_version AND source.payload_hash=acquisition.source_payload_hash AND source.currency=asset.currency AND acquisition.attachment_snapshot_hash IS NOT NULL AND acquisition.attachment_ids IS NOT NULL AND cardinality(acquisition.attachment_ids)>0 AND acquisition.attachment_snapshot_hash=refs_asset_acquisition_attachment_snapshot(p_tenant,p_entity,acquisition.source_document_id) AND original.binding_id IS NOT NULL AND EXISTS(SELECT 1 FROM source_link WHERE source_link_id=acquisition.source_link_id AND tenant_id=p_tenant AND entity_id=p_entity AND source_document_id=acquisition.source_document_id AND journal_entry_id=acquisition.journal_entry_id AND link_type='SOURCE_TO_JE'),false);
  IF source_ready THEN BEGIN verified_original:=refs_validate_asset_original_source(p_tenant,p_entity,p_asset);source_ready:=acquisition.source_document_line_id=verified_original.source_document_line_id AND acquisition.source_line_snapshot_hash=refs_jsonb_hash(verified_original.source_line_snapshot) AND original.original_evidence_id=verified_original.evidence_id AND original.original_evidence_hash=verified_original.evidence_hash;EXCEPTION WHEN check_violation OR foreign_key_violation OR object_in_use OR object_not_in_prerequisite_state OR data_exception THEN source_ready:=false;END;END IF;
 END IF;
 SELECT coalesce(sum(l.debit_amount-l.credit_amount),0) INTO actual_cost FROM ledger_line l JOIN journal_entry j ON j.tenant_id=l.tenant_id AND j.entity_id=l.entity_id AND j.journal_entry_id=l.journal_entry_id AND j.status='POSTED' WHERE l.tenant_id=p_tenant AND l.entity_id=p_entity AND l.dimensions->>'fixed_asset_register_evidence_id'=p_asset::text AND l.account_code=asset.asset_account_code AND j.journal_date<=period.ends_on;
 SELECT coalesce(sum(l.credit_amount-l.debit_amount),0) INTO actual_prior FROM ledger_line l JOIN journal_entry j ON j.tenant_id=l.tenant_id AND j.entity_id=l.entity_id AND j.journal_entry_id=l.journal_entry_id AND j.status='POSTED' WHERE l.tenant_id=p_tenant AND l.entity_id=p_entity AND l.dimensions->>'fixed_asset_register_evidence_id'=p_asset::text AND l.account_code=asset.accumulated_depreciation_account_code AND j.journal_date<period.starts_on;
 SELECT count(*) INTO current_lines FROM ledger_line l JOIN journal_entry j ON j.tenant_id=l.tenant_id AND j.entity_id=l.entity_id AND j.journal_entry_id=l.journal_entry_id AND j.status='POSTED' WHERE l.tenant_id=p_tenant AND l.entity_id=p_entity AND l.dimensions->>'fixed_asset_register_evidence_id'=p_asset::text AND l.account_code IN(asset.depreciation_expense_account_code,asset.accumulated_depreciation_account_code) AND j.journal_date BETWEEN period.starts_on AND period.ends_on;
 impairment:=coalesce((schedule->>'impairment_recorded')::boolean,false);policy_covered:=NOT impairment OR coalesce((schedule->>'post_impairment_policy_valid')::boolean,false);
 disposal:=EXISTS(SELECT 1 FROM fixed_asset_disposal_evidence WHERE tenant_id=p_tenant AND entity_id=p_entity AND fixed_asset_register_evidence_id=p_asset AND disposal_date<=period.ends_on) OR EXISTS(SELECT 1 FROM fixed_asset_disposal_posting d JOIN journal_entry j ON j.tenant_id=d.tenant_id AND j.entity_id=d.entity_id AND j.journal_entry_id=d.journal_entry_id WHERE d.tenant_id=p_tenant AND d.entity_id=p_entity AND d.fixed_asset_register_evidence_id=p_asset AND j.journal_date<=period.ends_on);
 readiness:=CASE WHEN asset.status<>'ACTIVE' THEN 'BLOCKED_ASSET_INACTIVE' WHEN period.status<>'OPEN' THEN 'BLOCKED_PERIOD_NOT_OPEN' WHEN posting.binding_id IS NULL OR acquisition.binding_id IS NULL THEN 'BLOCKED_ACQUISITION_NOT_POSTED' WHEN NOT source_ready THEN 'BLOCKED_ACQUISITION_EVIDENCE' WHEN NOT policy_covered THEN 'BLOCKED_POST_IMPAIRMENT_POLICY_REQUIRED' WHEN disposal THEN 'BLOCKED_ASSET_DISPOSED' WHEN (schedule->>'expected_period_depreciation')::numeric<=0 THEN 'BLOCKED_NOT_DUE' WHEN actual_cost<>asset.cost_basis THEN 'BLOCKED_COST_RECONCILIATION' WHEN actual_prior<>(schedule->>'expected_prior_accumulated_depreciation')::numeric THEN 'BLOCKED_PRIOR_DEPRECIATION_RECONCILIATION' WHEN current_lines<>0 OR EXISTS(SELECT 1 FROM fixed_asset_depreciation_posting WHERE tenant_id=p_tenant AND entity_id=p_entity AND fixed_asset_register_evidence_id=p_asset AND accounting_period_id=p_period) THEN 'BLOCKED_ALREADY_POSTED' ELSE 'READY' END;
 SELECT coalesce(jsonb_agg(to_jsonb(j) ORDER BY j.journal_entry_id),'[]'::jsonb) INTO pending FROM (SELECT j.journal_entry_id,j.period_id,j.journal_number,j.journal_date,j.status,j.revision FROM fixed_asset_depreciation_binding b JOIN journal_entry j ON j.tenant_id=b.tenant_id AND j.entity_id=b.entity_id AND j.journal_entry_id=b.journal_entry_id WHERE b.tenant_id=p_tenant AND b.entity_id=p_entity AND b.fixed_asset_register_evidence_id=p_asset AND b.accounting_period_id=p_period AND j.status IN('DRAFT','PENDING_REVIEW','PENDING_APPROVAL','APPROVED') ORDER BY j.journal_entry_id LIMIT 21) j;
 more_pending:=jsonb_array_length(pending)>20;IF more_pending THEN SELECT jsonb_agg(value ORDER BY ordinal) INTO pending FROM jsonb_array_elements(pending) WITH ORDINALITY x(value,ordinal) WHERE ordinal<=20;END IF;
 RETURN jsonb_build_object('schema_version','FIXED_ASSET_DEPRECIATION_OPTIONS_V2','tenant_id',p_tenant,'entity_id',p_entity,'asset_id',p_asset,'asset_tag',asset.asset_tag,'evidence_status',asset.status,'register_evidence_hash',asset.register_evidence_hash,'member_trace',asset.member_trace,'currency',asset.currency,'cost_basis',asset.cost_basis::text,'salvage_value',asset.salvage_value::text,'asset_account_code',asset.asset_account_code,'accumulated_depreciation_account_code',asset.accumulated_depreciation_account_code,'depreciation_expense_account_code',asset.depreciation_expense_account_code,
  'period',jsonb_build_object('period_id',period.period_id,'period_code',period.period_code,'starts_on',period.starts_on,'ends_on',period.ends_on,'status',period.status),'source',CASE WHEN acquisition.binding_id IS NULL THEN NULL ELSE jsonb_build_object('source_document_id',acquisition.source_document_id,'source_document_version',acquisition.source_document_version,'source_payload_hash',acquisition.source_payload_hash,'source_document_line_id',acquisition.source_document_line_id,'source_line_snapshot_hash',acquisition.source_line_snapshot_hash,'original_evidence_id',original.original_evidence_id,'original_evidence_hash',original.original_evidence_hash) END,'acquisition',CASE WHEN acquisition.binding_id IS NULL THEN NULL ELSE jsonb_build_object('binding_id',acquisition.binding_id,'journal_entry_id',acquisition.journal_entry_id) END,
  'policy',jsonb_build_object('policy_snapshot_id',schedule->>'policy_snapshot_id','policy_snapshot_hash',schedule->>'policy_snapshot_hash','policy_snapshot_version',(schedule->>'policy_snapshot_version')::bigint,'policy_version',(schedule->>'policy_version')::bigint),'post_impairment_policy',schedule->'post_impairment_policy',
  'schedule',jsonb_build_object('schedule_snapshot_hash',refs_jsonb_hash(schedule),'schedule_basis',schedule->>'schedule_basis','revised_period_number',CASE WHEN schedule->'revised_period_number'='null'::jsonb THEN NULL ELSE (schedule->>'revised_period_number')::integer END,'expected_period_depreciation',schedule->>'expected_period_depreciation','expected_accumulated_depreciation',schedule->>'expected_accumulated_depreciation','expected_prior_accumulated_depreciation',schedule->>'expected_prior_accumulated_depreciation'),
  'actual_posted_cost',actual_cost::text,'actual_prior_accumulated_depreciation',actual_prior::text,'acquisition_posted',posting.binding_id IS NOT NULL,'impairment_recorded',impairment,'disposal_recorded',disposal,'readiness_status',readiness,'pending_journals',pending,'more_pending_journals',more_pending,'requires_command_validation',true);
END;$$;

REVOKE ALL ON FUNCTION refs_read_fixed_asset_depreciation_options(uuid,uuid,uuid,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION refs_read_fixed_asset_depreciation_options(uuid,uuid,uuid,uuid) TO refs_app;

COMMIT;
