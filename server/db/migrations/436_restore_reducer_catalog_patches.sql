BEGIN;

-- Repairs a regression introduced by 435.
--
-- 435 rebuilt refs_apply_ap_ar_posted_adjustment with CREATE OR REPLACE, using the body from 010
-- as its base on the assumption that 010 was the last definition of that function. It was the last
-- *whole* definition, but not the live one: 028 and 423 had each amended the installed function in
-- place, via pg_get_functiondef + replace + EXECUTE, and left no new CREATE OR REPLACE behind for a
-- file-level grep to find. Rebuilding from the file therefore silently dropped both amendments.
--
-- What was lost, and what it cost:
--
--   028 -- the kind scope guard. Without it the generic reducer claims every adjustment whose
--          draft journal is being posted, including the reversal kinds owned by other reducers.
--          Those reducers fire first (trigger order is by name) and set status='POSTED', so the
--          generic reducer then hit its own POSTED guard and raised 23514. AP payment reversal and
--          AR receipt reversal were dead at the database level.
--   423 -- the AP bill void status widening. Posting a bill leaves it OPEN since 423, but the void
--          branch was back to demanding APPROVED, so no natively created bill could be voided.
--
-- Both are re-applied here in the same idiom, and the scope list is extended with the two write-off
-- kinds 435 added -- omitting them would make the generic reducer return early for a write-off and
-- never activate it, which is the same class of bug pointing the other way.

DO $$
DECLARE fn text; old text;
BEGIN
  SELECT pg_get_functiondef('refs_apply_ap_ar_posted_adjustment()'::regprocedure) INTO fn;
  old:=fn;
  fn:=replace(fn,
    'IF NOT FOUND THEN RETURN NEW; END IF;',
    'IF NOT FOUND OR adj.adjustment_kind NOT IN (''AP_BILL_VOID'',''AP_VENDOR_CREDIT'',''AR_CREDIT_MEMO'',''AR_REFUND'',''AP_BILL_WRITE_OFF'',''AR_INVOICE_WRITE_OFF'') THEN RETURN NEW; END IF;');
  IF fn=old THEN RAISE EXCEPTION '436 scope guard: expected text not found' USING ERRCODE='55000'; END IF;
  EXECUTE fn;
END $$;

DO $$
DECLARE fn text; old text;
BEGIN
  SELECT pg_get_functiondef('refs_apply_ap_ar_posted_adjustment()'::regprocedure) INTO fn;
  old:=fn;
  fn:=replace(fn,
    'bill.status<>''APPROVED'' OR bill.open_balance<>bill.gross_amount OR bill.currency<>adj.currency',
    'bill.status NOT IN (''APPROVED'',''OPEN'') OR bill.open_balance<>bill.gross_amount OR bill.currency<>adj.currency');
  IF fn=old THEN RAISE EXCEPTION '436 void reducer: expected text not found' USING ERRCODE='55000'; END IF;
  EXECUTE fn;
END $$;

COMMIT;
