BEGIN;

ALTER TABLE wbs_controlled_test_bank_import DROP CONSTRAINT wbs_controlled_test_bank_import_row_count_check;
ALTER TABLE wbs_controlled_test_bank_import ADD CONSTRAINT wbs_controlled_test_bank_import_row_count_check CHECK(row_count BETWEEN 1 AND 10000);
ALTER TABLE wbs_controlled_test_bank_import_row DROP CONSTRAINT wbs_controlled_test_bank_import_row_row_index_check;
ALTER TABLE wbs_controlled_test_bank_import_row ADD CONSTRAINT wbs_controlled_test_bank_import_row_row_index_check CHECK(row_index BETWEEN 0 AND 9999);

DO $migration$
DECLARE
  definition text;
  old_guard constant text:='IF rows_count NOT BETWEEN 1 AND 500 OR (p_observation->>''record_count'')::integer<>rows_count THEN';
  new_guard constant text:='IF rows_count NOT BETWEEN 1 AND 10000 OR (p_observation->>''record_count'')::integer<>rows_count THEN';
  old_message constant text:='Controlled test Bank observation must contain one to five hundred rows';
  new_message constant text:='Controlled test Bank observation must contain one to ten thousand rows';
BEGIN
  SELECT pg_get_functiondef(
    'public.refs_create_wbs_controlled_test_bank_scope(uuid,uuid,uuid,text,jsonb,text,text,text)'::regprocedure
  ) INTO definition;
  IF strpos(definition,old_guard)=0 OR strpos(definition,old_message)=0 THEN
    RAISE EXCEPTION 'Unexpected controlled test Bank batch guard' USING ERRCODE='22023';
  END IF;
  EXECUTE replace(replace(definition,old_guard,new_guard),old_message,new_message);
END;
$migration$;

CREATE FUNCTION refs_get_reconciliation_worksheet_item(
  p_tenant uuid,p_entity uuid,p_reconciliation uuid,p_bank_source uuid
)
RETURNS TABLE(
  reconciliation_id uuid,reconciliation_version bigint,bank_source_id uuid,bank_version bigint,
  bank_account_ref text,external_bank_line_id text,transaction_date date,currency char(3),amount numeric(20,4),
  bank_match_id uuid,bank_match_version bigint,match_status text,business_source_document_id uuid,
  journal_entry_id uuid,journal_line_id uuid,clearance_state text,reconciliation_item_id uuid,item_version bigint,
  cleared_by text,cleared_at timestamptz,uncleared_by text,uncleared_at timestamptz,
  adjustment_journal_entry_id uuid,adjustment_journal_version bigint,adjustment_journal_status text,
  adjustment_clearance_eligible boolean
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE reconciliation_row public.reconciliation%ROWTYPE;
DECLARE prior_ending_date date;
BEGIN
  PERFORM public.refs_assert_scope(p_tenant,p_entity,'BANK.VIEW');
  IF p_bank_source IS NULL THEN RAISE EXCEPTION 'Bank source is required' USING ERRCODE='22023'; END IF;
  SELECT * INTO reconciliation_row FROM public.reconciliation r
  WHERE r.tenant_id=p_tenant AND r.entity_id=p_entity AND r.reconciliation_id=p_reconciliation
    AND r.status IN ('DRAFT','IN_REVIEW','REOPENED') FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Open reconciliation was not found in the requested scope' USING ERRCODE='P0002'; END IF;
  SELECT max(previous.statement_ending_date) INTO prior_ending_date FROM public.reconciliation previous
  WHERE previous.tenant_id=p_tenant AND previous.entity_id=p_entity
    AND previous.bank_account_ref=reconciliation_row.bank_account_ref AND previous.status='RECONCILED'
    AND previous.statement_ending_date<reconciliation_row.statement_ending_date;
  RETURN QUERY
    SELECT reconciliation_row.reconciliation_id,reconciliation_row.version,
      b.bank_source_id,b.version,b.bank_account_ref,b.external_bank_line_id,b.transaction_date,b.currency,b.amount,
      active_match.bank_match_id,active_match.version,active_match.status::text,
      active_match.business_source_document_id,active_match.journal_entry_id,active_match.journal_line_id,
      COALESCE(item.state,'NOT_CLEARED'),item.reconciliation_item_id,item.version,
      item.cleared_by,item.cleared_at,item.uncleared_by,item.uncleared_at,
      adjustment.journal_entry_id,adjustment.journal_revision,adjustment.status,adjustment.clearance_eligible
    FROM public.bank_source b
    LEFT JOIN LATERAL (
      SELECT bm.* FROM public.bank_match bm
      WHERE bm.tenant_id=b.tenant_id AND bm.entity_id=b.entity_id
        AND bm.bank_source_id=b.bank_source_id AND bm.status='ACTIVE' FOR SHARE
    ) active_match ON true
    LEFT JOIN public.reconciliation_item item
      ON item.tenant_id=b.tenant_id AND item.entity_id=b.entity_id
        AND item.reconciliation_id=reconciliation_row.reconciliation_id AND item.bank_source_id=b.bank_source_id
    LEFT JOIN LATERAL (
      SELECT draft.journal_entry_id,adjustment_je.revision AS journal_revision,adjustment_je.status::text,
        (adjustment_je.status='POSTED' AND adjustment_je.currency=b.currency AND draft.bank_delta=b.amount
          AND 1=(SELECT count(*) FROM public.journal_line adjustment_line WHERE adjustment_line.tenant_id=draft.tenant_id
            AND adjustment_line.entity_id=draft.entity_id AND adjustment_line.journal_entry_id=draft.journal_entry_id
            AND adjustment_line.member_ref=b.bank_account_ref)
          AND b.amount=(SELECT COALESCE(sum(adjustment_line.debit_amount-adjustment_line.credit_amount),0)
            FROM public.journal_line adjustment_line WHERE adjustment_line.tenant_id=draft.tenant_id
              AND adjustment_line.entity_id=draft.entity_id AND adjustment_line.journal_entry_id=draft.journal_entry_id
              AND adjustment_line.member_ref=b.bank_account_ref)
          AND EXISTS(SELECT 1 FROM public.journal_line adjustment_line JOIN public.ledger_line adjustment_ledger
            ON adjustment_ledger.tenant_id=adjustment_line.tenant_id AND adjustment_ledger.entity_id=adjustment_line.entity_id
              AND adjustment_ledger.journal_entry_id=adjustment_line.journal_entry_id AND adjustment_ledger.journal_line_id=adjustment_line.journal_line_id
            WHERE adjustment_line.tenant_id=draft.tenant_id AND adjustment_line.entity_id=draft.entity_id
              AND adjustment_line.journal_entry_id=draft.journal_entry_id AND adjustment_line.member_ref=b.bank_account_ref
              AND adjustment_ledger.debit_amount=adjustment_line.debit_amount AND adjustment_ledger.credit_amount=adjustment_line.credit_amount)
          AND EXISTS(SELECT 1 FROM public.source_link sl WHERE sl.tenant_id=draft.tenant_id AND sl.entity_id=draft.entity_id
            AND sl.link_type='RECONCILIATION_ADJUSTMENT_DRAFT' AND sl.reconciliation_id=draft.reconciliation_id
            AND sl.bank_source_id=draft.bank_source_id AND sl.journal_entry_id=draft.journal_entry_id)
          AND EXISTS(SELECT 1 FROM public.source_link attachment_link JOIN public.attachment attachment
            ON attachment.tenant_id=attachment_link.tenant_id AND attachment.attachment_id=attachment_link.attachment_id
            WHERE attachment_link.tenant_id=draft.tenant_id AND attachment_link.entity_id=draft.entity_id
              AND attachment_link.journal_entry_id=draft.journal_entry_id AND attachment_link.link_type='JE_ATTACHMENT'
              AND attachment.finalization_status='VERIFIED_CLEAN' AND attachment.scan_status='CLEAN'
              AND attachment.verified_at IS NOT NULL AND attachment.finalized_at IS NOT NULL)
        ) AS clearance_eligible
      FROM public.reconciliation_adjustment_draft draft
      JOIN public.journal_entry adjustment_je ON adjustment_je.tenant_id=draft.tenant_id AND adjustment_je.entity_id=draft.entity_id
        AND adjustment_je.journal_entry_id=draft.journal_entry_id
      WHERE active_match.bank_match_id IS NULL AND draft.tenant_id=b.tenant_id AND draft.entity_id=b.entity_id
        AND draft.reconciliation_id=reconciliation_row.reconciliation_id AND draft.bank_source_id=b.bank_source_id
      FOR SHARE OF draft,adjustment_je
    ) adjustment ON true
    WHERE b.tenant_id=p_tenant AND b.entity_id=p_entity AND b.bank_source_id=p_bank_source
      AND b.bank_account_ref=reconciliation_row.bank_account_ref
      AND (
        (reconciliation_row.wbs_bank_statement_receipt_id IS NULL
          AND b.transaction_date<=reconciliation_row.statement_ending_date
          AND (prior_ending_date IS NULL OR b.transaction_date>prior_ending_date))
        OR EXISTS(
          SELECT 1 FROM public.wbs_bank_statement_transaction t
          WHERE reconciliation_row.wbs_bank_statement_receipt_id IS NOT NULL
            AND t.tenant_id=b.tenant_id AND t.entity_id=b.entity_id
            AND t.wbs_bank_statement_receipt_id=reconciliation_row.wbs_bank_statement_receipt_id
            AND t.bank_source_id=b.bank_source_id
        )
      );
END;
$$;

COMMENT ON FUNCTION refs_get_reconciliation_worksheet_item(uuid,uuid,uuid,uuid) IS
  'Reads one entity-scoped reconciliation worksheet item for bounded TEST_ONLY workflow continuation; it grants no mutation authority.';
REVOKE ALL ON FUNCTION refs_get_reconciliation_worksheet_item(uuid,uuid,uuid,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION refs_get_reconciliation_worksheet_item(uuid,uuid,uuid,uuid) TO refs_app;

COMMIT;
