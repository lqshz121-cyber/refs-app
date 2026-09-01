BEGIN;

CREATE TABLE wbs_final1_payable_document_evidence (
  wbs_final1_payable_document_evidence_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant(tenant_id),
  entity_id uuid NOT NULL,
  wbs_final1_retained_source_row_id uuid NOT NULL,
  source_document_id uuid NOT NULL,
  source_document_line_id uuid NOT NULL,
  source_version text NOT NULL,
  source_line_hash text NOT NULL CHECK(source_line_hash~'^sha256:[0-9a-f]{64}$'),
  schema_version text NOT NULL CHECK(schema_version='WBS_FINAL1_PAYABLE_DOCUMENT_EVIDENCE_V1'),
  evidence_status text NOT NULL CHECK(evidence_status IN('COMPLETE','MISSING')),
  document_kind text CHECK(document_kind IN('INVOICE','TAX_STATEMENT')),
  taxing_jurisdiction text,
  tax_statement_identifier text,
  tax_coverage_period_start date,
  tax_coverage_period_end date,
  tax_obligation_basis text CHECK(tax_obligation_basis IN('ASSESSED_VALUE','MILLAGE_RATE','FIXED_STATUTORY_AMOUNT')),
  controlled_property_ref text,
  parcel_identifier text,
  evidence_hash text NOT NULL CHECK(evidence_hash~'^sha256:[0-9a-f]{64}$'),
  created_by text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE(tenant_id,entity_id,wbs_final1_retained_source_row_id),
  FOREIGN KEY(tenant_id,entity_id) REFERENCES entity(tenant_id,entity_id),
  FOREIGN KEY(tenant_id,entity_id,wbs_final1_retained_source_row_id) REFERENCES wbs_final1_retained_source_row(tenant_id,entity_id,wbs_final1_retained_source_row_id),
  FOREIGN KEY(tenant_id,entity_id,source_document_id) REFERENCES source_document(tenant_id,entity_id,source_document_id),
  FOREIGN KEY(tenant_id,entity_id,source_document_line_id) REFERENCES source_document_line(tenant_id,entity_id,source_document_line_id),
  CHECK(
    evidence_status='MISSING' AND document_kind IS NULL AND taxing_jurisdiction IS NULL AND tax_statement_identifier IS NULL
      AND tax_coverage_period_start IS NULL AND tax_coverage_period_end IS NULL AND tax_obligation_basis IS NULL
      AND controlled_property_ref IS NULL AND parcel_identifier IS NULL
    OR evidence_status='COMPLETE' AND (
      document_kind='INVOICE' AND taxing_jurisdiction IS NULL AND tax_statement_identifier IS NULL
        AND tax_coverage_period_start IS NULL AND tax_coverage_period_end IS NULL AND tax_obligation_basis IS NULL
        AND controlled_property_ref IS NULL AND parcel_identifier IS NULL
      OR document_kind='TAX_STATEMENT' AND length(btrim(taxing_jurisdiction)) BETWEEN 1 AND 200
        AND length(btrim(tax_statement_identifier)) BETWEEN 1 AND 200
        AND tax_coverage_period_start IS NOT NULL AND tax_coverage_period_end IS NOT NULL
        AND tax_coverage_period_start<=tax_coverage_period_end
        AND tax_obligation_basis IS NOT NULL
        AND length(btrim(controlled_property_ref)) BETWEEN 1 AND 128
        AND length(btrim(parcel_identifier)) BETWEEN 1 AND 128
    )
  )
);
ALTER TABLE wbs_final1_payable_document_evidence ENABLE ROW LEVEL SECURITY;
CREATE POLICY wbs_final1_payable_document_evidence_scope ON wbs_final1_payable_document_evidence
  USING(refs_rls_scope(tenant_id,entity_id)) WITH CHECK(refs_rls_scope(tenant_id,entity_id));
CREATE TRIGGER wbs_final1_payable_document_evidence_append_only BEFORE UPDATE OR DELETE ON wbs_final1_payable_document_evidence FOR EACH ROW EXECUTE FUNCTION reject_mutation();
CREATE UNIQUE INDEX wbs_final1_payable_tax_statement_identity_uniq ON wbs_final1_payable_document_evidence(
  tenant_id,entity_id,taxing_jurisdiction,tax_statement_identifier,controlled_property_ref,parcel_identifier,tax_coverage_period_start,tax_coverage_period_end
) WHERE document_kind='TAX_STATEMENT';

CREATE FUNCTION refs_wbs_final1_payable_document_evidence_hash(
  p_tenant uuid,p_entity uuid,p_retained_row uuid,p_source_document uuid,p_source_line uuid,
  p_source_version text,p_source_line_hash text,p_status text,p_kind text,p_jurisdiction text,
  p_statement text,p_coverage_start date,p_coverage_end date,p_basis text,p_property text,p_parcel text
) RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT refs_jsonb_hash(jsonb_build_object(
    'schema_version','WBS_FINAL1_PAYABLE_DOCUMENT_EVIDENCE_V1','tenant_id',p_tenant,'entity_id',p_entity,
    'retained_source_row_id',p_retained_row,'source_document_id',p_source_document,'source_document_line_id',p_source_line,
    'source_version',p_source_version,'source_line_hash',p_source_line_hash,'evidence_status',p_status,'document_kind',p_kind,
    'taxing_jurisdiction',p_jurisdiction,'tax_statement_identifier',p_statement,'tax_coverage_period_start',p_coverage_start,
    'tax_coverage_period_end',p_coverage_end,'tax_obligation_basis',p_basis,'controlled_property_ref',p_property,'parcel_identifier',p_parcel))
$$;

ALTER FUNCTION refs_retain_wbs_final1_source_evidence_with_signed_controls(uuid,uuid,jsonb,jsonb,jsonb,text,text)
  RENAME TO refs_retain_wbs_final1_source_evidence_with_signed_controls_v167;
REVOKE ALL ON FUNCTION refs_retain_wbs_final1_source_evidence_with_signed_controls_v167(uuid,uuid,jsonb,jsonb,jsonb,text,text) FROM PUBLIC,refs_app;

CREATE FUNCTION refs_retain_wbs_final1_source_evidence_with_signed_controls(
  p_tenant uuid,p_entity uuid,p_delivery jsonb,p_artifacts jsonb,p_plan jsonb,p_idempotency_key text,p_request_hash text
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE
  v_result jsonb; v_row jsonb; v_raw jsonb; v_retained wbs_final1_retained_source_row; v_actor text:=refs_current_actor();
  v_status text; v_kind text; v_jurisdiction text; v_statement text; v_start_text text; v_end_text text; v_start date; v_end date; v_basis text; v_property text; v_parcel text;
  v_hash text; v_evidence_id uuid; v_payload jsonb; v_typed_keys text[]:=ARRAY['document_evidence_schema_version','document_kind','taxing_jurisdiction','tax_statement_identifier','tax_coverage_period_start','tax_coverage_period_end','tax_obligation_basis','controlled_property_ref','parcel_identifier'];
BEGIN
  v_result:=refs_retain_wbs_final1_source_evidence_with_signed_controls_v167(p_tenant,p_entity,p_delivery,p_artifacts,p_plan,p_idempotency_key,p_request_hash);
  IF p_delivery->>'domain'<>'PAYABLES' THEN RETURN v_result; END IF;
  IF jsonb_typeof(p_plan->'staging_rows')<>'array' THEN RAISE EXCEPTION 'Typed payable evidence requires the exact retained row population' USING ERRCODE='22023'; END IF;
  IF EXISTS(
    SELECT 1 FROM jsonb_array_elements(p_plan->'staging_rows') x
     WHERE x->'raw_row' ? 'document_kind' AND x#>>'{raw_row,document_kind}'='TAX_STATEMENT'
     GROUP BY x#>>'{raw_row,taxing_jurisdiction}',x#>>'{raw_row,tax_statement_identifier}',x#>>'{raw_row,controlled_property_ref}',x#>>'{raw_row,parcel_identifier}',x#>>'{raw_row,tax_coverage_period_start}',x#>>'{raw_row,tax_coverage_period_end}' HAVING count(*)>1
  ) THEN RAISE EXCEPTION 'Typed payable population contains a duplicate tax-statement identity' USING ERRCODE='23514'; END IF;
  FOR v_row IN SELECT value FROM jsonb_array_elements(p_plan->'staging_rows') LOOP
    v_raw:=v_row->'raw_row';
    SELECT * INTO STRICT v_retained FROM wbs_final1_retained_source_row r
     WHERE r.tenant_id=p_tenant AND r.entity_id=p_entity AND r.wbs_final1_retained_evidence_admission_id=(v_result->>'admission_id')::uuid
       AND r.domain='PAYABLES' AND r.source_row_ordinal=(v_row->>'source_row_ordinal')::integer
       AND r.source_record_id=v_row->>'source_record_id' AND r.raw_row_hash=v_row->>'raw_row_hash';
    IF NOT (v_raw ? 'document_kind') AND NOT (v_raw ?| v_typed_keys) THEN
      v_status:='MISSING';v_kind:=NULL;v_jurisdiction:=NULL;v_statement:=NULL;v_start:=NULL;v_end:=NULL;v_basis:=NULL;v_property:=NULL;v_parcel:=NULL;
    ELSE
      IF NOT (v_raw ?& v_typed_keys) OR v_raw->>'document_evidence_schema_version'<>'WBS_FINAL1_PAYABLE_DOCUMENT_EVIDENCE_V1' OR v_raw->>'document_kind' NOT IN('INVOICE','TAX_STATEMENT') THEN RAISE EXCEPTION 'Signed payable document evidence is missing, unversioned, or unknown' USING ERRCODE='23514'; END IF;
      v_status:='COMPLETE';v_kind:=v_raw->>'document_kind';
      v_jurisdiction:=NULLIF(btrim(v_raw->>'taxing_jurisdiction'),'');v_statement:=NULLIF(btrim(v_raw->>'tax_statement_identifier'),'');
      v_start_text:=NULLIF(v_raw->>'tax_coverage_period_start','');v_end_text:=NULLIF(v_raw->>'tax_coverage_period_end','');
      IF v_kind='TAX_STATEMENT' AND (v_start_text IS NULL OR v_start_text!~'^[0-9]{4}-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])$' OR v_end_text IS NULL OR v_end_text!~'^[0-9]{4}-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])$') THEN RAISE EXCEPTION 'Signed tax coverage dates must be canonical YYYY-MM-DD values' USING ERRCODE='23514'; END IF;
      v_start:=v_start_text::date;v_end:=v_end_text::date;
      IF v_kind='TAX_STATEMENT' AND (to_char(v_start,'YYYY-MM-DD')<>v_start_text OR to_char(v_end,'YYYY-MM-DD')<>v_end_text) THEN RAISE EXCEPTION 'Signed tax coverage dates are not Gregorian calendar dates' USING ERRCODE='23514'; END IF;
      v_basis:=NULLIF(v_raw->>'tax_obligation_basis','');v_property:=NULLIF(btrim(v_raw->>'controlled_property_ref'),'');v_parcel:=NULLIF(btrim(v_raw->>'parcel_identifier'),'');
      IF v_kind='INVOICE' AND EXISTS(SELECT 1 FROM unnest(v_typed_keys[3:9]) k WHERE v_raw->k<>'null'::jsonb)
         OR v_kind='TAX_STATEMENT' AND (v_jurisdiction IS NULL OR length(v_jurisdiction)>200 OR v_statement IS NULL OR length(v_statement)>200 OR v_start IS NULL OR v_end IS NULL OR v_start>v_end OR v_basis NOT IN('ASSESSED_VALUE','MILLAGE_RATE','FIXED_STATUTORY_AMOUNT') OR v_property IS NULL OR length(v_property)>128 OR v_parcel IS NULL OR length(v_parcel)>128) THEN
        RAISE EXCEPTION 'Signed payable document evidence is contradictory or incomplete' USING ERRCODE='23514';
      END IF;
    END IF;
    v_hash:=refs_wbs_final1_payable_document_evidence_hash(p_tenant,p_entity,v_retained.wbs_final1_retained_source_row_id,v_retained.source_document_id,v_retained.source_document_line_id,v_retained.source_version,v_retained.raw_row_hash,v_status,v_kind,v_jurisdiction,v_statement,v_start,v_end,v_basis,v_property,v_parcel);
    INSERT INTO wbs_final1_payable_document_evidence(tenant_id,entity_id,wbs_final1_retained_source_row_id,source_document_id,source_document_line_id,source_version,source_line_hash,schema_version,evidence_status,document_kind,taxing_jurisdiction,tax_statement_identifier,tax_coverage_period_start,tax_coverage_period_end,tax_obligation_basis,controlled_property_ref,parcel_identifier,evidence_hash,created_by)
      VALUES(p_tenant,p_entity,v_retained.wbs_final1_retained_source_row_id,v_retained.source_document_id,v_retained.source_document_line_id,v_retained.source_version,v_retained.raw_row_hash,'WBS_FINAL1_PAYABLE_DOCUMENT_EVIDENCE_V1',v_status,v_kind,v_jurisdiction,v_statement,v_start,v_end,v_basis,v_property,v_parcel,v_hash,v_actor)
      ON CONFLICT(tenant_id,entity_id,wbs_final1_retained_source_row_id) DO NOTHING RETURNING wbs_final1_payable_document_evidence_id INTO v_evidence_id;
    IF v_evidence_id IS NULL AND NOT EXISTS(SELECT 1 FROM wbs_final1_payable_document_evidence e WHERE e.tenant_id=p_tenant AND e.entity_id=p_entity AND e.wbs_final1_retained_source_row_id=v_retained.wbs_final1_retained_source_row_id AND e.evidence_hash=v_hash) THEN RAISE EXCEPTION 'Typed payable evidence replay drifted' USING ERRCODE='23505'; END IF;
    IF v_evidence_id IS NOT NULL THEN
      v_payload:=jsonb_build_object('schema_version','WBS_FINAL1_PAYABLE_DOCUMENT_EVIDENCE_V1','document_evidence_id',v_evidence_id,'retained_source_row_id',v_retained.wbs_final1_retained_source_row_id,'source_document_id',v_retained.source_document_id,'source_document_line_id',v_retained.source_document_line_id,'source_line_hash',v_retained.raw_row_hash,'evidence_status',v_status,'document_kind',v_kind,'evidence_hash',v_hash,'can_create_draft',false,'can_review',false,'can_approve',false,'can_post',false);
      INSERT INTO audit_event(tenant_id,entity_id,event_type,object_type,object_id,action,actor_id,actor_type,permission_used,request_id,correlation_id,idempotency_key,after_hash,reason,metadata) VALUES(p_tenant,p_entity,'WBS_FINAL1_PAYABLE_DOCUMENT_EVIDENCE_RETAINED','WBS_FINAL1_PAYABLE_DOCUMENT_EVIDENCE',v_evidence_id,'RETAIN',v_actor,'SERVICE_ACCOUNT','WBS.SNAPSHOT.IMPORT',p_idempotency_key,p_idempotency_key,p_idempotency_key,v_hash,'Provider-signed typed payable document evidence retained without accounting action',v_payload);
      INSERT INTO outbox_event(tenant_id,entity_id,aggregate_type,aggregate_id,event_type,payload,payload_hash) VALUES(p_tenant,p_entity,'WBS_FINAL1_PAYABLE_DOCUMENT_EVIDENCE',v_evidence_id,'WBS_FINAL1_PAYABLE_DOCUMENT_EVIDENCE_RETAINED',v_payload,refs_jsonb_hash(v_payload));
    END IF;
  END LOOP;
  RETURN v_result;
END $$;

CREATE FUNCTION refs_read_ai_invoice_classification_source_v3(p_tenant uuid,p_entity uuid,p_period uuid,p_limit integer DEFAULT 100)
RETURNS TABLE(source_document_id uuid,source_document_line_id uuid,source_payload_hash text,source_line_hash text,entity_id uuid,accounting_period_id uuid,accounting_date date,vendor_ref text,vendor_member_ref text,invoice_no text,invoice_date date,currency text,amount text,service_period_start date,service_period_end date,description text,project_ref text,property_ref text,member_ref text,charge_code text,contract_id text,service_frequency text,source_attachment_count integer,source_attachment_ids uuid[],source_attachment_evidence jsonb,accounting_status text,posted_debit_account_classes text[],document_evidence_status text,document_evidence_schema_version text,document_evidence_hash text,document_kind text,taxing_jurisdiction text,tax_statement_identifier text,tax_coverage_period_start date,tax_coverage_period_end date,tax_obligation_basis text,controlled_property_ref text,parcel_identifier text)
LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
  SELECT s.*,COALESCE(e.evidence_status,'MISSING'),e.schema_version,e.evidence_hash,e.document_kind,e.taxing_jurisdiction,e.tax_statement_identifier,e.tax_coverage_period_start,e.tax_coverage_period_end,e.tax_obligation_basis,e.controlled_property_ref,e.parcel_identifier
    FROM refs_read_ai_invoice_classification_source_v2(p_tenant,p_entity,p_period,p_limit) s
    LEFT JOIN wbs_final1_payable_document_evidence e ON e.tenant_id=p_tenant AND e.entity_id=p_entity AND e.source_document_id=s.source_document_id AND e.source_document_line_id=s.source_document_line_id
   ORDER BY s.accounting_date,s.source_document_id,s.source_document_line_id
$$;

ALTER FUNCTION refs_read_ai_invoice_decision_population_page(uuid,uuid,uuid,date,uuid,integer,uuid,integer) RENAME TO refs_read_ai_invoice_decision_population_page_v295;
REVOKE ALL ON FUNCTION refs_read_ai_invoice_decision_population_page_v295(uuid,uuid,uuid,date,uuid,integer,uuid,integer) FROM PUBLIC,refs_app;
CREATE FUNCTION refs_read_ai_invoice_decision_population_page(p_tenant uuid,p_entity uuid,p_period uuid,p_after_date date DEFAULT NULL,p_after_document uuid DEFAULT NULL,p_after_line_no integer DEFAULT NULL,p_after_line uuid DEFAULT NULL,p_page_size integer DEFAULT 250)
RETURNS TABLE(line_no integer,source_document_id uuid,source_document_line_id uuid,source_payload_hash text,source_line_hash text,tenant_id uuid,entity_id uuid,accounting_period_id uuid,accounting_date date,vendor_ref text,vendor_member_ref text,invoice_no text,invoice_date date,currency text,amount text,service_period_start date,service_period_end date,description text,project_ref text,property_ref text,member_ref text,charge_code text,contract_id text,service_frequency text,source_attachment_count integer,source_attachment_ids uuid[],source_attachment_evidence jsonb,accounting_status text,posted_debit_account_classes text[],duplicate_status text,retained_outcome text,retained_exception_codes jsonb,source_status text,document_evidence_status text,document_evidence_schema_version text,document_evidence_hash text,document_kind text,taxing_jurisdiction text,tax_statement_identifier text,tax_coverage_period_start date,tax_coverage_period_end date,tax_obligation_basis text,controlled_property_ref text,parcel_identifier text)
LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
  SELECT s.*,COALESCE(e.evidence_status,'MISSING'),e.schema_version,e.evidence_hash,e.document_kind,e.taxing_jurisdiction,e.tax_statement_identifier,e.tax_coverage_period_start,e.tax_coverage_period_end,e.tax_obligation_basis,e.controlled_property_ref,e.parcel_identifier
    FROM refs_read_ai_invoice_decision_population_page_v295(p_tenant,p_entity,p_period,p_after_date,p_after_document,p_after_line_no,p_after_line,p_page_size) s
    LEFT JOIN wbs_final1_payable_document_evidence e ON e.tenant_id=p_tenant AND e.entity_id=p_entity AND e.source_document_id=s.source_document_id AND e.source_document_line_id=s.source_document_line_id
   ORDER BY s.accounting_date,s.source_document_id,s.line_no,s.source_document_line_id
$$;

REVOKE ALL ON wbs_final1_payable_document_evidence FROM PUBLIC,refs_app;
GRANT SELECT ON wbs_final1_payable_document_evidence TO refs_app;
REVOKE ALL ON FUNCTION refs_wbs_final1_payable_document_evidence_hash(uuid,uuid,uuid,uuid,uuid,text,text,text,text,text,text,date,date,text,text,text),refs_retain_wbs_final1_source_evidence_with_signed_controls(uuid,uuid,jsonb,jsonb,jsonb,text,text),refs_read_ai_invoice_classification_source_v3(uuid,uuid,uuid,integer),refs_read_ai_invoice_decision_population_page(uuid,uuid,uuid,date,uuid,integer,uuid,integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION refs_wbs_final1_payable_document_evidence_hash(uuid,uuid,uuid,uuid,uuid,text,text,text,text,text,text,date,date,text,text,text) FROM refs_app;
GRANT EXECUTE ON FUNCTION refs_retain_wbs_final1_source_evidence_with_signed_controls(uuid,uuid,jsonb,jsonb,jsonb,text,text),refs_read_ai_invoice_classification_source_v3(uuid,uuid,uuid,integer),refs_read_ai_invoice_decision_population_page(uuid,uuid,uuid,date,uuid,integer,uuid,integer) TO refs_app;

COMMIT;
