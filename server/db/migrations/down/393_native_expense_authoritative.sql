BEGIN;
DO $$ BEGIN
  IF EXISTS(SELECT 1 FROM expense) THEN
    RAISE EXCEPTION 'Cannot remove expense schema while business records exist' USING ERRCODE='55000';
  END IF;
END; $$;
DROP TRIGGER expense_posted ON journal_entry;
DROP FUNCTION refs_activate_posted_expense();
DROP FUNCTION refs_create_native_expense(uuid,uuid,uuid,text,text,text,text,text,date,char,numeric,text,uuid[],text);
DROP TABLE expense;
DELETE FROM runtime_human_permission_authority WHERE permission_code='AP.EXPENSE.CREATE';
DELETE FROM permission_catalog WHERE permission_code='AP.EXPENSE.CREATE';
COMMIT;
