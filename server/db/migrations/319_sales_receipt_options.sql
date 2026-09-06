BEGIN;
CREATE INDEX account_master_active_ref_page_idx ON account_master(tenant_id,entity_id,account_code COLLATE "C") WHERE active;
CREATE FUNCTION refs_read_sales_receipt_options(p_tenant uuid,p_entity uuid,p_kind text,p_query text DEFAULT '',p_after text DEFAULT NULL,p_limit integer DEFAULT 50)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE result jsonb;next_ref text;
BEGIN
  PERFORM refs_assert_scope(p_tenant,p_entity,'AR.SALES_RECEIPT.CREATE');
  IF p_kind IS NULL OR p_kind NOT IN ('CUSTOMER','BANK','CASH_ACCOUNT','CATEGORY_ACCOUNT')
    OR p_query IS NULL OR length(p_query)>128 OR p_query<>btrim(p_query) OR p_query~'[[:cntrl:]]'
    OR p_after IS NOT NULL AND (length(p_after) NOT BETWEEN 1 AND 128 OR p_after<>btrim(p_after) OR p_after~'[[:cntrl:]]')
    OR p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 100 THEN
    RAISE EXCEPTION 'Sales receipt option selection is invalid' USING ERRCODE='22023';
  END IF;
  WITH members AS MATERIALIZED (
    SELECT member_ref ref,display_name label,member_type kind FROM member_master
    WHERE tenant_id=p_tenant AND entity_id=p_entity AND active
      AND ((p_kind='CUSTOMER' AND member_type IN ('CUSTOMER','AFFILIATE')) OR (p_kind='BANK' AND member_type='BANK'))
      AND (p_after IS NULL OR member_ref COLLATE "C">p_after COLLATE "C")
      AND (p_query='' OR strpos(lower(member_ref),lower(p_query))>0 OR strpos(lower(display_name),lower(p_query))>0)
    ORDER BY member_ref COLLATE "C" LIMIT p_limit+1
  ), accounts AS MATERIALIZED (
    SELECT account_code ref,account_name label,p_kind kind FROM account_master
    WHERE tenant_id=p_tenant AND entity_id=p_entity AND active
      AND ((p_kind='CASH_ACCOUNT' AND requires_member AND required_member_type='BANK') OR (p_kind='CATEGORY_ACCOUNT' AND NOT requires_member))
      AND (p_after IS NULL OR account_code COLLATE "C">p_after COLLATE "C")
      AND (p_query='' OR strpos(lower(account_code),lower(p_query))>0 OR strpos(lower(account_name),lower(p_query))>0)
    ORDER BY account_code COLLATE "C" LIMIT p_limit+1
  ), candidates AS MATERIALIZED (
    SELECT * FROM members UNION ALL SELECT * FROM accounts
  ), page AS MATERIALIZED (SELECT * FROM candidates ORDER BY ref COLLATE "C" LIMIT p_limit)
  SELECT COALESCE((SELECT jsonb_agg(jsonb_build_object('ref',ref,'label',label,'kind',kind) ORDER BY ref COLLATE "C") FROM page),'[]'::jsonb),
    CASE WHEN (SELECT count(*) FROM candidates)>p_limit THEN (SELECT ref FROM page ORDER BY ref COLLATE "C" DESC LIMIT 1) ELSE NULL END
    INTO result,next_ref;
  RETURN jsonb_build_object('schema_version','SALES_RECEIPT_OPTIONS_V1','entity_id',p_entity,'option_kind',p_kind,
    'query',p_query,'after_ref',p_after,'limit',p_limit,'rows',result,'next_ref',next_ref);
END;
$$;
REVOKE ALL ON FUNCTION refs_read_sales_receipt_options(uuid,uuid,text,text,text,integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION refs_read_sales_receipt_options(uuid,uuid,text,text,text,integer) TO refs_app;
COMMIT;
