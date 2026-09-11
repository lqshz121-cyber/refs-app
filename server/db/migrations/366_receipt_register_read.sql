BEGIN;

CREATE FUNCTION refs_project_receipt_row(p_tenant uuid,p_entity uuid,p_receipt uuid)
RETURNS jsonb
LANGUAGE sql STABLE SET search_path=pg_catalog,public,pg_temp AS $$
  SELECT jsonb_build_object(
    'receipt_id',sl.source_link_id,'receipt_created_by',sl.created_by,'receipt_created_at',sl.created_at,
    'attachment_id',a.attachment_id,'attachment_name',a.name,'media_type',a.media_type,
    'size_bytes',a.size_bytes::text,'content_hash',a.content_hash,'storage_ref',a.storage_ref,
    'storage_version',a.storage_version,'uploaded_by',a.uploaded_by,'uploaded_at',a.uploaded_at,
    'verified_at',a.verified_at,'finalized_at',a.finalized_at,'scan_status',a.scan_status,
    'finalization_status',a.finalization_status,
    'source_document_id',d.source_document_id,'source_document_revision',d.version,'source_payload_hash',d.payload_hash,
    'staging_item_id',si.staging_item_id,'staging_revision',si.version,
    'review_status',CASE WHEN si.reviewed_by IS NOT NULL AND si.reviewed_at IS NOT NULL THEN 'REVIEWED' ELSE 'FOR_REVIEW' END,
    'reviewed_by',CASE WHEN si.reviewed_by IS NOT NULL AND si.reviewed_at IS NOT NULL THEN si.reviewed_by END,
    'reviewed_at',CASE WHEN si.reviewed_by IS NOT NULL AND si.reviewed_at IS NOT NULL THEN si.reviewed_at END,
    'extracted_facts',jsonb_build_object(
      'source_system',d.source_system,'source_module',d.source_module,'source_record_id',d.source_record_id,
      'source_version',d.source_version,'document_type',d.document_type,'document_no',d.document_no,
      'business_date',to_char(d.business_date,'YYYY-MM-DD'),'accounting_date',to_char(d.accounting_date,'YYYY-MM-DD'),
      'currency',d.currency,'gross_amount',d.gross_amount::text,
      'line_count',(SELECT count(*)::integer FROM source_document_line l WHERE l.tenant_id=d.tenant_id AND l.entity_id=d.entity_id AND l.source_document_id=d.source_document_id),
      'party_refs',ARRAY(SELECT DISTINCT l.party_ref FROM source_document_line l WHERE l.tenant_id=d.tenant_id AND l.entity_id=d.entity_id AND l.source_document_id=d.source_document_id AND l.party_ref IS NOT NULL ORDER BY l.party_ref),
      'project_refs',ARRAY(SELECT DISTINCT l.project_ref FROM source_document_line l WHERE l.tenant_id=d.tenant_id AND l.entity_id=d.entity_id AND l.source_document_id=d.source_document_id AND l.project_ref IS NOT NULL ORDER BY l.project_ref),
      'property_refs',ARRAY(SELECT DISTINCT l.property_ref FROM source_document_line l WHERE l.tenant_id=d.tenant_id AND l.entity_id=d.entity_id AND l.source_document_id=d.source_document_id AND l.property_ref IS NOT NULL ORDER BY l.property_ref),
      'unit_refs',ARRAY(SELECT DISTINCT l.unit_ref FROM source_document_line l WHERE l.tenant_id=d.tenant_id AND l.entity_id=d.entity_id AND l.source_document_id=d.source_document_id AND l.unit_ref IS NOT NULL ORDER BY l.unit_ref),
      'loan_refs',ARRAY(SELECT DISTINCT l.loan_ref FROM source_document_line l WHERE l.tenant_id=d.tenant_id AND l.entity_id=d.entity_id AND l.source_document_id=d.source_document_id AND l.loan_ref IS NOT NULL ORDER BY l.loan_ref),
      'cost_code_refs',ARRAY(SELECT DISTINCT l.cost_code_ref FROM source_document_line l WHERE l.tenant_id=d.tenant_id AND l.entity_id=d.entity_id AND l.source_document_id=d.source_document_id AND l.cost_code_ref IS NOT NULL ORDER BY l.cost_code_ref)
    ),
    'action_flags',jsonb_build_object('can_upload',false,'can_run_ocr',false,'can_review',false,'can_add_to_books',false,'can_export',false,'can_customize',false,'can_promote_payment',false)
  )
  FROM source_link sl
  JOIN attachment a ON a.tenant_id=sl.tenant_id AND a.entity_id=sl.entity_id AND a.attachment_id=sl.attachment_id
  JOIN source_document d ON d.tenant_id=sl.tenant_id AND d.entity_id=sl.entity_id AND d.source_document_id=sl.source_document_id
  LEFT JOIN staging_item si ON si.tenant_id=d.tenant_id AND si.entity_id=d.entity_id AND si.source_document_id=d.source_document_id
    AND(sl.staging_item_id IS NULL OR si.staging_item_id=sl.staging_item_id)
  WHERE sl.tenant_id=p_tenant AND sl.entity_id=p_entity AND sl.source_link_id=p_receipt
    AND sl.link_type='SOURCE_ATTACHMENT' AND a.scan_status='CLEAN' AND a.finalization_status='VERIFIED_CLEAN';
$$;

CREATE FUNCTION refs_read_receipt_register(p_tenant uuid,p_entity uuid,p_review_status text)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE register_rows jsonb;row_count integer;total_size numeric;
BEGIN
  PERFORM refs_assert_scope(p_tenant,p_entity,'GL.JE.VIEW');
  IF p_review_status NOT IN('FOR_REVIEW','REVIEWED') THEN
    RAISE EXCEPTION 'Receipt review status is invalid' USING ERRCODE='22023';
  END IF;
  WITH projected AS MATERIALIZED (
    SELECT refs_project_receipt_row(p_tenant,p_entity,sl.source_link_id) receipt_row
    FROM source_link sl
    JOIN attachment a ON a.tenant_id=sl.tenant_id AND a.entity_id=sl.entity_id AND a.attachment_id=sl.attachment_id
    JOIN source_document d ON d.tenant_id=sl.tenant_id AND d.entity_id=sl.entity_id AND d.source_document_id=sl.source_document_id
    LEFT JOIN staging_item si ON si.tenant_id=d.tenant_id AND si.entity_id=d.entity_id AND si.source_document_id=d.source_document_id
      AND(sl.staging_item_id IS NULL OR si.staging_item_id=sl.staging_item_id)
    WHERE sl.tenant_id=p_tenant AND sl.entity_id=p_entity AND sl.link_type='SOURCE_ATTACHMENT'
      AND a.scan_status='CLEAN' AND a.finalization_status='VERIFIED_CLEAN'
      AND CASE WHEN si.reviewed_by IS NOT NULL AND si.reviewed_at IS NOT NULL THEN 'REVIEWED' ELSE 'FOR_REVIEW' END=p_review_status
  )
  SELECT COALESCE(jsonb_agg(receipt_row ORDER BY receipt_row->>'receipt_created_at' DESC,receipt_row->>'receipt_id' DESC),'[]'::jsonb),
    count(*)::integer,COALESCE(sum((receipt_row->>'size_bytes')::numeric),0)
  INTO register_rows,row_count,total_size FROM projected;
  RETURN jsonb_build_object(
    'schema_version','RECEIPT_REGISTER_V1','entity_id',p_entity,'review_status',p_review_status,
    'row_count',row_count,'total_size_bytes',total_size::text,'rows',register_rows,
    'action_flags',jsonb_build_object('can_upload',false,'can_run_ocr',false,'can_review',false,'can_add_to_books',false,'can_export',false,'can_customize',false,'can_promote_payment',false)
  );
END;$$;

CREATE FUNCTION refs_read_receipt_detail(p_tenant uuid,p_entity uuid,p_receipt uuid)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE result jsonb;
BEGIN
  PERFORM refs_assert_scope(p_tenant,p_entity,'GL.JE.VIEW');
  result:=refs_project_receipt_row(p_tenant,p_entity,p_receipt);
  IF result IS NULL THEN RAISE EXCEPTION 'Receipt is absent or outside the company' USING ERRCODE='P0002'; END IF;
  RETURN result;
END;$$;

REVOKE ALL ON FUNCTION refs_project_receipt_row(uuid,uuid,uuid) FROM PUBLIC,refs_app;
REVOKE ALL ON FUNCTION refs_read_receipt_register(uuid,uuid,text) FROM PUBLIC;
REVOKE ALL ON FUNCTION refs_read_receipt_detail(uuid,uuid,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION refs_read_receipt_register(uuid,uuid,text) TO refs_app;
GRANT EXECUTE ON FUNCTION refs_read_receipt_detail(uuid,uuid,uuid) TO refs_app;

COMMIT;
