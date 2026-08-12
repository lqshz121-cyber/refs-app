BEGIN;

REVOKE EXECUTE ON FUNCTION refs_list_admitted_wbs_bank_statement_receipts(uuid,uuid,text,integer) FROM refs_app;
REVOKE EXECUTE ON FUNCTION refs_get_admitted_wbs_bank_statement_receipt(uuid,uuid,uuid) FROM refs_app;
DROP FUNCTION refs_list_admitted_wbs_bank_statement_receipts(uuid,uuid,text,integer);
DROP FUNCTION refs_get_admitted_wbs_bank_statement_receipt(uuid,uuid,uuid);

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

COMMIT;
