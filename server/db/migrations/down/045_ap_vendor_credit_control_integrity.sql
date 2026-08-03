BEGIN;

DO $$
DECLARE fn text;
BEGIN
  SELECT pg_get_functiondef('refs_create_ap_vendor_credit(uuid,uuid,uuid,text,date,text,text,numeric,jsonb,text,text,text)'::regprocedure) INTO fn;
  IF position('AP vendor credit lines must be unique, non-control, positive and equal header amount' IN fn)=0 THEN
    RAISE EXCEPTION 'Cannot restore pre-045 AP vendor credit command' USING ERRCODE='55000';
  END IF;
  fn:=replace(fn,
    'OR COALESCE(length(btrim(x.account_code)),0)=0 OR btrim(x.account_code)=''291001'' OR COALESCE(x.amount,0)<=0',
    'OR COALESCE(length(btrim(x.account_code)),0)=0 OR COALESCE(x.amount,0)<=0');
  fn:=replace(fn,
    'AP vendor credit lines must be unique, non-control, positive and equal header amount',
    'AP vendor credit lines must be unique, positive and equal header amount');
  EXECUTE fn;
END $$;

COMMIT;
