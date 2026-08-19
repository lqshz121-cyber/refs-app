BEGIN;

REVOKE EXECUTE ON FUNCTION refs_list_reconciliation_adjustment_evidence(uuid,uuid,integer) FROM refs_app;
DROP FUNCTION refs_list_reconciliation_adjustment_evidence(uuid,uuid,integer);

DO $migration$
DECLARE
  definition text;
  new_guard constant text:='IF adjustment.bank_delta<>(SELECT source.amount FROM bank_source source
          WHERE source.tenant_id=adjustment.tenant_id AND source.entity_id=adjustment.entity_id
            AND source.bank_source_id=adjustment.bank_source_id) THEN
        RAISE EXCEPTION ''Reconciliation adjustment may post only for the exact selected statement row'' USING ERRCODE=''23514'';
      END IF;';
  old_guard constant text:='IF final_book_balance<>rec.statement_ending_balance THEN
        RAISE EXCEPTION ''Reconciliation adjustment may post only when it exactly resolves the statement difference'' USING ERRCODE=''23514'';
      END IF;';
  occurrences integer;
BEGIN
  SELECT pg_get_functiondef('public.refs_guard_reconciliation_adjustment_lifecycle()'::regprocedure) INTO definition;
  occurrences:=(length(definition)-length(replace(definition,new_guard,'')))/length(new_guard);
  IF occurrences<>1 THEN RAISE EXCEPTION 'Unexpected reconciliation adjustment item post guard' USING ERRCODE='22023'; END IF;
  EXECUTE replace(definition,new_guard,old_guard);
END;
$migration$;

REVOKE ALL ON FUNCTION refs_guard_reconciliation_adjustment_lifecycle() FROM PUBLIC,refs_app;

COMMIT;
