BEGIN;
CREATE FUNCTION refs_read_ai_construction_loan_project_cost_source(p_tenant uuid,p_entity uuid,p_period uuid)
RETURNS TABLE(tenant_id uuid,entity_id uuid,accounting_period_id uuid,project_ref text,period_draws text,cwip_net_additions text,loan_account_codes text[],cwip_account_codes text[],loan_draw_mapping_snapshot_hashes text[],cwip_mapping_snapshot_hashes text[],loan_draw_journal_entry_ids uuid[],loan_draw_ledger_line_ids uuid[],loan_draw_source_document_ids uuid[],cwip_journal_entry_ids uuid[],cwip_ledger_line_ids uuid[],cwip_source_document_ids uuid[])
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
BEGIN
  PERFORM refs_assert_ai_analysis_scope(p_tenant,p_entity);
  IF NOT EXISTS(SELECT 1 FROM accounting_period WHERE tenant_id=p_tenant AND entity_id=p_entity AND period_id=p_period) THEN RAISE EXCEPTION 'Accounting period is outside project loan-cost scope' USING ERRCODE='22023';END IF;
  RETURN QUERY WITH p AS(SELECT starts_on,ends_on FROM accounting_period WHERE tenant_id=p_tenant AND entity_id=p_entity AND period_id=p_period),eligible AS(
    SELECT m.*,max(priority)OVER(PARTITION BY family,input_keys->>'account_code') max_priority FROM mapping_snapshot m CROSS JOIN p
    WHERE m.tenant_id=p_tenant AND m.entity_id=p_entity AND m.family IN('CONSTRUCTION_LOAN_ACCOUNT_CLASSIFICATION','CWIP_ACCOUNT_CLASSIFICATION') AND m.status IN('APPROVED','RETIRED') AND m.input_keys?'account_code' AND m.effective_from::date<=p.ends_on AND(m.effective_to IS NULL OR m.effective_to::date>p.ends_on)
  ),mapped AS(
    SELECT family,input_keys->>'account_code' account_code,(array_agg(snapshot_hash ORDER BY mapping_snapshot_id))[1] mapping_hash,(array_agg(output_rules->>'classification' ORDER BY mapping_snapshot_id))[1] classification
    FROM eligible WHERE priority=max_priority GROUP BY family,input_keys->>'account_code' HAVING count(*)=1 AND ((family='CONSTRUCTION_LOAN_ACCOUNT_CLASSIFICATION' AND (array_agg(output_rules->>'classification'))[1]='CONSTRUCTION_LOAN') OR(family='CWIP_ACCOUNT_CLASSIFICATION' AND (array_agg(output_rules->>'classification'))[1]='CWIP'))
  ),movements AS(
    SELECT NULLIF(btrim(l.dimensions->>'project_ref'),'') project_ref,m.family,m.account_code,m.mapping_hash,l.journal_entry_id,l.ledger_line_id,
      CASE WHEN m.family='CONSTRUCTION_LOAN_ACCOUNT_CLASSIFICATION' THEN l.credit_amount ELSE 0 END draw_amount,
      CASE WHEN m.family='CWIP_ACCOUNT_CLASSIFICATION' THEN l.debit_amount-l.credit_amount ELSE 0 END cwip_amount
    FROM ledger_line l JOIN journal_entry j ON j.tenant_id=l.tenant_id AND j.entity_id=l.entity_id AND j.journal_entry_id=l.journal_entry_id JOIN mapped m ON m.account_code=l.account_code CROSS JOIN p
    WHERE l.tenant_id=p_tenant AND l.entity_id=p_entity AND j.status='POSTED' AND j.journal_date BETWEEN p.starts_on AND p.ends_on
  ),groups AS(
    SELECT project_ref,sum(draw_amount)::numeric(20,4) draws,sum(cwip_amount)::numeric(20,4) cwip,
      COALESCE(array_agg(DISTINCT account_code ORDER BY account_code)FILTER(WHERE family='CONSTRUCTION_LOAN_ACCOUNT_CLASSIFICATION'),ARRAY[]::text[]) loan_accounts,
      COALESCE(array_agg(DISTINCT account_code ORDER BY account_code)FILTER(WHERE family='CWIP_ACCOUNT_CLASSIFICATION'),ARRAY[]::text[]) cwip_accounts,
      COALESCE(array_agg(DISTINCT mapping_hash ORDER BY mapping_hash)FILTER(WHERE family='CONSTRUCTION_LOAN_ACCOUNT_CLASSIFICATION'),ARRAY[]::text[]) loan_hashes,
      COALESCE(array_agg(DISTINCT mapping_hash ORDER BY mapping_hash)FILTER(WHERE family='CWIP_ACCOUNT_CLASSIFICATION'),ARRAY[]::text[]) cwip_hashes,
      COALESCE(array_agg(DISTINCT journal_entry_id ORDER BY journal_entry_id)FILTER(WHERE family='CONSTRUCTION_LOAN_ACCOUNT_CLASSIFICATION' AND draw_amount<>0),ARRAY[]::uuid[]) loan_jes,
      COALESCE(array_agg(DISTINCT ledger_line_id ORDER BY ledger_line_id)FILTER(WHERE family='CONSTRUCTION_LOAN_ACCOUNT_CLASSIFICATION' AND draw_amount<>0),ARRAY[]::uuid[]) loan_ledger,
      COALESCE(array_agg(DISTINCT journal_entry_id ORDER BY journal_entry_id)FILTER(WHERE family='CWIP_ACCOUNT_CLASSIFICATION' AND cwip_amount<>0),ARRAY[]::uuid[]) cwip_jes,
      COALESCE(array_agg(DISTINCT ledger_line_id ORDER BY ledger_line_id)FILTER(WHERE family='CWIP_ACCOUNT_CLASSIFICATION' AND cwip_amount<>0),ARRAY[]::uuid[]) cwip_ledger
    FROM movements GROUP BY project_ref HAVING sum(draw_amount)<>0 OR sum(cwip_amount)<>0
  ) SELECT p_tenant,p_entity,p_period,g.project_ref,to_char(g.draws,'FM999999999999990.0000'),to_char(g.cwip,'FM999999999999990.0000'),g.loan_accounts,g.cwip_accounts,g.loan_hashes,g.cwip_hashes,g.loan_jes,g.loan_ledger,
    ARRAY(SELECT DISTINCT s.source_document_id FROM source_link s WHERE s.tenant_id=p_tenant AND s.entity_id=p_entity AND s.source_document_id IS NOT NULL AND s.journal_entry_id=ANY(g.loan_jes) ORDER BY s.source_document_id)::uuid[],g.cwip_jes,g.cwip_ledger,
    ARRAY(SELECT DISTINCT s.source_document_id FROM source_link s WHERE s.tenant_id=p_tenant AND s.entity_id=p_entity AND s.source_document_id IS NOT NULL AND s.journal_entry_id=ANY(g.cwip_jes) ORDER BY s.source_document_id)::uuid[]
  FROM groups g ORDER BY g.project_ref NULLS FIRST;
END;$$;
REVOKE ALL ON FUNCTION refs_read_ai_construction_loan_project_cost_source(uuid,uuid,uuid) FROM PUBLIC;GRANT EXECUTE ON FUNCTION refs_read_ai_construction_loan_project_cost_source(uuid,uuid,uuid) TO refs_app;
COMMIT;
