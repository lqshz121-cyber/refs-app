BEGIN;
LOCK TABLE intercompany_elimination_batch,intercompany_elimination_line,intercompany_elimination_history,consolidation_elimination_evidence IN ACCESS EXCLUSIVE MODE;
DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM intercompany_elimination_batch)
   OR EXISTS(SELECT 1 FROM consolidation_elimination_evidence WHERE elimination_ref LIKE 'INTERCOMPANY_ELIMINATION_BATCH:%') THEN
  RAISE EXCEPTION 'Refusing to remove retained intercompany elimination evidence' USING ERRCODE='55000';
 END IF;
END $$;
DROP TRIGGER IF EXISTS consolidation_intercompany_elimination_projection_guard ON consolidation_elimination_evidence;
DROP TRIGGER IF EXISTS intercompany_elimination_batch_protect ON intercompany_elimination_batch;
DROP TRIGGER IF EXISTS intercompany_elimination_line_append_only ON intercompany_elimination_line;
DROP TRIGGER IF EXISTS intercompany_elimination_history_append_only ON intercompany_elimination_history;
REVOKE ALL ON FUNCTION refs_get_consolidation(uuid,uuid,uuid,text) FROM refs_app;
DROP FUNCTION refs_get_consolidation(uuid,uuid,uuid,text);
ALTER FUNCTION refs_get_consolidation_082(uuid,uuid,uuid,text) RENAME TO refs_get_consolidation;
GRANT EXECUTE ON FUNCTION refs_get_consolidation(uuid,uuid,uuid,text) TO refs_app;
REVOKE ALL ON FUNCTION
 refs_read_intercompany_elimination_batch(uuid,uuid,uuid),refs_read_intercompany_elimination_create_options(uuid,uuid,uuid,text,uuid,uuid,uuid,uuid),
 refs_create_intercompany_elimination(uuid,uuid,uuid,uuid,uuid,uuid,uuid,uuid,text,text,text,text,text),
 refs_transition_intercompany_elimination(uuid,uuid,uuid,text,bigint,text,text,text),refs_cancel_intercompany_elimination(uuid,uuid,uuid,bigint,text,text,text),
 refs_post_intercompany_elimination(uuid,uuid,uuid,bigint,text,text),refs_read_intercompany_elimination_register(uuid,uuid,uuid,integer)
 FROM refs_app;
DROP FUNCTION refs_read_intercompany_elimination_register(uuid,uuid,uuid,integer);
DROP FUNCTION refs_post_intercompany_elimination(uuid,uuid,uuid,bigint,text,text);
DROP FUNCTION refs_cancel_intercompany_elimination(uuid,uuid,uuid,bigint,text,text,text);
DROP FUNCTION refs_transition_intercompany_elimination(uuid,uuid,uuid,text,bigint,text,text,text);
DROP FUNCTION refs_create_intercompany_elimination(uuid,uuid,uuid,uuid,uuid,uuid,uuid,uuid,text,text,text,text,text);
DROP FUNCTION refs_read_intercompany_elimination_create_options(uuid,uuid,uuid,text,uuid,uuid,uuid,uuid);
DROP FUNCTION refs_read_intercompany_elimination_batch(uuid,uuid,uuid);
DROP FUNCTION refs_intercompany_elimination_batch_payload(uuid,uuid,uuid);
DROP FUNCTION refs_intercompany_elimination_post_hash(uuid,uuid,uuid,bigint);
DROP FUNCTION refs_intercompany_elimination_transition_hash(uuid,uuid,uuid,text,bigint,text);
DROP FUNCTION refs_intercompany_elimination_create_hash(uuid,uuid,uuid,uuid,uuid,uuid,uuid,uuid,text,text,text);
DROP FUNCTION refs_intercompany_elimination_source_snapshot(uuid,uuid,uuid,uuid,uuid,uuid,uuid,uuid,text);
DROP FUNCTION refs_intercompany_elimination_posted_source_current(uuid,uuid);
DROP FUNCTION refs_guard_intercompany_elimination_projection();
DROP FUNCTION refs_protect_intercompany_elimination_batch();
DROP TABLE intercompany_elimination_internal_gate;
DROP TABLE intercompany_elimination_history;
DROP TABLE intercompany_elimination_line;
DROP TABLE intercompany_elimination_batch;
UPDATE permission_catalog SET active=false,effective_to=COALESCE(effective_to,clock_timestamp()),version=version+1
 WHERE permission_code LIKE 'GROUP.INTERCOMPANY_ELIMINATION.%';
DELETE FROM runtime_human_permission_authority WHERE permission_code LIKE 'GROUP.INTERCOMPANY_ELIMINATION.%';
COMMIT;
