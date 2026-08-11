BEGIN;

-- Authoritative source-document evidence reads. These functions intentionally
-- expose only persisted REFS evidence metadata and immutable identifiers.
-- They never return raw payloads, provider credentials, or attachment bytes.

CREATE FUNCTION refs_list_source_documents(p_tenant uuid,p_entity uuid)
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
BEGIN
  PERFORM public.refs_assert_scope(p_tenant,p_entity,'GL.JE.VIEW');
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
  WHERE d.tenant_id=p_tenant AND d.entity_id=p_entity
  ORDER BY d.accounting_date DESC,d.created_at DESC,d.source_document_id DESC;
END;
$$;

CREATE FUNCTION refs_get_source_document_detail(p_tenant uuid,p_entity uuid,p_source_document uuid)
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
  lines jsonb,
  created_at timestamptz,
  updated_at timestamptz
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
BEGIN
  PERFORM public.refs_assert_scope(p_tenant,p_entity,'GL.JE.VIEW');
  IF NOT EXISTS(SELECT 1 FROM public.source_document d WHERE d.tenant_id=p_tenant AND d.entity_id=p_entity AND d.source_document_id=p_source_document) THEN
    RAISE EXCEPTION 'Source document is absent or outside the entity' USING ERRCODE='P0002';
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
    COALESCE((SELECT jsonb_agg(jsonb_build_object(
      'source_document_line_id',l.source_document_line_id,'source_line_id',l.source_line_id,'line_no',l.line_no,
      'amount',l.amount,'direction',l.direction,'party_ref',l.party_ref,'bank_account_ref',l.bank_account_ref,
      'project_ref',l.project_ref,'property_ref',l.property_ref,'phase_ref',l.phase_ref,'unit_ref',l.unit_ref,
      'loan_ref',l.loan_ref,'cost_code_ref',l.cost_code_ref
    ) ORDER BY l.line_no,l.source_document_line_id)
      FROM public.source_document_line l
      WHERE l.tenant_id=p_tenant AND l.entity_id=p_entity AND l.source_document_id=d.source_document_id),'[]'::jsonb),
    d.created_at,d.updated_at
  FROM public.source_document d
  WHERE d.tenant_id=p_tenant AND d.entity_id=p_entity AND d.source_document_id=p_source_document;
END;
$$;

REVOKE ALL ON FUNCTION refs_list_source_documents(uuid,uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION refs_get_source_document_detail(uuid,uuid,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION refs_list_source_documents(uuid,uuid) TO refs_app;
GRANT EXECUTE ON FUNCTION refs_get_source_document_detail(uuid,uuid,uuid) TO refs_app;

COMMIT;
