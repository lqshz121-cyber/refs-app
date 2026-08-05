BEGIN;

INSERT INTO permission_catalog(permission_code,domain,risk_class,sod_class)
VALUES ('BANK.VIEW','BANK','LOW','BANK_READER')
ON CONFLICT (permission_code) DO UPDATE
  SET active=true,domain=EXCLUDED.domain,risk_class=EXCLUDED.risk_class,sod_class=EXCLUDED.sod_class,
      version=permission_catalog.version+1,effective_to=NULL;

CREATE INDEX bank_source_read_scope_idx
  ON bank_source(tenant_id,entity_id,bank_account_ref,transaction_date DESC,external_bank_line_id DESC);
CREATE INDEX reconciliation_live_read_scope_idx
  ON reconciliation(tenant_id,entity_id,bank_account_ref,statement_ending_date DESC)
  WHERE status IN ('DRAFT','IN_REVIEW','REOPENED');
CREATE INDEX reconciliation_reconciled_cutoff_idx
  ON reconciliation(tenant_id,entity_id,bank_account_ref,statement_ending_date DESC)
  WHERE status='RECONCILED';

CREATE FUNCTION refs_list_bank_transactions(
  p_tenant uuid,
  p_entity uuid,
  p_bank_account_ref text,
  p_from date DEFAULT NULL,
  p_through date DEFAULT NULL,
  p_limit integer DEFAULT 100
)
RETURNS TABLE(
  bank_source_id uuid,
  bank_account_ref text,
  external_bank_line_id text,
  transaction_date date,
  currency char(3),
  amount numeric(20,4),
  version bigint,
  source_document_id uuid,
  source_ref text,
  document_type text,
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
  match_version bigint
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
BEGIN
  PERFORM public.refs_assert_scope(p_tenant,p_entity,'BANK.VIEW');
  IF p_bank_account_ref IS NULL OR p_bank_account_ref<>btrim(p_bank_account_ref) OR p_bank_account_ref='' OR length(p_bank_account_ref)>128 THEN
    RAISE EXCEPTION 'A valid bank account reference is required' USING ERRCODE='22023';
  END IF;
  IF p_from IS NOT NULL AND p_through IS NOT NULL AND p_from>p_through THEN
    RAISE EXCEPTION 'Bank transaction date range is invalid' USING ERRCODE='22023';
  END IF;
  IF p_limit IS NULL OR p_limit<1 OR p_limit>200 THEN
    RAISE EXCEPTION 'Bank transaction limit must be between 1 and 200' USING ERRCODE='22023';
  END IF;
  RETURN QUERY
    SELECT b.bank_source_id,b.bank_account_ref,b.external_bank_line_id,b.transaction_date,b.currency,b.amount,b.version,
      b.source_document_id,d.source_ref,d.document_type,
      m.bank_match_id,m.status::text,m.business_source_document_id,m.journal_entry_id,m.journal_line_id,
      m.candidate_rule_code,m.amount_delta,m.currency_match,m.date_delta_days,m.matched_by,m.matched_at,m.version
    FROM public.bank_source b
    JOIN public.source_document d
      ON d.tenant_id=b.tenant_id AND d.entity_id=b.entity_id AND d.source_document_id=b.source_document_id
    LEFT JOIN LATERAL (
      SELECT bm.*
      FROM public.bank_match bm
      WHERE bm.tenant_id=b.tenant_id AND bm.entity_id=b.entity_id AND bm.bank_source_id=b.bank_source_id
      ORDER BY (bm.status='ACTIVE') DESC,bm.matched_at DESC,bm.bank_match_id DESC
      LIMIT 1
    ) m ON true
    WHERE b.tenant_id=p_tenant AND b.entity_id=p_entity AND b.bank_account_ref=p_bank_account_ref
      AND (p_from IS NULL OR b.transaction_date>=p_from)
      AND (p_through IS NULL OR b.transaction_date<=p_through)
    ORDER BY b.transaction_date DESC,b.external_bank_line_id DESC,b.bank_source_id DESC
    LIMIT p_limit;
END;
$$;

CREATE FUNCTION refs_get_reconciliation_summary(
  p_tenant uuid,
  p_entity uuid,
  p_bank_account_ref text,
  p_statement_ending_date date
)
RETURNS TABLE(
  reconciliation_id uuid,
  bank_account_ref text,
  statement_ending_date date,
  statement_ending_balance numeric(20,4),
  difference numeric(20,4),
  status text,
  version bigint,
  reconciled_by text,
  reconciled_at timestamptz,
  reopened_by text,
  reopened_at timestamptz,
  bank_transaction_count bigint,
  active_match_count bigint,
  unmatched_transaction_count bigint,
  statement_activity_amount numeric(20,4)
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
BEGIN
  PERFORM public.refs_assert_scope(p_tenant,p_entity,'BANK.VIEW');
  IF p_bank_account_ref IS NULL OR p_bank_account_ref<>btrim(p_bank_account_ref) OR p_bank_account_ref='' OR length(p_bank_account_ref)>128 THEN
    RAISE EXCEPTION 'A valid bank account reference is required' USING ERRCODE='22023';
  END IF;
  IF p_statement_ending_date IS NULL THEN
    RAISE EXCEPTION 'A statement ending date is required' USING ERRCODE='22023';
  END IF;
  RETURN QUERY
    SELECT r.reconciliation_id,r.bank_account_ref,r.statement_ending_date,r.statement_ending_balance,r.difference,
      r.status::text,r.version,r.reconciled_by,r.reconciled_at,r.reopened_by,r.reopened_at,
      count(b.bank_source_id)::bigint,
      count(b.bank_source_id) FILTER (WHERE active_match.bank_match_id IS NOT NULL)::bigint,
      count(b.bank_source_id) FILTER (WHERE active_match.bank_match_id IS NULL)::bigint,
      COALESCE(sum(b.amount),0)::numeric(20,4)
    FROM public.reconciliation r
    LEFT JOIN LATERAL (
      SELECT max(previous.statement_ending_date) AS prior_ending_date
      FROM public.reconciliation previous
      WHERE previous.tenant_id=r.tenant_id AND previous.entity_id=r.entity_id
        AND previous.bank_account_ref=r.bank_account_ref
        AND previous.status='RECONCILED'
        AND previous.statement_ending_date<r.statement_ending_date
    ) prior ON true
    LEFT JOIN public.bank_source b
      ON b.tenant_id=r.tenant_id AND b.entity_id=r.entity_id AND b.bank_account_ref=r.bank_account_ref
      AND b.transaction_date<=r.statement_ending_date
      AND (prior.prior_ending_date IS NULL OR b.transaction_date>prior.prior_ending_date)
    LEFT JOIN public.bank_match active_match
      ON active_match.tenant_id=b.tenant_id AND active_match.entity_id=b.entity_id
      AND active_match.bank_source_id=b.bank_source_id AND active_match.status='ACTIVE'
    WHERE r.tenant_id=p_tenant AND r.entity_id=p_entity AND r.bank_account_ref=p_bank_account_ref
      AND r.statement_ending_date=p_statement_ending_date
      AND r.status IN ('DRAFT','IN_REVIEW','REOPENED')
    GROUP BY r.reconciliation_id;
END;
$$;

REVOKE ALL ON FUNCTION refs_list_bank_transactions(uuid,uuid,text,date,date,integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION refs_get_reconciliation_summary(uuid,uuid,text,date) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION refs_list_bank_transactions(uuid,uuid,text,date,date,integer) TO refs_app;
GRANT EXECUTE ON FUNCTION refs_get_reconciliation_summary(uuid,uuid,text,date) TO refs_app;

COMMIT;
