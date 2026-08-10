BEGIN;

CREATE FUNCTION refs_list_reconciliation_worksheet(
  p_tenant uuid,
  p_entity uuid,
  p_reconciliation uuid
)
RETURNS TABLE(
  reconciliation_id uuid,
  reconciliation_version bigint,
  bank_source_id uuid,
  bank_version bigint,
  bank_account_ref text,
  external_bank_line_id text,
  transaction_date date,
  currency char(3),
  amount numeric(20,4),
  bank_match_id uuid,
  bank_match_version bigint,
  match_status text,
  business_source_document_id uuid,
  journal_entry_id uuid,
  journal_line_id uuid,
  clearance_state text,
  reconciliation_item_id uuid,
  item_version bigint,
  cleared_by text,
  cleared_at timestamptz,
  uncleared_by text,
  uncleared_at timestamptz
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE reconciliation_row public.reconciliation%ROWTYPE;
DECLARE prior_ending_date date;
BEGIN
  PERFORM public.refs_assert_scope(p_tenant,p_entity,'BANK.VIEW');

  SELECT * INTO reconciliation_row
  FROM public.reconciliation r
  WHERE r.tenant_id=p_tenant AND r.entity_id=p_entity AND r.reconciliation_id=p_reconciliation
    AND r.status IN ('DRAFT','IN_REVIEW','REOPENED')
  FOR SHARE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Open reconciliation was not found in the requested scope' USING ERRCODE='P0002';
  END IF;

  SELECT max(previous.statement_ending_date) INTO prior_ending_date
  FROM public.reconciliation previous
  WHERE previous.tenant_id=p_tenant AND previous.entity_id=p_entity
    AND previous.bank_account_ref=reconciliation_row.bank_account_ref
    AND previous.status='RECONCILED'
    AND previous.statement_ending_date<reconciliation_row.statement_ending_date;

  RETURN QUERY
    SELECT reconciliation_row.reconciliation_id,reconciliation_row.version,
      b.bank_source_id,b.version,b.bank_account_ref,b.external_bank_line_id,b.transaction_date,b.currency,b.amount,
      active_match.bank_match_id,active_match.version,active_match.status::text,
      active_match.business_source_document_id,active_match.journal_entry_id,active_match.journal_line_id,
      COALESCE(item.state,'NOT_CLEARED'),item.reconciliation_item_id,item.version,
      item.cleared_by,item.cleared_at,item.uncleared_by,item.uncleared_at
    FROM public.bank_source b
    LEFT JOIN LATERAL (
      SELECT bm.*
      FROM public.bank_match bm
      WHERE bm.tenant_id=b.tenant_id AND bm.entity_id=b.entity_id
        AND bm.bank_source_id=b.bank_source_id AND bm.status='ACTIVE'
      FOR SHARE
    ) active_match ON true
    LEFT JOIN public.reconciliation_item item
      ON item.tenant_id=b.tenant_id AND item.entity_id=b.entity_id
        AND item.reconciliation_id=reconciliation_row.reconciliation_id AND item.bank_source_id=b.bank_source_id
    WHERE b.tenant_id=p_tenant AND b.entity_id=p_entity
      AND b.bank_account_ref=reconciliation_row.bank_account_ref
      AND b.transaction_date<=reconciliation_row.statement_ending_date
      AND (prior_ending_date IS NULL OR b.transaction_date>prior_ending_date)
    ORDER BY b.transaction_date,b.external_bank_line_id,b.bank_source_id;
END;
$$;

REVOKE ALL ON FUNCTION refs_list_reconciliation_worksheet(uuid,uuid,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION refs_list_reconciliation_worksheet(uuid,uuid,uuid) TO refs_app;

COMMIT;
