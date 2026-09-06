BEGIN;
DO $$
DECLARE item record;original text;rewritten text;guard text;
BEGIN
  FOR item IN SELECT * FROM (VALUES
    ('refs_apply_ap_vendor_credit(uuid,uuid,uuid,uuid,numeric,text,text,text)','p_bill'),
    ('refs_apply_ar_credit_memo(uuid,uuid,uuid,uuid,numeric,text,text,text)','p_invoice')) AS commands(signature,target_arg)
  LOOP
    SELECT pg_get_functiondef(item.signature::regprocedure) INTO original;
    guard:='PERFORM refs_assert_credit_allocation_capacity(p_tenant,p_entity,p_credit,'||item.target_arg||',p_amount); ';
    rewritten:=replace(original,guard,'');
    IF rewritten=original THEN RAISE EXCEPTION 'Credit allocation capacity guard missing' USING ERRCODE='55000';END IF;
    EXECUTE rewritten;
  END LOOP;
END $$;
DROP FUNCTION refs_assert_credit_allocation_capacity(uuid,uuid,uuid,uuid,numeric);
COMMIT;
