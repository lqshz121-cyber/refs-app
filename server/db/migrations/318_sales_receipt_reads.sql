BEGIN;
CREATE VIEW sales_receipt_detail_read AS
SELECT s.tenant_id,s.entity_id,s.sales_receipt_id,s.period_id,s.receipt_number,
  s.customer_ref,s.customer_name,s.bank_member_ref,s.cash_account_code,s.category_account_code,
  s.accounting_date,s.currency,s.amount::text amount,s.description,s.status,s.version::text revision,
  s.journal_entry_id,j.journal_number,j.status journal_status,j.revision::text journal_revision,
  to_char(s.created_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') created_at,
  to_char(s.posted_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') posted_at
FROM sales_receipt s JOIN journal_entry j ON j.tenant_id=s.tenant_id AND j.entity_id=s.entity_id
  AND j.journal_entry_id=s.journal_entry_id;
REVOKE ALL ON sales_receipt_detail_read FROM PUBLIC,refs_app;
CREATE INDEX sales_receipt_period_id_idx ON sales_receipt(tenant_id,entity_id,period_id,sales_receipt_id);

CREATE FUNCTION refs_read_sales_receipt(p_tenant uuid,p_entity uuid,p_receipt uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE result jsonb;
BEGIN
  PERFORM refs_assert_scope(p_tenant,p_entity,'AR.VIEW');
  IF p_receipt IS NULL THEN RAISE EXCEPTION 'Sales receipt identity is required' USING ERRCODE='22023'; END IF;
  SELECT to_jsonb(r)-'tenant_id'-'entity_id' INTO result FROM sales_receipt_detail_read r
    WHERE tenant_id=p_tenant AND entity_id=p_entity AND sales_receipt_id=p_receipt;
  IF result IS NULL THEN RAISE EXCEPTION 'Sales receipt is unavailable in this company' USING ERRCODE='P0002'; END IF;
  RETURN jsonb_build_object('schema_version','SALES_RECEIPT_DETAIL_V1','entity_id',p_entity,'record',result);
END;
$$;

CREATE FUNCTION refs_list_sales_receipts(p_tenant uuid,p_entity uuid,p_period uuid,p_after uuid DEFAULT NULL,p_limit integer DEFAULT 50)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE result jsonb;next_id uuid;
BEGIN
  PERFORM refs_assert_scope(p_tenant,p_entity,'AR.VIEW');
  IF p_period IS NULL OR p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 100 THEN
    RAISE EXCEPTION 'Sales receipt period and bounded page size are required' USING ERRCODE='22023';
  END IF;
  PERFORM 1 FROM accounting_period WHERE tenant_id=p_tenant AND entity_id=p_entity AND period_id=p_period;
  IF NOT FOUND THEN RAISE EXCEPTION 'Sales receipt period is unavailable in this company' USING ERRCODE='P0002'; END IF;
  IF p_after IS NOT NULL AND NOT EXISTS(SELECT 1 FROM sales_receipt WHERE tenant_id=p_tenant AND entity_id=p_entity
    AND period_id=p_period AND sales_receipt_id=p_after) THEN
    RAISE EXCEPTION 'Sales receipt cursor does not belong to this company and period' USING ERRCODE='22023';
  END IF;
  WITH page AS MATERIALIZED (
    SELECT r.sales_receipt_id,to_jsonb(r)-'tenant_id'-'entity_id' record
    FROM sales_receipt_detail_read r WHERE r.tenant_id=p_tenant AND r.entity_id=p_entity AND r.period_id=p_period
      AND (p_after IS NULL OR r.sales_receipt_id>p_after)
    ORDER BY r.sales_receipt_id LIMIT p_limit+1
  ), visible AS (SELECT * FROM page ORDER BY sales_receipt_id LIMIT p_limit)
  SELECT COALESCE((SELECT jsonb_agg(record ORDER BY sales_receipt_id) FROM visible),'[]'::jsonb),
    CASE WHEN (SELECT count(*) FROM page)>p_limit THEN (SELECT sales_receipt_id FROM visible ORDER BY sales_receipt_id DESC LIMIT 1) ELSE NULL END
    INTO result,next_id;
  RETURN jsonb_build_object('schema_version','SALES_RECEIPT_PAGE_V1','entity_id',p_entity,'period_id',p_period,
    'after_id',p_after,'limit',p_limit,'rows',result,'next_id',next_id);
END;
$$;
REVOKE ALL ON FUNCTION refs_read_sales_receipt(uuid,uuid,uuid),refs_list_sales_receipts(uuid,uuid,uuid,uuid,integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION refs_read_sales_receipt(uuid,uuid,uuid),refs_list_sales_receipts(uuid,uuid,uuid,uuid,integer) TO refs_app;
COMMIT;
