BEGIN;
DO $$BEGIN IF EXISTS(SELECT 1 FROM ai_manual_journal_risk_finding) THEN RAISE EXCEPTION 'Cannot roll back retained AI manual Journal risk evidence';END IF;END$$;
DROP FUNCTION IF EXISTS refs_materialize_ai_manual_journal_risk_batch(uuid,uuid,uuid,jsonb,text,text);DROP FUNCTION IF EXISTS refs_ai_manual_journal_risk_batch_hash(uuid,uuid,uuid,jsonb);DROP TABLE IF EXISTS ai_manual_journal_risk_finding;
COMMIT;
