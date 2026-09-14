BEGIN;

DO $$
BEGIN
  IF EXISTS(SELECT 1 FROM expense) THEN
    RAISE EXCEPTION 'Existing Expenses prevent rollback of their expense-account classification correction' USING ERRCODE='55000';
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION refs_create_native_expense(uuid,uuid,uuid,text,text,text,text,text,date,char,numeric,text,uuid[],text),refs_read_native_expense_create_options(uuid,uuid,uuid) FROM PUBLIC,refs_app;
DROP FUNCTION refs_create_native_expense(uuid,uuid,uuid,text,text,text,text,text,date,char,numeric,text,uuid[],text);
DROP FUNCTION refs_read_native_expense_create_options(uuid,uuid,uuid);
ALTER FUNCTION refs_create_native_expense_403(uuid,uuid,uuid,text,text,text,text,text,date,char,numeric,text,uuid[],text)
  RENAME TO refs_create_native_expense;
ALTER FUNCTION refs_read_native_expense_create_options_403(uuid,uuid,uuid)
  RENAME TO refs_read_native_expense_create_options;
GRANT EXECUTE ON FUNCTION refs_create_native_expense(uuid,uuid,uuid,text,text,text,text,text,date,char,numeric,text,uuid[],text),refs_read_native_expense_create_options(uuid,uuid,uuid) TO refs_app;

COMMIT;
