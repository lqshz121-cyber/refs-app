BEGIN;

CREATE OR REPLACE FUNCTION refs_read_wbs_inbound_rows(p_tenant uuid,p_entity uuid,p_company text,p_source_records text[])
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE result jsonb;
BEGIN
 PERFORM refs_assert_scope(p_tenant,p_entity,'WBS.SNAPSHOT.IMPORT');
 IF coalesce(length(btrim(p_company)),0)=0 OR coalesce(cardinality(p_source_records),0)=0 OR EXISTS(SELECT 1 FROM unnest(p_source_records) value WHERE coalesce(length(btrim(value)),0)=0) THEN RAISE EXCEPTION 'WBS inbound read scope is invalid' USING ERRCODE='22023'; END IF;
 SELECT coalesce(jsonb_agg(projected ORDER BY projected->>'source_record_id',projected->>'source_version'),'[]'::jsonb) INTO result FROM (
  SELECT jsonb_strip_nulls(row.normalized||row.outcome||jsonb_build_object(
   'tenant_id',row.tenant_id,'entity_id',row.entity_id,'receipt_id',receipt.receipt_id,'receipt_ref',receipt.payload_ref,'receipt_hash',receipt.receipt_hash,
   'source_record_id',row.source_record_id,'source_version',row.source_version,'company_key',coalesce(row.outcome->>'company_key',row.normalized->>'company_key',row.raw->>'company_key'),'outcome_kind',row.outcome_kind)) projected
  FROM wbs_inbound_row row JOIN wbs_inbound_receipt receipt ON receipt.receipt_id=row.receipt_id AND receipt.tenant_id=row.tenant_id AND receipt.entity_id=row.entity_id
  WHERE row.tenant_id=p_tenant AND row.entity_id=p_entity AND row.source_record_id=ANY(p_source_records)
   AND coalesce(row.outcome->>'company_key',row.normalized->>'company_key',row.raw->>'company_key')=p_company
   AND coalesce(row.outcome->>'detail_kind',row.normalized->>'detail_kind','')='' AND coalesce(row.outcome->>'control_kind',row.normalized->>'control_kind','')=''
   AND coalesce(row.outcome->>'source_type',row.normalized->>'source_type',row.raw->>'source_type','')<>'AUTOREC_COMPANY_CONTROL'
 ) readable;
 RETURN result;
END $$;

CREATE OR REPLACE FUNCTION refs_read_wbs_autorec_control_rows(p_tenant uuid,p_entity uuid,p_company text,p_source_records text[])
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE result jsonb;
BEGIN
 PERFORM refs_assert_scope(p_tenant,p_entity,'WBS.SNAPSHOT.IMPORT');
 IF coalesce(length(btrim(p_company)),0)=0 OR coalesce(cardinality(p_source_records),0)=0 OR EXISTS(SELECT 1 FROM unnest(p_source_records) value WHERE coalesce(length(btrim(value)),0)=0) THEN RAISE EXCEPTION 'WBS control read scope is invalid' USING ERRCODE='22023'; END IF;
 WITH projected AS (
  SELECT jsonb_strip_nulls(row.normalized||row.outcome||jsonb_build_object(
   'tenant_id',row.tenant_id,'entity_id',row.entity_id,'receipt_id',receipt.receipt_id,'receipt_ref',receipt.payload_ref,'receipt_hash',receipt.receipt_hash,
   'source_record_id',row.source_record_id,'source_version',row.source_version,'company_key',coalesce(row.outcome->>'company_key',row.normalized->>'company_key',row.raw->>'company_key'))) item
  FROM wbs_inbound_row row JOIN wbs_inbound_receipt receipt ON receipt.receipt_id=row.receipt_id AND receipt.tenant_id=row.tenant_id AND receipt.entity_id=row.entity_id
  WHERE row.tenant_id=p_tenant AND row.entity_id=p_entity AND row.source_record_id=ANY(p_source_records)
   AND coalesce(row.outcome->>'company_key',row.normalized->>'company_key',row.raw->>'company_key')=p_company
 ) SELECT jsonb_build_object(
  'companyRows',coalesce(jsonb_agg(item ORDER BY item->>'source_record_id') FILTER(WHERE coalesce(item->>'control_kind',item->>'source_type')='AUTOREC_COMPANY_CONTROL'),'[]'::jsonb),
  'detailRows',coalesce(jsonb_agg(item ORDER BY item->>'source_record_id') FILTER(WHERE coalesce(item->>'detail_kind','')<>''),'[]'::jsonb),
  'persistedRows',coalesce(jsonb_agg(item ORDER BY item->>'source_record_id') FILTER(WHERE coalesce(item->>'control_kind',item->>'source_type')='AUTOREC_COMPANY_CONTROL' OR coalesce(item->>'detail_kind','')<>''),'[]'::jsonb)
 ) INTO result FROM projected;
 RETURN result;
END $$;

CREATE OR REPLACE FUNCTION refs_read_wbs_autorec_mappings(p_tenant uuid,p_entity uuid,p_company text)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE result jsonb;
BEGIN
 PERFORM refs_assert_scope(p_tenant,p_entity,'WBS.SNAPSHOT.IMPORT');
 IF coalesce(length(btrim(p_company)),0)=0 THEN RAISE EXCEPTION 'WBS mapping read scope is invalid' USING ERRCODE='22023'; END IF;
 SELECT coalesce(jsonb_agg(jsonb_build_object('mapping_id',mapping_snapshot_id,'version',version::text,'status',status,'entity_id',p_entity,'company_key',input_keys->>'company_key','source_type',input_keys->>'source_type','currency',input_keys->>'currency','bank_account_ref',input_keys->>'bank_account_ref') ORDER BY priority DESC,mapping_snapshot_id),'[]'::jsonb) INTO result
 FROM mapping_snapshot WHERE tenant_id=p_tenant AND (entity_id IS NULL OR entity_id=p_entity) AND family='WBS_AUTOREC' AND status='APPROVED'
  AND effective_from<=clock_timestamp() AND (effective_to IS NULL OR effective_to>clock_timestamp()) AND input_keys->>'company_key'=p_company
  AND coalesce(input_keys->>'source_type','')<>'' AND coalesce(input_keys->>'currency','')<>'';
 RETURN result;
END $$;

REVOKE ALL ON FUNCTION refs_read_wbs_inbound_rows(uuid,uuid,text,text[]) FROM PUBLIC;
REVOKE ALL ON FUNCTION refs_read_wbs_autorec_control_rows(uuid,uuid,text,text[]) FROM PUBLIC;
REVOKE ALL ON FUNCTION refs_read_wbs_autorec_mappings(uuid,uuid,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION refs_read_wbs_inbound_rows(uuid,uuid,text,text[]) TO refs_app;
GRANT EXECUTE ON FUNCTION refs_read_wbs_autorec_control_rows(uuid,uuid,text,text[]) TO refs_app;
GRANT EXECUTE ON FUNCTION refs_read_wbs_autorec_mappings(uuid,uuid,text) TO refs_app;
COMMIT;
