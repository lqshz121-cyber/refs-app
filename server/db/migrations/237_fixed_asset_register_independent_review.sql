BEGIN;

CREATE FUNCTION refs_review_fixed_asset_register_hash(
  p_tenant uuid,p_entity uuid,p_proposal uuid,p_asset_tag text,p_salvage numeric,
  p_accumulated_depreciation_account text,p_depreciation_expense_account text,
  p_method text,p_convention text,p_reason text
) RETURNS text LANGUAGE sql IMMUTABLE SET search_path=pg_catalog,public,pg_temp AS $$
  SELECT refs_jsonb_hash(jsonb_build_object(
    'schema_version','FIXED_ASSET_REGISTER_REVIEW_V1','tenant_id',p_tenant,'entity_id',p_entity,
    'capitalization_proposal_id',p_proposal,'asset_tag',btrim(p_asset_tag),'salvage_value',to_char(p_salvage,'FM999999999999990.0000'),
    'accumulated_depreciation_account_code',btrim(p_accumulated_depreciation_account),
    'depreciation_expense_account_code',btrim(p_depreciation_expense_account),
    'depreciation_method',p_method,'depreciation_convention',p_convention,'reason',btrim(p_reason)))
$$;

CREATE FUNCTION refs_review_fixed_asset_register(
  p_tenant uuid,p_entity uuid,p_proposal uuid,p_asset_tag text,p_salvage numeric,
  p_accumulated_depreciation_account text,p_depreciation_expense_account text,
  p_method text,p_convention text,p_reason text,p_idempotency_key text,p_request_hash text
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE actor text:=refs_current_actor();proposal ai_invoice_capitalization_proposal;source source_document;idem idempotency_receipt;register_id uuid:=gen_random_uuid();evidence_hash text;payload jsonb;result jsonb;
BEGIN
  PERFORM refs_assert_scope(p_tenant,p_entity,'FIXED_ASSET.REGISTER.REVIEW');
  IF actor IS NULL THEN RAISE EXCEPTION 'Authenticated fixed asset reviewer missing' USING ERRCODE='42501'; END IF;
  evidence_hash:=refs_review_fixed_asset_register_hash(p_tenant,p_entity,p_proposal,p_asset_tag,p_salvage,p_accumulated_depreciation_account,p_depreciation_expense_account,p_method,p_convention,p_reason);
  IF p_request_hash IS DISTINCT FROM evidence_hash OR length(btrim(COALESCE(p_asset_tag,''))) NOT BETWEEN 1 AND 100 OR p_salvage IS NULL OR p_salvage<0 OR p_method<>'STRAIGHT_LINE' OR p_convention<>'FULL_MONTH' OR length(btrim(COALESCE(p_reason,''))) NOT BETWEEN 8 AND 2000 OR btrim(COALESCE(p_accumulated_depreciation_account,''))='' OR btrim(COALESCE(p_depreciation_expense_account,''))='' OR btrim(p_accumulated_depreciation_account)=btrim(p_depreciation_expense_account) THEN RAISE EXCEPTION 'Fixed asset register review payload is invalid or non-canonical' USING ERRCODE='22023'; END IF;
  INSERT INTO idempotency_receipt(tenant_id,operation_scope,idempotency_key,request_hash,status,actor_id) VALUES(p_tenant,'FIXED_ASSET_REGISTER_REVIEW:'||p_entity,p_idempotency_key,p_request_hash,'IN_PROGRESS',actor) ON CONFLICT(tenant_id,operation_scope,idempotency_key) DO NOTHING;
  SELECT * INTO idem FROM idempotency_receipt WHERE tenant_id=p_tenant AND operation_scope='FIXED_ASSET_REGISTER_REVIEW:'||p_entity AND idempotency_key=p_idempotency_key FOR UPDATE;
  IF idem.request_hash<>p_request_hash OR idem.actor_id IS DISTINCT FROM actor THEN RAISE EXCEPTION 'Fixed asset register idempotency key conflicts with another payload or actor' USING ERRCODE='23505'; END IF;
  IF idem.status='SUCCEEDED' THEN RETURN idem.response_body||jsonb_build_object('idempotent',true); END IF;
  SELECT * INTO proposal FROM ai_invoice_capitalization_proposal WHERE tenant_id=p_tenant AND entity_id=p_entity AND ai_invoice_capitalization_proposal_id=p_proposal FOR SHARE;
  IF NOT FOUND OR proposal.status<>'PROPOSED' OR proposal.capitalization_treatment<>'FIXED_ASSET' OR proposal.placed_in_service_date IS NULL OR proposal.useful_life_months IS NULL OR proposal.created_by=actor OR p_salvage>=proposal.amount THEN RAISE EXCEPTION 'Independent review requires a different actor and complete FIXED_ASSET proposal evidence' USING ERRCODE='23514'; END IF;
  SELECT * INTO source FROM source_document WHERE tenant_id=p_tenant AND entity_id=p_entity AND source_document_id=proposal.source_document_id FOR SHARE;
  IF NOT FOUND OR source.payload_hash<>proposal.source_payload_hash OR source.version<1 OR source.status NOT IN('READY_FOR_DRAFT','DRAFT_CREATED','PENDING_JE_REVIEW','PENDING_JE_APPROVAL','APPROVED','POSTED') THEN RAISE EXCEPTION 'Fixed asset source is missing or changed' USING ERRCODE='23514'; END IF;
  IF proposal.asset_account_code IN(btrim(p_accumulated_depreciation_account),btrim(p_depreciation_expense_account)) THEN RAISE EXCEPTION 'Fixed asset accounting roles must use distinct accounts' USING ERRCODE='23514'; END IF;
  PERFORM 1 FROM account_master WHERE tenant_id=p_tenant AND entity_id=p_entity AND account_code=btrim(p_accumulated_depreciation_account) AND active FOR SHARE;IF NOT FOUND THEN RAISE EXCEPTION 'Accumulated depreciation account is inactive or missing' USING ERRCODE='23503'; END IF;
  PERFORM 1 FROM account_master WHERE tenant_id=p_tenant AND entity_id=p_entity AND account_code=btrim(p_depreciation_expense_account) AND active FOR SHARE;IF NOT FOUND THEN RAISE EXCEPTION 'Depreciation expense account is inactive or missing' USING ERRCODE='23503'; END IF;
  INSERT INTO fixed_asset_register_evidence(fixed_asset_register_evidence_id,tenant_id,entity_id,capitalization_proposal_id,source_document_id,source_payload_hash,asset_tag,asset_class,currency,cost_basis,salvage_value,placed_in_service_date,useful_life_months,depreciation_method,depreciation_convention,asset_account_code,accumulated_depreciation_account_code,depreciation_expense_account_code,member_trace,status,reviewed_by,review_reason,register_evidence_hash) VALUES(register_id,p_tenant,p_entity,p_proposal,proposal.source_document_id,proposal.source_payload_hash,btrim(p_asset_tag),proposal.asset_class,proposal.currency,proposal.amount,p_salvage,proposal.placed_in_service_date,proposal.useful_life_months,p_method,p_convention,proposal.asset_account_code,btrim(p_accumulated_depreciation_account),btrim(p_depreciation_expense_account),proposal.member_trace,'ACTIVE',actor,btrim(p_reason),evidence_hash);
  payload:=jsonb_build_object('schema_version','FIXED_ASSET_REGISTER_EVIDENCE_V1','fixed_asset_register_evidence_id',register_id,'capitalization_proposal_id',p_proposal,'source_document_id',proposal.source_document_id,'source_payload_hash',proposal.source_payload_hash,'asset_tag',btrim(p_asset_tag),'asset_class',proposal.asset_class,'currency',proposal.currency,'cost_basis',to_char(proposal.amount,'FM999999999999990.0000'),'salvage_value',to_char(p_salvage,'FM999999999999990.0000'),'placed_in_service_date',proposal.placed_in_service_date,'useful_life_months',proposal.useful_life_months,'depreciation_method',p_method,'depreciation_convention',p_convention,'asset_account_code',proposal.asset_account_code,'accumulated_depreciation_account_code',btrim(p_accumulated_depreciation_account),'depreciation_expense_account_code',btrim(p_depreciation_expense_account),'member_trace',proposal.member_trace,'register_evidence_hash',evidence_hash,'status','ACTIVE','can_create_draft',false,'can_review',false,'can_approve',false,'can_post',false);
  INSERT INTO audit_event(tenant_id,entity_id,event_type,object_type,object_id,action,actor_id,actor_type,permission_used,request_id,correlation_id,idempotency_key,after_hash,reason,metadata) VALUES(p_tenant,p_entity,'FIXED_ASSET_REGISTER_REVIEWED','FIXED_ASSET_REGISTER_EVIDENCE',register_id,'REVIEW',actor,'USER','FIXED_ASSET.REGISTER.REVIEW',p_idempotency_key,p_idempotency_key,p_idempotency_key,evidence_hash,btrim(p_reason),payload);
  INSERT INTO outbox_event(tenant_id,entity_id,aggregate_type,aggregate_id,event_type,payload,payload_hash) VALUES(p_tenant,p_entity,'FIXED_ASSET_REGISTER_EVIDENCE',register_id,'FIXED_ASSET_REGISTER_REVIEWED',payload,refs_jsonb_hash(payload));
  result:=payload||jsonb_build_object('idempotent',false);UPDATE idempotency_receipt SET status='SUCCEEDED',response_status=201,response_body=result,completed_at=clock_timestamp() WHERE idempotency_receipt_id=idem.idempotency_receipt_id;RETURN result;
END;$$;

REVOKE EXECUTE ON FUNCTION refs_review_fixed_asset_register_hash(uuid,uuid,uuid,text,numeric,text,text,text,text,text),refs_review_fixed_asset_register(uuid,uuid,uuid,text,numeric,text,text,text,text,text,text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION refs_review_fixed_asset_register_hash(uuid,uuid,uuid,text,numeric,text,text,text,text,text),refs_review_fixed_asset_register(uuid,uuid,uuid,text,numeric,text,text,text,text,text,text,text) TO refs_app;
COMMIT;
