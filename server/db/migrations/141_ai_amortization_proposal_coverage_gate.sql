BEGIN;

-- A proposal may allocate a prepaid source only after the exact source
-- version has retained coverage evidence.  Dates supplied to the proposal
-- command are therefore a selector for immutable evidence, never an
-- unsupported model or browser assertion.
DO $$
DECLARE definition text; gate text:=E'  IF NOT EXISTS(SELECT 1 FROM ai_amortization_coverage_evidence coverage WHERE coverage.tenant_id=p_tenant AND coverage.entity_id=p_entity AND coverage.source_document_id=p_source AND coverage.source_document_version=source.version AND coverage.source_payload_hash=source.payload_hash AND coverage.coverage_start=p_coverage_start AND coverage.coverage_end=p_coverage_end) THEN\n    RAISE EXCEPTION ''AI amortization proposal requires exact retained whole-month coverage evidence for the current source version'' USING ERRCODE=''23514'';\n  END IF;\n'; needle text:='  IF p_prepaid_account=p_expense_account THEN RAISE EXCEPTION ''AI amortization prepaid and expense accounts must differ'' USING ERRCODE=''22023''; END IF;';
BEGIN
  SELECT pg_get_functiondef('refs_propose_ai_amortization_schedule(uuid,uuid,uuid,text,date,date,text,text,jsonb,numeric,text,text,text)'::regprocedure) INTO definition;
  IF definition IS NULL OR position(needle IN definition)=0 OR position('ai_amortization_coverage_evidence' IN definition)>0 THEN
    RAISE EXCEPTION 'AI amortization proposal function is not the expected pre-coverage-gate definition';
  END IF;
  definition:=replace(definition,needle,gate||needle);
  EXECUTE definition;
END;
$$;

COMMIT;
