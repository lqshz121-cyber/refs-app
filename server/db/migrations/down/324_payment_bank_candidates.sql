BEGIN;
DROP FUNCTION refs_read_payment_bank_candidates(uuid,uuid,uuid,uuid,integer);
DROP INDEX payment_occurrence_bank_candidate_idx;
COMMIT;
