BEGIN;

-- Reverting the gate is permitted only before any retained proposal exists.
-- Once proposals exist, removing the proof requirement would weaken the
-- meaning of immutable accounting analysis already retained in the ledger.
DO $$
DECLARE definition text; gate text:=E'  IF NOT EXISTS(SELECT 1 FROM ai_amortization_coverage_evidence coverage WHERE coverage.tenant_id=p_tenant AND coverage.entity_id=p_entity AND coverage.source_document_id=p_source AND coverage.source_document_version=source.version AND coverage.source_payload_hash=source.payload_hash AND coverage.coverage_start=p_coverage_start AND coverage.coverage_end=p_coverage_end) THEN\n    RAISE EXCEPTION ''AI amortization proposal requires exact retained whole-month coverage evidence for the current source version'' USING ERRCODE=''23514'';\n  END IF;\n';
BEGIN
  IF EXISTS(SELECT 1 FROM ai_amortization_schedule) THEN RAISE EXCEPTION 'Cannot remove AI amortization coverage gate after proposals are retained' USING ERRCODE='55000'; END IF;
  SELECT pg_get_functiondef('refs_propose_ai_amortization_schedule(uuid,uuid,uuid,text,date,date,text,text,jsonb,numeric,text,text,text)'::regprocedure) INTO definition;
  IF definition IS NULL OR position(gate IN definition)=0 THEN RAISE EXCEPTION 'AI amortization proposal function is not the expected coverage-gated definition'; END IF;
  definition:=replace(definition,gate,'');
  EXECUTE definition;
END;
$$;

COMMIT;
