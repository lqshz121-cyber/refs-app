BEGIN;
CREATE INDEX mapping_snapshot_loan_statement_account_read_idx ON mapping_snapshot(tenant_id,entity_id,family,status,effective_from,effective_to,priority) WHERE family='CONSTRUCTION_LOAN_STATEMENT_ACCOUNT_PAIR';

CREATE FUNCTION refs_read_ai_construction_loan_balance_policy(p_tenant uuid,p_entity uuid,p_period uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE period_row accounting_period;selected setting_snapshot;match_count integer;expected_keys text[]:=ARRAY['minimum_difference','policy_version','rule_id','schema_version'];
BEGIN
  PERFORM refs_assert_ai_analysis_scope(p_tenant,p_entity);SELECT * INTO period_row FROM accounting_period WHERE tenant_id=p_tenant AND entity_id=p_entity AND period_id=p_period;IF NOT FOUND THEN RAISE EXCEPTION 'Loan balance review requires one entity period' USING ERRCODE='22023';END IF;
  SELECT count(*) INTO match_count FROM setting_snapshot WHERE tenant_id=p_tenant AND entity_id=p_entity AND family='AI_CONSTRUCTION_LOAN_BALANCE_POLICY' AND scope_type='ENTITY' AND scope_key=p_entity::text AND status='APPROVED' AND effective_from::date<=period_row.ends_on AND(effective_to IS NULL OR effective_to::date>period_row.ends_on);
  IF match_count=0 THEN RETURN NULL;END IF;IF match_count<>1 THEN RAISE EXCEPTION 'AI construction-loan balance policy scope is ambiguous' USING ERRCODE='23514';END IF;
  SELECT * INTO selected FROM setting_snapshot WHERE tenant_id=p_tenant AND entity_id=p_entity AND family='AI_CONSTRUCTION_LOAN_BALANCE_POLICY' AND scope_type='ENTITY' AND scope_key=p_entity::text AND status='APPROVED' AND effective_from::date<=period_row.ends_on AND(effective_to IS NULL OR effective_to::date>period_row.ends_on) FOR SHARE;
  IF selected.snapshot_hash IS DISTINCT FROM refs_jsonb_hash(selected.snapshot) OR ARRAY(SELECT jsonb_object_keys(selected.snapshot) ORDER BY 1) IS DISTINCT FROM expected_keys OR selected.snapshot->>'schema_version'<>'AI_CONSTRUCTION_LOAN_BALANCE_POLICY_SNAPSHOT_V1' OR selected.snapshot->>'rule_id'<>'AI_CONSTRUCTION_LOAN_BALANCE_REVIEW_V1' OR jsonb_typeof(selected.snapshot->'policy_version')<>'number' OR(selected.snapshot->>'policy_version')::integer<1 OR coalesce(selected.snapshot->>'minimum_difference','')!~'^(0|[1-9][0-9]*)\.[0-9]{4}$' THEN RAISE EXCEPTION 'Approved construction-loan balance policy is malformed or hash-invalid' USING ERRCODE='23514';END IF;
  RETURN(selected.snapshot-'schema_version'-'rule_id')||jsonb_build_object('setting_snapshot_id',selected.setting_snapshot_id,'setting_snapshot_hash',selected.snapshot_hash);
END;$$;

CREATE FUNCTION refs_read_ai_construction_loan_lender_balances(p_tenant uuid,p_entity uuid,p_period uuid)
RETURNS TABLE(entity_id uuid,source_document_id uuid,source_document_line_id uuid,source_payload_hash text,source_line_hash text,loan_ref text,statement_date date,currency char(3),lender_closing_balance numeric(20,4),account_code text,mapping_snapshot_id uuid,mapping_version text,mapping_snapshot_hash text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE period_row accounting_period;
BEGIN
  PERFORM refs_assert_ai_analysis_scope(p_tenant,p_entity);SELECT * INTO period_row FROM accounting_period WHERE tenant_id=p_tenant AND entity_id=p_entity AND period_id=p_period;IF NOT FOUND THEN RAISE EXCEPTION 'Lender balance read requires one entity period' USING ERRCODE='22023';END IF;
  RETURN QUERY WITH source_rows AS(
    SELECT d.entity_id,d.source_document_id,l.source_document_line_id,d.payload_hash,refs_jsonb_hash(jsonb_build_object('schema_version','AI_LENDER_CLOSING_BALANCE_SOURCE_V1','source_document_id',d.source_document_id,'source_document_line_id',l.source_document_line_id,'source_line_id',l.source_line_id,'line_no',l.line_no,'loan_ref',btrim(l.loan_ref),'statement_date',d.accounting_date,'currency',d.currency,'lender_closing_balance',l.amount,'statement_balance_kind',l.external_dimension_refs->>'statement_balance_kind')) source_line_hash,btrim(l.loan_ref) loan_ref,d.accounting_date statement_date,d.currency,l.amount lender_closing_balance
    FROM source_document d JOIN source_document_line l ON l.tenant_id=d.tenant_id AND l.entity_id=d.entity_id AND l.source_document_id=d.source_document_id
    WHERE d.tenant_id=p_tenant AND d.entity_id=p_entity AND d.source_module='loan' AND d.document_type='LOAN_STATEMENT' AND d.status='READY_FOR_DRAFT' AND d.accounting_date BETWEEN period_row.starts_on AND period_row.ends_on AND d.payload_hash~'^sha256:[0-9a-f]{64}$' AND NULLIF(btrim(l.loan_ref),'') IS NOT NULL AND l.direction='NONE' AND l.amount>=0 AND l.external_dimension_refs=jsonb_build_object('statement_balance_kind','CLOSING_PRINCIPAL_BALANCE')
  ), mapped AS(
    SELECT s.*,m.mapping_snapshot_id,m.version::text mapping_version,m.snapshot_hash,m.output_rules->>'account_code' account_code,count(*)OVER(PARTITION BY s.source_document_line_id) mapping_count,max(s.statement_date)OVER(PARTITION BY m.output_rules->>'account_code') latest_date
    FROM source_rows s JOIN mapping_snapshot m ON m.tenant_id=p_tenant AND m.entity_id=p_entity AND m.family='CONSTRUCTION_LOAN_STATEMENT_ACCOUNT_PAIR' AND m.status='APPROVED' AND m.effective_from::date<=s.statement_date AND(m.effective_to IS NULL OR m.effective_to::date>s.statement_date) AND m.input_keys=jsonb_build_object('loan_ref',s.loan_ref)
    WHERE m.snapshot_hash=refs_jsonb_hash(m.snapshot) AND m.output_rules ? 'account_code' AND m.output_rules->>'account_code'~'^[0-9A-Za-z._-]{1,64}$'
  )
  SELECT m.entity_id,m.source_document_id,m.source_document_line_id,m.payload_hash,m.source_line_hash,m.loan_ref,m.statement_date,m.currency,m.lender_closing_balance,m.account_code,m.mapping_snapshot_id,m.mapping_version,m.snapshot_hash FROM mapped m WHERE m.mapping_count=1 AND m.statement_date=m.latest_date ORDER BY m.account_code,m.source_document_line_id;
END;$$;
REVOKE ALL ON FUNCTION refs_read_ai_construction_loan_balance_policy(uuid,uuid,uuid),refs_read_ai_construction_loan_lender_balances(uuid,uuid,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION refs_read_ai_construction_loan_balance_policy(uuid,uuid,uuid),refs_read_ai_construction_loan_lender_balances(uuid,uuid,uuid) TO refs_app;
COMMIT;
