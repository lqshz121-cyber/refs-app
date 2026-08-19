BEGIN;

-- A bounded, period-scoped source read for the staging-only controlled AI
-- workflow.  The general Source Documents register remains unchanged.
CREATE INDEX source_document_wbs_test_payable_posted_period_idx
  ON source_document(tenant_id,entity_id,source_system,accounting_date DESC,created_at DESC,source_document_id DESC)
  WHERE source_module='payable'
    AND document_type='WBS_TEST_PAYABLE'
    AND status='POSTED';

CREATE INDEX source_link_source_document_posted_journal_lookup_idx
  ON source_link(tenant_id,entity_id,source_document_id,journal_entry_id)
  WHERE source_document_id IS NOT NULL
    AND journal_entry_id IS NOT NULL;

CREATE FUNCTION refs_list_controlled_test_ai_sources(
  p_tenant uuid,
  p_entity uuid,
  p_period uuid,
  p_limit integer
)
RETURNS TABLE(
  source_document_id uuid,
  source_document_revision bigint,
  raw_event_id uuid,
  source_system text,
  source_module text,
  source_record_id text,
  source_version text,
  document_type text,
  document_no text,
  business_date date,
  accounting_date date,
  currency char(3),
  gross_amount numeric(20,4),
  status text,
  payload_hash text,
  source_line_count bigint,
  posted_journal_entry_ids uuid[],
  created_at timestamptz,
  updated_at timestamptz
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE
  v_start date;
  v_end date;
  v_source_system text;
BEGIN
  PERFORM public.refs_assert_scope(p_tenant,p_entity,'GL.JE.VIEW');
  IF p_limit IS NULL OR p_limit<1 OR p_limit>100 THEN
    RAISE EXCEPTION 'Controlled test AI source limit must be between 1 and 100' USING ERRCODE='22023';
  END IF;

  SELECT p.starts_on,p.ends_on,e.source_system INTO v_start,v_end,v_source_system
    FROM public.accounting_period p
    JOIN public.entity e
      ON e.tenant_id=p.tenant_id
     AND e.entity_id=p.entity_id
     AND e.active
     AND e.source_system IN ('WBS','REFS_STAGE1')
   WHERE p.tenant_id=p_tenant
     AND p.entity_id=p_entity
     AND p.period_id=p_period
     AND p.status='OPEN';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Controlled test AI source period must be the exact OPEN entity period' USING ERRCODE='55000';
  END IF;

  RETURN QUERY
  SELECT d.source_document_id,d.version,d.raw_event_id,d.source_system,d.source_module,d.source_record_id,d.source_version,
    d.document_type,d.document_no,d.business_date,d.accounting_date,d.currency,d.gross_amount,d.status::text,d.payload_hash,
    (SELECT count(*)::bigint FROM public.source_document_line l
      WHERE l.tenant_id=p_tenant AND l.entity_id=p_entity AND l.source_document_id=d.source_document_id),
    ARRAY(SELECT DISTINCT link.journal_entry_id FROM public.source_link link
      JOIN public.journal_entry j ON j.tenant_id=link.tenant_id AND j.entity_id=link.entity_id AND j.journal_entry_id=link.journal_entry_id
      WHERE link.tenant_id=p_tenant AND link.entity_id=p_entity AND link.source_document_id=d.source_document_id
        AND link.journal_entry_id IS NOT NULL AND j.status='POSTED' ORDER BY link.journal_entry_id)::uuid[],
    d.created_at,d.updated_at
  FROM public.source_document d
  WHERE d.tenant_id=p_tenant
    AND d.entity_id=p_entity
    AND d.source_system=v_source_system
    AND d.source_module='payable'
    AND d.document_type='WBS_TEST_PAYABLE'
    AND d.status='POSTED'
    AND d.accounting_date BETWEEN v_start AND v_end
    AND EXISTS(
      SELECT 1
        FROM public.source_link eligible_link
        JOIN public.journal_entry eligible_journal
          ON eligible_journal.tenant_id=eligible_link.tenant_id
         AND eligible_journal.entity_id=eligible_link.entity_id
         AND eligible_journal.journal_entry_id=eligible_link.journal_entry_id
       WHERE eligible_link.tenant_id=p_tenant
         AND eligible_link.entity_id=p_entity
         AND eligible_link.source_document_id=d.source_document_id
         AND eligible_link.journal_entry_id IS NOT NULL
         AND eligible_journal.status='POSTED'
    )
  ORDER BY d.accounting_date DESC,d.created_at DESC,d.source_document_id DESC
  LIMIT p_limit;
END;
$$;

REVOKE ALL ON FUNCTION refs_list_controlled_test_ai_sources(uuid,uuid,uuid,integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION refs_list_controlled_test_ai_sources(uuid,uuid,uuid,integer) TO refs_app;

COMMIT;
