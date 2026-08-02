BEGIN;
DO $$
DECLARE fn text; old text;
BEGIN
  SELECT pg_get_functiondef('refs_apply_ap_payment_posted_occurrence()'::regprocedure) INTO fn;
  old:=fn;
  fn:=replace(fn,
    'IF NOT FOUND OR occ.occurrence_kind<>''AP_PAYMENT'' THEN RETURN NEW; END IF;',
    'IF NOT FOUND THEN RETURN NEW; END IF;');
  IF fn=old THEN RAISE EXCEPTION 'AP payment trigger scope guard not found for rollback' USING ERRCODE='55000'; END IF;
  EXECUTE fn;
END $$;
COMMIT;
