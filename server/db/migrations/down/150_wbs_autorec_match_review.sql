BEGIN;

REVOKE EXECUTE ON FUNCTION refs_get_wbs_autorec_match_review(uuid,uuid,uuid) FROM refs_app;
REVOKE EXECUTE ON FUNCTION refs_review_wbs_autorec_bank_match(uuid,uuid,text,text,uuid,bigint,text,text,text,text) FROM refs_app;
REVOKE EXECUTE ON FUNCTION refs_wbs_autorec_match_review_hash(uuid,uuid,text,text,uuid,bigint,text,text) FROM refs_app;
DROP FUNCTION refs_get_wbs_autorec_match_review(uuid,uuid,uuid);
DROP FUNCTION refs_review_wbs_autorec_bank_match(uuid,uuid,text,text,uuid,bigint,text,text,text,text);
DROP FUNCTION refs_wbs_autorec_match_review_hash(uuid,uuid,text,text,uuid,bigint,text,text);
DROP TABLE wbs_autorec_match_review;
DELETE FROM permission_catalog WHERE permission_code='BANK.MATCH.REVIEW';

COMMIT;
