BEGIN;

-- This permission is intentionally absent from every production workflow
-- role.  The staging-only service grants it only to one fixed internal actor.
INSERT INTO permission_catalog(permission_code,domain,risk_class,sod_class)
VALUES('AI.TEST.WORKFLOW','AI_ACCOUNTING','HIGH','CONTROLLED_TEST_AI_SOURCE_DERIVER')
ON CONFLICT(permission_code) DO UPDATE SET domain=EXCLUDED.domain,active=true,
  risk_class=EXCLUDED.risk_class,sod_class=EXCLUDED.sod_class,effective_to=NULL;

CREATE TABLE controlled_test_ai_source (
  controlled_test_ai_source_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  entity_id uuid NOT NULL,
  parent_wbs_test_import_draft_id uuid NOT NULL,
  parent_source_document_id uuid NOT NULL,
  derived_raw_event_id uuid NOT NULL,
  derived_source_document_id uuid NOT NULL,
  derived_source_document_line_id uuid NOT NULL,
  attachment_id uuid NOT NULL,
  source_payload_hash text NOT NULL CHECK(source_payload_hash~'^sha256:[0-9a-f]{64}$'),
  request_hash text NOT NULL CHECK(request_hash~'^sha256:[0-9a-f]{64}$'),
  initiated_by text NOT NULL,
  created_by text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  test_only boolean NOT NULL DEFAULT true CHECK(test_only),
  provenance_mode text NOT NULL DEFAULT 'UNSIGNED_TEST_ONLY' CHECK(provenance_mode='UNSIGNED_TEST_ONLY'),
  UNIQUE(tenant_id,entity_id,parent_source_document_id),
  UNIQUE(tenant_id,entity_id,derived_source_document_id),
  FOREIGN KEY(tenant_id,entity_id,parent_wbs_test_import_draft_id)
    REFERENCES wbs_test_import_draft(tenant_id,entity_id,wbs_test_import_draft_id),
  FOREIGN KEY(tenant_id,entity_id,parent_source_document_id)
    REFERENCES source_document(tenant_id,entity_id,source_document_id),
  FOREIGN KEY(tenant_id,derived_raw_event_id) REFERENCES raw_event(tenant_id,raw_event_id),
  FOREIGN KEY(tenant_id,entity_id,derived_source_document_id)
    REFERENCES source_document(tenant_id,entity_id,source_document_id),
  FOREIGN KEY(tenant_id,entity_id,derived_source_document_line_id)
    REFERENCES source_document_line(tenant_id,entity_id,source_document_line_id),
  FOREIGN KEY(tenant_id,entity_id,attachment_id) REFERENCES attachment(tenant_id,entity_id,attachment_id)
);
ALTER TABLE controlled_test_ai_source ENABLE ROW LEVEL SECURITY;
CREATE POLICY controlled_test_ai_source_scope ON controlled_test_ai_source
  USING(tenant_id=refs_current_tenant() AND refs_entity_allowed(entity_id))
  WITH CHECK(tenant_id=refs_current_tenant() AND refs_entity_allowed(entity_id));
CREATE TRIGGER controlled_test_ai_source_append_only BEFORE UPDATE OR DELETE ON controlled_test_ai_source
  FOR EACH ROW EXECUTE FUNCTION reject_mutation();

CREATE FUNCTION refs_derive_controlled_test_ai_source_hash(
  p_tenant uuid,p_entity uuid,p_parent_source uuid,p_initiated_by text
) RETURNS text LANGUAGE sql IMMUTABLE SET search_path=pg_catalog,public,pg_temp AS $$
  SELECT refs_jsonb_hash(jsonb_build_object(
    'schema_version','CONTROLLED_TEST_AI_SOURCE_V1','tenant_id',p_tenant,'entity_id',p_entity,
    'parent_source_document_id',p_parent_source,'initiated_by',btrim(p_initiated_by),
    'test_only',true,'provenance_mode','UNSIGNED_TEST_ONLY'))
$$;

CREATE FUNCTION refs_derive_controlled_test_ai_source(
  p_tenant uuid,p_entity uuid,p_parent_source uuid,p_initiated_by text,
  p_idempotency_key text,p_request_hash text
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE actor text:=refs_current_actor();idem idempotency_receipt;trace wbs_test_import_draft;
DECLARE parent source_document;parent_line source_document_line;parent_attachment attachment;prior controlled_test_ai_source;
DECLARE batch_id uuid:=gen_random_uuid();raw_id uuid:=gen_random_uuid();source_id uuid:=gen_random_uuid();line_id uuid:=gen_random_uuid();derived_id uuid:=gen_random_uuid();
DECLARE source_record_id text;source_version text;source_ref text;response jsonb;event_payload jsonb;
BEGIN
  PERFORM refs_assert_scope(p_tenant,p_entity,'AI.TEST.WORKFLOW');
  IF actor IS NULL THEN RAISE EXCEPTION 'Authenticated controlled-test AI source actor missing' USING ERRCODE='42501'; END IF;
  IF p_request_hash IS DISTINCT FROM refs_derive_controlled_test_ai_source_hash(p_tenant,p_entity,p_parent_source,p_initiated_by)
     OR p_idempotency_key IS NULL OR length(p_idempotency_key) NOT BETWEEN 8 AND 160
     OR p_initiated_by IS NULL OR btrim(p_initiated_by)='' OR length(btrim(p_initiated_by))>200 THEN
    RAISE EXCEPTION 'Controlled-test AI source request is not canonical' USING ERRCODE='22023';
  END IF;

  SELECT * INTO trace FROM wbs_test_import_draft
   WHERE tenant_id=p_tenant AND entity_id=p_entity AND source_document_id=p_parent_source FOR SHARE;
  IF NOT FOUND OR NOT trace.test_only OR trace.provenance_mode<>'UNSIGNED_TEST_ONLY' THEN
    RAISE EXCEPTION 'Controlled-test AI source requires an exact WBS TEST_ONLY parent' USING ERRCODE='23514';
  END IF;
  SELECT * INTO parent FROM source_document
   WHERE tenant_id=p_tenant AND entity_id=p_entity AND source_document_id=trace.source_document_id FOR SHARE;
  SELECT * INTO parent_line FROM source_document_line
   WHERE tenant_id=p_tenant AND entity_id=p_entity AND source_document_line_id=trace.source_document_line_id
     AND source_document_id=trace.source_document_id FOR SHARE;
  SELECT * INTO parent_attachment FROM attachment
   WHERE tenant_id=p_tenant AND entity_id=p_entity AND attachment_id=trace.attachment_id FOR SHARE;
  IF parent.source_document_id IS NULL OR parent.status<>'POSTED' OR parent.document_type<>'WBS_TEST_PAYABLE'
     OR parent.payload_hash<>trace.source_record_hash OR parent.gross_amount<=0 OR parent_line.source_document_line_id IS NULL
     OR parent_line.external_dimension_refs->>'test_only'<>'true'
     OR parent_line.external_dimension_refs->>'provenance_mode'<>'UNSIGNED_TEST_ONLY'
     OR parent_attachment.attachment_id IS NULL OR parent_attachment.finalization_status<>'VERIFIED_CLEAN'
     OR parent_attachment.scan_status<>'CLEAN' OR parent_attachment.verified_at IS NULL OR parent_attachment.finalized_at IS NULL
     OR parent_attachment.storage_ref NOT LIKE 'object://refs-test-only/%' THEN
    RAISE EXCEPTION 'Controlled-test AI parent lineage or test attachment is incomplete' USING ERRCODE='23514';
  END IF;

  INSERT INTO idempotency_receipt(tenant_id,operation_scope,idempotency_key,request_hash,status,actor_id)
    VALUES(p_tenant,'CONTROLLED_TEST_AI_SOURCE:'||p_entity,p_idempotency_key,p_request_hash,'IN_PROGRESS',actor)
    ON CONFLICT DO NOTHING;
  SELECT * INTO idem FROM idempotency_receipt
   WHERE tenant_id=p_tenant AND operation_scope='CONTROLLED_TEST_AI_SOURCE:'||p_entity AND idempotency_key=p_idempotency_key FOR UPDATE;
  IF idem.request_hash<>p_request_hash OR idem.actor_id<>actor THEN
    RAISE EXCEPTION 'Controlled-test AI source idempotency conflict' USING ERRCODE='23505';
  END IF;
  IF idem.status='SUCCEEDED' THEN RETURN idem.response_body||jsonb_build_object('idempotent',true); END IF;
  SELECT * INTO prior FROM controlled_test_ai_source
   WHERE tenant_id=p_tenant AND entity_id=p_entity AND parent_source_document_id=p_parent_source FOR SHARE;
  IF FOUND THEN
    response:=jsonb_build_object('controlled_test_ai_source_id',prior.controlled_test_ai_source_id,
      'parent_source_document_id',prior.parent_source_document_id,'source_document_id',prior.derived_source_document_id,
      'source_document_line_id',prior.derived_source_document_line_id,'attachment_id',prior.attachment_id,
      'source_payload_hash',prior.source_payload_hash,'status','READY_FOR_DRAFT','test_only',true,
      'provenance_mode','UNSIGNED_TEST_ONLY','idempotent',true);
    UPDATE idempotency_receipt SET status='SUCCEEDED',response_status=200,response_body=response,completed_at=clock_timestamp()
      WHERE idempotency_receipt_id=idem.idempotency_receipt_id;
    RETURN response;
  END IF;

  -- The only master-data addition is a dedicated, unmistakably test-only
  -- prepaid asset.  Existing conflicting data is never normalized or changed.
  INSERT INTO account_master(tenant_id,entity_id,account_code,account_name,requires_member,required_member_type,active)
    VALUES(p_tenant,p_entity,'141500','UNSIGNED TEST ONLY Prepaid Asset',false,NULL,true) ON CONFLICT DO NOTHING;
  PERFORM 1 FROM account_master WHERE tenant_id=p_tenant AND entity_id=p_entity AND account_code='141500'
    AND account_name='UNSIGNED TEST ONLY Prepaid Asset' AND active AND NOT requires_member AND required_member_type IS NULL FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Controlled-test prepaid account 141500 conflicts with existing master data' USING ERRCODE='23514'; END IF;
  PERFORM 1 FROM account_master WHERE tenant_id=p_tenant AND entity_id=p_entity AND account_code='610000' AND active FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Controlled-test expense account 610000 is missing' USING ERRCODE='23503'; END IF;

  source_record_id:='ai-test:'||replace(trace.wbs_test_import_draft_id::text,'-','');
  source_version:='unsigned-test-only:v1:'||parent.version;
  source_ref:='object://refs-test-only/'||p_entity||'/ai-workflow/'||replace(trace.wbs_test_import_draft_id::text,'-','');
  INSERT INTO import_batch(import_batch_id,tenant_id,entity_id,connector_code,source_module,source_entity_id,idempotency_key,request_hash,status,row_count,started_at,completed_at)
    VALUES(batch_id,p_tenant,p_entity,'WBS_AI_TEST','ai_test_prepaid',parent.source_entity_id,p_idempotency_key,p_request_hash,'SUCCEEDED',1,clock_timestamp(),clock_timestamp());
  INSERT INTO raw_event(raw_event_id,tenant_id,entity_id,import_batch_id,source_system,source_module,source_entity_id,source_record_id,source_version,event_type,occurred_at,payload_hash,payload_ref,correlation_id)
    VALUES(raw_id,p_tenant,p_entity,batch_id,parent.source_system,'ai_test_prepaid',parent.source_entity_id,source_record_id,source_version,'UPSERT',parent.accounting_date::timestamptz,parent.payload_hash,source_ref,p_idempotency_key);
  INSERT INTO source_document(source_document_id,tenant_id,entity_id,raw_event_id,source_system,source_module,source_entity_id,source_record_id,source_version,document_type,document_no,business_date,accounting_date,currency,gross_amount,status,source_ref,payload_hash)
    VALUES(source_id,p_tenant,p_entity,raw_id,parent.source_system,'ai_test_prepaid',parent.source_entity_id,source_record_id,source_version,
      'WBS_TEST_AI_PREPAID','AI-TEST-'||upper(substr(replace(trace.wbs_test_import_draft_id::text,'-',''),1,16)),parent.business_date,parent.accounting_date,
      parent.currency,parent.gross_amount,'READY_FOR_DRAFT',source_ref,parent.payload_hash);
  INSERT INTO source_document_line(source_document_line_id,tenant_id,entity_id,source_document_id,source_line_id,line_no,amount,direction,description,party_ref,project_ref,property_ref,external_dimension_refs)
    VALUES(line_id,p_tenant,p_entity,source_id,source_record_id,1,parent_line.amount,'NONE','UNSIGNED TEST ONLY AI source derived from WBS test Payable',
      parent_line.party_ref,parent_line.project_ref,parent_line.property_ref,
      jsonb_build_object('schema_version','CONTROLLED_TEST_AI_SOURCE_V1','test_only',true,'provenance_mode','UNSIGNED_TEST_ONLY',
        'parent_wbs_test_import_draft_id',trace.wbs_test_import_draft_id,'parent_source_document_id',parent.source_document_id,
        'parent_source_payload_hash',parent.payload_hash,'parent_source_document_line_id',parent_line.source_document_line_id,
        'parent_external_dimension_refs',parent_line.external_dimension_refs));
  INSERT INTO source_link(tenant_id,entity_id,link_type,raw_event_id,source_document_id,source_document_line_id,created_by)
    VALUES(p_tenant,p_entity,'WBS_TEST_AI_DERIVED_SOURCE',raw_id,source_id,line_id,actor);
  INSERT INTO source_link(tenant_id,entity_id,link_type,source_document_id,attachment_id,created_by)
    VALUES(p_tenant,p_entity,'SOURCE_ATTACHMENT',source_id,parent_attachment.attachment_id,actor);
  INSERT INTO controlled_test_ai_source(controlled_test_ai_source_id,tenant_id,entity_id,parent_wbs_test_import_draft_id,parent_source_document_id,
    derived_raw_event_id,derived_source_document_id,derived_source_document_line_id,attachment_id,source_payload_hash,request_hash,initiated_by,created_by)
    VALUES(derived_id,p_tenant,p_entity,trace.wbs_test_import_draft_id,parent.source_document_id,raw_id,source_id,line_id,parent_attachment.attachment_id,
      parent.payload_hash,p_request_hash,btrim(p_initiated_by),actor);
  event_payload:=jsonb_build_object('schema_version','CONTROLLED_TEST_AI_SOURCE_V1','controlled_test_ai_source_id',derived_id,
    'parent_wbs_test_import_draft_id',trace.wbs_test_import_draft_id,'parent_source_document_id',parent.source_document_id,
    'source_document_id',source_id,'source_document_line_id',line_id,'attachment_id',parent_attachment.attachment_id,
    'source_payload_hash',parent.payload_hash,'status','READY_FOR_DRAFT','initiated_by',btrim(p_initiated_by),
    'test_only',true,'provenance_mode','UNSIGNED_TEST_ONLY');
  INSERT INTO audit_event(tenant_id,entity_id,event_type,object_type,object_id,action,actor_id,actor_type,permission_used,request_id,correlation_id,idempotency_key,after_hash,reason,metadata)
    VALUES(p_tenant,p_entity,'CONTROLLED_TEST_AI_SOURCE_DERIVED','SOURCE_DOCUMENT',source_id,'DERIVE_TEST_SOURCE',actor,'SERVICE','AI.TEST.WORKFLOW',
      p_idempotency_key,p_idempotency_key,p_idempotency_key,p_request_hash,'Explicit staging-only AI workflow test source',event_payload);
  INSERT INTO outbox_event(tenant_id,entity_id,aggregate_type,aggregate_id,event_type,payload,payload_hash)
    VALUES(p_tenant,p_entity,'SOURCE_DOCUMENT',source_id,'CONTROLLED_TEST_AI_SOURCE_DERIVED',event_payload,refs_jsonb_hash(event_payload));
  response:=jsonb_build_object('controlled_test_ai_source_id',derived_id,'parent_source_document_id',parent.source_document_id,
    'source_document_id',source_id,'source_document_line_id',line_id,'attachment_id',parent_attachment.attachment_id,
    'source_payload_hash',parent.payload_hash,'status','READY_FOR_DRAFT','test_only',true,
    'provenance_mode','UNSIGNED_TEST_ONLY','idempotent',false);
  UPDATE idempotency_receipt SET status='SUCCEEDED',response_status=201,response_body=response,completed_at=clock_timestamp()
    WHERE idempotency_receipt_id=idem.idempotency_receipt_id;
  RETURN response;
END $$;

-- Strengthen only the description produced for a source derived by the
-- controlled-test table.  Authorization, source status, evidence, SOD and all
-- formal AI endpoint contracts remain unchanged.
DO $migration$
DECLARE definition text;
DECLARE old_fragment constant text:='description:=''Human-reviewed AI amortization for ''||to_char(schedule_line.amortization_month,''YYYY-MM'');';
DECLARE new_fragment constant text:='description:=CASE WHEN EXISTS(SELECT 1 FROM controlled_test_ai_source c WHERE c.tenant_id=p_tenant AND c.entity_id=p_entity AND c.derived_source_document_id=source.source_document_id AND c.test_only AND c.provenance_mode=''UNSIGNED_TEST_ONLY'') THEN ''UNSIGNED TEST ONLY AI amortization for '' ELSE ''Human-reviewed AI amortization for '' END||to_char(schedule_line.amortization_month,''YYYY-MM'');';
BEGIN
  SELECT pg_get_functiondef('refs_create_ai_amortization_draft(uuid,uuid,uuid,uuid,uuid,text,uuid[],text,text,text)'::regprocedure) INTO definition;
  IF (length(definition)-length(replace(definition,old_fragment,'')))/length(old_fragment)<>1 THEN
    RAISE EXCEPTION 'Unexpected AI amortization Draft definition' USING ERRCODE='22023';
  END IF;
  EXECUTE replace(definition,old_fragment,new_fragment);
END $migration$;

REVOKE ALL ON controlled_test_ai_source FROM PUBLIC,refs_app;
GRANT SELECT ON controlled_test_ai_source TO refs_app;
REVOKE EXECUTE ON FUNCTION refs_derive_controlled_test_ai_source_hash(uuid,uuid,uuid,text),
  refs_derive_controlled_test_ai_source(uuid,uuid,uuid,text,text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION refs_derive_controlled_test_ai_source_hash(uuid,uuid,uuid,text),
  refs_derive_controlled_test_ai_source(uuid,uuid,uuid,text,text,text) TO refs_app;

COMMIT;
