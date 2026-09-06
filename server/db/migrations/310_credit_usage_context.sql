BEGIN;
CREATE FUNCTION refs_read_credit_usage_context(p_tenant uuid,p_entity uuid,p_action text,p_credit uuid,p_period uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE v_kind text;v_permission text;v_control text;v_result jsonb;
BEGIN
  CASE p_action
    WHEN 'AP_CREDIT_APPLY' THEN v_kind:='AP_VENDOR_CREDIT';v_permission:='AP.VENDOR_CREDIT.APPLY';v_control:='291001';
    WHEN 'AR_CREDIT_APPLY' THEN v_kind:='AR_CREDIT_MEMO';v_permission:='AR.CREDIT_MEMO.APPLY';v_control:='120200';
    WHEN 'AR_REFUND' THEN v_kind:='AR_CREDIT_MEMO';v_permission:='AR.REFUND.CREATE';v_control:='120200';
    ELSE RAISE EXCEPTION 'Unsupported credit action' USING ERRCODE='22023';
  END CASE;
  PERFORM refs_assert_scope(p_tenant,p_entity,v_permission);
  -- One statement snapshot. This is availability evidence, not a reservation:
  -- the existing command must lock and recheck before committing any use.
  SELECT jsonb_build_object('schema_version','CREDIT_USAGE_CONTEXT_V1','entity_id',p_entity,'action',p_action,
    'period',jsonb_build_object('period_id',p.period_id,'starts_on',p.starts_on,'ends_on',p.ends_on,'status',p.status,'revision',p.version::text),
    'credit',jsonb_build_object('business_adjustment_id',a.business_adjustment_id,'adjustment_kind',a.adjustment_kind,
      'journal_entry_id',j.journal_entry_id,'number',j.journal_number,'counterparty_ref',c.member_ref,
      'currency',a.currency,'amount',a.amount::text,'revision',a.version::text),
    'allocated_amount',used.allocated::text,'refund_amount',r.refunded::text,
    'available_amount',(a.amount-used.allocated-r.refunded)::text)
  INTO v_result
  FROM business_adjustment a
  JOIN journal_entry j ON j.tenant_id=a.tenant_id AND j.entity_id=a.entity_id AND j.period_id=a.period_id
    AND j.journal_entry_id=a.posted_journal_entry_id AND j.status='POSTED' AND j.currency=a.currency
  JOIN accounting_period p ON p.tenant_id=a.tenant_id AND p.entity_id=a.entity_id AND p.period_id=p_period
  CROSS JOIN LATERAL (
    SELECT min(l.member_ref) AS member_ref,count(*) AS lines,
      bool_and(l.member_ref IS NOT NULL AND btrim(l.member_ref)<>'' AND
        CASE WHEN v_kind='AP_VENDOR_CREDIT' THEN l.debit_amount=a.amount AND l.credit_amount=0
             ELSE l.credit_amount=a.amount AND l.debit_amount=0 END) AS valid
    FROM journal_line l WHERE l.tenant_id=a.tenant_id AND l.entity_id=a.entity_id
      AND l.journal_entry_id=j.journal_entry_id AND l.account_code=v_control
  ) c
  CROSS JOIN LATERAL (
    SELECT COALESCE(sum(b.amount),0.0000) AS allocated FROM business_allocation b
    WHERE b.tenant_id=a.tenant_id AND b.entity_id=a.entity_id AND b.business_adjustment_id=a.business_adjustment_id
      AND b.status IN ('PENDING','ACTIVE')
  ) used
  CROSS JOIN LATERAL (
    SELECT COALESCE(sum(b.amount),0.0000) AS refunded FROM business_adjustment b
    WHERE b.tenant_id=a.tenant_id AND b.entity_id=a.entity_id AND b.source_adjustment_id=a.business_adjustment_id
      AND b.adjustment_kind='AR_REFUND' AND b.status IN ('DRAFT','PENDING_REVIEW','PENDING_APPROVAL','APPROVED_PENDING_POST','POSTED')
  ) r
  WHERE a.tenant_id=p_tenant AND a.entity_id=p_entity AND a.business_adjustment_id=p_credit
    AND a.adjustment_kind=v_kind AND a.status='POSTED' AND c.lines=1 AND c.valid;
  IF v_result IS NULL THEN RAISE EXCEPTION 'Posted credit, control evidence or selected period unavailable' USING ERRCODE='P0002';END IF;
  RETURN v_result;
END;
$$;
REVOKE ALL ON FUNCTION refs_read_credit_usage_context(uuid,uuid,text,uuid,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION refs_read_credit_usage_context(uuid,uuid,text,uuid,uuid) TO refs_app;
COMMIT;
