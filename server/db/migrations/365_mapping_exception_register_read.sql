BEGIN;

CREATE FUNCTION refs_read_mapping_exception_register(p_tenant uuid,p_entity uuid,p_period uuid)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE period_row accounting_period;register_rows jsonb;row_count integer;open_count integer;review_count integer;resolved_count integer;waived_count integer;
BEGIN
  PERFORM refs_assert_scope(p_tenant,p_entity,'GL.JE.VIEW');
  SELECT * INTO period_row FROM accounting_period
   WHERE tenant_id=p_tenant AND entity_id=p_entity AND period_id=p_period AND ledger_code='PRIMARY';
  IF NOT FOUND THEN RAISE EXCEPTION 'Mapping Exceptions requires one primary company period' USING ERRCODE='22023'; END IF;

  WITH scoped AS MATERIALIZED (
    SELECT ae.exception_id,ae.version,ae.exception_code,ae.status,ae.severity,ae.owner,ae.details,ae.created_at,
      ae.resolved_by,ae.resolved_at,ae.resolution,d.source_document_id,d.version source_document_revision,
      d.source_system,d.source_module,d.source_record_id,d.source_version,
      d.document_type,d.document_no,d.accounting_date,d.currency,d.gross_amount,d.payload_hash,
      si.staging_item_id,si.version staging_version,si.status staging_status,si.mapping_snapshot_id,
      ms.family mapping_family,ms.version mapping_version,ms.status mapping_status,ms.snapshot_hash mapping_snapshot_hash,
      ms.effective_from mapping_effective_from,ms.effective_to mapping_effective_to
    FROM accounting_exception ae
    LEFT JOIN staging_item si ON si.tenant_id=ae.tenant_id AND si.entity_id=ae.entity_id
      AND(si.staging_item_id=ae.staging_item_id OR(ae.staging_item_id IS NULL AND si.source_document_id=ae.source_document_id))
    JOIN source_document d ON d.tenant_id=ae.tenant_id AND d.entity_id=ae.entity_id
      AND d.source_document_id=COALESCE(ae.source_document_id,si.source_document_id)
    LEFT JOIN mapping_snapshot ms ON ms.tenant_id=si.tenant_id AND ms.mapping_snapshot_id=si.mapping_snapshot_id
    WHERE ae.tenant_id=p_tenant AND ae.entity_id=p_entity
      AND d.accounting_date BETWEEN period_row.starts_on AND period_row.ends_on
      AND(ae.exception_code ILIKE '%MAPPING%' OR si.status='MAPPING_EXCEPTION')
  )
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'exception_id',exception_id,'exception_version',version,'exception_code',exception_code,'status',status::text,
    'severity',severity,'owner',owner,
    'reason',left(COALESCE(NULLIF(btrim(details->>'reason'),''),NULLIF(btrim(details->>'message'),''),exception_code),2000),
    'created_at',created_at,'resolved_by',resolved_by,'resolved_at',resolved_at,'resolution',resolution,
    'source_document_id',source_document_id,'source_document_revision',source_document_revision,
    'source_system',source_system,'source_module',source_module,'source_record_id',source_record_id,'source_version',source_version,
    'document_type',document_type,'document_no',document_no,'accounting_date',to_char(accounting_date,'YYYY-MM-DD'),
    'currency',currency,'gross_amount',gross_amount::text,'payload_hash',payload_hash,
    'staging_item_id',staging_item_id,'staging_version',staging_version,'staging_status',staging_status::text,
    'mapping_snapshot_id',mapping_snapshot_id,'mapping_family',mapping_family,'mapping_version',mapping_version,
    'mapping_status',mapping_status,'mapping_snapshot_hash',mapping_snapshot_hash,
    'mapping_effective_from',mapping_effective_from,'mapping_effective_to',mapping_effective_to,
    'action_flags',jsonb_build_object('can_assign',false,'can_review',false,'can_resolve',false,'can_waive',false,'can_create_draft',false,'can_post',false)
  ) ORDER BY CASE status WHEN 'OPEN' THEN 0 WHEN 'IN_REVIEW' THEN 1 WHEN 'RESOLVED' THEN 2 ELSE 3 END,
    CASE severity WHEN 'CRITICAL' THEN 0 WHEN 'HIGH' THEN 1 WHEN 'MEDIUM' THEN 2 ELSE 3 END,created_at DESC,exception_id DESC),'[]'::jsonb),
  count(*)::integer,count(*)FILTER(WHERE status='OPEN')::integer,count(*)FILTER(WHERE status='IN_REVIEW')::integer,
  count(*)FILTER(WHERE status='RESOLVED')::integer,count(*)FILTER(WHERE status='WAIVED')::integer
  INTO register_rows,row_count,open_count,review_count,resolved_count,waived_count FROM scoped;

  RETURN jsonb_build_object(
    'schema_version','MAPPING_EXCEPTION_REGISTER_V1','entity_id',p_entity,'period_id',p_period,
    'period_code',period_row.period_code,'period_start',to_char(period_row.starts_on,'YYYY-MM-DD'),'period_end',to_char(period_row.ends_on,'YYYY-MM-DD'),
    'row_count',row_count,'open_count',open_count,'in_review_count',review_count,'resolved_count',resolved_count,'waived_count',waived_count,
    'rows',register_rows,'action_flags',jsonb_build_object('can_assign',false,'can_review',false,'can_resolve',false,'can_waive',false,'can_create_draft',false,'can_post',false)
  );
END;$$;
REVOKE ALL ON FUNCTION refs_read_mapping_exception_register(uuid,uuid,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION refs_read_mapping_exception_register(uuid,uuid,uuid) TO refs_app;

COMMIT;
