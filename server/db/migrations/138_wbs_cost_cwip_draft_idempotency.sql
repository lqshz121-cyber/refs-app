BEGIN;

-- A successful Cost-to-CWIP Draft advances its staging row.  Keep an outer
-- receipt so a network retry can return that immutable result before the
-- current-state guard is evaluated.
CREATE OR REPLACE FUNCTION refs_create_wbs_cost_cwip_draft(
  p_tenant uuid,p_entity uuid,p_review uuid,p_expected_evidence_hash text,p_reason text,p_idempotency_key text,p_request_hash text
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE actor text:=refs_current_actor(); evidence wbs_cost_cwip_review_evidence; staging staging_item; source source_document; mapping mapping_snapshot;
DECLARE idem idempotency_receipt; amount numeric(20,4); cwip_account text; offset_account text; lines jsonb; journal_number text; description text; auto_hash text; response jsonb;
BEGIN
  PERFORM refs_assert_scope(p_tenant,p_entity,'WBS.COST.CWIP.DRAFT');
  PERFORM refs_assert_scope(p_tenant,p_entity,'GL.JE.AUTO.CREATE');
  IF actor IS NULL THEN RAISE EXCEPTION 'Authenticated Cost-to-CWIP Draft maker missing' USING ERRCODE='42501'; END IF;
  IF p_request_hash<>refs_create_wbs_cost_cwip_draft_hash(p_tenant,p_entity,p_review,p_expected_evidence_hash,p_reason) THEN RAISE EXCEPTION 'Cost-to-CWIP Draft request hash is not canonical' USING ERRCODE='22023'; END IF;
  IF p_expected_evidence_hash !~ '^sha256:[0-9a-f]{64}$' OR COALESCE(length(btrim(p_reason)),0) NOT BETWEEN 8 AND 2000 THEN RAISE EXCEPTION 'Cost-to-CWIP Draft requires exact evidence and maker reason' USING ERRCODE='22023'; END IF;
  SELECT * INTO evidence FROM wbs_cost_cwip_review_evidence WHERE tenant_id=p_tenant AND entity_id=p_entity AND wbs_cost_cwip_review_evidence_id=p_review FOR SHARE;
  IF NOT FOUND OR evidence.evidence_hash<>p_expected_evidence_hash THEN RAISE EXCEPTION 'Reviewed Cost-to-CWIP evidence is missing or changed' USING ERRCODE='40001'; END IF;
  IF actor=evidence.reviewed_by THEN RAISE EXCEPTION 'Cost-to-CWIP maker and reviewer must be different actors' USING ERRCODE='42501'; END IF;
  INSERT INTO idempotency_receipt(tenant_id,operation_scope,idempotency_key,request_hash,status,actor_id)
  VALUES(p_tenant,'WBS_COST_CWIP_DRAFT:'||p_entity,p_idempotency_key,p_request_hash,'IN_PROGRESS',actor)
  ON CONFLICT DO NOTHING;
  SELECT * INTO idem FROM idempotency_receipt
  WHERE tenant_id=p_tenant AND operation_scope='WBS_COST_CWIP_DRAFT:'||p_entity AND idempotency_key=p_idempotency_key FOR UPDATE;
  IF idem.request_hash<>p_request_hash THEN RAISE EXCEPTION 'Idempotency key reused with different request hash' USING ERRCODE='23505'; END IF;
  IF idem.status='SUCCEEDED' THEN RETURN idem.response_body||jsonb_build_object('idempotent',true); END IF;
  SELECT * INTO staging FROM staging_item WHERE tenant_id=p_tenant AND entity_id=p_entity AND staging_item_id=evidence.staging_item_id FOR UPDATE;
  SELECT * INTO source FROM source_document WHERE tenant_id=p_tenant AND entity_id=p_entity AND source_document_id=evidence.source_document_id FOR SHARE;
  SELECT * INTO mapping FROM mapping_snapshot WHERE tenant_id=p_tenant AND mapping_snapshot_id=evidence.mapping_snapshot_id FOR SHARE;
  IF NOT FOUND OR staging.status<>'READY_FOR_DRAFT' OR staging.version<>0 OR source.status<>'READY_FOR_DRAFT' OR source.document_type<>'WBS_COST_CWIP' OR mapping.snapshot_hash<>refs_jsonb_hash(jsonb_build_object('input_keys',mapping.input_keys,'output_rules',mapping.output_rules)) THEN RAISE EXCEPTION 'Cost-to-CWIP Draft evidence chain is incomplete or changed' USING ERRCODE='23514'; END IF;
  cwip_account:=NULLIF(btrim(mapping.output_rules->>'cwip_account_code'),''); offset_account:=NULLIF(btrim(mapping.output_rules->>'offset_account_code'),''); amount:=source.gross_amount;
  IF cwip_account IS NULL OR offset_account IS NULL OR cwip_account=offset_account OR amount<=0 THEN RAISE EXCEPTION 'Approved Cost-to-CWIP mapping is incomplete' USING ERRCODE='23514'; END IF;
  PERFORM 1 FROM account_master WHERE tenant_id=p_tenant AND entity_id=p_entity AND account_code IN (cwip_account,offset_account) AND active GROUP BY tenant_id,entity_id HAVING count(*)=2;
  IF NOT FOUND THEN RAISE EXCEPTION 'Approved Cost-to-CWIP accounts are inactive or missing' USING ERRCODE='23503'; END IF;
  journal_number:='WBS-CWIP-'||replace(p_review::text,'-',''); description:='WBS Cost to CWIP '||source.document_no;
  lines:=jsonb_build_array(jsonb_build_object('line_no',1,'account_code',cwip_account,'debit_amount',amount,'credit_amount',0,'description',description,'dimensions','{}'::jsonb),jsonb_build_object('line_no',2,'account_code',offset_account,'debit_amount',0,'credit_amount',amount,'description',description,'dimensions','{}'::jsonb));
  auto_hash:=refs_create_auto_journal_hash(p_tenant,p_entity,staging.staging_item_id,evidence.period_id,staging.version,journal_number,description,lines);
  response:=refs_create_auto_journal(p_tenant,p_entity,staging.staging_item_id,evidence.period_id,staging.version,journal_number,description,lines,'WBS-COST-CWIP:'||p_idempotency_key,auto_hash)||jsonb_build_object('wbs_cost_cwip_review_evidence_id',p_review,'mapping_snapshot_id',evidence.mapping_snapshot_id);
  UPDATE idempotency_receipt SET status='SUCCEEDED',response_status=201,response_body=response,completed_at=clock_timestamp() WHERE idempotency_receipt_id=idem.idempotency_receipt_id;
  RETURN response;
END;
$$;
COMMIT;
