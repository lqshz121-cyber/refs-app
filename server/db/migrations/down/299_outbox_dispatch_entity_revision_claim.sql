BEGIN;

-- There is no safe return to the tenant-wide v2 claim.  Rolling this release
-- back therefore disables both claim entry points and requires a subsequent
-- forward migration before dispatch can resume.  Keep v3 installed so callers
-- receive an authorization failure rather than silently falling back to v2.
REVOKE ALL ON FUNCTION refs_claim_outbox_v3(uuid,text,uuid[],bigint[],integer,integer) FROM PUBLIC,refs_app;
REVOKE EXECUTE ON FUNCTION refs_claim_outbox_v2(uuid,text,integer,integer) FROM refs_app;

COMMIT;
