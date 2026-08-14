BEGIN;

DO $$
BEGIN
  IF (to_regclass('public.wbs_operator_signed_source_link') IS NOT NULL
      AND EXISTS(SELECT 1 FROM wbs_operator_signed_source_link))
     OR (to_regclass('public.wbs_operator_payable_evidence_provider_hash') IS NOT NULL
      AND EXISTS(SELECT 1 FROM wbs_operator_payable_evidence_provider_hash)) THEN
    RAISE EXCEPTION 'Cannot remove immutable WBS operator signed-source links' USING ERRCODE='55000';
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION refs_link_wbs_operator_evidence_to_signed_source(uuid,uuid,uuid,uuid,text,text) FROM PUBLIC,refs_app;
REVOKE ALL ON FUNCTION refs_wbs_operator_signed_source_link_hash(uuid,uuid,uuid,uuid) FROM PUBLIC,refs_app;
DROP FUNCTION refs_link_wbs_operator_evidence_to_signed_source(uuid,uuid,uuid,uuid,text,text);
DROP FUNCTION refs_wbs_operator_signed_source_link_hash(uuid,uuid,uuid,uuid);
REVOKE ALL ON FUNCTION refs_attest_wbs_operator_payables(uuid,uuid,timestamptz,text,text,jsonb,jsonb,text,text,text) FROM PUBLIC,refs_app;
DROP FUNCTION refs_attest_wbs_operator_payables(uuid,uuid,timestamptz,text,text,jsonb,jsonb,text,text,text);
ALTER FUNCTION refs_attest_wbs_operator_payables_105(uuid,uuid,timestamptz,text,text,jsonb,jsonb,text,text,text)
  RENAME TO refs_attest_wbs_operator_payables;
DROP TABLE wbs_operator_payable_evidence_provider_hash;
DROP TABLE wbs_operator_signed_source_link;

COMMIT;
