BEGIN;
DROP FUNCTION IF EXISTS refs_read_ai_loan_reference_findings_for_period(uuid,uuid,uuid,integer);
DROP FUNCTION IF EXISTS refs_read_ai_cost_dimension_findings_for_period(uuid,uuid,uuid,integer);
DROP FUNCTION IF EXISTS refs_read_ai_duplicate_payable_findings_for_period(uuid,uuid,uuid,integer);
DROP FUNCTION IF EXISTS refs_read_ai_prepaid_coverage_findings_for_period(uuid,uuid,uuid,integer);
COMMIT;
