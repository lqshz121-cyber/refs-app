BEGIN;

CREATE OR REPLACE FUNCTION refs_fixed_asset_depreciation_schedule_snapshot(p_tenant uuid,p_entity uuid,p_asset uuid,p_period uuid) RETURNS jsonb
LANGUAGE sql STABLE SET search_path=pg_catalog,public,pg_temp AS $$
  WITH scoped AS (
    SELECT a.*,p.period_id,p.period_code,p.starts_on,p.ends_on,p.status period_status,proposal.policy_snapshot_id,proposal.policy_snapshot_hash,
      policy.version policy_snapshot_version,(policy.snapshot->>'policy_version')::bigint policy_version,
      round((a.cost_basis-a.salvage_value)/a.useful_life_months,4) monthly,
      greatest(0,((extract(year from p.ends_on)::int-extract(year from a.placed_in_service_date)::int)*12+extract(month from p.ends_on)::int-extract(month from a.placed_in_service_date)::int+1)) elapsed
    FROM fixed_asset_register_evidence a JOIN accounting_period p ON p.tenant_id=a.tenant_id AND p.entity_id=a.entity_id
    JOIN ai_invoice_capitalization_proposal proposal ON proposal.tenant_id=a.tenant_id AND proposal.entity_id=a.entity_id AND proposal.ai_invoice_capitalization_proposal_id=a.capitalization_proposal_id
    JOIN setting_snapshot policy ON policy.tenant_id=a.tenant_id AND policy.setting_snapshot_id=proposal.policy_snapshot_id
    WHERE a.tenant_id=p_tenant AND a.entity_id=p_entity AND a.fixed_asset_register_evidence_id=p_asset
      AND p.period_id=p_period AND p.ledger_code='PRIMARY'
      AND policy.snapshot_hash=refs_jsonb_hash(policy.snapshot) AND policy.snapshot_hash=proposal.policy_snapshot_hash
      AND policy.family='AI_CAPITALIZATION_POLICY' AND policy.status IN('APPROVED','RETIRED')
      AND policy.entity_id=p_entity AND policy.scope_type='ENTITY' AND policy.scope_key=p_entity::text
  ), amounts AS (
    SELECT *,CASE WHEN starts_on>=(placed_in_service_date-date_part('day',placed_in_service_date)::int+1) AND elapsed BETWEEN 1 AND useful_life_months
      THEN (CASE WHEN elapsed>=useful_life_months THEN cost_basis-salvage_value ELSE least(cost_basis-salvage_value,monthly*elapsed) END)
        -least(cost_basis-salvage_value,monthly*greatest(0,elapsed-1)) ELSE 0 END expected_period,
      CASE WHEN elapsed>=useful_life_months THEN cost_basis-salvage_value ELSE least(cost_basis-salvage_value,monthly*elapsed) END expected_accumulated
    FROM scoped
  )
  SELECT jsonb_build_object(
    'schema_version','FIXED_ASSET_DEPRECIATION_SCHEDULE_SNAPSHOT_V1','tenant_id',tenant_id,'entity_id',entity_id,
    'fixed_asset_register_evidence_id',fixed_asset_register_evidence_id,'register_evidence_hash',register_evidence_hash,
    'asset_tag',asset_tag,'asset_class',asset_class,'asset_status',status,'period_id',period_id,'period_code',period_code,
    'period_starts_on',starts_on,'period_ends_on',ends_on,'period_status',period_status,'placed_in_service_date',placed_in_service_date,
    'depreciation_method',depreciation_method,'depreciation_convention',depreciation_convention,'useful_life_months',useful_life_months,'member_trace',member_trace,
    'policy_snapshot_id',policy_snapshot_id,'policy_snapshot_hash',policy_snapshot_hash,'policy_snapshot_version',policy_snapshot_version,'policy_version',policy_version,
    'currency',currency,'cost_basis',to_char(cost_basis,'FM999999999999990.0000'),'salvage_value',to_char(salvage_value,'FM999999999999990.0000'),
    'expected_period_depreciation',to_char(expected_period,'FM999999999999990.0000'),
    'expected_accumulated_depreciation',to_char(expected_accumulated,'FM999999999999990.0000'),
    'expected_prior_accumulated_depreciation',to_char(expected_accumulated-expected_period,'FM999999999999990.0000'),
    'asset_account_code',asset_account_code,'accumulated_depreciation_account_code',accumulated_depreciation_account_code,
    'depreciation_expense_account_code',depreciation_expense_account_code)
  FROM amounts
$$;
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
 IF (schedule->>'expected_period_depreciation')::numeric<=0 THEN RAISE EXCEPTION 'No depreciation is due for this asset and period' USING ERRCODE='23514';END IF;
 SELECT * INTO posting FROM fixed_asset_acquisition_posting WHERE tenant_id=p_tenant AND entity_id=p_entity AND asset_id=p_asset;
 IF NOT FOUND THEN RAISE EXCEPTION 'Posted acquisition is required before depreciation' USING ERRCODE='23514';END IF;
 SELECT * INTO acquisition FROM fixed_asset_acquisition_binding WHERE tenant_id=p_tenant AND entity_id=p_entity AND binding_id=posting.binding_id AND journal_entry_id=posting.journal_entry_id;
 IF NOT FOUND THEN RAISE EXCEPTION 'Posted acquisition binding is missing' USING ERRCODE='23514';END IF;
 SELECT * INTO source FROM source_document WHERE tenant_id=p_tenant AND entity_id=p_entity AND source_document_id=acquisition.source_document_id FOR SHARE;
 IF NOT FOUND OR source.version<>acquisition.source_document_version OR source.payload_hash<>acquisition.source_payload_hash OR source.currency<>asset.currency THEN RAISE EXCEPTION 'Acquisition source changed before depreciation' USING ERRCODE='40001';END IF;
 SELECT count(*) INTO source_link_count FROM source_link WHERE source_link_id=acquisition.source_link_id AND tenant_id=p_tenant AND entity_id=p_entity AND source_document_id=source.source_document_id AND journal_entry_id=posting.journal_entry_id AND link_type='SOURCE_TO_JE';
 IF source_link_count<>1 OR acquisition.attachment_snapshot_hash IS NULL OR acquisition.attachment_ids IS NULL OR cardinality(acquisition.attachment_ids)=0
  OR acquisition.attachment_snapshot_hash<>refs_asset_acquisition_attachment_snapshot(p_tenant,p_entity,source.source_document_id) THEN RAISE EXCEPTION 'Posted acquisition evidence is incomplete or changed' USING ERRCODE='23514';END IF;
 original:=refs_validate_asset_original_source(p_tenant,p_entity,p_asset);
 IF acquisition.source_document_line_id<>original.source_document_line_id OR acquisition.source_line_snapshot_hash<>refs_jsonb_hash(original.source_line_snapshot)
  OR NOT EXISTS(SELECT 1 FROM fixed_asset_original_source_binding b WHERE b.binding_id=acquisition.binding_id AND b.tenant_id=p_tenant AND b.entity_id=p_entity AND b.original_evidence_id=original.evidence_id AND b.original_evidence_hash=original.evidence_hash)
  OR schedule->>'policy_snapshot_id' IS NULL OR schedule->>'policy_snapshot_hash' IS NULL OR schedule->>'policy_snapshot_version' IS NULL OR schedule->>'policy_version' IS NULL THEN RAISE EXCEPTION 'Acquisition source line or policy evidence changed before depreciation' USING ERRCODE='23514';END IF;
 IF EXISTS(SELECT 1 FROM fixed_asset_impairment_assessment_evidence WHERE tenant_id=p_tenant AND entity_id=p_entity AND fixed_asset_register_evidence_id=p_asset AND assessment_date<=period.ends_on) THEN RAISE EXCEPTION 'Post-impairment depreciation policy is required' USING ERRCODE='0A000';END IF;
 IF EXISTS(SELECT 1 FROM fixed_asset_disposal_evidence WHERE tenant_id=p_tenant AND entity_id=p_entity AND fixed_asset_register_evidence_id=p_asset AND disposal_date<=period.ends_on)
  OR EXISTS(SELECT 1 FROM fixed_asset_disposal_posting d JOIN journal_entry j ON j.tenant_id=d.tenant_id AND j.entity_id=d.entity_id AND j.journal_entry_id=d.journal_entry_id WHERE d.tenant_id=p_tenant AND d.entity_id=p_entity AND d.fixed_asset_register_evidence_id=p_asset AND j.journal_date<=period.ends_on) THEN RAISE EXCEPTION 'Disposed asset cannot receive depreciation for this period' USING ERRCODE='23514';END IF;
 IF EXISTS(SELECT 1 FROM fixed_asset_depreciation_posting WHERE tenant_id=p_tenant AND entity_id=p_entity AND fixed_asset_register_evidence_id=p_asset AND accounting_period_id=p_period) THEN RAISE EXCEPTION 'Asset already has Posted depreciation for this period' USING ERRCODE='23514';END IF;
 SELECT coalesce(sum(l.debit_amount-l.credit_amount),0) INTO actual_cost FROM ledger_line l JOIN journal_entry j ON j.tenant_id=l.tenant_id AND j.entity_id=l.entity_id AND j.journal_entry_id=l.journal_entry_id AND j.status='POSTED'
  WHERE l.tenant_id=p_tenant AND l.entity_id=p_entity AND l.dimensions->>'fixed_asset_register_evidence_id'=p_asset::text AND l.account_code=asset.asset_account_code AND j.journal_date<=period.ends_on;
 IF actual_cost<>asset.cost_basis THEN RAISE EXCEPTION 'Posted asset cost does not reconcile to the register' USING ERRCODE='23514';END IF;
 SELECT coalesce(sum(l.credit_amount-l.debit_amount),0) INTO actual_prior FROM ledger_line l JOIN journal_entry j ON j.tenant_id=l.tenant_id AND j.entity_id=l.entity_id AND j.journal_entry_id=l.journal_entry_id AND j.status='POSTED'
  WHERE l.tenant_id=p_tenant AND l.entity_id=p_entity AND l.dimensions->>'fixed_asset_register_evidence_id'=p_asset::text AND l.account_code=asset.accumulated_depreciation_account_code AND j.journal_date<period.starts_on;
 IF actual_prior<>(schedule->>'expected_prior_accumulated_depreciation')::numeric THEN RAISE EXCEPTION 'Prior Posted depreciation does not reconcile to the retained schedule' USING ERRCODE='23514';END IF;
 SELECT count(*) INTO current_lines FROM ledger_line l JOIN journal_entry j ON j.tenant_id=l.tenant_id AND j.entity_id=l.entity_id AND j.journal_entry_id=l.journal_entry_id AND j.status='POSTED'
  WHERE l.tenant_id=p_tenant AND l.entity_id=p_entity AND l.dimensions->>'fixed_asset_register_evidence_id'=p_asset::text AND l.account_code IN(asset.depreciation_expense_account_code,asset.accumulated_depreciation_account_code) AND j.journal_date BETWEEN period.starts_on AND period.ends_on;
 IF current_lines<>0 THEN RAISE EXCEPTION 'Asset already has Posted depreciation lines in this period' USING ERRCODE='23514';END IF;
 RETURN schedule||jsonb_build_object('acquisition_binding_id',acquisition.binding_id,'acquisition_journal_entry_id',acquisition.journal_entry_id,
  'source_document_id',acquisition.source_document_id,'source_document_version',acquisition.source_document_version,'source_payload_hash',acquisition.source_payload_hash,
  'source_document_line_id',acquisition.source_document_line_id,'source_line_snapshot_hash',acquisition.source_line_snapshot_hash,'original_evidence_id',original.evidence_id,'original_evidence_hash',original.evidence_hash,
  'attachment_ids',acquisition.attachment_ids,'attachment_snapshot_hash',acquisition.attachment_snapshot_hash,
  'actual_posted_cost',to_char(actual_cost,'FM999999999999990.0000'),'actual_prior_accumulated_depreciation',to_char(actual_prior,'FM999999999999990.0000'));
END;$$;
REVOKE EXECUTE ON FUNCTION refs_validate_fixed_asset_depreciation_ready(uuid,uuid,uuid,uuid,date) FROM PUBLIC,refs_app;

CREATE OR REPLACE FUNCTION refs_read_fixed_asset_depreciation_options(p_tenant uuid,p_entity uuid,p_asset uuid,p_period uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE asset fixed_asset_register_evidence;period accounting_period;schedule jsonb;posting fixed_asset_acquisition_posting;acquisition fixed_asset_acquisition_binding;original fixed_asset_original_source_binding;verified_original wbs_payable_original_row_evidence;source source_document;actual_cost numeric(20,4):=0;actual_prior numeric(20,4):=0;current_lines integer:=0;pending jsonb;more_pending boolean;impairment boolean;disposal boolean;source_ready boolean:=false;readiness text;
BEGIN
 PERFORM refs_assert_scope(p_tenant,p_entity,'FIXED_ASSET.DEPRECIATION.DRAFT');PERFORM refs_assert_scope(p_tenant,p_entity,'GL.JE.VIEW');
 SELECT * INTO asset FROM fixed_asset_register_evidence WHERE tenant_id=p_tenant AND entity_id=p_entity AND fixed_asset_register_evidence_id=p_asset;
 IF NOT FOUND THEN RAISE EXCEPTION 'Scoped depreciation asset missing' USING ERRCODE='P0002';END IF;
 SELECT * INTO period FROM accounting_period WHERE tenant_id=p_tenant AND entity_id=p_entity AND period_id=p_period AND ledger_code='PRIMARY';
 IF NOT FOUND THEN RAISE EXCEPTION 'Scoped depreciation period missing' USING ERRCODE='P0002';END IF;
 schedule:=refs_fixed_asset_depreciation_schedule_snapshot(p_tenant,p_entity,p_asset,p_period);
 IF schedule IS NULL THEN RAISE EXCEPTION 'Depreciation schedule evidence is unavailable' USING ERRCODE='23514';END IF;
 SELECT * INTO posting FROM fixed_asset_acquisition_posting WHERE tenant_id=p_tenant AND entity_id=p_entity AND asset_id=p_asset;
 IF FOUND THEN SELECT * INTO acquisition FROM fixed_asset_acquisition_binding WHERE tenant_id=p_tenant AND entity_id=p_entity AND binding_id=posting.binding_id AND journal_entry_id=posting.journal_entry_id;END IF;
 IF acquisition.binding_id IS NOT NULL THEN
  SELECT * INTO original FROM fixed_asset_original_source_binding WHERE binding_id=acquisition.binding_id AND tenant_id=p_tenant AND entity_id=p_entity;
  SELECT * INTO source FROM source_document WHERE tenant_id=p_tenant AND entity_id=p_entity AND source_document_id=acquisition.source_document_id;
  source_ready:=coalesce(source.source_document_id IS NOT NULL AND source.version=acquisition.source_document_version AND source.payload_hash=acquisition.source_payload_hash AND source.currency=asset.currency
   AND acquisition.attachment_snapshot_hash IS NOT NULL AND acquisition.attachment_ids IS NOT NULL AND cardinality(acquisition.attachment_ids)>0
   AND acquisition.attachment_snapshot_hash=refs_asset_acquisition_attachment_snapshot(p_tenant,p_entity,acquisition.source_document_id)
   AND original.binding_id IS NOT NULL AND EXISTS(SELECT 1 FROM source_link WHERE source_link_id=acquisition.source_link_id AND tenant_id=p_tenant AND entity_id=p_entity AND source_document_id=acquisition.source_document_id AND journal_entry_id=acquisition.journal_entry_id AND link_type='SOURCE_TO_JE'),false);
  IF source_ready THEN BEGIN
   verified_original:=refs_validate_asset_original_source(p_tenant,p_entity,p_asset);
   source_ready:=acquisition.source_document_line_id=verified_original.source_document_line_id
    AND acquisition.source_line_snapshot_hash=refs_jsonb_hash(verified_original.source_line_snapshot)
    AND original.original_evidence_id=verified_original.evidence_id AND original.original_evidence_hash=verified_original.evidence_hash;
  EXCEPTION WHEN check_violation OR foreign_key_violation OR object_in_use OR object_not_in_prerequisite_state OR data_exception THEN source_ready:=false;END;END IF;
 END IF;
 SELECT coalesce(sum(l.debit_amount-l.credit_amount),0) INTO actual_cost FROM ledger_line l JOIN journal_entry j ON j.tenant_id=l.tenant_id AND j.entity_id=l.entity_id AND j.journal_entry_id=l.journal_entry_id AND j.status='POSTED' WHERE l.tenant_id=p_tenant AND l.entity_id=p_entity AND l.dimensions->>'fixed_asset_register_evidence_id'=p_asset::text AND l.account_code=asset.asset_account_code AND j.journal_date<=period.ends_on;
 SELECT coalesce(sum(l.credit_amount-l.debit_amount),0) INTO actual_prior FROM ledger_line l JOIN journal_entry j ON j.tenant_id=l.tenant_id AND j.entity_id=l.entity_id AND j.journal_entry_id=l.journal_entry_id AND j.status='POSTED' WHERE l.tenant_id=p_tenant AND l.entity_id=p_entity AND l.dimensions->>'fixed_asset_register_evidence_id'=p_asset::text AND l.account_code=asset.accumulated_depreciation_account_code AND j.journal_date<period.starts_on;
 SELECT count(*) INTO current_lines FROM ledger_line l JOIN journal_entry j ON j.tenant_id=l.tenant_id AND j.entity_id=l.entity_id AND j.journal_entry_id=l.journal_entry_id AND j.status='POSTED' WHERE l.tenant_id=p_tenant AND l.entity_id=p_entity AND l.dimensions->>'fixed_asset_register_evidence_id'=p_asset::text AND l.account_code IN(asset.depreciation_expense_account_code,asset.accumulated_depreciation_account_code) AND j.journal_date BETWEEN period.starts_on AND period.ends_on;
 impairment:=EXISTS(SELECT 1 FROM fixed_asset_impairment_assessment_evidence WHERE tenant_id=p_tenant AND entity_id=p_entity AND fixed_asset_register_evidence_id=p_asset AND assessment_date<=period.ends_on);
 disposal:=EXISTS(SELECT 1 FROM fixed_asset_disposal_evidence WHERE tenant_id=p_tenant AND entity_id=p_entity AND fixed_asset_register_evidence_id=p_asset AND disposal_date<=period.ends_on) OR EXISTS(SELECT 1 FROM fixed_asset_disposal_posting d JOIN journal_entry j ON j.tenant_id=d.tenant_id AND j.entity_id=d.entity_id AND j.journal_entry_id=d.journal_entry_id WHERE d.tenant_id=p_tenant AND d.entity_id=p_entity AND d.fixed_asset_register_evidence_id=p_asset AND j.journal_date<=period.ends_on);
 readiness:=CASE WHEN asset.status<>'ACTIVE' THEN 'BLOCKED_ASSET_INACTIVE' WHEN period.status<>'OPEN' THEN 'BLOCKED_PERIOD_NOT_OPEN' WHEN posting.binding_id IS NULL OR acquisition.binding_id IS NULL THEN 'BLOCKED_ACQUISITION_NOT_POSTED' WHEN NOT source_ready THEN 'BLOCKED_ACQUISITION_EVIDENCE' WHEN impairment THEN 'BLOCKED_POST_IMPAIRMENT_POLICY_REQUIRED' WHEN disposal THEN 'BLOCKED_ASSET_DISPOSED' WHEN (schedule->>'expected_period_depreciation')::numeric<=0 THEN 'BLOCKED_NOT_DUE' WHEN actual_cost<>asset.cost_basis THEN 'BLOCKED_COST_RECONCILIATION' WHEN actual_prior<>(schedule->>'expected_prior_accumulated_depreciation')::numeric THEN 'BLOCKED_PRIOR_DEPRECIATION_RECONCILIATION' WHEN current_lines<>0 OR EXISTS(SELECT 1 FROM fixed_asset_depreciation_posting WHERE tenant_id=p_tenant AND entity_id=p_entity AND fixed_asset_register_evidence_id=p_asset AND accounting_period_id=p_period) THEN 'BLOCKED_ALREADY_POSTED' ELSE 'READY' END;
 SELECT coalesce(jsonb_agg(to_jsonb(j) ORDER BY j.journal_entry_id),'[]'::jsonb) INTO pending FROM (SELECT j.journal_entry_id,j.period_id,j.journal_number,j.journal_date,j.status,j.revision FROM fixed_asset_depreciation_binding b JOIN journal_entry j ON j.tenant_id=b.tenant_id AND j.entity_id=b.entity_id AND j.journal_entry_id=b.journal_entry_id WHERE b.tenant_id=p_tenant AND b.entity_id=p_entity AND b.fixed_asset_register_evidence_id=p_asset AND b.accounting_period_id=p_period AND j.status IN('DRAFT','PENDING_REVIEW','PENDING_APPROVAL','APPROVED') ORDER BY j.journal_entry_id LIMIT 21) j;
 more_pending:=jsonb_array_length(pending)>20;IF more_pending THEN SELECT jsonb_agg(value ORDER BY ordinal) INTO pending FROM jsonb_array_elements(pending) WITH ORDINALITY x(value,ordinal) WHERE ordinal<=20;END IF;
 RETURN jsonb_build_object('schema_version','FIXED_ASSET_DEPRECIATION_OPTIONS_V1','tenant_id',p_tenant,'entity_id',p_entity,'asset_id',p_asset,'asset_tag',asset.asset_tag,'evidence_status',asset.status,'register_evidence_hash',asset.register_evidence_hash,'member_trace',asset.member_trace,'currency',asset.currency,'cost_basis',asset.cost_basis::text,'salvage_value',asset.salvage_value::text,'asset_account_code',asset.asset_account_code,'accumulated_depreciation_account_code',asset.accumulated_depreciation_account_code,'depreciation_expense_account_code',asset.depreciation_expense_account_code,'period',jsonb_build_object('period_id',period.period_id,'period_code',period.period_code,'starts_on',period.starts_on,'ends_on',period.ends_on,'status',period.status),'source',CASE WHEN acquisition.binding_id IS NULL THEN NULL ELSE jsonb_build_object('source_document_id',acquisition.source_document_id,'source_document_version',acquisition.source_document_version,'source_payload_hash',acquisition.source_payload_hash,'source_document_line_id',acquisition.source_document_line_id,'source_line_snapshot_hash',acquisition.source_line_snapshot_hash,'original_evidence_id',original.original_evidence_id,'original_evidence_hash',original.original_evidence_hash) END,'acquisition',CASE WHEN acquisition.binding_id IS NULL THEN NULL ELSE jsonb_build_object('binding_id',acquisition.binding_id,'journal_entry_id',acquisition.journal_entry_id) END,'policy',jsonb_build_object('policy_snapshot_id',schedule->>'policy_snapshot_id','policy_snapshot_hash',schedule->>'policy_snapshot_hash','policy_snapshot_version',(schedule->>'policy_snapshot_version')::bigint,'policy_version',(schedule->>'policy_version')::bigint),'schedule',jsonb_build_object('schedule_snapshot_hash',refs_jsonb_hash(schedule),'expected_period_depreciation',schedule->>'expected_period_depreciation','expected_accumulated_depreciation',schedule->>'expected_accumulated_depreciation','expected_prior_accumulated_depreciation',schedule->>'expected_prior_accumulated_depreciation'),'actual_posted_cost',actual_cost::text,'actual_prior_accumulated_depreciation',actual_prior::text,'acquisition_posted',posting.binding_id IS NOT NULL,'impairment_recorded',impairment,'disposal_recorded',disposal,'readiness_status',readiness,'pending_journals',pending,'more_pending_journals',more_pending,'requires_command_validation',true);
END;$$;

DROP FUNCTION refs_validated_fixed_asset_post_impairment_policy(uuid,uuid,uuid,date);
DROP FUNCTION refs_validated_fixed_asset_post_impairment_policy_for_assessment(uuid,uuid,uuid,uuid,date);
REVOKE ALL ON FUNCTION refs_read_fixed_asset_depreciation_options(uuid,uuid,uuid,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION refs_read_fixed_asset_depreciation_options(uuid,uuid,uuid,uuid) TO refs_app;

COMMIT;
