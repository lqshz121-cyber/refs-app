BEGIN;

ALTER FUNCTION refs_attest_wbs_operator_payables(uuid,uuid,timestamptz,text,text,jsonb,jsonb,text,text,text)
  RENAME TO refs_attest_wbs_operator_payables_104;

CREATE FUNCTION refs_attest_wbs_operator_payables(
  p_tenant uuid,p_entity uuid,p_captured_at timestamptz,p_provider_content_hash text,
  p_observation_hash text,p_company_codes jsonb,p_rows jsonb,p_reason text,
  p_idempotency_key text,p_request_hash text
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE normalized_rows jsonb; expected_request_hash text;
BEGIN
  expected_request_hash:=refs_wbs_operator_payable_attest_hash(
    p_tenant,p_entity,p_captured_at,p_provider_content_hash,p_observation_hash,p_company_codes,p_rows,p_reason
  );
  IF p_request_hash<>expected_request_hash THEN
    RAISE EXCEPTION 'WBS operator attestation request hash is not canonical' USING ERRCODE='22023';
  END IF;
  IF jsonb_typeof(p_rows)<>'array' THEN
    RAISE EXCEPTION 'WBS operator attestation rows are invalid' USING ERRCODE='22023';
  END IF;
  SELECT COALESCE(jsonb_agg(
    jsonb_set(value,'{row_hash}',to_jsonb(refs_jsonb_hash(value->'raw')),true)
    ORDER BY ordinal
  ),'[]'::jsonb)
  INTO normalized_rows
  FROM jsonb_array_elements(p_rows) WITH ORDINALITY AS row_item(value,ordinal);

  RETURN refs_attest_wbs_operator_payables_104(
    p_tenant,p_entity,p_captured_at,p_provider_content_hash,p_observation_hash,p_company_codes,
    normalized_rows,p_reason,p_idempotency_key,
    refs_wbs_operator_payable_attest_hash(
      p_tenant,p_entity,p_captured_at,p_provider_content_hash,p_observation_hash,p_company_codes,normalized_rows,p_reason
    )
  );
END;
$$;

REVOKE ALL ON FUNCTION refs_attest_wbs_operator_payables_104(uuid,uuid,timestamptz,text,text,jsonb,jsonb,text,text,text) FROM PUBLIC,refs_app;
REVOKE ALL ON FUNCTION refs_attest_wbs_operator_payables(uuid,uuid,timestamptz,text,text,jsonb,jsonb,text,text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION refs_attest_wbs_operator_payables(uuid,uuid,timestamptz,text,text,jsonb,jsonb,text,text,text) TO refs_app;

COMMIT;
