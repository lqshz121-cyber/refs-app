BEGIN;
DO $$BEGIN IF EXISTS(SELECT 1 FROM wbs_h1_accounting_control_reconciliation) THEN RAISE EXCEPTION 'Cannot remove WBS H1 accounting control reconciliation with retained evidence' USING ERRCODE='55000';END IF;END $$;
DROP FUNCTION refs_list_wbs_h1_accounting_control_reconciliations(uuid,uuid,uuid,integer,integer);
DROP FUNCTION refs_read_wbs_h1_accounting_control_reconciliation(uuid,uuid,uuid);
DROP FUNCTION refs_retain_wbs_h1_accounting_control_reconciliation(uuid,uuid,uuid,text,text,text,text,text);
DROP TABLE wbs_h1_accounting_control_reconciliation_account;
DROP TABLE wbs_h1_accounting_control_reconciliation;
COMMIT;
