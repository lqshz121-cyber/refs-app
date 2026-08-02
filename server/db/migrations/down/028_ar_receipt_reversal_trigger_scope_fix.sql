BEGIN;
DO $$
DECLARE fn text;
BEGIN
 SELECT pg_get_functiondef('refs_apply_ar_receipt_reversal_posted()'::regprocedure) INTO fn;
 fn:=replace(fn, 'IF NOT FOUND OR adj.adjustment_kind<>''AR_RECEIPT_REVERSAL'' THEN RETURN NEW; END IF;', 'IF NOT FOUND THEN RETURN NEW; END IF;');
 IF fn=pg_get_functiondef('refs_apply_ar_receipt_reversal_posted()'::regprocedure) THEN RETURN; END IF;
 EXECUTE fn;
END $$;
DO $$
DECLARE fn text;
BEGIN
 SELECT pg_get_functiondef('refs_apply_ap_ar_posted_adjustment()'::regprocedure) INTO fn;
 fn:=replace(fn, 'IF NOT FOUND OR adj.adjustment_kind NOT IN (''AP_BILL_VOID'',''AP_VENDOR_CREDIT'',''AR_CREDIT_MEMO'',''AR_REFUND'') THEN RETURN NEW; END IF;', 'IF NOT FOUND THEN RETURN NEW; END IF;');
 IF fn=pg_get_functiondef('refs_apply_ap_ar_posted_adjustment()'::regprocedure) THEN RETURN; END IF;
 EXECUTE fn;
END $$;
COMMIT;
