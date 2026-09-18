BEGIN;

-- P08 / ADR-P08: the missing impairment posting path.
--
-- 242 lets an independent reviewer record a fixed_asset_impairment_assessment_
-- evidence row carrying the posted carrying value, the recoverable amount, the
-- derived impairment_loss and both account codes.  243 then reconciles that
-- assessment against POSTED ledger lines carrying
-- dimensions->>'impairment_assessment_evidence_id'.
--
-- Nothing in the repository could produce such a line: acquisition (341+),
-- depreciation (355) and disposal (334+) all have refs_create_fixed_asset_*
-- Draft commands, impairment had only the review and the reconciliation.  The
-- reconciliation therefore always reported the assessment as unposted, and the
-- only way to impair an asset was a hand-written manual journal that nothing
-- bound to the assessment.
--
-- This migration adds the one missing command.  The amount is taken from the
-- reviewed assessment, never from the request; the maker echoes the assessment
-- hash; the result is a MANUAL Draft journal, so Submit/Review/Approve/Post,
-- period control and SoD are unchanged.

INSERT INTO permission_catalog(permission_code,domain,risk_class,sod_class) VALUES
  ('FIXED_ASSET.IMPAIRMENT.DRAFT','FIXED_ASSET','HIGH','FIXED_ASSET_IMPAIRMENT_MAKER')
ON CONFLICT(permission_code) DO UPDATE SET active=true,version=permission_catalog.version+1,effective_to=NULL;
INSERT INTO runtime_human_permission_authority(permission_code,authority_class) VALUES
  ('FIXED_ASSET.IMPAIRMENT.DRAFT','DRAFT') ON CONFLICT(permission_code) DO NOTHING;

CREATE TABLE fixed_asset_impairment_draft_binding(
  fixed_asset_impairment_draft_binding_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant(tenant_id),
  entity_id uuid NOT NULL,
  fixed_asset_impairment_assessment_evidence_id uuid NOT NULL
    REFERENCES fixed_asset_impairment_assessment_evidence(fixed_asset_impairment_assessment_evidence_id),
  fixed_asset_register_evidence_id uuid NOT NULL,
  accounting_period_id uuid NOT NULL,
  journal_entry_id uuid NOT NULL,
  impairment_loss numeric(20,4) NOT NULL CHECK(impairment_loss>0),
  impairment_expense_account_code text NOT NULL,
  accumulated_impairment_account_code text NOT NULL,
  impairment_assessment_hash text NOT NULL CHECK(impairment_assessment_hash~'^sha256:[0-9a-f]{64}$'),
  created_by text NOT NULL,
  reason text NOT NULL CHECK(length(btrim(reason)) BETWEEN 8 AND 2000),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE(tenant_id,journal_entry_id),
  -- one Draft per reviewed assessment: an impairment cannot be booked twice
  UNIQUE(tenant_id,entity_id,fixed_asset_impairment_assessment_evidence_id)
);
CREATE INDEX fixed_asset_impairment_draft_binding_asset_idx
  ON fixed_asset_impairment_draft_binding(tenant_id,entity_id,fixed_asset_register_evidence_id);
CREATE TRIGGER fixed_asset_impairment_draft_binding_append_only
  BEFORE UPDATE OR DELETE ON fixed_asset_impairment_draft_binding FOR EACH ROW EXECUTE FUNCTION reject_mutation();

CREATE FUNCTION refs_create_fixed_asset_impairment_draft_hash(
  p_tenant uuid,p_entity uuid,p_assessment uuid,p_number text,p_date date,p_expected_assessment_hash text,p_reason text,p_attachments uuid[]
) RETURNS text LANGUAGE sql IMMUTABLE SET search_path=pg_catalog,public,pg_temp AS $$
  SELECT refs_jsonb_hash(jsonb_build_object('op','FIXED_ASSET_IMPAIRMENT_DRAFT','tenant_id',p_tenant,'entity_id',p_entity,
    'impairment_assessment_evidence_id',p_assessment,'journal_number',btrim(p_number),'journal_date',p_date,
    'expected_assessment_hash',p_expected_assessment_hash,'reason',btrim(p_reason),
    'attachment_ids',to_jsonb(ARRAY(SELECT id FROM unnest(p_attachments) id ORDER BY id))))
$$;

CREATE FUNCTION refs_create_fixed_asset_impairment_draft(
  p_tenant uuid,p_entity uuid,p_assessment uuid,p_number text,p_date date,p_expected_assessment_hash text,p_reason text,p_attachments uuid[],p_key text,p_hash text
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE actor text:=refs_current_actor(); idem idempotency_receipt; scope text:='FIXED_ASSET_IMPAIRMENT_DRAFT:'||p_entity;
  assessment fixed_asset_impairment_assessment_evidence; asset fixed_asset_register_evidence; period_row accounting_period;
  dims jsonb; lines jsonb; inner_hash text; journal jsonb; journal_id uuid; binding uuid:=gen_random_uuid(); payload jsonb; posted_already numeric(20,4);
BEGIN
  PERFORM refs_assert_scope(p_tenant,p_entity,'FIXED_ASSET.IMPAIRMENT.DRAFT');
  PERFORM refs_assert_scope(p_tenant,p_entity,'GL.JE.CREATE');
  IF actor IS NULL THEN RAISE EXCEPTION 'Authenticated impairment maker missing' USING ERRCODE='42501'; END IF;
  IF p_hash IS DISTINCT FROM refs_create_fixed_asset_impairment_draft_hash(p_tenant,p_entity,p_assessment,p_number,p_date,p_expected_assessment_hash,p_reason,p_attachments)
     OR p_expected_assessment_hash !~ '^sha256:[0-9a-f]{64}$' OR p_date IS NULL
     OR length(btrim(coalesce(p_number,''))) NOT BETWEEN 1 AND 100
     OR length(btrim(coalesce(p_reason,''))) NOT BETWEEN 8 AND 2000 OR length(coalesce(p_key,'')) NOT BETWEEN 8 AND 200
     OR COALESCE(cardinality(p_attachments),0)<1
  THEN RAISE EXCEPTION 'Invalid fixed asset impairment command' USING ERRCODE='22023'; END IF;

  INSERT INTO idempotency_receipt(tenant_id,operation_scope,idempotency_key,request_hash,status,actor_id)
  VALUES(p_tenant,scope,p_key,p_hash,'IN_PROGRESS',actor) ON CONFLICT(tenant_id,operation_scope,idempotency_key) DO NOTHING;
  SELECT * INTO idem FROM idempotency_receipt WHERE tenant_id=p_tenant AND operation_scope=scope AND idempotency_key=p_key FOR UPDATE;
  IF idem.actor_id IS DISTINCT FROM actor OR idem.request_hash IS DISTINCT FROM p_hash THEN RAISE EXCEPTION 'Fixed asset impairment idempotency conflict' USING ERRCODE='23505'; END IF;
  IF idem.status='SUCCEEDED' THEN RETURN idem.response_body||jsonb_build_object('idempotent',true); END IF;

  SELECT * INTO assessment FROM fixed_asset_impairment_assessment_evidence
    WHERE tenant_id=p_tenant AND entity_id=p_entity AND fixed_asset_impairment_assessment_evidence_id=p_assessment FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Scoped impairment assessment missing' USING ERRCODE='P0002'; END IF;
  IF assessment.status<>'INDEPENDENTLY_REVIEWED' THEN RAISE EXCEPTION 'Impairment Draft requires an independently reviewed assessment' USING ERRCODE='23514'; END IF;
  IF assessment.impairment_assessment_hash IS DISTINCT FROM p_expected_assessment_hash THEN
    RAISE EXCEPTION 'The reviewed impairment assessment changed before the Draft was created' USING ERRCODE='40001'; END IF;
  -- four eyes across the module boundary: whoever reviewed the assessment may not book it
  IF assessment.reviewed_by=actor THEN RAISE EXCEPTION 'Impairment reviewer and Draft maker must be different actors' USING ERRCODE='42501'; END IF;
  IF assessment.impairment_loss<=0 THEN RAISE EXCEPTION 'The reviewed assessment records no impairment loss' USING ERRCODE='23514'; END IF;

  SELECT * INTO asset FROM fixed_asset_register_evidence
    WHERE tenant_id=p_tenant AND entity_id=p_entity AND fixed_asset_register_evidence_id=assessment.fixed_asset_register_evidence_id FOR SHARE;
  IF NOT FOUND OR asset.status<>'ACTIVE' THEN RAISE EXCEPTION 'Impairment Draft requires an ACTIVE registered asset' USING ERRCODE='23514'; END IF;
  IF EXISTS(SELECT 1 FROM fixed_asset_disposal_posting WHERE tenant_id=p_tenant AND entity_id=p_entity AND fixed_asset_register_evidence_id=asset.fixed_asset_register_evidence_id) THEN
    RAISE EXCEPTION 'A disposed asset cannot be impaired' USING ERRCODE='23514'; END IF;

  SELECT * INTO period_row FROM accounting_period WHERE tenant_id=p_tenant AND entity_id=p_entity AND period_id=assessment.accounting_period_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'A valid entity-scoped accounting period is required' USING ERRCODE='22023'; END IF;

  -- 243 reconciles on this dimension; if anything is already posted against the
  -- assessment the Draft would double-count, so refuse rather than add to it
  SELECT COALESCE(sum(l.debit_amount-l.credit_amount),0)::numeric(20,4) INTO posted_already
  FROM ledger_line l JOIN journal_entry j ON j.tenant_id=l.tenant_id AND j.entity_id=l.entity_id AND j.journal_entry_id=l.journal_entry_id
  WHERE l.tenant_id=p_tenant AND l.entity_id=p_entity AND j.status='POSTED'
    AND (l.dimensions->>'impairment_assessment_evidence_id'=p_assessment::text OR l.dimensions->>'fixed_asset_impairment_assessment_evidence_id'=p_assessment::text)
    AND l.account_code=assessment.impairment_expense_account_code;
  IF posted_already<>0 THEN RAISE EXCEPTION 'This impairment assessment is already reflected in the Posted ledger' USING ERRCODE='23514'; END IF;

  -- Both spellings of the assessment dimension are carried deliberately.  Nine
  -- migrations (336, 337, 339, 340, 352, 357, 358, 359, 360) and the kernel
  -- fixtures key on 'fixed_asset_impairment_assessment_evidence_id'; 243, the
  -- only posted-impairment reconciliation, keys on the short
  -- 'impairment_assessment_evidence_id' and is never replaced.  Emitting one of
  -- them would leave either the guards or the reconciliation blind, so the
  -- Draft satisfies both until the Owner decides which spelling survives
  -- (D-P08-1).  They always carry the same evidence id.
  dims:=jsonb_strip_nulls(jsonb_build_object(
    'fixed_asset_impairment_assessment_evidence_id',p_assessment,
    'impairment_assessment_evidence_id',p_assessment,
    'fixed_asset_register_evidence_id',asset.fixed_asset_register_evidence_id,
    'project_ref',NULLIF(btrim(coalesce(asset.member_trace->>'project_ref','')),''),
    'property_ref',NULLIF(btrim(coalesce(asset.member_trace->>'property_ref','')),'')));
  lines:=jsonb_build_array(
    jsonb_build_object('line_no',1,'account_code',assessment.impairment_expense_account_code,'debit_amount',assessment.impairment_loss,'credit_amount',0,'member_ref',NULL,'dimensions',dims),
    jsonb_build_object('line_no',2,'account_code',assessment.accumulated_impairment_account_code,'debit_amount',0,'credit_amount',assessment.impairment_loss,'member_ref',NULL,'dimensions',dims));
  inner_hash:=refs_create_manual_journal_hash(p_tenant,p_entity,assessment.accounting_period_id,btrim(p_number),p_date,assessment.currency,btrim(p_reason),lines,p_attachments);
  journal:=refs_create_manual_journal(p_tenant,p_entity,assessment.accounting_period_id,btrim(p_number),p_date,assessment.currency,btrim(p_reason),lines,p_attachments,'asset-impairment:'||binding,inner_hash);
  journal_id:=(journal->>'journal_entry_id')::uuid;

  INSERT INTO fixed_asset_impairment_draft_binding(fixed_asset_impairment_draft_binding_id,tenant_id,entity_id,
    fixed_asset_impairment_assessment_evidence_id,fixed_asset_register_evidence_id,accounting_period_id,journal_entry_id,
    impairment_loss,impairment_expense_account_code,accumulated_impairment_account_code,impairment_assessment_hash,created_by,reason)
  VALUES(binding,p_tenant,p_entity,p_assessment,asset.fixed_asset_register_evidence_id,assessment.accounting_period_id,journal_id,
    assessment.impairment_loss,assessment.impairment_expense_account_code,assessment.accumulated_impairment_account_code,
    assessment.impairment_assessment_hash,actor,btrim(p_reason));

  payload:=journal||jsonb_build_object('schema_version','FIXED_ASSET_IMPAIRMENT_DRAFT_V1',
    'fixed_asset_impairment_draft_binding_id',binding,'impairment_assessment_evidence_id',p_assessment,
    'fixed_asset_register_evidence_id',asset.fixed_asset_register_evidence_id,
    'impairment_loss',to_char(assessment.impairment_loss,'FM999999999999999990.0000'),
    'impairment_assessment_hash',assessment.impairment_assessment_hash);
  INSERT INTO audit_event(tenant_id,entity_id,event_type,object_type,object_id,action,actor_id,actor_type,permission_used,request_id,correlation_id,idempotency_key,after_hash,reason,metadata)
  VALUES(p_tenant,p_entity,'FIXED_ASSET_IMPAIRMENT_DRAFT_CREATED','JOURNAL_ENTRY',journal_id,'CREATE',actor,'USER','FIXED_ASSET.IMPAIRMENT.DRAFT',p_key,p_key,p_key,refs_jsonb_hash(payload),btrim(p_reason),payload);
  INSERT INTO outbox_event(tenant_id,entity_id,aggregate_type,aggregate_id,event_type,payload,payload_hash)
  VALUES(p_tenant,p_entity,'JOURNAL_ENTRY',journal_id,'FIXED_ASSET_IMPAIRMENT_DRAFT_CREATED',payload,refs_jsonb_hash(payload));
  UPDATE idempotency_receipt SET status='SUCCEEDED',response_status=201,response_body=payload,completed_at=clock_timestamp() WHERE idempotency_receipt_id=idem.idempotency_receipt_id;
  RETURN payload||jsonb_build_object('idempotent',false);
END;$$;

REVOKE ALL ON FUNCTION refs_create_fixed_asset_impairment_draft_hash(uuid,uuid,uuid,text,date,text,text,uuid[]) FROM PUBLIC;
REVOKE ALL ON FUNCTION refs_create_fixed_asset_impairment_draft(uuid,uuid,uuid,text,date,text,text,uuid[],text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION refs_create_fixed_asset_impairment_draft_hash(uuid,uuid,uuid,text,date,text,text,uuid[]) TO refs_app;
GRANT EXECUTE ON FUNCTION refs_create_fixed_asset_impairment_draft(uuid,uuid,uuid,text,date,text,text,uuid[],text,text) TO refs_app;

COMMIT;
