BEGIN;

-- Provider Final-1 is retained as evidence before any accounting workflow.
-- The import service may create only immutable raw/source records, explicit
-- exceptions, and source-bound prepaid coverage evidence/findings.  It never
-- marks a source READY_FOR_DRAFT and never creates a journal or ledger row.
CREATE TABLE wbs_final1_retained_evidence_admission (
  wbs_final1_retained_evidence_admission_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant(tenant_id),
  entity_id uuid NOT NULL,
  domain text NOT NULL CHECK(domain IN ('PAYABLES','INSURANCE')),
  issuer text NOT NULL CHECK(length(btrim(issuer)) BETWEEN 1 AND 128),
  key_id text NOT NULL CHECK(length(btrim(key_id)) BETWEEN 1 AND 128),
  algorithm text NOT NULL CHECK(algorithm='Ed25519'),
  nonce text NOT NULL CHECK(length(btrim(nonce)) BETWEEN 1 AND 128),
  company_code text NOT NULL CHECK(company_code ~ '^[A-Z0-9][A-Z0-9_-]{0,63}$'),
  company_mapping_hash text CHECK(company_mapping_hash IS NULL OR company_mapping_hash ~ '^sha256:[0-9a-f]{64}$'),
  signed_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL,
  observation_at timestamptz NOT NULL,
  date_from date NOT NULL,
  date_to date NOT NULL,
  snapshot_id uuid NOT NULL,
  receipt_hash text NOT NULL CHECK(receipt_hash ~ '^sha256:[0-9a-f]{64}$'),
  receipt_storage_ref text NOT NULL CHECK(receipt_storage_ref ~ '^s3://'),
  receipt_storage_version text NOT NULL CHECK(length(btrim(receipt_storage_version)) BETWEEN 1 AND 512 AND receipt_storage_version !~ '^pending:'),
  receipt_size_bytes bigint NOT NULL CHECK(receipt_size_bytes BETWEEN 1 AND 33554432),
  request_raw_hash text NOT NULL CHECK(request_raw_hash ~ '^sha256:[0-9a-f]{64}$'),
  request_storage_ref text NOT NULL CHECK(request_storage_ref ~ '^s3://'),
  request_storage_version text NOT NULL CHECK(length(btrim(request_storage_version)) BETWEEN 1 AND 512 AND request_storage_version !~ '^pending:'),
  request_size_bytes bigint NOT NULL CHECK(request_size_bytes BETWEEN 1 AND 33554432),
  response_raw_hash text NOT NULL CHECK(response_raw_hash ~ '^sha256:[0-9a-f]{64}$'),
  response_storage_ref text NOT NULL CHECK(response_storage_ref ~ '^s3://'),
  response_storage_version text NOT NULL CHECK(length(btrim(response_storage_version)) BETWEEN 1 AND 512 AND response_storage_version !~ '^pending:'),
  response_size_bytes bigint NOT NULL CHECK(response_size_bytes BETWEEN 1 AND 33554432),
  package_raw_hash text NOT NULL CHECK(package_raw_hash ~ '^sha256:[0-9a-f]{64}$'),
  package_hash text NOT NULL CHECK(package_hash ~ '^sha256:[0-9a-f]{64}$'),
  package_storage_ref text NOT NULL CHECK(package_storage_ref ~ '^s3://'),
  package_storage_version text NOT NULL CHECK(length(btrim(package_storage_version)) BETWEEN 1 AND 512 AND package_storage_version !~ '^pending:'),
  package_size_bytes bigint NOT NULL CHECK(package_size_bytes BETWEEN 1 AND 33554432),
  evidence_retain_until timestamptz NOT NULL,
  plan_hash text NOT NULL CHECK(plan_hash ~ '^sha256:[0-9a-f]{64}$'),
  request_hash text NOT NULL CHECK(request_hash ~ '^sha256:[0-9a-f]{64}$'),
  import_batch_id uuid NOT NULL,
  row_count integer NOT NULL CHECK(row_count>0),
  retained_by text NOT NULL,
  retained_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE(tenant_id,issuer,key_id,nonce),
  UNIQUE(tenant_id,entity_id,domain,snapshot_id),
  UNIQUE(tenant_id,entity_id,wbs_final1_retained_evidence_admission_id),
  UNIQUE(tenant_id,entity_id,wbs_final1_retained_evidence_admission_id,domain),
  FOREIGN KEY(tenant_id,entity_id) REFERENCES entity(tenant_id,entity_id),
  FOREIGN KEY(tenant_id,import_batch_id) REFERENCES import_batch(tenant_id,import_batch_id),
  CHECK(expires_at>signed_at AND expires_at-signed_at<=interval '15 minutes'),
  CHECK(date_to>=date_from),
  CHECK((domain='INSURANCE' AND company_mapping_hash IS NOT NULL) OR (domain='PAYABLES' AND company_mapping_hash IS NULL))
);

CREATE TABLE wbs_final1_retained_source_row (
  wbs_final1_retained_source_row_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  entity_id uuid NOT NULL,
  wbs_final1_retained_evidence_admission_id uuid NOT NULL,
  domain text NOT NULL CHECK(domain IN ('PAYABLES','INSURANCE')),
  source_record_id text NOT NULL CHECK(length(btrim(source_record_id)) BETWEEN 1 AND 512),
  source_primary_key text NOT NULL CHECK(length(btrim(source_primary_key)) BETWEEN 1 AND 512),
  source_row_ordinal integer NOT NULL CHECK(source_row_ordinal>=0),
  source_version text NOT NULL CHECK(length(btrim(source_version)) BETWEEN 1 AND 512),
  raw_row_hash text NOT NULL CHECK(raw_row_hash ~ '^sha256:[0-9a-f]{64}$'),
  raw_event_id uuid NOT NULL,
  source_document_id uuid NOT NULL,
  source_document_line_id uuid NOT NULL,
  accounting_period_id uuid,
  outcome text NOT NULL CHECK(outcome IN ('STAGING_REVIEW_REQUIRED','EXCEPTION_REVIEW_REQUIRED','AMORTIZATION_COVERAGE_EVIDENCE_CANDIDATE')),
  exception_codes jsonb NOT NULL CHECK(jsonb_typeof(exception_codes)='array'),
  ai_amortization_coverage_evidence_id uuid,
  ai_prepaid_coverage_finding_id uuid,
  retained_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE(tenant_id,entity_id,wbs_final1_retained_source_row_id),
  UNIQUE(tenant_id,entity_id,wbs_final1_retained_evidence_admission_id,source_record_id),
  UNIQUE(tenant_id,entity_id,wbs_final1_retained_evidence_admission_id,source_row_ordinal),
  FOREIGN KEY(tenant_id,entity_id,wbs_final1_retained_evidence_admission_id,domain)
    REFERENCES wbs_final1_retained_evidence_admission(tenant_id,entity_id,wbs_final1_retained_evidence_admission_id,domain),
  FOREIGN KEY(tenant_id,raw_event_id) REFERENCES raw_event(tenant_id,raw_event_id),
  FOREIGN KEY(tenant_id,entity_id,source_document_id) REFERENCES source_document(tenant_id,entity_id,source_document_id),
  FOREIGN KEY(tenant_id,entity_id,source_document_line_id) REFERENCES source_document_line(tenant_id,entity_id,source_document_line_id),
  FOREIGN KEY(tenant_id,entity_id,accounting_period_id) REFERENCES accounting_period(tenant_id,entity_id,period_id),
  FOREIGN KEY(tenant_id,entity_id,ai_amortization_coverage_evidence_id) REFERENCES ai_amortization_coverage_evidence(tenant_id,entity_id,ai_amortization_coverage_evidence_id),
  FOREIGN KEY(tenant_id,entity_id,ai_prepaid_coverage_finding_id) REFERENCES ai_prepaid_coverage_finding(tenant_id,entity_id,ai_prepaid_coverage_finding_id),
  CHECK((domain='PAYABLES' AND ai_amortization_coverage_evidence_id IS NULL AND ai_prepaid_coverage_finding_id IS NULL)
     OR (domain='INSURANCE' AND ((outcome='AMORTIZATION_COVERAGE_EVIDENCE_CANDIDATE' AND ai_amortization_coverage_evidence_id IS NOT NULL AND ai_prepaid_coverage_finding_id IS NULL)
       OR (outcome='EXCEPTION_REVIEW_REQUIRED' AND ai_amortization_coverage_evidence_id IS NULL))))
);

ALTER TABLE wbs_final1_retained_evidence_admission ENABLE ROW LEVEL SECURITY;
ALTER TABLE wbs_final1_retained_source_row ENABLE ROW LEVEL SECURITY;
CREATE POLICY wbs_final1_retained_evidence_admission_scope ON wbs_final1_retained_evidence_admission
  USING(tenant_id=refs_current_tenant() AND refs_entity_allowed(entity_id))
  WITH CHECK(tenant_id=refs_current_tenant() AND refs_entity_allowed(entity_id));
CREATE POLICY wbs_final1_retained_source_row_scope ON wbs_final1_retained_source_row
  USING(tenant_id=refs_current_tenant() AND refs_entity_allowed(entity_id))
  WITH CHECK(tenant_id=refs_current_tenant() AND refs_entity_allowed(entity_id));
CREATE TRIGGER wbs_final1_retained_evidence_admission_append_only BEFORE UPDATE OR DELETE ON wbs_final1_retained_evidence_admission FOR EACH ROW EXECUTE FUNCTION reject_mutation();
CREATE TRIGGER wbs_final1_retained_source_row_append_only BEFORE UPDATE OR DELETE ON wbs_final1_retained_source_row FOR EACH ROW EXECUTE FUNCTION reject_mutation();

CREATE FUNCTION refs_wbs_final1_retained_evidence_hash(
  p_tenant uuid,p_entity uuid,p_delivery jsonb,p_artifacts jsonb,p_plan jsonb
) RETURNS text LANGUAGE sql IMMUTABLE SET search_path=pg_catalog,public,pg_temp AS $$
  SELECT refs_jsonb_hash(jsonb_build_object(
    'schema_version','WBS_FINAL1_RETAINED_SOURCE_EVIDENCE_V1',
    'tenant_id',p_tenant,'entity_id',p_entity,'delivery',p_delivery,'artifacts',p_artifacts,'plan',p_plan
  ))
$$;

CREATE FUNCTION refs_retain_wbs_final1_source_evidence(
  p_tenant uuid,p_entity uuid,p_delivery jsonb,p_artifacts jsonb,p_plan jsonb,
  p_idempotency_key text,p_request_hash text
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE actor text:=refs_current_actor(); idem idempotency_receipt; entity_record entity; approved_mapping record;
DECLARE computed_hash text; domain text:=p_delivery->>'domain'; delivery_company_code text:=p_delivery->>'company_code'; mapping_count integer;
DECLARE plan_rows jsonb; row_value jsonb; normalized jsonb; exception_code jsonb; admission_id uuid:=gen_random_uuid(); import_id uuid:=gen_random_uuid();
DECLARE raw_id uuid; document_id uuid; line_id uuid; row_id uuid; finding_id uuid; evidence_id uuid; business_date date; gross numeric(20,4);
DECLARE source_record text; source_primary_key text; source_version text; normalized_module text:='payable'; description text; package_versioned_ref text; source_ref text; coverage_evidence_ref text; source_status_value source_status; row_date_missing boolean; coverage_gap boolean;
  DECLARE line_hash text; finding_hash text; coverage_hash text; event_payload jsonb; response jsonb; admission_audit_id uuid:=gen_random_uuid(); admission_outbox_id uuid:=gen_random_uuid(); row_audit_id uuid; row_outbox_id uuid; accounting_period_id uuid; accounting_period_count integer;
DECLARE retained_count integer:=0; exception_count integer:=0; finding_count integer:=0; coverage_count integer:=0; expected_ordinal integer:=0;
BEGIN
  PERFORM refs_assert_scope(p_tenant,p_entity,'WBS.SNAPSHOT.IMPORT');
  IF actor IS NULL THEN RAISE EXCEPTION 'Authenticated WBS evidence service actor missing' USING ERRCODE='42501'; END IF;
  computed_hash:=refs_wbs_final1_retained_evidence_hash(p_tenant,p_entity,p_delivery,p_artifacts,p_plan);
  IF p_request_hash IS DISTINCT FROM computed_hash THEN RAISE EXCEPTION 'Final-1 retained evidence request hash is not canonical' USING ERRCODE='22023'; END IF;
  IF jsonb_typeof(p_delivery)<>'object' OR jsonb_typeof(p_artifacts)<>'object' OR jsonb_typeof(p_plan)<>'object'
     OR domain NOT IN ('PAYABLES','INSURANCE') OR p_delivery->>'algorithm'<>'Ed25519'
     OR COALESCE(p_delivery->>'signature_verified','false')<>'true'
     OR COALESCE(p_delivery->>'issuer','') !~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$'
     OR COALESCE(p_delivery->>'key_id','') !~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$'
     OR COALESCE(p_delivery->>'nonce','') !~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$'
     OR COALESCE(p_delivery->>'company_code','') !~ '^[A-Z0-9][A-Z0-9_-]{0,63}$'
     OR COALESCE(p_delivery->>'admission_id','') !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
     OR COALESCE(p_delivery->>'snapshot_id','') !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
     OR COALESCE(p_delivery->>'observation_at','') !~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{3})?Z$'
     OR COALESCE((p_delivery->>'row_count')::integer,0) NOT BETWEEN 1 AND 2000
     OR COALESCE(p_delivery->>'receipt_hash','') !~ '^sha256:[0-9a-f]{64}$'
     OR COALESCE(p_delivery->>'request_raw_hash','') !~ '^sha256:[0-9a-f]{64}$'
     OR COALESCE(p_delivery->>'response_raw_hash','') !~ '^sha256:[0-9a-f]{64}$'
     OR COALESCE(p_delivery->>'package_raw_hash','') !~ '^sha256:[0-9a-f]{64}$'
     OR COALESCE(p_delivery->>'package_hash','') !~ '^sha256:[0-9a-f]{64}$'
     OR COALESCE(p_plan->>'plan_hash','') !~ '^sha256:[0-9a-f]{64}$'
     OR p_plan->>'plan_hash' IS DISTINCT FROM p_delivery->>'plan_hash'
     OR (p_delivery->>'signed_at')::timestamptz>clock_timestamp()+interval '5 minutes'
     OR (p_delivery->>'expires_at')::timestamptz<=clock_timestamp()
     OR (p_delivery->>'expires_at')::timestamptz-(p_delivery->>'signed_at')::timestamptz>interval '15 minutes'
     OR (p_delivery->>'date_from')::date>(p_delivery->>'date_to')::date THEN
    RAISE EXCEPTION 'Final-1 retained evidence delivery is invalid or expired' USING ERRCODE='22023';
  END IF;
  IF COALESCE(p_artifacts#>>'{receipt,storage_ref}','') !~ '^s3://' OR COALESCE(p_artifacts#>>'{receipt,storage_version}','')='' OR length(p_artifacts#>>'{receipt,storage_version}')>512 OR p_artifacts#>>'{receipt,storage_version}' ~ '[[:cntrl:]]' OR p_artifacts#>>'{receipt,storage_version}' ~ '^pending:'
     OR p_artifacts#>>'{receipt,content_hash}' IS DISTINCT FROM p_delivery->>'receipt_hash' OR COALESCE((p_artifacts#>>'{receipt,size_bytes}')::bigint,0)<=0
     OR COALESCE(p_artifacts#>>'{request,storage_ref}','') !~ '^s3://' OR COALESCE(p_artifacts#>>'{request,storage_version}','')='' OR length(p_artifacts#>>'{request,storage_version}')>512 OR p_artifacts#>>'{request,storage_version}' ~ '[[:cntrl:]]' OR p_artifacts#>>'{request,storage_version}' ~ '^pending:'
     OR p_artifacts#>>'{request,content_hash}' IS DISTINCT FROM p_delivery->>'request_raw_hash'
     OR COALESCE((p_artifacts#>>'{request,size_bytes}')::bigint,0)<=0
     OR COALESCE(p_artifacts#>>'{response,storage_ref}','') !~ '^s3://' OR COALESCE(p_artifacts#>>'{response,storage_version}','')='' OR length(p_artifacts#>>'{response,storage_version}')>512 OR p_artifacts#>>'{response,storage_version}' ~ '[[:cntrl:]]' OR p_artifacts#>>'{response,storage_version}' ~ '^pending:'
     OR p_artifacts#>>'{response,content_hash}' IS DISTINCT FROM p_delivery->>'response_raw_hash'
     OR COALESCE((p_artifacts#>>'{response,size_bytes}')::bigint,0)<=0
     OR COALESCE(p_artifacts#>>'{package,storage_ref}','') !~ '^s3://' OR COALESCE(p_artifacts#>>'{package,storage_version}','')='' OR length(p_artifacts#>>'{package,storage_version}')>512 OR p_artifacts#>>'{package,storage_version}' ~ '[[:cntrl:]]' OR p_artifacts#>>'{package,storage_version}' ~ '^pending:'
     OR p_artifacts#>>'{package,content_hash}' IS DISTINCT FROM p_delivery->>'package_raw_hash'
     OR COALESCE((p_artifacts#>>'{package,size_bytes}')::bigint,0)<=0
     OR EXISTS(SELECT 1 FROM jsonb_each(p_artifacts) artifact WHERE artifact.value->>'retentionMode'<>'COMPLIANCE' OR (artifact.value->>'retainUntil')::timestamptz<=clock_timestamp())
     OR (SELECT count(DISTINCT artifact.value->>'retainUntil') FROM jsonb_each(p_artifacts) artifact)<>1 THEN
    RAISE EXCEPTION 'Final-1 retained evidence requires exact versioned S3 artifacts and hashes' USING ERRCODE='22023';
  END IF;
  SELECT * INTO entity_record FROM entity WHERE tenant_id=p_tenant AND entity_id=p_entity AND active FOR SHARE;
  IF NOT FOUND OR entity_record.source_system<>'WBS' OR entity_record.source_entity_id IS DISTINCT FROM delivery_company_code OR entity_record.base_currency<>'USD' THEN
    RAISE EXCEPTION 'Final-1 entity/company/USD scope is denied' USING ERRCODE='42501';
  END IF;
  SELECT count(*) INTO mapping_count
      FROM wbs_company_catalog_controller_decision d
      WHERE d.tenant_id=p_tenant AND d.entity_id=p_entity AND d.decision_type='APPROVED'
        AND d.company_code=delivery_company_code AND d.base_currency='USD'
        AND d.effective_from<=(p_delivery->>'date_from')::date
        AND (d.effective_to IS NULL OR d.effective_to>=(p_delivery->>'date_to')::date);
  IF mapping_count<>1 THEN RAISE EXCEPTION 'Final-1 evidence company mapping is missing or ambiguous' USING ERRCODE='42501'; END IF;
  SELECT d.mapping_hash,d.mapping_document,d.effective_from,d.effective_to INTO approved_mapping
      FROM wbs_company_catalog_controller_decision d
      WHERE d.tenant_id=p_tenant AND d.entity_id=p_entity AND d.decision_type='APPROVED'
        AND d.company_code=delivery_company_code AND d.base_currency='USD'
        AND d.effective_from<=(p_delivery->>'date_from')::date
        AND (d.effective_to IS NULL OR d.effective_to>=(p_delivery->>'date_to')::date)
      FOR SHARE;
  IF NOT FOUND OR approved_mapping.mapping_document->>'refs_entity_id' IS DISTINCT FROM p_entity::text
     OR approved_mapping.mapping_document->>'company_code' IS DISTINCT FROM delivery_company_code
     OR approved_mapping.mapping_document->>'base_currency'<>'USD'
     OR approved_mapping.mapping_document->>'mapping_hash' IS DISTINCT FROM approved_mapping.mapping_hash
     OR refs_jsonb_hash(approved_mapping.mapping_document-'mapping_hash') IS DISTINCT FROM approved_mapping.mapping_hash THEN
    RAISE EXCEPTION 'Final-1 evidence lacks the exact approved company mapping' USING ERRCODE='42501';
  END IF;
  IF domain='INSURANCE' THEN
    IF approved_mapping.mapping_hash IS DISTINCT FROM p_delivery->>'company_mapping_hash' THEN RAISE EXCEPTION 'Insurance evidence mapping hash differs from the approved company mapping' USING ERRCODE='42501'; END IF;
  ELSIF p_delivery ? 'company_mapping_hash' AND p_delivery->>'company_mapping_hash' IS NOT NULL THEN
    RAISE EXCEPTION 'Payables retained evidence must not invent an insurance mapping hash' USING ERRCODE='22023';
  END IF;
  plan_rows:=CASE domain WHEN 'PAYABLES' THEN p_plan->'staging_rows' ELSE p_plan->'evidence_rows' END;
  IF jsonb_typeof(plan_rows)<>'array' OR jsonb_array_length(plan_rows)=0 OR jsonb_array_length(plan_rows)<>(p_delivery->>'row_count')::integer
     OR p_plan#>>'{provenance,tenant_id}' IS DISTINCT FROM p_tenant::text OR p_plan#>>'{provenance,entity_id}' IS DISTINCT FROM p_entity::text
     OR p_plan#>>'{provenance,company_code}' IS DISTINCT FROM delivery_company_code OR p_plan#>>'{provenance,snapshot_id}' IS DISTINCT FROM p_delivery->>'snapshot_id'
     OR p_plan#>>'{provenance,currency}'<>'USD' OR (p_plan#>>'{provenance,source_row_count}')::integer<>jsonb_array_length(plan_rows)
     OR (domain='PAYABLES' AND (p_plan#>>'{provenance,source_surface,database}'<>'wbsdata' OR p_plan#>>'{provenance,source_surface,table}'<>'account_book_payable_info'))
     OR (domain='INSURANCE' AND (p_plan#>>'{provenance,source_surface,database}'<>'wb_insurance' OR p_plan#>>'{provenance,source_surface,table}'<>'insurance_data' OR p_plan#>>'{provenance,company_mapping_hash}' IS DISTINCT FROM p_delivery->>'company_mapping_hash'))
     OR (domain='PAYABLES' AND p_plan->>'status'<>'NORMALIZED_FINAL1_PAYABLE_STAGING_PLAN')
     OR (domain='INSURANCE' AND p_plan->>'status'<>'NORMALIZED_FINAL1_INSURANCE_EVIDENCE_PLAN')
     OR COALESCE((p_plan->>'can_propose_amortization')::boolean,false)
     OR COALESCE((p_plan->>'can_create_draft')::boolean,true) OR COALESCE((p_plan->>'can_review')::boolean,true)
     OR COALESCE((p_plan->>'can_approve')::boolean,true) OR COALESCE((p_plan->>'can_post')::boolean,true) THEN
    RAISE EXCEPTION 'Final-1 normalized plan is malformed or action-enabled' USING ERRCODE='22023';
  END IF;

  INSERT INTO idempotency_receipt(tenant_id,operation_scope,idempotency_key,request_hash,status,actor_id)
    VALUES(p_tenant,'WBS_FINAL1_RETAINED_EVIDENCE:'||p_entity||':'||domain,p_idempotency_key,p_request_hash,'IN_PROGRESS',actor)
    ON CONFLICT(tenant_id,operation_scope,idempotency_key) DO NOTHING;
  SELECT * INTO idem FROM idempotency_receipt WHERE tenant_id=p_tenant
    AND operation_scope='WBS_FINAL1_RETAINED_EVIDENCE:'||p_entity||':'||domain AND idempotency_key=p_idempotency_key FOR UPDATE;
  IF idem.request_hash<>p_request_hash THEN RAISE EXCEPTION 'Idempotency key reused with different Final-1 evidence' USING ERRCODE='23505'; END IF;
  IF idem.actor_id<>actor THEN RAISE EXCEPTION 'Idempotency key belongs to another WBS evidence actor' USING ERRCODE='23505'; END IF;
  IF idem.status='SUCCEEDED' THEN RETURN idem.response_body||jsonb_build_object('idempotent',true); END IF;

  INSERT INTO import_batch(import_batch_id,tenant_id,entity_id,connector_code,source_module,source_entity_id,idempotency_key,request_hash,status,cursor_before,cursor_after,request_id,row_count,started_at,completed_at)
    VALUES(import_id,p_tenant,p_entity,'WBS_PROVIDER_FINAL1',CASE domain WHEN 'PAYABLES' THEN 'payable' ELSE 'insurance' END,delivery_company_code,p_idempotency_key,p_request_hash,'SUCCEEDED','{}'::jsonb,jsonb_build_object('snapshot_id',p_delivery->>'snapshot_id'),p_idempotency_key,jsonb_array_length(plan_rows),clock_timestamp(),clock_timestamp());
  INSERT INTO wbs_final1_retained_evidence_admission(
    wbs_final1_retained_evidence_admission_id,tenant_id,entity_id,domain,issuer,key_id,algorithm,nonce,company_code,company_mapping_hash,
    signed_at,expires_at,observation_at,date_from,date_to,snapshot_id,receipt_hash,receipt_storage_ref,receipt_storage_version,receipt_size_bytes,request_raw_hash,request_storage_ref,request_storage_version,request_size_bytes,
    response_raw_hash,response_storage_ref,response_storage_version,response_size_bytes,package_raw_hash,package_hash,package_storage_ref,package_storage_version,package_size_bytes,evidence_retain_until,
    plan_hash,request_hash,import_batch_id,row_count,retained_by
  ) VALUES(
    (p_delivery->>'admission_id')::uuid,p_tenant,p_entity,domain,p_delivery->>'issuer',p_delivery->>'key_id','Ed25519',p_delivery->>'nonce',delivery_company_code,
    NULLIF(p_delivery->>'company_mapping_hash',''),(p_delivery->>'signed_at')::timestamptz,(p_delivery->>'expires_at')::timestamptz,(p_delivery->>'observation_at')::timestamptz,
    (p_delivery->>'date_from')::date,(p_delivery->>'date_to')::date,(p_delivery->>'snapshot_id')::uuid,p_delivery->>'receipt_hash',p_artifacts#>>'{receipt,storage_ref}',p_artifacts#>>'{receipt,storage_version}',(p_artifacts#>>'{receipt,size_bytes}')::bigint,
    p_delivery->>'request_raw_hash',p_artifacts#>>'{request,storage_ref}',p_artifacts#>>'{request,storage_version}',(p_artifacts#>>'{request,size_bytes}')::bigint,
    p_delivery->>'response_raw_hash',p_artifacts#>>'{response,storage_ref}',p_artifacts#>>'{response,storage_version}',(p_artifacts#>>'{response,size_bytes}')::bigint,
    p_delivery->>'package_raw_hash',p_delivery->>'package_hash',p_artifacts#>>'{package,storage_ref}',p_artifacts#>>'{package,storage_version}',(p_artifacts#>>'{package,size_bytes}')::bigint,(p_artifacts#>>'{package,retainUntil}')::timestamptz,
    p_plan->>'plan_hash',p_request_hash,import_id,jsonb_array_length(plan_rows),actor
  );
  admission_id:=(p_delivery->>'admission_id')::uuid;
  package_versioned_ref:=(p_artifacts#>>'{package,storage_ref}')||'#versionId='||(p_artifacts#>>'{package,storage_version}');

  FOR row_value IN SELECT value FROM jsonb_array_elements(plan_rows) LOOP
    normalized:=row_value->'normalized'; source_record:=row_value->>'source_record_id'; source_primary_key:=COALESCE(NULLIF(row_value->>'source_primary_key',''),source_record); source_version:=row_value->>'source_version';
    finding_id:=NULL;evidence_id:=NULL;
    IF COALESCE(source_record,'')='' OR COALESCE(source_version,'')='' OR COALESCE(row_value->>'raw_row_hash','') !~ '^sha256:[0-9a-f]{64}$'
       OR COALESCE((row_value->>'source_row_ordinal')::integer,-1)<>expected_ordinal
       OR row_value->>'provider_snapshot_id' IS DISTINCT FROM p_delivery->>'snapshot_id'
       OR row_value->>'provider_company_code' IS DISTINCT FROM delivery_company_code
       OR row_value->>'provider_package_hash' IS DISTINCT FROM p_delivery->>'package_hash'
       OR row_value->>'provider_raw_package_hash' IS DISTINCT FROM p_delivery->>'package_raw_hash'
       OR row_value->>'currency'<>'USD' OR jsonb_typeof(row_value->'exception_codes')<>'array'
       OR COALESCE((row_value->>'can_propose_amortization')::boolean,false)
       OR COALESCE((row_value->>'can_create_draft')::boolean,true) OR COALESCE((row_value->>'can_review')::boolean,true)
       OR COALESCE((row_value->>'can_approve')::boolean,true) OR COALESCE((row_value->>'can_post')::boolean,true) THEN
      RAISE EXCEPTION 'Final-1 normalized row is malformed, cross-scope, or action-enabled' USING ERRCODE='22023';
    END IF;
    IF jsonb_array_length(row_value->'exception_codes')<>(SELECT count(DISTINCT value) FROM jsonb_array_elements_text(row_value->'exception_codes'))
       OR EXISTS(SELECT 1 FROM jsonb_array_elements_text(row_value->'exception_codes') code WHERE
         (domain='PAYABLES' AND code NOT IN ('WBS_PAYABLE_INVOICE_NUMBER_MISSING','WBS_PAYABLE_VENDOR_MISSING','WBS_PAYABLE_BUSINESS_DATE_MISSING','WBS_PAYABLE_ATTACHMENT_REQUIRED','WBS_PAYABLE_MAPPING_REVIEW_REQUIRED'))
         OR (domain='INSURANCE' AND code NOT IN ('INSURANCE_ENTITY_MAPPING_REQUIRED','INSURANCE_COVERAGE_DATE_MISSING','INSURANCE_COVERAGE_DATE_INVALID','INSURANCE_PREMIUM_NONPOSITIVE','INSURANCE_COVERAGE_NORMALIZATION_REQUIRED'))) THEN
      RAISE EXCEPTION 'Final-1 normalized exception codes are duplicated or outside the domain allowlist' USING ERRCODE='22023';
    END IF;
    IF domain='PAYABLES' THEN
      IF row_value->>'source_module'<>'BGDATA.payable' OR row_value#>>'{source_surface,database}'<>'wbsdata' OR row_value#>>'{source_surface,table}'<>'account_book_payable_info'
         OR source_record IS DISTINCT FROM normalized->>'apGuId' OR source_record !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
         OR row_value->>'outcome' NOT IN ('STAGING_REVIEW_REQUIRED','EXCEPTION_REVIEW_REQUIRED')
         OR COALESCE(normalized->>'amount','') !~ '^-?(0|[1-9][0-9]{0,17})(\.[0-9]{1,4})?$' THEN RAISE EXCEPTION 'Payable retained evidence source surface, outcome, or amount is invalid' USING ERRCODE='22023'; END IF;
      gross:=(normalized->>'amount')::numeric(20,4);
      row_date_missing:=normalized->>'postingDate' IS NULL AND normalized->>'incurredDate' IS NULL AND normalized->>'invoiceDate' IS NULL;
      IF row_date_missing IS DISTINCT FROM (row_value->'exception_codes' ? 'WBS_PAYABLE_BUSINESS_DATE_MISSING') THEN RAISE EXCEPTION 'Payable business-date exception does not match signed row facts' USING ERRCODE='23514'; END IF;
      IF (row_value->>'outcome'='EXCEPTION_REVIEW_REQUIRED') IS DISTINCT FROM (row_value->'exception_codes' ?| ARRAY['WBS_PAYABLE_INVOICE_NUMBER_MISSING','WBS_PAYABLE_VENDOR_MISSING','WBS_PAYABLE_BUSINESS_DATE_MISSING']) THEN RAISE EXCEPTION 'Payable review outcome does not match signed row exceptions' USING ERRCODE='23514'; END IF;
      business_date:=COALESCE(NULLIF(left(normalized->>'postingDate',10),'')::date,NULLIF(left(normalized->>'incurredDate',10),'')::date,NULLIF(left(normalized->>'invoiceDate',10),'')::date,(p_delivery->>'date_from')::date);
      description:=NULLIF(normalized->>'description','');
    ELSE
      IF row_value->>'source_module'<>'payable' OR row_value->>'source_domain'<>'insurance' OR row_value#>>'{source_surface,database}'<>'wb_insurance' OR row_value#>>'{source_surface,table}'<>'insurance_data'
         OR source_record IS DISTINCT FROM normalized->>'policyId' OR source_primary_key IS DISTINCT FROM normalized->>'sourceId' OR source_primary_key !~ '^[1-9][0-9]*$'
         OR row_value->>'outcome' NOT IN ('AMORTIZATION_COVERAGE_EVIDENCE_CANDIDATE','EXCEPTION_REVIEW_REQUIRED')
         OR row_value->>'company_mapping_hash' IS DISTINCT FROM p_delivery->>'company_mapping_hash' OR COALESCE(normalized->>'finalPremium','') !~ '^-?(0|[1-9][0-9]{0,17})\.[0-9]{2}$' THEN RAISE EXCEPTION 'Insurance retained evidence source surface, outcome, mapping, or premium is invalid' USING ERRCODE='22023'; END IF;
      source_record:='insurance:'||source_record; gross:=(normalized->>'finalPremium')::numeric(20,4);
      coverage_gap:=normalized->>'startDate' IS NULL OR normalized->>'expireDate' IS NULL
        OR (normalized->>'startDate')::date>(normalized->>'expireDate')::date
        OR ((normalized->>'startDate')::date<= (normalized->>'expireDate')::date AND (
          (normalized->>'startDate')::date<>date_trunc('month',(normalized->>'startDate')::date)::date
          OR (normalized->>'expireDate')::date<>(date_trunc('month',(normalized->>'expireDate')::date)+interval '1 month - 1 day')::date
          OR ((extract(year FROM (normalized->>'expireDate')::date)-extract(year FROM (normalized->>'startDate')::date))*12
            +extract(month FROM (normalized->>'expireDate')::date)-extract(month FROM (normalized->>'startDate')::date)+1)<>12));
      IF (row_value->'exception_codes' ? 'INSURANCE_COVERAGE_DATE_MISSING') IS DISTINCT FROM (normalized->>'startDate' IS NULL OR normalized->>'expireDate' IS NULL)
         OR (row_value->'exception_codes' ? 'INSURANCE_COVERAGE_DATE_INVALID') IS DISTINCT FROM (normalized->>'startDate' IS NOT NULL AND normalized->>'expireDate' IS NOT NULL AND (normalized->>'startDate')::date>(normalized->>'expireDate')::date)
         OR (row_value->'exception_codes' ? 'INSURANCE_COVERAGE_NORMALIZATION_REQUIRED') IS DISTINCT FROM (normalized->>'startDate' IS NOT NULL AND normalized->>'expireDate' IS NOT NULL AND (normalized->>'startDate')::date<=(normalized->>'expireDate')::date AND coverage_gap)
         OR (row_value->'exception_codes' ? 'INSURANCE_PREMIUM_NONPOSITIVE') IS DISTINCT FROM (gross<=0)
         OR (row_value->'exception_codes' ? 'INSURANCE_ENTITY_MAPPING_REQUIRED') IS DISTINCT FROM (NULLIF(normalized->>'pcCode','') IS NULL) THEN
        RAISE EXCEPTION 'Insurance exception codes do not match signed source facts' USING ERRCODE='23514';
      END IF;
      IF (row_value->>'outcome'='EXCEPTION_REVIEW_REQUIRED') IS DISTINCT FROM (jsonb_array_length(row_value->'exception_codes')>0) THEN RAISE EXCEPTION 'Insurance review outcome does not match signed row exceptions' USING ERRCODE='23514'; END IF;
      business_date:=COALESCE(NULLIF(normalized->>'startDate','')::date,(p_delivery->>'observation_at')::timestamptz::date);
      description:='Insurance premium policy '||COALESCE(NULLIF(normalized->>'policyId',''),row_value->>'source_primary_key')||COALESCE(' '||NULLIF(normalized->>'insuranceType',''),'');
    END IF;
    source_ref:=package_versioned_ref||'&view='||CASE domain WHEN 'PAYABLES' THEN 'list_payables' ELSE 'list_insurance' END||'&row_ordinal='||(row_value->>'source_row_ordinal')||'&raw_row_hash='||(row_value->>'raw_row_hash');
    SELECT count(*),CASE WHEN count(*)=1 THEN min(period_id::text)::uuid ELSE NULL END INTO accounting_period_count,accounting_period_id
      FROM accounting_period WHERE tenant_id=p_tenant AND entity_id=p_entity AND ledger_code='PRIMARY' AND starts_on<=business_date AND ends_on>=business_date;
    source_status_value:=CASE WHEN row_value->>'outcome'='EXCEPTION_REVIEW_REQUIRED' THEN 'QUARANTINED'::source_status ELSE 'PENDING_REVIEW'::source_status END;
    UPDATE raw_event SET is_current=false,superseded_at=clock_timestamp() WHERE tenant_id=p_tenant AND entity_id=p_entity AND source_system='WBS' AND source_module=normalized_module AND source_entity_id=delivery_company_code AND source_record_id=source_record AND is_current;
    raw_id:=gen_random_uuid(); document_id:=gen_random_uuid(); line_id:=gen_random_uuid(); row_id:=gen_random_uuid();
    coverage_evidence_ref:='wbs-final1-row:'||row_id;
    INSERT INTO raw_event(raw_event_id,tenant_id,entity_id,import_batch_id,source_system,source_module,source_entity_id,source_record_id,source_version,event_type,occurred_at,payload_hash,payload_ref,correlation_id)
      VALUES(raw_id,p_tenant,p_entity,import_id,'WBS',normalized_module,delivery_company_code,source_record,source_version,'UPSERT',business_date::timestamptz,p_delivery->>'package_raw_hash',package_versioned_ref,p_idempotency_key);
    INSERT INTO source_document(source_document_id,tenant_id,entity_id,raw_event_id,source_system,source_module,source_entity_id,source_record_id,source_version,document_type,document_no,business_date,accounting_date,currency,gross_amount,status,source_ref,payload_hash)
      VALUES(document_id,p_tenant,p_entity,raw_id,'WBS',normalized_module,delivery_company_code,source_record,source_version,CASE domain WHEN 'PAYABLES' THEN 'WBS_FINAL1_PAYABLE' ELSE 'WBS_FINAL1_INSURANCE' END,
        CASE domain WHEN 'PAYABLES' THEN NULLIF(normalized->>'invoiceNo','') ELSE NULLIF(normalized->>'policyNumber','') END,business_date,business_date,'USD',gross,source_status_value,source_ref,row_value->>'raw_row_hash');
    INSERT INTO source_document_line(source_document_line_id,tenant_id,entity_id,source_document_id,source_line_id,line_no,amount,direction,description,party_ref,project_ref,property_ref,unit_ref,external_dimension_refs)
      VALUES(line_id,p_tenant,p_entity,document_id,source_primary_key,1,abs(gross),'NONE',description,
        CASE domain WHEN 'PAYABLES' THEN COALESCE(NULLIF(normalized->>'vendorRef',''),NULLIF(normalized->>'vendorName','')) ELSE NULLIF(normalized->>'carrier','') END,
        CASE domain WHEN 'PAYABLES' THEN NULLIF(normalized->>'projectRef','') ELSE NULL END,
        NULL,NULL,
        jsonb_build_object('schema_version','WBS_FINAL1_RETAINED_SOURCE_LINE_V1','domain',domain,'snapshot_id',p_delivery->>'snapshot_id','package_hash',p_delivery->>'package_hash','package_storage_version',p_artifacts#>>'{package,storage_version}','source_row_ordinal',(row_value->>'source_row_ordinal')::integer,'raw_row_hash',row_value->>'raw_row_hash','source_surface',row_value->'source_surface','exception_codes',row_value->'exception_codes','accounting_period_id',accounting_period_id,'accounting_period_resolution',CASE WHEN accounting_period_count=1 THEN 'EXACT_PRIMARY_PERIOD' ELSE 'UNRESOLVED' END,'signed_project_code',normalized->>'projectCode','signed_pc_code',normalized->>'pcCode','signed_property_code',normalized->>'propertyCode','signed_unit_code',normalized->>'unitCode','signed_coverage_start',normalized->>'startDate','signed_coverage_end',normalized->>'expireDate','signed_service_period_start',normalized->>'servicePeriodStart','signed_service_period_end',normalized->>'servicePeriodEnd','signed_recurring_obligation_id',normalized->>'recurringObligationId','signed_contract_id',normalized->>'contractId','signed_charge_code',normalized->>'chargeCode','signed_service_frequency',normalized->>'serviceFrequency','signed_obligation_status',normalized->>'obligationStatus','business_date_authority',CASE WHEN domain='INSURANCE' AND normalized->>'startDate' IS NULL THEN 'SIGNED_DELIVERY_OBSERVATION_AT' WHEN domain='PAYABLES' AND row_date_missing THEN 'PACKAGE_SCOPE_FALLBACK_QUARANTINE' ELSE 'SIGNED_SOURCE_FIELD' END));
    INSERT INTO source_link(tenant_id,entity_id,link_type,raw_event_id,source_document_id,source_document_line_id,created_by)
      VALUES(p_tenant,p_entity,'WBS_FINAL1_RETAINED_SOURCE',raw_id,document_id,line_id,actor);
    FOR exception_code IN SELECT value FROM jsonb_array_elements(row_value->'exception_codes') LOOP
      INSERT INTO accounting_exception(tenant_id,entity_id,raw_event_id,source_document_id,exception_code,severity,details,owner)
        VALUES(p_tenant,p_entity,raw_id,document_id,exception_code#>>'{}','MEDIUM',jsonb_build_object('domain',domain,'source_record_id',source_record,'source_version',source_version,'raw_row_hash',row_value->>'raw_row_hash'),'CONTROLLER');
      exception_count:=exception_count+1;
    END LOOP;
    IF domain='INSURANCE' AND row_value->>'outcome'='AMORTIZATION_COVERAGE_EVIDENCE_CANDIDATE' THEN
      IF gross<=0 OR NULLIF(normalized->>'pcCode','') IS NULL OR row_value->'exception_codes'<>'[]'::jsonb
         OR NULLIF(normalized->>'startDate','') IS NULL OR NULLIF(normalized->>'expireDate','') IS NULL
         OR (normalized->>'startDate')::date<>date_trunc('month',(normalized->>'startDate')::date)::date
         OR (normalized->>'expireDate')::date<>(date_trunc('month',(normalized->>'expireDate')::date)+interval '1 month - 1 day')::date
         OR (normalized->>'expireDate')::date<(normalized->>'startDate')::date
         OR ((extract(year FROM (normalized->>'expireDate')::date)-extract(year FROM (normalized->>'startDate')::date))*12
           +extract(month FROM (normalized->>'expireDate')::date)-extract(month FROM (normalized->>'startDate')::date)+1)<>12 THEN
        RAISE EXCEPTION 'Insurance amortization coverage candidate is not exact positive whole-month 12-month signed evidence' USING ERRCODE='23514';
      END IF;
      coverage_hash:=refs_ai_amortization_coverage_evidence_hash(p_tenant,p_entity,document_id,row_value->>'raw_row_hash',(normalized->>'startDate')::date,(normalized->>'expireDate')::date,coverage_evidence_ref,row_value->>'raw_row_hash','SIGNED_SOURCE_FIELD');
      evidence_id:=gen_random_uuid();
      INSERT INTO ai_amortization_coverage_evidence(ai_amortization_coverage_evidence_id,tenant_id,entity_id,source_document_id,source_payload_hash,source_document_version,coverage_start,coverage_end,evidence_ref,evidence_hash,extraction_method,coverage_hash,created_by)
        VALUES(evidence_id,p_tenant,p_entity,document_id,row_value->>'raw_row_hash',0,(normalized->>'startDate')::date,(normalized->>'expireDate')::date,coverage_evidence_ref,row_value->>'raw_row_hash','SIGNED_SOURCE_FIELD',coverage_hash,actor);
      event_payload:=jsonb_build_object('schema_version','WBS_FINAL1_INSURANCE_COVERAGE_EVIDENCE_V1','ai_amortization_coverage_evidence_id',evidence_id,'source_document_id',document_id,'source_document_line_id',line_id,'source_payload_hash',row_value->>'raw_row_hash','coverage_start',normalized->>'startDate','coverage_end',normalized->>'expireDate','extraction_method','SIGNED_SOURCE_FIELD','can_create_draft',false,'can_review',false,'can_approve',false,'can_post',false);
      INSERT INTO audit_event(tenant_id,entity_id,event_type,object_type,object_id,action,actor_id,actor_type,permission_used,request_id,correlation_id,idempotency_key,after_hash,reason,metadata)
        VALUES(p_tenant,p_entity,'WBS_FINAL1_INSURANCE_COVERAGE_RETAINED','AI_AMORTIZATION_COVERAGE_EVIDENCE',evidence_id,'RETAIN',actor,'SERVICE_ACCOUNT','WBS.SNAPSHOT.IMPORT',p_idempotency_key,p_idempotency_key,p_idempotency_key,coverage_hash,'Provider-signed whole-month insurance coverage retained without accounting action',event_payload);
      INSERT INTO outbox_event(tenant_id,entity_id,aggregate_type,aggregate_id,event_type,payload,payload_hash)
        VALUES(p_tenant,p_entity,'AI_AMORTIZATION_COVERAGE_EVIDENCE',evidence_id,'WBS_FINAL1_INSURANCE_COVERAGE_RETAINED',event_payload,refs_jsonb_hash(event_payload));
      coverage_count:=coverage_count+1;
    ELSIF domain='INSURANCE' AND coverage_gap THEN
      line_hash:=refs_jsonb_hash(jsonb_build_object('schema_version','AI_PREPAID_COVERAGE_FINDING_V1','source_document_line_id',line_id,'source_line_id',source_primary_key,'line_no',1,'description',description,'amount',abs(gross),'project_ref',NULL,'property_ref',NULL));
      finding_hash:=refs_jsonb_hash(jsonb_build_object('schema_version','AI_PREPAID_COVERAGE_FINDING_V1','tenant_id',p_tenant,'entity_id',p_entity,'source_document_id',document_id,'source_document_version',0,'source_payload_hash',row_value->>'raw_row_hash','source_line_hash',line_hash,'rule_id','PREPAID_COVERAGE_REQUIRED'));
      finding_id:=gen_random_uuid();
      INSERT INTO ai_prepaid_coverage_finding(ai_prepaid_coverage_finding_id,tenant_id,entity_id,source_document_id,source_document_line_id,source_payload_hash,source_document_version,source_line_hash,finding_hash,rule_id,risk_level,confidence,reason,suggested_action,suggested_owner,due_date,due_date_status)
        VALUES(finding_id,p_tenant,p_entity,document_id,line_id,row_value->>'raw_row_hash',0,line_hash,finding_hash,'PREPAID_COVERAGE_REQUIRED','MEDIUM',0.9500,'Provider-signed insurance evidence has no retained valid whole-month coverage range. No coverage date was inferred.','Obtain corrected provider-signed coverage dates before any amortization proposal or accounting workflow.','CONTROLLER',NULL,'HUMAN_ASSIGNMENT_REQUIRED');
      event_payload:=jsonb_build_object('schema_version','AI_PREPAID_COVERAGE_FINDING_V1','ai_prepaid_coverage_finding_id',finding_id,'source_document_id',document_id,'source_document_line_id',line_id,'source_payload_hash',row_value->>'raw_row_hash','source_document_version',0,'source_line_hash',line_hash,'rule_id','PREPAID_COVERAGE_REQUIRED','risk_level','MEDIUM','confidence',0.9500,'can_create_draft',false,'can_review',false,'can_approve',false,'can_post',false);
      INSERT INTO audit_event(tenant_id,entity_id,event_type,object_type,object_id,action,actor_id,actor_type,permission_used,request_id,correlation_id,idempotency_key,after_hash,reason,metadata)
        VALUES(p_tenant,p_entity,'AI_PREPAID_COVERAGE_FINDING_MATERIALIZED','AI_PREPAID_COVERAGE_FINDING',finding_id,'MATERIALIZE',actor,'SERVICE_ACCOUNT','WBS.SNAPSHOT.IMPORT',p_idempotency_key,p_idempotency_key,p_idempotency_key,finding_hash,'Deterministic provider-signed insurance coverage evidence gap',event_payload);
      INSERT INTO outbox_event(tenant_id,entity_id,aggregate_type,aggregate_id,event_type,payload,payload_hash)
        VALUES(p_tenant,p_entity,'AI_PREPAID_COVERAGE_FINDING',finding_id,'AI_PREPAID_COVERAGE_FINDING_MATERIALIZED',event_payload,refs_jsonb_hash(event_payload));
      finding_count:=finding_count+1;
    END IF;
    INSERT INTO wbs_final1_retained_source_row(wbs_final1_retained_source_row_id,tenant_id,entity_id,wbs_final1_retained_evidence_admission_id,domain,source_record_id,source_primary_key,source_row_ordinal,source_version,raw_row_hash,raw_event_id,source_document_id,source_document_line_id,accounting_period_id,outcome,exception_codes,ai_amortization_coverage_evidence_id,ai_prepaid_coverage_finding_id)
      VALUES(row_id,p_tenant,p_entity,admission_id,domain,source_record,source_primary_key,(row_value->>'source_row_ordinal')::integer,source_version,row_value->>'raw_row_hash',raw_id,document_id,line_id,accounting_period_id,row_value->>'outcome',row_value->'exception_codes',evidence_id,finding_id);
    row_audit_id:=gen_random_uuid();row_outbox_id:=gen_random_uuid();
    event_payload:=jsonb_build_object('schema_version','WBS_FINAL1_RETAINED_SOURCE_ROW_V1','admission_id',admission_id,'retained_source_row_id',row_id,'domain',domain,'source_record_id',source_record,'source_primary_key',source_primary_key,'source_row_ordinal',(row_value->>'source_row_ordinal')::integer,'source_version',source_version,'raw_row_hash',row_value->>'raw_row_hash','raw_event_id',raw_id,'source_document_id',document_id,'source_document_line_id',line_id,'accounting_period_id',accounting_period_id,'status',source_status_value,'exception_codes',row_value->'exception_codes','ai_amortization_coverage_evidence_id',evidence_id,'ai_prepaid_coverage_finding_id',finding_id,'can_write_wbs',false,'can_propose_amortization',false,'can_create_draft',false,'can_review',false,'can_approve',false,'can_post',false);
    INSERT INTO audit_event(audit_event_id,tenant_id,entity_id,event_type,object_type,object_id,action,actor_id,actor_type,permission_used,request_id,correlation_id,idempotency_key,after_hash,reason,metadata)
      VALUES(row_audit_id,p_tenant,p_entity,'WBS_FINAL1_SOURCE_ROW_RETAINED','WBS_FINAL1_RETAINED_SOURCE_ROW',row_id,'RETAIN',actor,'SERVICE_ACCOUNT','WBS.SNAPSHOT.IMPORT',p_idempotency_key,p_idempotency_key,p_idempotency_key,row_value->>'raw_row_hash','Provider-signed source row retained without accounting action',event_payload);
    INSERT INTO outbox_event(outbox_event_id,tenant_id,entity_id,aggregate_type,aggregate_id,event_type,payload,payload_hash)
      VALUES(row_outbox_id,p_tenant,p_entity,'WBS_FINAL1_RETAINED_SOURCE_ROW',row_id,'WBS_FINAL1_SOURCE_ROW_RETAINED',event_payload,refs_jsonb_hash(event_payload));
    retained_count:=retained_count+1;
    expected_ordinal:=expected_ordinal+1;
  END LOOP;

  event_payload:=jsonb_build_object('schema_version','WBS_FINAL1_RETAINED_SOURCE_EVIDENCE_V1','admission_id',admission_id,'audit_event_id',admission_audit_id,'outbox_event_id',admission_outbox_id,'domain',domain,'snapshot_id',p_delivery->>'snapshot_id','company_code',delivery_company_code,'row_count',retained_count,'exception_count',exception_count,'coverage_evidence_count',coverage_count,'prepaid_coverage_finding_count',finding_count,'signature_verified',true,'can_write_wbs',false,'can_propose_amortization',false,'can_create_draft',false,'can_review',false,'can_approve',false,'can_post',false);
  INSERT INTO audit_event(audit_event_id,tenant_id,entity_id,event_type,object_type,object_id,action,actor_id,actor_type,permission_used,request_id,correlation_id,idempotency_key,after_hash,reason,metadata)
    VALUES(admission_audit_id,p_tenant,p_entity,'WBS_FINAL1_RETAINED_SOURCE_EVIDENCE_ADMITTED','WBS_FINAL1_RETAINED_EVIDENCE_ADMISSION',admission_id,'RETAIN',actor,'SERVICE_ACCOUNT','WBS.SNAPSHOT.IMPORT',p_idempotency_key,p_idempotency_key,p_idempotency_key,p_request_hash,'Provider-signed source evidence retained without accounting action',event_payload);
  INSERT INTO outbox_event(outbox_event_id,tenant_id,entity_id,aggregate_type,aggregate_id,event_type,payload,payload_hash)
    VALUES(admission_outbox_id,p_tenant,p_entity,'WBS_FINAL1_RETAINED_EVIDENCE_ADMISSION',admission_id,'WBS_FINAL1_RETAINED_SOURCE_EVIDENCE_ADMITTED',event_payload,refs_jsonb_hash(event_payload));
  response:=event_payload||jsonb_build_object('status','WBS_FINAL1_RETAINED_SOURCE_EVIDENCE','import_batch_id',import_id,'idempotent',false);
  UPDATE idempotency_receipt SET status='SUCCEEDED',response_status=201,response_body=response,completed_at=clock_timestamp() WHERE idempotency_receipt_id=idem.idempotency_receipt_id;
  RETURN response;
END;
$$;

REVOKE ALL ON wbs_final1_retained_evidence_admission,wbs_final1_retained_source_row FROM PUBLIC,refs_app;
GRANT SELECT ON wbs_final1_retained_evidence_admission,wbs_final1_retained_source_row TO refs_app;
REVOKE ALL ON FUNCTION refs_wbs_final1_retained_evidence_hash(uuid,uuid,jsonb,jsonb,jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION refs_retain_wbs_final1_source_evidence(uuid,uuid,jsonb,jsonb,jsonb,text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION refs_wbs_final1_retained_evidence_hash(uuid,uuid,jsonb,jsonb,jsonb) TO refs_app;
GRANT EXECUTE ON FUNCTION refs_retain_wbs_final1_source_evidence(uuid,uuid,jsonb,jsonb,jsonb,text,text) TO refs_app;

COMMIT;
