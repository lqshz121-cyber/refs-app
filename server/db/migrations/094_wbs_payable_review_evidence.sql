BEGIN;

INSERT INTO permission_catalog(permission_code,domain,risk_class,sod_class)
  VALUES('WBS.PAYABLE.REVIEW','WBS','HIGH','WBS_PAYABLE_REVIEWER')
  ON CONFLICT (permission_code) DO NOTHING;

CREATE UNIQUE INDEX wbs_inbound_receipt_tenant_entity_id_uq
  ON wbs_inbound_receipt(tenant_id,entity_id,receipt_id);
CREATE UNIQUE INDEX wbs_inbound_row_tenant_entity_id_uq
  ON wbs_inbound_row(tenant_id,entity_id,wbs_inbound_row_id);
CREATE UNIQUE INDEX attachment_tenant_entity_id_uq
  ON attachment(tenant_id,entity_id,attachment_id);

CREATE TABLE wbs_payable_review_evidence (
  wbs_payable_review_evidence_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant(tenant_id),
  entity_id uuid NOT NULL,
  wbs_inbound_row_id uuid NOT NULL,
  receipt_id uuid NOT NULL,
  wbs_snapshot_import_id uuid NOT NULL,
  wbs_snapshot_receipt_id uuid NOT NULL,
  raw_event_id uuid NOT NULL,
  source_document_id uuid NOT NULL,
  rule_evaluation_id uuid NOT NULL,
  staging_item_id uuid NOT NULL,
  setting_snapshot_id uuid NOT NULL,
  mapping_snapshot_id uuid NOT NULL,
  period_id uuid NOT NULL,
  document_number text CHECK(document_number IS NULL OR length(document_number) BETWEEN 1 AND 128),
  invoice_date date NOT NULL,
  due_date date,
  source_version text NOT NULL,
  receipt_hash text NOT NULL CHECK(receipt_hash ~ '^sha256:[0-9a-f]{64}$'),
  evidence_hash text NOT NULL CHECK(evidence_hash ~ '^sha256:[0-9a-f]{64}$'),
  review_reason text NOT NULL CHECK(length(btrim(review_reason)) BETWEEN 8 AND 2000),
  reviewed_by text NOT NULL,
  reviewed_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  request_hash text NOT NULL CHECK(request_hash ~ '^sha256:[0-9a-f]{64}$'),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE(tenant_id,entity_id,wbs_inbound_row_id),
  UNIQUE(tenant_id,entity_id,wbs_payable_review_evidence_id),
  UNIQUE(tenant_id,entity_id,raw_event_id),
  UNIQUE(tenant_id,entity_id,source_document_id),
  UNIQUE(tenant_id,entity_id,staging_item_id),
  FOREIGN KEY(tenant_id,entity_id) REFERENCES entity(tenant_id,entity_id),
  FOREIGN KEY(tenant_id,entity_id,wbs_inbound_row_id) REFERENCES wbs_inbound_row(tenant_id,entity_id,wbs_inbound_row_id),
  FOREIGN KEY(tenant_id,entity_id,receipt_id) REFERENCES wbs_inbound_receipt(tenant_id,entity_id,receipt_id),
  FOREIGN KEY(tenant_id,entity_id,wbs_snapshot_import_id) REFERENCES wbs_snapshot_import(tenant_id,entity_id,wbs_snapshot_import_id),
  FOREIGN KEY(tenant_id,entity_id,wbs_snapshot_receipt_id) REFERENCES wbs_snapshot_receipt(tenant_id,entity_id,wbs_snapshot_receipt_id),
  FOREIGN KEY(tenant_id,raw_event_id) REFERENCES raw_event(tenant_id,raw_event_id),
  FOREIGN KEY(tenant_id,entity_id,source_document_id) REFERENCES source_document(tenant_id,entity_id,source_document_id),
  FOREIGN KEY(tenant_id,rule_evaluation_id) REFERENCES rule_evaluation(tenant_id,rule_evaluation_id),
  FOREIGN KEY(tenant_id,entity_id,staging_item_id) REFERENCES staging_item(tenant_id,entity_id,staging_item_id),
  FOREIGN KEY(tenant_id,setting_snapshot_id) REFERENCES setting_snapshot(tenant_id,setting_snapshot_id),
  FOREIGN KEY(tenant_id,mapping_snapshot_id) REFERENCES mapping_snapshot(tenant_id,mapping_snapshot_id),
  FOREIGN KEY(tenant_id,entity_id,period_id) REFERENCES accounting_period(tenant_id,entity_id,period_id)
);

CREATE TABLE wbs_payable_review_attachment (
  tenant_id uuid NOT NULL,
  entity_id uuid NOT NULL,
  wbs_payable_review_evidence_id uuid NOT NULL,
  attachment_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY(tenant_id,entity_id,wbs_payable_review_evidence_id,attachment_id),
  FOREIGN KEY(tenant_id,entity_id,wbs_payable_review_evidence_id) REFERENCES wbs_payable_review_evidence(tenant_id,entity_id,wbs_payable_review_evidence_id),
  FOREIGN KEY(tenant_id,entity_id,attachment_id) REFERENCES attachment(tenant_id,entity_id,attachment_id)
);

ALTER TABLE wbs_payable_review_evidence ENABLE ROW LEVEL SECURITY;
ALTER TABLE wbs_payable_review_attachment ENABLE ROW LEVEL SECURITY;
CREATE POLICY wbs_payable_review_evidence_scope_policy ON wbs_payable_review_evidence
  USING(tenant_id=refs_current_tenant() AND refs_entity_allowed(entity_id))
  WITH CHECK(tenant_id=refs_current_tenant() AND refs_entity_allowed(entity_id));
CREATE POLICY wbs_payable_review_attachment_scope_policy ON wbs_payable_review_attachment
  USING(tenant_id=refs_current_tenant() AND refs_entity_allowed(entity_id))
  WITH CHECK(tenant_id=refs_current_tenant() AND refs_entity_allowed(entity_id));
CREATE TRIGGER wbs_payable_review_evidence_append_only BEFORE UPDATE OR DELETE ON wbs_payable_review_evidence
  FOR EACH ROW EXECUTE FUNCTION reject_mutation();
CREATE TRIGGER wbs_payable_review_attachment_append_only BEFORE UPDATE OR DELETE ON wbs_payable_review_attachment
  FOR EACH ROW EXECUTE FUNCTION reject_mutation();

CREATE FUNCTION refs_wbs_payable_review_evidence_hash(
  p_row uuid,p_source_record_id text,p_source_version text,p_receipt_hash text,
  p_raw jsonb,p_normalized jsonb,p_outcome jsonb,p_outcome_kind text
) RETURNS text
LANGUAGE sql IMMUTABLE SET search_path=pg_catalog,public,pg_temp AS $$
  SELECT refs_jsonb_hash(jsonb_build_object(
    'wbs_inbound_row_id',p_row,'source_record_id',p_source_record_id,'source_version',p_source_version,
    'receipt_hash',p_receipt_hash,'raw',p_raw,'normalized',p_normalized,
    'outcome',p_outcome,'outcome_kind',p_outcome_kind
  ))
$$;

CREATE FUNCTION refs_wbs_payable_iso_date(p_value text) RETURNS date
LANGUAGE plpgsql IMMUTABLE SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE parsed date;
BEGIN
  IF p_value IS NULL OR p_value !~ '^[0-9]{4}-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])$' THEN RETURN NULL; END IF;
  BEGIN parsed:=p_value::date; EXCEPTION WHEN datetime_field_overflow OR invalid_datetime_format THEN RETURN NULL; END;
  IF to_char(parsed,'YYYY-MM-DD')<>p_value THEN RETURN NULL; END IF;
  RETURN parsed;
END;
$$;

CREATE FUNCTION refs_review_wbs_payable_hash(
  p_tenant uuid,p_entity uuid,p_row uuid,p_period uuid,p_expected_revision bigint,
  p_expected_source_version text,p_expected_receipt_hash text,p_expected_evidence_hash text,
  p_setting uuid,p_mapping uuid,p_attachment_ids uuid[],p_reason text
) RETURNS text
LANGUAGE sql IMMUTABLE SET search_path=pg_catalog,public,pg_temp AS $$
  SELECT refs_jsonb_hash(jsonb_build_object(
    'tenant_id',p_tenant,'entity_id',p_entity,'wbs_inbound_row_id',p_row,'period_id',p_period,
    'expected_revision',p_expected_revision,'expected_source_version',p_expected_source_version,
    'expected_receipt_hash',p_expected_receipt_hash,'expected_evidence_hash',p_expected_evidence_hash,
    'setting_snapshot_id',p_setting,'mapping_snapshot_id',p_mapping,
    'attachment_ids',to_jsonb(ARRAY(SELECT value FROM unnest(COALESCE(p_attachment_ids,'{}'::uuid[])) value ORDER BY value)),
    'reason',btrim(p_reason)
  ))
$$;

CREATE FUNCTION refs_review_wbs_payable(
  p_tenant uuid,p_entity uuid,p_row uuid,p_period uuid,p_expected_revision bigint,
  p_expected_source_version text,p_expected_receipt_hash text,p_expected_evidence_hash text,
  p_setting uuid,p_mapping uuid,p_attachment_ids uuid[],p_reason text,
  p_idempotency_key text,p_request_hash text
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE actor text:=refs_current_actor(); idem idempotency_receipt; row_record wbs_inbound_row; inbound_receipt wbs_inbound_receipt;
DECLARE snapshot_import wbs_snapshot_import; snapshot_receipt wbs_snapshot_receipt; entity_row entity; period_row accounting_period;
DECLARE setting_row setting_snapshot; mapping_row mapping_snapshot; mapping_input jsonb; normalized jsonb; outcome jsonb;
DECLARE evidence_hash text; computed_hash text; vendor_ref text; vendor_name text; offset_account text; source_direction text;
DECLARE document_number text; invoice_date date; invoice_date_text text; due_date date; due_date_text text;
DECLARE amount_multiplier numeric; source_amount numeric(20,4); reviewed_amount numeric(20,4); accounting_date date; business_date date; currency text; company_key text;
DECLARE rule_code text; rule_version bigint; raw_id uuid:=gen_random_uuid(); document_id uuid:=gen_random_uuid(); rule_id uuid:=gen_random_uuid(); staging_id uuid:=gen_random_uuid(); review_id uuid:=gen_random_uuid();
DECLARE matched_facts jsonb; rule_result jsonb; input_digest text; evaluation_digest text; response jsonb; event_payload jsonb;
DECLARE setting_count integer; mapping_count integer; attachment_count integer; attachment_distinct_count integer;
BEGIN
  PERFORM refs_assert_scope(p_tenant,p_entity,'WBS.PAYABLE.REVIEW');
  IF actor IS NULL THEN RAISE EXCEPTION 'Authenticated actor missing' USING ERRCODE='42501'; END IF;
  computed_hash:=refs_review_wbs_payable_hash(p_tenant,p_entity,p_row,p_period,p_expected_revision,p_expected_source_version,p_expected_receipt_hash,p_expected_evidence_hash,p_setting,p_mapping,p_attachment_ids,p_reason);
  IF p_request_hash<>computed_hash THEN RAISE EXCEPTION 'WBS payable review request hash is not canonical' USING ERRCODE='22023'; END IF;
  IF p_expected_revision<>0 THEN RAISE EXCEPTION 'WBS payable evidence revision conflict' USING ERRCODE='40001'; END IF;
  IF p_expected_receipt_hash !~ '^sha256:[0-9a-f]{64}$' OR p_expected_evidence_hash !~ '^sha256:[0-9a-f]{64}$'
     OR length(btrim(COALESCE(p_expected_source_version,'')))=0 OR length(btrim(COALESCE(p_reason,''))) NOT BETWEEN 8 AND 2000
     OR COALESCE(cardinality(p_attachment_ids),0)=0 THEN
    RAISE EXCEPTION 'WBS payable review evidence, reason and attachments are required' USING ERRCODE='22023';
  END IF;

  INSERT INTO idempotency_receipt(tenant_id,operation_scope,idempotency_key,request_hash,status,actor_id)
    VALUES(p_tenant,'WBS_PAYABLE_REVIEW:'||p_entity,p_idempotency_key,p_request_hash,'IN_PROGRESS',actor)
    ON CONFLICT (tenant_id,operation_scope,idempotency_key) DO NOTHING;
  SELECT * INTO idem FROM idempotency_receipt
    WHERE tenant_id=p_tenant AND operation_scope='WBS_PAYABLE_REVIEW:'||p_entity AND idempotency_key=p_idempotency_key FOR UPDATE;
  IF idem.request_hash<>p_request_hash THEN RAISE EXCEPTION 'Idempotency key reused with different request hash' USING ERRCODE='23505'; END IF;
  IF idem.status='SUCCEEDED' THEN RETURN idem.response_body||jsonb_build_object('idempotent',true); END IF;

  SELECT * INTO row_record FROM wbs_inbound_row
    WHERE tenant_id=p_tenant AND entity_id=p_entity AND wbs_inbound_row_id=p_row FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'WBS payable row not found' USING ERRCODE='P0002'; END IF;
  SELECT * INTO inbound_receipt FROM wbs_inbound_receipt
    WHERE tenant_id=p_tenant AND entity_id=p_entity AND receipt_id=row_record.receipt_id FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'WBS payable receipt not found' USING ERRCODE='23514'; END IF;
  SELECT * INTO snapshot_import FROM wbs_snapshot_import
    WHERE tenant_id=p_tenant AND entity_id=p_entity AND import_batch_id=inbound_receipt.import_batch_id AND environment='PRODUCTION' FOR SHARE;
  IF NOT FOUND OR NOT EXISTS(
    SELECT 1 FROM wbs_snapshot_delivery_attestation d
    WHERE d.tenant_id=p_tenant AND d.entity_id=p_entity AND d.wbs_snapshot_import_id=snapshot_import.wbs_snapshot_import_id
  ) THEN RAISE EXCEPTION 'WBS payable review requires an exact admitted production snapshot' USING ERRCODE='23514'; END IF;
  SELECT * INTO snapshot_receipt FROM wbs_snapshot_receipt
    WHERE tenant_id=p_tenant AND entity_id=p_entity AND wbs_snapshot_import_id=snapshot_import.wbs_snapshot_import_id
      AND source_module='BGDATA.payable' AND ingestion_kind='TRANSACTION_CANDIDATE'
      AND source_record_id=row_record.source_record_id AND source_version=row_record.source_version
      AND payload_hash=inbound_receipt.receipt_hash AND payload_ref=inbound_receipt.payload_ref FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'WBS payable row is not backed by the exact signed snapshot receipt' USING ERRCODE='23514'; END IF;

  evidence_hash:=refs_wbs_payable_review_evidence_hash(row_record.wbs_inbound_row_id,row_record.source_record_id,row_record.source_version,inbound_receipt.receipt_hash,row_record.raw,row_record.normalized,row_record.outcome,row_record.outcome_kind);
  IF row_record.source_version<>p_expected_source_version OR inbound_receipt.receipt_hash<>p_expected_receipt_hash OR evidence_hash<>p_expected_evidence_hash THEN
    RAISE EXCEPTION 'WBS payable evidence revision conflict' USING ERRCODE='40001';
  END IF;
  normalized:=row_record.normalized;outcome:=row_record.outcome;
  IF row_record.outcome_kind<>'STAGING' OR outcome->>'stage' IS DISTINCT FROM 'STAGING_REVIEW_REQUIRED'
     OR normalized->>'source_system' IS DISTINCT FROM 'WBS' OR normalized->>'source_type' IS DISTINCT FROM 'PAYABLE'
     OR normalized->>'source_record_id' IS DISTINCT FROM row_record.source_record_id OR normalized->>'source_version' IS DISTINCT FROM row_record.source_version
     OR normalized->>'receipt_hash' IS DISTINCT FROM inbound_receipt.receipt_hash THEN
    RAISE EXCEPTION 'Only exact immutable WBS Payable staging evidence may be reviewed' USING ERRCODE='23514';
  END IF;

  SELECT * INTO entity_row FROM entity WHERE tenant_id=p_tenant AND entity_id=p_entity AND active FOR SHARE;
  company_key:=btrim(normalized->>'company_key');currency:=upper(btrim(normalized->>'currency'));
  IF NOT FOUND OR company_key IS NULL OR currency IS NULL OR entity_row.source_system<>'WBS'
     OR entity_row.source_entity_id IS DISTINCT FROM company_key OR entity_row.base_currency IS DISTINCT FROM currency OR currency !~ '^[A-Z]{3}$' THEN
    RAISE EXCEPTION 'WBS payable company or currency scope is invalid' USING ERRCODE='23514';
  END IF;
  accounting_date:=refs_wbs_payable_iso_date(normalized->>'accounting_date');business_date:=refs_wbs_payable_iso_date(normalized->>'business_date');
  IF accounting_date IS NULL OR business_date IS NULL THEN
    RAISE EXCEPTION 'WBS payable business and accounting dates must be canonical YYYY-MM-DD' USING ERRCODE='23514';
  END IF;
  IF COALESCE(jsonb_typeof(row_record.raw->'external_trace'),'null')<>'object'
     OR row_record.raw->'external_trace' IS DISTINCT FROM normalized->'external_trace'
     OR COALESCE(normalized->>'external_trace_hash','') !~ '^sha256:[0-9a-f]{64}$' THEN
    RAISE EXCEPTION 'WBS payable provider trace is not bound to the signed normalized evidence' USING ERRCODE='23514';
  END IF;
  -- These are exact provider fields retained by the signed package. No
  -- payable number, source id, display label, or accounting date is used as a
  -- substitute when the provider omitted invoice_no or pay_due_date.
  document_number:=NULLIF(btrim(row_record.raw->'external_trace'->>'invoice_no'),'');
  IF document_number IS NOT NULL AND (length(document_number)>128 OR document_number~'[\x00-\x1f\x7f]') THEN
    RAISE EXCEPTION 'WBS payable invoice number is outside the reviewed evidence contract' USING ERRCODE='23514';
  END IF;
  invoice_date_text:=NULLIF(btrim(row_record.raw->'external_trace'->>'invoice_date'),'');
  invoice_date:=refs_wbs_payable_iso_date(invoice_date_text);
  IF invoice_date IS NULL THEN
    RAISE EXCEPTION 'WBS payable invoice date must be canonical YYYY-MM-DD' USING ERRCODE='23514';
  END IF;
  due_date_text:=NULLIF(btrim(row_record.raw->'external_trace'->>'pay_due_date'),'');
  due_date:=refs_wbs_payable_iso_date(due_date_text);
  IF due_date_text IS NOT NULL AND due_date IS NULL THEN
    RAISE EXCEPTION 'WBS payable due date must be canonical YYYY-MM-DD' USING ERRCODE='23514';
  END IF;
  IF due_date IS NOT NULL AND due_date<invoice_date THEN
    RAISE EXCEPTION 'WBS payable due date cannot precede invoice date' USING ERRCODE='23514';
  END IF;
  SELECT * INTO period_row FROM accounting_period
    WHERE tenant_id=p_tenant AND entity_id=p_entity AND period_id=p_period AND status='OPEN'
      AND accounting_date BETWEEN starts_on AND ends_on FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'WBS payable accounting date requires the exact OPEN period' USING ERRCODE='55000'; END IF;

  SELECT count(*) INTO setting_count FROM setting_snapshot s
    WHERE s.tenant_id=p_tenant AND s.entity_id=p_entity AND s.family='WBS_PAYABLE_AP_REVIEW'
      AND s.scope_type='ENTITY' AND s.scope_key=p_entity::text AND s.status='APPROVED'
      AND accounting_date::timestamptz>=s.effective_from AND (s.effective_to IS NULL OR accounting_date::timestamptz<s.effective_to)
      AND clock_timestamp()>=s.effective_from AND (s.effective_to IS NULL OR clock_timestamp()<s.effective_to)
      AND s.snapshot_hash=refs_jsonb_hash(s.snapshot);
  SELECT * INTO setting_row FROM setting_snapshot s
    WHERE s.tenant_id=p_tenant AND s.entity_id=p_entity AND s.setting_snapshot_id=p_setting
      AND s.family='WBS_PAYABLE_AP_REVIEW' AND s.scope_type='ENTITY' AND s.scope_key=p_entity::text AND s.status='APPROVED'
      AND accounting_date::timestamptz>=s.effective_from AND (s.effective_to IS NULL OR accounting_date::timestamptz<s.effective_to)
      AND clock_timestamp()>=s.effective_from AND (s.effective_to IS NULL OR clock_timestamp()<s.effective_to)
      AND s.snapshot_hash=refs_jsonb_hash(s.snapshot) FOR SHARE;
  IF setting_count<>1 OR NOT FOUND THEN RAISE EXCEPTION 'WBS payable review requires one exact approved setting snapshot' USING ERRCODE='23514'; END IF;

  vendor_ref:=btrim(normalized->>'vendor_ref');source_direction:=upper(btrim(normalized->>'direction'));
  mapping_input:=jsonb_build_object('company_key',company_key,'currency',currency,'vendor_ref',vendor_ref,'cost_code_ref',normalized->'cost_code_ref');
  SELECT count(*) INTO mapping_count FROM mapping_snapshot m
    WHERE m.tenant_id=p_tenant AND m.entity_id=p_entity AND m.family='WBS_PAYABLE_AP'
      AND m.scope_type='ENTITY' AND m.scope_key=p_entity::text AND m.status='APPROVED'
      AND m.input_keys=mapping_input AND m.input_key_hash=refs_jsonb_hash(mapping_input)
      AND accounting_date::timestamptz>=m.effective_from AND (m.effective_to IS NULL OR accounting_date::timestamptz<m.effective_to)
      AND clock_timestamp()>=m.effective_from AND (m.effective_to IS NULL OR clock_timestamp()<m.effective_to)
      AND m.priority=(SELECT max(x.priority) FROM mapping_snapshot x WHERE x.tenant_id=m.tenant_id AND x.entity_id=m.entity_id
        AND x.family=m.family AND x.scope_type=m.scope_type AND x.scope_key=m.scope_key AND x.status='APPROVED'
        AND x.input_keys=mapping_input AND x.input_key_hash=refs_jsonb_hash(mapping_input)
        AND accounting_date::timestamptz>=x.effective_from AND (x.effective_to IS NULL OR accounting_date::timestamptz<x.effective_to)
        AND clock_timestamp()>=x.effective_from AND (x.effective_to IS NULL OR clock_timestamp()<x.effective_to));
  SELECT * INTO mapping_row FROM mapping_snapshot m
    WHERE m.tenant_id=p_tenant AND m.entity_id=p_entity AND m.mapping_snapshot_id=p_mapping
      AND m.family='WBS_PAYABLE_AP' AND m.scope_type='ENTITY' AND m.scope_key=p_entity::text AND m.status='APPROVED'
      AND m.input_keys=mapping_input AND m.input_key_hash=refs_jsonb_hash(mapping_input)
      AND accounting_date::timestamptz>=m.effective_from AND (m.effective_to IS NULL OR accounting_date::timestamptz<m.effective_to)
      AND clock_timestamp()>=m.effective_from AND (m.effective_to IS NULL OR clock_timestamp()<m.effective_to)
      AND m.priority=(SELECT max(x.priority) FROM mapping_snapshot x WHERE x.tenant_id=m.tenant_id AND x.entity_id=m.entity_id
        AND x.family=m.family AND x.scope_type=m.scope_type AND x.scope_key=m.scope_key AND x.status='APPROVED'
        AND x.input_keys=mapping_input AND x.input_key_hash=refs_jsonb_hash(mapping_input)
        AND accounting_date::timestamptz>=x.effective_from AND (x.effective_to IS NULL OR accounting_date::timestamptz<x.effective_to)
        AND clock_timestamp()>=x.effective_from AND (x.effective_to IS NULL OR clock_timestamp()<x.effective_to))
      AND m.snapshot_hash=refs_jsonb_hash(jsonb_build_object('input_keys',m.input_keys,'output_rules',m.output_rules)) FOR SHARE;
  IF mapping_count<>1 OR NOT FOUND THEN RAISE EXCEPTION 'WBS payable review requires one exact approved mapping snapshot' USING ERRCODE='23514'; END IF;
  IF actor IN (snapshot_import.created_by,setting_row.created_by,setting_row.approved_by,mapping_row.created_by,mapping_row.approved_by) THEN
    RAISE EXCEPTION 'WBS payable reviewer SoD violation' USING ERRCODE='42501';
  END IF;

  offset_account:=btrim(mapping_row.output_rules->>'offset_account_code');rule_code:=btrim(mapping_row.output_rules->>'rule_code');
  IF vendor_ref IS NULL OR source_direction IS NULL OR mapping_row.output_rules->>'vendor_ref' IS DISTINCT FROM vendor_ref
     OR mapping_row.output_rules->>'source_direction' IS DISTINCT FROM source_direction
     OR COALESCE(mapping_row.output_rules->>'amount_multiplier','') NOT IN ('1','-1')
     OR COALESCE(mapping_row.output_rules->>'rule_version','') !~ '^[1-9][0-9]*$'
     OR COALESCE(normalized->>'amount_money4','') !~ '^-?(0|[1-9][0-9]*)(\.[0-9]{4})$'
     OR length(offset_account)=0 OR length(rule_code)=0 THEN
    RAISE EXCEPTION 'WBS payable AP mapping output is incomplete or outside source scope' USING ERRCODE='23514';
  END IF;
  amount_multiplier:=(mapping_row.output_rules->>'amount_multiplier')::numeric;source_amount:=(normalized->>'amount_money4')::numeric(20,4);
  reviewed_amount:=(source_amount*amount_multiplier)::numeric(20,4);rule_version:=(mapping_row.output_rules->>'rule_version')::bigint;
  IF reviewed_amount<=0 OR source_direction NOT IN ('DEBIT','CREDIT') THEN RAISE EXCEPTION 'WBS payable mapping did not produce a positive reviewed amount' USING ERRCODE='23514'; END IF;
  SELECT display_name INTO vendor_name FROM member_master
    WHERE tenant_id=p_tenant AND entity_id=p_entity AND member_ref=vendor_ref AND member_type='VENDOR' AND active FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Mapped WBS payable vendor is not an active local VENDOR' USING ERRCODE='23503'; END IF;
  PERFORM 1 FROM account_master WHERE tenant_id=p_tenant AND entity_id=p_entity AND account_code=offset_account AND active FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Mapped WBS payable offset account is inactive or missing' USING ERRCODE='23503'; END IF;
  PERFORM 1 FROM account_master WHERE tenant_id=p_tenant AND entity_id=p_entity AND account_code='291001' AND active AND requires_member AND required_member_type='VENDOR' FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'WBS payable requires the active 291001 VENDOR control account' USING ERRCODE='23503'; END IF;

  attachment_count:=cardinality(p_attachment_ids);
  PERFORM 1 FROM attachment a
    WHERE a.tenant_id=p_tenant AND a.entity_id=p_entity AND a.attachment_id=ANY(p_attachment_ids)
      AND a.finalization_status='VERIFIED_CLEAN' AND a.scan_status='CLEAN' AND a.verified_at IS NOT NULL AND a.finalized_at IS NOT NULL
    FOR SHARE;
  SELECT count(DISTINCT a.attachment_id) INTO attachment_distinct_count FROM attachment a
    WHERE a.tenant_id=p_tenant AND a.entity_id=p_entity AND a.attachment_id=ANY(p_attachment_ids)
      AND a.finalization_status='VERIFIED_CLEAN' AND a.scan_status='CLEAN' AND a.verified_at IS NOT NULL AND a.finalized_at IS NOT NULL;
  IF attachment_count<>attachment_distinct_count OR attachment_count<>(SELECT count(DISTINCT value) FROM unnest(p_attachment_ids) value) THEN
    RAISE EXCEPTION 'WBS payable review requires unique verified-clean entity attachments' USING ERRCODE='23503';
  END IF;

  INSERT INTO raw_event(raw_event_id,tenant_id,entity_id,import_batch_id,source_system,source_module,source_entity_id,source_record_id,source_version,event_type,occurred_at,payload_hash,payload_ref,correlation_id)
    VALUES(raw_id,p_tenant,p_entity,snapshot_import.import_batch_id,'WBS','payable',snapshot_receipt.source_entity_id,row_record.source_record_id,row_record.source_version,'UPSERT',accounting_date::timestamptz,inbound_receipt.receipt_hash,inbound_receipt.payload_ref,p_idempotency_key);
  INSERT INTO source_document(source_document_id,tenant_id,entity_id,raw_event_id,source_system,source_module,source_entity_id,source_record_id,source_version,document_type,document_no,business_date,accounting_date,currency,gross_amount,status,source_ref,payload_hash)
    VALUES(document_id,p_tenant,p_entity,raw_id,'WBS','payable',snapshot_receipt.source_entity_id,row_record.source_record_id,row_record.source_version,'WBS_PAYABLE',document_number,business_date,accounting_date,currency,reviewed_amount,'READY_FOR_DRAFT',inbound_receipt.payload_ref,inbound_receipt.receipt_hash);
  matched_facts:=jsonb_build_object('wbs_inbound_row_id',p_row,'company_key',company_key,'currency',currency,'vendor_ref',vendor_ref,'cost_code_ref',normalized->'cost_code_ref','document_number',document_number,'invoice_date',invoice_date,'due_date',due_date,'source_amount',normalized->>'amount_money4','source_direction',source_direction,'source_version',row_record.source_version,'receipt_hash',inbound_receipt.receipt_hash);
  rule_result:=jsonb_build_object('vendor_ref',vendor_ref,'vendor_name',vendor_name,'offset_account_code',offset_account,'document_number',document_number,'invoice_date',invoice_date,'due_date',due_date,'gross_amount',to_char(reviewed_amount,'FM9999999999999990.0000'),'currency',currency,'period_id',p_period,'can_create_draft',false,'can_approve',false,'can_post',false);
  input_digest:=evidence_hash;evaluation_digest:=refs_rule_evaluation_hash(document_id,p_setting,p_mapping,rule_code,rule_version,matched_facts,rule_result,input_digest);
  INSERT INTO rule_evaluation(rule_evaluation_id,tenant_id,source_document_id,setting_snapshot_id,mapping_snapshot_id,rule_code,rule_version,matched_facts,result,confidence,reason,input_digest,evaluation_digest,evaluated_at)
    VALUES(rule_id,p_tenant,document_id,p_setting,p_mapping,rule_code,rule_version,matched_facts,rule_result,1,btrim(p_reason),input_digest,evaluation_digest,clock_timestamp());
  INSERT INTO staging_item(staging_item_id,tenant_id,entity_id,source_document_id,setting_snapshot_id,mapping_snapshot_id,rule_evaluation_id,status,version,reviewed_by,reviewed_at)
    VALUES(staging_id,p_tenant,p_entity,document_id,p_setting,p_mapping,rule_id,'READY_FOR_DRAFT',0,actor,clock_timestamp());
  INSERT INTO source_link(tenant_id,entity_id,link_type,raw_event_id,source_document_id,staging_item_id,created_by)
    VALUES(p_tenant,p_entity,'WBS_PAYABLE_REVIEW',raw_id,document_id,staging_id,actor);
  INSERT INTO source_link(tenant_id,entity_id,link_type,source_document_id,staging_item_id,attachment_id,created_by)
    SELECT p_tenant,p_entity,'SOURCE_ATTACHMENT',document_id,staging_id,value,actor FROM unnest(p_attachment_ids) value;
  INSERT INTO wbs_payable_review_evidence(wbs_payable_review_evidence_id,tenant_id,entity_id,wbs_inbound_row_id,receipt_id,wbs_snapshot_import_id,wbs_snapshot_receipt_id,raw_event_id,source_document_id,rule_evaluation_id,staging_item_id,setting_snapshot_id,mapping_snapshot_id,period_id,document_number,invoice_date,due_date,source_version,receipt_hash,evidence_hash,review_reason,reviewed_by,request_hash)
    VALUES(review_id,p_tenant,p_entity,p_row,inbound_receipt.receipt_id,snapshot_import.wbs_snapshot_import_id,snapshot_receipt.wbs_snapshot_receipt_id,raw_id,document_id,rule_id,staging_id,p_setting,p_mapping,p_period,document_number,invoice_date,due_date,row_record.source_version,inbound_receipt.receipt_hash,evidence_hash,btrim(p_reason),actor,p_request_hash);
  INSERT INTO wbs_payable_review_attachment(tenant_id,entity_id,wbs_payable_review_evidence_id,attachment_id)
    SELECT p_tenant,p_entity,review_id,value FROM unnest(p_attachment_ids) value;

  event_payload:=jsonb_build_object('wbs_payable_review_evidence_id',review_id,'wbs_inbound_row_id',p_row,'source_document_id',document_id,'staging_item_id',staging_id,'setting_snapshot_id',p_setting,'mapping_snapshot_id',p_mapping,'period_id',p_period,'evidence_hash',evidence_hash,'attachment_count',attachment_count,'status','READY_FOR_DRAFT_EVIDENCE_ONLY');
  INSERT INTO audit_event(tenant_id,entity_id,event_type,object_type,object_id,action,actor_id,actor_type,permission_used,request_id,correlation_id,idempotency_key,after_hash,reason,metadata)
    VALUES(p_tenant,p_entity,'WBS_PAYABLE_REVIEWED','WBS_PAYABLE_REVIEW',review_id,'REVIEW',actor,'USER','WBS.PAYABLE.REVIEW',p_idempotency_key,p_idempotency_key,p_idempotency_key,p_request_hash,btrim(p_reason),event_payload);
  INSERT INTO outbox_event(tenant_id,entity_id,aggregate_type,aggregate_id,event_type,payload,payload_hash)
    VALUES(p_tenant,p_entity,'WBS_PAYABLE_REVIEW',review_id,'WBS_PAYABLE_REVIEWED',event_payload,refs_jsonb_hash(event_payload));
  response:=jsonb_build_object('wbs_payable_review_evidence_id',review_id,'wbs_inbound_row_id',p_row,'source_document_id',document_id,'staging_item_id',staging_id,'status','READY_FOR_DRAFT_EVIDENCE_ONLY','revision',0,'idempotent',false,'can_create_draft',false,'can_approve',false,'can_post',false);
  UPDATE idempotency_receipt SET status='SUCCEEDED',response_status=201,response_body=response,completed_at=clock_timestamp() WHERE idempotency_receipt_id=idem.idempotency_receipt_id;
  RETURN response;
END;
$$;

REVOKE ALL ON wbs_payable_review_evidence,wbs_payable_review_attachment FROM PUBLIC,refs_app;
GRANT SELECT ON wbs_payable_review_evidence,wbs_payable_review_attachment TO refs_app;
REVOKE EXECUTE ON FUNCTION refs_wbs_payable_review_evidence_hash(uuid,text,text,text,jsonb,jsonb,jsonb,text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION refs_wbs_payable_iso_date(text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION refs_review_wbs_payable_hash(uuid,uuid,uuid,uuid,bigint,text,text,text,uuid,uuid,uuid[],text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION refs_review_wbs_payable(uuid,uuid,uuid,uuid,bigint,text,text,text,uuid,uuid,uuid[],text,text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION refs_wbs_payable_review_evidence_hash(uuid,text,text,text,jsonb,jsonb,jsonb,text) TO refs_app;
GRANT EXECUTE ON FUNCTION refs_wbs_payable_iso_date(text) TO refs_app;
GRANT EXECUTE ON FUNCTION refs_review_wbs_payable_hash(uuid,uuid,uuid,uuid,bigint,text,text,text,uuid,uuid,uuid[],text) TO refs_app;
GRANT EXECUTE ON FUNCTION refs_review_wbs_payable(uuid,uuid,uuid,uuid,bigint,text,text,text,uuid,uuid,uuid[],text,text,text) TO refs_app;

COMMIT;
