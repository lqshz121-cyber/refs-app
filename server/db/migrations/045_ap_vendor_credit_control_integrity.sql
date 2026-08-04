BEGIN;

-- A legacy command could accept 291001 as a user-supplied counterpart,
-- cancelling the AP control debit that represents the vendor credit.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM business_adjustment a
    JOIN journal_line l ON l.tenant_id=a.tenant_id AND l.entity_id=a.entity_id
      AND l.journal_entry_id=a.posted_journal_entry_id
    WHERE a.adjustment_kind='AP_VENDOR_CREDIT' AND a.status='POSTED'
      AND l.account_code='291001' AND l.credit_amount>0
  ) THEN
    RAISE EXCEPTION 'Legacy AP vendor credits use an unsafe AP credit direction; remediate before migration 045' USING ERRCODE='55000';
  END IF;
END $$;

DO $$
DECLARE fn text;
BEGIN
  SELECT pg_get_functiondef('refs_create_ap_vendor_credit(uuid,uuid,uuid,text,date,text,text,numeric,jsonb,text,text,text)'::regprocedure) INTO fn;
  IF position('AP vendor credit lines must be unique, positive and equal header amount' IN fn)=0 THEN
    RAISE EXCEPTION 'Cannot harden AP vendor credit command from the installed function body' USING ERRCODE='55000';
  END IF;
  fn:=replace(fn,
    'OR COALESCE(length(btrim(x.account_code)),0)=0 OR COALESCE(x.amount,0)<=0',
    'OR COALESCE(length(btrim(x.account_code)),0)=0 OR btrim(x.account_code)=''291001'' OR COALESCE(x.amount,0)<=0');
  fn:=replace(fn,
    'AP vendor credit lines must be unique, positive and equal header amount',
    'AP vendor credit lines must be unique, non-control, positive and equal header amount');
  EXECUTE fn;
END $$;

COMMIT;
