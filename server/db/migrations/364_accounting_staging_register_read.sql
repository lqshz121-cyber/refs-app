BEGIN;

CREATE FUNCTION refs_read_accounting_staging_register(p_tenant uuid,p_entity uuid,p_period uuid)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE period_row accounting_period;register_rows jsonb;row_count integer;exception_count integer;ready_count integer;progressed_count integer;
BEGIN
  PERFORM refs_assert_scope(p_tenant,p_entity,'GL.JE.VIEW');
  SELECT * INTO period_row FROM accounting_period
   WHERE tenant_id=p_tenant AND entity_id=p_entity AND period_id=p_period AND ledger_code='PRIMARY';
  IF NOT FOUND THEN RAISE EXCEPTION 'Accounting Staging requires one primary company period' USING ERRCODE='22023'; END IF;

  WITH scoped AS MATERIALIZED (
    SELECT si.*,d.version source_document_revision,d.source_system,d.source_module,d.source_record_id,d.source_version,
      d.document_type,d.document_no,d.accounting_date,d.currency,d.gross_amount,d.payload_hash
    FROM staging_item si
    JOIN source_document d ON d.tenant_id=si.tenant_id AND d.entity_id=si.entity_id AND d.source_document_id=si.source_document_id
    WHERE si.tenant_id=p_tenant AND si.entity_id=p_entity
      AND d.accounting_date BETWEEN period_row.starts_on AND period_row.ends_on
  ), projected AS MATERIALIZED (
    SELECT s.*,
      COALESCE((SELECT jsonb_agg(jsonb_build_object(
        'exception_id',ae.exception_id,'exception_code',ae.exception_code,'status',ae.status::text,
        'severity',ae.severity,'owner',ae.owner,'version',ae.version,'created_at',ae.created_at
      ) ORDER BY ae.created_at,ae.exception_id)
      FROM accounting_exception ae
      WHERE ae.tenant_id=s.tenant_id AND ae.entity_id=s.entity_id
        AND(ae.staging_item_id=s.staging_item_id OR(ae.staging_item_id IS NULL AND ae.source_document_id=s.source_document_id))),'[]'::jsonb) exceptions,
      COALESCE((SELECT jsonb_agg(jsonb_build_object(
        'journal_entry_id',j.journal_entry_id,'journal_number',j.journal_number,'status',j.status::text,'revision',j.revision
      ) ORDER BY j.created_at,j.journal_entry_id)
      FROM(SELECT DISTINCT j.journal_entry_id,j.journal_number,j.status,j.revision,j.created_at
        FROM source_link sl JOIN journal_entry j
          ON j.tenant_id=sl.tenant_id AND j.entity_id=sl.entity_id AND j.journal_entry_id=sl.journal_entry_id
        WHERE sl.tenant_id=s.tenant_id AND sl.entity_id=s.entity_id AND sl.journal_entry_id IS NOT NULL
          AND(sl.staging_item_id=s.staging_item_id OR sl.source_document_id=s.source_document_id))j),'[]'::jsonb) journal_evidence
    FROM scoped s
  )
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'staging_item_id',staging_item_id,'staging_version',version,'status',status::text,'assigned_to',assigned_to,
    'reviewed_by',reviewed_by,'reviewed_at',reviewed_at,'created_at',created_at,'updated_at',updated_at,
    'source_document_id',source_document_id,'source_document_revision',source_document_revision,
    'source_system',source_system,'source_module',source_module,'source_record_id',source_record_id,'source_version',source_version,
    'document_type',document_type,'document_no',document_no,'accounting_date',to_char(accounting_date,'YYYY-MM-DD'),
    'currency',currency,'gross_amount',gross_amount::text,'payload_hash',payload_hash,
    'setting_snapshot_id',setting_snapshot_id,'mapping_snapshot_id',mapping_snapshot_id,
    'rule_evaluation_id',rule_evaluation_id,'ai_decision_id',ai_decision_id,
    'exceptions',exceptions,'journal_evidence',journal_evidence,
    'action_flags',jsonb_build_object('can_assign',false,'can_review',false,'can_create_draft',false,'can_post',false)
  ) ORDER BY accounting_date DESC,created_at DESC,staging_item_id DESC),'[]'::jsonb),
  count(*)::integer,
  COALESCE(sum(jsonb_array_length(exceptions)),0)::integer,
  count(*)FILTER(WHERE status='READY_FOR_DRAFT')::integer,
  count(*)FILTER(WHERE status IN('DRAFT_CREATED','PENDING_JE_REVIEW','PENDING_JE_APPROVAL','APPROVED','POSTED','RECONCILED'))::integer
  INTO register_rows,row_count,exception_count,ready_count,progressed_count FROM projected;

  RETURN jsonb_build_object(
    'schema_version','ACCOUNTING_STAGING_REGISTER_V1','entity_id',p_entity,'period_id',p_period,
    'period_code',period_row.period_code,'period_start',to_char(period_row.starts_on,'YYYY-MM-DD'),'period_end',to_char(period_row.ends_on,'YYYY-MM-DD'),
    'row_count',row_count,'exception_count',exception_count,'ready_for_draft_count',ready_count,'draft_or_later_count',progressed_count,
    'rows',register_rows,'action_flags',jsonb_build_object('can_import',false,'can_assign',false,'can_review',false,'can_create_draft',false,'can_post',false)
  );
END;$$;
REVOKE ALL ON FUNCTION refs_read_accounting_staging_register(uuid,uuid,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION refs_read_accounting_staging_register(uuid,uuid,uuid) TO refs_app;

COMMIT;
