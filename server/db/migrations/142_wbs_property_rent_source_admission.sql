BEGIN;

INSERT INTO permission_catalog(permission_code,domain,risk_class,sod_class)
VALUES('WBS.PROPERTY.REVIEW','WBS','HIGH','WBS_PROPERTY_REVIEWER')
ON CONFLICT(permission_code) DO UPDATE SET active=true,domain=EXCLUDED.domain,risk_class=EXCLUDED.risk_class,sod_class=EXCLUDED.sod_class,version=permission_catalog.version+1,effective_to=NULL;

CREATE TABLE wbs_property_rent_source_admission (
  wbs_property_rent_source_admission_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,entity_id uuid NOT NULL,wbs_inbound_row_id uuid NOT NULL,
  receipt_id uuid NOT NULL,wbs_snapshot_import_id uuid NOT NULL,wbs_snapshot_receipt_id uuid NOT NULL,
  raw_event_id uuid NOT NULL,source_document_id uuid NOT NULL,staging_item_id uuid NOT NULL,
  source_version text NOT NULL,receipt_hash text NOT NULL CHECK(receipt_hash~'^sha256:[0-9a-f]{64}$'),
  evidence_hash text NOT NULL CHECK(evidence_hash~'^sha256:[0-9a-f]{64}$'),
  property_ref text NOT NULL,unit_ref text NOT NULL,lease_ref text NOT NULL,tenant_ref text NOT NULL,
  admitted_by text NOT NULL,admitted_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  request_hash text NOT NULL CHECK(request_hash~'^sha256:[0-9a-f]{64}$'),idempotency_key text NOT NULL,
  UNIQUE(tenant_id,entity_id,wbs_property_rent_source_admission_id),
  UNIQUE(tenant_id,entity_id,wbs_inbound_row_id),UNIQUE(tenant_id,entity_id,source_document_id),
  UNIQUE(tenant_id,entity_id,staging_item_id),
  FOREIGN KEY(tenant_id,entity_id) REFERENCES entity(tenant_id,entity_id),
  FOREIGN KEY(tenant_id,entity_id,wbs_inbound_row_id) REFERENCES wbs_inbound_row(tenant_id,entity_id,wbs_inbound_row_id),
  FOREIGN KEY(tenant_id,entity_id,receipt_id) REFERENCES wbs_inbound_receipt(tenant_id,entity_id,receipt_id),
  FOREIGN KEY(tenant_id,entity_id,wbs_snapshot_import_id) REFERENCES wbs_snapshot_import(tenant_id,entity_id,wbs_snapshot_import_id),
  FOREIGN KEY(tenant_id,entity_id,wbs_snapshot_receipt_id) REFERENCES wbs_snapshot_receipt(tenant_id,entity_id,wbs_snapshot_receipt_id),
  FOREIGN KEY(tenant_id,raw_event_id) REFERENCES raw_event(tenant_id,raw_event_id),
  FOREIGN KEY(tenant_id,entity_id,source_document_id) REFERENCES source_document(tenant_id,entity_id,source_document_id),
  FOREIGN KEY(tenant_id,entity_id,staging_item_id) REFERENCES staging_item(tenant_id,entity_id,staging_item_id)
);
ALTER TABLE wbs_property_rent_source_admission ENABLE ROW LEVEL SECURITY;
CREATE POLICY wbs_property_rent_source_admission_scope ON wbs_property_rent_source_admission
  USING(tenant_id=refs_current_tenant() AND refs_entity_allowed(entity_id))
  WITH CHECK(tenant_id=refs_current_tenant() AND refs_entity_allowed(entity_id));
CREATE TRIGGER wbs_property_rent_source_admission_append_only BEFORE UPDATE OR DELETE ON wbs_property_rent_source_admission
  FOR EACH ROW EXECUTE FUNCTION reject_mutation();

CREATE FUNCTION refs_wbs_property_rent_source_evidence_hash(
  p_row uuid,p_source_record_id text,p_source_version text,p_receipt_hash text,p_raw jsonb,p_normalized jsonb,p_outcome jsonb,p_outcome_kind text
) RETURNS text LANGUAGE sql IMMUTABLE SET search_path=pg_catalog,public,pg_temp AS $$
 SELECT refs_jsonb_hash(jsonb_build_object('wbs_inbound_row_id',p_row,'source_record_id',p_source_record_id,
  'source_version',p_source_version,'receipt_hash',p_receipt_hash,'raw',p_raw,'normalized',p_normalized,
  'outcome',p_outcome,'outcome_kind',p_outcome_kind))
$$;

CREATE FUNCTION refs_admit_wbs_property_rent_source_hash(
  p_tenant uuid,p_entity uuid,p_row uuid,p_expected_source_version text,p_expected_receipt_hash text,p_expected_evidence_hash text,p_reason text
) RETURNS text LANGUAGE sql IMMUTABLE SET search_path=pg_catalog,public,pg_temp AS $$
 SELECT refs_jsonb_hash(jsonb_build_object('tenant_id',p_tenant,'entity_id',p_entity,'wbs_inbound_row_id',p_row,
  'expected_source_version',p_expected_source_version,'expected_receipt_hash',p_expected_receipt_hash,
  'expected_evidence_hash',p_expected_evidence_hash,'reason',btrim(p_reason)))
$$;

CREATE FUNCTION refs_admit_wbs_property_rent_source(
  p_tenant uuid,p_entity uuid,p_row uuid,p_expected_source_version text,p_expected_receipt_hash text,
  p_expected_evidence_hash text,p_reason text,p_idempotency_key text,p_request_hash text
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE actor text:=refs_current_actor(); idem idempotency_receipt; inbound wbs_inbound_row; receipt wbs_inbound_receipt;
DECLARE snapshot_import wbs_snapshot_import; snapshot_receipt wbs_snapshot_receipt; entity_row entity;
DECLARE raw_id uuid:=gen_random_uuid(); document_id uuid:=gen_random_uuid(); staging_id uuid:=gen_random_uuid(); admission_id uuid:=gen_random_uuid(); exception_id uuid:=gen_random_uuid();
DECLARE normalized jsonb; evidence_hash text; accounting_date date; business_date date; amount numeric(20,4);
DECLARE property_value text; unit_value text; lease_value text; tenant_value text; document_number text; response jsonb; event_payload jsonb;
BEGIN
  PERFORM refs_assert_scope(p_tenant,p_entity,'WBS.PROPERTY.REVIEW');
  IF actor IS NULL OR p_request_hash<>refs_admit_wbs_property_rent_source_hash(p_tenant,p_entity,p_row,p_expected_source_version,p_expected_receipt_hash,p_expected_evidence_hash,p_reason)
     OR p_idempotency_key!~'^[A-Za-z0-9._:-]{8,200}$' OR coalesce(length(btrim(p_reason)),0) NOT BETWEEN 8 AND 2000 THEN
    RAISE EXCEPTION 'WBS Property Rent source admission request is invalid' USING ERRCODE='22023';
  END IF;
  INSERT INTO idempotency_receipt(tenant_id,operation_scope,idempotency_key,request_hash,status,actor_id)
    VALUES(p_tenant,'WBS_PROPERTY_RENT_SOURCE:'||p_entity,p_idempotency_key,p_request_hash,'IN_PROGRESS',actor) ON CONFLICT DO NOTHING;
  SELECT * INTO idem FROM idempotency_receipt WHERE tenant_id=p_tenant AND operation_scope='WBS_PROPERTY_RENT_SOURCE:'||p_entity AND idempotency_key=p_idempotency_key FOR UPDATE;
  IF idem.request_hash<>p_request_hash THEN RAISE EXCEPTION 'Idempotency key reused with another Property Rent source' USING ERRCODE='23505'; END IF;
  IF idem.status='SUCCEEDED' THEN RETURN idem.response_body||jsonb_build_object('idempotent',true); END IF;

  SELECT * INTO inbound FROM wbs_inbound_row WHERE tenant_id=p_tenant AND entity_id=p_entity AND wbs_inbound_row_id=p_row FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'WBS Property Rent inbound row was not found' USING ERRCODE='P0002'; END IF;
  SELECT * INTO receipt FROM wbs_inbound_receipt WHERE tenant_id=p_tenant AND entity_id=p_entity AND receipt_id=inbound.receipt_id FOR SHARE;
  SELECT * INTO snapshot_import FROM wbs_snapshot_import WHERE tenant_id=p_tenant AND entity_id=p_entity AND import_batch_id=receipt.import_batch_id AND environment='PRODUCTION' FOR SHARE;
  IF receipt.receipt_id IS NULL OR snapshot_import.wbs_snapshot_import_id IS NULL OR NOT EXISTS(
    SELECT 1 FROM wbs_snapshot_delivery_attestation d WHERE d.tenant_id=p_tenant AND d.entity_id=p_entity AND d.wbs_snapshot_import_id=snapshot_import.wbs_snapshot_import_id
  ) THEN RAISE EXCEPTION 'Property Rent source requires an admitted signed production snapshot' USING ERRCODE='23514'; END IF;
  SELECT * INTO snapshot_receipt FROM wbs_snapshot_receipt WHERE tenant_id=p_tenant AND entity_id=p_entity
    AND wbs_snapshot_import_id=snapshot_import.wbs_snapshot_import_id AND ingestion_kind='TRANSACTION_CANDIDATE'
    AND source_record_id=inbound.source_record_id AND source_version=inbound.source_version
    AND payload_hash=receipt.receipt_hash AND payload_ref=receipt.payload_ref FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Property Rent row is not backed by an exact transaction-candidate receipt' USING ERRCODE='23514'; END IF;
  evidence_hash:=refs_wbs_property_rent_source_evidence_hash(inbound.wbs_inbound_row_id,inbound.source_record_id,inbound.source_version,receipt.receipt_hash,inbound.raw,inbound.normalized,inbound.outcome,inbound.outcome_kind);
  IF inbound.source_version<>p_expected_source_version OR receipt.receipt_hash<>p_expected_receipt_hash OR evidence_hash<>p_expected_evidence_hash THEN
    RAISE EXCEPTION 'Property Rent source evidence revision conflict' USING ERRCODE='40001';
  END IF;
  normalized:=inbound.normalized;
  IF inbound.outcome_kind<>'STAGING' OR inbound.outcome->>'stage' IS DISTINCT FROM 'STAGING_REVIEW_REQUIRED'
     OR normalized->>'source_system' IS DISTINCT FROM 'WBS' OR normalized->>'source_type' IS DISTINCT FROM 'PROPERTY_RENT_CHARGE'
     OR normalized->>'admission' IS DISTINCT FROM 'TRANSACTION_CANDIDATE' OR normalized->>'transaction_kind' IS DISTINCT FROM 'RENT_CHARGE'
     OR normalized->>'source_record_id' IS DISTINCT FROM inbound.source_record_id OR normalized->>'source_version' IS DISTINCT FROM inbound.source_version
     OR normalized->>'receipt_hash' IS DISTINCT FROM receipt.receipt_hash OR normalized->>'receipt_ref' IS DISTINCT FROM receipt.payload_ref THEN
    RAISE EXCEPTION 'CONTROL_EVIDENCE and non-rent rows cannot be admitted as Property Rent transactions' USING ERRCODE='23514';
  END IF;
  SELECT * INTO entity_row FROM entity WHERE tenant_id=p_tenant AND entity_id=p_entity AND active FOR SHARE;
  IF NOT FOUND OR entity_row.source_system<>'WBS' OR normalized->>'company_key' IS DISTINCT FROM entity_row.source_entity_id
     OR normalized->>'currency' IS DISTINCT FROM entity_row.base_currency THEN RAISE EXCEPTION 'Property Rent company or currency scope is invalid' USING ERRCODE='23514'; END IF;
  IF coalesce(normalized->>'accounting_date','')!~'^\d{4}-\d{2}-\d{2}$' OR coalesce(normalized->>'business_date','')!~'^\d{4}-\d{2}-\d{2}$'
     OR coalesce(normalized->>'amount_money4','')!~'^(0|[1-9][0-9]*)(\.[0-9]{4})$' THEN RAISE EXCEPTION 'Property Rent dates or amount are not canonical' USING ERRCODE='23514'; END IF;
  accounting_date:=(normalized->>'accounting_date')::date;business_date:=(normalized->>'business_date')::date;amount:=(normalized->>'amount_money4')::numeric(20,4);
  property_value:=nullif(btrim(normalized->>'property_ref'),'');unit_value:=nullif(btrim(normalized->>'unit_ref'),'');lease_value:=nullif(btrim(normalized->>'lease_ref'),'');tenant_value:=nullif(btrim(normalized->>'tenant_ref'),'');document_number:=nullif(btrim(normalized->>'charge_number'),'');
  IF amount<=0 OR property_value IS NULL OR unit_value IS NULL OR lease_value IS NULL OR tenant_value IS NULL OR document_number IS NULL
     OR greatest(length(property_value),length(unit_value),length(lease_value),length(tenant_value),length(document_number))>128 THEN
    RAISE EXCEPTION 'Property Rent transaction identity is incomplete' USING ERRCODE='23514';
  END IF;
  PERFORM 1 FROM accounting_period WHERE tenant_id=p_tenant AND entity_id=p_entity AND status='OPEN' AND accounting_date BETWEEN starts_on AND ends_on FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Property Rent source requires an OPEN accounting period' USING ERRCODE='55000'; END IF;
  IF EXISTS(SELECT 1 FROM wbs_property_rent_source_admission a WHERE a.tenant_id=p_tenant AND a.entity_id=p_entity AND a.wbs_inbound_row_id=p_row) THEN
    RAISE EXCEPTION 'Property Rent source was already admitted' USING ERRCODE='23505';
  END IF;

  INSERT INTO raw_event(raw_event_id,tenant_id,entity_id,import_batch_id,source_system,source_module,source_entity_id,source_record_id,source_version,event_type,occurred_at,payload_hash,payload_ref,correlation_id)
    VALUES(raw_id,p_tenant,p_entity,snapshot_import.import_batch_id,'WBS','pmCharge',entity_row.source_entity_id,inbound.source_record_id,inbound.source_version,'UPSERT',accounting_date::timestamptz,receipt.receipt_hash,receipt.payload_ref,p_idempotency_key);
  INSERT INTO source_document(source_document_id,tenant_id,entity_id,raw_event_id,source_system,source_module,source_entity_id,source_record_id,source_version,document_type,document_no,business_date,accounting_date,currency,gross_amount,status,source_ref,payload_hash)
    VALUES(document_id,p_tenant,p_entity,raw_id,'WBS','pmCharge',entity_row.source_entity_id,inbound.source_record_id,inbound.source_version,'WBS_PROPERTY_RENT_CHARGE',document_number,business_date,accounting_date,entity_row.base_currency,amount,'PENDING_REVIEW',receipt.payload_ref,receipt.receipt_hash);
  INSERT INTO source_document_line(tenant_id,entity_id,source_document_id,source_line_id,line_no,amount,direction,description,party_ref,property_ref,unit_ref,external_dimension_refs)
    VALUES(p_tenant,p_entity,document_id,inbound.source_record_id,1,amount,'NONE','Admitted Property Rent source amount pending producer review',tenant_value,property_value,unit_value,jsonb_build_object('lease_ref',lease_value));
  INSERT INTO staging_item(staging_item_id,tenant_id,entity_id,source_document_id,status,version,assigned_to)
    VALUES(staging_id,p_tenant,p_entity,document_id,'PENDING_REVIEW',0,actor);
  INSERT INTO accounting_exception(exception_id,tenant_id,entity_id,source_document_id,staging_item_id,exception_code,status,severity,details,owner)
    VALUES(exception_id,p_tenant,p_entity,document_id,staging_id,'PROPERTY_RENT_PRODUCER_UNAVAILABLE','OPEN','HIGH',jsonb_build_object('reason','Formal AR Invoice producer and approved rent mapping are not installed','transaction_admitted',true,'can_create_draft',false,'can_post',false),actor);
  INSERT INTO source_link(tenant_id,entity_id,link_type,raw_event_id,source_document_id,staging_item_id,created_by)
    VALUES(p_tenant,p_entity,'WBS_PROPERTY_RENT_SOURCE',raw_id,document_id,staging_id,actor);
  INSERT INTO wbs_property_rent_source_admission(wbs_property_rent_source_admission_id,tenant_id,entity_id,wbs_inbound_row_id,receipt_id,wbs_snapshot_import_id,wbs_snapshot_receipt_id,raw_event_id,source_document_id,staging_item_id,source_version,receipt_hash,evidence_hash,property_ref,unit_ref,lease_ref,tenant_ref,admitted_by,request_hash,idempotency_key)
    VALUES(admission_id,p_tenant,p_entity,p_row,receipt.receipt_id,snapshot_import.wbs_snapshot_import_id,snapshot_receipt.wbs_snapshot_receipt_id,raw_id,document_id,staging_id,inbound.source_version,receipt.receipt_hash,evidence_hash,property_value,unit_value,lease_value,tenant_value,actor,p_request_hash,p_idempotency_key);
  event_payload:=jsonb_build_object('wbs_property_rent_source_admission_id',admission_id,'wbs_inbound_row_id',p_row,'source_document_id',document_id,'staging_item_id',staging_id,'evidence_hash',evidence_hash,'status','ADMITTED_PENDING_RENT_PICKUP_PRODUCER','transaction_admitted',true,'can_create_draft',false,'can_approve',false,'can_post',false);
  INSERT INTO audit_event(tenant_id,entity_id,event_type,object_type,object_id,action,actor_id,actor_type,permission_used,request_id,correlation_id,idempotency_key,after_hash,reason,metadata)
    VALUES(p_tenant,p_entity,'WBS_PROPERTY_RENT_SOURCE_ADMITTED','SOURCE_DOCUMENT',document_id,'ADMIT',actor,'USER','WBS.PROPERTY.REVIEW',p_idempotency_key,p_idempotency_key,p_idempotency_key,p_request_hash,btrim(p_reason),event_payload);
  INSERT INTO outbox_event(tenant_id,entity_id,aggregate_type,aggregate_id,event_type,payload,payload_hash)
    VALUES(p_tenant,p_entity,'SOURCE_DOCUMENT',document_id,'WBS_PROPERTY_RENT_SOURCE_ADMITTED',event_payload,refs_jsonb_hash(event_payload));
  response:=event_payload||jsonb_build_object('idempotent',false);
  UPDATE idempotency_receipt SET status='SUCCEEDED',response_status=201,response_body=response,completed_at=clock_timestamp() WHERE idempotency_receipt_id=idem.idempotency_receipt_id;
  RETURN response;
END $$;

REVOKE ALL ON wbs_property_rent_source_admission FROM PUBLIC,refs_app;
GRANT SELECT ON wbs_property_rent_source_admission TO refs_app;
REVOKE ALL ON FUNCTION refs_wbs_property_rent_source_evidence_hash(uuid,text,text,text,jsonb,jsonb,jsonb,text) FROM PUBLIC;
REVOKE ALL ON FUNCTION refs_admit_wbs_property_rent_source_hash(uuid,uuid,uuid,text,text,text,text) FROM PUBLIC;
REVOKE ALL ON FUNCTION refs_admit_wbs_property_rent_source(uuid,uuid,uuid,text,text,text,text,text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION refs_wbs_property_rent_source_evidence_hash(uuid,text,text,text,jsonb,jsonb,jsonb,text) TO refs_app;
GRANT EXECUTE ON FUNCTION refs_admit_wbs_property_rent_source_hash(uuid,uuid,uuid,text,text,text,text) TO refs_app;
GRANT EXECUTE ON FUNCTION refs_admit_wbs_property_rent_source(uuid,uuid,uuid,text,text,text,text,text,text) TO refs_app;

COMMIT;
