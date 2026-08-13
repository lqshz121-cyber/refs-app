BEGIN;

CREATE FUNCTION refs_get_bank_transaction_detail(
  p_tenant uuid,
  p_entity uuid,
  p_bank_source uuid
)
RETURNS TABLE(
  bank_source_id uuid,
  bank_account_ref text,
  external_bank_line_id text,
  transaction_date date,
  currency char(3),
  amount numeric(20,4),
  bank_source_version bigint,
  source_document_id uuid,
  source_system text,
  source_module text,
  source_entity_id text,
  source_record_id text,
  source_version text,
  source_ref text,
  document_type text,
  payload_hash text,
  source_document_revision bigint,
  source_created_at timestamptz,
  source_updated_at timestamptz,
  bank_match_id uuid,
  match_status text,
  business_source_document_id uuid,
  journal_entry_id uuid,
  journal_line_id uuid,
  candidate_rule_code text,
  amount_delta numeric(20,4),
  currency_match boolean,
  date_delta_days integer,
  matched_by text,
  matched_at timestamptz,
  unmatched_by text,
  unmatched_at timestamptz,
  match_version bigint
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
BEGIN
  PERFORM public.refs_assert_scope(p_tenant,p_entity,'BANK.VIEW');
  IF p_bank_source IS NULL THEN
    RAISE EXCEPTION 'A bank source identifier is required' USING ERRCODE='22023';
  END IF;
  RETURN QUERY
    SELECT b.bank_source_id,b.bank_account_ref,b.external_bank_line_id,b.transaction_date,b.currency,b.amount,b.version,
      d.source_document_id,d.source_system,d.source_module,d.source_entity_id,d.source_record_id,d.source_version,
      d.source_ref,d.document_type,d.payload_hash,d.version,d.created_at,d.updated_at,
      m.bank_match_id,m.status::text,m.business_source_document_id,m.journal_entry_id,m.journal_line_id,
      m.candidate_rule_code,m.amount_delta,m.currency_match,m.date_delta_days,m.matched_by,m.matched_at,
      m.unmatched_by,m.unmatched_at,m.version
    FROM public.bank_source b
    JOIN public.source_document d
      ON d.tenant_id=b.tenant_id AND d.entity_id=b.entity_id AND d.source_document_id=b.source_document_id
    LEFT JOIN public.bank_match m
      ON m.tenant_id=b.tenant_id AND m.entity_id=b.entity_id AND m.bank_source_id=b.bank_source_id
    WHERE b.tenant_id=p_tenant AND b.entity_id=p_entity AND b.bank_source_id=p_bank_source
    ORDER BY m.matched_at DESC NULLS LAST,m.bank_match_id DESC;
END;
$$;

REVOKE ALL ON FUNCTION refs_get_bank_transaction_detail(uuid,uuid,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION refs_get_bank_transaction_detail(uuid,uuid,uuid) TO refs_app;

COMMIT;
