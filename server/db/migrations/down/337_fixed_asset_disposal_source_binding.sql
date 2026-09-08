BEGIN;
LOCK TABLE fixed_asset_disposal_source_binding IN SHARE MODE;
DO $$ BEGIN IF EXISTS(SELECT 1 FROM fixed_asset_disposal_source_binding) THEN RAISE EXCEPTION 'Cannot remove retained disposal source bindings' USING ERRCODE='55006';END IF;END; $$;
CREATE OR REPLACE FUNCTION refs_review_fixed_asset_disposal(p_tenant uuid,p_entity uuid,p_register uuid,p_period uuid,p_source uuid,p_date date,p_accum numeric,p_proceeds numeric,p_reason text,p_idempotency_key text,p_request_hash text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE actor text:=refs_current_actor();asset fixed_asset_register_evidence;source source_document;idem idempotency_receipt;period accounting_period;credit numeric(20,4);posted_accum numeric(20,4);posted_proceeds numeric(20,4);posted_gain numeric(20,4);prior_depreciation numeric(20,4);posted_impairment numeric(20,4):=0;impairment_accounts text[];impairment_history uuid[]:=ARRAY[]::uuid[];imp_balance record;je_ids uuid[];jl_ids uuid[];ll_ids uuid[];carrying numeric(20,4);gain_loss numeric(20,4);evidence_hash text;disposal_id uuid:=gen_random_uuid();payload jsonb;result jsonb;
BEGIN
  PERFORM refs_assert_scope(p_tenant,p_entity,'FIXED_ASSET.DISPOSAL.REVIEW');IF actor IS NULL THEN RAISE EXCEPTION 'Authenticated disposal reviewer missing' USING ERRCODE='42501';END IF;
  evidence_hash:=refs_review_fixed_asset_disposal_hash(p_tenant,p_entity,p_register,p_period,p_source,p_date,p_accum,p_proceeds,p_reason);IF p_request_hash IS DISTINCT FROM evidence_hash OR p_accum IS NULL OR p_proceeds IS NULL OR p_accum<0 OR p_proceeds<0 OR length(btrim(COALESCE(p_reason,''))) NOT BETWEEN 8 AND 2000 THEN RAISE EXCEPTION 'Disposal review payload is invalid or non-canonical' USING ERRCODE='22023';END IF;
  INSERT INTO idempotency_receipt(tenant_id,operation_scope,idempotency_key,request_hash,status,actor_id) VALUES(p_tenant,'FIXED_ASSET_DISPOSAL_REVIEW:'||p_entity,p_idempotency_key,p_request_hash,'IN_PROGRESS',actor) ON CONFLICT(tenant_id,operation_scope,idempotency_key) DO NOTHING;SELECT * INTO idem FROM idempotency_receipt WHERE tenant_id=p_tenant AND operation_scope='FIXED_ASSET_DISPOSAL_REVIEW:'||p_entity AND idempotency_key=p_idempotency_key FOR UPDATE;IF idem.request_hash<>p_request_hash OR idem.actor_id IS DISTINCT FROM actor THEN RAISE EXCEPTION 'Disposal review idempotency conflict' USING ERRCODE='23505';END IF;IF idem.status='SUCCEEDED' THEN RETURN idem.response_body||jsonb_build_object('idempotent',true);END IF;
  SELECT * INTO asset FROM fixed_asset_register_evidence WHERE tenant_id=p_tenant AND entity_id=p_entity AND fixed_asset_register_evidence_id=p_register FOR UPDATE;IF NOT FOUND OR asset.status<>'ACTIVE' OR asset.reviewed_by=actor OR p_date<asset.placed_in_service_date OR p_accum>asset.cost_basis THEN RAISE EXCEPTION 'Independent disposal review requires active asset evidence, valid dates and a different actor' USING ERRCODE='23514';END IF;
  IF EXISTS(SELECT 1 FROM fixed_asset_impairment_assessment_evidence WHERE tenant_id=p_tenant AND entity_id=p_entity AND fixed_asset_register_evidence_id=p_register AND assessment_date>=p_date) THEN RAISE EXCEPTION 'Disposal date conflicts with an existing same-date or later impairment assessment' USING ERRCODE='23514';END IF;
  SELECT * INTO period FROM accounting_period WHERE tenant_id=p_tenant AND entity_id=p_entity AND period_id=p_period AND ledger_code='PRIMARY' FOR SHARE;IF NOT FOUND OR p_date NOT BETWEEN period.starts_on AND period.ends_on THEN RAISE EXCEPTION 'Disposal date must be in the exact primary accounting period' USING ERRCODE='23514';END IF;
  SELECT * INTO source FROM source_document WHERE tenant_id=p_tenant AND entity_id=p_entity AND source_document_id=p_source FOR SHARE;IF NOT FOUND OR source.version<1 OR source.status NOT IN('READY_FOR_DRAFT','DRAFT_CREATED','PENDING_JE_REVIEW','PENDING_JE_APPROVAL','APPROVED','POSTED') THEN RAISE EXCEPTION 'Retained disposal source is missing or unavailable' USING ERRCODE='23514';END IF;
  SELECT sum(l.credit_amount-l.debit_amount)::numeric(20,4),array_agg(DISTINCT l.journal_entry_id ORDER BY l.journal_entry_id),array_agg(DISTINCT l.journal_line_id ORDER BY l.journal_line_id),array_agg(DISTINCT l.ledger_line_id ORDER BY l.ledger_line_id) INTO credit,je_ids,jl_ids,ll_ids FROM ledger_line l JOIN journal_entry j ON j.tenant_id=l.tenant_id AND j.entity_id=l.entity_id AND j.journal_entry_id=l.journal_entry_id AND j.status='POSTED' WHERE l.tenant_id=p_tenant AND l.entity_id=p_entity AND l.account_code=asset.asset_account_code AND l.dimensions->>'fixed_asset_register_evidence_id'=p_register::text AND j.journal_date BETWEEN period.starts_on AND least(period.ends_on,p_date) AND l.credit_amount>l.debit_amount;
  IF credit IS NULL OR credit<>asset.cost_basis THEN RAISE EXCEPTION 'Posted asset credit must exactly equal the reviewed disposed cost' USING ERRCODE='23514';END IF;
  -- The complete disposal journal must belong to this exact asset and currency.
  IF EXISTS(SELECT 1 FROM ledger_line l WHERE l.tenant_id=p_tenant AND l.entity_id=p_entity AND l.journal_entry_id=ANY(je_ids)
    AND (l.dimensions->>'fixed_asset_register_evidence_id' IS DISTINCT FROM p_register::text OR l.currency<>asset.currency)) THEN
    RAISE EXCEPTION 'Disposal journals contain unrelated asset lines or currency' USING ERRCODE='23514';
  END IF;
  SELECT coalesce(array_agg(DISTINCT accumulated_impairment_account_code ORDER BY accumulated_impairment_account_code),ARRAY[]::text[]) INTO impairment_accounts
    FROM fixed_asset_impairment_assessment_evidence WHERE tenant_id=p_tenant AND entity_id=p_entity AND fixed_asset_register_evidence_id=p_register;
  IF asset.asset_account_code=ANY(impairment_accounts) OR asset.accumulated_depreciation_account_code=ANY(impairment_accounts) THEN
    RAISE EXCEPTION 'Impairment and asset depreciation accounts must be distinct' USING ERRCODE='23514';
  END IF;
  IF EXISTS(SELECT 1 FROM ledger_line l JOIN journal_entry j ON j.tenant_id=l.tenant_id AND j.entity_id=l.entity_id AND j.journal_entry_id=l.journal_entry_id AND j.status='POSTED'
    LEFT JOIN fixed_asset_impairment_assessment_evidence i ON i.tenant_id=l.tenant_id AND i.entity_id=l.entity_id AND i.fixed_asset_impairment_assessment_evidence_id::text=l.dimensions->>'fixed_asset_impairment_assessment_evidence_id'
    WHERE l.tenant_id=p_tenant AND l.entity_id=p_entity AND l.dimensions->>'fixed_asset_register_evidence_id'=p_register::text AND l.account_code=ANY(impairment_accounts)
      AND j.journal_date<=p_date AND NOT(l.journal_entry_id=ANY(je_ids))
      AND (i.fixed_asset_impairment_assessment_evidence_id IS NULL OR i.fixed_asset_register_evidence_id<>p_register OR i.accumulated_impairment_account_code<>l.account_code OR j.journal_date<i.assessment_date OR l.currency<>i.currency OR i.currency<>asset.currency)) THEN
    RAISE EXCEPTION 'Posted impairment must bind an exact compatible immutable assessment' USING ERRCODE='23514';
  END IF;
  IF EXISTS(SELECT 1 FROM ledger_line l JOIN journal_entry j ON j.tenant_id=l.tenant_id AND j.entity_id=l.entity_id AND j.journal_entry_id=l.journal_entry_id AND j.status='POSTED'
    JOIN fixed_asset_impairment_assessment_evidence i ON i.tenant_id=l.tenant_id AND i.entity_id=l.entity_id AND i.fixed_asset_impairment_assessment_evidence_id::text=l.dimensions->>'fixed_asset_impairment_assessment_evidence_id'
    WHERE l.tenant_id=p_tenant AND l.entity_id=p_entity AND l.dimensions->>'fixed_asset_register_evidence_id'=p_register::text AND l.account_code=ANY(impairment_accounts)
      AND j.journal_date<=p_date AND NOT(l.journal_entry_id=ANY(je_ids))
    GROUP BY i.fixed_asset_impairment_assessment_evidence_id,i.impairment_loss HAVING sum(l.credit_amount-l.debit_amount)<>i.impairment_loss) THEN
    RAISE EXCEPTION 'Posted impairment amount differs from its immutable assessment loss' USING ERRCODE='23514';
  END IF;
  FOR imp_balance IN
    SELECT a.code,
      coalesce(sum(l.credit_amount-l.debit_amount) FILTER(WHERE NOT(l.journal_entry_id=ANY(je_ids))),0) prior_credit,
      coalesce(sum(l.debit_amount-l.credit_amount) FILTER(WHERE l.journal_entry_id=ANY(je_ids)),0) disposal_debit,
      coalesce(array_agg(l.ledger_line_id ORDER BY l.ledger_line_id) FILTER(WHERE NOT(l.journal_entry_id=ANY(je_ids))),ARRAY[]::uuid[]) history_ids
    FROM unnest(impairment_accounts) a(code)
    LEFT JOIN (SELECT ll.* FROM ledger_line ll JOIN journal_entry j ON j.tenant_id=ll.tenant_id AND j.entity_id=ll.entity_id AND j.journal_entry_id=ll.journal_entry_id
       WHERE ll.tenant_id=p_tenant AND ll.entity_id=p_entity AND j.status='POSTED' AND j.journal_date<=p_date AND ll.dimensions->>'fixed_asset_register_evidence_id'=p_register::text) l ON l.account_code=a.code
    GROUP BY a.code ORDER BY a.code
  LOOP
    IF imp_balance.prior_credit<0 OR imp_balance.disposal_debit<>imp_balance.prior_credit THEN
      RAISE EXCEPTION 'Disposal must exactly reverse every Posted accumulated impairment balance' USING ERRCODE='23514';
    END IF;
    posted_impairment:=posted_impairment+imp_balance.prior_credit;
    impairment_history:=impairment_history||imp_balance.history_ids;
  END LOOP;
  SELECT coalesce(sum(l.credit_amount-l.debit_amount),0) INTO prior_depreciation
    FROM ledger_line l JOIN journal_entry j ON j.tenant_id=l.tenant_id AND j.entity_id=l.entity_id AND j.journal_entry_id=l.journal_entry_id AND j.status='POSTED'
    WHERE l.tenant_id=p_tenant AND l.entity_id=p_entity AND l.account_code=asset.accumulated_depreciation_account_code AND l.dimensions->>'fixed_asset_register_evidence_id'=p_register::text
      AND j.journal_date<=p_date AND NOT(l.journal_entry_id=ANY(je_ids));
  IF prior_depreciation<>p_accum OR p_accum+posted_impairment>asset.cost_basis THEN
    RAISE EXCEPTION 'Disposal depreciation and impairment must match prior Posted carrying value' USING ERRCODE='23514';
  END IF;
  SELECT coalesce(sum(l.debit_amount-l.credit_amount) FILTER(WHERE l.account_code=asset.accumulated_depreciation_account_code),0),
    coalesce(sum(l.debit_amount-l.credit_amount) FILTER(WHERE a.required_member_type IN('BANK','CUSTOMER_OR_AFFILIATE')),0),
    coalesce(sum(l.credit_amount-l.debit_amount) FILTER(WHERE l.account_code NOT IN(asset.asset_account_code,asset.accumulated_depreciation_account_code)
      AND NOT(l.account_code=ANY(impairment_accounts)) AND coalesce(a.required_member_type,'') NOT IN('BANK','CUSTOMER_OR_AFFILIATE')),0),
    array_agg(DISTINCT l.journal_line_id ORDER BY l.journal_line_id),array_agg(DISTINCT l.ledger_line_id ORDER BY l.ledger_line_id)
    INTO posted_accum,posted_proceeds,posted_gain,jl_ids,ll_ids
    FROM ledger_line l JOIN account_master a ON a.tenant_id=l.tenant_id AND a.entity_id=l.entity_id AND a.account_code=l.account_code
    WHERE l.tenant_id=p_tenant AND l.entity_id=p_entity AND l.journal_entry_id=ANY(je_ids);
  carrying:=asset.cost_basis-p_accum-posted_impairment;gain_loss:=p_proceeds-carrying;
  IF posted_accum<>p_accum OR posted_proceeds<>p_proceeds OR posted_gain<>gain_loss THEN
    RAISE EXCEPTION 'Disposal amounts do not reconcile to complete Posted depreciation proceeds and gain lines' USING ERRCODE='23514';
  END IF;

  INSERT INTO fixed_asset_disposal_evidence(fixed_asset_disposal_evidence_id,tenant_id,entity_id,fixed_asset_register_evidence_id,accounting_period_id,disposal_source_document_id,disposal_source_payload_hash,disposal_date,currency,disposed_cost,accumulated_depreciation,accumulated_impairment,impairment_ledger_line_ids,carrying_value,proceeds,gain_or_loss,posted_asset_credit,journal_entry_ids,journal_line_ids,ledger_line_ids,reviewed_by,review_reason,disposal_evidence_hash,status) VALUES(disposal_id,p_tenant,p_entity,p_register,p_period,p_source,source.payload_hash,p_date,asset.currency,asset.cost_basis,p_accum,posted_impairment,impairment_history,carrying,p_proceeds,gain_loss,credit,je_ids,jl_ids,ll_ids,actor,btrim(p_reason),evidence_hash,'REVIEWED');
  payload:=jsonb_build_object('schema_version','FIXED_ASSET_DISPOSAL_EVIDENCE_V1','lineage_version','POSTED_DISPOSAL_LINES_V2','timeline_version','DISPOSAL_TIMELINE_V1','carrying_version','DISPOSAL_CARRYING_V2','fixed_asset_disposal_evidence_id',disposal_id,'fixed_asset_register_evidence_id',p_register,'accounting_period_id',p_period,'disposal_source_document_id',p_source,'disposal_source_payload_hash',source.payload_hash,'disposal_date',p_date,'currency',asset.currency,'disposed_cost',to_char(asset.cost_basis,'FM999999999999990.0000'),'accumulated_depreciation',to_char(p_accum,'FM999999999999990.0000'),'accumulated_impairment',to_char(posted_impairment,'FM999999999999990.0000'),'impairment_ledger_line_ids',impairment_history,'carrying_value',to_char(carrying,'FM999999999999990.0000'),'proceeds',to_char(p_proceeds,'FM999999999999990.0000'),'gain_or_loss',to_char(gain_loss,'FM999999999999990.0000'),'posted_asset_credit',to_char(credit,'FM999999999999990.0000'),'journal_entry_ids',je_ids,'journal_line_ids',jl_ids,'ledger_line_ids',ll_ids,'disposal_evidence_hash',evidence_hash,'status','REVIEWED','can_create_draft',false,'can_review',false,'can_approve',false,'can_post',false);
  INSERT INTO audit_event(tenant_id,entity_id,event_type,object_type,object_id,action,actor_id,actor_type,permission_used,request_id,correlation_id,idempotency_key,after_hash,reason,metadata) VALUES(p_tenant,p_entity,'FIXED_ASSET_DISPOSAL_REVIEWED','FIXED_ASSET_DISPOSAL_EVIDENCE',disposal_id,'REVIEW',actor,'USER','FIXED_ASSET.DISPOSAL.REVIEW',p_idempotency_key,p_idempotency_key,p_idempotency_key,evidence_hash,btrim(p_reason),payload);INSERT INTO outbox_event(tenant_id,entity_id,aggregate_type,aggregate_id,event_type,payload,payload_hash) VALUES(p_tenant,p_entity,'FIXED_ASSET_DISPOSAL_EVIDENCE',disposal_id,'FIXED_ASSET_DISPOSAL_REVIEWED',payload,refs_jsonb_hash(payload));result:=payload||jsonb_build_object('idempotent',false);UPDATE idempotency_receipt SET status='SUCCEEDED',response_status=201,response_body=result,completed_at=clock_timestamp() WHERE idempotency_receipt_id=idem.idempotency_receipt_id;RETURN result;
END;$$;
DROP FUNCTION refs_bind_fixed_asset_disposal_source(uuid,uuid,uuid,uuid,uuid,text,bigint,text,text,text);
DROP FUNCTION refs_bind_fixed_asset_disposal_source_hash(uuid,uuid,uuid,uuid,uuid,text,bigint,text);
DROP TRIGGER fixed_asset_journal_post_guard ON journal_entry;
DROP FUNCTION refs_guard_fixed_asset_journal_post();
DROP TABLE fixed_asset_disposal_posting;
DROP TABLE fixed_asset_disposal_source_binding;
COMMIT;
