BEGIN;

-- Exposes only the relationship written by the adjustment Draft command once
-- the exact Journal Entry has posted. It is not a worksheet, cannot enumerate
-- bank data, and cannot reconstruct or mutate a reconciliation.
CREATE FUNCTION refs_get_reconciliation_posted_lineage(
  p_tenant uuid,p_entity uuid,p_reconciliation uuid,p_bank_source uuid,p_journal uuid
)
RETURNS TABLE(
  reconciliation_id uuid,bank_source_id uuid,journal_entry_id uuid,
  source_document_id uuid,link_type text
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
BEGIN
  PERFORM public.refs_assert_scope(p_tenant,p_entity,'BANK.VIEW');
  PERFORM public.refs_assert_scope(p_tenant,p_entity,'GL.JE.VIEW');
  IF p_reconciliation IS NULL OR p_bank_source IS NULL OR p_journal IS NULL THEN
    RAISE EXCEPTION 'Reconciliation, bank source and journal identifiers are required' USING ERRCODE='22023';
  END IF;
  RETURN QUERY
    SELECT sl.reconciliation_id,sl.bank_source_id,sl.journal_entry_id,sl.source_document_id,sl.link_type
    FROM public.source_link sl
    JOIN public.reconciliation r
      ON r.tenant_id=sl.tenant_id AND r.entity_id=sl.entity_id AND r.reconciliation_id=sl.reconciliation_id
    JOIN public.journal_entry j
      ON j.tenant_id=sl.tenant_id AND j.entity_id=sl.entity_id AND j.journal_entry_id=sl.journal_entry_id
    WHERE sl.tenant_id=p_tenant AND sl.entity_id=p_entity
      AND sl.reconciliation_id=p_reconciliation AND sl.bank_source_id=p_bank_source AND sl.journal_entry_id=p_journal
      AND sl.link_type='RECONCILIATION_ADJUSTMENT_DRAFT' AND j.status='POSTED'
      AND r.status='RECONCILED';
END;
$$;

REVOKE ALL ON FUNCTION refs_get_reconciliation_posted_lineage(uuid,uuid,uuid,uuid,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION refs_get_reconciliation_posted_lineage(uuid,uuid,uuid,uuid,uuid) TO refs_app;

COMMIT;
