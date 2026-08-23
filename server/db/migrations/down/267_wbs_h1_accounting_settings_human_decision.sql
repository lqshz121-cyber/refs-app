BEGIN;
DO $$BEGIN IF EXISTS(SELECT 1 FROM wbs_h1_accounting_settings_human_decision LIMIT 1) THEN RAISE EXCEPTION 'Refusing to drop retained WBS H1 Settings human decisions' USING ERRCODE='55000';END IF;END$$;
DROP FUNCTION refs_read_wbs_h1_accounting_settings_decision(uuid,uuid,uuid,text);
DROP FUNCTION refs_decide_wbs_h1_accounting_settings(uuid,uuid,uuid,text,text,text,text,text);
DROP FUNCTION refs_wbs_h1_accounting_settings_decision_request_hash(uuid,uuid,uuid,text,text,text);
DROP TABLE wbs_h1_accounting_settings_human_decision;
DELETE FROM permission_catalog WHERE permission_code='WBS.H1.SETTINGS.DECIDE';
COMMIT;
