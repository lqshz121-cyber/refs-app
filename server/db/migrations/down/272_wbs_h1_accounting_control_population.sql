BEGIN;
DO $$BEGIN IF EXISTS(SELECT 1 FROM wbs_h1_accounting_population_run LIMIT 1) OR EXISTS(SELECT 1 FROM wbs_h1_accounting_evidence_line LIMIT 1) OR EXISTS(SELECT 1 FROM wbs_h1_accounting_module_receipt LIMIT 1) OR EXISTS(SELECT 1 FROM wbs_h1_accounting_population_receipt LIMIT 1) THEN RAISE EXCEPTION 'Refusing to drop retained WBS H1 accounting control evidence' USING ERRCODE='55000';END IF;END$$;
DROP FUNCTION refs_read_wbs_h1_accounting_population(uuid,uuid,uuid,integer,integer);
DROP FUNCTION refs_finalize_wbs_h1_accounting_population(uuid,uuid,uuid);
DROP FUNCTION refs_append_wbs_h1_accounting_population_lines(uuid,uuid,uuid,jsonb);
DROP FUNCTION refs_create_wbs_h1_accounting_population_run(uuid,uuid,uuid,text,text,text,text,text,jsonb,text,timestamptz,integer,integer,integer,numeric,numeric,text,text,text);
DROP TABLE wbs_h1_accounting_population_receipt;DROP TABLE wbs_h1_accounting_module_receipt;DROP TABLE wbs_h1_accounting_evidence_line;DROP TABLE wbs_h1_accounting_population_run;
DROP FUNCTION refs_wbs_h1_accounting_jsonb_hash(jsonb);DROP FUNCTION refs_wbs_h1_accounting_canonical_json(jsonb);
COMMIT;
