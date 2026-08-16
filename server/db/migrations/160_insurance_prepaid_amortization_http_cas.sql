BEGIN;

-- HTTP review requires a strong source-version validator in addition to the
-- immutable source/proposal/coverage hashes consumed by migration 141.
CREATE FUNCTION refs_review_insurance_prepaid_amortization_http(
  p_tenant uuid,p_entity uuid,p_admission uuid,p_schedule uuid,p_schedule_line uuid,p_period uuid,p_setting uuid,p_mapping uuid,
  p_capitalization_journal uuid,p_capitalization_ledger_line uuid,p_expected_source_version bigint,
  p_expected_source_hash text,p_expected_proposal_hash text,p_expected_coverage_hash text,p_reason text,p_idempotency_key text
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE schedule_version bigint; current_source_version bigint; request_hash text;
BEGIN
  PERFORM refs_assert_scope(p_tenant,p_entity,'PREPAID.AMORTIZATION.REVIEW');
  IF p_expected_source_version IS NULL OR p_expected_source_version<0 THEN
    RAISE EXCEPTION 'Insurance amortization source version is invalid' USING ERRCODE='22023';
  END IF;
  SELECT s.source_document_version,d.version INTO schedule_version,current_source_version
  FROM ai_amortization_schedule s
  JOIN source_document d ON d.tenant_id=s.tenant_id AND d.entity_id=s.entity_id AND d.source_document_id=s.source_document_id
  WHERE s.tenant_id=p_tenant AND s.entity_id=p_entity AND s.ai_amortization_schedule_id=p_schedule
    AND s.source_document_id=d.source_document_id AND d.payload_hash=p_expected_source_hash
  FOR SHARE OF s,d;
  IF schedule_version IS NULL OR schedule_version<>p_expected_source_version OR current_source_version<>p_expected_source_version THEN
    RAISE EXCEPTION 'Insurance amortization source version changed before review' USING ERRCODE='40001';
  END IF;
  request_hash:=refs_review_insurance_prepaid_amortization_hash(p_tenant,p_entity,p_admission,p_schedule,p_schedule_line,p_period,p_setting,p_mapping,p_capitalization_journal,p_capitalization_ledger_line,p_expected_source_hash,p_expected_proposal_hash,p_expected_coverage_hash,p_reason);
  RETURN refs_review_insurance_prepaid_amortization(p_tenant,p_entity,p_admission,p_schedule,p_schedule_line,p_period,p_setting,p_mapping,p_capitalization_journal,p_capitalization_ledger_line,p_expected_source_hash,p_expected_proposal_hash,p_expected_coverage_hash,p_reason,p_idempotency_key,request_hash);
END;
$$;

REVOKE ALL ON FUNCTION refs_review_insurance_prepaid_amortization_http(uuid,uuid,uuid,uuid,uuid,uuid,uuid,uuid,uuid,uuid,bigint,text,text,text,text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION refs_review_insurance_prepaid_amortization_http(uuid,uuid,uuid,uuid,uuid,uuid,uuid,uuid,uuid,uuid,bigint,text,text,text,text,text) TO refs_app;

COMMIT;
