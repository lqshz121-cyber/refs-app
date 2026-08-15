BEGIN;

-- AI analysis is never a posting authority.  A separate human maker may turn
-- one immutable, whole-month schedule line into a normal MANUAL Draft JE.  It
-- then uses the existing submit/review/approve/post workflow and its SoD
-- checks; this migration does not introduce an AI approval or posting path.
INSERT INTO permission_catalog(permission_code,domain,risk_class,sod_class) VALUES
  ('AI.AMORTIZATION.DRAFT','AI_ACCOUNTING','HIGH','AI_AMORTIZATION_DRAFTER')
ON CONFLICT(permission_code) DO UPDATE SET active=true,domain=EXCLUDED.domain,risk_class=EXCLUDED.risk_class,sod_class=EXCLUDED.sod_class,version=permission_catalog.version+1,effective_to=NULL;

CREATE TABLE ai_amortization_draft_evidence (
  ai_amortization_draft_evidence_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant(tenant_id),
  entity_id uuid NOT NULL,
  ai_amortization_schedule_id uuid NOT NULL,
  ai_amortization_schedule_line_id uuid NOT NULL,
  source_document_id uuid NOT NULL,
  journal_entry_id uuid NOT NULL,
  period_id uuid NOT NULL,
  proposal_hash text NOT NULL CHECK(proposal_hash ~ '^sha256:[0-9a-f]{64}$'),
  source_payload_hash text NOT NULL CHECK(source_payload_hash ~ '^sha256:[0-9a-f]{64}$'),
  line_amount numeric(20,4) NOT NULL CHECK(line_amount>0),
  evidence_hash text NOT NULL CHECK(evidence_hash ~ '^sha256:[0-9a-f]{64}$'),
  created_by text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE(tenant_id,entity_id,ai_amortization_draft_evidence_id),
  UNIQUE(tenant_id,entity_id,ai_amortization_schedule_line_id),
  UNIQUE(tenant_id,entity_id,journal_entry_id),
  FOREIGN KEY(tenant_id,entity_id,ai_amortization_schedule_id) REFERENCES ai_amortization_schedule(tenant_id,entity_id,ai_amortization_schedule_id),
  FOREIGN KEY(tenant_id,entity_id,ai_amortization_schedule_line_id) REFERENCES ai_amortization_schedule_line(tenant_id,entity_id,ai_amortization_schedule_line_id),
  FOREIGN KEY(tenant_id,entity_id,source_document_id) REFERENCES source_document(tenant_id,entity_id,source_document_id),
  FOREIGN KEY(tenant_id,entity_id,journal_entry_id) REFERENCES journal_entry(tenant_id,entity_id,journal_entry_id),
  FOREIGN KEY(tenant_id,entity_id,period_id) REFERENCES accounting_period(tenant_id,entity_id,period_id)
);
ALTER TABLE ai_amortization_draft_evidence ENABLE ROW LEVEL SECURITY;
CREATE POLICY ai_amortization_draft_evidence_scope ON ai_amortization_draft_evidence
  USING(tenant_id=refs_current_tenant() AND refs_entity_allowed(entity_id))
  WITH CHECK(tenant_id=refs_current_tenant() AND refs_entity_allowed(entity_id));
CREATE TRIGGER ai_amortization_draft_evidence_append_only BEFORE UPDATE OR DELETE ON ai_amortization_draft_evidence
  FOR EACH ROW EXECUTE FUNCTION reject_mutation();

CREATE FUNCTION refs_create_ai_amortization_draft_hash(
  p_tenant uuid,p_entity uuid,p_schedule uuid,p_line uuid,p_period uuid,p_expected_proposal_hash text,p_attachment_ids uuid[],p_reason text
) RETURNS text LANGUAGE sql IMMUTABLE SET search_path=pg_catalog,public,pg_temp AS $$
  SELECT refs_jsonb_hash(jsonb_build_object(
    'schema_version','AI_AMORTIZATION_HUMAN_DRAFT_V1','tenant_id',p_tenant,'entity_id',p_entity,
    'ai_amortization_schedule_id',p_schedule,'ai_amortization_schedule_line_id',p_line,'period_id',p_period,
    'expected_proposal_hash',p_expected_proposal_hash,
    'attachment_ids',to_jsonb(ARRAY(SELECT value FROM unnest(COALESCE(p_attachment_ids,'{}'::uuid[])) value ORDER BY value)),
    'reason',btrim(p_reason)
  ))
$$;

CREATE FUNCTION refs_create_ai_amortization_draft(
  p_tenant uuid,p_entity uuid,p_schedule uuid,p_line uuid,p_period uuid,p_expected_proposal_hash text,p_attachment_ids uuid[],p_reason text,
  p_idempotency_key text,p_request_hash text
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE actor text:=refs_current_actor(); schedule ai_amortization_schedule; schedule_line ai_amortization_schedule_line; idem idempotency_receipt;
DECLARE source source_document; period_row accounting_period; request_hash text; create_result jsonb; evidence_id uuid:=gen_random_uuid();
DECLARE journal_id uuid; journal_number text; description text; lines jsonb; evidence_hash text; event_payload jsonb;
BEGIN
  PERFORM refs_assert_scope(p_tenant,p_entity,'AI.AMORTIZATION.DRAFT');
  PERFORM refs_assert_scope(p_tenant,p_entity,'GL.JE.CREATE');
  IF actor IS NULL THEN RAISE EXCEPTION 'Authenticated AI amortization Draft maker missing' USING ERRCODE='42501'; END IF;
  request_hash:=refs_create_ai_amortization_draft_hash(p_tenant,p_entity,p_schedule,p_line,p_period,p_expected_proposal_hash,p_attachment_ids,p_reason);
  IF p_request_hash<>request_hash THEN RAISE EXCEPTION 'AI amortization Draft request hash is not canonical' USING ERRCODE='22023'; END IF;
  IF p_expected_proposal_hash !~ '^sha256:[0-9a-f]{64}$' OR COALESCE(length(btrim(p_reason)),0) NOT BETWEEN 8 AND 2000
     OR COALESCE(cardinality(p_attachment_ids),0)=0 THEN
    RAISE EXCEPTION 'AI amortization Draft requires immutable proposal evidence, linked attachments, and a maker reason' USING ERRCODE='22023';
  END IF;
  INSERT INTO idempotency_receipt(tenant_id,operation_scope,idempotency_key,request_hash,status,actor_id)
    VALUES(p_tenant,'AI_AMORTIZATION_DRAFT:'||p_entity,p_idempotency_key,p_request_hash,'IN_PROGRESS',actor) ON CONFLICT DO NOTHING;
  SELECT * INTO idem FROM idempotency_receipt WHERE tenant_id=p_tenant AND operation_scope='AI_AMORTIZATION_DRAFT:'||p_entity AND idempotency_key=p_idempotency_key FOR UPDATE;
  IF idem.request_hash<>p_request_hash THEN RAISE EXCEPTION 'Idempotency key reused with different request hash' USING ERRCODE='23505'; END IF;
  IF idem.status='SUCCEEDED' THEN RETURN idem.response_body||jsonb_build_object('idempotent',true); END IF;
  SELECT * INTO schedule FROM ai_amortization_schedule WHERE tenant_id=p_tenant AND entity_id=p_entity AND ai_amortization_schedule_id=p_schedule FOR SHARE;
  IF NOT FOUND OR schedule.status<>'PROPOSED' OR schedule.proposal_hash<>p_expected_proposal_hash THEN RAISE EXCEPTION 'AI amortization proposal is missing or changed' USING ERRCODE='40001'; END IF;
  IF actor=schedule.created_by THEN RAISE EXCEPTION 'AI analysis proposer and Draft maker must be different actors' USING ERRCODE='42501'; END IF;
  SELECT * INTO schedule_line FROM ai_amortization_schedule_line WHERE tenant_id=p_tenant AND entity_id=p_entity AND ai_amortization_schedule_line_id=p_line AND ai_amortization_schedule_id=p_schedule FOR SHARE;
  IF NOT FOUND OR schedule_line.status<>'PROPOSED' OR schedule_line.source_payload_hash<>schedule.source_payload_hash THEN RAISE EXCEPTION 'AI amortization schedule line is missing or changed' USING ERRCODE='40001'; END IF;
  SELECT * INTO source FROM source_document WHERE tenant_id=p_tenant AND entity_id=p_entity AND source_document_id=schedule.source_document_id FOR SHARE;
  IF NOT FOUND OR source.payload_hash<>schedule.source_payload_hash OR source.version<>schedule.source_document_version OR source.status<>'READY_FOR_DRAFT' THEN RAISE EXCEPTION 'AI amortization source is missing, changed, or not ready for Draft review' USING ERRCODE='23514'; END IF;
  SELECT * INTO period_row FROM accounting_period WHERE tenant_id=p_tenant AND entity_id=p_entity AND period_id=p_period AND status='OPEN' FOR SHARE;
  IF NOT FOUND OR schedule_line.amortization_month NOT BETWEEN period_row.starts_on AND period_row.ends_on THEN RAISE EXCEPTION 'AI amortization line must be drafted in its OPEN accounting period' USING ERRCODE='55000'; END IF;
  IF EXISTS(SELECT 1 FROM ai_amortization_draft_evidence WHERE tenant_id=p_tenant AND entity_id=p_entity AND ai_amortization_schedule_line_id=p_line) THEN RAISE EXCEPTION 'AI amortization schedule line already has a retained Draft' USING ERRCODE='23505'; END IF;
  IF COALESCE(cardinality(p_attachment_ids),0)<>(SELECT count(DISTINCT a.attachment_id) FROM attachment a JOIN source_link l ON l.attachment_id=a.attachment_id
    WHERE a.tenant_id=p_tenant AND a.entity_id=p_entity AND a.attachment_id=ANY(p_attachment_ids) AND a.finalization_status='VERIFIED_CLEAN'
      AND l.tenant_id=p_tenant AND l.entity_id=p_entity AND l.source_document_id=source.source_document_id AND l.link_type='SOURCE_ATTACHMENT') THEN
    RAISE EXCEPTION 'AI amortization Draft attachments must be clean evidence linked to the exact source' USING ERRCODE='23503';
  END IF;
  PERFORM 1 FROM account_master WHERE tenant_id=p_tenant AND entity_id=p_entity AND account_code IN (schedule.prepaid_account_code,schedule.expense_account_code) AND active
    GROUP BY tenant_id,entity_id HAVING count(*)=2;
  IF NOT FOUND THEN RAISE EXCEPTION 'AI amortization accounts are inactive or missing' USING ERRCODE='23503'; END IF;
  journal_number:='AI-AMORT-'||replace(p_line::text,'-',''); description:='Human-reviewed AI amortization for '||to_char(schedule_line.amortization_month,'YYYY-MM');
  lines:=jsonb_build_array(
    jsonb_build_object('line_no',1,'account_code',schedule.expense_account_code,'debit_amount',schedule_line.amount,'credit_amount',0,'description',description,'dimensions','{}'::jsonb),
    jsonb_build_object('line_no',2,'account_code',schedule.prepaid_account_code,'debit_amount',0,'credit_amount',schedule_line.amount,'description',description,'dimensions','{}'::jsonb)
  );
  create_result:=refs_create_manual_journal(p_tenant,p_entity,p_period,journal_number,schedule_line.amortization_month,schedule.currency,description,lines,p_attachment_ids,
    'AI-AMORTIZATION:'||p_idempotency_key,refs_create_manual_journal_hash(p_tenant,p_entity,p_period,journal_number,schedule_line.amortization_month,schedule.currency,description,lines,p_attachment_ids));
  journal_id:=(create_result->>'journal_entry_id')::uuid;
  evidence_hash:=refs_jsonb_hash(jsonb_build_object('schema_version','AI_AMORTIZATION_HUMAN_DRAFT_V1','ai_amortization_schedule_id',p_schedule,'ai_amortization_schedule_line_id',p_line,'source_document_id',source.source_document_id,'journal_entry_id',journal_id,'period_id',p_period,'proposal_hash',schedule.proposal_hash,'source_payload_hash',source.payload_hash,'line_amount',schedule_line.amount));
  INSERT INTO ai_amortization_draft_evidence(ai_amortization_draft_evidence_id,tenant_id,entity_id,ai_amortization_schedule_id,ai_amortization_schedule_line_id,source_document_id,journal_entry_id,period_id,proposal_hash,source_payload_hash,line_amount,evidence_hash,created_by)
    VALUES(evidence_id,p_tenant,p_entity,p_schedule,p_line,source.source_document_id,journal_id,p_period,schedule.proposal_hash,source.payload_hash,schedule_line.amount,evidence_hash,actor);
  INSERT INTO source_link(tenant_id,entity_id,link_type,source_document_id,journal_entry_id,created_by)
    VALUES(p_tenant,p_entity,'AI_AMORTIZATION_SOURCE',source.source_document_id,journal_id,actor);
  event_payload:=jsonb_build_object('schema_version','AI_AMORTIZATION_HUMAN_DRAFT_V1','ai_amortization_draft_evidence_id',evidence_id,'ai_amortization_schedule_id',p_schedule,'ai_amortization_schedule_line_id',p_line,'source_document_id',source.source_document_id,'journal_entry_id',journal_id,'period_id',p_period,'status','DRAFT','can_create_draft',false,'can_review',false,'can_approve',false,'can_post',false);
  INSERT INTO audit_event(tenant_id,entity_id,event_type,object_type,object_id,action,actor_id,actor_type,permission_used,request_id,correlation_id,idempotency_key,after_hash,reason,metadata)
    VALUES(p_tenant,p_entity,'AI_AMORTIZATION_DRAFT_CREATED','JOURNAL_ENTRY',journal_id,'CREATE_DRAFT',actor,'USER','AI.AMORTIZATION.DRAFT',p_idempotency_key,p_idempotency_key,p_idempotency_key,evidence_hash,btrim(p_reason),event_payload);
  INSERT INTO outbox_event(tenant_id,entity_id,aggregate_type,aggregate_id,event_type,payload,payload_hash)
    VALUES(p_tenant,p_entity,'AI_AMORTIZATION_DRAFT_EVIDENCE',evidence_id,'AI_AMORTIZATION_DRAFT_CREATED',event_payload,refs_jsonb_hash(event_payload));
  create_result:=create_result||jsonb_build_object('ai_amortization_draft_evidence_id',evidence_id,'ai_amortization_schedule_id',p_schedule,'ai_amortization_schedule_line_id',p_line,'source_document_id',source.source_document_id,'journal_type','MANUAL','status','DRAFT','can_create_draft',false,'can_review',false,'can_approve',false,'can_post',false,'idempotent',false);
  UPDATE idempotency_receipt SET status='SUCCEEDED',response_status=201,response_body=create_result,completed_at=clock_timestamp()
    WHERE tenant_id=p_tenant AND operation_scope='AI_AMORTIZATION_DRAFT:'||p_entity AND idempotency_key=p_idempotency_key;
  RETURN create_result;
END;
$$;

REVOKE ALL ON ai_amortization_draft_evidence FROM PUBLIC,refs_app;
REVOKE EXECUTE ON FUNCTION refs_create_ai_amortization_draft_hash(uuid,uuid,uuid,uuid,uuid,text,uuid[],text),refs_create_ai_amortization_draft(uuid,uuid,uuid,uuid,uuid,text,uuid[],text,text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION refs_create_ai_amortization_draft_hash(uuid,uuid,uuid,uuid,uuid,text,uuid[],text),refs_create_ai_amortization_draft(uuid,uuid,uuid,uuid,uuid,text,uuid[],text,text,text) TO refs_app;

COMMIT;
