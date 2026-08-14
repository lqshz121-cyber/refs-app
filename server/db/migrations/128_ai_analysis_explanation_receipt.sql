BEGIN;

CREATE FUNCTION refs_ai_accounting_analysis_explanation_hash(p_tenant uuid,p_entity uuid,p_summary jsonb) RETURNS text LANGUAGE sql IMMUTABLE SET search_path=pg_catalog,public,pg_temp AS $$
  SELECT refs_jsonb_hash(jsonb_build_object('schema_version','REFS_AI_ACCOUNTING_ANALYSIS_EXPLANATION_V1','tenant_id',p_tenant,'entity_id',p_entity,'summary',p_summary))
$$;

CREATE FUNCTION refs_assert_ai_accounting_analysis_summary(p_summary jsonb) RETURNS void LANGUAGE plpgsql IMMUTABLE SET search_path=pg_catalog,public,pg_temp AS $$
BEGIN
  IF jsonb_typeof(p_summary)<>'array' OR jsonb_array_length(p_summary)>6 OR EXISTS(
    SELECT 1 FROM jsonb_array_elements(p_summary) item
    WHERE jsonb_typeof(item)<>'object' OR (item-'category'-'total_findings'-'high_findings'-'medium_findings'-'low_findings'-'latest_materialized_at')<>'{}'::jsonb
      OR item->>'category' NOT IN ('WBS_EXCEPTION','PREPAID_COVERAGE','DUPLICATE_PAYABLE','UNMATCHED_BANK_PAYMENT','COST_DIMENSION','LOAN_REFERENCE')
      OR COALESCE((item->>'total_findings')::bigint,-1)<0 OR COALESCE((item->>'high_findings')::bigint,-1)<0 OR COALESCE((item->>'medium_findings')::bigint,-1)<0 OR COALESCE((item->>'low_findings')::bigint,-1)<0
      OR (item->>'total_findings')::bigint<>(item->>'high_findings')::bigint+(item->>'medium_findings')::bigint+(item->>'low_findings')::bigint
      OR COALESCE(item->>'latest_materialized_at','')=''
  ) OR (SELECT count(*)<>count(DISTINCT item->>'category') FROM jsonb_array_elements(p_summary) item) THEN
    RAISE EXCEPTION 'AI accounting analysis summary must be a unique bounded aggregate finding set' USING ERRCODE='22023';
  END IF;
END;
$$;

CREATE FUNCTION refs_begin_ai_accounting_analysis_explanation(p_tenant uuid,p_entity uuid,p_summary jsonb,p_idempotency_key text,p_request_hash text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE actor text:=refs_current_actor(); receipt idempotency_receipt; expected_hash text; stale interval:='3 minutes';
BEGIN
  PERFORM refs_assert_scope(p_tenant,p_entity,'AI.AMORTIZATION.PROPOSE');
  IF actor IS NULL THEN RAISE EXCEPTION 'Authenticated AI analysis requester missing' USING ERRCODE='42501'; END IF;
  PERFORM refs_assert_ai_accounting_analysis_summary(p_summary);expected_hash:=refs_ai_accounting_analysis_explanation_hash(p_tenant,p_entity,p_summary);
  IF p_request_hash<>expected_hash THEN RAISE EXCEPTION 'AI analysis explanation request hash is not canonical' USING ERRCODE='22023'; END IF;
  INSERT INTO idempotency_receipt(tenant_id,operation_scope,idempotency_key,request_hash,status,actor_id)
    VALUES(p_tenant,'AI_ACCOUNTING_ANALYSIS_EXPLANATION:'||p_entity,p_idempotency_key,p_request_hash,'IN_PROGRESS',actor) ON CONFLICT DO NOTHING;
  SELECT * INTO receipt FROM idempotency_receipt WHERE tenant_id=p_tenant AND operation_scope='AI_ACCOUNTING_ANALYSIS_EXPLANATION:'||p_entity AND idempotency_key=p_idempotency_key FOR UPDATE;
  IF receipt.request_hash<>p_request_hash OR receipt.actor_id<>actor THEN RAISE EXCEPTION 'Idempotency key cannot be reused for a different AI analysis request or actor' USING ERRCODE='23505'; END IF;
  IF receipt.status='SUCCEEDED' THEN RETURN jsonb_build_object('state','REPLAY','response',receipt.response_body); END IF;
  IF receipt.status='IN_PROGRESS' AND receipt.created_at>=clock_timestamp()-stale THEN RETURN jsonb_build_object('state','IN_PROGRESS'); END IF;
  UPDATE idempotency_receipt SET status='IN_PROGRESS',response_status=NULL,response_body=NULL,completed_at=NULL WHERE idempotency_receipt_id=receipt.idempotency_receipt_id;
  RETURN jsonb_build_object('state','STARTED');
END;
$$;

CREATE FUNCTION refs_complete_ai_accounting_analysis_explanation(p_tenant uuid,p_entity uuid,p_idempotency_key text,p_request_hash text,p_output jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE actor text:=refs_current_actor(); receipt idempotency_receipt; output_hash text; event_id uuid:=gen_random_uuid(); metadata jsonb;
BEGIN
  PERFORM refs_assert_scope(p_tenant,p_entity,'AI.AMORTIZATION.PROPOSE');
  IF actor IS NULL THEN RAISE EXCEPTION 'Authenticated AI analysis requester missing' USING ERRCODE='42501'; END IF;
  IF jsonb_typeof(p_output)<>'object' OR (p_output-'traceId'-'providerRequestId'-'model'-'elapsedMs'-'result')<>'{}'::jsonb
     OR COALESCE(length(btrim(p_output->>'traceId')),0) NOT BETWEEN 8 AND 200 OR COALESCE(length(btrim(p_output->>'model')),0) NOT BETWEEN 1 AND 128
     OR jsonb_typeof(p_output->'providerRequestId') NOT IN ('string','null') OR jsonb_typeof(p_output->'elapsedMs')<>'number' OR COALESCE(p_output->>'elapsedMs','') !~ '^\d+$'
     OR jsonb_typeof(p_output->'result')<>'object' OR (p_output->'result'-'headline'-'risk_level'-'narrative'-'controller_actions'-'can_create_draft'-'can_review'-'can_approve'-'can_post')<>'{}'::jsonb
     OR COALESCE(length(btrim(p_output->'result'->>'headline')),0) NOT BETWEEN 1 AND 280 OR COALESCE(p_output->'result'->>'risk_level','') NOT IN ('HIGH','MEDIUM','LOW','NONE') OR COALESCE(length(btrim(p_output->'result'->>'narrative')),0) NOT BETWEEN 1 AND 4000
     OR jsonb_typeof(p_output->'result'->'controller_actions')<>'array' OR jsonb_array_length(p_output->'result'->'controller_actions')>6 OR EXISTS(SELECT 1 FROM jsonb_array_elements(p_output->'result'->'controller_actions') action WHERE jsonb_typeof(action)<>'object' OR (action-'category'-'action')<>'{}'::jsonb OR COALESCE(action->>'category','') NOT IN ('WBS_EXCEPTION','PREPAID_COVERAGE','DUPLICATE_PAYABLE','UNMATCHED_BANK_PAYMENT','COST_DIMENSION','LOAN_REFERENCE') OR COALESCE(length(btrim(action->>'action')),0) NOT BETWEEN 1 AND 1000)
     OR p_output->'result'->'can_create_draft'<>'false'::jsonb OR p_output->'result'->'can_review'<>'false'::jsonb OR p_output->'result'->'can_approve'<>'false'::jsonb OR p_output->'result'->'can_post'<>'false'::jsonb THEN
    RAISE EXCEPTION 'AI analysis explanation output is invalid or action-enabled' USING ERRCODE='22023';
  END IF;
  SELECT * INTO receipt FROM idempotency_receipt WHERE tenant_id=p_tenant AND operation_scope='AI_ACCOUNTING_ANALYSIS_EXPLANATION:'||p_entity AND idempotency_key=p_idempotency_key FOR UPDATE;
  IF NOT FOUND OR receipt.request_hash<>p_request_hash OR receipt.actor_id<>actor THEN RAISE EXCEPTION 'AI analysis explanation receipt is absent or does not match the authenticated request' USING ERRCODE='23505'; END IF;
  IF receipt.status='SUCCEEDED' THEN RETURN receipt.response_body; END IF;
  IF receipt.status<>'IN_PROGRESS' THEN RAISE EXCEPTION 'AI analysis explanation receipt is not ready for completion' USING ERRCODE='55000'; END IF;
  output_hash:=refs_jsonb_hash(p_output);metadata:=jsonb_build_object('schema_version','REFS_AI_ACCOUNTING_ANALYSIS_EXPLANATION_V1','trace_id',p_output->>'traceId','provider_request_id',p_output->>'providerRequestId','model',p_output->>'model','elapsed_ms',(p_output->>'elapsedMs')::bigint,'can_create_draft',false,'can_review',false,'can_approve',false,'can_post',false);
  INSERT INTO audit_event(tenant_id,entity_id,event_type,object_type,object_id,action,actor_id,actor_type,permission_used,request_id,correlation_id,idempotency_key,after_hash,reason,metadata)
    VALUES(p_tenant,p_entity,'AI_ACCOUNTING_ANALYSIS_EXPLAINED','AI_ACCOUNTING_ANALYSIS',event_id,'EXPLAIN',actor,'USER','AI.AMORTIZATION.PROPOSE',p_idempotency_key,p_output->>'traceId',p_idempotency_key,output_hash,'Source-bound aggregate finding explanation; no accounting action',metadata);
  INSERT INTO outbox_event(tenant_id,entity_id,aggregate_type,aggregate_id,event_type,payload,payload_hash)
    VALUES(p_tenant,p_entity,'AI_ACCOUNTING_ANALYSIS',event_id,'AI_ACCOUNTING_ANALYSIS_EXPLAINED',metadata,refs_jsonb_hash(metadata));
  UPDATE idempotency_receipt SET status='SUCCEEDED',response_status=200,response_body=p_output,completed_at=clock_timestamp() WHERE idempotency_receipt_id=receipt.idempotency_receipt_id;
  RETURN p_output;
END;
$$;

CREATE FUNCTION refs_abandon_ai_accounting_analysis_explanation(p_tenant uuid,p_entity uuid,p_idempotency_key text,p_request_hash text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE actor text:=refs_current_actor();
BEGIN
  PERFORM refs_assert_scope(p_tenant,p_entity,'AI.AMORTIZATION.PROPOSE');
  UPDATE idempotency_receipt SET status='FAILED',completed_at=clock_timestamp() WHERE tenant_id=p_tenant AND operation_scope='AI_ACCOUNTING_ANALYSIS_EXPLANATION:'||p_entity AND idempotency_key=p_idempotency_key AND request_hash=p_request_hash AND actor_id=actor AND status='IN_PROGRESS';
END;
$$;

REVOKE ALL ON FUNCTION refs_ai_accounting_analysis_explanation_hash(uuid,uuid,jsonb),refs_assert_ai_accounting_analysis_summary(jsonb),refs_begin_ai_accounting_analysis_explanation(uuid,uuid,jsonb,text,text),refs_complete_ai_accounting_analysis_explanation(uuid,uuid,text,text,jsonb),refs_abandon_ai_accounting_analysis_explanation(uuid,uuid,text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION refs_ai_accounting_analysis_explanation_hash(uuid,uuid,jsonb),refs_begin_ai_accounting_analysis_explanation(uuid,uuid,jsonb,text,text),refs_complete_ai_accounting_analysis_explanation(uuid,uuid,text,text,jsonb),refs_abandon_ai_accounting_analysis_explanation(uuid,uuid,text,text) TO refs_app;
COMMIT;
