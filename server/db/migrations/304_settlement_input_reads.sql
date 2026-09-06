BEGIN;

CREATE FUNCTION refs_read_settlement_bank_members(
  p_tenant uuid,p_entity uuid,p_kind text,p_query text DEFAULT '',
  p_after_ref text DEFAULT NULL,p_limit integer DEFAULT 50
) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE v_rows jsonb;v_next text;
BEGIN
  IF p_kind IS NULL OR p_kind NOT IN ('AP_PAYMENT','AR_RECEIPT') THEN
    RAISE EXCEPTION 'Unsupported settlement kind' USING ERRCODE='22023';
  END IF;
  PERFORM refs_assert_scope(p_tenant,p_entity,CASE p_kind WHEN 'AP_PAYMENT' THEN 'AP.PAYMENT.CREATE' ELSE 'AR.RECEIPT.CREATE' END);
  IF p_query IS NULL OR length(p_query)>128 OR p_query<>btrim(p_query)
     OR p_query~'[[:cntrl:]]' OR p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 100
     OR (p_after_ref IS NOT NULL AND (length(p_after_ref) NOT BETWEEN 1 AND 128
         OR p_after_ref<>btrim(p_after_ref) OR p_after_ref~'[[:cntrl:]]')) THEN
    RAISE EXCEPTION 'Bank member page is invalid' USING ERRCODE='22023';
  END IF;
  WITH candidates AS MATERIALIZED (
    SELECT m.member_ref,m.member_type,m.display_name
      FROM member_master m
     WHERE m.tenant_id=p_tenant AND m.entity_id=p_entity AND m.active AND m.member_type='BANK'
       AND (p_after_ref IS NULL OR m.member_ref COLLATE "C">p_after_ref COLLATE "C")
       AND (p_query='' OR strpos(lower(m.member_ref),lower(p_query))>0
         OR strpos(lower(m.display_name),lower(p_query))>0)
     ORDER BY m.member_ref COLLATE "C" LIMIT p_limit+1
  ), page AS MATERIALIZED (
    SELECT * FROM candidates ORDER BY member_ref COLLATE "C" LIMIT p_limit
  )
  SELECT COALESCE((SELECT jsonb_agg(jsonb_build_object('member_ref',member_ref,
      'member_type',member_type,'display_name',display_name) ORDER BY member_ref COLLATE "C") FROM page),'[]'::jsonb),
    CASE WHEN (SELECT count(*) FROM candidates)>p_limit
      THEN (SELECT member_ref FROM page ORDER BY member_ref COLLATE "C" DESC LIMIT 1) END
    INTO v_rows,v_next;
  RETURN jsonb_build_object('schema_version','SETTLEMENT_BANK_MEMBERS_V1',
    'entity_id',p_entity,'settlement_kind',p_kind,'query',p_query,'after_ref',p_after_ref,
    'limit',p_limit,'rows',v_rows,'next_ref',v_next);
END;
$$;

CREATE FUNCTION refs_read_settlement_context(p_tenant uuid,p_entity uuid,p_kind text,p_document uuid,p_period uuid)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE v_result jsonb;
BEGIN
  IF p_kind IS NULL OR p_kind NOT IN ('AP_PAYMENT','AR_RECEIPT') THEN
    RAISE EXCEPTION 'Unsupported settlement kind' USING ERRCODE='22023';
  END IF;
  PERFORM refs_assert_scope(p_tenant,p_entity,CASE p_kind WHEN 'AP_PAYMENT' THEN 'AP.PAYMENT.CREATE' ELSE 'AR.RECEIPT.CREATE' END);
  -- One snapshot: ACTIVE allocations already reduced open_balance. The payment
  -- period can differ from the original document period. No locks survive this read.
  SELECT jsonb_build_object('schema_version','SETTLEMENT_CONTEXT_V1','entity_id',p_entity,'settlement_kind',p_kind,
    'payment_period',jsonb_build_object('period_id',p.period_id,'starts_on',p.starts_on,'ends_on',p.ends_on,
      'status',p.status,'revision',p.version::text),
    'document',jsonb_build_object('business_document_id',d.business_document_id,'document_kind',d.document_kind,
      'document_number',d.document_number,'counterparty_ref',d.counterparty_ref,'counterparty_name',d.counterparty_name,
      'currency',d.currency,'accounting_date',d.accounting_date,'due_date',d.due_date,'status',d.status,
      'revision',d.version::text,'open_balance',d.open_balance::text),
    'pending_allocation_amount',a.pending::text,'available_amount',(d.open_balance-a.pending)::text,
    'can_create_draft',p.status='OPEN' AND d.open_balance-a.pending>0 AND
      ((p_kind='AP_PAYMENT' AND d.status IN ('APPROVED','OPEN','PARTIALLY_PAID')) OR
       (p_kind='AR_RECEIPT' AND d.status IN ('OPEN','PARTIALLY_PAID'))))
  INTO v_result
  FROM business_document d
  JOIN accounting_period p ON p.tenant_id=d.tenant_id AND p.entity_id=d.entity_id AND p.period_id=p_period
  CROSS JOIN LATERAL (
    SELECT COALESCE(sum(b.amount),0.0000) AS pending FROM business_allocation b
     WHERE b.tenant_id=d.tenant_id AND b.entity_id=d.entity_id AND b.business_document_id=d.business_document_id AND b.status='PENDING'
  ) a
  WHERE d.tenant_id=p_tenant AND d.entity_id=p_entity AND d.business_document_id=p_document
    AND d.document_kind=CASE p_kind WHEN 'AP_PAYMENT' THEN 'AP_BILL' ELSE 'AR_INVOICE' END;
  IF v_result IS NULL THEN
    RAISE EXCEPTION 'Settlement document or payment period not found in this scope' USING ERRCODE='P0002';
  END IF;
  RETURN v_result;
END;
$$;

REVOKE ALL ON FUNCTION refs_read_settlement_bank_members(uuid,uuid,text,text,text,integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION refs_read_settlement_context(uuid,uuid,text,uuid,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION refs_read_settlement_bank_members(uuid,uuid,text,text,text,integer) TO refs_app;
GRANT EXECUTE ON FUNCTION refs_read_settlement_context(uuid,uuid,text,uuid,uuid) TO refs_app;

COMMIT;
