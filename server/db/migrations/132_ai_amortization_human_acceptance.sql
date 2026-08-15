BEGIN;

INSERT INTO permission_catalog(permission_code,domain,risk_class,sod_class) VALUES
  ('AI.AMORTIZATION.ACCEPT','AI_ACCOUNTING','HIGH','CONTROLLER')
ON CONFLICT(permission_code) DO UPDATE SET active=true,domain=EXCLUDED.domain,risk_class=EXCLUDED.risk_class,sod_class=EXCLUDED.sod_class,version=permission_catalog.version+1,effective_to=NULL;

-- A proposed schedule never creates a journal.  A controller may only accept
-- one schedule month after a different maker has prepared the exact, balanced
-- standard Draft JE.  The acceptance is append-only evidence that links the
-- source, proposal, schedule line, Draft and later ledger through source_link.
CREATE TABLE ai_amortization_schedule_acceptance (
  ai_amortization_schedule_acceptance_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant(tenant_id),
  entity_id uuid NOT NULL,
  ai_amortization_schedule_id uuid NOT NULL,
  ai_amortization_schedule_line_id uuid NOT NULL,
  source_document_id uuid NOT NULL,
  journal_entry_id uuid NOT NULL,
  acceptance_reason text NOT NULL CHECK(length(btrim(acceptance_reason)) BETWEEN 8 AND 2000),
  acceptance_hash text NOT NULL CHECK(acceptance_hash ~ '^sha256:[0-9a-f]{64}$'),
  accepted_by text NOT NULL,
  accepted_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE(tenant_id,entity_id,ai_amortization_schedule_acceptance_id),
  UNIQUE(tenant_id,entity_id,ai_amortization_schedule_line_id),
  UNIQUE(tenant_id,entity_id,journal_entry_id),
  FOREIGN KEY(tenant_id,entity_id,ai_amortization_schedule_id) REFERENCES ai_amortization_schedule(tenant_id,entity_id,ai_amortization_schedule_id),
  FOREIGN KEY(tenant_id,entity_id,ai_amortization_schedule_line_id) REFERENCES ai_amortization_schedule_line(tenant_id,entity_id,ai_amortization_schedule_line_id),
  FOREIGN KEY(tenant_id,entity_id,source_document_id) REFERENCES source_document(tenant_id,entity_id,source_document_id),
  FOREIGN KEY(tenant_id,entity_id,journal_entry_id) REFERENCES journal_entry(tenant_id,entity_id,journal_entry_id)
);

ALTER TABLE ai_amortization_schedule_acceptance ENABLE ROW LEVEL SECURITY;
CREATE POLICY ai_amortization_schedule_acceptance_scope ON ai_amortization_schedule_acceptance
  USING(tenant_id=refs_current_tenant() AND refs_entity_allowed(entity_id))
  WITH CHECK(tenant_id=refs_current_tenant() AND refs_entity_allowed(entity_id));
CREATE TRIGGER ai_amortization_schedule_acceptance_append_only BEFORE UPDATE OR DELETE ON ai_amortization_schedule_acceptance
  FOR EACH ROW EXECUTE FUNCTION reject_mutation();

CREATE FUNCTION refs_accept_ai_amortization_schedule_hash(
  p_tenant uuid,p_entity uuid,p_schedule uuid,p_schedule_line uuid,p_journal uuid,p_reason text
) RETURNS text LANGUAGE sql IMMUTABLE SET search_path=pg_catalog,public,pg_temp AS $$
  SELECT refs_jsonb_hash(jsonb_build_object(
    'schema_version','AI_AMORTIZATION_ACCEPTANCE_V1','tenant_id',p_tenant,'entity_id',p_entity,
    'ai_amortization_schedule_id',p_schedule,'ai_amortization_schedule_line_id',p_schedule_line,
    'journal_entry_id',p_journal,'reason',btrim(p_reason)
  ))
$$;

CREATE FUNCTION refs_accept_ai_amortization_schedule(
  p_tenant uuid,p_entity uuid,p_schedule uuid,p_schedule_line uuid,p_journal uuid,p_reason text,
  p_idempotency_key text,p_request_hash text
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE actor text:=refs_current_actor(); idem idempotency_receipt; schedule ai_amortization_schedule;
DECLARE schedule_line ai_amortization_schedule_line; source source_document; je journal_entry; acceptance_id uuid:=gen_random_uuid();
DECLARE computed_hash text; event_payload jsonb; result jsonb;
BEGIN
  PERFORM refs_assert_scope(p_tenant,p_entity,'AI.AMORTIZATION.ACCEPT');
  IF actor IS NULL THEN RAISE EXCEPTION 'Authenticated amortization controller missing' USING ERRCODE='42501'; END IF;
  computed_hash:=refs_accept_ai_amortization_schedule_hash(p_tenant,p_entity,p_schedule,p_schedule_line,p_journal,p_reason);
  IF p_request_hash<>computed_hash THEN RAISE EXCEPTION 'AI amortization acceptance request hash is not canonical' USING ERRCODE='22023'; END IF;
  IF COALESCE(length(btrim(p_reason)),0) NOT BETWEEN 8 AND 2000 THEN RAISE EXCEPTION 'AI amortization acceptance requires a controller reason' USING ERRCODE='22023'; END IF;

  INSERT INTO idempotency_receipt(tenant_id,operation_scope,idempotency_key,request_hash,status,actor_id)
    VALUES(p_tenant,'AI_AMORTIZATION_ACCEPTANCE:'||p_entity,p_idempotency_key,p_request_hash,'IN_PROGRESS',actor)
    ON CONFLICT(tenant_id,operation_scope,idempotency_key) DO NOTHING;
  SELECT * INTO idem FROM idempotency_receipt WHERE tenant_id=p_tenant AND operation_scope='AI_AMORTIZATION_ACCEPTANCE:'||p_entity AND idempotency_key=p_idempotency_key FOR UPDATE;
  IF idem.request_hash<>p_request_hash THEN RAISE EXCEPTION 'Idempotency key reused with a different AI amortization acceptance' USING ERRCODE='23505'; END IF;
  IF idem.status='SUCCEEDED' THEN RETURN idem.response_body||jsonb_build_object('idempotent',true); END IF;

  SELECT * INTO schedule FROM ai_amortization_schedule WHERE tenant_id=p_tenant AND entity_id=p_entity AND ai_amortization_schedule_id=p_schedule FOR SHARE;
  SELECT * INTO schedule_line FROM ai_amortization_schedule_line WHERE tenant_id=p_tenant AND entity_id=p_entity AND ai_amortization_schedule_line_id=p_schedule_line AND ai_amortization_schedule_id=p_schedule FOR SHARE;
  SELECT * INTO source FROM source_document WHERE tenant_id=p_tenant AND entity_id=p_entity AND source_document_id=COALESCE(schedule.source_document_id,p_schedule) FOR SHARE;
  SELECT * INTO je FROM journal_entry WHERE tenant_id=p_tenant AND entity_id=p_entity AND journal_entry_id=p_journal FOR UPDATE;
  IF NOT FOUND OR je.status<>'DRAFT' OR je.journal_type NOT IN ('MANUAL','AUTO') OR je.created_by=actor
     OR je.currency<>schedule.currency OR je.journal_date<>schedule_line.amortization_month THEN
    RAISE EXCEPTION 'AI amortization acceptance requires a different-maker standard Draft with matching currency and amortization month' USING ERRCODE='23514';
  END IF;
  IF source.source_document_id IS NULL OR source.payload_hash<>schedule.source_payload_hash OR source.version<>schedule.source_document_version
     OR source.status<>'READY_FOR_DRAFT' OR schedule_line.source_payload_hash<>schedule.source_payload_hash THEN
    RAISE EXCEPTION 'AI amortization acceptance source or schedule evidence changed' USING ERRCODE='23514';
  END IF;
  IF (SELECT count(*) FROM journal_line WHERE tenant_id=p_tenant AND entity_id=p_entity AND journal_entry_id=p_journal)<>2
     OR NOT EXISTS(SELECT 1 FROM journal_line WHERE tenant_id=p_tenant AND entity_id=p_entity AND journal_entry_id=p_journal AND account_code=schedule.expense_account_code AND debit_amount=schedule_line.amount AND credit_amount=0)
     OR NOT EXISTS(SELECT 1 FROM journal_line WHERE tenant_id=p_tenant AND entity_id=p_entity AND journal_entry_id=p_journal AND account_code=schedule.prepaid_account_code AND credit_amount=schedule_line.amount AND debit_amount=0) THEN
    RAISE EXCEPTION 'AI amortization acceptance Draft lines do not exactly match the accepted schedule month' USING ERRCODE='23514';
  END IF;

  INSERT INTO ai_amortization_schedule_acceptance(ai_amortization_schedule_acceptance_id,tenant_id,entity_id,ai_amortization_schedule_id,ai_amortization_schedule_line_id,source_document_id,journal_entry_id,acceptance_reason,acceptance_hash,accepted_by)
    VALUES(acceptance_id,p_tenant,p_entity,p_schedule,p_schedule_line,schedule.source_document_id,p_journal,btrim(p_reason),computed_hash,actor);
  INSERT INTO source_link(tenant_id,entity_id,link_type,source_document_id,journal_entry_id,created_by)
    VALUES(p_tenant,p_entity,'AI_AMORTIZATION_ACCEPTANCE_SOURCE',schedule.source_document_id,p_journal,actor);
  event_payload:=jsonb_build_object('schema_version','AI_AMORTIZATION_ACCEPTANCE_V1','ai_amortization_schedule_acceptance_id',acceptance_id,
    'ai_amortization_schedule_id',p_schedule,'ai_amortization_schedule_line_id',p_schedule_line,'source_document_id',schedule.source_document_id,
    'journal_entry_id',p_journal,'status','ACCEPTED_FOR_STANDARD_JE_WORKFLOW','can_create_draft',false,'can_review',false,'can_approve',false,'can_post',false);
  INSERT INTO audit_event(tenant_id,entity_id,event_type,object_type,object_id,action,actor_id,actor_type,permission_used,request_id,correlation_id,idempotency_key,after_hash,reason,metadata)
    VALUES(p_tenant,p_entity,'AI_AMORTIZATION_ACCEPTED','AI_AMORTIZATION_SCHEDULE_ACCEPTANCE',acceptance_id,'ACCEPT',actor,'USER','AI.AMORTIZATION.ACCEPT',p_idempotency_key,p_idempotency_key,p_idempotency_key,computed_hash,btrim(p_reason),event_payload);
  INSERT INTO outbox_event(tenant_id,entity_id,aggregate_type,aggregate_id,event_type,payload,payload_hash)
    VALUES(p_tenant,p_entity,'AI_AMORTIZATION_SCHEDULE_ACCEPTANCE',acceptance_id,'AI_AMORTIZATION_ACCEPTED',event_payload,refs_jsonb_hash(event_payload));
  result:=event_payload||jsonb_build_object('idempotent',false);
  UPDATE idempotency_receipt SET status='SUCCEEDED',response_status=201,response_body=result,completed_at=clock_timestamp()
    WHERE idempotency_receipt_id=idem.idempotency_receipt_id;
  RETURN result;
END;
$$;

REVOKE ALL ON ai_amortization_schedule_acceptance FROM PUBLIC,refs_app;
REVOKE EXECUTE ON FUNCTION refs_accept_ai_amortization_schedule_hash(uuid,uuid,uuid,uuid,uuid,text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION refs_accept_ai_amortization_schedule(uuid,uuid,uuid,uuid,uuid,text,text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION refs_accept_ai_amortization_schedule_hash(uuid,uuid,uuid,uuid,uuid,text) TO refs_app;
GRANT EXECUTE ON FUNCTION refs_accept_ai_amortization_schedule(uuid,uuid,uuid,uuid,uuid,text,text,text) TO refs_app;

COMMIT;
