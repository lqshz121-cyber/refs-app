BEGIN;

CREATE FUNCTION refs_read_native_expense_create_options(p_tenant uuid,p_entity uuid,p_period uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE result jsonb;
BEGIN
  PERFORM refs_assert_scope(p_tenant,p_entity,'AP.EXPENSE.CREATE');
  PERFORM 1 FROM accounting_period WHERE tenant_id=p_tenant AND entity_id=p_entity AND period_id=p_period AND status='OPEN';
  IF NOT FOUND THEN RAISE EXCEPTION 'Expense creation requires an OPEN company period' USING ERRCODE='55000'; END IF;
  SELECT jsonb_build_object(
    'schema_version','NATIVE_EXPENSE_CREATE_OPTIONS_V1','entity_id',p_entity,'period_id',p_period,
    'vendors',COALESCE((SELECT jsonb_agg(jsonb_build_object('vendor_ref',member_ref,'vendor_name',display_name) ORDER BY member_ref)
      FROM member_master WHERE tenant_id=p_tenant AND entity_id=p_entity AND active AND member_type='VENDOR'),'[]'::jsonb),
    'bank_cash_accounts',COALESCE((SELECT jsonb_agg(jsonb_build_object('bank_member_ref',m.member_ref,'bank_name',m.display_name,'cash_account_code',a.account_code,'cash_account_name',a.account_name) ORDER BY m.member_ref,a.account_code)
      FROM member_master m JOIN account_master a ON a.tenant_id=m.tenant_id AND a.entity_id=m.entity_id
      WHERE m.tenant_id=p_tenant AND m.entity_id=p_entity AND m.active AND m.member_type='BANK' AND a.active AND a.requires_member AND a.required_member_type='BANK'),'[]'::jsonb),
    'expense_accounts',COALESCE((SELECT jsonb_agg(jsonb_build_object('expense_account_code',account_code,'expense_account_name',account_name) ORDER BY account_code)
      FROM account_master WHERE tenant_id=p_tenant AND entity_id=p_entity AND active AND NOT requires_member AND account_class='EXPENSE'),'[]'::jsonb),
    'attachments',COALESCE((SELECT jsonb_agg(jsonb_build_object('attachment_id',attachment_id,'name',name,'media_type',media_type,'size_bytes',size_bytes::text,'content_hash',content_hash,'verified_at',to_char(verified_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"')) ORDER BY verified_at DESC,attachment_id DESC)
      FROM (SELECT attachment_id,name,media_type,size_bytes,content_hash,verified_at FROM attachment WHERE tenant_id=p_tenant AND entity_id=p_entity AND finalization_status='VERIFIED_CLEAN' AND scan_status='CLEAN' AND verified_at IS NOT NULL AND finalized_at IS NOT NULL ORDER BY verified_at DESC,attachment_id DESC LIMIT 100) verified_attachment),'[]'::jsonb)
  ) INTO result;
  RETURN result;
END;
$$;

REVOKE ALL ON FUNCTION refs_read_native_expense_create_options(uuid,uuid,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION refs_read_native_expense_create_options(uuid,uuid,uuid) TO refs_app;
COMMIT;
