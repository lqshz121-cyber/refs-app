BEGIN;

-- Posting one row in a multi-row reconciliation cannot tie the aggregate
-- statement until the final row.  Keep the post guard exact to the selected
-- immutable bank row; the existing review/sign-off transition still requires
-- the complete book-to-bank and statement-activity tie.
DO $migration$
DECLARE
  definition text;
  old_guard constant text:='IF final_book_balance<>rec.statement_ending_balance THEN
        RAISE EXCEPTION ''Reconciliation adjustment may post only when it exactly resolves the statement difference'' USING ERRCODE=''23514'';
      END IF;';
  new_guard constant text:='IF adjustment.bank_delta<>(SELECT source.amount FROM bank_source source
          WHERE source.tenant_id=adjustment.tenant_id AND source.entity_id=adjustment.entity_id
            AND source.bank_source_id=adjustment.bank_source_id) THEN
        RAISE EXCEPTION ''Reconciliation adjustment may post only for the exact selected statement row'' USING ERRCODE=''23514'';
      END IF;';
  occurrences integer;
BEGIN
  SELECT pg_get_functiondef('public.refs_guard_reconciliation_adjustment_lifecycle()'::regprocedure) INTO definition;
  occurrences:=(length(definition)-length(replace(definition,old_guard,'')))/length(old_guard);
  IF occurrences<>1 THEN RAISE EXCEPTION 'Unexpected reconciliation adjustment post guard' USING ERRCODE='22023'; END IF;
  EXECUTE replace(definition,old_guard,new_guard);
END;
$migration$;

REVOKE ALL ON FUNCTION refs_guard_reconciliation_adjustment_lifecycle() FROM PUBLIC,refs_app;

CREATE FUNCTION refs_list_reconciliation_adjustment_evidence(
  p_tenant uuid,
  p_entity uuid,
  p_limit integer DEFAULT 1
) RETURNS TABLE(attachment_id uuid)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
BEGIN
  PERFORM public.refs_assert_scope(p_tenant,p_entity,'BANK.RECONCILIATION.ADJUSTMENT_DRAFT');
  IF p_limit IS NULL OR p_limit<1 OR p_limit>10 THEN
    RAISE EXCEPTION 'Adjustment evidence limit must be between 1 and 10' USING ERRCODE='22023';
  END IF;
  RETURN QUERY
    SELECT a.attachment_id FROM public.attachment a
    WHERE a.tenant_id=p_tenant AND a.entity_id=p_entity
      AND a.finalization_status='VERIFIED_CLEAN' AND a.scan_status='CLEAN'
      AND a.verified_at IS NOT NULL AND a.finalized_at IS NOT NULL
    ORDER BY a.finalized_at DESC,a.attachment_id
    LIMIT p_limit;
END;
$$;

COMMENT ON FUNCTION refs_list_reconciliation_adjustment_evidence(uuid,uuid,integer) IS
  'Returns only entity-scoped verified-clean attachment IDs for a controlled reconciliation adjustment Draft; no content, storage reference, or cross-entity evidence is exposed.';

REVOKE ALL ON FUNCTION refs_list_reconciliation_adjustment_evidence(uuid,uuid,integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION refs_list_reconciliation_adjustment_evidence(uuid,uuid,integer) TO refs_app;

COMMIT;
