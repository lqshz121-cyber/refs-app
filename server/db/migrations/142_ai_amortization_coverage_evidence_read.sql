BEGIN;

-- A controller must be able to re-read retained coverage evidence after a
-- refresh or another tab opens.  This is a read-only trace; it cannot infer
-- dates, alter evidence, or grant any accounting authority.
CREATE FUNCTION refs_read_ai_amortization_coverage_evidence(p_tenant uuid,p_entity uuid,p_limit integer DEFAULT 50)
RETURNS TABLE(ai_amortization_coverage_evidence_id uuid,source_document_id uuid,source_payload_hash text,source_document_version bigint,
  coverage_start text,coverage_end text,evidence_ref text,evidence_hash text,extraction_method text,coverage_hash text,created_by text,created_at timestamptz,
  can_create_draft boolean,can_review boolean,can_approve boolean,can_post boolean)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
BEGIN
  PERFORM refs_assert_scope(p_tenant,p_entity,'AI.AMORTIZATION.VIEW');
  IF p_limit IS NULL OR p_limit<1 OR p_limit>100 THEN RAISE EXCEPTION 'AI amortization coverage evidence limit must be between 1 and 100' USING ERRCODE='22023'; END IF;
  RETURN QUERY
  SELECT e.ai_amortization_coverage_evidence_id,e.source_document_id,e.source_payload_hash,e.source_document_version,
    to_char(e.coverage_start,'YYYY-MM-DD'),to_char(e.coverage_end,'YYYY-MM-DD'),e.evidence_ref,e.evidence_hash,e.extraction_method,e.coverage_hash,e.created_by,e.created_at,
    false,false,false,false
  FROM ai_amortization_coverage_evidence e
  WHERE e.tenant_id=p_tenant AND e.entity_id=p_entity
  ORDER BY e.created_at DESC,e.ai_amortization_coverage_evidence_id DESC
  LIMIT p_limit;
END;
$$;

REVOKE ALL ON FUNCTION refs_read_ai_amortization_coverage_evidence(uuid,uuid,integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION refs_read_ai_amortization_coverage_evidence(uuid,uuid,integer) TO refs_app;

COMMIT;
