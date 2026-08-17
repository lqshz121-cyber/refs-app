BEGIN;

-- Keep Final-1 Insurance contract money at its signed decimal(20,2) range.
-- The evidence-only columns are widened, never rounded or silently narrowed.
-- PostgreSQL will not alter a type referenced by an UPDATE OF trigger.  Recreate
-- this unchanged trigger around the narrow type change in the same transaction.
DROP TRIGGER materialize_ai_duplicate_payable_findings_from_document ON source_document;
ALTER TABLE source_document
  ALTER COLUMN gross_amount TYPE numeric(22,4);
ALTER TABLE source_document_line
  ALTER COLUMN amount TYPE numeric(22,4);
CREATE TRIGGER materialize_ai_duplicate_payable_findings_from_document
  AFTER INSERT OR UPDATE OF status,document_no,gross_amount,currency,document_type ON source_document
  FOR EACH ROW EXECUTE FUNCTION refs_materialize_ai_duplicate_payable_findings_from_document_trigger();

-- This is a Controller-approved PC-code-to-company binding, deliberately
-- separate from the immutable Final-1 rows and from migration 149.  Final-1
-- retention only reads it; a future Controller workflow owns its creation.
CREATE TABLE wbs_insurance_pc_company_mapping_decision (
  wbs_insurance_pc_company_mapping_decision_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant(tenant_id),
  entity_id uuid NOT NULL,
  pc_code text NOT NULL CHECK(length(btrim(pc_code)) BETWEEN 1 AND 128),
  company_code text NOT NULL CHECK(company_code ~ '^[A-Z0-9][A-Z0-9_-]{0,63}$'),
  company_mapping_hash text NOT NULL CHECK(company_mapping_hash ~ '^sha256:[0-9a-f]{64}$'),
  wbs_company_catalog_controller_decision_id uuid NOT NULL,
  approval_status text NOT NULL CHECK(approval_status='APPROVED'),
  effective_from date NOT NULL,
  effective_to date,
  decision_document jsonb NOT NULL CHECK(jsonb_typeof(decision_document)='object'),
  decision_hash text NOT NULL CHECK(decision_hash ~ '^sha256:[0-9a-f]{64}$'),
  decided_by text NOT NULL CHECK(length(btrim(decided_by)) BETWEEN 1 AND 256),
  decided_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CHECK(effective_to IS NULL OR effective_to>=effective_from),
  CHECK(decision_hash=refs_jsonb_hash(decision_document)),
  CHECK(decision_document->>'tenant_id'=tenant_id::text AND decision_document->>'entity_id'=entity_id::text AND decision_document->>'pc_code'=pc_code AND decision_document->>'company_code'=company_code AND decision_document->>'company_mapping_hash'=company_mapping_hash AND decision_document->>'controller_decision_id'=wbs_company_catalog_controller_decision_id::text AND decision_document->>'approval_status'=approval_status AND decision_document->>'effective_from'=to_char(effective_from,'YYYY-MM-DD') AND decision_document->>'effective_to' IS NOT DISTINCT FROM CASE WHEN effective_to IS NULL THEN NULL ELSE to_char(effective_to,'YYYY-MM-DD') END AND decision_document->>'decided_by'=decided_by),
  UNIQUE(tenant_id,entity_id,pc_code,company_mapping_hash,effective_from),
  FOREIGN KEY(tenant_id,entity_id) REFERENCES entity(tenant_id,entity_id),
  FOREIGN KEY(tenant_id,entity_id,wbs_company_catalog_controller_decision_id) REFERENCES wbs_company_catalog_controller_decision(tenant_id,entity_id,wbs_company_catalog_controller_decision_id),
  EXCLUDE USING gist (tenant_id WITH =,entity_id WITH =,pc_code WITH =,daterange(effective_from,COALESCE(effective_to+1,'infinity'::date),'[)') WITH &&)
);
ALTER TABLE wbs_insurance_pc_company_mapping_decision ENABLE ROW LEVEL SECURITY;
CREATE POLICY wbs_insurance_pc_company_mapping_decision_scope ON wbs_insurance_pc_company_mapping_decision
  USING(tenant_id=refs_current_tenant() AND refs_entity_allowed(entity_id))
  WITH CHECK(tenant_id=refs_current_tenant() AND refs_entity_allowed(entity_id));
CREATE TRIGGER wbs_insurance_pc_company_mapping_decision_append_only BEFORE UPDATE OR DELETE ON wbs_insurance_pc_company_mapping_decision FOR EACH ROW EXECUTE FUNCTION reject_mutation();
REVOKE ALL ON wbs_insurance_pc_company_mapping_decision FROM PUBLIC,refs_app;
GRANT SELECT ON wbs_insurance_pc_company_mapping_decision TO refs_app;

-- Migration 149 owns this function.  Rebuild its installed definition only
-- when every expected predecessor fragment is present; never edit 149 or its
-- immutable rows in place.
DO $$
DECLARE definition text;
BEGIN
  SELECT pg_get_functiondef(
    'public.refs_retain_wbs_final1_source_evidence(uuid,uuid,jsonb,jsonb,jsonb,text,text)'::regprocedure
  ) INTO definition;
  IF position('gross numeric(20,4)' IN definition)>0 THEN
    definition:=replace(definition,'gross numeric(20,4)','gross numeric(22,4)');
  ELSIF position('gross numeric(22,4)' IN definition)=0 THEN
    RAISE EXCEPTION 'Unexpected Final-1 retained-evidence precision definition' USING ERRCODE='22023';
  END IF;
  IF position('NOT BETWEEN 1 AND 2000' IN definition)>0 THEN
    definition:=replace(definition,'NOT BETWEEN 1 AND 2000','NOT BETWEEN 1 AND 500');
  ELSIF position('NOT BETWEEN 1 AND 500' IN definition)=0 THEN
    RAISE EXCEPTION 'Unexpected Final-1 retained-evidence signed population bound' USING ERRCODE='22023';
  END IF;
  IF position('DECLARE actor text:=refs_current_actor(); idem idempotency_receipt; entity_record entity; approved_mapping record;' IN definition)>0 THEN
    definition:=replace(definition,'DECLARE actor text:=refs_current_actor(); idem idempotency_receipt; entity_record entity; approved_mapping record;',
      'DECLARE actor text:=refs_current_actor(); idem idempotency_receipt; entity_record entity; approved_mapping record; pc_mapping wbs_insurance_pc_company_mapping_decision%ROWTYPE; pc_mapping_id uuid; pc_mapping_count integer:=0;');
  ELSIF position('pc_mapping_count integer' IN definition)=0 THEN
    RAISE EXCEPTION 'Unexpected Final-1 retained-evidence declaration definition' USING ERRCODE='22023';
  END IF;
  IF position('''signed_project_code'',normalized->>''projectCode''' IN definition)>0 THEN
    definition:=replace(
      definition,
      '''signed_project_code'',normalized->>''projectCode''',
      '''signed_business_id'',normalized->>''businessId'',''signed_invoice_no'',normalized->>''invoiceNo'',''signed_invoice_date'',normalized->>''invoiceDate'',''signed_insurance_row_company_code'',CASE WHEN domain=''INSURANCE'' THEN row_value#>>''{raw_row,company_code}'' ELSE NULL END,''signed_company_mapping_hash'',CASE WHEN domain=''INSURANCE'' THEN row_value->>''company_mapping_hash'' ELSE NULL END,''signed_company_mapping_authority'',CASE WHEN domain=''INSURANCE'' THEN CASE WHEN pc_mapping_count=1 THEN ''CONTROLLER_APPROVED'' ELSE ''UNRESOLVED_PENDING_SERVER_DECISION'' END ELSE NULL END,''insurance_pc_mapping_id'',CASE WHEN domain=''INSURANCE'' THEN pc_mapping.wbs_insurance_pc_company_mapping_decision_id ELSE NULL END,''insurance_pc_mapping_hash'',CASE WHEN domain=''INSURANCE'' THEN pc_mapping.company_mapping_hash ELSE NULL END,''insurance_pc_mapping_match_count'',CASE WHEN domain=''INSURANCE'' THEN pc_mapping_count ELSE NULL END,''insurance_pc_mapping_approved'',CASE WHEN domain=''INSURANCE'' THEN pc_mapping_count=1 ELSE NULL END,''insurance_pc_mapping_resolved_entity_id'',CASE WHEN domain=''INSURANCE'' AND pc_mapping_count=1 THEN p_entity ELSE NULL END,''insurance_pc_mapping_resolved_company_code'',CASE WHEN domain=''INSURANCE'' AND pc_mapping_count=1 THEN delivery_company_code ELSE NULL END,''signed_project_code'',normalized->>''projectCode'''
    );
  ELSIF position('''signed_business_id'',normalized->>''businessId''' IN definition)=0 THEN
    RAISE EXCEPTION 'Unexpected Final-1 retained-evidence provenance definition' USING ERRCODE='22023';
  END IF;
  IF position('''signed_insurance_row_company_code'',CASE WHEN domain=''INSURANCE'' THEN row_value#>>''{raw_row,company_code}'' ELSE NULL END,''signed_company_mapping_hash''' IN definition)>0 THEN
    definition:=replace(definition,
      '''signed_insurance_row_company_code'',CASE WHEN domain=''INSURANCE'' THEN row_value#>>''{raw_row,company_code}'' ELSE NULL END,''signed_company_mapping_hash''',
      '''signed_insurance_row_company_code'',CASE WHEN domain=''INSURANCE'' THEN row_value#>>''{raw_row,company_code}'' ELSE NULL END,''insurance_source_pc_code'',CASE WHEN domain=''INSURANCE'' THEN normalized->>''pcCode'' ELSE NULL END,''signed_company_mapping_hash''');
  ELSIF position('''insurance_source_pc_code'',CASE WHEN domain=''INSURANCE'' THEN normalized->>''pcCode'' ELSE NULL END' IN definition)=0 THEN
    RAISE EXCEPTION 'Unexpected Final-1 insurance pc_code provenance definition' USING ERRCODE='22023';
  END IF;
  IF position('''insurance_pc_mapping_id'',CASE WHEN domain=''INSURANCE'' THEN pc_mapping.wbs_insurance_pc_company_mapping_decision_id ELSE NULL END' IN definition)>0 THEN
    definition:=replace(definition,
      '''insurance_pc_mapping_id'',CASE WHEN domain=''INSURANCE'' THEN pc_mapping.wbs_insurance_pc_company_mapping_decision_id ELSE NULL END,''insurance_pc_mapping_hash'',CASE WHEN domain=''INSURANCE'' THEN pc_mapping.company_mapping_hash ELSE NULL END,''insurance_pc_mapping_match_count'',CASE WHEN domain=''INSURANCE'' THEN pc_mapping_count ELSE NULL END,''insurance_pc_mapping_approved'',CASE WHEN domain=''INSURANCE'' THEN pc_mapping_count=1 ELSE NULL END,''insurance_pc_mapping_resolved_entity_id''',
      '''insurance_pc_mapping_id'',CASE WHEN domain=''INSURANCE'' AND pc_mapping_count=1 THEN pc_mapping.wbs_insurance_pc_company_mapping_decision_id ELSE NULL END,''insurance_pc_mapping_hash'',CASE WHEN domain=''INSURANCE'' AND pc_mapping_count=1 THEN pc_mapping.company_mapping_hash ELSE NULL END,''insurance_pc_mapping_match_count'',CASE WHEN domain=''INSURANCE'' THEN pc_mapping_count ELSE NULL END,''insurance_pc_mapping_approved'',CASE WHEN domain=''INSURANCE'' THEN pc_mapping_count=1 ELSE NULL END,''insurance_pc_mapping_effective_from'',CASE WHEN domain=''INSURANCE'' AND pc_mapping_count=1 THEN to_char(pc_mapping.effective_from,''YYYY-MM-DD'') ELSE NULL END,''insurance_pc_mapping_effective_to'',CASE WHEN domain=''INSURANCE'' AND pc_mapping_count=1 THEN to_char(pc_mapping.effective_to,''YYYY-MM-DD'') ELSE NULL END,''insurance_pc_mapping_resolved_entity_id''');
  ELSIF position('''insurance_pc_mapping_effective_from''' IN definition)=0 THEN
    RAISE EXCEPTION 'Unexpected Final-1 insurance mapping effective-window provenance definition' USING ERRCODE='22023';
  END IF;
  IF position('OR source_record IS DISTINCT FROM normalized->>''apGuId'' OR source_record !~' IN definition)>0 THEN
    definition:=replace(definition,
      'OR source_record IS DISTINCT FROM normalized->>''apGuId'' OR source_record !~',
      'OR jsonb_typeof(row_value->''raw_row'')<>''object'' OR NOT (row_value->''raw_row'' ?& ARRAY[''invoice_no'',''invoice_date'',''business_id'',''service_period_start'',''service_period_end'',''recurring_obligation_id'',''contract_id'',''charge_code'',''service_frequency'',''obligation_status'']) OR (row_value->''raw_row''->''service_period_start'') IS DISTINCT FROM ''null''::jsonb OR (row_value->''raw_row''->''service_period_end'') IS DISTINCT FROM ''null''::jsonb OR (row_value->''raw_row''->''recurring_obligation_id'') IS DISTINCT FROM ''null''::jsonb OR (row_value->''raw_row''->''contract_id'') IS DISTINCT FROM ''null''::jsonb OR (row_value->''raw_row''->''charge_code'') IS DISTINCT FROM ''null''::jsonb OR (row_value->''raw_row''->''service_frequency'') IS DISTINCT FROM ''null''::jsonb OR (row_value->''raw_row''->''obligation_status'') IS DISTINCT FROM ''null''::jsonb OR row_value#>>''{raw_row,invoice_no}'' IS DISTINCT FROM normalized->>''invoiceNo'' OR row_value#>>''{raw_row,invoice_date}'' IS DISTINCT FROM normalized->>''invoiceDate'' OR row_value#>>''{raw_row,business_id}'' IS DISTINCT FROM normalized->>''businessId'' OR (row_value->''exception_codes'' ? ''WBS_PAYABLE_INVOICE_NUMBER_MISSING'') IS DISTINCT FROM (NULLIF(normalized->>''invoiceNo'','''') IS NULL) OR (row_value->''exception_codes'' ? ''WBS_PAYABLE_VENDOR_MISSING'') IS DISTINCT FROM (NULLIF(normalized->>''vendorRef'','''') IS NULL AND NULLIF(normalized->>''vendorName'','''') IS NULL) OR NOT (row_value->''exception_codes'' ? ''WBS_PAYABLE_ATTACHMENT_REQUIRED'') OR NOT (row_value->''exception_codes'' ? ''WBS_PAYABLE_MAPPING_REVIEW_REQUIRED'') OR source_record IS DISTINCT FROM normalized->>''apGuId'' OR source_record !~');
  ELSIF position('row_value#>>''{raw_row,business_id}'' IS DISTINCT FROM normalized->>''businessId''' IN definition)=0 THEN
    RAISE EXCEPTION 'Unexpected Final-1 payable iff validation definition' USING ERRCODE='22023';
  END IF;
  IF position('OR row_value->>''company_mapping_hash'' IS DISTINCT FROM p_delivery->>''company_mapping_hash'' OR COALESCE(normalized->>''finalPremium'','''') !~' IN definition)>0 THEN
    definition:=replace(definition,
      'OR row_value->>''company_mapping_hash'' IS DISTINCT FROM p_delivery->>''company_mapping_hash'' OR COALESCE(normalized->>''finalPremium'','''') !~',
      'OR row_value->>''company_mapping_hash'' IS DISTINCT FROM p_delivery->>''company_mapping_hash'' OR row_value#>>''{raw_row,company_code}'' IS NOT NULL OR row_value#>>''{company_mapping_trace,mapping_authority}'' IS DISTINCT FROM ''UNRESOLVED_PENDING_SERVER_DECISION'' OR COALESCE((row_value#>>''{company_mapping_trace,controller_approved}'')::boolean,true) OR row_value#>>''{company_mapping_trace,company_mapping_hash}'' IS DISTINCT FROM p_delivery->>''company_mapping_hash'' OR COALESCE(normalized->>''finalPremium'','''') !~');
  ELSIF position('company_mapping_trace,mapping_authority' IN definition)=0 THEN
    RAISE EXCEPTION 'Unexpected Final-1 insurance trace validation definition' USING ERRCODE='22023';
  END IF;
  IF position('source_record:=''insurance:''||source_record; gross:=(normalized->>''finalPremium'')::numeric(20,4);' IN definition)>0 THEN
    definition:=replace(definition,
      'source_record:=''insurance:''||source_record; gross:=(normalized->>''finalPremium'')::numeric(20,4);',
      'pc_mapping:=NULL; pc_mapping_id:=NULL; pc_mapping_count:=0; IF NULLIF(normalized->>''pcCode'','''') IS NULL THEN IF row_value->>''outcome''<>''EXCEPTION_REVIEW_REQUIRED'' OR NOT (row_value->''exception_codes'' ? ''INSURANCE_ENTITY_MAPPING_REQUIRED'') THEN RAISE EXCEPTION ''Insurance row without pc_code must be quarantined'' USING ERRCODE=''23514''; END IF; ELSE WITH matched AS MATERIALIZED (SELECT pc.wbs_insurance_pc_company_mapping_decision_id FROM wbs_insurance_pc_company_mapping_decision pc JOIN wbs_company_catalog_controller_decision cd ON cd.wbs_company_catalog_controller_decision_id=pc.wbs_company_catalog_controller_decision_id AND cd.tenant_id=pc.tenant_id AND cd.entity_id=pc.entity_id AND cd.decision_type=''APPROVED'' AND cd.company_code=pc.company_code AND cd.mapping_hash=pc.company_mapping_hash WHERE pc.tenant_id=p_tenant AND pc.entity_id=p_entity AND pc.pc_code=normalized->>''pcCode'' AND pc.company_code=delivery_company_code AND pc.company_mapping_hash=p_delivery->>''company_mapping_hash'' AND pc.approval_status=''APPROVED'' AND pc.effective_from<=(p_delivery->>''date_from'')::date AND (pc.effective_to IS NULL OR pc.effective_to>=(p_delivery->>''date_to'')::date) FOR SHARE), selected AS (SELECT count(*)::integer AS match_count,(array_agg(wbs_insurance_pc_company_mapping_decision_id))[1] AS mapping_id FROM matched) SELECT match_count,mapping_id INTO pc_mapping_count,pc_mapping_id FROM selected; IF pc_mapping_count<>1 THEN RAISE EXCEPTION ''Insurance PC/company mapping is missing or ambiguous'' USING ERRCODE=''23514''; END IF; SELECT pc.* INTO pc_mapping FROM wbs_insurance_pc_company_mapping_decision pc WHERE pc.wbs_insurance_pc_company_mapping_decision_id=pc_mapping_id; END IF; source_record:=''insurance:''||source_record; gross:=(normalized->>''finalPremium'')::numeric(22,4);');
  ELSIF position('WITH matched AS MATERIALIZED' IN definition)=0 THEN
    RAISE EXCEPTION 'Unexpected Final-1 insurance single-query mapping definition' USING ERRCODE='22023';
  END IF;
  EXECUTE definition;
END
$$;

COMMIT;
