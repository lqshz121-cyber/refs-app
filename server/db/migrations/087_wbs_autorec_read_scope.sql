BEGIN;

-- Upgrade only an already self-service activated Stage 1 reader.  The lock,
-- version and exact prior-set check prevent this endpoint from replacing any
-- broader operator grant; import and all write permissions are never inputs.
CREATE OR REPLACE FUNCTION refs_upgrade_stage1_wbs_autorec_read(
  p_tenant uuid,p_actor text,p_entity uuid,p_idempotency_key text,p_request_hash text,p_expected_version bigint
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE prior text[]; expected_prior text[]:=ARRAY['AP.VIEW','AR.VIEW','BANK.VIEW','GL.JE.VIEW','GL.REPORT.VIEW']; desired text[]:=ARRAY['AP.VIEW','AR.VIEW','BANK.VIEW','GL.JE.VIEW','GL.REPORT.VIEW','WBS.AUTOREC.VIEW']; receipt runtime_grant_sync_receipt;
BEGIN
  IF session_user<>'refs_grant_sync' THEN RAISE EXCEPTION 'Grant sync identity denied' USING ERRCODE='42501'; END IF;
  IF p_expected_version<>1 OR length(btrim(coalesce(p_actor,'')))=0 OR p_idempotency_key !~ '^[A-Za-z0-9._:-]{8,128}$' THEN RAISE EXCEPTION 'Stage 1 WBS read upgrade request is invalid' USING ERRCODE='22023'; END IF;
  IF p_request_hash<>refs_grant_request_hash(p_tenant,p_actor,p_entity,desired,p_expected_version) THEN RAISE EXCEPTION 'Grant request hash is not canonical' USING ERRCODE='22023'; END IF;
  SELECT * INTO receipt FROM runtime_grant_sync_receipt WHERE tenant_id=p_tenant AND actor_id=p_actor AND entity_id=p_entity AND idempotency_key=p_idempotency_key FOR UPDATE;
  IF FOUND THEN
    IF receipt.request_hash<>p_request_hash THEN RAISE EXCEPTION 'Grant idempotency key reused with different request' USING ERRCODE='23505'; END IF;
    IF receipt.completed_at IS NOT NULL THEN RETURN receipt.response_body||jsonb_build_object('idempotent',true); END IF;
  END IF;
  PERFORM 1 FROM runtime_actor_grant_set WHERE tenant_id=p_tenant AND actor_id=p_actor AND entity_id=p_entity AND version=p_expected_version FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Stage 1 reader upgrade requires the original reader grant at version 1' USING ERRCODE='40001'; END IF;
  SELECT coalesce(array_agg(permission ORDER BY permission),'{}'::text[]) INTO prior FROM runtime_actor_grant
    WHERE tenant_id=p_tenant AND actor_id=p_actor AND entity_id=p_entity AND revoked_at IS NULL;
  IF prior<>expected_prior THEN RAISE EXCEPTION 'Stage 1 reader upgrade requires exactly the original five read permissions' USING ERRCODE='42501'; END IF;
  RETURN refs_reconcile_actor_grants(p_tenant,p_actor,p_entity,desired,p_expected_version,p_idempotency_key,p_request_hash);
END $$;

REVOKE ALL ON FUNCTION refs_upgrade_stage1_wbs_autorec_read(uuid,text,uuid,text,text,bigint) FROM PUBLIC,refs_app,refs_runtime,refs_context_issuer;
GRANT EXECUTE ON FUNCTION refs_upgrade_stage1_wbs_autorec_read(uuid,text,uuid,text,text,bigint) TO refs_grant_sync;

-- The following functions are the review/control projection boundary.  Moving
-- their guard to WBS.AUTOREC.VIEW grants evidence inspection only; persistence
-- functions remain guarded by WBS.SNAPSHOT.IMPORT in their original migrations.
CREATE OR REPLACE FUNCTION refs_assert_wbs_autorec_read_scope(p_tenant uuid,p_entity uuid)
RETURNS void LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
BEGIN
  PERFORM refs_assert_scope(p_tenant,p_entity,'WBS.AUTOREC.VIEW');
END $$;
REVOKE ALL ON FUNCTION refs_assert_wbs_autorec_read_scope(uuid,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION refs_assert_wbs_autorec_read_scope(uuid,uuid) TO refs_app;

CREATE OR REPLACE FUNCTION refs_read_wbs_inbound_rows(p_tenant uuid,p_entity uuid,p_company text,p_source_records text[])
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE result jsonb;
BEGIN
 PERFORM refs_assert_wbs_autorec_read_scope(p_tenant,p_entity);
 IF coalesce(length(btrim(p_company)),0)=0 OR coalesce(cardinality(p_source_records),0)=0 OR EXISTS(SELECT 1 FROM unnest(p_source_records) value WHERE coalesce(length(btrim(value)),0)=0) THEN RAISE EXCEPTION 'WBS inbound read scope is invalid' USING ERRCODE='22023'; END IF;
 SELECT coalesce(jsonb_agg(projected ORDER BY projected->>'source_record_id',projected->>'source_version'),'[]'::jsonb) INTO result FROM (
  SELECT jsonb_strip_nulls(row.normalized||row.outcome||jsonb_build_object('tenant_id',row.tenant_id,'entity_id',row.entity_id,'receipt_id',receipt.receipt_id,'receipt_ref',receipt.payload_ref,'receipt_hash',receipt.receipt_hash,'source_record_id',row.source_record_id,'source_version',row.source_version,'company_key',coalesce(row.outcome->>'company_key',row.normalized->>'company_key',row.raw->>'company_key'),'outcome_kind',row.outcome_kind)) projected
  FROM wbs_inbound_row row JOIN wbs_inbound_receipt receipt ON receipt.receipt_id=row.receipt_id AND receipt.tenant_id=row.tenant_id AND receipt.entity_id=row.entity_id
  WHERE row.tenant_id=p_tenant AND row.entity_id=p_entity AND row.source_record_id=ANY(p_source_records) AND coalesce(row.outcome->>'company_key',row.normalized->>'company_key',row.raw->>'company_key')=p_company AND coalesce(row.outcome->>'detail_kind',row.normalized->>'detail_kind','')='' AND coalesce(row.outcome->>'control_kind',row.normalized->>'control_kind','')='' AND coalesce(row.outcome->>'source_type',row.normalized->>'source_type',row.raw->>'source_type','')<>'AUTOREC_COMPANY_CONTROL'
 ) readable;
 RETURN result;
END $$;

CREATE OR REPLACE FUNCTION refs_read_wbs_autorec_control_rows(p_tenant uuid,p_entity uuid,p_company text,p_source_records text[])
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE result jsonb;
BEGIN
 PERFORM refs_assert_wbs_autorec_read_scope(p_tenant,p_entity);
 IF coalesce(length(btrim(p_company)),0)=0 OR coalesce(cardinality(p_source_records),0)=0 OR EXISTS(SELECT 1 FROM unnest(p_source_records) value WHERE coalesce(length(btrim(value)),0)=0) THEN RAISE EXCEPTION 'WBS control read scope is invalid' USING ERRCODE='22023'; END IF;
 WITH projected AS (SELECT jsonb_strip_nulls(row.normalized||row.outcome||jsonb_build_object('tenant_id',row.tenant_id,'entity_id',row.entity_id,'receipt_id',receipt.receipt_id,'receipt_ref',receipt.payload_ref,'receipt_hash',receipt.receipt_hash,'source_record_id',row.source_record_id,'source_version',row.source_version,'company_key',coalesce(row.outcome->>'company_key',row.normalized->>'company_key',row.raw->>'company_key'))) item FROM wbs_inbound_row row JOIN wbs_inbound_receipt receipt ON receipt.receipt_id=row.receipt_id AND receipt.tenant_id=row.tenant_id AND receipt.entity_id=row.entity_id WHERE row.tenant_id=p_tenant AND row.entity_id=p_entity AND row.source_record_id=ANY(p_source_records) AND coalesce(row.outcome->>'company_key',row.normalized->>'company_key',row.raw->>'company_key')=p_company)
 SELECT jsonb_build_object('companyRows',coalesce(jsonb_agg(item ORDER BY item->>'source_record_id') FILTER(WHERE coalesce(item->>'control_kind',item->>'source_type')='AUTOREC_COMPANY_CONTROL'),'[]'::jsonb),'detailRows',coalesce(jsonb_agg(item ORDER BY item->>'source_record_id') FILTER(WHERE coalesce(item->>'detail_kind','')<>''),'[]'::jsonb),'persistedRows',coalesce(jsonb_agg(item ORDER BY item->>'source_record_id') FILTER(WHERE coalesce(item->>'control_kind',item->>'source_type')='AUTOREC_COMPANY_CONTROL' OR coalesce(item->>'detail_kind','')<>''),'[]'::jsonb)) INTO result FROM projected;
 RETURN result;
END $$;

CREATE OR REPLACE FUNCTION refs_read_wbs_autorec_mappings(p_tenant uuid,p_entity uuid,p_company text)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE result jsonb;
BEGIN
 PERFORM refs_assert_wbs_autorec_read_scope(p_tenant,p_entity);
 IF coalesce(length(btrim(p_company)),0)=0 THEN RAISE EXCEPTION 'WBS mapping read scope is invalid' USING ERRCODE='22023'; END IF;
 SELECT coalesce(jsonb_agg(jsonb_build_object('mapping_id',mapping_snapshot_id,'version',version::text,'snapshot_hash',snapshot_hash,'status',status,'entity_id',p_entity,'company_key',input_keys->>'company_key','source_type',input_keys->>'source_type','currency',input_keys->>'currency','bank_account_ref',input_keys->>'bank_account_ref','effective_from',effective_from,'effective_to',effective_to) ORDER BY effective_from,mapping_snapshot_id),'[]'::jsonb) INTO result FROM mapping_snapshot WHERE tenant_id=p_tenant AND entity_id=p_entity AND family='WBS_AUTOREC' AND status IN ('APPROVED','RETIRED') AND input_keys->>'company_key'=p_company AND coalesce(input_keys->>'source_type','')<>'' AND coalesce(input_keys->>'currency','')<>'';
 RETURN result;
END $$;

CREATE OR REPLACE FUNCTION refs_read_wbs_autorec_matching_policies(p_tenant uuid,p_entity uuid,p_company text)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE result jsonb;
BEGIN
 PERFORM refs_assert_wbs_autorec_read_scope(p_tenant,p_entity);
 IF coalesce(length(btrim(p_company)),0)=0 THEN RAISE EXCEPTION 'WBS matching-policy read scope is invalid' USING ERRCODE='22023'; END IF;
 SELECT coalesce(jsonb_agg(jsonb_build_object('policy_id',mapping_snapshot_id,'version',version::text,'mapping_id',mapping_snapshot_id,'mapping_version',version::text,'policy_snapshot_hash',snapshot_hash,'status',status,'entity_id',p_entity,'company_key',input_keys->>'company_key','currency',input_keys->>'currency','bank_account_ref',input_keys->>'bank_account_ref','effective_from',effective_from,'effective_to',effective_to,'rule_id',output_rules->>'rule_id','rule_version',output_rules->>'rule_version','bank_mapping_id',output_rules->>'bank_mapping_id','bank_mapping_version',output_rules->>'bank_mapping_version','bank_mapping_snapshot_hash',output_rules->>'bank_mapping_snapshot_hash','business_mapping_id',output_rules->>'business_mapping_id','business_mapping_version',output_rules->>'business_mapping_version','business_mapping_snapshot_hash',output_rules->>'business_mapping_snapshot_hash','amount_tolerance',output_rules->>'amount_tolerance','date_window_days',output_rules->>'date_window_days','date_match_basis',output_rules->>'date_match_basis') ORDER BY priority DESC,mapping_snapshot_id),'[]'::jsonb) INTO result FROM mapping_snapshot WHERE tenant_id=p_tenant AND entity_id=p_entity AND family='WBS_AUTOREC_MATCH' AND status IN ('APPROVED','RETIRED') AND input_keys->>'company_key'=p_company AND coalesce(input_keys->>'currency','')<>'' AND coalesce(input_keys->>'bank_account_ref','')<>'';
 RETURN result;
END $$;

CREATE OR REPLACE FUNCTION refs_read_wbs_autorec_observed_state_evidence(p_tenant uuid,p_entity uuid,p_company text,p_source_records text[])
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE result jsonb;
BEGIN
 PERFORM refs_assert_wbs_autorec_read_scope(p_tenant,p_entity);
 IF btrim(coalesce(p_company,''))='' OR cardinality(p_source_records)=0 OR EXISTS(SELECT 1 FROM unnest(p_source_records) key WHERE btrim(coalesce(key,''))='') THEN RAISE EXCEPTION 'WBS observed-state read scope is invalid' USING ERRCODE='22023'; END IF;
 SELECT coalesce(jsonb_agg(jsonb_build_object('tenant_id',e.tenant_id,'entity_id',e.entity_id,'company_key',e.company_key,'source_record_id',e.source_record_id,'source_version',e.source_version,'receipt_id',e.receipt_id,'receipt_hash',e.receipt_hash,'observed_at',to_char(e.observed_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS"Z"'),'observed_state',e.observed_state,'observed_workflow_step',e.observed_workflow_step,'source_status_code',e.source_status_code,'source_match_status_code',e.source_match_status_code,'can_transition_refs',false,'can_release',false,'can_incur',false,'can_create_draft',false,'can_post',false) ORDER BY e.observed_at,e.source_version,e.wbs_autorec_observed_state_event_id),'[]'::jsonb) INTO result FROM wbs_autorec_observed_state_event e WHERE e.tenant_id=p_tenant AND e.entity_id=p_entity AND e.company_key=p_company AND e.source_record_id=ANY(p_source_records);
 RETURN result;
END $$;

CREATE OR REPLACE FUNCTION refs_read_wbs_control_metric_snapshot(p_tenant uuid,p_entity uuid,p_source_type text,p_scope jsonb)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE result jsonb;
BEGIN
 PERFORM refs_assert_wbs_autorec_read_scope(p_tenant,p_entity);
 IF p_source_type NOT IN ('COST_GENERAL_LEDGER','PROPERTY_COMPARISON') OR jsonb_typeof(p_scope)<>'object' OR p_scope->>'tenant_id'<>p_tenant::text OR p_scope->>'entity_id'<>p_entity::text THEN RAISE EXCEPTION 'WBS control snapshot read scope is invalid' USING ERRCODE='22023'; END IF;
 SELECT jsonb_build_object('snapshot_id',s.wbs_control_metric_snapshot_id,'tenant_id',s.tenant_id,'entity_id',s.entity_id,'source_type',s.source_type,'scope',s.scope,'receipt',jsonb_build_object('hash',s.receipt_hash,'metrics_hash',s.metrics_hash,'ref',s.receipt_ref,'version',s.receipt_version,'scope',s.scope,'signature_verified',true,'manifest_hash',s.receipt_manifest_hash,'key_id',s.receipt_key_id,'algorithm',s.receipt_algorithm),'metrics',s.metrics,'can_create_transaction',false,'can_allocate',false,'can_create_draft',false,'can_post',false) INTO result FROM wbs_control_metric_snapshot s WHERE s.tenant_id=p_tenant AND s.entity_id=p_entity AND s.source_type=p_source_type AND s.scope=p_scope ORDER BY s.created_at DESC,s.wbs_control_metric_snapshot_id DESC LIMIT 1;
 RETURN result;
END $$;

CREATE OR REPLACE FUNCTION refs_read_refs_control_metric_snapshot(p_tenant uuid,p_entity uuid,p_source_type text,p_scope jsonb)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE result jsonb;
BEGIN
 PERFORM refs_assert_wbs_autorec_read_scope(p_tenant,p_entity);
 IF p_source_type NOT IN ('COST_GENERAL_LEDGER','PROPERTY_COMPARISON') OR jsonb_typeof(p_scope)<>'object' OR p_scope->>'tenant_id'<>p_tenant::text OR p_scope->>'entity_id'<>p_entity::text THEN RAISE EXCEPTION 'REFS control snapshot read scope is invalid' USING ERRCODE='22023'; END IF;
 SELECT jsonb_build_object('snapshot_id',s.refs_control_metric_snapshot_id,'tenant_id',s.tenant_id,'entity_id',s.entity_id,'source_type',s.source_type,'scope',s.scope,'receipt',jsonb_build_object('hash',s.receipt_hash,'ref',s.receipt_ref,'version',s.receipt_version,'scope',s.scope),'metrics',s.metrics,'can_create_transaction',false,'can_allocate',false,'can_create_draft',false,'can_post',false) INTO result FROM refs_control_metric_snapshot s WHERE s.tenant_id=p_tenant AND s.entity_id=p_entity AND s.source_type=p_source_type AND s.scope=p_scope ORDER BY s.created_at DESC,s.refs_control_metric_snapshot_id DESC LIMIT 1;
 RETURN result;
END $$;

CREATE OR REPLACE FUNCTION refs_read_wbs_control_reconciliation_mapping(p_tenant uuid,p_entity uuid,p_source_type text,p_scope jsonb)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE family_name text; result jsonb; candidate_count integer;
BEGIN
 PERFORM refs_assert_wbs_autorec_read_scope(p_tenant,p_entity);
 IF p_source_type='COST_GENERAL_LEDGER' THEN family_name:='WBS_COST_GL_CONTROL_RECONCILIATION'; ELSIF p_source_type='PROPERTY_COMPARISON' THEN family_name:='WBS_PROPERTY_CONTROL_RECONCILIATION'; ELSE RAISE EXCEPTION 'WBS control mapping source type is invalid' USING ERRCODE='22023'; END IF;
 IF jsonb_typeof(p_scope)<>'object' OR p_scope->>'tenant_id'<>p_tenant::text OR p_scope->>'entity_id'<>p_entity::text THEN RAISE EXCEPTION 'WBS control mapping scope is invalid' USING ERRCODE='22023'; END IF;
 SELECT count(*) INTO candidate_count FROM mapping_snapshot m WHERE m.tenant_id=p_tenant AND m.entity_id=p_entity AND m.family=family_name AND m.status='APPROVED' AND m.effective_from<=clock_timestamp() AND (m.effective_to IS NULL OR m.effective_to>clock_timestamp()) AND m.input_keys=p_scope AND m.priority=(SELECT max(priority) FROM mapping_snapshot x WHERE x.tenant_id=p_tenant AND x.entity_id=p_entity AND x.family=family_name AND x.status='APPROVED' AND x.effective_from<=clock_timestamp() AND (x.effective_to IS NULL OR x.effective_to>clock_timestamp()) AND x.input_keys=p_scope);
 IF candidate_count<>1 THEN RETURN NULL; END IF;
 SELECT jsonb_build_object('mapping_id',m.mapping_snapshot_id,'tenant_id',m.tenant_id,'entity_id',m.entity_id,'status',m.status,'mapping_type',m.family,'version',m.version::text,'snapshot_hash',m.snapshot_hash,'scope',p_scope,'metric_keys',m.output_rules->'metric_keys') INTO result FROM mapping_snapshot m WHERE m.tenant_id=p_tenant AND m.entity_id=p_entity AND m.family=family_name AND m.status='APPROVED' AND m.effective_from<=clock_timestamp() AND (m.effective_to IS NULL OR m.effective_to>clock_timestamp()) AND m.input_keys=p_scope ORDER BY m.priority DESC,m.mapping_snapshot_id LIMIT 1;
 RETURN result;
END $$;

CREATE OR REPLACE FUNCTION refs_read_wbs_trace_relation_evidence(p_tenant uuid,p_entity uuid,p_source jsonb)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE result jsonb;
BEGIN
 PERFORM refs_assert_wbs_autorec_read_scope(p_tenant,p_entity);
 IF jsonb_typeof(p_source)<>'object' OR coalesce(p_source->>'company_key','')='' OR coalesce(p_source->>'source_type','') NOT IN ('PAYABLE','BANK_TRANSACTION','AUTOREC_PAYMENT_DETAIL') OR coalesce(p_source->>'source_record_id','')='' OR coalesce(p_source->>'source_version','')='' OR coalesce(p_source->>'receipt_hash','')!~'^sha256:[0-9a-f]{64}$' THEN RAISE EXCEPTION 'Trace relation read scope is invalid' USING ERRCODE='22023'; END IF;
 SELECT jsonb_build_object('relation_evidence_id',e.relation_evidence_id,'source',jsonb_build_object('tenant_id',e.tenant_id,'entity_id',e.entity_id,'company_key',e.company_key,'source_type',e.source_type,'source_record_id',e.source_record_id,'source_version',e.source_version,'receipt_hash',e.source_receipt_hash),'trace_receipt',jsonb_build_object('ref',e.trace_receipt_ref,'version',e.trace_receipt_version,'issued_at',e.trace_receipt_issued_at,'manifest_hash',e.trace_manifest_hash,'key_id',e.trace_key_id,'algorithm',e.trace_algorithm,'content_hash',e.trace_content_hash),'binding_hash',e.binding_hash,'relations',coalesce((SELECT jsonb_agg(i.relation_payload ORDER BY i.relation_id) FROM wbs_trace_relation_item i WHERE i.relation_evidence_id=e.relation_evidence_id),'[]'::jsonb),'can_create_transaction',false,'can_allocate',false,'can_create_draft',false,'can_post',false) INTO result FROM wbs_trace_relation_evidence e WHERE e.tenant_id=p_tenant AND e.entity_id=p_entity AND e.company_key=p_source->>'company_key' AND e.source_type=p_source->>'source_type' AND e.source_record_id=p_source->>'source_record_id' AND e.source_version=p_source->>'source_version' AND e.source_receipt_hash=p_source->>'receipt_hash' ORDER BY e.created_at DESC,e.relation_evidence_id DESC LIMIT 1;
 RETURN result;
END $$;

REVOKE ALL ON FUNCTION refs_read_wbs_inbound_rows(uuid,uuid,text,text[]) FROM PUBLIC;
REVOKE ALL ON FUNCTION refs_read_wbs_autorec_control_rows(uuid,uuid,text,text[]) FROM PUBLIC;
REVOKE ALL ON FUNCTION refs_read_wbs_autorec_mappings(uuid,uuid,text) FROM PUBLIC;
REVOKE ALL ON FUNCTION refs_read_wbs_autorec_matching_policies(uuid,uuid,text) FROM PUBLIC;
REVOKE ALL ON FUNCTION refs_read_wbs_autorec_observed_state_evidence(uuid,uuid,text,text[]) FROM PUBLIC;
REVOKE ALL ON FUNCTION refs_read_wbs_control_metric_snapshot(uuid,uuid,text,jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION refs_read_refs_control_metric_snapshot(uuid,uuid,text,jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION refs_read_wbs_control_reconciliation_mapping(uuid,uuid,text,jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION refs_read_wbs_trace_relation_evidence(uuid,uuid,jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION refs_read_wbs_inbound_rows(uuid,uuid,text,text[]) TO refs_app;
GRANT EXECUTE ON FUNCTION refs_read_wbs_autorec_control_rows(uuid,uuid,text,text[]) TO refs_app;
GRANT EXECUTE ON FUNCTION refs_read_wbs_autorec_mappings(uuid,uuid,text) TO refs_app;
GRANT EXECUTE ON FUNCTION refs_read_wbs_autorec_matching_policies(uuid,uuid,text) TO refs_app;
GRANT EXECUTE ON FUNCTION refs_read_wbs_autorec_observed_state_evidence(uuid,uuid,text,text[]) TO refs_app;
GRANT EXECUTE ON FUNCTION refs_read_wbs_control_metric_snapshot(uuid,uuid,text,jsonb) TO refs_app;
GRANT EXECUTE ON FUNCTION refs_read_refs_control_metric_snapshot(uuid,uuid,text,jsonb) TO refs_app;
GRANT EXECUTE ON FUNCTION refs_read_wbs_control_reconciliation_mapping(uuid,uuid,text,jsonb) TO refs_app;
GRANT EXECUTE ON FUNCTION refs_read_wbs_trace_relation_evidence(uuid,uuid,jsonb) TO refs_app;
COMMIT;
