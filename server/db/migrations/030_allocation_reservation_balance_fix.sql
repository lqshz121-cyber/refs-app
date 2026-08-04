BEGIN;
DO $$
DECLARE fn text; old text;
BEGIN
  SELECT pg_get_functiondef('refs_create_ap_payment(uuid,uuid,uuid,uuid,text,date,text,text,numeric,text,text,text)'::regprocedure) INTO fn;
  old:=fn;
  fn:=replace(fn, 'status IN (''PENDING'',''ACTIVE'')', 'status=''PENDING''');
  IF fn=old THEN RAISE EXCEPTION 'AP payment reservation predicate not found' USING ERRCODE='55000'; END IF;
  EXECUTE fn;
END $$;
DO $$
DECLARE fn text; old text;
BEGIN
  SELECT pg_get_functiondef('refs_create_ar_receipt(uuid,uuid,uuid,uuid,text,date,text,text,numeric,text,text,text)'::regprocedure) INTO fn;
  old:=fn;
  fn:=replace(fn, 'status IN (''PENDING'',''ACTIVE'')', 'status=''PENDING''');
  IF fn=old THEN RAISE EXCEPTION 'AR receipt reservation predicate not found' USING ERRCODE='55000'; END IF;
  EXECUTE fn;
END $$;
COMMIT;
