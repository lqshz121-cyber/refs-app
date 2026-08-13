BEGIN;

DROP FUNCTION refs_attest_wbs_operator_payables(uuid,uuid,timestamptz,text,text,jsonb,jsonb,text,text,text);
ALTER FUNCTION refs_attest_wbs_operator_payables_104(uuid,uuid,timestamptz,text,text,jsonb,jsonb,text,text,text)
  RENAME TO refs_attest_wbs_operator_payables;
REVOKE ALL ON FUNCTION refs_attest_wbs_operator_payables(uuid,uuid,timestamptz,text,text,jsonb,jsonb,text,text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION refs_attest_wbs_operator_payables(uuid,uuid,timestamptz,text,text,jsonb,jsonb,text,text,text) TO refs_app;

COMMIT;
