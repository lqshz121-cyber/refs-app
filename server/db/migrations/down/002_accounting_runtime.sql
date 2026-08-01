BEGIN;

DROP FUNCTION IF EXISTS refs_complete_outbox(uuid,uuid,text,boolean,text);
DROP FUNCTION IF EXISTS refs_claim_outbox(uuid,text,integer);
DROP FUNCTION IF EXISTS refs_post_journal(uuid,uuid,uuid,uuid,bigint,text,text,text);
DROP FUNCTION IF EXISTS refs_close_period(uuid,uuid,uuid,bigint,text,text,text);
DROP FUNCTION IF EXISTS refs_update_draft_description(uuid,uuid,uuid,bigint,text,text,text);
DROP FUNCTION IF EXISTS refs_reserve_idempotency(uuid,text,text,text,text);
DROP FUNCTION IF EXISTS refs_jsonb_hash(jsonb);
DROP FUNCTION IF EXISTS refs_protect_outbox_payload() CASCADE;
DROP FUNCTION IF EXISTS refs_assert_scope(uuid,uuid,text);
DROP FUNCTION IF EXISTS refs_current_actor();
DROP FUNCTION IF EXISTS refs_has_permission(text);
DROP FUNCTION IF EXISTS refs_entity_has_permission(uuid,text);
DROP FUNCTION IF EXISTS refs_entity_allowed(uuid) CASCADE;
DROP FUNCTION IF EXISTS refs_current_tenant() CASCADE;
DROP FUNCTION IF EXISTS refs_bootstrap_context(text);
DROP FUNCTION IF EXISTS refs_issue_context(text,uuid,text,integer);
DROP FUNCTION IF EXISTS refs_revoke_context(text,text);
DROP FUNCTION IF EXISTS refs_cleanup_contexts(interval);
DROP FUNCTION IF EXISTS refs_reconcile_actor_grants(uuid,text,uuid,text[],bigint,text,text);
DROP FUNCTION IF EXISTS refs_grant_request_hash(uuid,text,uuid,text[],bigint);

ALTER TABLE IF EXISTS outbox_event DROP COLUMN IF EXISTS locked_by;
ALTER TABLE IF EXISTS outbox_event DROP COLUMN IF EXISTS locked_at;
ALTER TABLE IF EXISTS outbox_event DROP COLUMN IF EXISTS entity_id;
ALTER TABLE IF EXISTS sync_cursor DROP COLUMN IF EXISTS entity_id;
ALTER TABLE IF EXISTS import_batch DROP COLUMN IF EXISTS entity_id;
ALTER TABLE IF EXISTS raw_event DROP COLUMN IF EXISTS entity_id;
ALTER TABLE IF EXISTS journal_line DROP CONSTRAINT IF EXISTS journal_line_account_fk;
ALTER TABLE IF EXISTS journal_line DROP CONSTRAINT IF EXISTS journal_line_member_fk;
DROP FUNCTION IF EXISTS refs_validate_journal_line_master() CASCADE;
DROP TABLE IF EXISTS member_master CASCADE;
DROP TABLE IF EXISTS account_master CASCADE;
DROP TABLE IF EXISTS runtime_actor_grant CASCADE;
DROP TABLE IF EXISTS permission_catalog CASCADE;
DROP TABLE IF EXISTS runtime_actor_grant_set CASCADE;
DROP TABLE IF EXISTS runtime_grant_sync_receipt CASCADE;
DROP TABLE IF EXISTS runtime_auth_context CASCADE;

DO $$
DECLARE table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'tenant','entity','accounting_period','sync_cursor','import_batch','raw_event','attachment',
    'source_document','source_document_line','setting_snapshot','mapping_snapshot','rule_evaluation',
    'ai_decision','staging_item','accounting_exception','journal_entry','journal_line','posting_batch',
    'ledger_line','bank_source','bank_match','reconciliation','source_link','idempotency_receipt',
    'audit_event','outbox_event'
  ] LOOP
    EXECUTE format('ALTER TABLE IF EXISTS %I DISABLE ROW LEVEL SECURITY',table_name);
  END LOOP;
END;
$$;

REVOKE ALL ON ALL TABLES IN SCHEMA public FROM refs_app;
GRANT CREATE ON SCHEMA public TO PUBLIC;

COMMIT;
