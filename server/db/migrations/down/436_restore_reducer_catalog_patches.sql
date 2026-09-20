BEGIN;

-- Returns the function to the state 435 left it in, so that down 436 followed by down 435 walks
-- back through the chain in order. Running this alone reinstates the two defects described in the
-- up body; it exists for chain reversibility, not because that state was correct.

DO $$
DECLARE fn text; old text;
BEGIN
  SELECT pg_get_functiondef('refs_apply_ap_ar_posted_adjustment()'::regprocedure) INTO fn;
  old:=fn;
  fn:=replace(fn,
    'bill.status NOT IN (''APPROVED'',''OPEN'') OR bill.open_balance<>bill.gross_amount OR bill.currency<>adj.currency',
    'bill.status<>''APPROVED'' OR bill.open_balance<>bill.gross_amount OR bill.currency<>adj.currency');
  IF fn=old THEN RAISE EXCEPTION '436 down void reducer: expected text not found' USING ERRCODE='55000'; END IF;
  EXECUTE fn;
END $$;

DO $$
DECLARE fn text; old text;
BEGIN
  SELECT pg_get_functiondef('refs_apply_ap_ar_posted_adjustment()'::regprocedure) INTO fn;
  old:=fn;
  fn:=replace(fn,
    'IF NOT FOUND OR adj.adjustment_kind NOT IN (''AP_BILL_VOID'',''AP_VENDOR_CREDIT'',''AR_CREDIT_MEMO'',''AR_REFUND'',''AP_BILL_WRITE_OFF'',''AR_INVOICE_WRITE_OFF'') THEN RETURN NEW; END IF;',
    'IF NOT FOUND THEN RETURN NEW; END IF;');
  IF fn=old THEN RAISE EXCEPTION '436 down scope guard: expected text not found' USING ERRCODE='55000'; END IF;
  EXECUTE fn;
END $$;

COMMIT;
