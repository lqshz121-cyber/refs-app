BEGIN;

CREATE OR REPLACE FUNCTION refs_read_wbs_autorec_mappings(p_tenant uuid,p_entity uuid,p_company text)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE result jsonb;
BEGIN
 PERFORM refs_assert_scope(p_tenant,p_entity,'WBS.SNAPSHOT.IMPORT');
 IF coalesce(length(btrim(p_company)),0)=0 THEN RAISE EXCEPTION 'WBS mapping read scope is invalid' USING ERRCODE='22023'; END IF;
 SELECT coalesce(jsonb_agg(jsonb_build_object('mapping_id',mapping_snapshot_id,'version',version::text,'snapshot_hash',snapshot_hash,'status',status,'entity_id',p_entity,'company_key',input_keys->>'company_key','source_type',input_keys->>'source_type','currency',input_keys->>'currency','bank_account_ref',input_keys->>'bank_account_ref','effective_from',effective_from,'effective_to',effective_to) ORDER BY priority DESC,mapping_snapshot_id),'[]'::jsonb) INTO result
 FROM mapping_snapshot WHERE tenant_id=p_tenant AND entity_id=p_entity AND family='WBS_AUTOREC' AND status='APPROVED'
  AND effective_from<=clock_timestamp() AND (effective_to IS NULL OR effective_to>clock_timestamp()) AND input_keys->>'company_key'=p_company
  AND coalesce(input_keys->>'source_type','')<>'' AND coalesce(input_keys->>'currency','')<>'';
 RETURN result;
END $$;

REVOKE ALL ON FUNCTION refs_read_wbs_autorec_mappings(uuid,uuid,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION refs_read_wbs_autorec_mappings(uuid,uuid,text) TO refs_app;
COMMIT;
