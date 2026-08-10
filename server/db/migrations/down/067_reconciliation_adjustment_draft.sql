BEGIN;

DROP TRIGGER IF EXISTS reconciliation_adjustment_post_guard ON journal_entry;
DROP TRIGGER IF EXISTS reconciliation_adjustment_review_sod_guard ON reconciliation;
DROP FUNCTION IF EXISTS refs_guard_reconciliation_adjustment_lifecycle();
REVOKE ALL ON FUNCTION refs_transition_reconciliation_adjustment_aware(uuid,uuid,uuid,text,bigint,text,text,text) FROM refs_app;
REVOKE ALL ON FUNCTION refs_set_reconciliation_adjustment_clearance(uuid,uuid,uuid,uuid,bigint,bigint,boolean,text,text,text) FROM refs_app;
REVOKE ALL ON FUNCTION refs_reconciliation_adjustment_clearance_hash(uuid,uuid,uuid,uuid,bigint,bigint,boolean,text) FROM refs_app;
REVOKE ALL ON FUNCTION refs_create_reconciliation_adjustment_draft(uuid,uuid,uuid,uuid,bigint,uuid,text,date,char,text,jsonb,uuid[],text,text,text) FROM refs_app;
REVOKE ALL ON FUNCTION refs_reconciliation_adjustment_draft_hash(uuid,uuid,uuid,uuid,bigint,uuid,text,date,char,text,jsonb,uuid[],text) FROM refs_app;
DROP FUNCTION IF EXISTS refs_transition_reconciliation_adjustment_aware(uuid,uuid,uuid,text,bigint,text,text,text);
DROP FUNCTION IF EXISTS refs_set_reconciliation_adjustment_clearance(uuid,uuid,uuid,uuid,bigint,bigint,boolean,text,text,text);
DROP FUNCTION IF EXISTS refs_reconciliation_adjustment_clearance_hash(uuid,uuid,uuid,uuid,bigint,bigint,boolean,text);
DROP FUNCTION IF EXISTS refs_create_reconciliation_adjustment_draft(uuid,uuid,uuid,uuid,bigint,uuid,text,date,char,text,jsonb,uuid[],text,text,text);
DROP FUNCTION IF EXISTS refs_reconciliation_adjustment_draft_hash(uuid,uuid,uuid,uuid,bigint,uuid,text,date,char,text,jsonb,uuid[],text);
DROP POLICY IF EXISTS reconciliation_adjustment_draft_scope_policy ON reconciliation_adjustment_draft;
DROP TABLE IF EXISTS reconciliation_adjustment_draft;
DELETE FROM permission_catalog WHERE permission_code='BANK.RECONCILIATION.ADJUSTMENT_DRAFT';

COMMIT;
