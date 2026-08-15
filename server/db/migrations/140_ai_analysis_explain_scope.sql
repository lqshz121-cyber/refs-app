BEGIN;

-- Explanation reads retained findings and creates only an explanation receipt.
-- It cannot authorize proposals, Draft JEs, review, approval, or posting.
INSERT INTO permission_catalog(permission_code,domain,risk_class,sod_class) VALUES
  ('AI.ANALYSIS.EXPLAIN','AI_ACCOUNTING','LOW','READ')
ON CONFLICT(permission_code) DO UPDATE SET active=true,domain=EXCLUDED.domain,risk_class=EXCLUDED.risk_class,sod_class=EXCLUDED.sod_class,version=permission_catalog.version+1,effective_to=NULL;

CREATE FUNCTION refs_assert_ai_analysis_scope(p_tenant uuid,p_entity uuid) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE permitted text;
BEGIN
  -- Existing preparers remain compatible, while explanation-only actors retain
  -- no accounting command authority.
  permitted:=CASE WHEN refs_entity_has_permission(p_entity,'AI.ANALYSIS.EXPLAIN')
    THEN 'AI.ANALYSIS.EXPLAIN' ELSE 'AI.AMORTIZATION.PROPOSE' END;
  PERFORM refs_assert_scope(p_tenant,p_entity,permitted);
  PERFORM set_config('refs.ai_analysis_permission',permitted,true);
  RETURN permitted;
END;
$$;

-- These are exactly the readers used by accounting-server's authoritative AI
-- evidence reader, followed by its aggregate and receipt lifecycle.  Each
-- replacement verifies the prior permission before changing it.
DO $$
DECLARE target record; definition text; needle text;
BEGIN
  FOR target IN SELECT * FROM (VALUES
    ('refs_read_ai_wbs_exception_findings(uuid,uuid,integer)','WBS.PAYABLE.OPERATOR_ATTEST'),
    ('refs_read_ai_prepaid_coverage_findings(uuid,uuid,integer)','AI.AMORTIZATION.PROPOSE'),
    ('refs_read_ai_duplicate_payable_findings(uuid,uuid,integer)','AI.AMORTIZATION.PROPOSE'),
    ('refs_read_ai_unmatched_bank_payment_findings(uuid,uuid,integer)','AI.AMORTIZATION.PROPOSE'),
    ('refs_read_ai_cost_dimension_findings(uuid,uuid,integer)','AI.AMORTIZATION.PROPOSE'),
    ('refs_read_ai_loan_reference_findings(uuid,uuid,integer)','AI.AMORTIZATION.PROPOSE'),
    ('refs_read_ai_accounting_analysis_summary(uuid,uuid)','AI.AMORTIZATION.PROPOSE'),
    ('refs_begin_ai_accounting_analysis_explanation(uuid,uuid,jsonb,jsonb,text,text)','AI.AMORTIZATION.PROPOSE'),
    ('refs_complete_ai_accounting_analysis_explanation(uuid,uuid,text,text,jsonb)','AI.AMORTIZATION.PROPOSE'),
    ('refs_abandon_ai_accounting_analysis_explanation(uuid,uuid,text,text)','AI.AMORTIZATION.PROPOSE')
  ) AS value(signature,permission) LOOP
    SELECT pg_get_functiondef(target.signature::regprocedure) INTO definition;
    needle:=format('PERFORM refs_assert_scope(p_tenant,p_entity,%L);',target.permission);
    IF definition IS NULL OR position(needle IN definition)=0 THEN
      RAISE EXCEPTION 'AI analysis scope target % is not the expected immutable function definition',target.signature;
    END IF;
    definition:=replace(definition,needle,'PERFORM refs_assert_ai_analysis_scope(p_tenant,p_entity);');
    IF target.signature='refs_complete_ai_accounting_analysis_explanation(uuid,uuid,text,text,jsonb)' THEN
      definition:=replace(definition,'''AI.AMORTIZATION.PROPOSE''','NULLIF(current_setting(''refs.ai_analysis_permission'',true),'''')');
    END IF;
    EXECUTE definition;
  END LOOP;
END;
$$;

-- jsonb_array_elements needs a scalar column alias.  The old table alias was
-- a composite record, leaving the JSON subtraction operands unknown at
-- runtime and preventing completion of every otherwise valid receipt.
DO $$
DECLARE definition text;
BEGIN
  SELECT pg_get_functiondef('refs_complete_ai_accounting_analysis_explanation(uuid,uuid,text,text,jsonb)'::regprocedure) INTO definition;
  IF definition IS NULL OR position('jsonb_array_elements(p_output->''result''->''controller_actions'') action WHERE jsonb_typeof(action)' IN definition)=0 THEN
    RAISE EXCEPTION 'AI explanation completion output validator is not the expected function definition';
  END IF;
  definition:=replace(definition,'jsonb_array_elements(p_output->''result''->''controller_actions'') action WHERE jsonb_typeof(action)','jsonb_array_elements(p_output->''result''->''controller_actions'') AS action(value) WHERE jsonb_typeof(action.value)');
  definition:=replace(definition,'(action-''category''-''action'')','(action.value-''category''-''action'')');
  definition:=replace(definition,'action->>','action.value->>');
  EXECUTE definition;
END;
$$;

-- The original summary reader's unqualified output-column name (category)
-- is ambiguous in PL/pgSQL.  Recreate it under the explanation scope and
-- qualify retained columns so every authoritative finding family is readable.
CREATE OR REPLACE FUNCTION refs_read_ai_accounting_analysis_summary(p_tenant uuid,p_entity uuid) RETURNS TABLE(category text,total_findings bigint,high_findings bigint,medium_findings bigint,low_findings bigint,latest_materialized_at timestamptz,can_create_draft boolean,can_review boolean,can_approve boolean,can_post boolean) LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
BEGIN
  PERFORM refs_assert_ai_analysis_scope(p_tenant,p_entity);
  RETURN QUERY
  WITH retained AS (
    SELECT 'WBS_EXCEPTION'::text category,risk_level,created_at FROM ai_finding WHERE tenant_id=p_tenant AND entity_id=p_entity AND status='OPEN'
    UNION ALL SELECT 'PREPAID_COVERAGE',risk_level,created_at FROM ai_prepaid_coverage_finding WHERE tenant_id=p_tenant AND entity_id=p_entity AND status='OPEN'
    UNION ALL SELECT 'DUPLICATE_PAYABLE',risk_level,created_at FROM ai_duplicate_payable_finding WHERE tenant_id=p_tenant AND entity_id=p_entity AND status='OPEN'
    UNION ALL SELECT 'UNMATCHED_BANK_PAYMENT',risk_level,created_at FROM ai_unmatched_bank_payment_finding WHERE tenant_id=p_tenant AND entity_id=p_entity AND status='OPEN'
    UNION ALL SELECT 'COST_DIMENSION',risk_level,created_at FROM ai_cost_dimension_finding WHERE tenant_id=p_tenant AND entity_id=p_entity AND status='OPEN'
    UNION ALL SELECT 'LOAN_REFERENCE',risk_level,created_at FROM ai_loan_reference_finding WHERE tenant_id=p_tenant AND entity_id=p_entity AND status='OPEN'
  )
  SELECT retained.category,count(*)::bigint,count(*) FILTER(WHERE retained.risk_level='HIGH')::bigint,count(*) FILTER(WHERE retained.risk_level='MEDIUM')::bigint,count(*) FILTER(WHERE retained.risk_level='LOW')::bigint,max(retained.created_at),false,false,false,false
    FROM retained
    GROUP BY retained.category
    ORDER BY CASE retained.category WHEN 'DUPLICATE_PAYABLE' THEN 1 WHEN 'COST_DIMENSION' THEN 2 WHEN 'LOAN_REFERENCE' THEN 3 WHEN 'WBS_EXCEPTION' THEN 4 WHEN 'UNMATCHED_BANK_PAYMENT' THEN 5 WHEN 'PREPAID_COVERAGE' THEN 6 ELSE 99 END;
END;
$$;

-- A newly inserted receipt was previously reread as IN_PROGRESS, so a first
-- explanation could never reach completion.  Preserve replay/stale handling
-- while distinguishing the insert that this request just performed.
CREATE OR REPLACE FUNCTION refs_begin_ai_accounting_analysis_explanation(p_tenant uuid,p_entity uuid,p_summary jsonb,p_evidence jsonb,p_idempotency_key text,p_request_hash text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE actor text:=refs_current_actor(); receipt idempotency_receipt; expected_hash text; stale interval:='3 minutes'; inserted boolean:=false;
BEGIN
  PERFORM refs_assert_ai_analysis_scope(p_tenant,p_entity);
  IF actor IS NULL THEN RAISE EXCEPTION 'Authenticated AI analysis requester missing' USING ERRCODE='42501'; END IF;
  PERFORM refs_assert_ai_accounting_analysis_summary(p_summary);PERFORM refs_assert_ai_accounting_analysis_evidence(p_evidence);expected_hash:=refs_ai_accounting_analysis_evidence_hash(p_tenant,p_entity,p_summary,p_evidence);
  IF p_request_hash<>expected_hash THEN RAISE EXCEPTION 'AI analysis evidence request hash is not canonical' USING ERRCODE='22023'; END IF;
  INSERT INTO idempotency_receipt(tenant_id,operation_scope,idempotency_key,request_hash,status,actor_id)
    VALUES(p_tenant,'AI_ACCOUNTING_ANALYSIS_EXPLANATION:'||p_entity,p_idempotency_key,p_request_hash,'IN_PROGRESS',actor)
    ON CONFLICT DO NOTHING RETURNING * INTO receipt;
  inserted:=FOUND;
  IF inserted THEN RETURN jsonb_build_object('state','STARTED'); END IF;
  SELECT * INTO receipt FROM idempotency_receipt WHERE tenant_id=p_tenant AND operation_scope='AI_ACCOUNTING_ANALYSIS_EXPLANATION:'||p_entity AND idempotency_key=p_idempotency_key FOR UPDATE;
  IF receipt.request_hash<>p_request_hash OR receipt.actor_id<>actor THEN RAISE EXCEPTION 'Idempotency key cannot be reused for different AI evidence or actor' USING ERRCODE='23505'; END IF;
  IF receipt.status='SUCCEEDED' THEN RETURN jsonb_build_object('state','REPLAY','response',receipt.response_body); END IF;
  IF receipt.status='IN_PROGRESS' AND receipt.created_at>=clock_timestamp()-stale THEN RETURN jsonb_build_object('state','IN_PROGRESS'); END IF;
  UPDATE idempotency_receipt SET status='IN_PROGRESS',response_status=NULL,response_body=NULL,completed_at=NULL WHERE idempotency_receipt_id=receipt.idempotency_receipt_id;
  RETURN jsonb_build_object('state','STARTED');
END;
$$;

CREATE OR REPLACE FUNCTION refs_complete_ai_accounting_analysis_explanation(p_tenant uuid,p_entity uuid,p_idempotency_key text,p_request_hash text,p_output jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE actor text:=refs_current_actor(); receipt idempotency_receipt; output_hash text; event_id uuid:=gen_random_uuid(); metadata jsonb;
BEGIN
  PERFORM refs_assert_ai_analysis_scope(p_tenant,p_entity);
  IF actor IS NULL THEN RAISE EXCEPTION 'Authenticated AI analysis requester missing' USING ERRCODE='42501'; END IF;
  IF jsonb_typeof(p_output)<>'object' OR (p_output-ARRAY['traceId','providerRequestId','model','elapsedMs','result']::text[])<>'{}'::jsonb
     OR COALESCE(length(btrim(p_output->>'traceId')),0) NOT BETWEEN 8 AND 200 OR COALESCE(length(btrim(p_output->>'model')),0) NOT BETWEEN 1 AND 128
     OR jsonb_typeof(p_output->'providerRequestId') NOT IN ('string','null') OR jsonb_typeof(p_output->'elapsedMs')<>'number' OR COALESCE(p_output->>'elapsedMs','') !~ '^\d+$'
     OR jsonb_typeof(p_output->'result')<>'object' OR ((p_output->'result')-ARRAY['headline','risk_level','narrative','controller_actions','can_create_draft','can_review','can_approve','can_post']::text[])<>'{}'::jsonb
     OR COALESCE(length(btrim(p_output->'result'->>'headline')),0) NOT BETWEEN 1 AND 280 OR COALESCE(p_output->'result'->>'risk_level','') NOT IN ('HIGH','MEDIUM','LOW','NONE') OR COALESCE(length(btrim(p_output->'result'->>'narrative')),0) NOT BETWEEN 1 AND 4000
     OR jsonb_typeof(p_output->'result'->'controller_actions')<>'array' OR jsonb_array_length(p_output->'result'->'controller_actions')>6
     OR EXISTS(SELECT 1 FROM jsonb_array_elements(p_output->'result'->'controller_actions') AS action(value)
       WHERE jsonb_typeof(action.value)<>'object' OR (action.value-ARRAY['category','action','finding_ids']::text[])<>'{}'::jsonb
         OR COALESCE(action.value->>'category','') NOT IN ('WBS_EXCEPTION','PREPAID_COVERAGE','DUPLICATE_PAYABLE','UNMATCHED_BANK_PAYMENT','COST_DIMENSION','LOAN_REFERENCE')
         OR COALESCE(length(btrim(action.value->>'action')),0) NOT BETWEEN 1 AND 1000
         OR jsonb_typeof(action.value->'finding_ids')<>'array' OR jsonb_array_length(action.value->'finding_ids') NOT BETWEEN 1 AND 10
         OR EXISTS(SELECT 1 FROM jsonb_array_elements_text(action.value->'finding_ids') finding_id WHERE finding_id !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$')
         OR (SELECT count(*)<>count(DISTINCT finding_id) FROM jsonb_array_elements_text(action.value->'finding_ids') finding_id))
     OR p_output->'result'->'can_create_draft'<>'false'::jsonb OR p_output->'result'->'can_review'<>'false'::jsonb OR p_output->'result'->'can_approve'<>'false'::jsonb OR p_output->'result'->'can_post'<>'false'::jsonb THEN
    RAISE EXCEPTION 'AI analysis explanation output is invalid or action-enabled' USING ERRCODE='22023';
  END IF;
  SELECT * INTO receipt FROM idempotency_receipt WHERE tenant_id=p_tenant AND operation_scope='AI_ACCOUNTING_ANALYSIS_EXPLANATION:'||p_entity AND idempotency_key=p_idempotency_key FOR UPDATE;
  IF NOT FOUND OR receipt.request_hash<>p_request_hash OR receipt.actor_id<>actor THEN RAISE EXCEPTION 'AI analysis explanation receipt is absent or does not match the authenticated request' USING ERRCODE='23505'; END IF;
  IF receipt.status='SUCCEEDED' THEN RETURN receipt.response_body; END IF;
  IF receipt.status<>'IN_PROGRESS' THEN RAISE EXCEPTION 'AI analysis explanation receipt is not ready for completion' USING ERRCODE='55000'; END IF;
  output_hash:=refs_jsonb_hash(p_output);metadata:=jsonb_build_object('schema_version','REFS_AI_ACCOUNTING_ANALYSIS_EXPLANATION_V1','trace_id',p_output->>'traceId','provider_request_id',p_output->>'providerRequestId','model',p_output->>'model','elapsed_ms',(p_output->>'elapsedMs')::bigint,'can_create_draft',false,'can_review',false,'can_approve',false,'can_post',false);
  INSERT INTO audit_event(tenant_id,entity_id,event_type,object_type,object_id,action,actor_id,actor_type,permission_used,request_id,correlation_id,idempotency_key,after_hash,reason,metadata)
    VALUES(p_tenant,p_entity,'AI_ACCOUNTING_ANALYSIS_EXPLAINED','AI_ACCOUNTING_ANALYSIS',event_id,'EXPLAIN',actor,'USER',NULLIF(current_setting('refs.ai_analysis_permission',true),''),p_idempotency_key,p_output->>'traceId',p_idempotency_key,output_hash,'Source-bound aggregate finding explanation; no accounting action',metadata);
  INSERT INTO outbox_event(tenant_id,entity_id,aggregate_type,aggregate_id,event_type,payload,payload_hash)
    VALUES(p_tenant,p_entity,'AI_ACCOUNTING_ANALYSIS',event_id,'AI_ACCOUNTING_ANALYSIS_EXPLAINED',metadata,refs_jsonb_hash(metadata));
  UPDATE idempotency_receipt SET status='SUCCEEDED',response_status=200,response_body=p_output,completed_at=clock_timestamp() WHERE idempotency_receipt_id=receipt.idempotency_receipt_id;
  RETURN p_output;
END;
$$;

REVOKE ALL ON FUNCTION refs_assert_ai_analysis_scope(uuid,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION refs_assert_ai_analysis_scope(uuid,uuid) TO refs_app;

COMMIT;
