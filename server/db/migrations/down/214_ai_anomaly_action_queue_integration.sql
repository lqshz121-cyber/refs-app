BEGIN;

DO $$ DECLARE definition text; BEGIN
  IF EXISTS(SELECT 1 FROM ai_finding_action WHERE finding_kind IN ('BANK_DUPLICATE_PAYMENT','VENDOR_INVOICE_AMOUNT_SPIKE','VENDOR_INVOICE_FREQUENCY_SPIKE','VENDOR_INVOICE_AMOUNT_DROP','VENDOR_INVOICE_NEAR_DUPLICATE','MANUAL_JOURNAL_RISK')) THEN RAISE EXCEPTION 'Cannot roll back AI anomaly action queue integration while retained actions exist'; END IF;
  SELECT pg_get_functiondef('refs_assign_ai_finding_action(uuid,uuid,text,uuid,text,text,date,integer,text,text)'::regprocedure) INTO definition;
  definition:=replace(definition,
    'WHEN ''UNMATCHED_BANK_PAYMENT'' THEN SELECT finding_hash INTO actual_hash FROM ai_unmatched_bank_payment_finding WHERE tenant_id=p_tenant AND entity_id=p_entity AND ai_unmatched_bank_payment_finding_id=p_finding;
    WHEN ''BANK_DUPLICATE_PAYMENT'' THEN SELECT finding_hash INTO actual_hash FROM ai_bank_duplicate_payment_finding WHERE tenant_id=p_tenant AND entity_id=p_entity AND ai_bank_duplicate_payment_finding_id=p_finding AND status=''OPEN'';
    WHEN ''VENDOR_INVOICE_AMOUNT_SPIKE'' THEN SELECT finding_hash INTO actual_hash FROM ai_vendor_invoice_amount_anomaly_finding WHERE tenant_id=p_tenant AND entity_id=p_entity AND ai_vendor_invoice_amount_anomaly_finding_id=p_finding AND status=''OPEN'';
    WHEN ''VENDOR_INVOICE_FREQUENCY_SPIKE'' THEN SELECT finding_hash INTO actual_hash FROM ai_vendor_invoice_frequency_anomaly_finding WHERE tenant_id=p_tenant AND entity_id=p_entity AND ai_vendor_invoice_frequency_anomaly_finding_id=p_finding AND status=''OPEN'';
    WHEN ''VENDOR_INVOICE_AMOUNT_DROP'' THEN SELECT finding_hash INTO actual_hash FROM ai_vendor_invoice_amount_drop_finding WHERE tenant_id=p_tenant AND entity_id=p_entity AND ai_vendor_invoice_amount_drop_finding_id=p_finding AND status=''OPEN'';
    WHEN ''VENDOR_INVOICE_NEAR_DUPLICATE'' THEN SELECT finding_hash INTO actual_hash FROM ai_vendor_invoice_near_duplicate_finding WHERE tenant_id=p_tenant AND entity_id=p_entity AND ai_vendor_invoice_near_duplicate_finding_id=p_finding AND status=''OPEN'';
    WHEN ''MANUAL_JOURNAL_RISK'' THEN SELECT finding_hash INTO actual_hash FROM ai_manual_journal_risk_finding WHERE tenant_id=p_tenant AND entity_id=p_entity AND ai_manual_journal_risk_finding_id=p_finding AND status=''OPEN'';',
    'WHEN ''UNMATCHED_BANK_PAYMENT'' THEN SELECT finding_hash INTO actual_hash FROM ai_unmatched_bank_payment_finding WHERE tenant_id=p_tenant AND entity_id=p_entity AND ai_unmatched_bank_payment_finding_id=p_finding;');
  IF position('VENDOR_INVOICE_AMOUNT_SPIKE' IN definition)>0 OR position('VENDOR_INVOICE_FREQUENCY_SPIKE' IN definition)>0 OR position('VENDOR_INVOICE_AMOUNT_DROP' IN definition)>0 OR position('VENDOR_INVOICE_NEAR_DUPLICATE' IN definition)>0 OR position('MANUAL_JOURNAL_RISK' IN definition)>0 OR position('BANK_DUPLICATE_PAYMENT' IN definition)>0 THEN RAISE EXCEPTION 'AI anomaly assignment rollback failed'; END IF;
  EXECUTE definition;
  SELECT pg_get_functiondef('refs_read_ai_finding_assignment_candidates(uuid,uuid,integer)'::regprocedure) INTO definition;
  definition:=replace(definition,
    'UNION ALL SELECT ''BANK_DUPLICATE_PAYMENT'',f.ai_bank_duplicate_payment_finding_id,f.finding_hash,f.finding->>''rule_id'',f.finding->>''risk_level'',f.finding->>''reason'',f.finding->>''suggested_action'',f.finding->>''owner_role'',f.created_at,false,false,false,false FROM ai_bank_duplicate_payment_finding f WHERE f.tenant_id=p_tenant AND f.entity_id=p_entity AND f.status=''OPEN''
    UNION ALL SELECT ''VENDOR_INVOICE_AMOUNT_SPIKE'',f.ai_vendor_invoice_amount_anomaly_finding_id,f.finding_hash,f.finding->>''rule_id'',f.finding->>''risk_level'',f.finding->>''reason'',f.finding->>''suggested_action'',f.finding->>''owner_role'',f.created_at,false,false,false,false FROM ai_vendor_invoice_amount_anomaly_finding f WHERE f.tenant_id=p_tenant AND f.entity_id=p_entity AND f.status=''OPEN''
    UNION ALL SELECT ''VENDOR_INVOICE_FREQUENCY_SPIKE'',f.ai_vendor_invoice_frequency_anomaly_finding_id,f.finding_hash,f.finding->>''rule_id'',f.finding->>''risk_level'',f.finding->>''reason'',f.finding->>''suggested_action'',f.finding->>''owner_role'',f.created_at,false,false,false,false FROM ai_vendor_invoice_frequency_anomaly_finding f WHERE f.tenant_id=p_tenant AND f.entity_id=p_entity AND f.status=''OPEN''
    UNION ALL SELECT ''VENDOR_INVOICE_AMOUNT_DROP'',f.ai_vendor_invoice_amount_drop_finding_id,f.finding_hash,f.finding->>''rule_id'',f.finding->>''risk_level'',f.finding->>''reason'',f.finding->>''suggested_action'',f.finding->>''owner_role'',f.created_at,false,false,false,false FROM ai_vendor_invoice_amount_drop_finding f WHERE f.tenant_id=p_tenant AND f.entity_id=p_entity AND f.status=''OPEN''
    UNION ALL SELECT ''VENDOR_INVOICE_NEAR_DUPLICATE'',f.ai_vendor_invoice_near_duplicate_finding_id,f.finding_hash,f.finding->>''rule_id'',f.finding->>''risk_level'',f.finding->>''reason'',f.finding->>''suggested_action'',f.finding->>''owner_role'',f.created_at,false,false,false,false FROM ai_vendor_invoice_near_duplicate_finding f WHERE f.tenant_id=p_tenant AND f.entity_id=p_entity AND f.status=''OPEN''
    UNION ALL SELECT ''MANUAL_JOURNAL_RISK'',f.ai_manual_journal_risk_finding_id,f.finding_hash,coalesce(f.finding->''rule_ids''->>0,''AI_MANUAL_JOURNAL_RISK''),f.finding->>''risk_level'',f.finding->>''reason'',f.finding->>''suggested_action'',f.finding->>''owner_role'',f.created_at,false,false,false,false FROM ai_manual_journal_risk_finding f WHERE f.tenant_id=p_tenant AND f.entity_id=p_entity AND f.status=''OPEN''
    UNION ALL SELECT ''COST_DIMENSION'',f.ai_cost_dimension_finding_id',
    'UNION ALL SELECT ''COST_DIMENSION'',f.ai_cost_dimension_finding_id');
  IF position('VENDOR_INVOICE_AMOUNT_SPIKE' IN definition)>0 OR position('VENDOR_INVOICE_FREQUENCY_SPIKE' IN definition)>0 OR position('VENDOR_INVOICE_AMOUNT_DROP' IN definition)>0 OR position('VENDOR_INVOICE_NEAR_DUPLICATE' IN definition)>0 OR position('MANUAL_JOURNAL_RISK' IN definition)>0 OR position('BANK_DUPLICATE_PAYMENT' IN definition)>0 THEN RAISE EXCEPTION 'AI anomaly assignment candidate rollback failed'; END IF;
  EXECUTE definition;
END $$;

ALTER TABLE ai_finding_action DROP CONSTRAINT ai_finding_action_finding_kind_check;
ALTER TABLE ai_finding_action ADD CONSTRAINT ai_finding_action_finding_kind_check CHECK(finding_kind IN ('WBS_EXCEPTION','PREPAID_COVERAGE','DUPLICATE_PAYABLE','UNMATCHED_BANK_PAYMENT','COST_DIMENSION','LOAN_REFERENCE'));
COMMIT;
