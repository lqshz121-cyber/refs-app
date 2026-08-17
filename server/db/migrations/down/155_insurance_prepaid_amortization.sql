BEGIN;
DO $$ BEGIN
  IF EXISTS(SELECT 1 FROM insurance_prepaid_amortization_review) OR EXISTS(SELECT 1 FROM insurance_prepaid_amortization_draft_evidence) THEN RAISE EXCEPTION 'Cannot remove retained insurance prepaid amortization evidence' USING ERRCODE='55000'; END IF;
END $$;
REVOKE ALL ON FUNCTION refs_create_insurance_prepaid_amortization_draft(uuid,uuid,uuid,text,text,text,text),refs_create_insurance_prepaid_amortization_draft_hash(uuid,uuid,uuid,text,text),refs_review_insurance_prepaid_amortization(uuid,uuid,uuid,uuid,uuid,uuid,uuid,uuid,uuid,uuid,text,text,text,text,text,text),refs_review_insurance_prepaid_amortization_hash(uuid,uuid,uuid,uuid,uuid,uuid,uuid,uuid,uuid,uuid,text,text,text,text) FROM PUBLIC,refs_app;
DROP FUNCTION refs_create_insurance_prepaid_amortization_draft(uuid,uuid,uuid,text,text,text,text);
DROP FUNCTION refs_create_insurance_prepaid_amortization_draft_hash(uuid,uuid,uuid,text,text);
DROP FUNCTION refs_review_insurance_prepaid_amortization(uuid,uuid,uuid,uuid,uuid,uuid,uuid,uuid,uuid,uuid,text,text,text,text,text,text);
DROP FUNCTION refs_review_insurance_prepaid_amortization_hash(uuid,uuid,uuid,uuid,uuid,uuid,uuid,uuid,uuid,uuid,text,text,text,text);
DROP TABLE insurance_prepaid_amortization_draft_evidence;
DROP TABLE insurance_prepaid_amortization_review;
DELETE FROM permission_catalog WHERE permission_code IN('PREPAID.AMORTIZATION.REVIEW','PREPAID.AMORTIZATION.DRAFT');
COMMIT;
