BEGIN;

-- 035/036 promote a newly inserted PENDING allocation synchronously when its
-- credit is already POSTED.  The command response must therefore expose the
-- committed row state, not the transient input value.
DO $$
DECLARE fn text; rewritten text;
BEGIN
  SELECT pg_get_functiondef('refs_apply_ap_vendor_credit(uuid,uuid,uuid,uuid,numeric,text,text,text)'::regprocedure) INTO fn;
  rewritten:=replace(fn,
    '  response:=jsonb_build_object(''business_allocation_id'',allocation_id,''business_adjustment_id'',p_credit,''business_document_id'',p_bill,''amount'',p_amount,''status'',''PENDING'',''idempotent'',false);',
    '  SELECT jsonb_build_object(''business_allocation_id'',allocation_id,''business_adjustment_id'',p_credit,''business_document_id'',p_bill,''amount'',p_amount,''status'',status::text,''idempotent'',false) INTO response FROM business_allocation WHERE tenant_id=p_tenant AND entity_id=p_entity AND business_allocation_id=allocation_id;');
  IF rewritten=fn THEN RAISE EXCEPTION 'AP credit allocation response rewrite was not applied' USING ERRCODE='55000'; END IF;
  EXECUTE rewritten;

  SELECT pg_get_functiondef('refs_apply_ar_credit_memo(uuid,uuid,uuid,uuid,numeric,text,text,text)'::regprocedure) INTO fn;
  rewritten:=replace(fn,
    ' response:=jsonb_build_object(''business_allocation_id'',allocation_id,''business_adjustment_id'',p_credit,''business_document_id'',p_invoice,''amount'',p_amount,''status'',''PENDING'',''idempotent'',false);',
    ' SELECT jsonb_build_object(''business_allocation_id'',allocation_id,''business_adjustment_id'',p_credit,''business_document_id'',p_invoice,''amount'',p_amount,''status'',status::text,''idempotent'',false) INTO response FROM business_allocation WHERE tenant_id=p_tenant AND entity_id=p_entity AND business_allocation_id=allocation_id;');
  IF rewritten=fn THEN RAISE EXCEPTION 'AR credit allocation response rewrite was not applied' USING ERRCODE='55000'; END IF;
  EXECUTE rewritten;
END $$;

COMMIT;
