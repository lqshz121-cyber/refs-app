BEGIN;
DROP FUNCTION IF EXISTS refs_abandon_ai_accounting_analysis_explanation(uuid,uuid,text,text);
DROP FUNCTION IF EXISTS refs_complete_ai_accounting_analysis_explanation(uuid,uuid,text,text,jsonb);
DROP FUNCTION IF EXISTS refs_begin_ai_accounting_analysis_explanation(uuid,uuid,jsonb,text,text);
DROP FUNCTION IF EXISTS refs_assert_ai_accounting_analysis_summary(jsonb);
DROP FUNCTION IF EXISTS refs_ai_accounting_analysis_explanation_hash(uuid,uuid,jsonb);
COMMIT;
