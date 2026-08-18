BEGIN;

ALTER TABLE wbs_final1_retained_evidence_admission DROP CONSTRAINT wbs_final1_retained_evidence_admission_domain_check;
ALTER TABLE wbs_final1_retained_evidence_admission ADD CONSTRAINT wbs_final1_retained_evidence_admission_domain_check CHECK(domain IN ('PAYABLES','INSURANCE','BANK','COST','PROPERTY'));
ALTER TABLE wbs_final1_retained_evidence_admission DROP CONSTRAINT wbs_final1_retained_evidence_admission_check;
ALTER TABLE wbs_final1_retained_evidence_admission ADD CONSTRAINT wbs_final1_retained_evidence_admission_mapping_check CHECK(
  (domain='INSURANCE' AND company_mapping_hash IS NOT NULL) OR
  (domain IN ('PAYABLES','BANK','COST','PROPERTY') AND company_mapping_hash IS NULL)
);

CREATE TABLE wbs_final1_signed_control_total (
  tenant_id uuid NOT NULL,
  entity_id uuid NOT NULL,
  wbs_final1_retained_evidence_admission_id uuid NOT NULL,
  domain text NOT NULL CHECK(domain IN ('PAYABLES','INSURANCE','BANK','COST','PROPERTY')),
  row_count integer NOT NULL CHECK(row_count>0),
  per_currency_totals jsonb NOT NULL CHECK(jsonb_typeof(per_currency_totals)='array' AND jsonb_array_length(per_currency_totals)>0),
  control_totals_hash text NOT NULL CHECK(control_totals_hash ~ '^sha256:[0-9a-f]{64}$'),
  created_by text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY(tenant_id,entity_id,wbs_final1_retained_evidence_admission_id),
  FOREIGN KEY(tenant_id,entity_id,wbs_final1_retained_evidence_admission_id,domain)
    REFERENCES wbs_final1_retained_evidence_admission(tenant_id,entity_id,wbs_final1_retained_evidence_admission_id,domain)
);

CREATE TABLE wbs_final1_signed_business_source_row (
  wbs_final1_signed_business_source_row_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  entity_id uuid NOT NULL,
  wbs_final1_retained_evidence_admission_id uuid NOT NULL,
  domain text NOT NULL CHECK(domain IN ('BANK','COST','PROPERTY')),
  source_tool text NOT NULL CHECK(source_tool IN ('list_bank_transactions','list_control_totals')),
  source_record_id text NOT NULL CHECK(length(btrim(source_record_id)) BETWEEN 1 AND 512),
  source_row_ordinal integer NOT NULL CHECK(source_row_ordinal>=0),
  source_version text NOT NULL CHECK(length(btrim(source_version)) BETWEEN 1 AND 512),
  raw_row_hash text NOT NULL CHECK(raw_row_hash ~ '^sha256:[0-9a-f]{64}$'),
  raw_event_id uuid NOT NULL,
  source_document_id uuid NOT NULL,
  source_document_line_id uuid NOT NULL,
  accounting_period_id uuid NOT NULL,
  outcome text NOT NULL CHECK(outcome IN ('STAGING_REVIEW_REQUIRED','CONTROL_EVIDENCE_ONLY')),
  retained_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE(tenant_id,entity_id,wbs_final1_retained_evidence_admission_id,source_record_id),
  UNIQUE(tenant_id,entity_id,wbs_final1_retained_evidence_admission_id,source_row_ordinal),
  UNIQUE(tenant_id,entity_id,wbs_final1_signed_business_source_row_id),
  FOREIGN KEY(tenant_id,entity_id,wbs_final1_retained_evidence_admission_id,domain)
    REFERENCES wbs_final1_retained_evidence_admission(tenant_id,entity_id,wbs_final1_retained_evidence_admission_id,domain),
  FOREIGN KEY(tenant_id,raw_event_id) REFERENCES raw_event(tenant_id,raw_event_id),
  FOREIGN KEY(tenant_id,entity_id,source_document_id) REFERENCES source_document(tenant_id,entity_id,source_document_id),
  FOREIGN KEY(tenant_id,entity_id,source_document_line_id) REFERENCES source_document_line(tenant_id,entity_id,source_document_line_id),
  FOREIGN KEY(tenant_id,entity_id,accounting_period_id) REFERENCES accounting_period(tenant_id,entity_id,period_id),
  CHECK((domain='BANK' AND source_tool='list_bank_transactions' AND outcome='STAGING_REVIEW_REQUIRED') OR
        (domain IN ('COST','PROPERTY') AND source_tool='list_control_totals' AND outcome='CONTROL_EVIDENCE_ONLY'))
);

ALTER TABLE wbs_final1_signed_control_total ENABLE ROW LEVEL SECURITY;
ALTER TABLE wbs_final1_signed_business_source_row ENABLE ROW LEVEL SECURITY;
CREATE POLICY wbs_final1_signed_control_total_scope ON wbs_final1_signed_control_total USING(tenant_id=refs_current_tenant() AND refs_entity_allowed(entity_id)) WITH CHECK(tenant_id=refs_current_tenant() AND refs_entity_allowed(entity_id));
CREATE POLICY wbs_final1_signed_business_source_row_scope ON wbs_final1_signed_business_source_row USING(tenant_id=refs_current_tenant() AND refs_entity_allowed(entity_id)) WITH CHECK(tenant_id=refs_current_tenant() AND refs_entity_allowed(entity_id));
CREATE TRIGGER wbs_final1_signed_control_total_append_only BEFORE UPDATE OR DELETE ON wbs_final1_signed_control_total FOR EACH ROW EXECUTE FUNCTION reject_mutation();
CREATE TRIGGER wbs_final1_signed_business_source_row_append_only BEFORE UPDATE OR DELETE ON wbs_final1_signed_business_source_row FOR EACH ROW EXECUTE FUNCTION reject_mutation();

CREATE FUNCTION refs_wbs_final1_control_totals_hash(p_row_count integer,p_totals jsonb) RETURNS text
LANGUAGE sql IMMUTABLE SET search_path=pg_catalog,public,pg_temp AS $$
  SELECT refs_jsonb_hash(jsonb_build_object('row_count',p_row_count,'per_currency_totals',p_totals))
$$;

CREATE FUNCTION refs_assert_wbs_final1_signed_artifacts(p_delivery jsonb,p_artifacts jsonb) RETURNS void
LANGUAGE plpgsql SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE v_artifact text;
BEGIN
  IF jsonb_typeof(p_artifacts)<>'object' OR (SELECT count(*) FROM jsonb_object_keys(p_artifacts))<>4 THEN RAISE EXCEPTION 'Final-1 requires exactly four immutable artifacts' USING ERRCODE='22023'; END IF;
  FOREACH v_artifact IN ARRAY ARRAY['receipt','request','response','package'] LOOP
    IF NOT (p_artifacts ? v_artifact) OR (SELECT count(*) FROM jsonb_object_keys(p_artifacts->v_artifact))<>9
       OR p_artifacts#>>ARRAY[v_artifact,'storage_ref'] !~ '^s3://'
       OR COALESCE(p_artifacts#>>ARRAY[v_artifact,'storage_version'],'')='' OR p_artifacts#>>ARRAY[v_artifact,'storage_version'] ~ '^pending:'
       OR p_artifacts#>>ARRAY[v_artifact,'content_hash'] !~ '^sha256:[0-9a-f]{64}$'
       OR p_artifacts#>>ARRAY[v_artifact,'content_hash'] IS DISTINCT FROM CASE v_artifact WHEN 'receipt' THEN p_delivery->>'receipt_hash' WHEN 'request' THEN p_delivery->>'request_raw_hash' WHEN 'response' THEN p_delivery->>'response_raw_hash' ELSE p_delivery->>'package_raw_hash' END
       OR COALESCE(p_artifacts#>>ARRAY[v_artifact,'size_bytes'],'') !~ '^[1-9][0-9]{0,7}$' OR (p_artifacts#>>ARRAY[v_artifact,'size_bytes'])::bigint>33554432
       OR p_artifacts#>>ARRAY[v_artifact,'media_type'] IS DISTINCT FROM CASE WHEN v_artifact IN ('receipt','package') THEN 'application/json' ELSE 'application/octet-stream' END
       OR p_artifacts#>>ARRAY[v_artifact,'retentionMode']<>'COMPLIANCE' OR (p_artifacts#>>ARRAY[v_artifact,'retainUntil'])::timestamptz<=clock_timestamp()
       OR (p_artifacts#>>ARRAY[v_artifact,'scan_clean'])::boolean IS DISTINCT FROM true
       OR p_artifacts#>>ARRAY[v_artifact,'scan_ref'] IS DISTINCT FROM 'clamav:'||substring(p_artifacts#>>ARRAY[v_artifact,'content_hash'] from 8)||':clean' THEN
      RAISE EXCEPTION 'Every Final-1 artifact requires exact hash, size, media type, immutable COMPLIANCE version, future retention, and CLEAN scan' USING ERRCODE='22023';
    END IF;
  END LOOP;
END;
$$;

CREATE FUNCTION refs_record_wbs_final1_signed_control_total(p_tenant uuid,p_entity uuid,p_admission uuid,p_row_count integer,p_totals jsonb,p_hash text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE v_actor text:=refs_current_actor();v_domain text;v_existing wbs_final1_signed_control_total;v_prior text:='';v_item jsonb;v_audit uuid:=gen_random_uuid();v_payload jsonb;v_recomputed_count integer;v_recomputed_totals jsonb;
BEGIN
  PERFORM refs_assert_scope(p_tenant,p_entity,'WBS.SNAPSHOT.IMPORT');
  IF v_actor IS NULL THEN RAISE EXCEPTION 'Authenticated Final-1 service actor missing' USING ERRCODE='42501'; END IF;
  SELECT domain INTO v_domain FROM wbs_final1_retained_evidence_admission WHERE tenant_id=p_tenant AND entity_id=p_entity AND wbs_final1_retained_evidence_admission_id=p_admission AND row_count=p_row_count AND retained_by=v_actor FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Exact Final-1 admission is missing for signed controls' USING ERRCODE='P0002'; END IF;
  IF jsonb_typeof(p_totals)<>'array' OR jsonb_array_length(p_totals)=0 OR p_hash IS DISTINCT FROM refs_wbs_final1_control_totals_hash(p_row_count,p_totals) THEN RAISE EXCEPTION 'Signed control totals are malformed or hash-mismatched' USING ERRCODE='22023'; END IF;
  FOR v_item IN SELECT value FROM jsonb_array_elements(p_totals) LOOP
    IF (SELECT count(*) FROM jsonb_object_keys(v_item))<>2 OR NOT (v_item ?& ARRAY['currency','gross_amount']) OR v_item->>'currency' !~ '^[A-Z]{3}$' OR v_item->>'currency'<=v_prior OR v_item->>'gross_amount' !~ '^(0|[1-9][0-9]{0,17})\.[0-9]{4}$' THEN RAISE EXCEPTION 'Signed currency controls are not closed ordered MONEY4 rows' USING ERRCODE='22023'; END IF;
    v_prior:=v_item->>'currency';
  END LOOP;
  WITH population AS (
    SELECT d.currency,abs(d.gross_amount)::numeric(20,4) gross_amount FROM wbs_final1_retained_source_row r JOIN source_document d ON d.tenant_id=r.tenant_id AND d.entity_id=r.entity_id AND d.source_document_id=r.source_document_id WHERE r.tenant_id=p_tenant AND r.entity_id=p_entity AND r.wbs_final1_retained_evidence_admission_id=p_admission
    UNION ALL
    SELECT d.currency,abs(d.gross_amount)::numeric(20,4) gross_amount FROM wbs_final1_signed_business_source_row r JOIN source_document d ON d.tenant_id=r.tenant_id AND d.entity_id=r.entity_id AND d.source_document_id=r.source_document_id WHERE r.tenant_id=p_tenant AND r.entity_id=p_entity AND r.wbs_final1_retained_evidence_admission_id=p_admission
  ), grouped AS (SELECT currency,sum(gross_amount)::numeric(20,4) gross_amount FROM population GROUP BY currency)
  SELECT (SELECT count(*)::integer FROM population),jsonb_agg(jsonb_build_object('currency',currency,'gross_amount',gross_amount::text) ORDER BY currency) INTO v_recomputed_count,v_recomputed_totals FROM grouped;
  IF v_recomputed_count IS DISTINCT FROM p_row_count OR v_recomputed_totals IS DISTINCT FROM p_totals THEN RAISE EXCEPTION 'Signed control totals differ from the exact persisted source population' USING ERRCODE='23514'; END IF;
  SELECT * INTO v_existing FROM wbs_final1_signed_control_total WHERE tenant_id=p_tenant AND entity_id=p_entity AND wbs_final1_retained_evidence_admission_id=p_admission;
  IF FOUND THEN
    IF v_existing.domain IS DISTINCT FROM v_domain OR v_existing.row_count IS DISTINCT FROM p_row_count OR v_existing.per_currency_totals IS DISTINCT FROM p_totals OR v_existing.control_totals_hash IS DISTINCT FROM p_hash OR v_existing.created_by IS DISTINCT FROM v_actor THEN RAISE EXCEPTION 'Signed control total replay conflicts with retained evidence' USING ERRCODE='23505'; END IF;
    RETURN jsonb_build_object('status','WBS_FINAL1_SIGNED_CONTROL_TOTAL_REPLAY','admission_id',p_admission,'control_totals_hash',p_hash,'idempotent',true);
  END IF;
  INSERT INTO wbs_final1_signed_control_total(tenant_id,entity_id,wbs_final1_retained_evidence_admission_id,domain,row_count,per_currency_totals,control_totals_hash,created_by) VALUES(p_tenant,p_entity,p_admission,v_domain,p_row_count,p_totals,p_hash,v_actor);
  v_payload:=jsonb_build_object('schema_version','WBS_FINAL1_SIGNED_CONTROL_TOTAL_V1','admission_id',p_admission,'domain',v_domain,'row_count',p_row_count,'per_currency_totals',p_totals,'control_totals_hash',p_hash,'can_create_transaction',false,'can_create_draft',false,'can_post',false);
  INSERT INTO audit_event(audit_event_id,tenant_id,entity_id,event_type,object_type,object_id,action,actor_id,actor_type,permission_used,request_id,correlation_id,after_hash,reason,metadata) VALUES(v_audit,p_tenant,p_entity,'WBS_FINAL1_SIGNED_CONTROL_TOTAL_RETAINED','WBS_FINAL1_RETAINED_EVIDENCE_ADMISSION',p_admission,'RETAIN',v_actor,'SERVICE_ACCOUNT','WBS.SNAPSHOT.IMPORT',p_admission::text,p_admission::text,p_hash,'Provider-signed controls recomputed and retained',v_payload);
  INSERT INTO outbox_event(tenant_id,entity_id,aggregate_type,aggregate_id,event_type,payload,payload_hash) VALUES(p_tenant,p_entity,'WBS_FINAL1_RETAINED_EVIDENCE_ADMISSION',p_admission,'WBS_FINAL1_SIGNED_CONTROL_TOTAL_RETAINED',v_payload,refs_jsonb_hash(v_payload));
  RETURN jsonb_build_object('status','WBS_FINAL1_SIGNED_CONTROL_TOTAL_RETAINED','admission_id',p_admission,'control_totals_hash',p_hash,'idempotent',false);
END;
$$;

CREATE FUNCTION refs_wbs_final1_business_evidence_hash(p_tenant uuid,p_entity uuid,p_delivery jsonb,p_artifacts jsonb,p_plan jsonb) RETURNS text
LANGUAGE sql IMMUTABLE SET search_path=pg_catalog,public,pg_temp AS $$
  SELECT refs_jsonb_hash(jsonb_build_object('schema_version','WBS_FINAL1_SIGNED_BUSINESS_EVIDENCE_V1','tenant_id',p_tenant,'entity_id',p_entity,'delivery',p_delivery,'artifacts',p_artifacts,'plan',p_plan))
$$;

CREATE FUNCTION refs_retain_wbs_final1_business_evidence(p_tenant uuid,p_entity uuid,p_delivery jsonb,p_artifacts jsonb,p_plan jsonb,p_idempotency_key text,p_request_hash text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE v_actor text:=refs_current_actor();v_domain text:=p_delivery->>'domain';v_tool text:=p_delivery->>'source_tool';v_company text:=p_delivery->>'company_code';v_rows jsonb:=p_plan->'evidence_rows';v_row jsonb;v_expected integer:=0;v_period uuid;v_period_count integer;v_import uuid:=gen_random_uuid();v_admission uuid:=(p_delivery->>'admission_id')::uuid;v_raw uuid;v_doc uuid;v_line uuid;v_business_row uuid;v_amount numeric(20,4);v_date date;v_status source_status;v_payload jsonb;v_response jsonb;v_idem idempotency_receipt;v_computed_totals jsonb;v_computed_hash text;v_mapping_count integer;
BEGIN
  PERFORM refs_assert_scope(p_tenant,p_entity,'WBS.SNAPSHOT.IMPORT');
  IF v_actor IS NULL THEN RAISE EXCEPTION 'Authenticated Final-1 service actor missing' USING ERRCODE='42501'; END IF;
  IF v_domain NOT IN ('BANK','COST','PROPERTY') OR (v_domain='BANK' AND v_tool<>'list_bank_transactions') OR (v_domain IN ('COST','PROPERTY') AND v_tool<>'list_control_totals') THEN RAISE EXCEPTION 'Final-1 business domain/tool is not server allowlisted' USING ERRCODE='22023'; END IF;
  IF p_request_hash IS DISTINCT FROM refs_wbs_final1_business_evidence_hash(p_tenant,p_entity,p_delivery,p_artifacts,p_plan) THEN RAISE EXCEPTION 'Final-1 business request hash is not canonical' USING ERRCODE='22023'; END IF;
  IF jsonb_typeof(v_rows)<>'array' OR jsonb_array_length(v_rows)=0 OR jsonb_array_length(v_rows)<>(p_delivery->>'row_count')::integer OR p_plan->>'status'<>'NORMALIZED_FINAL1_BUSINESS_EVIDENCE_PLAN' OR p_plan#>>'{provenance,tenant_id}' IS DISTINCT FROM p_tenant::text OR p_plan#>>'{provenance,entity_id}' IS DISTINCT FROM p_entity::text OR p_plan#>>'{provenance,domain}' IS DISTINCT FROM v_domain OR p_plan#>>'{provenance,source_tool}' IS DISTINCT FROM v_tool OR p_plan#>>'{provenance,control_totals_hash}' IS DISTINCT FROM p_delivery->>'control_totals_hash' OR COALESCE((p_plan->>'can_create_transaction')::boolean,true) OR COALESCE((p_plan->>'can_create_draft')::boolean,true) OR COALESCE((p_plan->>'can_post')::boolean,true) THEN RAISE EXCEPTION 'Final-1 business plan is malformed or action-enabled' USING ERRCODE='22023'; END IF;
  PERFORM refs_assert_wbs_final1_signed_artifacts(p_delivery,p_artifacts);
  SELECT count(*) INTO v_mapping_count FROM wbs_company_catalog_controller_decision d WHERE d.tenant_id=p_tenant AND d.entity_id=p_entity AND d.decision_type='APPROVED' AND d.active_status='ACTIVE' AND d.company_code=v_company AND d.base_currency='USD' AND d.effective_from<=(p_delivery->>'date_from')::date AND (d.effective_to IS NULL OR d.effective_to>=(p_delivery->>'date_to')::date) AND d.mapping_document->>'refs_entity_id'=p_entity::text AND d.mapping_document->>'mapping_hash'=d.mapping_hash AND refs_jsonb_hash(d.mapping_document-'mapping_hash')=d.mapping_hash;
  IF v_mapping_count<>1 THEN RAISE EXCEPTION 'Final-1 business company mapping is missing or ambiguous' USING ERRCODE='42501'; END IF;
  SELECT jsonb_agg(jsonb_build_object('currency',currency,'gross_amount',gross::numeric(20,4)::text) ORDER BY currency) INTO v_computed_totals FROM (SELECT value->>'currency' currency,sum(abs((value->>'gross_amount')::numeric(20,4))) gross FROM jsonb_array_elements(v_rows) GROUP BY value->>'currency') q;
  v_computed_hash:=refs_wbs_final1_control_totals_hash(jsonb_array_length(v_rows),v_computed_totals);
  IF v_computed_totals IS DISTINCT FROM p_delivery->'per_currency_totals' OR v_computed_hash IS DISTINCT FROM p_delivery->>'control_totals_hash' THEN RAISE EXCEPTION 'Final-1 business signed controls differ from normalized rows' USING ERRCODE='23514'; END IF;
  FOR v_row IN SELECT value FROM jsonb_array_elements(v_rows) LOOP
    IF (v_row->>'source_row_ordinal')::integer IS DISTINCT FROM v_expected OR v_row->>'source_domain' IS DISTINCT FROM v_domain OR v_row->>'source_module' IS DISTINCT FROM v_tool OR v_row->>'provider_snapshot_id' IS DISTINCT FROM p_delivery->>'snapshot_id' OR v_row->>'provider_package_hash' IS DISTINCT FROM p_delivery->>'package_hash' OR v_row->>'provider_raw_package_hash' IS DISTINCT FROM p_delivery->>'package_raw_hash' OR v_row->>'provider_company_code' IS DISTINCT FROM v_company OR v_row->>'currency'<>'USD' OR v_row->>'raw_row_hash' !~ '^sha256:[0-9a-f]{64}$' OR v_row->>'gross_amount' !~ '^(0|[1-9][0-9]{0,17})\.[0-9]{4}$' OR (v_domain='BANK' AND v_row->>'outcome'<>'STAGING_REVIEW_REQUIRED') OR (v_domain IN ('COST','PROPERTY') AND v_row->>'outcome'<>'CONTROL_EVIDENCE_ONLY') OR COALESCE((v_row->>'can_create_transaction')::boolean,true) OR COALESCE((v_row->>'can_create_draft')::boolean,true) OR COALESCE((v_row->>'can_post')::boolean,true) THEN RAISE EXCEPTION 'Final-1 normalized business row is malformed or action-enabled' USING ERRCODE='22023'; END IF;
    v_date:=(v_row->>'business_date')::date;
    SELECT count(*),CASE WHEN count(*)=1 THEN min(period_id::text)::uuid ELSE NULL END INTO v_period_count,v_period FROM accounting_period WHERE tenant_id=p_tenant AND entity_id=p_entity AND ledger_code='PRIMARY' AND starts_on<=v_date AND ends_on>=v_date;
    IF v_period_count<>1 THEN RAISE EXCEPTION 'Final-1 business row period is missing or ambiguous' USING ERRCODE='23514'; END IF;
    v_expected:=v_expected+1;
  END LOOP;
  INSERT INTO idempotency_receipt(tenant_id,operation_scope,idempotency_key,request_hash,status,actor_id) VALUES(p_tenant,'WBS_FINAL1_SIGNED_BUSINESS:'||p_entity||':'||v_domain,p_idempotency_key,p_request_hash,'IN_PROGRESS',v_actor) ON CONFLICT(tenant_id,operation_scope,idempotency_key) DO NOTHING;
  SELECT * INTO v_idem FROM idempotency_receipt WHERE tenant_id=p_tenant AND operation_scope='WBS_FINAL1_SIGNED_BUSINESS:'||p_entity||':'||v_domain AND idempotency_key=p_idempotency_key FOR UPDATE;
  IF v_idem.request_hash IS DISTINCT FROM p_request_hash OR v_idem.actor_id IS DISTINCT FROM v_actor THEN RAISE EXCEPTION 'Final-1 business idempotency key conflicts with actor or payload' USING ERRCODE='23505'; END IF;
  IF v_idem.status='SUCCEEDED' THEN RETURN v_idem.response_body||jsonb_build_object('idempotent',true); END IF;
  INSERT INTO import_batch(import_batch_id,tenant_id,entity_id,connector_code,source_module,source_entity_id,idempotency_key,request_hash,status,cursor_before,cursor_after,request_id,row_count,started_at,completed_at) VALUES(v_import,p_tenant,p_entity,'WBS_PROVIDER_FINAL1',v_tool,v_company,p_idempotency_key,p_request_hash,'SUCCEEDED','{}',jsonb_build_object('snapshot_id',p_delivery->>'snapshot_id'),p_idempotency_key,jsonb_array_length(v_rows),clock_timestamp(),clock_timestamp());
  INSERT INTO wbs_final1_retained_evidence_admission(wbs_final1_retained_evidence_admission_id,tenant_id,entity_id,domain,issuer,key_id,algorithm,nonce,company_code,company_mapping_hash,signed_at,expires_at,observation_at,date_from,date_to,snapshot_id,receipt_hash,receipt_storage_ref,receipt_storage_version,receipt_size_bytes,request_raw_hash,request_storage_ref,request_storage_version,request_size_bytes,response_raw_hash,response_storage_ref,response_storage_version,response_size_bytes,package_raw_hash,package_hash,package_storage_ref,package_storage_version,package_size_bytes,evidence_retain_until,plan_hash,request_hash,import_batch_id,row_count,retained_by) VALUES(v_admission,p_tenant,p_entity,v_domain,p_delivery->>'issuer',p_delivery->>'key_id','Ed25519',p_delivery->>'nonce',v_company,NULL,(p_delivery->>'signed_at')::timestamptz,(p_delivery->>'expires_at')::timestamptz,(p_delivery->>'observation_at')::timestamptz,(p_delivery->>'date_from')::date,(p_delivery->>'date_to')::date,(p_delivery->>'snapshot_id')::uuid,p_delivery->>'receipt_hash',p_artifacts#>>'{receipt,storage_ref}',p_artifacts#>>'{receipt,storage_version}',(p_artifacts#>>'{receipt,size_bytes}')::bigint,p_delivery->>'request_raw_hash',p_artifacts#>>'{request,storage_ref}',p_artifacts#>>'{request,storage_version}',(p_artifacts#>>'{request,size_bytes}')::bigint,p_delivery->>'response_raw_hash',p_artifacts#>>'{response,storage_ref}',p_artifacts#>>'{response,storage_version}',(p_artifacts#>>'{response,size_bytes}')::bigint,p_delivery->>'package_raw_hash',p_delivery->>'package_hash',p_artifacts#>>'{package,storage_ref}',p_artifacts#>>'{package,storage_version}',(p_artifacts#>>'{package,size_bytes}')::bigint,(p_artifacts#>>'{package,retainUntil}')::timestamptz,p_plan->>'plan_hash',p_request_hash,v_import,jsonb_array_length(v_rows),v_actor);
  FOR v_row IN SELECT value FROM jsonb_array_elements(v_rows) LOOP
    v_raw:=gen_random_uuid();v_doc:=gen_random_uuid();v_line:=gen_random_uuid();v_business_row:=gen_random_uuid();v_amount:=(v_row->>'gross_amount')::numeric(20,4);v_date:=(v_row->>'business_date')::date;
    SELECT period_id INTO STRICT v_period FROM accounting_period WHERE tenant_id=p_tenant AND entity_id=p_entity AND ledger_code='PRIMARY' AND starts_on<=v_date AND ends_on>=v_date;
    v_status:=CASE WHEN v_domain='BANK' THEN 'PENDING_REVIEW'::source_status ELSE 'QUARANTINED'::source_status END;
    INSERT INTO raw_event(raw_event_id,tenant_id,entity_id,import_batch_id,source_system,source_module,source_entity_id,source_record_id,source_version,event_type,occurred_at,payload_hash,payload_ref,correlation_id) VALUES(v_raw,p_tenant,p_entity,v_import,'WBS',v_tool,v_company,v_row->>'source_record_id',v_row->>'source_version','UPSERT',v_date::timestamptz,v_row->>'raw_row_hash',(p_artifacts#>>'{package,storage_ref}')||'#versionId='||(p_artifacts#>>'{package,storage_version}'),p_idempotency_key);
    INSERT INTO source_document(source_document_id,tenant_id,entity_id,raw_event_id,source_system,source_module,source_entity_id,source_record_id,source_version,document_type,document_no,business_date,accounting_date,currency,gross_amount,status,source_ref,payload_hash) VALUES(v_doc,p_tenant,p_entity,v_raw,'WBS',v_tool,v_company,v_row->>'source_record_id',v_row->>'source_version','WBS_FINAL1_'||v_domain,NULL,v_date,v_date,'USD',v_amount,v_status,(p_artifacts#>>'{package,storage_ref}')||'#versionId='||(p_artifacts#>>'{package,storage_version}')||'&row_ordinal='||(v_row->>'source_row_ordinal'),v_row->>'raw_row_hash');
    INSERT INTO source_document_line(source_document_line_id,tenant_id,entity_id,source_document_id,source_line_id,line_no,amount,direction,description,external_dimension_refs) VALUES(v_line,p_tenant,p_entity,v_doc,v_row->>'source_primary_key',1,v_amount,'NONE','Provider-signed '||v_domain||' evidence',jsonb_build_object('schema_version','WBS_FINAL1_SIGNED_BUSINESS_SOURCE_LINE_V1','domain',v_domain,'source_tool',v_tool,'snapshot_id',p_delivery->>'snapshot_id','control_totals_hash',v_computed_hash,'package_storage_version',p_artifacts#>>'{package,storage_version}','raw_row_hash',v_row->>'raw_row_hash','action_authority','NONE'));
    INSERT INTO source_link(tenant_id,entity_id,link_type,raw_event_id,source_document_id,source_document_line_id,created_by) VALUES(p_tenant,p_entity,'WBS_FINAL1_RETAINED_SOURCE',v_raw,v_doc,v_line,v_actor);
    INSERT INTO wbs_final1_signed_business_source_row(wbs_final1_signed_business_source_row_id,tenant_id,entity_id,wbs_final1_retained_evidence_admission_id,domain,source_tool,source_record_id,source_row_ordinal,source_version,raw_row_hash,raw_event_id,source_document_id,source_document_line_id,accounting_period_id,outcome) VALUES(v_business_row,p_tenant,p_entity,v_admission,v_domain,v_tool,v_row->>'source_record_id',(v_row->>'source_row_ordinal')::integer,v_row->>'source_version',v_row->>'raw_row_hash',v_raw,v_doc,v_line,v_period,v_row->>'outcome');
    v_payload:=jsonb_build_object('schema_version','WBS_FINAL1_SIGNED_BUSINESS_SOURCE_ROW_V1','admission_id',v_admission,'source_row_id',v_business_row,'domain',v_domain,'source_document_id',v_doc,'source_document_line_id',v_line,'accounting_period_id',v_period,'raw_row_hash',v_row->>'raw_row_hash','control_totals_hash',v_computed_hash,'can_create_transaction',false,'can_create_draft',false,'can_post',false);
    INSERT INTO audit_event(tenant_id,entity_id,event_type,object_type,object_id,action,actor_id,actor_type,permission_used,request_id,correlation_id,idempotency_key,after_hash,reason,metadata) VALUES(p_tenant,p_entity,'WBS_FINAL1_SIGNED_BUSINESS_SOURCE_RETAINED','WBS_FINAL1_SIGNED_BUSINESS_SOURCE_ROW',v_business_row,'RETAIN',v_actor,'SERVICE_ACCOUNT','WBS.SNAPSHOT.IMPORT',p_idempotency_key,p_idempotency_key,p_idempotency_key,v_row->>'raw_row_hash','Provider-signed business evidence retained without accounting authority',v_payload);
    INSERT INTO outbox_event(tenant_id,entity_id,aggregate_type,aggregate_id,event_type,payload,payload_hash) VALUES(p_tenant,p_entity,'WBS_FINAL1_SIGNED_BUSINESS_SOURCE_ROW',v_business_row,'WBS_FINAL1_SIGNED_BUSINESS_SOURCE_RETAINED',v_payload,refs_jsonb_hash(v_payload));
  END LOOP;
  PERFORM refs_record_wbs_final1_signed_control_total(p_tenant,p_entity,v_admission,jsonb_array_length(v_rows),v_computed_totals,v_computed_hash);
  v_response:=jsonb_build_object('status','WBS_FINAL1_RETAINED_SOURCE_EVIDENCE','admission_id',v_admission,'domain',v_domain,'row_count',jsonb_array_length(v_rows),'control_totals_hash',v_computed_hash,'signature_verified',true,'can_write_wbs',false,'can_propose_amortization',false,'can_create_draft',false,'can_review',false,'can_approve',false,'can_post',false,'idempotent',false);
  UPDATE idempotency_receipt SET status='SUCCEEDED',response_status=201,response_body=v_response,completed_at=clock_timestamp() WHERE idempotency_receipt_id=v_idem.idempotency_receipt_id;
  RETURN v_response;
END;
$$;

CREATE FUNCTION refs_retain_wbs_final1_source_evidence_with_signed_controls(p_tenant uuid,p_entity uuid,p_delivery jsonb,p_artifacts jsonb,p_plan jsonb,p_idempotency_key text,p_request_hash text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE v_result jsonb;
BEGIN
  PERFORM refs_assert_wbs_final1_signed_artifacts(p_delivery,p_artifacts);
  v_result:=refs_retain_wbs_final1_source_evidence(p_tenant,p_entity,p_delivery,p_artifacts,p_plan,p_idempotency_key,p_request_hash);
  PERFORM refs_record_wbs_final1_signed_control_total(p_tenant,p_entity,(v_result->>'admission_id')::uuid,(p_delivery->>'row_count')::integer,p_delivery->'per_currency_totals',p_delivery->>'control_totals_hash');
  RETURN v_result;
END;
$$;

REVOKE ALL ON wbs_final1_signed_control_total,wbs_final1_signed_business_source_row FROM PUBLIC,refs_app;
GRANT SELECT ON wbs_final1_signed_control_total,wbs_final1_signed_business_source_row TO refs_app;
REVOKE ALL ON FUNCTION refs_wbs_final1_control_totals_hash(integer,jsonb),refs_assert_wbs_final1_signed_artifacts(jsonb,jsonb),refs_record_wbs_final1_signed_control_total(uuid,uuid,uuid,integer,jsonb,text),refs_wbs_final1_business_evidence_hash(uuid,uuid,jsonb,jsonb,jsonb),refs_retain_wbs_final1_business_evidence(uuid,uuid,jsonb,jsonb,jsonb,text,text),refs_retain_wbs_final1_source_evidence_with_signed_controls(uuid,uuid,jsonb,jsonb,jsonb,text,text) FROM PUBLIC;
REVOKE ALL ON FUNCTION refs_assert_wbs_final1_signed_artifacts(jsonb,jsonb),refs_record_wbs_final1_signed_control_total(uuid,uuid,uuid,integer,jsonb,text) FROM refs_app;
REVOKE ALL ON FUNCTION refs_retain_wbs_final1_source_evidence(uuid,uuid,jsonb,jsonb,jsonb,text,text) FROM refs_app;
GRANT EXECUTE ON FUNCTION refs_wbs_final1_control_totals_hash(integer,jsonb),refs_wbs_final1_business_evidence_hash(uuid,uuid,jsonb,jsonb,jsonb),refs_retain_wbs_final1_business_evidence(uuid,uuid,jsonb,jsonb,jsonb,text,text),refs_retain_wbs_final1_source_evidence_with_signed_controls(uuid,uuid,jsonb,jsonb,jsonb,text,text) TO refs_app;

COMMIT;
