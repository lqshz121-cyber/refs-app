BEGIN;

-- Both public commands hold the credit row, then the target document row.
-- Recheck all reservations under those same locks before creating an allocation.
CREATE FUNCTION refs_assert_credit_allocation_capacity(p_tenant uuid,p_entity uuid,p_credit uuid,p_document uuid,p_amount numeric)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE c business_adjustment;d business_document;control_code text;party_ref text;
DECLARE allocated numeric;refunded numeric;pending numeric;
BEGIN
  IF p_amount IS NULL OR p_amount<=0 OR p_amount>=10000000000000000 OR p_amount<>round(p_amount,4) THEN
    RAISE EXCEPTION 'Credit allocation requires an exact positive four-decimal amount' USING ERRCODE='22023';
  END IF;
  SELECT * INTO c FROM business_adjustment WHERE tenant_id=p_tenant AND entity_id=p_entity AND business_adjustment_id=p_credit FOR UPDATE;
  IF NOT FOUND OR c.adjustment_kind NOT IN ('AP_VENDOR_CREDIT','AR_CREDIT_MEMO') OR c.status<>'POSTED' THEN
    RAISE EXCEPTION 'Credit allocation requires a posted credit' USING ERRCODE='23514';
  END IF;
  PERFORM refs_assert_scope(p_tenant,p_entity,CASE c.adjustment_kind WHEN 'AP_VENDOR_CREDIT' THEN 'AP.VENDOR_CREDIT.APPLY' ELSE 'AR.CREDIT_MEMO.APPLY' END);
  control_code:=CASE c.adjustment_kind WHEN 'AP_VENDOR_CREDIT' THEN '291001' ELSE '120200' END;
  SELECT min(l.member_ref) INTO party_ref FROM journal_entry j JOIN journal_line l
    ON l.tenant_id=j.tenant_id AND l.entity_id=j.entity_id AND l.journal_entry_id=j.journal_entry_id
    WHERE j.tenant_id=p_tenant AND j.entity_id=p_entity AND j.journal_entry_id=c.posted_journal_entry_id
      AND j.status='POSTED' AND j.currency=c.currency AND j.period_id=c.period_id AND l.account_code=control_code
    HAVING count(*)=1 AND bool_and(l.member_ref IS NOT NULL AND btrim(l.member_ref)<>'' AND
      CASE c.adjustment_kind WHEN 'AP_VENDOR_CREDIT' THEN l.debit_amount=c.amount AND l.credit_amount=0
        ELSE l.credit_amount=c.amount AND l.debit_amount=0 END);
  SELECT * INTO d FROM business_document WHERE tenant_id=p_tenant AND entity_id=p_entity AND business_document_id=p_document FOR UPDATE;
  IF NOT FOUND OR party_ref IS NULL OR d.counterparty_ref IS DISTINCT FROM party_ref OR d.currency<>c.currency
    OR d.document_kind<>CASE c.adjustment_kind WHEN 'AP_VENDOR_CREDIT' THEN 'AP_BILL' ELSE 'AR_INVOICE' END
    OR d.status NOT IN ('APPROVED','OPEN','PARTIALLY_PAID') THEN
    RAISE EXCEPTION 'Credit allocation requires matching party, currency and open target document' USING ERRCODE='23514';
  END IF;
  SELECT COALESCE(sum(amount),0) INTO allocated FROM business_allocation
    WHERE tenant_id=p_tenant AND entity_id=p_entity AND business_adjustment_id=p_credit AND status IN ('PENDING','ACTIVE');
  SELECT COALESCE(sum(amount),0) INTO refunded FROM business_adjustment
    WHERE tenant_id=p_tenant AND entity_id=p_entity AND source_adjustment_id=p_credit AND adjustment_kind='AR_REFUND'
      AND status IN ('DRAFT','PENDING_REVIEW','PENDING_APPROVAL','APPROVED_PENDING_POST','POSTED');
  SELECT COALESCE(sum(amount),0) INTO pending FROM business_allocation
    WHERE tenant_id=p_tenant AND entity_id=p_entity AND business_document_id=p_document AND status='PENDING';
  IF p_amount+allocated+refunded>c.amount OR p_amount+pending>d.open_balance THEN
    RAISE EXCEPTION 'Credit allocation exceeds unreserved credit or target balance' USING ERRCODE='23514';
  END IF;
END;
$$;
REVOKE ALL ON FUNCTION refs_assert_credit_allocation_capacity(uuid,uuid,uuid,uuid,numeric) FROM PUBLIC;

DO $$
DECLARE item record;original text;rewritten text;guard text;
BEGIN
  FOR item IN SELECT * FROM (VALUES
    ('refs_apply_ap_vendor_credit(uuid,uuid,uuid,uuid,numeric,text,text,text)','p_bill'),
    ('refs_apply_ar_credit_memo(uuid,uuid,uuid,uuid,numeric,text,text,text)','p_invoice')) AS commands(signature,target_arg)
  LOOP
    SELECT pg_get_functiondef(item.signature::regprocedure) INTO original;
    guard:='PERFORM refs_assert_credit_allocation_capacity(p_tenant,p_entity,p_credit,'||item.target_arg||',p_amount); ';
    IF strpos(original,guard)>0 THEN RAISE EXCEPTION 'Credit capacity guard already installed' USING ERRCODE='55000';END IF;
    rewritten:=replace(original,'INSERT INTO business_allocation(',guard||'INSERT INTO business_allocation(');
    IF rewritten=original THEN RAISE EXCEPTION 'Credit allocation insertion anchor missing' USING ERRCODE='55000';END IF;
    EXECUTE rewritten;
  END LOOP;
END $$;
COMMIT;
