BEGIN;
DROP FUNCTION IF EXISTS refs_begin_ai_accounting_analysis_explanation(uuid,uuid,jsonb,jsonb,text,text);
DROP FUNCTION IF EXISTS refs_assert_ai_accounting_analysis_evidence(jsonb);
DROP FUNCTION IF EXISTS refs_ai_accounting_analysis_evidence_hash(uuid,uuid,jsonb,jsonb);
COMMIT;
