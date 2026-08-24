BEGIN;

REVOKE EXECUTE ON FUNCTION refs_complete_outbox_v2(uuid,uuid,text,boolean,boolean,text,integer,integer) FROM refs_app;
REVOKE EXECUTE ON FUNCTION refs_claim_outbox_v2(uuid,text,integer,integer) FROM refs_app;
DROP FUNCTION refs_complete_outbox_v2(uuid,uuid,text,boolean,boolean,text,integer,integer);
DROP FUNCTION refs_claim_outbox_v2(uuid,text,integer,integer);
GRANT EXECUTE ON FUNCTION refs_claim_outbox(uuid,text,integer) TO refs_app;
GRANT EXECUTE ON FUNCTION refs_complete_outbox(uuid,uuid,text,boolean,text) TO refs_app;

COMMIT;
