BEGIN;
CREATE VIEW expense_detail_read AS
SELECT e.tenant_id,e.entity_id,e.expense_id,e.period_id,e.expense_number,
  e.vendor_ref,e.vendor_name,e.bank_member_ref,e.cash_account_code,e.expense_account_code,
  e.accounting_date,e.currency,e.amount::text amount,e.description,e.status,e.version::text revision,
  e.journal_entry_id,j.journal_number,j.status journal_status,j.revision::text journal_revision,
  to_char(e.created_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') created_at,
  to_char(e.posted_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') posted_at
FROM expense e JOIN journal_entry j ON j.tenant_id=e.tenant_id AND j.entity_id=e.entity_id AND j.journal_entry_id=e.journal_entry_id;
REVOKE ALL ON expense_detail_read FROM PUBLIC,refs_app;
CREATE INDEX expense_period_id_idx ON expense(tenant_id,entity_id,period_id,expense_id);

CREATE FUNCTION refs_read_expense(p_tenant uuid,p_entity uuid,p_expense uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE result jsonb;
BEGIN
  PERFORM refs_assert_scope(p_tenant,p_entity,'AP.VIEW');
  IF p_expense IS NULL THEN RAISE EXCEPTION 'Expense identity is required' USING ERRCODE='22023'; END IF;
  SELECT to_jsonb(r)-'tenant_id'-'entity_id' INTO result FROM expense_detail_read r
    WHERE tenant_id=p_tenant AND entity_id=p_entity AND expense_id=p_expense;
  IF result IS NULL THEN RAISE EXCEPTION 'Expense is unavailable in this company' USING ERRCODE='P0002'; END IF;
  RETURN jsonb_build_object('schema_version','EXPENSE_DETAIL_V1','entity_id',p_entity,'record',result);
END;
$$;

CREATE FUNCTION refs_list_expenses(p_tenant uuid,p_entity uuid,p_period uuid,p_after uuid DEFAULT NULL,p_limit integer DEFAULT 50)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE result jsonb;next_id uuid;
BEGIN
  PERFORM refs_assert_scope(p_tenant,p_entity,'AP.VIEW');
  IF p_period IS NULL OR p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 100 THEN
    RAISE EXCEPTION 'Expense period and bounded page size are required' USING ERRCODE='22023';
  END IF;
  PERFORM 1 FROM accounting_period WHERE tenant_id=p_tenant AND entity_id=p_entity AND period_id=p_period;
  IF NOT FOUND THEN RAISE EXCEPTION 'Expense period is unavailable in this company' USING ERRCODE='P0002'; END IF;
  IF p_after IS NOT NULL AND NOT EXISTS(SELECT 1 FROM expense WHERE tenant_id=p_tenant AND entity_id=p_entity AND period_id=p_period AND expense_id=p_after) THEN
    RAISE EXCEPTION 'Expense cursor does not belong to this company and period' USING ERRCODE='22023';
  END IF;
  WITH page AS MATERIALIZED (
    SELECT r.expense_id,to_jsonb(r)-'tenant_id'-'entity_id' record
    FROM expense_detail_read r WHERE r.tenant_id=p_tenant AND r.entity_id=p_entity AND r.period_id=p_period
      AND (p_after IS NULL OR r.expense_id>p_after)
    ORDER BY r.expense_id LIMIT p_limit+1
  ), visible AS (SELECT * FROM page ORDER BY expense_id LIMIT p_limit)
  SELECT COALESCE((SELECT jsonb_agg(record ORDER BY expense_id) FROM visible),'[]'::jsonb),
    CASE WHEN (SELECT count(*) FROM page)>p_limit THEN (SELECT expense_id FROM visible ORDER BY expense_id DESC LIMIT 1) ELSE NULL END
    INTO result,next_id;
  RETURN jsonb_build_object('schema_version','EXPENSE_PAGE_V1','entity_id',p_entity,'period_id',p_period,
    'after_id',p_after,'limit',p_limit,'rows',result,'next_id',next_id);
END;
$$;
REVOKE ALL ON FUNCTION refs_read_expense(uuid,uuid,uuid),refs_list_expenses(uuid,uuid,uuid,uuid,integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION refs_read_expense(uuid,uuid,uuid),refs_list_expenses(uuid,uuid,uuid,uuid,integer) TO refs_app;
COMMIT;
