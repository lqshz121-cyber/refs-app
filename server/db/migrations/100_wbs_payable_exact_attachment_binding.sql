BEGIN;

-- A clean attachment is entity-scoped evidence, but it is not WBS-row
-- evidence until an independent reviewer freezes its exact source lineage.
-- This table is deliberately separate from Review: binding cannot create Raw,
-- Source, Staging, Bill, Journal, or ledger records.
CREATE TABLE wbs_payable_attachment_binding (
  wbs_payable_attachment_binding_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant(tenant_id),
  entity_id uuid NOT NULL,
  wbs_inbound_row_id uuid NOT NULL,
  receipt_id uuid NOT NULL,
  wbs_snapshot_import_id uuid NOT NULL,
  wbs_snapshot_receipt_id uuid NOT NULL,
  attachment_id uuid NOT NULL,
  source_version text NOT NULL CHECK(length(btrim(source_version)) BETWEEN 1 AND 128),
  receipt_hash text NOT NULL CHECK(receipt_hash ~ '^sha256:[0-9a-f]{64}$'),
  provider_receipt_hash text NOT NULL CHECK(provider_receipt_hash ~ '^sha256:[0-9a-f]{64}$'),
  evidence_hash text NOT NULL CHECK(evidence_hash ~ '^sha256:[0-9a-f]{64}$'),
  attachment_content_hash text NOT NULL CHECK(attachment_content_hash ~ '^sha256:[0-9a-f]{64}$'),
  attachment_storage_version text NOT NULL CHECK(length(btrim(attachment_storage_version)) BETWEEN 1 AND 512 AND attachment_storage_version !~ '^pending:'),
  bind_reason text NOT NULL CHECK(length(btrim(bind_reason)) BETWEEN 8 AND 2000),
  bound_by text NOT NULL,
  request_hash text NOT NULL CHECK(request_hash ~ '^sha256:[0-9a-f]{64}$'),
  bound_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE(tenant_id,entity_id,wbs_inbound_row_id,attachment_id),
  -- One immutable object version cannot support two different WBS rows.
  UNIQUE(tenant_id,entity_id,attachment_id),
  UNIQUE(tenant_id,entity_id,wbs_payable_attachment_binding_id),
  FOREIGN KEY(tenant_id,entity_id) REFERENCES entity(tenant_id,entity_id),
  FOREIGN KEY(tenant_id,entity_id,wbs_inbound_row_id) REFERENCES wbs_inbound_row(tenant_id,entity_id,wbs_inbound_row_id),
  FOREIGN KEY(tenant_id,entity_id,receipt_id) REFERENCES wbs_inbound_receipt(tenant_id,entity_id,receipt_id),
  FOREIGN KEY(tenant_id,entity_id,wbs_snapshot_import_id) REFERENCES wbs_snapshot_import(tenant_id,entity_id,wbs_snapshot_import_id),
  FOREIGN KEY(tenant_id,entity_id,wbs_snapshot_receipt_id) REFERENCES wbs_snapshot_receipt(tenant_id,entity_id,wbs_snapshot_receipt_id),
  FOREIGN KEY(tenant_id,entity_id,attachment_id) REFERENCES attachment(tenant_id,entity_id,attachment_id)
);

ALTER TABLE wbs_payable_attachment_binding ENABLE ROW LEVEL SECURITY;
CREATE POLICY wbs_payable_attachment_binding_scope_policy ON wbs_payable_attachment_binding
  USING(tenant_id=refs_current_tenant() AND refs_entity_allowed(entity_id))
  WITH CHECK(tenant_id=refs_current_tenant() AND refs_entity_allowed(entity_id));
CREATE TRIGGER wbs_payable_attachment_binding_append_only
  BEFORE UPDATE OR DELETE ON wbs_payable_attachment_binding
  FOR EACH ROW EXECUTE FUNCTION reject_mutation();

-- Replace migration 099's deliberately empty attachment reader.  Every
-- displayed choice must prove the same immutable WBS row lineage and the
-- current VERIFIED_CLEAN object version; entity proximity is never enough.
CREATE OR REPLACE FUNCTION refs_read_wbs_payable_attachment_choices(
  p_tenant uuid,p_entity uuid,p_row uuid,p_source_version text,
  p_receipt_hash text,p_provider_receipt_hash text,p_evidence_hash text
)
RETURNS TABLE(attachment_choices jsonb,attachment_count integer)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
  SELECT coalesce(jsonb_agg(jsonb_build_object(
      'attachment_id',a.attachment_id,'name',a.name,'media_type',a.media_type,'verified_at',a.verified_at
    ) ORDER BY a.verified_at DESC,a.attachment_id),'[]'::jsonb),count(*)::integer
  FROM public.wbs_payable_attachment_binding b
  JOIN public.attachment a
    ON a.tenant_id=b.tenant_id AND a.entity_id=b.entity_id AND a.attachment_id=b.attachment_id
    AND a.content_hash=b.attachment_content_hash AND a.storage_version=b.attachment_storage_version
    AND a.finalization_status='VERIFIED_CLEAN' AND a.scan_status='CLEAN'
    AND a.verified_at IS NOT NULL AND a.finalized_at IS NOT NULL
  WHERE b.tenant_id=p_tenant AND b.entity_id=p_entity AND b.wbs_inbound_row_id=p_row
    AND b.source_version=p_source_version AND b.receipt_hash=p_receipt_hash
    AND b.provider_receipt_hash=p_provider_receipt_hash AND b.evidence_hash=p_evidence_hash
$$;
REVOKE ALL ON FUNCTION refs_read_wbs_payable_attachment_choices(uuid,uuid,uuid,text,text,text,text) FROM PUBLIC;

CREATE FUNCTION refs_bind_wbs_payable_attachment_hash(
  p_tenant uuid,p_entity uuid,p_row uuid,p_attachment uuid,p_expected_revision bigint,
  p_expected_source_version text,p_expected_receipt_hash text,p_expected_provider_receipt_hash text,
  p_expected_evidence_hash text,p_expected_attachment_content_hash text,p_expected_attachment_storage_version text,
  p_reason text
) RETURNS text
LANGUAGE sql IMMUTABLE SET search_path=pg_catalog,public,pg_temp AS $$
  SELECT refs_jsonb_hash(jsonb_build_object(
    'tenant_id',p_tenant,'entity_id',p_entity,'wbs_inbound_row_id',p_row,'attachment_id',p_attachment,
    'expected_revision',p_expected_revision,'expected_source_version',p_expected_source_version,
    'expected_receipt_hash',p_expected_receipt_hash,'expected_provider_receipt_hash',p_expected_provider_receipt_hash,
    'expected_evidence_hash',p_expected_evidence_hash,'expected_attachment_content_hash',p_expected_attachment_content_hash,
    'expected_attachment_storage_version',p_expected_attachment_storage_version,'reason',btrim(p_reason)
  ))
$$;

CREATE FUNCTION refs_bind_wbs_payable_attachment(
  p_tenant uuid,p_entity uuid,p_row uuid,p_attachment uuid,p_expected_revision bigint,
  p_expected_source_version text,p_expected_receipt_hash text,p_expected_provider_receipt_hash text,
  p_expected_evidence_hash text,p_expected_attachment_content_hash text,p_expected_attachment_storage_version text,
  p_reason text,p_idempotency_key text,p_request_hash text
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE actor text:=refs_current_actor(); idem idempotency_receipt; inbound_row wbs_inbound_row; inbound_receipt wbs_inbound_receipt;
DECLARE snapshot_import wbs_snapshot_import; snapshot_receipt wbs_snapshot_receipt; clean_attachment attachment;
DECLARE computed_hash text; actual_evidence_hash text; binding_id uuid:=gen_random_uuid(); response jsonb; event_payload jsonb;
DECLARE accepted_finalize_count integer; scanner_actor text;
BEGIN
  PERFORM refs_assert_scope(p_tenant,p_entity,'WBS.PAYABLE.REVIEW');
  PERFORM refs_assert_scope(p_tenant,p_entity,'AP.VIEW');
  IF actor IS NULL THEN RAISE EXCEPTION 'Authenticated actor missing' USING ERRCODE='42501'; END IF;
  computed_hash:=refs_bind_wbs_payable_attachment_hash(p_tenant,p_entity,p_row,p_attachment,p_expected_revision,
    p_expected_source_version,p_expected_receipt_hash,p_expected_provider_receipt_hash,p_expected_evidence_hash,
    p_expected_attachment_content_hash,p_expected_attachment_storage_version,p_reason);
  IF p_request_hash<>computed_hash THEN RAISE EXCEPTION 'WBS Payable attachment binding request hash is not canonical' USING ERRCODE='22023'; END IF;
  IF p_expected_revision<>0 THEN RAISE EXCEPTION 'WBS Payable attachment binding revision conflict' USING ERRCODE='40001'; END IF;
  IF length(btrim(COALESCE(p_expected_source_version,''))) NOT BETWEEN 1 AND 128
     OR p_expected_receipt_hash !~ '^sha256:[0-9a-f]{64}$'
     OR p_expected_provider_receipt_hash !~ '^sha256:[0-9a-f]{64}$'
     OR p_expected_evidence_hash !~ '^sha256:[0-9a-f]{64}$'
     OR p_expected_attachment_content_hash !~ '^sha256:[0-9a-f]{64}$'
     OR length(btrim(COALESCE(p_expected_attachment_storage_version,''))) NOT BETWEEN 1 AND 512
     OR p_expected_attachment_storage_version~'^pending:'
     OR length(btrim(COALESCE(p_reason,''))) NOT BETWEEN 8 AND 2000 THEN
    RAISE EXCEPTION 'Exact WBS Payable and attachment evidence is required' USING ERRCODE='22023';
  END IF;

  INSERT INTO idempotency_receipt(tenant_id,operation_scope,idempotency_key,request_hash,status,actor_id)
    VALUES(p_tenant,'WBS_PAYABLE_ATTACHMENT_BIND:'||p_entity,p_idempotency_key,p_request_hash,'IN_PROGRESS',actor)
    ON CONFLICT (tenant_id,operation_scope,idempotency_key) DO NOTHING;
  SELECT * INTO idem FROM idempotency_receipt
    WHERE tenant_id=p_tenant AND operation_scope='WBS_PAYABLE_ATTACHMENT_BIND:'||p_entity AND idempotency_key=p_idempotency_key FOR UPDATE;
  IF idem.request_hash<>p_request_hash THEN RAISE EXCEPTION 'Idempotency key reused with different request hash' USING ERRCODE='23505'; END IF;
  IF idem.status='SUCCEEDED' THEN RETURN idem.response_body||jsonb_build_object('idempotent',true); END IF;

  SELECT * INTO inbound_row FROM wbs_inbound_row
    WHERE tenant_id=p_tenant AND entity_id=p_entity AND wbs_inbound_row_id=p_row FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'WBS Payable row not found' USING ERRCODE='P0002'; END IF;
  SELECT * INTO inbound_receipt FROM wbs_inbound_receipt
    WHERE tenant_id=p_tenant AND entity_id=p_entity AND receipt_id=inbound_row.receipt_id FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'WBS Payable receipt not found' USING ERRCODE='23514'; END IF;
  SELECT * INTO snapshot_import FROM wbs_snapshot_import
    WHERE tenant_id=p_tenant AND entity_id=p_entity AND import_batch_id=inbound_receipt.import_batch_id AND environment='PRODUCTION' FOR SHARE;
  IF NOT FOUND OR NOT EXISTS(
    SELECT 1 FROM wbs_snapshot_delivery_attestation d
    WHERE d.tenant_id=p_tenant AND d.entity_id=p_entity AND d.wbs_snapshot_import_id=snapshot_import.wbs_snapshot_import_id
  ) THEN RAISE EXCEPTION 'WBS Payable attachment binding requires an admitted signed production snapshot' USING ERRCODE='23514'; END IF;
  SELECT * INTO snapshot_receipt FROM wbs_snapshot_receipt
    WHERE tenant_id=p_tenant AND entity_id=p_entity AND wbs_snapshot_import_id=snapshot_import.wbs_snapshot_import_id
      AND source_module='BGDATA.payable' AND ingestion_kind='TRANSACTION_CANDIDATE'
      AND source_record_id=inbound_row.source_record_id AND source_version=inbound_row.source_version
      AND payload_hash=inbound_receipt.receipt_hash AND payload_ref=inbound_receipt.payload_ref FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'WBS Payable row is not backed by the exact signed provider receipt' USING ERRCODE='23514'; END IF;
  actual_evidence_hash:=refs_wbs_payable_review_evidence_hash(inbound_row.wbs_inbound_row_id,inbound_row.source_record_id,
    inbound_row.source_version,inbound_receipt.receipt_hash,inbound_row.raw,inbound_row.normalized,inbound_row.outcome,inbound_row.outcome_kind);
  IF inbound_row.source_version<>p_expected_source_version OR inbound_receipt.receipt_hash<>p_expected_receipt_hash
     OR snapshot_receipt.receipt_hash<>p_expected_provider_receipt_hash OR actual_evidence_hash<>p_expected_evidence_hash THEN
    RAISE EXCEPTION 'WBS Payable attachment binding revision conflict' USING ERRCODE='40001';
  END IF;
  IF inbound_row.outcome_kind<>'STAGING' OR inbound_row.outcome->>'stage' IS DISTINCT FROM 'STAGING_REVIEW_REQUIRED'
     OR inbound_row.normalized->>'source_system' IS DISTINCT FROM 'WBS'
     OR inbound_row.normalized->>'source_type' IS DISTINCT FROM 'PAYABLE'
     OR inbound_row.normalized->>'source_record_id' IS DISTINCT FROM inbound_row.source_record_id
     OR inbound_row.normalized->>'source_version' IS DISTINCT FROM inbound_row.source_version
     OR inbound_row.normalized->>'receipt_hash' IS DISTINCT FROM inbound_receipt.receipt_hash THEN
    RAISE EXCEPTION 'Only exact admitted WBS Payable staging evidence may receive an attachment binding' USING ERRCODE='23514';
  END IF;

  SELECT * INTO clean_attachment FROM attachment
    WHERE tenant_id=p_tenant AND entity_id=p_entity AND attachment_id=p_attachment
      AND finalization_status='VERIFIED_CLEAN' AND scan_status='CLEAN'
      AND verified_at IS NOT NULL AND finalized_at IS NOT NULL
      AND NOT EXISTS(SELECT 1 FROM source_link sl WHERE sl.tenant_id=p_tenant AND sl.entity_id=p_entity AND sl.attachment_id=p_attachment)
    FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'WBS Payable attachment must be VERIFIED_CLEAN in the exact entity' USING ERRCODE='23503'; END IF;
  IF clean_attachment.content_hash<>p_expected_attachment_content_hash
     OR clean_attachment.storage_version<>p_expected_attachment_storage_version THEN
    RAISE EXCEPTION 'WBS Payable attachment evidence revision conflict' USING ERRCODE='40001';
  END IF;
  SELECT count(*),min(actor_id) INTO accepted_finalize_count,scanner_actor FROM audit_event
    WHERE tenant_id=p_tenant AND entity_id=p_entity AND object_type='ATTACHMENT' AND object_id=p_attachment
      AND event_type='ATTACHMENT_FINALIZED' AND action='FINALIZE' AND permission_used='ATTACHMENT.FINALIZE'
      AND metadata->>'accepted'='true';
  IF accepted_finalize_count<>1 OR scanner_actor IS NULL THEN
    RAISE EXCEPTION 'WBS Payable attachment requires one retained accepted scanner finalization' USING ERRCODE='23514';
  END IF;
  IF actor IN (snapshot_import.created_by,clean_attachment.uploaded_by,scanner_actor) THEN
    RAISE EXCEPTION 'WBS Payable attachment binding SoD violation' USING ERRCODE='42501';
  END IF;

  INSERT INTO wbs_payable_attachment_binding(
    wbs_payable_attachment_binding_id,tenant_id,entity_id,wbs_inbound_row_id,receipt_id,wbs_snapshot_import_id,
    wbs_snapshot_receipt_id,attachment_id,source_version,receipt_hash,provider_receipt_hash,evidence_hash,
    attachment_content_hash,attachment_storage_version,bind_reason,bound_by,request_hash
  ) VALUES(
    binding_id,p_tenant,p_entity,p_row,inbound_receipt.receipt_id,snapshot_import.wbs_snapshot_import_id,
    snapshot_receipt.wbs_snapshot_receipt_id,p_attachment,inbound_row.source_version,inbound_receipt.receipt_hash,
    snapshot_receipt.receipt_hash,actual_evidence_hash,clean_attachment.content_hash,clean_attachment.storage_version,
    btrim(p_reason),actor,p_request_hash
  );
  event_payload:=jsonb_build_object('wbs_payable_attachment_binding_id',binding_id,'wbs_inbound_row_id',p_row,
    'attachment_id',p_attachment,'source_version',inbound_row.source_version,'receipt_hash',inbound_receipt.receipt_hash,
    'provider_receipt_hash',snapshot_receipt.receipt_hash,'evidence_hash',actual_evidence_hash,
    'attachment_content_hash',clean_attachment.content_hash,'attachment_storage_version',clean_attachment.storage_version,
    'status','BOUND_EVIDENCE_ONLY','can_review',false,'can_create_draft',false,'can_post',false);
  INSERT INTO audit_event(tenant_id,entity_id,event_type,object_type,object_id,action,actor_id,actor_type,permission_used,
    request_id,correlation_id,idempotency_key,after_hash,reason,metadata)
    VALUES(p_tenant,p_entity,'WBS_PAYABLE_ATTACHMENT_BOUND','WBS_PAYABLE_ATTACHMENT',binding_id,'BIND',actor,'USER',
      'WBS.PAYABLE.REVIEW',p_idempotency_key,p_idempotency_key,p_idempotency_key,p_request_hash,btrim(p_reason),event_payload);
  INSERT INTO outbox_event(tenant_id,entity_id,aggregate_type,aggregate_id,event_type,payload,payload_hash)
    VALUES(p_tenant,p_entity,'WBS_PAYABLE_ATTACHMENT',binding_id,'WBS_PAYABLE_ATTACHMENT_BOUND',event_payload,refs_jsonb_hash(event_payload));
  response:=jsonb_build_object('wbs_payable_attachment_binding_id',binding_id,'wbs_inbound_row_id',p_row,
    'attachment_id',p_attachment,'status','BOUND_EVIDENCE_ONLY','revision',0,'idempotent',false,
    'can_review',false,'can_create_draft',false,'can_approve',false,'can_post',false);
  UPDATE idempotency_receipt SET status='SUCCEEDED',response_status=201,response_body=response,completed_at=clock_timestamp()
    WHERE idempotency_receipt_id=idem.idempotency_receipt_id;
  RETURN response;
END;
$$;

-- 094 remains the sole Review implementation. Its attachment insert now
-- fails closed unless every requested attachment is the exact frozen binding
-- for that same row, source version, receipt, and evidence hash.
CREATE FUNCTION refs_require_wbs_payable_attachment_binding() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog,public,pg_temp AS $$
BEGIN
  IF NOT EXISTS(
    SELECT 1 FROM wbs_payable_review_evidence e
    JOIN wbs_payable_attachment_binding b
      ON b.tenant_id=e.tenant_id AND b.entity_id=e.entity_id
      AND b.wbs_inbound_row_id=e.wbs_inbound_row_id AND b.attachment_id=NEW.attachment_id
      AND b.source_version=e.source_version AND b.receipt_hash=e.receipt_hash AND b.evidence_hash=e.evidence_hash
    JOIN attachment a
      ON a.tenant_id=b.tenant_id AND a.entity_id=b.entity_id AND a.attachment_id=b.attachment_id
      AND a.content_hash=b.attachment_content_hash AND a.storage_version=b.attachment_storage_version
      AND a.finalization_status='VERIFIED_CLEAN' AND a.scan_status='CLEAN'
    WHERE e.tenant_id=NEW.tenant_id AND e.entity_id=NEW.entity_id
      AND e.wbs_payable_review_evidence_id=NEW.wbs_payable_review_evidence_id
  ) THEN
    RAISE EXCEPTION 'WBS Payable review attachment lacks the exact immutable row binding' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER wbs_payable_review_attachment_exact_binding
  BEFORE INSERT ON wbs_payable_review_attachment
  FOR EACH ROW EXECUTE FUNCTION refs_require_wbs_payable_attachment_binding();

REVOKE ALL ON wbs_payable_attachment_binding FROM PUBLIC,refs_app;
REVOKE EXECUTE ON FUNCTION refs_bind_wbs_payable_attachment_hash(uuid,uuid,uuid,uuid,bigint,text,text,text,text,text,text,text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION refs_bind_wbs_payable_attachment(uuid,uuid,uuid,uuid,bigint,text,text,text,text,text,text,text,text,text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION refs_require_wbs_payable_attachment_binding() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION refs_bind_wbs_payable_attachment_hash(uuid,uuid,uuid,uuid,bigint,text,text,text,text,text,text,text) TO refs_app;
GRANT EXECUTE ON FUNCTION refs_bind_wbs_payable_attachment(uuid,uuid,uuid,uuid,bigint,text,text,text,text,text,text,text,text,text) TO refs_app;

COMMIT;
