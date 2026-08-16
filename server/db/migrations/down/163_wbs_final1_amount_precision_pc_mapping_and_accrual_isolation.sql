BEGIN;
DO $$
DECLARE definition text;
BEGIN
  IF EXISTS(SELECT 1 FROM wbs_insurance_pc_company_mapping_decision)
     OR EXISTS(SELECT 1 FROM source_document_line WHERE external_dimension_refs ? 'insurance_pc_mapping_id') THEN
    RAISE EXCEPTION 'Cannot remove Final-1 PC mapping decision or trace while retained mapping evidence exists' USING ERRCODE='55000';
  END IF;
  IF EXISTS(SELECT 1 FROM source_document WHERE abs(gross_amount)>=10000000000000000::numeric)
     OR EXISTS(SELECT 1 FROM source_document_line WHERE abs(amount)>=10000000000000000::numeric) THEN
    RAISE EXCEPTION 'Cannot narrow Final-1 retained amount precision while wide evidence exists' USING ERRCODE='55000';
  END IF;
  SELECT pg_get_functiondef(
    'public.refs_retain_wbs_final1_source_evidence(uuid,uuid,jsonb,jsonb,jsonb,text,text)'::regprocedure
  ) INTO definition;
  IF position('Insurance PC/company mapping is missing or ambiguous' IN definition)=0 THEN
    RAISE EXCEPTION 'Cannot remove Final-1 PC mapping guard from an unexpected function definition' USING ERRCODE='55000';
  END IF;
  IF position('DECLARE actor text:=refs_current_actor(); idem idempotency_receipt; entity_record entity; approved_mapping record; pc_mapping wbs_insurance_pc_company_mapping_decision%ROWTYPE; pc_mapping_id uuid; pc_mapping_count integer:=0;' IN definition)=0 THEN RAISE EXCEPTION 'Cannot remove unexpected Final-1 mapping declaration' USING ERRCODE='55000'; END IF;
  IF position('''insurance_pc_mapping_effective_from'',CASE WHEN domain=''INSURANCE'' AND pc_mapping_count=1 THEN to_char(pc_mapping.effective_from,''YYYY-MM-DD'') ELSE NULL END' IN definition)=0 THEN
    RAISE EXCEPTION 'Cannot remove unexpected Final-1 insurance effective-window trace' USING ERRCODE='55000';
  END IF;
  definition:=replace(definition,
    '''insurance_pc_mapping_id'',CASE WHEN domain=''INSURANCE'' AND pc_mapping_count=1 THEN pc_mapping.wbs_insurance_pc_company_mapping_decision_id ELSE NULL END,''insurance_pc_mapping_hash'',CASE WHEN domain=''INSURANCE'' AND pc_mapping_count=1 THEN pc_mapping.company_mapping_hash ELSE NULL END,''insurance_pc_mapping_match_count'',CASE WHEN domain=''INSURANCE'' THEN pc_mapping_count ELSE NULL END,''insurance_pc_mapping_approved'',CASE WHEN domain=''INSURANCE'' THEN pc_mapping_count=1 ELSE NULL END,''insurance_pc_mapping_effective_from'',CASE WHEN domain=''INSURANCE'' AND pc_mapping_count=1 THEN to_char(pc_mapping.effective_from,''YYYY-MM-DD'') ELSE NULL END,''insurance_pc_mapping_effective_to'',CASE WHEN domain=''INSURANCE'' AND pc_mapping_count=1 THEN to_char(pc_mapping.effective_to,''YYYY-MM-DD'') ELSE NULL END,''insurance_pc_mapping_resolved_entity_id''',
    '''insurance_pc_mapping_id'',CASE WHEN domain=''INSURANCE'' THEN pc_mapping.wbs_insurance_pc_company_mapping_decision_id ELSE NULL END,''insurance_pc_mapping_hash'',CASE WHEN domain=''INSURANCE'' THEN pc_mapping.company_mapping_hash ELSE NULL END,''insurance_pc_mapping_match_count'',CASE WHEN domain=''INSURANCE'' THEN pc_mapping_count ELSE NULL END,''insurance_pc_mapping_approved'',CASE WHEN domain=''INSURANCE'' THEN pc_mapping_count=1 ELSE NULL END,''insurance_pc_mapping_resolved_entity_id''');
  IF position('''insurance_source_pc_code'',CASE WHEN domain=''INSURANCE'' THEN normalized->>''pcCode'' ELSE NULL END' IN definition)=0 THEN
    RAISE EXCEPTION 'Cannot remove unexpected Final-1 insurance source pc trace' USING ERRCODE='55000';
  END IF;
  definition:=replace(definition,
    '''signed_insurance_row_company_code'',CASE WHEN domain=''INSURANCE'' THEN row_value#>>''{raw_row,company_code}'' ELSE NULL END,''insurance_source_pc_code'',CASE WHEN domain=''INSURANCE'' THEN normalized->>''pcCode'' ELSE NULL END,''signed_company_mapping_hash''',
    '''signed_insurance_row_company_code'',CASE WHEN domain=''INSURANCE'' THEN row_value#>>''{raw_row,company_code}'' ELSE NULL END,''signed_company_mapping_hash''');
  definition:=replace(definition,'DECLARE actor text:=refs_current_actor(); idem idempotency_receipt; entity_record entity; approved_mapping record; pc_mapping wbs_insurance_pc_company_mapping_decision%ROWTYPE; pc_mapping_id uuid; pc_mapping_count integer:=0;','DECLARE actor text:=refs_current_actor(); idem idempotency_receipt; entity_record entity; approved_mapping record;');
  definition:=replace(definition,
    '''signed_business_id'',normalized->>''businessId'',''signed_invoice_no'',normalized->>''invoiceNo'',''signed_invoice_date'',normalized->>''invoiceDate'',''signed_insurance_row_company_code'',CASE WHEN domain=''INSURANCE'' THEN row_value#>>''{raw_row,company_code}'' ELSE NULL END,''signed_company_mapping_hash'',CASE WHEN domain=''INSURANCE'' THEN row_value->>''company_mapping_hash'' ELSE NULL END,''signed_company_mapping_authority'',CASE WHEN domain=''INSURANCE'' THEN CASE WHEN pc_mapping_count=1 THEN ''CONTROLLER_APPROVED'' ELSE ''UNRESOLVED_PENDING_SERVER_DECISION'' END ELSE NULL END,''insurance_pc_mapping_id'',CASE WHEN domain=''INSURANCE'' THEN pc_mapping.wbs_insurance_pc_company_mapping_decision_id ELSE NULL END,''insurance_pc_mapping_hash'',CASE WHEN domain=''INSURANCE'' THEN pc_mapping.company_mapping_hash ELSE NULL END,''insurance_pc_mapping_match_count'',CASE WHEN domain=''INSURANCE'' THEN pc_mapping_count ELSE NULL END,''insurance_pc_mapping_approved'',CASE WHEN domain=''INSURANCE'' THEN pc_mapping_count=1 ELSE NULL END,''insurance_pc_mapping_resolved_entity_id'',CASE WHEN domain=''INSURANCE'' AND pc_mapping_count=1 THEN p_entity ELSE NULL END,''insurance_pc_mapping_resolved_company_code'',CASE WHEN domain=''INSURANCE'' AND pc_mapping_count=1 THEN delivery_company_code ELSE NULL END,''signed_project_code'',normalized->>''projectCode''',
    '''signed_project_code'',normalized->>''projectCode''');
  definition:=replace(definition,
    'OR jsonb_typeof(row_value->''raw_row'')<>''object'' OR NOT (row_value->''raw_row'' ?& ARRAY[''invoice_no'',''invoice_date'',''business_id'',''service_period_start'',''service_period_end'',''recurring_obligation_id'',''contract_id'',''charge_code'',''service_frequency'',''obligation_status'']) OR (row_value->''raw_row''->''service_period_start'') IS DISTINCT FROM ''null''::jsonb OR (row_value->''raw_row''->''service_period_end'') IS DISTINCT FROM ''null''::jsonb OR (row_value->''raw_row''->''recurring_obligation_id'') IS DISTINCT FROM ''null''::jsonb OR (row_value->''raw_row''->''contract_id'') IS DISTINCT FROM ''null''::jsonb OR (row_value->''raw_row''->''charge_code'') IS DISTINCT FROM ''null''::jsonb OR (row_value->''raw_row''->''service_frequency'') IS DISTINCT FROM ''null''::jsonb OR (row_value->''raw_row''->''obligation_status'') IS DISTINCT FROM ''null''::jsonb OR row_value#>>''{raw_row,invoice_no}'' IS DISTINCT FROM normalized->>''invoiceNo'' OR row_value#>>''{raw_row,invoice_date}'' IS DISTINCT FROM normalized->>''invoiceDate'' OR row_value#>>''{raw_row,business_id}'' IS DISTINCT FROM normalized->>''businessId'' OR (row_value->''exception_codes'' ? ''WBS_PAYABLE_INVOICE_NUMBER_MISSING'') IS DISTINCT FROM (NULLIF(normalized->>''invoiceNo'','''') IS NULL) OR (row_value->''exception_codes'' ? ''WBS_PAYABLE_VENDOR_MISSING'') IS DISTINCT FROM (NULLIF(normalized->>''vendorRef'','''') IS NULL AND NULLIF(normalized->>''vendorName'','''') IS NULL) OR NOT (row_value->''exception_codes'' ? ''WBS_PAYABLE_ATTACHMENT_REQUIRED'') OR NOT (row_value->''exception_codes'' ? ''WBS_PAYABLE_MAPPING_REVIEW_REQUIRED'') OR source_record IS DISTINCT FROM normalized->>''apGuId'' OR source_record !~',
    'OR source_record IS DISTINCT FROM normalized->>''apGuId'' OR source_record !~');
  definition:=replace(definition,
    'OR row_value->>''company_mapping_hash'' IS DISTINCT FROM p_delivery->>''company_mapping_hash'' OR row_value#>>''{raw_row,company_code}'' IS NOT NULL OR row_value#>>''{company_mapping_trace,mapping_authority}'' IS DISTINCT FROM ''UNRESOLVED_PENDING_SERVER_DECISION'' OR COALESCE((row_value#>>''{company_mapping_trace,controller_approved}'')::boolean,true) OR row_value#>>''{company_mapping_trace,company_mapping_hash}'' IS DISTINCT FROM p_delivery->>''company_mapping_hash'' OR COALESCE(normalized->>''finalPremium'','''') !~',
    'OR row_value->>''company_mapping_hash'' IS DISTINCT FROM p_delivery->>''company_mapping_hash'' OR COALESCE(normalized->>''finalPremium'','''') !~');
  definition:=replace(definition,
    'pc_mapping:=NULL; pc_mapping_id:=NULL; pc_mapping_count:=0; IF NULLIF(normalized->>''pcCode'','''') IS NULL THEN IF row_value->>''outcome''<>''EXCEPTION_REVIEW_REQUIRED'' OR NOT (row_value->''exception_codes'' ? ''INSURANCE_ENTITY_MAPPING_REQUIRED'') THEN RAISE EXCEPTION ''Insurance row without pc_code must be quarantined'' USING ERRCODE=''23514''; END IF; ELSE WITH matched AS MATERIALIZED (SELECT pc.wbs_insurance_pc_company_mapping_decision_id FROM wbs_insurance_pc_company_mapping_decision pc JOIN wbs_company_catalog_controller_decision cd ON cd.wbs_company_catalog_controller_decision_id=pc.wbs_company_catalog_controller_decision_id AND cd.tenant_id=pc.tenant_id AND cd.entity_id=pc.entity_id AND cd.decision_type=''APPROVED'' AND cd.company_code=pc.company_code AND cd.mapping_hash=pc.company_mapping_hash WHERE pc.tenant_id=p_tenant AND pc.entity_id=p_entity AND pc.pc_code=normalized->>''pcCode'' AND pc.company_code=delivery_company_code AND pc.company_mapping_hash=p_delivery->>''company_mapping_hash'' AND pc.approval_status=''APPROVED'' AND pc.effective_from<=(p_delivery->>''date_from'')::date AND (pc.effective_to IS NULL OR pc.effective_to>=(p_delivery->>''date_to'')::date) FOR SHARE), selected AS (SELECT count(*)::integer AS match_count,(array_agg(wbs_insurance_pc_company_mapping_decision_id))[1] AS mapping_id FROM matched) SELECT match_count,mapping_id INTO pc_mapping_count,pc_mapping_id FROM selected; IF pc_mapping_count<>1 THEN RAISE EXCEPTION ''Insurance PC/company mapping is missing or ambiguous'' USING ERRCODE=''23514''; END IF; SELECT pc.* INTO pc_mapping FROM wbs_insurance_pc_company_mapping_decision pc WHERE pc.wbs_insurance_pc_company_mapping_decision_id=pc_mapping_id; END IF; source_record:=''insurance:''||source_record; gross:=(normalized->>''finalPremium'')::numeric(22,4);',
    'source_record:=''insurance:''||source_record; gross:=(normalized->>''finalPremium'')::numeric(20,4);');
  IF position('WITH matched AS MATERIALIZED' IN definition)>0 OR position('pc_mapping_count' IN definition)>0 THEN
    RAISE EXCEPTION 'Cannot remove Final-1 PC mapping guard because the exact inverse did not apply' USING ERRCODE='55000';
  END IF;
  definition:=replace(definition,'gross numeric(22,4)','gross numeric(20,4)');
  IF position('NOT BETWEEN 1 AND 500' IN definition)=0 THEN
    RAISE EXCEPTION 'Cannot restore unexpected Final-1 signed population bound' USING ERRCODE='55000';
  END IF;
  definition:=replace(definition,'NOT BETWEEN 1 AND 500','NOT BETWEEN 1 AND 2000');
  IF position('pc_mapping' IN definition)>0 OR position('insurance_pc_mapping_' IN definition)>0 OR position('insurance_source_pc_code' IN definition)>0 THEN
    RAISE EXCEPTION 'Cannot remove Final-1 mapping guard because the predecessor definition did not restore exactly' USING ERRCODE='55000';
  END IF;
  EXECUTE definition;
END
$$;
ALTER TABLE source_document_line ALTER COLUMN amount TYPE numeric(20,4);
DROP TRIGGER materialize_ai_duplicate_payable_findings_from_document ON source_document;
ALTER TABLE source_document ALTER COLUMN gross_amount TYPE numeric(20,4);
CREATE TRIGGER materialize_ai_duplicate_payable_findings_from_document
  AFTER INSERT OR UPDATE OF status,document_no,gross_amount,currency,document_type ON source_document
  FOR EACH ROW EXECUTE FUNCTION refs_materialize_ai_duplicate_payable_findings_from_document_trigger();
DROP TABLE wbs_insurance_pc_company_mapping_decision;
COMMIT;
