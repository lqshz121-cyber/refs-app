BEGIN;
CREATE FUNCTION refs_integration_transaction_status(p_tenant uuid,p_entity uuid,p_raw_event uuid)
RETURNS text LANGUAGE sql STABLE SET search_path=pg_catalog,public,pg_temp AS $$
 SELECT CASE
      WHEN wr.outcome_kind='EXCEPTION' OR EXISTS(SELECT 1 FROM accounting_exception e LEFT JOIN source_document d ON d.tenant_id=e.tenant_id AND d.entity_id=e.entity_id AND d.source_document_id=e.source_document_id WHERE e.tenant_id=r.tenant_id AND e.entity_id=r.entity_id AND(e.raw_event_id=r.raw_event_id OR d.raw_event_id=r.raw_event_id)) THEN 'EXCEPTION'
      WHEN wr.outcome_kind='STAGING' OR EXISTS(SELECT 1 FROM staging_item s JOIN source_document d ON d.tenant_id=s.tenant_id AND d.entity_id=s.entity_id AND d.source_document_id=s.source_document_id WHERE d.tenant_id=r.tenant_id AND d.entity_id=r.entity_id AND d.raw_event_id=r.raw_event_id) THEN 'STAGED'
      WHEN r.is_current THEN 'IMPORTED' ELSE 'SUPERSEDED' END
 FROM raw_event r
 LEFT JOIN wbs_inbound_receipt ir ON ir.tenant_id=r.tenant_id AND ir.entity_id=r.entity_id AND ir.import_batch_id=r.import_batch_id AND ir.receipt_hash=r.payload_hash
 LEFT JOIN wbs_inbound_row wr ON wr.tenant_id=ir.tenant_id AND wr.entity_id=ir.entity_id AND wr.receipt_id=ir.receipt_id AND wr.source_record_id=r.source_record_id AND wr.source_version=r.source_version
 WHERE r.tenant_id=p_tenant AND r.entity_id=p_entity AND r.raw_event_id=p_raw_event;
$$;
REVOKE ALL ON FUNCTION refs_integration_transaction_status(uuid,uuid,uuid) FROM PUBLIC,refs_app;

CREATE OR REPLACE FUNCTION refs_read_integration_transaction_register(p_tenant uuid,p_entity uuid,p_connector text,p_source_module text,p_status text,p_after uuid,p_limit integer)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE after_received timestamptz;page_rows jsonb;connection_rows jsonb;next_id uuid;
BEGIN
  PERFORM refs_assert_scope(p_tenant,p_entity,'WBS.AUTOREC.VIEW');
  IF p_status IS NULL OR p_status NOT IN('ALL','IMPORTED','STAGED','EXCEPTION','SUPERSEDED') OR p_limit IS NULL OR p_limit<1 OR p_limit>100 OR p_connector IS NOT NULL AND(length(btrim(p_connector)) NOT BETWEEN 1 AND 256 OR p_connector<>btrim(p_connector)) OR p_source_module IS NOT NULL AND(length(btrim(p_source_module)) NOT BETWEEN 1 AND 256 OR p_source_module<>btrim(p_source_module)) THEN RAISE EXCEPTION 'Integration transaction selection is invalid' USING ERRCODE='22023'; END IF;
  IF p_after IS NOT NULL THEN SELECT r.received_at INTO after_received FROM raw_event r JOIN import_batch b ON b.tenant_id=r.tenant_id AND b.entity_id=r.entity_id AND b.import_batch_id=r.import_batch_id WHERE r.tenant_id=p_tenant AND r.entity_id=p_entity AND r.raw_event_id=p_after AND(p_connector IS NULL OR b.connector_code=p_connector) AND(p_source_module IS NULL OR r.source_module=p_source_module) AND(p_status='ALL' OR refs_integration_transaction_status(p_tenant,p_entity,r.raw_event_id)=p_status);IF NOT FOUND THEN RAISE EXCEPTION 'Integration transaction cursor is outside the selected company and filters' USING ERRCODE='22023';END IF;END IF;
  -- Select the page before expanding hashes, downstream references and audit arrays.
  WITH selected AS MATERIALIZED (
    SELECT r.raw_event_id,r.received_at
    FROM raw_event r JOIN import_batch b ON b.tenant_id=r.tenant_id AND b.entity_id=r.entity_id AND b.import_batch_id=r.import_batch_id
    WHERE r.tenant_id=p_tenant AND r.entity_id=p_entity
      AND(p_connector IS NULL OR b.connector_code=p_connector) AND(p_source_module IS NULL OR r.source_module=p_source_module)
      AND(p_after IS NULL OR(r.received_at,r.raw_event_id)<(after_received,p_after))
      AND CASE WHEN p_status='ALL' THEN true ELSE refs_integration_transaction_status(p_tenant,p_entity,r.raw_event_id)=p_status END
    ORDER BY r.received_at DESC,r.raw_event_id DESC LIMIT p_limit
  ),projected AS MATERIALIZED (
    SELECT raw_event_id,received_at,refs_project_integration_transaction_row(p_tenant,p_entity,raw_event_id) transaction_row FROM selected
  )
  SELECT COALESCE(jsonb_agg(transaction_row ORDER BY received_at DESC,raw_event_id DESC),'[]'::jsonb),CASE WHEN count(*)=p_limit THEN (array_agg(raw_event_id ORDER BY received_at DESC,raw_event_id DESC))[p_limit] END INTO page_rows,next_id FROM projected;
  WITH latest AS MATERIALIZED (
    SELECT DISTINCT ON(b.connector_code,b.source_module,b.source_entity_id) b.* FROM import_batch b WHERE b.tenant_id=p_tenant AND b.entity_id=p_entity ORDER BY b.connector_code,b.source_module,b.source_entity_id,b.created_at DESC,b.import_batch_id DESC
  )
  SELECT COALESCE(jsonb_agg(jsonb_build_object('connector_code',b.connector_code,'source_module',b.source_module,'source_entity_id',b.source_entity_id,'connection_revision',c.version::text,'connection_status',b.status,'latest_import_batch_id',b.import_batch_id,'latest_request_hash',b.request_hash,'last_read_at',b.completed_at,'last_success_at',c.last_success_at,'transaction_count',(SELECT count(*)::integer FROM raw_event r JOIN import_batch rb ON rb.tenant_id=r.tenant_id AND rb.entity_id=r.entity_id AND rb.import_batch_id=r.import_batch_id WHERE rb.tenant_id=b.tenant_id AND rb.entity_id=b.entity_id AND rb.connector_code=b.connector_code AND rb.source_module=b.source_module AND rb.source_entity_id=b.source_entity_id)) ORDER BY b.connector_code,b.source_module,b.source_entity_id),'[]'::jsonb) INTO connection_rows
  FROM latest b LEFT JOIN sync_cursor c ON c.tenant_id=b.tenant_id AND c.entity_id=b.entity_id AND c.connector_code=b.connector_code AND c.source_module=b.source_module AND c.source_entity_id=b.source_entity_id;
  RETURN jsonb_build_object('schema_version','INTEGRATION_TRANSACTION_REGISTER_V1','entity_id',p_entity,'connector_code',p_connector,'source_module',p_source_module,'transaction_status',p_status,'after_id',p_after,'limit',p_limit,'read_at',statement_timestamp(),'connections',connection_rows,'rows',page_rows,'next_id',next_id,'action_flags',jsonb_build_object('can_setup_connector',false,'can_sync_provider',false,'can_import',false,'can_map',false,'can_create_draft',false,'can_post',false,'can_call_external_action',false));
END;$$;
COMMIT;
