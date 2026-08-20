BEGIN;

CREATE FUNCTION refs_read_ai_manual_journal_risk_policy(p_tenant uuid,p_entity uuid,p_period uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE period_end date;selected setting_snapshot;match_count integer;expected_keys text[]:=ARRAY['large_manual_journal_threshold','policy_version','round_amount_increment','rule_id','schema_version'];
BEGIN
  PERFORM refs_assert_ai_analysis_scope(p_tenant,p_entity);
  SELECT ends_on INTO period_end FROM accounting_period WHERE tenant_id=p_tenant AND entity_id=p_entity AND period_id=p_period;
  IF NOT FOUND THEN RAISE EXCEPTION 'Accounting period is outside the manual Journal risk policy scope' USING ERRCODE='22023';END IF;
  SELECT count(*) INTO match_count FROM setting_snapshot WHERE tenant_id=p_tenant AND entity_id=p_entity AND family='AI_MANUAL_JOURNAL_RISK_POLICY' AND scope_type='ENTITY' AND scope_key=p_entity::text AND status='APPROVED' AND effective_from<=period_end::timestamptz AND(effective_to IS NULL OR effective_to>period_end::timestamptz);
  IF match_count=0 THEN RETURN NULL;END IF;IF match_count<>1 THEN RAISE EXCEPTION 'AI manual Journal risk policy scope is ambiguous' USING ERRCODE='23514';END IF;
  SELECT * INTO selected FROM setting_snapshot WHERE tenant_id=p_tenant AND entity_id=p_entity AND family='AI_MANUAL_JOURNAL_RISK_POLICY' AND scope_type='ENTITY' AND scope_key=p_entity::text AND status='APPROVED' AND effective_from<=period_end::timestamptz AND(effective_to IS NULL OR effective_to>period_end::timestamptz) FOR SHARE;
  IF selected.snapshot_hash IS DISTINCT FROM refs_jsonb_hash(selected.snapshot) OR ARRAY(SELECT jsonb_object_keys(selected.snapshot) ORDER BY 1) IS DISTINCT FROM expected_keys OR selected.snapshot->>'schema_version'<>'AI_MANUAL_JOURNAL_RISK_POLICY_SNAPSHOT_V1' OR selected.snapshot->>'rule_id'<>'AI_MANUAL_JOURNAL_RISK_V1' OR jsonb_typeof(selected.snapshot->'policy_version')<>'number' OR (selected.snapshot->>'policy_version')::integer<1 OR coalesce(selected.snapshot->>'large_manual_journal_threshold','')!~'^(0|[1-9][0-9]*)\.[0-9]{4}$' OR (selected.snapshot->>'large_manual_journal_threshold')::numeric<=0 OR coalesce(selected.snapshot->>'round_amount_increment','')!~'^(0|[1-9][0-9]*)\.[0-9]{4}$' OR (selected.snapshot->>'round_amount_increment')::numeric<=0 THEN RAISE EXCEPTION 'Approved AI manual Journal risk policy is malformed or hash-invalid' USING ERRCODE='23514';END IF;
  RETURN (selected.snapshot-'schema_version'-'rule_id')||jsonb_build_object('schema_version','AI_MANUAL_JOURNAL_RISK_POLICY_V1','setting_snapshot_id',selected.setting_snapshot_id,'setting_snapshot_hash',selected.snapshot_hash);
END;$$;

CREATE FUNCTION refs_read_ai_manual_journal_risk_inputs(p_tenant uuid,p_entity uuid,p_period uuid,p_limit integer DEFAULT 500) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE result jsonb;
BEGIN
  PERFORM refs_assert_ai_analysis_scope(p_tenant,p_entity);
  IF p_limit NOT BETWEEN 1 AND 500 THEN RAISE EXCEPTION 'Manual Journal risk input limit is invalid' USING ERRCODE='22023';END IF;
  IF NOT EXISTS(SELECT 1 FROM accounting_period WHERE tenant_id=p_tenant AND entity_id=p_entity AND period_id=p_period) THEN RAISE EXCEPTION 'Accounting period is outside the manual Journal risk scope' USING ERRCODE='22023';END IF;
  SELECT coalesce(jsonb_agg(x.payload ORDER BY x.journal_date,x.journal_entry_id),'[]'::jsonb) INTO result FROM(
    SELECT j.journal_date,j.journal_entry_id,jsonb_build_object(
      'journal_entry_id',j.journal_entry_id,'entity_id',j.entity_id,'accounting_period_id',j.period_id,'journal_number',j.journal_number,'journal_type',j.journal_type,'status',j.status::text,'journal_date',j.journal_date,'currency',j.currency,
      'attachment_count',(SELECT count(*) FROM source_link sl JOIN attachment a ON a.tenant_id=sl.tenant_id AND a.attachment_id=sl.attachment_id WHERE sl.tenant_id=j.tenant_id AND sl.entity_id=j.entity_id AND sl.journal_entry_id=j.journal_entry_id AND sl.link_type='JE_ATTACHMENT' AND a.finalization_status='VERIFIED_CLEAN'),
      'source_document_ids',(SELECT coalesce(jsonb_agg(d.source_document_id ORDER BY d.source_document_id),'[]'::jsonb) FROM(SELECT DISTINCT sd.source_document_id FROM source_link sl JOIN source_document sd ON sd.tenant_id=sl.tenant_id AND sd.entity_id=sl.entity_id AND sd.source_document_id=sl.source_document_id WHERE sl.tenant_id=j.tenant_id AND sl.entity_id=j.entity_id AND sl.journal_entry_id=j.journal_entry_id AND sl.source_document_id IS NOT NULL)d),
      'source_payload_hashes',(SELECT coalesce(jsonb_agg(d.payload_hash ORDER BY d.source_document_id),'[]'::jsonb) FROM(SELECT DISTINCT sd.source_document_id,sd.payload_hash FROM source_link sl JOIN source_document sd ON sd.tenant_id=sl.tenant_id AND sd.entity_id=sl.entity_id AND sd.source_document_id=sl.source_document_id WHERE sl.tenant_id=j.tenant_id AND sl.entity_id=j.entity_id AND sl.journal_entry_id=j.journal_entry_id AND sl.source_document_id IS NOT NULL)d),
      'lines',(SELECT coalesce(jsonb_agg(jsonb_build_object('journal_entry_line_id',jl.journal_line_id,'account_code',jl.account_code,'debit_amount',to_char(jl.debit_amount,'FM9999999999999990.0000'),'credit_amount',to_char(jl.credit_amount,'FM9999999999999990.0000')) ORDER BY jl.line_no),'[]'::jsonb) FROM journal_line jl WHERE jl.tenant_id=j.tenant_id AND jl.entity_id=j.entity_id AND jl.period_id=j.period_id AND jl.journal_entry_id=j.journal_entry_id)
    )payload
    FROM journal_entry j WHERE j.tenant_id=p_tenant AND j.entity_id=p_entity AND j.period_id=p_period AND j.journal_type='MANUAL' ORDER BY j.journal_date,j.journal_entry_id LIMIT p_limit
  )x;
  RETURN result;
END;$$;

REVOKE ALL ON FUNCTION refs_read_ai_manual_journal_risk_policy(uuid,uuid,uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION refs_read_ai_manual_journal_risk_inputs(uuid,uuid,uuid,integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION refs_read_ai_manual_journal_risk_policy(uuid,uuid,uuid) TO refs_app;
GRANT EXECUTE ON FUNCTION refs_read_ai_manual_journal_risk_inputs(uuid,uuid,uuid,integer) TO refs_app;
COMMIT;
