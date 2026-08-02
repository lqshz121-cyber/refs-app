BEGIN;
DO $$
DECLARE fn text; old text;
BEGIN
  SELECT pg_get_functiondef('refs_apply_ap_payment_reversal_posted()'::regprocedure) INTO fn;
  old:=fn;
  fn:=replace(fn,
    'IF NOT FOUND OR adj.adjustment_kind<>''AP_PAYMENT_REVERSAL'' THEN RETURN NEW; END IF;',
    'IF NOT FOUND THEN RETURN NEW; END IF;');
  IF fn=old THEN RAISE EXCEPTION 'AP payment reversal trigger scope rollback guard not found' USING ERRCODE='55000'; END IF;
  EXECUTE fn;
END $$;
COMMIT;
