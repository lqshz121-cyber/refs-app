BEGIN;

CREATE FUNCTION refs_list_bank_transactions(
  p_tenant uuid,
  p_entity uuid,
  p_bank_account_ref text,
  p_from date,
  p_through date,
  p_limit integer,
  p_offset integer
)
RETURNS TABLE(
  bank_source_id uuid, bank_account_ref text, external_bank_line_id text, transaction_date date,
  currency char(3), amount numeric(20,4), version bigint, source_document_id uuid, source_ref text,
  document_type text, bank_match_id uuid, match_status text, business_source_document_id uuid,
  journal_entry_id uuid, journal_line_id uuid, candidate_rule_code text, amount_delta numeric(20,4),
  currency_match boolean, date_delta_days integer, matched_by text, matched_at timestamptz, match_version bigint
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
BEGIN
  PERFORM public.refs_assert_scope(p_tenant,p_entity,'BANK.VIEW');
  IF p_bank_account_ref IS NULL OR p_bank_account_ref<>btrim(p_bank_account_ref) OR p_bank_account_ref='' OR length(p_bank_account_ref)>128 THEN RAISE EXCEPTION 'A valid bank account reference is required' USING ERRCODE='22023'; END IF;
  IF p_from IS NOT NULL AND p_through IS NOT NULL AND p_from>p_through THEN RAISE EXCEPTION 'Bank transaction date range is invalid' USING ERRCODE='22023'; END IF;
  IF p_limit IS NULL OR p_limit<1 OR p_limit>200 THEN RAISE EXCEPTION 'Bank transaction limit must be between 1 and 200' USING ERRCODE='22023'; END IF;
  IF p_offset IS NULL OR p_offset<0 OR p_offset>10000 THEN RAISE EXCEPTION 'Bank transaction offset must be between 0 and 10000' USING ERRCODE='22023'; END IF;
  RETURN QUERY
    SELECT b.bank_source_id,b.bank_account_ref,b.external_bank_line_id,b.transaction_date,b.currency,b.amount,b.version,b.source_document_id,d.source_ref,d.document_type,m.bank_match_id,m.status::text,m.business_source_document_id,m.journal_entry_id,m.journal_line_id,m.candidate_rule_code,m.amount_delta,m.currency_match,m.date_delta_days,m.matched_by,m.matched_at,m.version
    FROM public.bank_source b JOIN public.source_document d ON d.tenant_id=b.tenant_id AND d.entity_id=b.entity_id AND d.source_document_id=b.source_document_id
    LEFT JOIN LATERAL (SELECT bm.* FROM public.bank_match bm WHERE bm.tenant_id=b.tenant_id AND bm.entity_id=b.entity_id AND bm.bank_source_id=b.bank_source_id ORDER BY (bm.status='ACTIVE') DESC,bm.matched_at DESC,bm.bank_match_id DESC LIMIT 1) m ON true
    WHERE b.tenant_id=p_tenant AND b.entity_id=p_entity AND b.bank_account_ref=p_bank_account_ref AND (p_from IS NULL OR b.transaction_date>=p_from) AND (p_through IS NULL OR b.transaction_date<=p_through)
    ORDER BY b.transaction_date DESC,b.external_bank_line_id DESC,b.bank_source_id DESC LIMIT p_limit OFFSET p_offset;
END;
$$;

REVOKE ALL ON FUNCTION refs_list_bank_transactions(uuid,uuid,text,date,date,integer,integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION refs_list_bank_transactions(uuid,uuid,text,date,date,integer,integer) TO refs_app;

COMMIT;
