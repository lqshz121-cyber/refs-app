BEGIN;

-- A completed controller memo is a retained analysis report.  It is read from
-- the durable receipt, never recomputed from changing findings or browser state.
CREATE FUNCTION refs_read_ai_accounting_analysis_reports(p_tenant uuid,p_entity uuid,p_limit integer DEFAULT 20)
RETURNS TABLE(idempotency_key text,request_hash text,actor_id text,completed_at timestamptz,report jsonb,can_create_draft boolean,can_review boolean,can_approve boolean,can_post boolean)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
BEGIN
  PERFORM refs_assert_ai_analysis_scope(p_tenant,p_entity);
  IF p_limit IS NULL OR p_limit<1 OR p_limit>50 THEN RAISE EXCEPTION 'AI accounting analysis report limit must be between 1 and 50' USING ERRCODE='22023'; END IF;
  RETURN QUERY
    SELECT receipt.idempotency_key,receipt.request_hash,receipt.actor_id,receipt.completed_at,receipt.response_body,false,false,false,false
    FROM idempotency_receipt receipt
    WHERE receipt.tenant_id=p_tenant
      AND receipt.operation_scope='AI_ACCOUNTING_ANALYSIS_EXPLANATION:'||p_entity
      AND receipt.status='SUCCEEDED'
      AND receipt.response_status=200
      AND receipt.completed_at IS NOT NULL
      AND jsonb_typeof(receipt.response_body)='object'
    ORDER BY receipt.completed_at DESC,receipt.idempotency_receipt_id DESC
    LIMIT p_limit;
END;
$$;

REVOKE ALL ON FUNCTION refs_read_ai_accounting_analysis_reports(uuid,uuid,integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION refs_read_ai_accounting_analysis_reports(uuid,uuid,integer) TO refs_app;

COMMIT;
