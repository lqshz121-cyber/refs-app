BEGIN;

DROP FUNCTION IF EXISTS refs_admit_wbs_provider_signed_payables(uuid,uuid,jsonb,jsonb,jsonb,text,text);
ALTER FUNCTION refs_admit_wbs_provider_signed_payables_111(uuid,uuid,jsonb,jsonb,jsonb,text,text)
  RENAME TO refs_admit_wbs_provider_signed_payables;
REVOKE ALL ON FUNCTION refs_admit_wbs_provider_signed_payables(uuid,uuid,jsonb,jsonb,jsonb,text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION refs_admit_wbs_provider_signed_payables(uuid,uuid,jsonb,jsonb,jsonb,text,text) TO refs_app;

COMMIT;
