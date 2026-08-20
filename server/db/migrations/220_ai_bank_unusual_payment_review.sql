BEGIN;

CREATE FUNCTION refs_read_ai_bank_unusual_payment_policy(p_tenant uuid,p_entity uuid,p_period uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE period_end date;selected setting_snapshot;match_count integer;expected_keys text[]:=ARRAY['holiday_dates','minimum_absolute_payment','policy_version','rule_id','schema_version','weekend_days'];
BEGIN
  PERFORM refs_assert_ai_analysis_scope(p_tenant,p_entity);
  SELECT ends_on INTO period_end FROM accounting_period WHERE tenant_id=p_tenant AND entity_id=p_entity AND period_id=p_period;
  IF NOT FOUND THEN RAISE EXCEPTION 'Accounting period is outside the unusual payment policy scope' USING ERRCODE='22023';END IF;
  SELECT count(*) INTO match_count FROM setting_snapshot WHERE tenant_id=p_tenant AND entity_id=p_entity AND family='AI_BANK_UNUSUAL_PAYMENT_POLICY' AND scope_type='ENTITY' AND scope_key=p_entity::text AND status='APPROVED' AND effective_from<=period_end::timestamptz AND(effective_to IS NULL OR effective_to>period_end::timestamptz);
  IF match_count=0 THEN RETURN NULL;END IF;IF match_count<>1 THEN RAISE EXCEPTION 'AI bank unusual payment policy scope is ambiguous' USING ERRCODE='23514';END IF;
  SELECT * INTO selected FROM setting_snapshot WHERE tenant_id=p_tenant AND entity_id=p_entity AND family='AI_BANK_UNUSUAL_PAYMENT_POLICY' AND scope_type='ENTITY' AND scope_key=p_entity::text AND status='APPROVED' AND effective_from<=period_end::timestamptz AND(effective_to IS NULL OR effective_to>period_end::timestamptz) FOR SHARE;
  IF selected.snapshot_hash IS DISTINCT FROM refs_jsonb_hash(selected.snapshot)
    OR ARRAY(SELECT jsonb_object_keys(selected.snapshot) ORDER BY 1) IS DISTINCT FROM expected_keys
    OR selected.snapshot->>'schema_version'<>'AI_BANK_UNUSUAL_PAYMENT_POLICY_SNAPSHOT_V1'
    OR selected.snapshot->>'rule_id'<>'AI_BANK_UNUSUAL_PAYMENT_REVIEW_V1'
    OR jsonb_typeof(selected.snapshot->'policy_version')<>'number' OR (selected.snapshot->>'policy_version')::integer<1
    OR coalesce(selected.snapshot->>'minimum_absolute_payment','')!~'^(0|[1-9][0-9]*)\.[0-9]{4}$' OR (selected.snapshot->>'minimum_absolute_payment')::numeric<=0
    OR jsonb_typeof(selected.snapshot->'weekend_days')<>'array' OR jsonb_array_length(selected.snapshot->'weekend_days') NOT BETWEEN 1 AND 7
    OR EXISTS(SELECT 1 FROM jsonb_array_elements(selected.snapshot->'weekend_days') value WHERE jsonb_typeof(value)<>'number' OR value::text::integer NOT BETWEEN 0 AND 6)
    OR (SELECT count(*) FROM jsonb_array_elements(selected.snapshot->'weekend_days'))<>(SELECT count(DISTINCT value::text) FROM jsonb_array_elements(selected.snapshot->'weekend_days') value)
    OR jsonb_typeof(selected.snapshot->'holiday_dates')<>'array' OR jsonb_array_length(selected.snapshot->'holiday_dates')>366
    OR EXISTS(SELECT 1 FROM jsonb_array_elements_text(selected.snapshot->'holiday_dates') value WHERE value!~'^\d{4}-\d{2}-\d{2}$')
    OR (SELECT count(*) FROM jsonb_array_elements(selected.snapshot->'holiday_dates'))<>(SELECT count(DISTINCT value) FROM jsonb_array_elements_text(selected.snapshot->'holiday_dates') value)
  THEN RAISE EXCEPTION 'Approved AI bank unusual payment policy is malformed or hash-invalid' USING ERRCODE='23514';END IF;
  RETURN (selected.snapshot-'schema_version'-'rule_id')||jsonb_build_object('schema_version','AI_BANK_UNUSUAL_PAYMENT_POLICY_V1','setting_snapshot_id',selected.setting_snapshot_id,'setting_snapshot_hash',selected.snapshot_hash);
END;$$;

CREATE FUNCTION refs_read_ai_bank_unusual_payment_sources(p_tenant uuid,p_entity uuid,p_period uuid,p_limit integer DEFAULT 500)
RETURNS TABLE(bank_source_id uuid,source_document_id uuid,source_document_line_id uuid,source_payload_hash text,source_line_hash text,entity_id uuid,accounting_period_id uuid,bank_account_ref text,external_bank_line_id text,transaction_date date,currency char(3),amount numeric(20,4),counterparty_name text,bank_memo text,source_admission_status text,signature_verified boolean)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE selected_period accounting_period;
BEGIN
  PERFORM refs_assert_ai_analysis_scope(p_tenant,p_entity);
  IF p_limit IS NULL OR p_limit<1 OR p_limit>500 THEN RAISE EXCEPTION 'AI bank unusual payment source limit must be between 1 and 500' USING ERRCODE='22023';END IF;
  SELECT period.* INTO selected_period FROM accounting_period period WHERE period.tenant_id=p_tenant AND period.entity_id=p_entity AND period.period_id=p_period;
  IF NOT FOUND THEN RAISE EXCEPTION 'AI bank unusual payment accounting period was not found' USING ERRCODE='23503';END IF;
  RETURN QUERY SELECT bank.bank_source_id,document.source_document_id,line.source_document_line_id,document.payload_hash,
    refs_jsonb_hash(jsonb_build_object('schema_version','AI_BANK_PAYMENT_SOURCE_LINE_V1','source_document_id',document.source_document_id,'source_document_line_id',line.source_document_line_id,'source_line_id',line.source_line_id,'line_no',line.line_no,'amount',bank.amount,'transaction_date',bank.transaction_date,'bank_account_ref',bank.bank_account_ref,'external_bank_line_id',bank.external_bank_line_id,'party_ref',line.party_ref,'description',line.description)) source_line_hash,
    bank.entity_id,selected_period.period_id,bank.bank_account_ref,bank.external_bank_line_id,bank.transaction_date,bank.currency,bank.amount,NULLIF(btrim(line.party_ref),''),NULLIF(btrim(line.description),''),receipt.admission_status,receipt.signature_verified
  FROM bank_source bank JOIN source_document document ON document.tenant_id=bank.tenant_id AND document.entity_id=bank.entity_id AND document.source_document_id=bank.source_document_id
  JOIN source_document_line line ON line.tenant_id=bank.tenant_id AND line.entity_id=bank.entity_id AND line.source_document_id=document.source_document_id AND line.source_document_line_id=bank.source_line_id
  JOIN wbs_bank_statement_transaction txn ON txn.tenant_id=bank.tenant_id AND txn.entity_id=bank.entity_id AND txn.bank_source_id=bank.bank_source_id AND txn.source_document_id=document.source_document_id
  JOIN wbs_bank_statement_receipt receipt ON receipt.tenant_id=txn.tenant_id AND receipt.entity_id=txn.entity_id AND receipt.wbs_bank_statement_receipt_id=txn.wbs_bank_statement_receipt_id
  WHERE bank.tenant_id=p_tenant AND bank.entity_id=p_entity AND bank.transaction_date BETWEEN selected_period.starts_on AND selected_period.ends_on AND bank.amount<0 AND document.payload_hash~'^sha256:[0-9a-f]{64}$' AND receipt.signature_verified=true AND receipt.admission_status='ADMITTED'
  ORDER BY bank.transaction_date,bank.bank_account_ref,bank.amount,bank.bank_source_id LIMIT p_limit;
END;$$;

REVOKE ALL ON FUNCTION refs_read_ai_bank_unusual_payment_policy(uuid,uuid,uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION refs_read_ai_bank_unusual_payment_sources(uuid,uuid,uuid,integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION refs_read_ai_bank_unusual_payment_policy(uuid,uuid,uuid) TO refs_app;
GRANT EXECUTE ON FUNCTION refs_read_ai_bank_unusual_payment_sources(uuid,uuid,uuid,integer) TO refs_app;
COMMIT;
