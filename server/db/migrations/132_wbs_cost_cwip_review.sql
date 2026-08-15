BEGIN;

INSERT INTO permission_catalog(permission_code,domain,risk_class,sod_class)
  VALUES('WBS.COST.CWIP.REVIEW','WBS','HIGH','WBS_COST_CWIP_REVIEWER')
  ON CONFLICT (permission_code) DO NOTHING;

CREATE TABLE wbs_cost_cwip_review_evidence (
  wbs_cost_cwip_review_evidence_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant(tenant_id), entity_id uuid NOT NULL,
  wbs_inbound_row_id uuid NOT NULL, receipt_id uuid NOT NULL,
  wbs_snapshot_import_id uuid NOT NULL, wbs_snapshot_receipt_id uuid NOT NULL,
  raw_event_id uuid NOT NULL, source_document_id uuid NOT NULL,
  rule_evaluation_id uuid NOT NULL, staging_item_id uuid NOT NULL,
  setting_snapshot_id uuid NOT NULL, mapping_snapshot_id uuid NOT NULL, period_id uuid NOT NULL,
  source_version text NOT NULL, receipt_hash text NOT NULL CHECK(receipt_hash ~ '^sha256:[0-9a-f]{64}$'),
  evidence_hash text NOT NULL CHECK(evidence_hash ~ '^sha256:[0-9a-f]{64}$'),
  review_reason text NOT NULL CHECK(length(btrim(review_reason)) BETWEEN 8 AND 2000),
  reviewed_by text NOT NULL, reviewed_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  request_hash text NOT NULL CHECK(request_hash ~ '^sha256:[0-9a-f]{64}$'), created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE(tenant_id,entity_id,wbs_inbound_row_id), UNIQUE(tenant_id,entity_id,staging_item_id),
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
ALTER TABLE wbs_cost_cwip_review_evidence ENABLE ROW LEVEL SECURITY;
CREATE POLICY wbs_cost_cwip_review_evidence_scope ON wbs_cost_cwip_review_evidence
  USING(tenant_id=refs_current_tenant() AND refs_entity_allowed(entity_id))
  WITH CHECK(tenant_id=refs_current_tenant() AND refs_entity_allowed(entity_id));
CREATE TRIGGER wbs_cost_cwip_review_evidence_append_only BEFORE UPDATE OR DELETE ON wbs_cost_cwip_review_evidence
  FOR EACH ROW EXECUTE FUNCTION reject_mutation();

CREATE FUNCTION refs_wbs_cost_cwip_review_evidence_hash(p_row uuid,p_source_record_id text,p_source_version text,p_receipt_hash text,p_raw jsonb,p_normalized jsonb,p_outcome jsonb,p_outcome_kind text) RETURNS text
LANGUAGE sql IMMUTABLE SET search_path=pg_catalog,public,pg_temp AS $$
  SELECT refs_jsonb_hash(jsonb_build_object('wbs_inbound_row_id',p_row,'source_record_id',p_source_record_id,'source_version',p_source_version,'receipt_hash',p_receipt_hash,'raw',p_raw,'normalized',p_normalized,'outcome',p_outcome,'outcome_kind',p_outcome_kind))
$$;

CREATE FUNCTION refs_review_wbs_cost_cwip_hash(p_tenant uuid,p_entity uuid,p_row uuid,p_period uuid,p_expected_source_version text,p_expected_receipt_hash text,p_expected_evidence_hash text,p_setting uuid,p_mapping uuid,p_reason text) RETURNS text
LANGUAGE sql IMMUTABLE SET search_path=pg_catalog,public,pg_temp AS $$
  SELECT refs_jsonb_hash(jsonb_build_object('tenant_id',p_tenant,'entity_id',p_entity,'wbs_inbound_row_id',p_row,'period_id',p_period,'expected_source_version',p_expected_source_version,'expected_receipt_hash',p_expected_receipt_hash,'expected_evidence_hash',p_expected_evidence_hash,'setting_snapshot_id',p_setting,'mapping_snapshot_id',p_mapping,'reason',btrim(p_reason)))
$$;

CREATE FUNCTION refs_review_wbs_cost_cwip(
  p_tenant uuid,p_entity uuid,p_row uuid,p_period uuid,p_expected_source_version text,p_expected_receipt_hash text,p_expected_evidence_hash text,p_setting uuid,p_mapping uuid,p_reason text,p_idempotency_key text,p_request_hash text
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE actor text:=refs_current_actor(); idem idempotency_receipt; row_record wbs_inbound_row; inbound_receipt wbs_inbound_receipt;
  snapshot_import wbs_snapshot_import; snapshot_receipt wbs_snapshot_receipt; setting_row setting_snapshot; mapping_row mapping_snapshot;
  normalized jsonb; evidence_hash text; computed_hash text; company_key text; currency text; accounting_date date; business_date date; source_amount numeric(20,4);
  mapping_input jsonb; cwip_account text; offset_account text; rule_code text; rule_version bigint; raw_id uuid:=gen_random_uuid(); document_id uuid:=gen_random_uuid(); rule_id uuid:=gen_random_uuid(); staging_id uuid:=gen_random_uuid(); review_id uuid:=gen_random_uuid();
  matched_facts jsonb; rule_result jsonb; input_digest text; evaluation_digest text; response jsonb; event_payload jsonb;
BEGIN
  PERFORM refs_assert_scope(p_tenant,p_entity,'WBS.COST.CWIP.REVIEW');
  IF actor IS NULL THEN RAISE EXCEPTION 'Authenticated actor missing' USING ERRCODE='42501'; END IF;
  computed_hash:=refs_review_wbs_cost_cwip_hash(p_tenant,p_entity,p_row,p_period,p_expected_source_version,p_expected_receipt_hash,p_expected_evidence_hash,p_setting,p_mapping,p_reason);
  IF p_request_hash<>computed_hash OR p_expected_receipt_hash !~ '^sha256:[0-9a-f]{64}$' OR p_expected_evidence_hash !~ '^sha256:[0-9a-f]{64}$' OR length(btrim(coalesce(p_expected_source_version,'')))=0 OR length(btrim(coalesce(p_reason,''))) NOT BETWEEN 8 AND 2000 THEN RAISE EXCEPTION 'Cost-to-CWIP review request is invalid' USING ERRCODE='22023'; END IF;
  INSERT INTO idempotency_receipt(tenant_id,operation_scope,idempotency_key,request_hash,status,actor_id) VALUES(p_tenant,'WBS_COST_CWIP_REVIEW:'||p_entity,p_idempotency_key,p_request_hash,'IN_PROGRESS',actor) ON CONFLICT DO NOTHING;
  SELECT * INTO idem FROM idempotency_receipt WHERE tenant_id=p_tenant AND operation_scope='WBS_COST_CWIP_REVIEW:'||p_entity AND idempotency_key=p_idempotency_key FOR UPDATE;
  IF idem.request_hash<>p_request_hash THEN RAISE EXCEPTION 'Idempotency key reused with different request hash' USING ERRCODE='23505'; END IF;
  IF idem.status='SUCCEEDED' THEN RETURN idem.response_body||jsonb_build_object('idempotent',true); END IF;
  SELECT * INTO row_record FROM wbs_inbound_row WHERE tenant_id=p_tenant AND entity_id=p_entity AND wbs_inbound_row_id=p_row FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Cost-to-CWIP row not found' USING ERRCODE='P0002'; END IF;
  SELECT * INTO inbound_receipt FROM wbs_inbound_receipt WHERE tenant_id=p_tenant AND entity_id=p_entity AND receipt_id=row_record.receipt_id FOR SHARE;
  SELECT * INTO snapshot_import FROM wbs_snapshot_import WHERE tenant_id=p_tenant AND entity_id=p_entity AND import_batch_id=inbound_receipt.import_batch_id AND environment='PRODUCTION' FOR SHARE;
  IF NOT FOUND OR NOT EXISTS(SELECT 1 FROM wbs_snapshot_delivery_attestation d WHERE d.tenant_id=p_tenant AND d.entity_id=p_entity AND d.wbs_snapshot_import_id=snapshot_import.wbs_snapshot_import_id) THEN RAISE EXCEPTION 'Cost-to-CWIP review requires an admitted production snapshot' USING ERRCODE='23514'; END IF;
  SELECT * INTO snapshot_receipt FROM wbs_snapshot_receipt WHERE tenant_id=p_tenant AND entity_id=p_entity AND wbs_snapshot_import_id=snapshot_import.wbs_snapshot_import_id AND source_module='BGDATA.cost_general_ledger' AND ingestion_kind='TRANSACTION_CANDIDATE' AND source_record_id=row_record.source_record_id AND source_version=row_record.source_version AND payload_hash=inbound_receipt.receipt_hash AND payload_ref=inbound_receipt.payload_ref FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Cost-to-CWIP row is not backed by the exact signed snapshot receipt' USING ERRCODE='23514'; END IF;
  evidence_hash:=refs_wbs_cost_cwip_review_evidence_hash(row_record.wbs_inbound_row_id,row_record.source_record_id,row_record.source_version,inbound_receipt.receipt_hash,row_record.raw,row_record.normalized,row_record.outcome,row_record.outcome_kind);
  normalized:=row_record.normalized;
  IF row_record.source_version<>p_expected_source_version OR inbound_receipt.receipt_hash<>p_expected_receipt_hash OR evidence_hash<>p_expected_evidence_hash OR row_record.outcome_kind<>'STAGING' OR row_record.outcome->>'stage' IS DISTINCT FROM 'STAGING_REVIEW_REQUIRED' OR normalized->>'source_type' IS DISTINCT FROM 'COST_CWIP' OR normalized->>'source_system' IS DISTINCT FROM 'WBS' THEN RAISE EXCEPTION 'Only exact immutable Cost-to-CWIP staging evidence may be reviewed' USING ERRCODE='40001'; END IF;
  company_key:=btrim(normalized->>'company_key'); currency:=upper(btrim(normalized->>'currency')); accounting_date:=(normalized->>'accounting_date')::date; business_date:=(normalized->>'business_date')::date; source_amount:=(normalized->>'amount_money4')::numeric(20,4);
  IF company_key='' OR currency !~ '^[A-Z]{3}$' OR source_amount<=0 OR NOT EXISTS(SELECT 1 FROM entity e WHERE e.tenant_id=p_tenant AND e.entity_id=p_entity AND e.active AND e.source_system='WBS' AND e.source_entity_id=company_key AND e.base_currency=currency) OR NOT EXISTS(SELECT 1 FROM accounting_period p WHERE p.tenant_id=p_tenant AND p.entity_id=p_entity AND p.period_id=p_period AND p.status='OPEN' AND accounting_date BETWEEN p.starts_on AND p.ends_on) THEN RAISE EXCEPTION 'Cost-to-CWIP scope or accounting date is invalid' USING ERRCODE='23514'; END IF;
  SELECT * INTO setting_row FROM setting_snapshot WHERE tenant_id=p_tenant AND entity_id=p_entity AND setting_snapshot_id=p_setting AND family='WBS_COST_CWIP_REVIEW' AND scope_type='ENTITY' AND scope_key=p_entity::text AND status='APPROVED' AND snapshot_hash=refs_jsonb_hash(snapshot) FOR SHARE;
  mapping_input:=jsonb_build_object('company_key',company_key,'currency',currency,'project_ref',normalized->>'project_ref','cost_code_ref',normalized->>'cost_code_ref');
  SELECT * INTO mapping_row FROM mapping_snapshot WHERE tenant_id=p_tenant AND entity_id=p_entity AND mapping_snapshot_id=p_mapping AND family='WBS_COST_CWIP' AND scope_type='ENTITY' AND scope_key=p_entity::text AND status='APPROVED' AND input_keys=mapping_input AND input_key_hash=refs_jsonb_hash(mapping_input) AND snapshot_hash=refs_jsonb_hash(jsonb_build_object('input_keys',input_keys,'output_rules',output_rules)) FOR SHARE;
  IF NOT FOUND OR setting_row.setting_snapshot_id IS NULL OR actor IN (snapshot_import.created_by,setting_row.created_by,setting_row.approved_by,mapping_row.created_by,mapping_row.approved_by) THEN RAISE EXCEPTION 'Cost-to-CWIP mapping, setting, or separation of duties is invalid' USING ERRCODE='42501'; END IF;
  cwip_account:=btrim(mapping_row.output_rules->>'cwip_account_code'); offset_account:=btrim(mapping_row.output_rules->>'offset_account_code'); rule_code:=btrim(mapping_row.output_rules->>'rule_code'); rule_version:=(mapping_row.output_rules->>'rule_version')::bigint;
  IF cwip_account='' OR offset_account='' OR rule_code='' OR rule_version<1 OR NOT EXISTS(SELECT 1 FROM account_master WHERE tenant_id=p_tenant AND entity_id=p_entity AND account_code IN (cwip_account,offset_account) AND active GROUP BY tenant_id HAVING count(*)=2) THEN RAISE EXCEPTION 'Approved Cost-to-CWIP mapping output is incomplete' USING ERRCODE='23514'; END IF;
  INSERT INTO raw_event(raw_event_id,tenant_id,entity_id,import_batch_id,source_system,source_module,source_entity_id,source_record_id,source_version,event_type,occurred_at,payload_hash,payload_ref,correlation_id) VALUES(raw_id,p_tenant,p_entity,snapshot_import.import_batch_id,'WBS','cost_general_ledger',snapshot_receipt.source_entity_id,row_record.source_record_id,row_record.source_version,'UPSERT',accounting_date::timestamptz,inbound_receipt.receipt_hash,inbound_receipt.payload_ref,p_idempotency_key);
  INSERT INTO source_document(source_document_id,tenant_id,entity_id,raw_event_id,source_system,source_module,source_entity_id,source_record_id,source_version,document_type,document_no,business_date,accounting_date,currency,gross_amount,status,source_ref,payload_hash) VALUES(document_id,p_tenant,p_entity,raw_id,'WBS','cost_general_ledger',snapshot_receipt.source_entity_id,row_record.source_record_id,row_record.source_version,'WBS_COST_CWIP',row_record.source_record_id,business_date,accounting_date,currency,source_amount,'READY_FOR_DRAFT',inbound_receipt.payload_ref,inbound_receipt.receipt_hash);
  matched_facts:=jsonb_build_object('wbs_inbound_row_id',p_row,'company_key',company_key,'currency',currency,'project_ref',normalized->>'project_ref','cost_code_ref',normalized->>'cost_code_ref','source_amount',normalized->>'amount_money4','source_version',row_record.source_version,'receipt_hash',inbound_receipt.receipt_hash);
  rule_result:=jsonb_build_object('cwip_account_code',cwip_account,'offset_account_code',offset_account,'gross_amount',to_char(source_amount,'FM9999999999999990.0000'),'currency',currency,'period_id',p_period,'can_create_draft',false,'can_approve',false,'can_post',false);
  input_digest:=evidence_hash; evaluation_digest:=refs_rule_evaluation_hash(document_id,p_setting,p_mapping,rule_code,rule_version,matched_facts,rule_result,input_digest);
  INSERT INTO rule_evaluation(rule_evaluation_id,tenant_id,source_document_id,setting_snapshot_id,mapping_snapshot_id,rule_code,rule_version,matched_facts,result,confidence,reason,input_digest,evaluation_digest,evaluated_at) VALUES(rule_id,p_tenant,document_id,p_setting,p_mapping,rule_code,rule_version,matched_facts,rule_result,1,btrim(p_reason),input_digest,evaluation_digest,clock_timestamp());
  INSERT INTO staging_item(staging_item_id,tenant_id,entity_id,source_document_id,setting_snapshot_id,mapping_snapshot_id,rule_evaluation_id,status,version,reviewed_by,reviewed_at) VALUES(staging_id,p_tenant,p_entity,document_id,p_setting,p_mapping,rule_id,'READY_FOR_DRAFT',0,actor,clock_timestamp());
  INSERT INTO source_link(tenant_id,entity_id,link_type,raw_event_id,source_document_id,staging_item_id,created_by) VALUES(p_tenant,p_entity,'WBS_COST_CWIP_REVIEW',raw_id,document_id,staging_id,actor);
  INSERT INTO wbs_cost_cwip_review_evidence(wbs_cost_cwip_review_evidence_id,tenant_id,entity_id,wbs_inbound_row_id,receipt_id,wbs_snapshot_import_id,wbs_snapshot_receipt_id,raw_event_id,source_document_id,rule_evaluation_id,staging_item_id,setting_snapshot_id,mapping_snapshot_id,period_id,source_version,receipt_hash,evidence_hash,review_reason,reviewed_by,request_hash) VALUES(review_id,p_tenant,p_entity,p_row,inbound_receipt.receipt_id,snapshot_import.wbs_snapshot_import_id,snapshot_receipt.wbs_snapshot_receipt_id,raw_id,document_id,rule_id,staging_id,p_setting,p_mapping,p_period,row_record.source_version,inbound_receipt.receipt_hash,evidence_hash,btrim(p_reason),actor,p_request_hash);
  event_payload:=jsonb_build_object('wbs_cost_cwip_review_evidence_id',review_id,'wbs_inbound_row_id',p_row,'source_document_id',document_id,'staging_item_id',staging_id,'setting_snapshot_id',p_setting,'mapping_snapshot_id',p_mapping,'period_id',p_period,'status','READY_FOR_DRAFT');
  INSERT INTO audit_event(tenant_id,entity_id,event_type,object_type,object_id,action,actor_id,actor_type,permission_used,request_id,correlation_id,idempotency_key,after_hash,reason,metadata) VALUES(p_tenant,p_entity,'WBS_COST_CWIP_REVIEWED','WBS_COST_CWIP_REVIEW',review_id,'REVIEW',actor,'USER','WBS.COST.CWIP.REVIEW',p_idempotency_key,p_idempotency_key,p_idempotency_key,p_request_hash,btrim(p_reason),event_payload);
  INSERT INTO outbox_event(tenant_id,entity_id,aggregate_type,aggregate_id,event_type,payload,payload_hash) VALUES(p_tenant,p_entity,'WBS_COST_CWIP_REVIEW',review_id,'WBS_COST_CWIP_REVIEWED',event_payload,refs_jsonb_hash(event_payload));
  response:=jsonb_build_object('wbs_cost_cwip_review_evidence_id',review_id,'wbs_inbound_row_id',p_row,'source_document_id',document_id,'staging_item_id',staging_id,'status','READY_FOR_DRAFT','revision',0,'idempotent',false,'can_create_draft',false,'can_approve',false,'can_post',false);
  UPDATE idempotency_receipt SET status='SUCCEEDED',response_status=201,response_body=response,completed_at=clock_timestamp() WHERE idempotency_receipt_id=idem.idempotency_receipt_id;
  RETURN response;
END $$;

REVOKE ALL ON wbs_cost_cwip_review_evidence FROM PUBLIC,refs_app;
GRANT SELECT ON wbs_cost_cwip_review_evidence TO refs_app;
REVOKE EXECUTE ON FUNCTION refs_wbs_cost_cwip_review_evidence_hash(uuid,text,text,text,jsonb,jsonb,jsonb,text),refs_review_wbs_cost_cwip_hash(uuid,uuid,uuid,uuid,text,text,text,uuid,uuid,text),refs_review_wbs_cost_cwip(uuid,uuid,uuid,uuid,text,text,text,uuid,uuid,text,text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION refs_wbs_cost_cwip_review_evidence_hash(uuid,text,text,text,jsonb,jsonb,jsonb,text),refs_review_wbs_cost_cwip_hash(uuid,uuid,uuid,uuid,text,text,text,uuid,uuid,text),refs_review_wbs_cost_cwip(uuid,uuid,uuid,uuid,text,text,text,uuid,uuid,text,text,text) TO refs_app;
COMMIT;
