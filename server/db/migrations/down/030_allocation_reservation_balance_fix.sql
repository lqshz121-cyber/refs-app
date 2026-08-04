BEGIN;
DO $$
DECLARE fn text; old text;
BEGIN
  SELECT pg_get_functiondef('refs_create_ap_payment(uuid,uuid,uuid,uuid,text,date,text,text,numeric,text,text,text)'::regprocedure) INTO fn;
  old:=fn;
  fn:=replace(fn, 'status=''PENDING''', 'status IN (''PENDING'',''ACTIVE'')');
  IF fn=old THEN RAISE EXCEPTION 'AP payment reservation predicate rollback not found' USING ERRCODE='55000'; END IF;
  EXECUTE fn;
END $$;
DO $$
DECLARE fn text; old text;
BEGIN
  SELECT pg_get_functiondef('refs_create_ar_receipt(uuid,uuid,uuid,uuid,text,date,text,text,numeric,text,text,text)'::regprocedure) INTO fn;
  old:=fn;
  fn:=replace(fn, 'status=''PENDING''', 'status IN (''PENDING'',''ACTIVE'')');
  IF fn=old THEN RAISE EXCEPTION 'AR receipt reservation predicate rollback not found' USING ERRCODE='55000'; END IF;
  EXECUTE fn;
END $$;
COMMIT;
