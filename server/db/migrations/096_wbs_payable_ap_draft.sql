BEGIN;

CREATE TABLE wbs_payable_draft_evidence (
  wbs_payable_draft_evidence_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  entity_id uuid NOT NULL,
  wbs_payable_review_evidence_id uuid NOT NULL,
  wbs_inbound_row_id uuid NOT NULL,
  source_document_id uuid NOT NULL,
  staging_item_id uuid NOT NULL,
  business_document_id uuid NOT NULL,
  journal_entry_id uuid NOT NULL,
  mapping_snapshot_id uuid NOT NULL,
  attachment_ids uuid[] NOT NULL CHECK(cardinality(attachment_ids) BETWEEN 1 AND 25),
  expected_evidence_hash text NOT NULL CHECK(expected_evidence_hash ~ '^sha256:[0-9a-f]{64}$'),
  request_hash text NOT NULL CHECK(request_hash ~ '^sha256:[0-9a-f]{64}$'),
  maker_reason text NOT NULL CHECK(length(btrim(maker_reason)) BETWEEN 8 AND 2000),
  created_by text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE(tenant_id,entity_id,wbs_payable_review_evidence_id),
  UNIQUE(tenant_id,entity_id,wbs_inbound_row_id),
  UNIQUE(tenant_id,entity_id,source_document_id),
  UNIQUE(tenant_id,entity_id,staging_item_id),
  UNIQUE(tenant_id,entity_id,business_document_id),
  UNIQUE(tenant_id,entity_id,journal_entry_id),
  FOREIGN KEY(tenant_id,entity_id) REFERENCES entity(tenant_id,entity_id),
  FOREIGN KEY(tenant_id,entity_id,wbs_payable_review_evidence_id) REFERENCES wbs_payable_review_evidence(tenant_id,entity_id,wbs_payable_review_evidence_id),
  FOREIGN KEY(tenant_id,entity_id,wbs_inbound_row_id) REFERENCES wbs_inbound_row(tenant_id,entity_id,wbs_inbound_row_id),
  FOREIGN KEY(tenant_id,entity_id,source_document_id) REFERENCES source_document(tenant_id,entity_id,source_document_id),
  FOREIGN KEY(tenant_id,entity_id,staging_item_id) REFERENCES staging_item(tenant_id,entity_id,staging_item_id),
  FOREIGN KEY(tenant_id,entity_id,business_document_id) REFERENCES business_document(tenant_id,entity_id,business_document_id),
  FOREIGN KEY(tenant_id,entity_id,journal_entry_id) REFERENCES journal_entry(tenant_id,entity_id,journal_entry_id),
  FOREIGN KEY(tenant_id,mapping_snapshot_id) REFERENCES mapping_snapshot(tenant_id,mapping_snapshot_id)
);

ALTER TABLE wbs_payable_draft_evidence ENABLE ROW LEVEL SECURITY;
CREATE POLICY wbs_payable_draft_evidence_scope_policy ON wbs_payable_draft_evidence
  USING(tenant_id=refs_current_tenant() AND refs_entity_allowed(entity_id))
  WITH CHECK(tenant_id=refs_current_tenant() AND refs_entity_allowed(entity_id));
CREATE TRIGGER wbs_payable_draft_evidence_append_only BEFORE UPDATE OR DELETE ON wbs_payable_draft_evidence
  FOR EACH ROW EXECUTE FUNCTION reject_mutation();

CREATE FUNCTION refs_create_wbs_payable_ap_draft_hash(
  p_tenant uuid,p_entity uuid,p_row uuid,p_review uuid,p_expected_revision bigint,
  p_expected_evidence_hash text,p_mapping uuid,p_attachment_ids uuid[],p_reason text
) RETURNS text
LANGUAGE sql IMMUTABLE SET search_path=pg_catalog,public,pg_temp AS $$
  SELECT refs_jsonb_hash(jsonb_build_object(
    'tenant_id',p_tenant,'entity_id',p_entity,'wbs_inbound_row_id',p_row,
    'wbs_payable_review_evidence_id',p_review,'expected_revision',p_expected_revision,
    'expected_evidence_hash',p_expected_evidence_hash,'mapping_snapshot_id',p_mapping,
    'attachment_ids',to_jsonb(ARRAY(SELECT value FROM unnest(COALESCE(p_attachment_ids,'{}'::uuid[])) value ORDER BY value)),
    'reason',btrim(p_reason)
  ))
$$;

CREATE FUNCTION refs_create_wbs_payable_ap_draft(
  p_tenant uuid,p_entity uuid,p_row uuid,p_review uuid,p_expected_revision bigint,
  p_expected_evidence_hash text,p_mapping uuid,p_attachment_ids uuid[],p_reason text,
  p_idempotency_key text,p_request_hash text
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE actor text:=refs_current_actor(); idem idempotency_receipt; evidence wbs_payable_review_evidence;
DECLARE staging staging_item; source source_document; evaluation rule_evaluation; mapping mapping_snapshot;
DECLARE requested_attachments uuid[]; frozen_attachments uuid[]; attachment_count integer;
DECLARE vendor_ref text; vendor_name text; offset_account text; document_number text; journal_number text; description text;
DECLARE amount numeric(20,4); business_id uuid:=gen_random_uuid(); journal_id uuid:=gen_random_uuid(); bridge_id uuid:=gen_random_uuid();
DECLARE response jsonb; event_payload jsonb;
BEGIN
  PERFORM refs_assert_scope(p_tenant,p_entity,'AP.BILL.CREATE');
  IF actor IS NULL THEN RAISE EXCEPTION 'Authenticated AP Bill maker missing' USING ERRCODE='42501'; END IF;
  IF p_request_hash<>refs_create_wbs_payable_ap_draft_hash(p_tenant,p_entity,p_row,p_review,p_expected_revision,p_expected_evidence_hash,p_mapping,p_attachment_ids,p_reason) THEN
    RAISE EXCEPTION 'WBS Payable AP Draft request hash is not canonical' USING ERRCODE='22023';
  END IF;
  IF p_expected_revision<>0 OR p_expected_evidence_hash !~ '^sha256:[0-9a-f]{64}$'
     OR COALESCE(cardinality(p_attachment_ids),0) NOT BETWEEN 1 AND 25
     OR COALESCE(length(btrim(p_reason)),0) NOT BETWEEN 8 AND 2000 THEN
    RAISE EXCEPTION 'WBS Payable AP Draft requires revision zero, exact evidence, attachments and maker reason' USING ERRCODE='22023';
  END IF;
  SELECT array_agg(value ORDER BY value) INTO requested_attachments FROM unnest(p_attachment_ids) value;
  IF cardinality(requested_attachments)<>(SELECT count(DISTINCT value) FROM unnest(p_attachment_ids) value) THEN
    RAISE EXCEPTION 'WBS Payable AP Draft attachment set must be unique' USING ERRCODE='22023';
  END IF;

  INSERT INTO idempotency_receipt(tenant_id,operation_scope,idempotency_key,request_hash,status,actor_id)
    VALUES(p_tenant,'CREATE_WBS_PAYABLE_AP_DRAFT:'||p_entity,p_idempotency_key,p_request_hash,'IN_PROGRESS',actor)
    ON CONFLICT(tenant_id,operation_scope,idempotency_key) DO NOTHING;
  SELECT * INTO idem FROM idempotency_receipt WHERE tenant_id=p_tenant
    AND operation_scope='CREATE_WBS_PAYABLE_AP_DRAFT:'||p_entity AND idempotency_key=p_idempotency_key FOR UPDATE;
  IF idem.request_hash<>p_request_hash THEN RAISE EXCEPTION 'Idempotency key reused with a different WBS Payable AP Draft request' USING ERRCODE='23505'; END IF;
  IF idem.status='SUCCEEDED' THEN RETURN idem.response_body||jsonb_build_object('idempotent',true); END IF;

  SELECT * INTO evidence FROM wbs_payable_review_evidence
    WHERE tenant_id=p_tenant AND entity_id=p_entity AND wbs_payable_review_evidence_id=p_review FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Reviewed WBS Payable evidence not found' USING ERRCODE='P0002'; END IF;
  IF evidence.wbs_inbound_row_id<>p_row OR evidence.evidence_hash<>p_expected_evidence_hash
     OR evidence.mapping_snapshot_id<>p_mapping THEN
    RAISE EXCEPTION 'Reviewed WBS Payable Draft evidence revision conflict' USING ERRCODE='40001';
  END IF;
  IF actor=evidence.reviewed_by THEN RAISE EXCEPTION 'WBS Payable maker and reviewer must be different actors' USING ERRCODE='42501'; END IF;
  IF EXISTS(SELECT 1 FROM wbs_payable_draft_evidence d WHERE d.tenant_id=p_tenant AND d.entity_id=p_entity
      AND (d.wbs_payable_review_evidence_id=p_review OR d.wbs_inbound_row_id=p_row OR d.source_document_id=evidence.source_document_id)) THEN
    RAISE EXCEPTION 'Reviewed WBS Payable evidence was already consumed by another Draft command' USING ERRCODE='23505';
  END IF;

  SELECT * INTO staging FROM staging_item WHERE tenant_id=p_tenant AND entity_id=p_entity
    AND staging_item_id=evidence.staging_item_id FOR UPDATE;
  SELECT * INTO source FROM source_document WHERE tenant_id=p_tenant AND entity_id=p_entity
    AND source_document_id=evidence.source_document_id FOR SHARE;
  SELECT * INTO evaluation FROM rule_evaluation WHERE tenant_id=p_tenant
    AND rule_evaluation_id=evidence.rule_evaluation_id FOR SHARE;
  SELECT * INTO mapping FROM mapping_snapshot WHERE tenant_id=p_tenant
    AND mapping_snapshot_id=p_mapping FOR SHARE;
  IF staging.staging_item_id IS NULL OR source.source_document_id IS NULL OR evaluation.rule_evaluation_id IS NULL OR mapping.mapping_snapshot_id IS NULL
     OR staging.version<>p_expected_revision OR staging.status<>'READY_FOR_DRAFT'
     OR staging.source_document_id<>evidence.source_document_id OR staging.mapping_snapshot_id<>p_mapping
     OR evaluation.source_document_id<>evidence.source_document_id OR evaluation.mapping_snapshot_id<>p_mapping
     OR source.status<>'READY_FOR_DRAFT' OR source.document_type<>'WBS_PAYABLE'
     OR source.source_system<>'WBS' OR source.source_module<>'payable'
     OR evidence.period_id IS DISTINCT FROM (evaluation.result->>'period_id')::uuid
     OR mapping.snapshot_hash<>refs_jsonb_hash(jsonb_build_object('input_keys',mapping.input_keys,'output_rules',mapping.output_rules))
     OR evaluation.evaluation_digest<>refs_rule_evaluation_hash(evaluation.source_document_id,evaluation.setting_snapshot_id,evaluation.mapping_snapshot_id,evaluation.rule_code,evaluation.rule_version,evaluation.matched_facts,evaluation.result,evaluation.input_digest) THEN
    RAISE EXCEPTION 'Reviewed WBS Payable evidence chain is incomplete or changed' USING ERRCODE='23514';
  END IF;
  PERFORM 1 FROM accounting_period WHERE tenant_id=p_tenant AND entity_id=p_entity AND period_id=evidence.period_id
    AND status='OPEN' AND source.accounting_date BETWEEN starts_on AND ends_on FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Reviewed WBS Payable AP Draft requires the frozen OPEN period' USING ERRCODE='55000'; END IF;
  IF NOT refs_auto_staging_ready(p_tenant,p_entity,evidence.staging_item_id,evidence.period_id) THEN
    RAISE EXCEPTION 'Reviewed WBS Payable staging evidence is not eligible for an AP Draft' USING ERRCODE='23514';
  END IF;

  document_number:=NULLIF(btrim(evidence.document_number),'');
  vendor_ref:=NULLIF(btrim(evaluation.result->>'vendor_ref'),'');
  vendor_name:=NULLIF(btrim(evaluation.result->>'vendor_name'),'');
  offset_account:=NULLIF(btrim(evaluation.result->>'offset_account_code'),'');
  IF document_number IS NULL OR vendor_ref IS NULL OR vendor_name IS NULL OR offset_account IS NULL
     OR COALESCE(evaluation.result->>'gross_amount','') !~ '^(0|[1-9][0-9]*)(\.[0-9]{4})$'
     OR COALESCE(evaluation.result->>'currency','') IS DISTINCT FROM source.currency
     OR COALESCE(evaluation.result->>'vendor_ref','') IS DISTINCT FROM mapping.output_rules->>'vendor_ref'
     OR COALESCE(evaluation.result->>'offset_account_code','') IS DISTINCT FROM mapping.output_rules->>'offset_account_code'
     OR COALESCE(evaluation.result->>'invoice_date','') IS DISTINCT FROM evidence.invoice_date::text
     OR evaluation.result->>'due_date' IS DISTINCT FROM to_jsonb(evidence.due_date)#>>'{}' THEN
    RAISE EXCEPTION 'Reviewed WBS Payable business facts are incomplete or changed' USING ERRCODE='23514';
  END IF;
  amount:=(evaluation.result->>'gross_amount')::numeric(20,4);
  IF amount<=0 OR amount<>source.gross_amount OR evidence.due_date IS NOT NULL AND evidence.due_date<evidence.invoice_date THEN
    RAISE EXCEPTION 'Reviewed WBS Payable amount or dates are invalid' USING ERRCODE='23514';
  END IF;
  PERFORM 1 FROM member_master WHERE tenant_id=p_tenant AND entity_id=p_entity AND member_ref=vendor_ref
    AND member_type='VENDOR' AND active FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Reviewed WBS Payable vendor is not an active local VENDOR' USING ERRCODE='23503'; END IF;
  PERFORM 1 FROM account_master WHERE tenant_id=p_tenant AND entity_id=p_entity AND account_code=offset_account AND active FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Reviewed WBS Payable offset account is inactive or missing' USING ERRCODE='23503'; END IF;
  PERFORM 1 FROM account_master WHERE tenant_id=p_tenant AND entity_id=p_entity AND account_code='291001'
    AND active AND requires_member AND required_member_type='VENDOR' FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Reviewed WBS Payable requires active 291001 VENDOR control account' USING ERRCODE='23503'; END IF;

  SELECT array_agg(attachment_id ORDER BY attachment_id),count(*) INTO frozen_attachments,attachment_count
    FROM wbs_payable_review_attachment WHERE tenant_id=p_tenant AND entity_id=p_entity AND wbs_payable_review_evidence_id=p_review;
  IF requested_attachments IS DISTINCT FROM frozen_attachments OR attachment_count<>cardinality(requested_attachments) THEN
    RAISE EXCEPTION 'WBS Payable AP Draft must reuse the exact frozen review attachments' USING ERRCODE='23514';
  END IF;
  IF attachment_count<>(SELECT count(*) FROM attachment a WHERE a.tenant_id=p_tenant AND a.entity_id=p_entity
      AND a.attachment_id=ANY(requested_attachments) AND a.finalization_status='VERIFIED_CLEAN'
      AND a.scan_status='CLEAN' AND a.verified_at IS NOT NULL AND a.finalized_at IS NOT NULL)
     OR attachment_count<>(SELECT count(*) FROM source_link sl WHERE sl.tenant_id=p_tenant AND sl.entity_id=p_entity
      AND sl.link_type='SOURCE_ATTACHMENT' AND sl.source_document_id=evidence.source_document_id
      AND sl.staging_item_id=evidence.staging_item_id AND sl.attachment_id=ANY(requested_attachments)) THEN
    RAISE EXCEPTION 'WBS Payable AP Draft attachment evidence is no longer exact and verified clean' USING ERRCODE='23503';
  END IF;

  journal_number:='WBS-AP-'||replace(p_review::text,'-','');
  description:='WBS AP Bill '||document_number;
  INSERT INTO journal_entry(journal_entry_id,tenant_id,entity_id,period_id,journal_number,journal_type,status,journal_date,currency,description,created_by)
    VALUES(journal_id,p_tenant,p_entity,evidence.period_id,journal_number,'AUTO','DRAFT',source.accounting_date,source.currency,description,actor);
  INSERT INTO business_document(business_document_id,tenant_id,entity_id,source_document_id,draft_journal_entry_id,document_kind,document_number,counterparty_ref,counterparty_name,currency,accounting_date,due_date,gross_amount,open_balance,status,created_by)
    VALUES(business_id,p_tenant,p_entity,evidence.source_document_id,journal_id,'AP_BILL',document_number,vendor_ref,vendor_name,source.currency,source.accounting_date,evidence.due_date,amount,amount,'DRAFT',actor);
  INSERT INTO journal_line(tenant_id,entity_id,period_id,journal_entry_id,line_no,account_code,debit_amount,credit_amount,member_ref,description,dimensions)
    VALUES(p_tenant,p_entity,evidence.period_id,journal_id,1,offset_account,amount,0,NULL,description,'{}'::jsonb),
          (p_tenant,p_entity,evidence.period_id,journal_id,2,'291001',0,amount,vendor_ref,description,'{}'::jsonb);
  INSERT INTO source_link(tenant_id,entity_id,link_type,source_document_id,staging_item_id,journal_entry_id,created_by)
    VALUES(p_tenant,p_entity,'SOURCE_TO_JE',evidence.source_document_id,evidence.staging_item_id,journal_id,actor);
  INSERT INTO source_link(tenant_id,entity_id,link_type,journal_entry_id,attachment_id,created_by)
    SELECT p_tenant,p_entity,'JE_ATTACHMENT',journal_id,value,actor FROM unnest(requested_attachments) value;
  UPDATE staging_item SET status='DRAFT_CREATED',version=version+1,updated_at=clock_timestamp()
    WHERE tenant_id=p_tenant AND entity_id=p_entity AND staging_item_id=evidence.staging_item_id AND version=p_expected_revision;
  IF NOT FOUND THEN RAISE EXCEPTION 'Reviewed WBS Payable staging revision conflict' USING ERRCODE='40001'; END IF;
  INSERT INTO wbs_payable_draft_evidence(wbs_payable_draft_evidence_id,tenant_id,entity_id,wbs_payable_review_evidence_id,wbs_inbound_row_id,source_document_id,staging_item_id,business_document_id,journal_entry_id,mapping_snapshot_id,attachment_ids,expected_evidence_hash,request_hash,maker_reason,created_by)
    VALUES(bridge_id,p_tenant,p_entity,p_review,p_row,evidence.source_document_id,evidence.staging_item_id,business_id,journal_id,p_mapping,requested_attachments,p_expected_evidence_hash,p_request_hash,btrim(p_reason),actor);

  event_payload:=jsonb_build_object('wbs_payable_draft_evidence_id',bridge_id,'wbs_payable_review_evidence_id',p_review,
    'wbs_inbound_row_id',p_row,'source_document_id',evidence.source_document_id,'staging_item_id',evidence.staging_item_id,
    'business_document_id',business_id,'journal_entry_id',journal_id,'mapping_snapshot_id',p_mapping,
    'status','DRAFT','journal_type','AUTO','revision',0,'staging_version',p_expected_revision+1);
  INSERT INTO audit_event(tenant_id,entity_id,event_type,object_type,object_id,action,actor_id,actor_type,permission_used,request_id,correlation_id,idempotency_key,after_hash,reason,metadata)
    VALUES(p_tenant,p_entity,'WBS_PAYABLE_AP_DRAFT_CREATED','BUSINESS_DOCUMENT',business_id,'CREATE_WBS_PAYABLE_AP_DRAFT',actor,'USER','AP.BILL.CREATE',p_idempotency_key,p_idempotency_key,p_idempotency_key,p_request_hash,btrim(p_reason),event_payload);
  INSERT INTO outbox_event(tenant_id,entity_id,aggregate_type,aggregate_id,event_type,payload,payload_hash)
    VALUES(p_tenant,p_entity,'BUSINESS_DOCUMENT',business_id,'WBS_PAYABLE_AP_DRAFT_CREATED',event_payload,refs_jsonb_hash(event_payload));
  response:=event_payload||jsonb_build_object('idempotent',false,'can_create_draft',false,'can_submit',false,'can_review',false,'can_approve',false,'can_post',false);
  UPDATE idempotency_receipt SET status='SUCCEEDED',response_status=201,response_body=response,completed_at=clock_timestamp()
    WHERE idempotency_receipt_id=idem.idempotency_receipt_id;
  RETURN response;
END;
$$;

REVOKE ALL ON wbs_payable_draft_evidence FROM PUBLIC,refs_app;
GRANT SELECT ON wbs_payable_draft_evidence TO refs_app;
REVOKE EXECUTE ON FUNCTION refs_create_wbs_payable_ap_draft_hash(uuid,uuid,uuid,uuid,bigint,text,uuid,uuid[],text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION refs_create_wbs_payable_ap_draft(uuid,uuid,uuid,uuid,bigint,text,uuid,uuid[],text,text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION refs_create_wbs_payable_ap_draft_hash(uuid,uuid,uuid,uuid,bigint,text,uuid,uuid[],text) TO refs_app;
GRANT EXECUTE ON FUNCTION refs_create_wbs_payable_ap_draft(uuid,uuid,uuid,uuid,bigint,text,uuid,uuid[],text,text,text) TO refs_app;

COMMIT;
