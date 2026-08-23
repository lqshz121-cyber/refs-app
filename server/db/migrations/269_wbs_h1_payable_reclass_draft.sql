BEGIN;

INSERT INTO permission_catalog(permission_code,domain,risk_class,sod_class)
VALUES('WBS.H1.PAYABLE.DRAFT','WBS','HIGH','WBS_H1_PAYABLE_DRAFTER')
ON CONFLICT(permission_code) DO UPDATE SET domain=EXCLUDED.domain,active=true,
  risk_class=EXCLUDED.risk_class,sod_class=EXCLUDED.sod_class,effective_to=NULL;

CREATE TABLE wbs_h1_payable_reclass_draft_evidence (
  wbs_h1_payable_reclass_draft_evidence_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  entity_id uuid NOT NULL,
  period_id uuid NOT NULL,
  source_record_hash text NOT NULL CHECK(source_record_hash~'^sha256:[0-9a-f]{64}$'),
  proposal_hash text NOT NULL CHECK(proposal_hash~'^sha256:[0-9a-f]{64}$'),
  settings_decision_hash text NOT NULL CHECK(settings_decision_hash~'^sha256:[0-9a-f]{64}$'),
  source_document_id uuid NOT NULL,
  source_document_line_id uuid NOT NULL,
  attachment_id uuid NOT NULL,
  original_journal_entry_id uuid NOT NULL,
  journal_entry_id uuid NOT NULL,
  request_hash text NOT NULL CHECK(request_hash~'^sha256:[0-9a-f]{64}$'),
  created_by text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE(tenant_id,entity_id,source_record_hash),
  UNIQUE(tenant_id,entity_id,journal_entry_id),
  FOREIGN KEY(tenant_id,entity_id) REFERENCES entity(tenant_id,entity_id),
  FOREIGN KEY(tenant_id,entity_id,period_id) REFERENCES accounting_period(tenant_id,entity_id,period_id),
  FOREIGN KEY(tenant_id,entity_id,source_document_id) REFERENCES source_document(tenant_id,entity_id,source_document_id),
  FOREIGN KEY(tenant_id,entity_id,source_document_line_id) REFERENCES source_document_line(tenant_id,entity_id,source_document_line_id),
  FOREIGN KEY(tenant_id,entity_id,attachment_id) REFERENCES attachment(tenant_id,entity_id,attachment_id),
  FOREIGN KEY(tenant_id,entity_id,original_journal_entry_id) REFERENCES journal_entry(tenant_id,entity_id,journal_entry_id),
  FOREIGN KEY(tenant_id,entity_id,journal_entry_id) REFERENCES journal_entry(tenant_id,entity_id,journal_entry_id)
);

ALTER TABLE wbs_h1_payable_reclass_draft_evidence ENABLE ROW LEVEL SECURITY;
CREATE POLICY wbs_h1_payable_reclass_draft_evidence_scope ON wbs_h1_payable_reclass_draft_evidence
  USING(tenant_id=refs_current_tenant() AND refs_entity_allowed(entity_id))
  WITH CHECK(tenant_id=refs_current_tenant() AND refs_entity_allowed(entity_id));
CREATE TRIGGER wbs_h1_payable_reclass_draft_evidence_append_only BEFORE UPDATE OR DELETE ON wbs_h1_payable_reclass_draft_evidence
  FOR EACH ROW EXECUTE FUNCTION reject_mutation();

CREATE FUNCTION refs_create_wbs_h1_payable_reclass_draft_hash(
  p_tenant uuid,p_entity uuid,p_period uuid,p_source_record_hash text,p_proposal_hash text,p_reason text
) RETURNS text LANGUAGE sql IMMUTABLE SET search_path=pg_catalog,public,pg_temp AS $$
  SELECT refs_jsonb_hash(jsonb_build_object('tenant_id',p_tenant,'entity_id',p_entity,'period_id',p_period,
    'source_record_hash',p_source_record_hash,'proposal_hash',p_proposal_hash,'reason',btrim(p_reason),
    'action','CREATE_WBS_H1_PAYABLE_RECLASS_DRAFT'))
$$;

CREATE OR REPLACE FUNCTION refs_reserve_idempotency(p_tenant uuid,p_scope text,p_key text,p_request_hash text,p_actor text) RETURNS idempotency_receipt
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE receipt idempotency_receipt;
BEGIN
  IF refs_current_tenant() IS DISTINCT FROM p_tenant THEN RAISE EXCEPTION 'Idempotency tenant scope denied' USING ERRCODE='42501'; END IF;
  IF refs_current_actor() IS DISTINCT FROM p_actor THEN RAISE EXCEPTION 'Actor must come from the authenticated session' USING ERRCODE='42501'; END IF;
  IF p_scope NOT LIKE 'POST_JOURNAL:%' AND p_scope NOT LIKE 'EDIT_JOURNAL:%' AND p_scope NOT LIKE 'CLOSE_PERIOD:%' AND p_scope NOT LIKE 'RETIRE_CONFIG:%' AND p_scope NOT LIKE 'CREATE_MANUAL_JOURNAL:%' AND p_scope NOT LIKE 'CREATE_AUTO_JOURNAL:%' AND p_scope NOT LIKE 'CREATE_REVERSAL:%' AND p_scope NOT LIKE 'CREATE_RECLASS:%' AND p_scope NOT LIKE 'JOURNAL_SUBMIT:%' AND p_scope NOT LIKE 'JOURNAL_REVIEW:%' AND p_scope NOT LIKE 'JOURNAL_APPROVE:%' AND p_scope NOT LIKE 'JOURNAL_REJECT:%' AND p_scope NOT LIKE 'AR_RECEIPT_REVERSAL:%' AND p_scope NOT LIKE 'AP_PAYMENT_REVERSAL:%' AND p_scope NOT LIKE 'PREPARE_STATEMENT_SNAPSHOT:%' AND p_scope NOT LIKE 'APPROVE_STATEMENT_SNAPSHOT:%' AND p_scope NOT LIKE 'WBS_H1_PAYABLE_RECLASS_DRAFT:%' THEN RAISE EXCEPTION 'Idempotency operation scope denied' USING ERRCODE='42501'; END IF;
  INSERT INTO idempotency_receipt(tenant_id,operation_scope,idempotency_key,request_hash,status,actor_id) VALUES(p_tenant,p_scope,p_key,p_request_hash,'IN_PROGRESS',p_actor) ON CONFLICT(tenant_id,operation_scope,idempotency_key) DO NOTHING;
  SELECT * INTO receipt FROM idempotency_receipt WHERE tenant_id=p_tenant AND operation_scope=p_scope AND idempotency_key=p_key FOR UPDATE;
  IF receipt.request_hash<>p_request_hash OR receipt.actor_id<>p_actor THEN RAISE EXCEPTION 'Idempotency key reused by a different request or actor' USING ERRCODE='23505'; END IF;
  RETURN receipt;
END $$;

CREATE FUNCTION refs_create_wbs_h1_payable_reclass_draft(
  p_tenant uuid,p_entity uuid,p_period uuid,p_source_record_hash text,p_proposal_hash text,p_reason text,
  p_idempotency_key text,p_request_hash text
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE actor text:=refs_current_actor(); receipt idempotency_receipt; page_doc jsonb; proposal_row jsonb; candidate jsonb; settings_decision jsonb;
DECLARE total_rows integer; page_offset integer:=0; trace wbs_test_import_draft; original journal_entry;
DECLARE original_debit journal_line; original_credit journal_line; source_row wbs_h1_payable_mapping_source_stage;
DECLARE debit_line jsonb; credit_line jsonb; draft_lines jsonb; inner_hash text; inner_result jsonb;
DECLARE journal_id uuid; evidence_id uuid:=gen_random_uuid(); response jsonb; event_payload jsonb;
DECLARE amount numeric(20,4); debit_account text; credit_account text; debit_member text; credit_member text;
DECLARE debit_dimensions jsonb; credit_dimensions jsonb; child_key text;
BEGIN
  PERFORM refs_assert_scope(p_tenant,p_entity,'WBS.H1.PAYABLE.DRAFT');
  PERFORM refs_assert_scope(p_tenant,p_entity,'GL.JE.CREATE');
  IF actor IS NULL THEN RAISE EXCEPTION 'Authenticated WBS Payable maker missing' USING ERRCODE='42501'; END IF;
  IF p_source_record_hash!~'^sha256:[0-9a-f]{64}$' OR p_proposal_hash!~'^sha256:[0-9a-f]{64}$'
     OR p_reason IS NULL OR length(btrim(p_reason)) NOT BETWEEN 8 AND 2000
     OR p_idempotency_key IS NULL OR length(p_idempotency_key) NOT BETWEEN 8 AND 200
     OR p_request_hash<>refs_create_wbs_h1_payable_reclass_draft_hash(p_tenant,p_entity,p_period,p_source_record_hash,p_proposal_hash,p_reason) THEN
    RAISE EXCEPTION 'WBS H1 Payable Draft command is not canonical' USING ERRCODE='22023';
  END IF;

  receipt:=refs_reserve_idempotency(p_tenant,'WBS_H1_PAYABLE_RECLASS_DRAFT:'||p_entity,p_idempotency_key,p_request_hash,actor);
  IF receipt.status='SUCCEEDED' THEN RETURN receipt.response_body||jsonb_build_object('idempotent',true); END IF;

  LOOP
    page_doc:=refs_read_wbs_h1_payable_accounting_proposal(p_tenant,p_entity,p_period,200,page_offset);
    total_rows:=(page_doc->>'source_record_count')::integer;
    FOR candidate IN SELECT value FROM jsonb_array_elements(page_doc->'rows') LOOP
      IF candidate->>'source_record_hash'=p_source_record_hash THEN proposal_row:=candidate; EXIT; END IF;
    END LOOP;
    EXIT WHEN proposal_row IS NOT NULL OR page_offset+200>=total_rows;
    page_offset:=page_offset+200;
  END LOOP;
  IF proposal_row IS NULL OR proposal_row->>'proposal_hash'<>p_proposal_hash
     OR proposal_row->>'status'<>'READY_FOR_CONTROLLER_REVIEW'
     OR page_doc->>'settings_outcome'<>'APPROVED' OR page_doc->>'settings_decision_hash' IS NULL THEN
    RAISE EXCEPTION 'WBS H1 Payable proposal is missing, stale, exceptional, or not backed by approved Settings' USING ERRCODE='40001';
  END IF;
  settings_decision:=refs_read_wbs_h1_accounting_settings_decision(p_tenant,p_entity,p_period,page_doc->>'settings_proposal_hash');
  IF settings_decision IS NULL OR settings_decision->>'decision_hash'<>page_doc->>'settings_decision_hash'
     OR settings_decision->>'outcome'<>'APPROVED' OR settings_decision->>'decided_by'=actor THEN
    RAISE EXCEPTION 'The WBS Payable Draft maker must be distinct from the Settings Controller' USING ERRCODE='42501';
  END IF;

  SELECT * INTO source_row FROM wbs_h1_payable_mapping_source_stage
    WHERE tenant_id=p_tenant AND entity_id=p_entity AND source_record_hash=p_source_record_hash FOR SHARE;
  IF NOT FOUND OR source_row.period_code<>page_doc->>'period_code' OR source_row.amount<=0
     OR source_row.accounting_date::text<>proposal_row->>'accounting_date'
     OR to_char(source_row.amount,'FM999999999999990.0000')<>proposal_row->>'amount' THEN
    RAISE EXCEPTION 'WBS H1 Payable source evidence changed or has no controlled posted baseline' USING ERRCODE='40001';
  END IF;

  SELECT * INTO trace FROM wbs_test_import_draft
    WHERE tenant_id=p_tenant AND entity_id=p_entity AND period_id=p_period AND source_record_hash=p_source_record_hash FOR SHARE;
  IF NOT FOUND OR NOT trace.test_only OR trace.provenance_mode<>'UNSIGNED_TEST_ONLY' THEN
    RAISE EXCEPTION 'Controlled WBS H1 posted source evidence is unavailable' USING ERRCODE='23503';
  END IF;
  PERFORM 1 FROM source_document d JOIN source_document_line l
    ON (l.tenant_id,l.entity_id,l.source_document_id)=(d.tenant_id,d.entity_id,d.source_document_id)
    WHERE d.tenant_id=p_tenant AND d.entity_id=p_entity AND d.source_document_id=trace.source_document_id
      AND l.source_document_line_id=trace.source_document_line_id AND d.payload_hash=p_source_record_hash
      AND d.status='POSTED' AND d.currency=page_doc->>'currency' AND d.gross_amount=source_row.amount
      AND l.amount=source_row.amount AND l.party_ref=source_row.vendor_no FOR SHARE OF d,l;
  IF NOT FOUND THEN RAISE EXCEPTION 'Controlled WBS H1 source identity or amount changed' USING ERRCODE='40001'; END IF;
  PERFORM 1 FROM attachment a JOIN source_link sl ON sl.tenant_id=a.tenant_id AND sl.entity_id=a.entity_id AND sl.attachment_id=a.attachment_id
    WHERE a.tenant_id=p_tenant AND a.entity_id=p_entity AND a.attachment_id=trace.attachment_id
      AND sl.source_document_id=trace.source_document_id AND sl.link_type='SOURCE_ATTACHMENT'
      AND a.scan_status='CLEAN' AND a.finalization_status='VERIFIED_CLEAN' AND a.content_hash=p_source_record_hash FOR SHARE OF a,sl;
  IF NOT FOUND THEN RAISE EXCEPTION 'Controlled WBS H1 attachment evidence changed' USING ERRCODE='40001'; END IF;

  SELECT * INTO original FROM journal_entry WHERE tenant_id=p_tenant AND entity_id=p_entity
    AND journal_entry_id=trace.journal_entry_id AND period_id=p_period FOR SHARE;
  IF NOT FOUND OR original.status<>'POSTED' OR original.currency::text<>page_doc->>'currency' THEN
    RAISE EXCEPTION 'Controlled WBS H1 baseline Journal is not Posted in the selected period' USING ERRCODE='55000';
  END IF;
  SELECT * INTO original_debit FROM journal_line WHERE tenant_id=p_tenant AND entity_id=p_entity
    AND journal_entry_id=original.journal_entry_id AND account_code='610000' AND debit_amount=source_row.amount AND credit_amount=0 FOR SHARE;
  SELECT * INTO original_credit FROM journal_line WHERE tenant_id=p_tenant AND entity_id=p_entity
    AND journal_entry_id=original.journal_entry_id AND account_code='291001' AND credit_amount=source_row.amount AND debit_amount=0
      AND member_ref=source_row.vendor_no FOR SHARE;
  IF original_debit.journal_line_id IS NULL OR original_credit.journal_line_id IS NULL
     OR (SELECT count(*) FROM journal_line WHERE tenant_id=p_tenant AND entity_id=p_entity AND journal_entry_id=original.journal_entry_id)<>2 THEN
    RAISE EXCEPTION 'Controlled WBS H1 baseline Journal no longer matches the exact two-line placeholder entry' USING ERRCODE='40001';
  END IF;
  IF EXISTS(SELECT 1 FROM wbs_h1_payable_reclass_draft_evidence WHERE tenant_id=p_tenant AND entity_id=p_entity AND source_record_hash=p_source_record_hash) THEN
    RAISE EXCEPTION 'A WBS H1 Payable reclassification Draft already exists for this source' USING ERRCODE='23505';
  END IF;

  debit_line:=proposal_row->'proposed_lines'->0; credit_line:=proposal_row->'proposed_lines'->1;
  IF debit_line->>'side'<>'DEBIT' OR credit_line->>'side'<>'CREDIT' THEN
    RAISE EXCEPTION 'WBS H1 Payable proposal line order is invalid' USING ERRCODE='40001';
  END IF;
  amount:=(debit_line->>'amount')::numeric(20,4); debit_account:=debit_line->>'account_code';credit_account:=credit_line->>'account_code';
  debit_member:=debit_line->>'member_ref';credit_member:=credit_line->>'member_ref';
  debit_dimensions:=jsonb_strip_nulls(jsonb_build_object('project_ref',debit_line->>'project_ref','cost_code_ref',debit_line->>'cost_code_ref'));
  credit_dimensions:=jsonb_strip_nulls(jsonb_build_object('project_ref',credit_line->>'project_ref','cost_code_ref',credit_line->>'cost_code_ref'));
  IF amount<>source_row.amount OR debit_account=credit_account OR debit_account='610000' AND credit_account='291001' THEN
    RAISE EXCEPTION 'WBS H1 Payable proposal produces no valid mapping adjustment' USING ERRCODE='22023';
  END IF;

  draft_lines:=jsonb_build_array(
    jsonb_build_object('line_no',1,'account_code',debit_account,'debit_amount',amount,'credit_amount',0,'member_ref',debit_member,'description','Apply approved WBS Payable debit mapping','dimensions',debit_dimensions),
    jsonb_build_object('line_no',2,'account_code','610000','debit_amount',0,'credit_amount',amount,'member_ref',original_debit.member_ref,'description','Reverse controlled-import placeholder expense','dimensions',original_debit.dimensions)
  );
  IF credit_account<>'291001' OR credit_member IS DISTINCT FROM original_credit.member_ref OR credit_dimensions IS DISTINCT FROM original_credit.dimensions THEN
    draft_lines:=draft_lines||jsonb_build_array(
      jsonb_build_object('line_no',3,'account_code','291001','debit_amount',amount,'credit_amount',0,'member_ref',original_credit.member_ref,'description','Reverse controlled-import payable mapping','dimensions',original_credit.dimensions),
      jsonb_build_object('line_no',4,'account_code',credit_account,'debit_amount',0,'credit_amount',amount,'member_ref',credit_member,'description','Apply approved WBS Payable credit mapping','dimensions',credit_dimensions)
    );
  END IF;

  child_key:='wbs-h1-map:'||substr(p_request_hash,8,48);
  inner_hash:=refs_create_manual_journal_hash(p_tenant,p_entity,p_period,'WBS-MAP-'||upper(substr(p_source_record_hash,8,16)),source_row.accounting_date,
    (page_doc->>'currency')::char(3),'Apply approved WBS Payable Settings',draft_lines,ARRAY[trace.attachment_id]);
  inner_result:=refs_create_manual_journal(p_tenant,p_entity,p_period,'WBS-MAP-'||upper(substr(p_source_record_hash,8,16)),source_row.accounting_date,
    (page_doc->>'currency')::char(3),'Apply approved WBS Payable Settings',draft_lines,ARRAY[trace.attachment_id],child_key,inner_hash);
  journal_id:=(inner_result->>'journal_entry_id')::uuid;
  INSERT INTO source_link(tenant_id,entity_id,link_type,source_document_id,journal_entry_id,created_by)
    VALUES(p_tenant,p_entity,'SOURCE_TO_JE',trace.source_document_id,journal_id,actor);
  INSERT INTO wbs_h1_payable_reclass_draft_evidence(wbs_h1_payable_reclass_draft_evidence_id,tenant_id,entity_id,period_id,
    source_record_hash,proposal_hash,settings_decision_hash,source_document_id,source_document_line_id,attachment_id,
    original_journal_entry_id,journal_entry_id,request_hash,created_by)
  VALUES(evidence_id,p_tenant,p_entity,p_period,p_source_record_hash,p_proposal_hash,page_doc->>'settings_decision_hash',trace.source_document_id,
    trace.source_document_line_id,trace.attachment_id,original.journal_entry_id,journal_id,p_request_hash,actor);
  event_payload:=jsonb_build_object('schema_version','WBS_H1_PAYABLE_RECLASS_DRAFT_V1','draft_evidence_id',evidence_id,
    'source_record_hash',p_source_record_hash,'proposal_hash',p_proposal_hash,'settings_decision_hash',page_doc->>'settings_decision_hash',
    'source_document_id',trace.source_document_id,'original_journal_entry_id',original.journal_entry_id,'journal_entry_id',journal_id,
    'status','DRAFT','can_submit',false,'can_review',false,'can_approve',false,'can_post',false);
  INSERT INTO audit_event(tenant_id,entity_id,event_type,object_type,object_id,action,actor_id,actor_type,permission_used,request_id,correlation_id,idempotency_key,after_hash,reason,metadata)
    VALUES(p_tenant,p_entity,'WBS_H1_PAYABLE_RECLASS_DRAFT_CREATED','JOURNAL_ENTRY',journal_id,'CREATE_WBS_H1_PAYABLE_RECLASS_DRAFT',actor,'USER',
      'WBS.H1.PAYABLE.DRAFT',p_idempotency_key,p_idempotency_key,p_idempotency_key,p_request_hash,btrim(p_reason),event_payload);
  INSERT INTO outbox_event(tenant_id,entity_id,aggregate_type,aggregate_id,event_type,payload,payload_hash)
    VALUES(p_tenant,p_entity,'WBS_H1_PAYABLE_RECLASS',evidence_id,'WBS_H1_PAYABLE_RECLASS_DRAFT_CREATED',event_payload,refs_jsonb_hash(event_payload));
  response:=event_payload||jsonb_build_object('idempotent',false);
  UPDATE idempotency_receipt SET status='SUCCEEDED',response_status=201,response_body=response,completed_at=clock_timestamp()
    WHERE idempotency_receipt_id=receipt.idempotency_receipt_id;
  RETURN response;
END $$;

REVOKE ALL ON wbs_h1_payable_reclass_draft_evidence FROM PUBLIC,refs_app;
GRANT SELECT ON wbs_h1_payable_reclass_draft_evidence TO refs_app;
REVOKE ALL ON FUNCTION refs_create_wbs_h1_payable_reclass_draft_hash(uuid,uuid,uuid,text,text,text),
  refs_create_wbs_h1_payable_reclass_draft(uuid,uuid,uuid,text,text,text,text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION refs_create_wbs_h1_payable_reclass_draft_hash(uuid,uuid,uuid,text,text,text),
  refs_create_wbs_h1_payable_reclass_draft(uuid,uuid,uuid,text,text,text,text,text) TO refs_app;

COMMIT;
