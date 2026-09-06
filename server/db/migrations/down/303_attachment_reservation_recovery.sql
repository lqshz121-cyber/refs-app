BEGIN;
REVOKE ALL ON FUNCTION refs_find_attachment_reservation(uuid,uuid,text,text,bigint,text,text) FROM refs_app;
DROP FUNCTION refs_find_attachment_reservation(uuid,uuid,text,text,bigint,text,text);
COMMIT;
