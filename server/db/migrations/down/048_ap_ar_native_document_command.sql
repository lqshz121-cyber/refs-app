BEGIN;

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM business_document WHERE draft_journal_entry_id IS NOT NULL) THEN
    RAISE EXCEPTION 'Cannot remove native AP/AR document command while Draft business documents exist';
  END IF;
END $$;
DROP TRIGGER IF EXISTS business_document_posted_reducer ON journal_entry;
REVOKE EXECUTE ON FUNCTION refs_create_business_document(uuid,uuid,text,uuid,text,text,text,char(3),date,date,numeric,text,text,uuid[],text,text) FROM refs_app;
DROP FUNCTION IF EXISTS refs_activate_posted_business_document();
DROP FUNCTION IF EXISTS refs_create_business_document(uuid,uuid,text,uuid,text,text,text,char(3),date,date,numeric,text,text,uuid[],text,text);
DROP FUNCTION IF EXISTS refs_create_business_document_hash(uuid,uuid,text,uuid,text,text,text,char(3),date,date,numeric,text,text,uuid[]);
DROP INDEX IF EXISTS business_document_draft_journal_uq;
ALTER TABLE business_document DROP CONSTRAINT IF EXISTS business_document_draft_journal_fk;
ALTER TABLE business_document DROP COLUMN IF EXISTS draft_journal_entry_id;
UPDATE permission_catalog SET active=false,version=version+1,effective_to=clock_timestamp()
  WHERE permission_code IN ('AP.BILL.CREATE','AR.INVOICE.CREATE');

COMMIT;
