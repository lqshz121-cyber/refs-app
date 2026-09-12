BEGIN;
DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM source_parse_run) THEN RAISE EXCEPTION 'Refusing to remove retained source parse evidence' USING ERRCODE='55006'; END IF;
END $$;
DROP FUNCTION IF EXISTS refs_parse_source_document(uuid,uuid,uuid,uuid,text,text,text,text,text);
DROP FUNCTION IF EXISTS refs_parse_source_document_hash(uuid,uuid,uuid,uuid,text,text,text,text);
DROP TABLE IF EXISTS source_parse_run;
DELETE FROM runtime_human_permission_authority WHERE permission_code='GL.SOURCE.PARSE';
UPDATE permission_catalog SET active=false,effective_to=clock_timestamp(),version=version+1 WHERE permission_code='GL.SOURCE.PARSE';
COMMIT;
