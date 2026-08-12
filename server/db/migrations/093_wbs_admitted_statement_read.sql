BEGIN;

CREATE FUNCTION refs_list_admitted_wbs_bank_statement_receipts(
  p_tenant uuid,
  p_entity uuid,
  p_bank_account_ref text,
  p_limit integer DEFAULT 50
)
RETURNS TABLE(
  wbs_bank_statement_receipt_id uuid,
  bank_account_ref text,
  statement_start_date text,
  statement_end_date text,
  currency char(3),
  opening_balance numeric(20,4),
  ending_balance numeric(20,4),
  transaction_count bigint,
  statement_activity_amount numeric(20,4),
  admission_hash text,
  signature_verified boolean,
  admission_status text,
  admitted_at timestamptz,
  reconciliation_id uuid,
  reconciliation_status text,
  reconciliation_version bigint,
  selection_state text
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
BEGIN
  PERFORM public.refs_assert_scope(p_tenant,p_entity,'BANK.VIEW');
  PERFORM public.refs_assert_scope(p_tenant,p_entity,'BANK.RECONCILIATION.START');
  IF p_bank_account_ref IS NULL OR p_bank_account_ref<>btrim(p_bank_account_ref)
     OR p_bank_account_ref='' OR length(p_bank_account_ref)>128 THEN
    RAISE EXCEPTION 'A valid bank account reference is required' USING ERRCODE='22023';
  END IF;
  IF p_limit IS NULL OR p_limit<1 OR p_limit>50 THEN
    RAISE EXCEPTION 'Admitted statement limit must be between 1 and 50' USING ERRCODE='22023';
  END IF;

  RETURN QUERY
    SELECT s.wbs_bank_statement_receipt_id,s.bank_account_ref,
      pg_catalog.to_char(s.statement_start_date,'YYYY-MM-DD'),pg_catalog.to_char(s.statement_end_date,'YYYY-MM-DD'),
      s.currency,s.opening_balance,s.ending_balance,evidence.transaction_count,evidence.statement_activity_amount,
      s.admission_hash,s.signature_verified,s.admission_status,s.created_at,
      linked.reconciliation_id,linked.status,linked.version,
      CASE
        WHEN linked.reconciliation_id IS NOT NULL THEN 'ALREADY_STARTED'
        WHEN EXISTS(
          SELECT 1 FROM public.reconciliation open_reconciliation
          WHERE open_reconciliation.tenant_id=s.tenant_id
            AND open_reconciliation.entity_id=s.entity_id
            AND open_reconciliation.bank_account_ref=s.bank_account_ref
            AND open_reconciliation.status IN ('DRAFT','IN_REVIEW','REOPENED')
        ) THEN 'BLOCKED_OPEN_RECONCILIATION'
        ELSE 'AVAILABLE_FOR_SERVER_VALIDATION'
      END
    FROM public.wbs_bank_statement_receipt s
    JOIN LATERAL (
      SELECT count(*)::bigint AS transaction_count,
        COALESCE(sum(b.amount),0)::numeric(20,4) AS statement_activity_amount,
        count(*) FILTER (
          WHERE b.bank_account_ref=s.bank_account_ref
            AND b.currency=s.currency
            AND b.transaction_date BETWEEN s.statement_start_date AND s.statement_end_date
        )::bigint AS exact_transaction_count
      FROM public.wbs_bank_statement_transaction t
      JOIN public.bank_source b
        ON b.tenant_id=t.tenant_id AND b.entity_id=t.entity_id AND b.bank_source_id=t.bank_source_id
      WHERE t.tenant_id=s.tenant_id AND t.entity_id=s.entity_id
        AND t.wbs_bank_statement_receipt_id=s.wbs_bank_statement_receipt_id
    ) evidence ON evidence.transaction_count>0
      AND evidence.exact_transaction_count=evidence.transaction_count
      AND s.opening_balance+evidence.statement_activity_amount=s.ending_balance
    LEFT JOIN LATERAL (
      SELECT r.reconciliation_id,r.status::text,r.version
      FROM public.reconciliation r
      WHERE r.tenant_id=s.tenant_id AND r.entity_id=s.entity_id
        AND r.wbs_bank_statement_receipt_id=s.wbs_bank_statement_receipt_id
      LIMIT 1
    ) linked ON true
    WHERE s.tenant_id=p_tenant AND s.entity_id=p_entity
      AND s.bank_account_ref=p_bank_account_ref
      AND s.signature_verified AND s.admission_status='ADMITTED'
    ORDER BY s.statement_end_date DESC,s.created_at DESC,s.wbs_bank_statement_receipt_id DESC
    LIMIT p_limit;
END;
$$;

CREATE FUNCTION refs_get_admitted_wbs_bank_statement_receipt(
  p_tenant uuid,
  p_entity uuid,
  p_statement_receipt uuid
)
RETURNS TABLE(
  wbs_bank_statement_receipt_id uuid,
  bank_account_ref text,
  statement_start_date text,
  statement_end_date text,
  currency char(3),
  opening_balance numeric(20,4),
  ending_balance numeric(20,4),
  transaction_count bigint,
  statement_activity_amount numeric(20,4),
  admission_hash text,
  signature_verified boolean,
  admission_status text,
  admitted_at timestamptz,
  reconciliation_id uuid,
  reconciliation_status text,
  reconciliation_version bigint,
  selection_state text
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
BEGIN
  PERFORM public.refs_assert_scope(p_tenant,p_entity,'BANK.VIEW');
  PERFORM public.refs_assert_scope(p_tenant,p_entity,'BANK.RECONCILIATION.START');
  IF p_statement_receipt IS NULL THEN
    RAISE EXCEPTION 'An admitted statement receipt identifier is required' USING ERRCODE='22023';
  END IF;
  RETURN QUERY
    SELECT s.wbs_bank_statement_receipt_id,s.bank_account_ref,
      pg_catalog.to_char(s.statement_start_date,'YYYY-MM-DD'),pg_catalog.to_char(s.statement_end_date,'YYYY-MM-DD'),
      s.currency,s.opening_balance,s.ending_balance,evidence.transaction_count,evidence.statement_activity_amount,
      s.admission_hash,s.signature_verified,s.admission_status,s.created_at,
      linked.reconciliation_id,linked.status,linked.version,
      CASE
        WHEN linked.reconciliation_id IS NOT NULL THEN 'ALREADY_STARTED'
        WHEN EXISTS(
          SELECT 1 FROM public.reconciliation open_reconciliation
          WHERE open_reconciliation.tenant_id=s.tenant_id
            AND open_reconciliation.entity_id=s.entity_id
            AND open_reconciliation.bank_account_ref=s.bank_account_ref
            AND open_reconciliation.status IN ('DRAFT','IN_REVIEW','REOPENED')
        ) THEN 'BLOCKED_OPEN_RECONCILIATION'
        ELSE 'AVAILABLE_FOR_SERVER_VALIDATION'
      END
    FROM public.wbs_bank_statement_receipt s
    JOIN LATERAL (
      SELECT count(*)::bigint AS transaction_count,
        COALESCE(sum(b.amount),0)::numeric(20,4) AS statement_activity_amount,
        count(*) FILTER (
          WHERE b.bank_account_ref=s.bank_account_ref
            AND b.currency=s.currency
            AND b.transaction_date BETWEEN s.statement_start_date AND s.statement_end_date
        )::bigint AS exact_transaction_count
      FROM public.wbs_bank_statement_transaction t
      JOIN public.bank_source b
        ON b.tenant_id=t.tenant_id AND b.entity_id=t.entity_id AND b.bank_source_id=t.bank_source_id
      WHERE t.tenant_id=s.tenant_id AND t.entity_id=s.entity_id
        AND t.wbs_bank_statement_receipt_id=s.wbs_bank_statement_receipt_id
    ) evidence ON evidence.transaction_count>0
      AND evidence.exact_transaction_count=evidence.transaction_count
      AND s.opening_balance+evidence.statement_activity_amount=s.ending_balance
    LEFT JOIN LATERAL (
      SELECT r.reconciliation_id,r.status::text,r.version
      FROM public.reconciliation r
      WHERE r.tenant_id=s.tenant_id AND r.entity_id=s.entity_id
        AND r.wbs_bank_statement_receipt_id=s.wbs_bank_statement_receipt_id
      LIMIT 1
    ) linked ON true
    WHERE s.tenant_id=p_tenant AND s.entity_id=p_entity
      AND s.wbs_bank_statement_receipt_id=p_statement_receipt
      AND s.signature_verified AND s.admission_status='ADMITTED';
END;
$$;

CREATE OR REPLACE FUNCTION refs_get_reconciliation_summary(
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
      AND (
        (r.wbs_bank_statement_receipt_id IS NULL
          AND b.transaction_date<=r.statement_ending_date
          AND (prior.prior_ending_date IS NULL OR b.transaction_date>prior.prior_ending_date))
        OR EXISTS(
          SELECT 1 FROM public.wbs_bank_statement_transaction t
          WHERE r.wbs_bank_statement_receipt_id IS NOT NULL
            AND t.tenant_id=b.tenant_id AND t.entity_id=b.entity_id
            AND t.wbs_bank_statement_receipt_id=r.wbs_bank_statement_receipt_id
            AND t.bank_source_id=b.bank_source_id
        )
      )
    LEFT JOIN public.bank_match active_match
      ON active_match.tenant_id=b.tenant_id AND active_match.entity_id=b.entity_id
      AND active_match.bank_source_id=b.bank_source_id AND active_match.status='ACTIVE'
    WHERE r.tenant_id=p_tenant AND r.entity_id=p_entity AND r.bank_account_ref=p_bank_account_ref
      AND r.statement_ending_date=p_statement_ending_date
      AND r.status IN ('DRAFT','IN_REVIEW','REOPENED')
    GROUP BY r.reconciliation_id;
END;
$$;

REVOKE ALL ON FUNCTION refs_list_admitted_wbs_bank_statement_receipts(uuid,uuid,text,integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION refs_get_admitted_wbs_bank_statement_receipt(uuid,uuid,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION refs_list_admitted_wbs_bank_statement_receipts(uuid,uuid,text,integer) TO refs_app;
GRANT EXECUTE ON FUNCTION refs_get_admitted_wbs_bank_statement_receipt(uuid,uuid,uuid) TO refs_app;

COMMIT;
