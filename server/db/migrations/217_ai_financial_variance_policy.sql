BEGIN;
CREATE FUNCTION refs_read_ai_financial_variance_policy(p_tenant uuid,p_entity uuid,p_period uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE period_end date;selected setting_snapshot;match_count integer;expected_keys text[]:=ARRAY['minimum_absolute_variance','policy_version','ratio_threshold_basis_points','rule_id','schema_version'];
BEGIN
  PERFORM refs_assert_ai_analysis_scope(p_tenant,p_entity);
  SELECT ends_on INTO period_end FROM accounting_period WHERE tenant_id=p_tenant AND entity_id=p_entity AND period_id=p_period;
  IF NOT FOUND THEN RAISE EXCEPTION 'Accounting period is outside the financial variance policy scope' USING ERRCODE='22023';END IF;
  SELECT count(*) INTO match_count FROM setting_snapshot WHERE tenant_id=p_tenant AND entity_id=p_entity AND family='AI_FINANCIAL_VARIANCE_POLICY' AND scope_type='ENTITY' AND scope_key=p_entity::text AND status='APPROVED' AND effective_from<=period_end::timestamptz AND(effective_to IS NULL OR effective_to>period_end::timestamptz);
  IF match_count=0 THEN RETURN NULL;END IF;IF match_count<>1 THEN RAISE EXCEPTION 'AI financial variance policy scope is ambiguous' USING ERRCODE='23514';END IF;
  SELECT * INTO selected FROM setting_snapshot WHERE tenant_id=p_tenant AND entity_id=p_entity AND family='AI_FINANCIAL_VARIANCE_POLICY' AND scope_type='ENTITY' AND scope_key=p_entity::text AND status='APPROVED' AND effective_from<=period_end::timestamptz AND(effective_to IS NULL OR effective_to>period_end::timestamptz) FOR SHARE;
  IF selected.snapshot_hash IS DISTINCT FROM refs_jsonb_hash(selected.snapshot) OR ARRAY(SELECT jsonb_object_keys(selected.snapshot) ORDER BY 1) IS DISTINCT FROM expected_keys OR selected.snapshot->>'schema_version'<>'AI_FINANCIAL_VARIANCE_POLICY_SNAPSHOT_V1' OR selected.snapshot->>'rule_id'<>'AI_FINANCIAL_STATEMENT_ANOMALY_REVIEW_V1' OR jsonb_typeof(selected.snapshot->'policy_version')<>'number' OR (selected.snapshot->>'policy_version')::integer<1 OR jsonb_typeof(selected.snapshot->'ratio_threshold_basis_points')<>'number' OR (selected.snapshot->>'ratio_threshold_basis_points')::integer NOT BETWEEN 10000 AND 100000 OR coalesce(selected.snapshot->>'minimum_absolute_variance','')!~'^(0|[1-9][0-9]*)\.[0-9]{4}$' THEN RAISE EXCEPTION 'Approved AI financial variance policy is malformed or hash-invalid' USING ERRCODE='23514';END IF;
  RETURN (selected.snapshot-'schema_version'-'rule_id')||jsonb_build_object('schema_version','AI_FINANCIAL_VARIANCE_POLICY_V1','setting_snapshot_id',selected.setting_snapshot_id,'setting_snapshot_hash',selected.snapshot_hash);
END;$$;
REVOKE ALL ON FUNCTION refs_read_ai_financial_variance_policy(uuid,uuid,uuid) FROM PUBLIC;GRANT EXECUTE ON FUNCTION refs_read_ai_financial_variance_policy(uuid,uuid,uuid) TO refs_app;
COMMIT;
