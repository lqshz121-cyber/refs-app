BEGIN;
DO $$ BEGIN IF EXISTS(SELECT 1 FROM ai_admitted_source_review_finding) THEN RAISE EXCEPTION 'Cannot roll back retained admitted-source review evidence' USING ERRCODE='55000';END IF;END $$;
DROP TRIGGER ai_admitted_source_review_after_retained ON wbs_final1_retained_source_row;
DROP TRIGGER ai_admitted_source_review_after_document ON source_document;
DROP TRIGGER ai_admitted_source_review_after_business_document ON business_document;
DROP TRIGGER ai_admitted_source_review_after_source_link ON source_link;
DROP FUNCTION refs_refresh_ai_admitted_source_review_trigger();
DROP FUNCTION refs_refresh_ai_admitted_source_review(uuid,uuid,uuid,text);
DO $$ DECLARE item record;BEGIN FOR item IN SELECT function_definition FROM ai_admitted_source_review_function_backup ORDER BY function_identity LOOP EXECUTE item.function_definition;END LOOP;END $$;
ALTER TABLE ai_finding_action DROP CONSTRAINT ai_finding_action_finding_kind_check;
ALTER TABLE ai_finding_action ADD CONSTRAINT ai_finding_action_finding_kind_check CHECK(finding_kind IN(
  'WBS_EXCEPTION','PREPAID_COVERAGE','DUPLICATE_PAYABLE','UNMATCHED_BANK_PAYMENT',
  'BANK_DUPLICATE_PAYMENT','VENDOR_INVOICE_AMOUNT_SPIKE','VENDOR_INVOICE_FREQUENCY_SPIKE',
  'VENDOR_INVOICE_AMOUNT_DROP','VENDOR_INVOICE_NEAR_DUPLICATE','MANUAL_JOURNAL_RISK','COST_DIMENSION','LOAN_REFERENCE'
));
DROP VIEW ai_admitted_source_review_current_finding;
DROP TABLE ai_admitted_source_review_lifecycle;
DROP TABLE ai_admitted_source_review_finding;
DROP TABLE ai_admitted_source_review_function_backup;
COMMIT;
