BEGIN;

REVOKE EXECUTE ON FUNCTION refs_create_reconciliation_adjustment_draft(uuid,uuid,uuid,uuid,bigint,uuid,text,date,char,text,jsonb,uuid[],text,text,text) FROM refs_app;
DROP FUNCTION refs_create_reconciliation_adjustment_draft(uuid,uuid,uuid,uuid,bigint,uuid,text,date,char,text,jsonb,uuid[],text,text,text);
ALTER FUNCTION refs_create_reconciliation_adjustment_draft_105(uuid,uuid,uuid,uuid,bigint,uuid,text,date,char,text,jsonb,uuid[],text,text,text)
  RENAME TO refs_create_reconciliation_adjustment_draft;
GRANT EXECUTE ON FUNCTION refs_create_reconciliation_adjustment_draft(uuid,uuid,uuid,uuid,bigint,uuid,text,date,char,text,jsonb,uuid[],text,text,text) TO refs_app;

COMMIT;
