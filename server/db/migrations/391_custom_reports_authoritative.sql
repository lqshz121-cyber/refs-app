BEGIN;

-- The renderer is deliberately a fixed, read-only projection.  There is no
-- user SQL, expression language, dynamic relation, export, journal, or posting
-- surface in this migration.  Every path below starts from POSTED journal/ledger
-- rows; budget rows additionally require an already approved immutable snapshot.
INSERT INTO permission_catalog(permission_code,domain,risk_class,sod_class) VALUES
 ('REPORT.CUSTOM.VIEW','REPORTING','LOW','READ')
ON CONFLICT(permission_code) DO UPDATE SET active=true,domain=EXCLUDED.domain,risk_class=EXCLUDED.risk_class,sod_class=EXCLUDED.sod_class,version=permission_catalog.version+1,effective_to=NULL;
INSERT INTO runtime_human_permission_authority(permission_code,authority_class) VALUES
 ('REPORT.CUSTOM.VIEW','READ')
ON CONFLICT(permission_code) DO UPDATE SET authority_class=EXCLUDED.authority_class;

-- 386 owns saved-report-view evidence.  This migration extends its finite
-- report-type enum only after 386 has created the table.  The view still stores
-- no executable query: the only accepted filter shape is validated below.
ALTER TABLE report_saved_view DROP CONSTRAINT report_saved_view_report_type_check;
ALTER TABLE report_saved_view ADD CONSTRAINT report_saved_view_report_type_check CHECK(report_type IN('FINANCIAL_STATEMENTS','GENERAL_LEDGER','TRIAL_BALANCE','BALANCE_SHEET','INCOME_STATEMENT','CASH_FLOW','AP_AGING','AR_AGING','BUDGET_VS_ACTUAL','CWIP_ROLLFORWARD','PROJECT_COST','UNIT_COST_LEDGER','DIMENSION_PNL'));
ALTER TABLE report_saved_view_history DROP CONSTRAINT report_saved_view_history_action_check;
ALTER TABLE report_saved_view_history ADD CONSTRAINT report_saved_view_history_action_check CHECK(action IN('CREATE','UPDATE'));

CREATE OR REPLACE FUNCTION refs_validate_report_saved_view(p_tenant uuid,p_entity uuid,p_name text,p_report_type text,p_period uuid,p_filters jsonb,p_visibility text) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE dimension_type text; dimension_ref text;
BEGIN
 IF p_name IS NULL OR p_name<>btrim(p_name) OR length(p_name) NOT BETWEEN 1 AND 160 OR p_report_type NOT IN('FINANCIAL_STATEMENTS','GENERAL_LEDGER','TRIAL_BALANCE','BALANCE_SHEET','INCOME_STATEMENT','CASH_FLOW','AP_AGING','AR_AGING','BUDGET_VS_ACTUAL','CWIP_ROLLFORWARD','PROJECT_COST','UNIT_COST_LEDGER','DIMENSION_PNL') OR p_visibility NOT IN('PRIVATE','ENTITY_SHARED') OR jsonb_typeof(p_filters)<>'object' OR jsonb_object_length(p_filters)>30 OR NOT EXISTS(SELECT 1 FROM accounting_period WHERE tenant_id=p_tenant AND entity_id=p_entity AND period_id=p_period) THEN RAISE EXCEPTION 'Invalid report saved view' USING ERRCODE='22023'; END IF;
 IF p_report_type='DIMENSION_PNL' THEN
   IF ARRAY(SELECT jsonb_object_keys(p_filters) ORDER BY 1)<>ARRAY['dimensionRef','dimensionType'] THEN RAISE EXCEPTION 'Dimension P&L saved view has an invalid fixed filter shape' USING ERRCODE='22023'; END IF;
   dimension_type:=p_filters->>'dimensionType';dimension_ref:=p_filters->>'dimensionRef';
   IF dimension_type NOT IN('PROPERTY','PROJECT','UNIT') OR dimension_ref IS NULL OR dimension_ref<>btrim(dimension_ref) OR length(dimension_ref) NOT BETWEEN 1 AND 160 OR dimension_ref~'[[:cntrl:]]' THEN RAISE EXCEPTION 'Dimension P&L saved view requires one exact dimension' USING ERRCODE='22023'; END IF;
 ELSIF p_filters ? 'dimensionType' OR p_filters ? 'dimensionRef' THEN
   RAISE EXCEPTION 'Only DIMENSION_PNL saved views may carry dimension filters' USING ERRCODE='22023';
 END IF;
END;$$;

CREATE INDEX ledger_line_custom_report_scope_idx ON ledger_line(tenant_id,entity_id,period_id,account_code,journal_entry_id);

CREATE FUNCTION refs_read_custom_report(
 p_tenant uuid,p_entity uuid,p_period uuid,p_report_type text,
 p_dimension_type text,p_dimension_ref text,p_limit integer,p_after_account_code text
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE p accounting_period; dimension_key text; rows jsonb; evidence_hash text; snapshot_hash text:=NULL; source text;
BEGIN
 PERFORM refs_assert_scope(p_tenant,p_entity,'REPORT.CUSTOM.VIEW');
 IF p_report_type NOT IN('TRIAL_BALANCE','BALANCE_SHEET','INCOME_STATEMENT','CASH_FLOW','BUDGET_VS_ACTUAL','DIMENSION_PNL') OR p_limit NOT BETWEEN 1 AND 200 OR (p_after_account_code IS NOT NULL AND(p_after_account_code<>btrim(p_after_account_code) OR p_after_account_code!~'^[A-Za-z0-9._-]{1,64}$')) OR ((p_dimension_type IS NULL)<>(p_dimension_ref IS NULL)) OR(p_dimension_type IS NOT NULL AND(p_dimension_type NOT IN('PROPERTY','PROJECT','UNIT') OR p_dimension_ref<>btrim(p_dimension_ref) OR length(p_dimension_ref) NOT BETWEEN 1 AND 160 OR p_dimension_ref~'[[:cntrl:]]')) OR ((p_report_type='DIMENSION_PNL')<>(p_dimension_type IS NOT NULL)) THEN RAISE EXCEPTION 'Custom report request is outside its fixed allowlist' USING ERRCODE='22023'; END IF;
 SELECT * INTO p FROM accounting_period WHERE tenant_id=p_tenant AND entity_id=p_entity AND period_id=p_period; IF NOT FOUND THEN RAISE EXCEPTION 'Entity period was not found' USING ERRCODE='22023'; END IF;
 dimension_key:=CASE p_dimension_type WHEN 'PROPERTY' THEN 'property_ref' WHEN 'PROJECT' THEN 'project_ref' WHEN 'UNIT' THEN 'unit_ref' ELSE NULL END;
 IF p_report_type='BUDGET_VS_ACTUAL' THEN
  SELECT bs.snapshot_hash INTO snapshot_hash FROM budget_snapshot bs WHERE bs.tenant_id=p_tenant AND bs.entity_id=p_entity AND bs.period_id=p_period AND bs.approved_by IS NOT NULL ORDER BY bs.version DESC,bs.budget_snapshot_id DESC LIMIT 1;
  IF snapshot_hash IS NULL THEN RAISE EXCEPTION 'Custom budget report requires an approved budget snapshot' USING ERRCODE='23514'; END IF;
 END IF;
 SELECT refs_jsonb_hash(jsonb_build_object('period_id',p_period,'report_type',p_report_type,'dimension_type',p_dimension_type,'dimension_ref',p_dimension_ref,'ledger_line_ids',coalesce(to_jsonb(array_agg(l.ledger_line_id ORDER BY l.ledger_line_id)),'[]'::jsonb))) INTO evidence_hash
 FROM ledger_line l JOIN journal_entry j ON j.tenant_id=l.tenant_id AND j.entity_id=l.entity_id AND j.journal_entry_id=l.journal_entry_id
 WHERE l.tenant_id=p_tenant AND l.entity_id=p_entity AND l.period_id=p_period AND j.status='POSTED' AND (dimension_key IS NULL OR l.dimensions @> jsonb_build_object(dimension_key,p_dimension_ref));
 source:=CASE WHEN p_report_type='BUDGET_VS_ACTUAL' THEN 'APPROVED_BUDGET_SNAPSHOT_AND_POSTED_LEDGER' ELSE 'POSTED_LEDGER' END;
 WITH posted AS (
  SELECT l.ledger_line_id,l.journal_entry_id,l.journal_line_id,l.account_code,l.debit_amount,l.credit_amount FROM ledger_line l JOIN journal_entry j ON j.tenant_id=l.tenant_id AND j.entity_id=l.entity_id AND j.journal_entry_id=l.journal_entry_id
  WHERE l.tenant_id=p_tenant AND l.entity_id=p_entity AND l.period_id=p_period AND j.status='POSTED' AND (dimension_key IS NULL OR l.dimensions @> jsonb_build_object(dimension_key,p_dimension_ref))
 ), budget AS (
  SELECT bl.account_code,bl.comparison_side,bl.budget_amount FROM budget_snapshot bs JOIN budget_line bl ON bl.budget_snapshot_id=bs.budget_snapshot_id AND bl.tenant_id=bs.tenant_id AND bl.entity_id=bs.entity_id AND bl.period_id=bs.period_id
  WHERE p_report_type='BUDGET_VS_ACTUAL' AND bs.tenant_id=p_tenant AND bs.entity_id=p_entity AND bs.period_id=p_period AND bs.snapshot_hash=snapshot_hash
 ), grouped AS (
  SELECT coalesce(b.account_code,x.account_code) account_code,coalesce(a.account_name,'Unmapped account') account_name,
    CASE WHEN p_report_type='TRIAL_BALANCE' THEN 'ALL_ACCOUNTS' WHEN p_report_type='BALANCE_SHEET' THEN CASE WHEN coalesce(b.account_code,x.account_code) LIKE '1%' THEN 'ASSETS' WHEN coalesce(b.account_code,x.account_code) LIKE '2%' THEN 'LIABILITIES' WHEN coalesce(b.account_code,x.account_code) LIKE '3%' THEN 'EQUITY' ELSE 'CURRENT_EARNINGS' END WHEN p_report_type IN('INCOME_STATEMENT','DIMENSION_PNL') THEN CASE WHEN coalesce(b.account_code,x.account_code) LIKE '4%' THEN 'REVENUE' ELSE 'EXPENSES' END WHEN p_report_type='CASH_FLOW' THEN 'DIRECT_CASH_MOVEMENT' ELSE 'BUDGET_VS_ACTUAL' END section,
    coalesce(sum(x.debit_amount),0)::numeric(20,4) debit,coalesce(sum(x.credit_amount),0)::numeric(20,4) credit,max(b.budget_amount)::numeric(20,4) budget_amount,max(b.comparison_side) comparison_side,
    coalesce(array_agg(DISTINCT x.journal_entry_id ORDER BY x.journal_entry_id) FILTER(WHERE x.ledger_line_id IS NOT NULL),ARRAY[]::uuid[]) jes,coalesce(array_agg(DISTINCT x.journal_line_id ORDER BY x.journal_line_id) FILTER(WHERE x.ledger_line_id IS NOT NULL),ARRAY[]::uuid[]) jls,coalesce(array_agg(DISTINCT x.ledger_line_id ORDER BY x.ledger_line_id) FILTER(WHERE x.ledger_line_id IS NOT NULL),ARRAY[]::uuid[]) lls
  FROM posted x FULL JOIN budget b ON b.account_code=x.account_code LEFT JOIN account_master a ON a.tenant_id=p_tenant AND a.entity_id=p_entity AND a.account_code=coalesce(b.account_code,x.account_code) AND a.active
  GROUP BY coalesce(b.account_code,x.account_code),a.account_name
 ), eligible AS (
  SELECT g.*,CASE WHEN p_report_type='TRIAL_BALANCE' THEN g.debit-g.credit WHEN p_report_type='BALANCE_SHEET' THEN CASE WHEN g.account_code LIKE '1%' THEN g.debit-g.credit ELSE g.credit-g.debit END WHEN p_report_type IN('INCOME_STATEMENT','DIMENSION_PNL') THEN CASE WHEN g.account_code LIKE '4%' THEN g.credit-g.debit ELSE g.debit-g.credit END WHEN p_report_type='CASH_FLOW' THEN g.debit-g.credit ELSE NULL END::numeric(20,4) display_amount,
   CASE WHEN p_report_type='BUDGET_VS_ACTUAL' THEN CASE g.comparison_side WHEN 'DEBIT' THEN g.debit-g.credit ELSE g.credit-g.debit END::numeric(20,4) ELSE NULL END actual_amount
  FROM grouped g WHERE (p_report_type NOT IN('INCOME_STATEMENT','DIMENSION_PNL') OR g.account_code LIKE '4%' OR g.account_code~'^[5-9]') AND (p_report_type<>'CASH_FLOW' OR EXISTS(SELECT 1 FROM ledger_line l WHERE l.tenant_id=p_tenant AND l.entity_id=p_entity AND l.period_id=p_period AND l.account_code=g.account_code AND l.member_ref IS NOT NULL))
 ), page AS (SELECT * FROM eligible WHERE p_after_account_code IS NULL OR account_code>p_after_account_code ORDER BY account_code LIMIT p_limit)
 SELECT coalesce(jsonb_agg(jsonb_build_object('account_code',g.account_code,'account_name',g.account_name,'statement_section',g.section,'display_balance',CASE WHEN p_report_type='BUDGET_VS_ACTUAL' THEN NULL ELSE to_char(g.display_amount,'FM999999999999990.0000') END,'budget_amount',CASE WHEN p_report_type='BUDGET_VS_ACTUAL' THEN to_char(g.budget_amount,'FM999999999999990.0000') ELSE NULL END,'actual_amount',CASE WHEN p_report_type='BUDGET_VS_ACTUAL' THEN to_char(g.actual_amount,'FM999999999999990.0000') ELSE NULL END,'variance_amount',CASE WHEN p_report_type='BUDGET_VS_ACTUAL' THEN to_char(g.budget_amount-g.actual_amount,'FM999999999999990.0000') ELSE NULL END,'journal_entry_ids',g.jes,'journal_line_ids',g.jls,'ledger_line_ids',g.lls,'source_document_ids',ARRAY(SELECT DISTINCT sl.source_document_id FROM source_link sl WHERE sl.tenant_id=p_tenant AND sl.entity_id=p_entity AND sl.source_document_id IS NOT NULL AND sl.journal_entry_id=ANY(g.jes) ORDER BY sl.source_document_id),'row_hash',refs_jsonb_hash(jsonb_build_object('report_type',p_report_type,'account_code',g.account_code,'display_balance',g.display_amount,'budget_amount',g.budget_amount,'actual_amount',g.actual_amount,'journal_entry_ids',g.jes,'journal_line_ids',g.jls,'ledger_line_ids',g.lls))) ORDER BY g.account_code),'[]'::jsonb) INTO rows FROM page g;
 RETURN jsonb_build_object('schema_version','CUSTOM_REPORT_V1','report_type',p_report_type,'tenant_id',p_tenant,'entity_id',p_entity,'period_id',p_period,'dimension_type',p_dimension_type,'dimension_ref',p_dimension_ref,'limit',p_limit,'after_account_code',p_after_account_code,'next_after_account_code',CASE WHEN jsonb_array_length(rows)=p_limit THEN rows->(p_limit-1)->>'account_code' ELSE NULL END,'population_source',source,'approved_snapshot_hash',snapshot_hash,'ledger_evidence_hash',evidence_hash,'rows',rows,'action_flags',jsonb_build_object('can_create_draft',false,'can_review',false,'can_approve',false,'can_post',false));
END;$$;

REVOKE ALL ON FUNCTION refs_read_custom_report(uuid,uuid,uuid,text,text,text,integer,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION refs_read_custom_report(uuid,uuid,uuid,text,text,text,integer,text) TO refs_app;
COMMIT;
