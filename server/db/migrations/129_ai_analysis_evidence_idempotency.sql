BEGIN;

-- A controller memo is authoritative only for the exact retained evidence it
-- received.  Aggregate counts alone are not a sufficient idempotency basis.
CREATE FUNCTION refs_ai_accounting_analysis_evidence_hash(p_tenant uuid,p_entity uuid,p_summary jsonb,p_evidence jsonb) RETURNS text LANGUAGE sql IMMUTABLE SET search_path=pg_catalog,public,pg_temp AS $$
  SELECT refs_jsonb_hash(jsonb_build_object('schema_version','REFS_AI_ACCOUNTING_ANALYSIS_EVIDENCE_V2','tenant_id',p_tenant,'entity_id',p_entity,'summary',p_summary,'retained_evidence',p_evidence))
$$;

CREATE FUNCTION refs_assert_ai_accounting_analysis_evidence(p_evidence jsonb) RETURNS void LANGUAGE plpgsql IMMUTABLE SET search_path=pg_catalog,public,pg_temp AS $$
BEGIN
  IF jsonb_typeof(p_evidence)<>'array' OR jsonb_array_length(p_evidence)>120 OR EXISTS(
    SELECT 1 FROM jsonb_array_elements(p_evidence) item
    WHERE jsonb_typeof(item)<>'object'
      OR (item-'category'-'finding_id'-'rule_id'-'risk_level'-'confidence'-'reason'-'suggested_action'-'source_refs'-'evidence_hashes'-'source_versions'-'created_at')<>'{}'::jsonb
      OR item->>'category' NOT IN ('WBS_EXCEPTION','PREPAID_COVERAGE','DUPLICATE_PAYABLE','UNMATCHED_BANK_PAYMENT','COST_DIMENSION','LOAN_REFERENCE')
      OR COALESCE(item->>'finding_id','') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
      OR COALESCE(length(btrim(item->>'rule_id')),0) NOT BETWEEN 1 AND 128
      OR COALESCE(item->>'risk_level','') NOT IN ('HIGH','MEDIUM','LOW')
      OR jsonb_typeof(item->'confidence')<>'number' OR COALESCE(item->>'confidence','') !~ '^(0|1|0\.\d+|1\.0+)$'
      OR COALESCE(length(btrim(item->>'reason')),0) NOT BETWEEN 1 AND 2000 OR COALESCE(length(btrim(item->>'suggested_action')),0) NOT BETWEEN 1 AND 2000
      OR jsonb_typeof(item->'source_refs')<>'array' OR jsonb_array_length(item->'source_refs') NOT BETWEEN 1 AND 3 OR EXISTS(SELECT 1 FROM jsonb_array_elements(item->'source_refs') value WHERE jsonb_typeof(value)<>'string' OR COALESCE(length(btrim(value#>>'{}')),0) NOT BETWEEN 1 AND 128)
      OR jsonb_typeof(item->'evidence_hashes')<>'array' OR jsonb_array_length(item->'evidence_hashes') NOT BETWEEN 1 AND 4 OR EXISTS(SELECT 1 FROM jsonb_array_elements(item->'evidence_hashes') value WHERE jsonb_typeof(value)<>'string' OR COALESCE(value#>>'{}','') !~ '^sha256:[0-9a-f]{64}$')
      OR jsonb_typeof(item->'source_versions')<>'array' OR jsonb_array_length(item->'source_versions')>3 OR EXISTS(SELECT 1 FROM jsonb_array_elements(item->'source_versions') value WHERE jsonb_typeof(value)<>'number' OR COALESCE(value#>>'{}','') !~ '^\d+$')
      OR COALESCE(length(btrim(item->>'created_at')),0) NOT BETWEEN 1 AND 64
  ) OR (SELECT count(*)<>count(DISTINCT item->>'finding_id') FROM jsonb_array_elements(p_evidence) item) THEN
    RAISE EXCEPTION 'AI accounting analysis evidence must be a unique bounded redacted finding set' USING ERRCODE='22023';
  END IF;
END;
$$;

CREATE FUNCTION refs_begin_ai_accounting_analysis_explanation(p_tenant uuid,p_entity uuid,p_summary jsonb,p_evidence jsonb,p_idempotency_key text,p_request_hash text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE actor text:=refs_current_actor(); receipt idempotency_receipt; expected_hash text; stale interval:='3 minutes';
BEGIN
  PERFORM refs_assert_scope(p_tenant,p_entity,'AI.AMORTIZATION.PROPOSE');
  IF actor IS NULL THEN RAISE EXCEPTION 'Authenticated AI analysis requester missing' USING ERRCODE='42501'; END IF;
  PERFORM refs_assert_ai_accounting_analysis_summary(p_summary);PERFORM refs_assert_ai_accounting_analysis_evidence(p_evidence);expected_hash:=refs_ai_accounting_analysis_evidence_hash(p_tenant,p_entity,p_summary,p_evidence);
  IF p_request_hash<>expected_hash THEN RAISE EXCEPTION 'AI analysis evidence request hash is not canonical' USING ERRCODE='22023'; END IF;
  INSERT INTO idempotency_receipt(tenant_id,operation_scope,idempotency_key,request_hash,status,actor_id)
    VALUES(p_tenant,'AI_ACCOUNTING_ANALYSIS_EXPLANATION:'||p_entity,p_idempotency_key,p_request_hash,'IN_PROGRESS',actor) ON CONFLICT DO NOTHING;
  SELECT * INTO receipt FROM idempotency_receipt WHERE tenant_id=p_tenant AND operation_scope='AI_ACCOUNTING_ANALYSIS_EXPLANATION:'||p_entity AND idempotency_key=p_idempotency_key FOR UPDATE;
  IF receipt.request_hash<>p_request_hash OR receipt.actor_id<>actor THEN RAISE EXCEPTION 'Idempotency key cannot be reused for different AI evidence or actor' USING ERRCODE='23505'; END IF;
  IF receipt.status='SUCCEEDED' THEN RETURN jsonb_build_object('state','REPLAY','response',receipt.response_body); END IF;
  IF receipt.status='IN_PROGRESS' AND receipt.created_at>=clock_timestamp()-stale THEN RETURN jsonb_build_object('state','IN_PROGRESS'); END IF;
  UPDATE idempotency_receipt SET status='IN_PROGRESS',response_status=NULL,response_body=NULL,completed_at=NULL WHERE idempotency_receipt_id=receipt.idempotency_receipt_id;
  RETURN jsonb_build_object('state','STARTED');
END;
$$;

REVOKE ALL ON FUNCTION refs_ai_accounting_analysis_evidence_hash(uuid,uuid,jsonb,jsonb),refs_assert_ai_accounting_analysis_evidence(jsonb),refs_begin_ai_accounting_analysis_explanation(uuid,uuid,jsonb,jsonb,text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION refs_ai_accounting_analysis_evidence_hash(uuid,uuid,jsonb,jsonb),refs_begin_ai_accounting_analysis_explanation(uuid,uuid,jsonb,jsonb,text,text) TO refs_app;
COMMIT;
