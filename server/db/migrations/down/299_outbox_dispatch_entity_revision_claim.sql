BEGIN;

REVOKE EXECUTE ON FUNCTION refs_claim_outbox_v3(uuid,text,uuid[],bigint[],integer,integer) FROM refs_app;
DROP FUNCTION refs_claim_outbox_v3(uuid,text,uuid[],bigint[],integer,integer);
GRANT EXECUTE ON FUNCTION refs_claim_outbox_v2(uuid,text,integer,integer) TO refs_app;

COMMIT;
