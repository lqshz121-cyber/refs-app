BEGIN;

DROP FUNCTION IF EXISTS refs_admit_wbs_provider_signed_payables(uuid,uuid,jsonb,jsonb,jsonb,text,text);
DROP FUNCTION IF EXISTS refs_wbs_provider_signed_payable_admission_hash(uuid,uuid,jsonb,jsonb,jsonb);
DROP TABLE IF EXISTS wbs_provider_signed_payable_admission;

COMMIT;
