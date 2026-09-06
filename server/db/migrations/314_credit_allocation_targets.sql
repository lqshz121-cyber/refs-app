BEGIN;
CREATE INDEX business_document_credit_target_idx ON business_document(tenant_id,entity_id,document_kind,counterparty_ref,currency,business_document_id)
  WHERE posted_journal_entry_id IS NOT NULL AND status IN ('APPROVED','OPEN','PARTIALLY_PAID');
CREATE FUNCTION refs_read_credit_allocation_targets(
  p_tenant uuid,p_entity uuid,p_action text,p_credit uuid,p_period uuid,
  p_query text DEFAULT '',p_after_id uuid DEFAULT NULL,p_limit integer DEFAULT 50
) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE context jsonb;result_rows jsonb;next_id uuid;party text;currency_code text;
BEGIN
  IF p_action IS NULL OR p_action NOT IN ('AP_CREDIT_APPLY','AR_CREDIT_APPLY')
    OR p_query IS NULL OR p_query<>btrim(p_query) OR length(p_query)>128 OR p_query~'[[:cntrl:]]'
    OR p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 100 THEN
    RAISE EXCEPTION 'Invalid credit target selection' USING ERRCODE='22023';
  END IF;
  context:=refs_read_credit_usage_context(p_tenant,p_entity,p_action,p_credit,p_period);
  party:=context->'credit'->>'counterparty_ref';currency_code:=context->'credit'->>'currency';
  -- Scope is derived from the credit, not browser-supplied counterparty/currency.
  -- All source periods remain searchable; this read makes no reservation.
  WITH candidates AS MATERIALIZED (
    SELECT d.business_document_id,d.document_number,d.counterparty_ref,d.currency,d.accounting_date,d.due_date,
      d.gross_amount,d.open_balance,d.version,d.status,j.period_id,j.journal_entry_id,
      used.pending AS pending_amount,d.open_balance-used.pending AS available_amount
    FROM business_document d JOIN journal_entry j
      ON j.tenant_id=d.tenant_id AND j.entity_id=d.entity_id AND j.journal_entry_id=d.posted_journal_entry_id
        AND j.status='POSTED' AND j.currency=d.currency
    CROSS JOIN LATERAL (
      SELECT COALESCE(sum(a.amount),0.0000) AS pending FROM business_allocation a
      WHERE a.tenant_id=d.tenant_id AND a.entity_id=d.entity_id AND a.business_document_id=d.business_document_id AND a.status='PENDING'
    ) used
    WHERE d.tenant_id=p_tenant AND d.entity_id=p_entity AND d.counterparty_ref=party AND d.currency=currency_code
      AND d.document_kind=(CASE p_action WHEN 'AP_CREDIT_APPLY' THEN 'AP_BILL' ELSE 'AR_INVOICE' END)
      AND d.status IN ('APPROVED','OPEN','PARTIALLY_PAID') AND d.open_balance-used.pending>0
      AND (p_after_id IS NULL OR d.business_document_id>p_after_id)
      AND (p_query='' OR strpos(lower(d.document_number),lower(p_query))>0 OR strpos(lower(COALESCE(d.description,'')),lower(p_query))>0)
      AND EXISTS(SELECT 1 FROM ledger_line l WHERE l.tenant_id=d.tenant_id AND l.entity_id=d.entity_id AND l.journal_entry_id=j.journal_entry_id)
    ORDER BY d.business_document_id LIMIT p_limit+1
  ), page AS MATERIALIZED (SELECT * FROM candidates ORDER BY business_document_id LIMIT p_limit)
  SELECT COALESCE((SELECT jsonb_agg(jsonb_build_object(
    'business_document_id',business_document_id,'document_number',document_number,'counterparty_ref',counterparty_ref,'currency',currency,
    'accounting_date',accounting_date,'due_date',due_date,'gross_amount',gross_amount::text,'open_balance',open_balance::text,
    'pending_amount',pending_amount::text,'available_amount',available_amount::text,'revision',version::text,'status',status,
    'period_id',period_id,'journal_entry_id',journal_entry_id) ORDER BY business_document_id) FROM page),'[]'::jsonb),
    CASE WHEN (SELECT count(*) FROM candidates)>p_limit THEN (SELECT business_document_id FROM page ORDER BY business_document_id DESC LIMIT 1) END
  INTO result_rows,next_id;
  RETURN jsonb_build_object('schema_version','CREDIT_ALLOCATION_TARGETS_V1','context',context,
    'query',p_query,'after_id',p_after_id,'limit',p_limit,'rows',result_rows,'next_id',next_id);
END;
$$;
REVOKE ALL ON FUNCTION refs_read_credit_allocation_targets(uuid,uuid,text,uuid,uuid,text,uuid,integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION refs_read_credit_allocation_targets(uuid,uuid,text,uuid,uuid,text,uuid,integer) TO refs_app;
COMMIT;
