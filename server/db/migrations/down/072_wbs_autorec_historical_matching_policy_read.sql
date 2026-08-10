BEGIN;

CREATE OR REPLACE FUNCTION refs_read_wbs_autorec_matching_policies(p_tenant uuid,p_entity uuid,p_company text)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE result jsonb;
BEGIN
 PERFORM refs_assert_scope(p_tenant,p_entity,'WBS.SNAPSHOT.IMPORT');
 IF coalesce(length(btrim(p_company)),0)=0 THEN RAISE EXCEPTION 'WBS matching-policy read scope is invalid' USING ERRCODE='22023'; END IF;
 SELECT coalesce(jsonb_agg(jsonb_build_object(
   'policy_id',mapping_snapshot_id,'version',version::text,'mapping_id',mapping_snapshot_id,'mapping_version',version::text,
   'policy_snapshot_hash',snapshot_hash,'status',status,'entity_id',p_entity,'company_key',input_keys->>'company_key',
   'currency',input_keys->>'currency','bank_account_ref',input_keys->>'bank_account_ref','effective_from',effective_from,'effective_to',effective_to,
   'rule_id',output_rules->>'rule_id','rule_version',output_rules->>'rule_version','bank_mapping_id',output_rules->>'bank_mapping_id',
   'bank_mapping_version',output_rules->>'bank_mapping_version','bank_mapping_snapshot_hash',output_rules->>'bank_mapping_snapshot_hash',
   'business_mapping_id',output_rules->>'business_mapping_id','business_mapping_version',output_rules->>'business_mapping_version',
   'business_mapping_snapshot_hash',output_rules->>'business_mapping_snapshot_hash','amount_tolerance',output_rules->>'amount_tolerance',
   'date_window_days',output_rules->>'date_window_days','date_match_basis',output_rules->>'date_match_basis'
 ) ORDER BY priority DESC,mapping_snapshot_id),'[]'::jsonb) INTO result
 FROM mapping_snapshot WHERE tenant_id=p_tenant AND entity_id=p_entity AND family='WBS_AUTOREC_MATCH' AND status='APPROVED'
  AND effective_from<=clock_timestamp() AND (effective_to IS NULL OR effective_to>clock_timestamp())
  AND input_keys->>'company_key'=p_company AND coalesce(input_keys->>'currency','')<>'' AND coalesce(input_keys->>'bank_account_ref','')<>'';
 RETURN result;
END $$;

REVOKE ALL ON FUNCTION refs_read_wbs_autorec_matching_policies(uuid,uuid,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION refs_read_wbs_autorec_matching_policies(uuid,uuid,text) TO refs_app;
COMMIT;
