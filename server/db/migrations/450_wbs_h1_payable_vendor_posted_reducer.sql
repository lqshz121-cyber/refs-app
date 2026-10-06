BEGIN;

ALTER TABLE wbs_h1_payable_reclass_draft_evidence ADD COLUMN bound_lines_hash text
  CHECK(bound_lines_hash~'^sha256:[0-9a-f]{64}$');
ALTER TABLE wbs_h1_payable_reclass_draft_evidence ADD CONSTRAINT wbs_h1_payable_reclass_draft_scope_id_uq
  UNIQUE(tenant_id,entity_id,wbs_h1_payable_reclass_draft_evidence_id);

CREATE FUNCTION refs_wbs_h1_reclass_lines_hash(p_tenant uuid,p_entity uuid,p_journal uuid,p_reverse boolean DEFAULT false)
RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
  SELECT refs_jsonb_hash(coalesce(jsonb_agg(jsonb_build_object('line_no',line_no,'account_code',account_code,
    'debit_amount',CASE WHEN p_reverse THEN credit_amount ELSE debit_amount END,
    'credit_amount',CASE WHEN p_reverse THEN debit_amount ELSE credit_amount END,
    'member_ref',member_ref,'dimensions',dimensions) ORDER BY line_no),'[]'::jsonb))
  FROM journal_line WHERE tenant_id=p_tenant AND entity_id=p_entity AND journal_entry_id=p_journal
$$;
REVOKE ALL ON FUNCTION refs_wbs_h1_reclass_lines_hash(uuid,uuid,uuid,boolean) FROM PUBLIC,refs_app;

DO $migration$
DECLARE definition text;
DECLARE anchor constant text:=$old$original_journal_entry_id,journal_entry_id,request_hash,created_by,baseline_vendor_member_ref,target_vendor_member_ref)$old$;
DECLARE value_anchor constant text:=$old$trace.source_document_line_id,trace.attachment_id,original.journal_entry_id,journal_id,p_request_hash,actor,'WBS_TEST_VENDOR',credit_member);$old$;
BEGIN
  SELECT pg_get_functiondef('public.refs_create_wbs_h1_payable_reclass_draft(uuid,uuid,uuid,text,text,text,text,text)'::regprocedure) INTO definition;
  IF position(anchor IN definition)=0 OR position(value_anchor IN definition)=0 THEN
    RAISE EXCEPTION 'Migration 450 requires the guarded WBS reclass Draft command' USING ERRCODE='55000';
  END IF;
  definition:=replace(definition,anchor,'original_journal_entry_id,journal_entry_id,request_hash,created_by,baseline_vendor_member_ref,target_vendor_member_ref,bound_lines_hash)');
  definition:=replace(definition,value_anchor,
    'trace.source_document_line_id,trace.attachment_id,original.journal_entry_id,journal_id,p_request_hash,actor,''WBS_TEST_VENDOR'',credit_member,refs_wbs_h1_reclass_lines_hash(p_tenant,p_entity,journal_id));');
  EXECUTE definition;
END
$migration$;

CREATE TABLE wbs_h1_payable_vendor_posted_evidence (
  wbs_h1_payable_vendor_posted_evidence_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,entity_id uuid NOT NULL,period_id uuid NOT NULL,
  draft_evidence_id uuid NOT NULL,
  business_document_id uuid NOT NULL,journal_entry_id uuid NOT NULL,
  reverses_evidence_id uuid,
  from_member_ref text NOT NULL,to_member_ref text NOT NULL CHECK(from_member_ref<>to_member_ref),
  amount numeric(20,4) NOT NULL CHECK(amount>0),currency char(3) NOT NULL,
  business_version_before bigint NOT NULL,business_version_after bigint NOT NULL CHECK(business_version_after=business_version_before+1),
  bound_lines_hash text NOT NULL CHECK(bound_lines_hash~'^sha256:[0-9a-f]{64}$'),
  posted_by text NOT NULL,posted_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE(tenant_id,entity_id,journal_entry_id),
  UNIQUE(tenant_id,entity_id,wbs_h1_payable_vendor_posted_evidence_id),
  FOREIGN KEY(tenant_id,entity_id,draft_evidence_id) REFERENCES wbs_h1_payable_reclass_draft_evidence(tenant_id,entity_id,wbs_h1_payable_reclass_draft_evidence_id),
  FOREIGN KEY(tenant_id,entity_id,reverses_evidence_id) REFERENCES wbs_h1_payable_vendor_posted_evidence(tenant_id,entity_id,wbs_h1_payable_vendor_posted_evidence_id),
  FOREIGN KEY(tenant_id,entity_id,period_id) REFERENCES accounting_period(tenant_id,entity_id,period_id),
  FOREIGN KEY(tenant_id,entity_id,business_document_id) REFERENCES business_document(tenant_id,entity_id,business_document_id),
  FOREIGN KEY(tenant_id,entity_id,journal_entry_id) REFERENCES journal_entry(tenant_id,entity_id,journal_entry_id)
);
ALTER TABLE wbs_h1_payable_vendor_posted_evidence ENABLE ROW LEVEL SECURITY;
CREATE POLICY wbs_h1_payable_vendor_posted_scope ON wbs_h1_payable_vendor_posted_evidence
  USING(tenant_id=refs_current_tenant() AND refs_entity_allowed(entity_id))
  WITH CHECK(tenant_id=refs_current_tenant() AND refs_entity_allowed(entity_id));
CREATE TRIGGER wbs_h1_payable_vendor_posted_append_only BEFORE UPDATE OR DELETE ON wbs_h1_payable_vendor_posted_evidence
  FOR EACH ROW EXECUTE FUNCTION reject_mutation();
REVOKE ALL ON wbs_h1_payable_vendor_posted_evidence FROM PUBLIC,refs_app;
GRANT SELECT ON wbs_h1_payable_vendor_posted_evidence TO refs_app;

CREATE FUNCTION refs_apply_wbs_h1_payable_vendor_posted() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE evidence wbs_h1_payable_reclass_draft_evidence;prior wbs_h1_payable_vendor_posted_evidence;
DECLARE bill business_document;target_member member_master;reversed_journal uuid;
DECLARE source_member text;target_ref text;expected_lines_hash text;proof_id uuid:=gen_random_uuid();payload jsonb;event_name text;
BEGIN
  IF TG_OP<>'UPDATE' OR NEW.status<>'POSTED' OR OLD.status='POSTED' THEN RETURN NEW; END IF;
  SELECT * INTO evidence FROM wbs_h1_payable_reclass_draft_evidence
    WHERE tenant_id=NEW.tenant_id AND entity_id=NEW.entity_id AND journal_entry_id=NEW.journal_entry_id FOR SHARE;
  IF FOUND THEN
    source_member:=evidence.baseline_vendor_member_ref;target_ref:=evidence.target_vendor_member_ref;
    expected_lines_hash:=evidence.bound_lines_hash;
    SELECT * INTO STRICT bill FROM business_document
      WHERE tenant_id=NEW.tenant_id AND entity_id=NEW.entity_id AND document_kind='AP_BILL'
        AND source_document_id=evidence.source_document_id AND posted_journal_entry_id=evidence.original_journal_entry_id FOR UPDATE;
    IF NEW.period_id<>evidence.period_id THEN RAISE EXCEPTION 'WBS vendor reclass period changed' USING ERRCODE='40001'; END IF;
  ELSE
    -- No owning WBS vendor-transfer reversal command exists yet. Generic
    -- reversal/reclass must not move the ledger without the AP Bill reducer.
    IF EXISTS(SELECT 1 FROM wbs_h1_payable_vendor_posted_evidence
      WHERE tenant_id=NEW.tenant_id AND entity_id=NEW.entity_id
        AND journal_entry_id IN(NEW.reversal_of_id,NEW.reclass_of_id)) THEN
      RAISE EXCEPTION 'WBS vendor transfer requires a dedicated owning adjustment workflow' USING ERRCODE='0A000';
    END IF;
    RETURN NEW;
  END IF;

  PERFORM refs_assert_scope(NEW.tenant_id,NEW.entity_id,'GL.JE.POST');
  IF refs_current_actor() IS DISTINCT FROM NEW.posted_by OR NEW.posted_by IS NULL THEN
    RAISE EXCEPTION 'WBS vendor reducer requires the authenticated Post actor' USING ERRCODE='42501';
  END IF;
  IF expected_lines_hash IS NULL OR expected_lines_hash<>refs_wbs_h1_reclass_lines_hash(NEW.tenant_id,NEW.entity_id,NEW.journal_entry_id)
     OR (SELECT count(*) FROM journal_line WHERE tenant_id=NEW.tenant_id AND entity_id=NEW.entity_id AND journal_entry_id=NEW.journal_entry_id)<>4
     OR bill.currency<>NEW.currency OR bill.counterparty_ref IS DISTINCT FROM source_member
     OR bill.status<>'OPEN' OR bill.open_balance<>bill.gross_amount OR bill.posted_credit_adjustments<>0 OR bill.posted_debit_adjustments<>0 THEN
    RAISE EXCEPTION 'WBS vendor reclass requires exact unchanged lines and a fully-open source Bill' USING ERRCODE='40001';
  END IF;
  IF (SELECT count(*) FROM journal_line WHERE tenant_id=NEW.tenant_id AND entity_id=NEW.entity_id AND journal_entry_id=NEW.journal_entry_id
    AND member_ref IN (source_member,target_ref) AND account_code='291001')<>2 THEN
    RAISE EXCEPTION 'WBS vendor reclass must preserve the native AP control account' USING ERRCODE='23514';
  END IF;
  IF NOT EXISTS(SELECT 1 FROM journal_line WHERE tenant_id=NEW.tenant_id AND entity_id=NEW.entity_id AND journal_entry_id=NEW.journal_entry_id
    AND account_code='291001' AND member_ref=source_member AND debit_amount=bill.gross_amount AND credit_amount=0)
    OR NOT EXISTS(SELECT 1 FROM journal_line WHERE tenant_id=NEW.tenant_id AND entity_id=NEW.entity_id AND journal_entry_id=NEW.journal_entry_id
    AND account_code='291001' AND member_ref=target_ref AND credit_amount=bill.gross_amount AND debit_amount=0) THEN
    RAISE EXCEPTION 'WBS vendor reclass amount no longer matches the AP Bill' USING ERRCODE='40001';
  END IF;
  IF EXISTS(SELECT 1 FROM business_allocation WHERE tenant_id=NEW.tenant_id AND entity_id=NEW.entity_id
    AND business_document_id=bill.business_document_id AND status IN ('PENDING','ACTIVE') FOR UPDATE) THEN
    RAISE EXCEPTION 'WBS vendor reclass is blocked by pending or active allocations' USING ERRCODE='23514';
  END IF;
  SELECT * INTO target_member FROM member_master WHERE tenant_id=NEW.tenant_id AND entity_id=NEW.entity_id
    AND member_ref=target_ref AND member_type='VENDOR' AND active FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'WBS vendor reclass target member is unavailable' USING ERRCODE='23503'; END IF;

  UPDATE business_document SET counterparty_ref=target_ref,counterparty_name=target_member.display_name,
    version=version+1,updated_at=clock_timestamp()
    WHERE tenant_id=NEW.tenant_id AND entity_id=NEW.entity_id AND business_document_id=bill.business_document_id AND version=bill.version;
  IF NOT FOUND THEN RAISE EXCEPTION 'WBS vendor reclass Bill version changed' USING ERRCODE='40001'; END IF;
  INSERT INTO wbs_h1_payable_vendor_posted_evidence(wbs_h1_payable_vendor_posted_evidence_id,tenant_id,entity_id,period_id,
    draft_evidence_id,business_document_id,journal_entry_id,reverses_evidence_id,from_member_ref,to_member_ref,amount,currency,
    business_version_before,business_version_after,bound_lines_hash,posted_by)
  VALUES(proof_id,NEW.tenant_id,NEW.entity_id,NEW.period_id,evidence.wbs_h1_payable_reclass_draft_evidence_id,
    bill.business_document_id,NEW.journal_entry_id,prior.wbs_h1_payable_vendor_posted_evidence_id,source_member,target_ref,bill.gross_amount,
    bill.currency,bill.version,bill.version+1,expected_lines_hash,NEW.posted_by);
  event_name:=CASE WHEN prior.wbs_h1_payable_vendor_posted_evidence_id IS NULL THEN 'WBS_H1_PAYABLE_VENDOR_RECLASS_POSTED' ELSE 'WBS_H1_PAYABLE_VENDOR_RECLASS_REVERSED' END;
  payload:=jsonb_build_object('schema_version','WBS_H1_PAYABLE_VENDOR_POSTED_V1','posted_evidence_id',proof_id,
    'draft_evidence_id',evidence.wbs_h1_payable_reclass_draft_evidence_id,'business_document_id',bill.business_document_id,
    'journal_entry_id',NEW.journal_entry_id,'reverses_journal_entry_id',reversed_journal,'source_document_id',evidence.source_document_id,
    'from_member_ref',source_member,'to_member_ref',target_ref,'amount',bill.gross_amount,'currency',bill.currency,
    'business_version_before',bill.version,'business_version_after',bill.version+1,'bound_lines_hash',expected_lines_hash);
  INSERT INTO audit_event(tenant_id,entity_id,event_type,object_type,object_id,action,actor_id,actor_type,permission_used,
    request_id,correlation_id,idempotency_key,after_hash,reason,metadata)
  VALUES(NEW.tenant_id,NEW.entity_id,event_name,'BUSINESS_DOCUMENT',bill.business_document_id,'TRANSFER_WBS_PAYABLE_VENDOR',
    NEW.posted_by,'USER','GL.JE.POST',NEW.journal_entry_id::text,NEW.journal_entry_id::text,NEW.journal_entry_id::text,
    refs_jsonb_hash(payload),'Posted WBS mapping transfers exact fully-open AP Bill vendor together with ledger and immutable evidence',payload);
  INSERT INTO outbox_event(tenant_id,entity_id,aggregate_type,aggregate_id,event_type,payload,payload_hash)
  VALUES(NEW.tenant_id,NEW.entity_id,'WBS_H1_PAYABLE_VENDOR',proof_id,event_name,payload,refs_jsonb_hash(payload));
  RETURN NEW;
END
$$;
REVOKE ALL ON FUNCTION refs_apply_wbs_h1_payable_vendor_posted() FROM PUBLIC,refs_app;
CREATE TRIGGER wbs_h1_payable_vendor_posted_reducer AFTER UPDATE OF status ON journal_entry
  FOR EACH ROW EXECUTE FUNCTION refs_apply_wbs_h1_payable_vendor_posted();

COMMIT;
