BEGIN;

CREATE TABLE ai_accounting_decision (
  ai_accounting_decision_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant(tenant_id), entity_id uuid NOT NULL,
  company_code text NOT NULL, period_id uuid NOT NULL, source_document_id uuid NOT NULL,
  settings_snapshot_id uuid NOT NULL, packet jsonb NOT NULL,
  decision_hash text NOT NULL CHECK(decision_hash ~ '^sha256:[0-9a-f]{64}$'),
  packet_status text NOT NULL CHECK(packet_status IN ('READY_FOR_HUMAN_REVIEW','EXCEPTION')),
  created_by text NOT NULL, created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE(tenant_id,entity_id,decision_hash),
  UNIQUE(tenant_id,entity_id,ai_accounting_decision_id),
  FOREIGN KEY(tenant_id,entity_id,period_id) REFERENCES accounting_period(tenant_id,entity_id,period_id),
  FOREIGN KEY(tenant_id,entity_id,source_document_id) REFERENCES source_document(tenant_id,entity_id,source_document_id)
);
CREATE TABLE ai_accounting_human_decision (
  ai_accounting_human_decision_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL, entity_id uuid NOT NULL, ai_accounting_decision_id uuid NOT NULL,
  decision text NOT NULL CHECK(decision IN ('ACCEPTED','REJECTED')), decision_hash text NOT NULL,
  evidence_hash text NOT NULL CHECK(evidence_hash ~ '^sha256:[0-9a-f]{64}$'), reason text NOT NULL,
  decided_by text NOT NULL, decided_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE(tenant_id,entity_id,ai_accounting_human_decision_id),
  UNIQUE(tenant_id,entity_id,ai_accounting_decision_id),
  FOREIGN KEY(tenant_id,entity_id,ai_accounting_decision_id) REFERENCES ai_accounting_decision(tenant_id,entity_id,ai_accounting_decision_id)
);
CREATE TABLE ai_accounting_decision_draft_evidence (
  ai_accounting_decision_draft_evidence_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL, entity_id uuid NOT NULL, ai_accounting_decision_id uuid NOT NULL,
  ai_accounting_human_decision_id uuid NOT NULL, journal_entry_id uuid NOT NULL,
  decision_hash text NOT NULL, acceptance_hash text NOT NULL, evidence_hash text NOT NULL CHECK(evidence_hash ~ '^sha256:[0-9a-f]{64}$'),
  created_by text NOT NULL, created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE(tenant_id,entity_id,ai_accounting_decision_id), UNIQUE(tenant_id,entity_id,journal_entry_id),
  FOREIGN KEY(tenant_id,entity_id,ai_accounting_decision_id) REFERENCES ai_accounting_decision(tenant_id,entity_id,ai_accounting_decision_id),
  FOREIGN KEY(tenant_id,entity_id,ai_accounting_human_decision_id) REFERENCES ai_accounting_human_decision(tenant_id,entity_id,ai_accounting_human_decision_id),
  FOREIGN KEY(tenant_id,entity_id,journal_entry_id) REFERENCES journal_entry(tenant_id,entity_id,journal_entry_id)
);

DO $$ DECLARE t text; BEGIN FOREACH t IN ARRAY ARRAY['ai_accounting_decision','ai_accounting_human_decision','ai_accounting_decision_draft_evidence'] LOOP
  EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY',t);
  EXECUTE format('CREATE POLICY %I_scope ON %I USING(tenant_id=refs_current_tenant() AND refs_entity_allowed(entity_id)) WITH CHECK(tenant_id=refs_current_tenant() AND refs_entity_allowed(entity_id))',t,t);
  EXECUTE format('CREATE TRIGGER %I_append_only BEFORE UPDATE OR DELETE ON %I FOR EACH ROW EXECUTE FUNCTION reject_mutation()',t,t);
END LOOP; END $$;

CREATE FUNCTION refs_retain_ai_accounting_decision(p_tenant uuid,p_entity uuid,p_packet jsonb,p_idempotency_key text,p_request_hash text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE actor text:=refs_current_actor(); receipt idempotency_receipt; actual_hash text:=refs_jsonb_hash(p_packet); decision_id uuid; response jsonb; event_payload jsonb;
BEGIN
  PERFORM refs_assert_scope(p_tenant,p_entity,'AI.ANALYSIS.EXPLAIN');
  IF actor IS NULL THEN RAISE EXCEPTION 'Authenticated AI analysis actor missing' USING ERRCODE='42501'; END IF;
  IF p_request_hash<>refs_jsonb_hash(jsonb_build_object('tenant_id',p_tenant,'entity_id',p_entity,'packet',p_packet)) THEN RAISE EXCEPTION 'Decision retention hash is not canonical' USING ERRCODE='22023'; END IF;
  IF p_packet->>'schema_version'<>'AI_ACCOUNTING_DECISION_PACKET_V1' OR (p_packet->>'tenant_id')::uuid<>p_tenant OR (p_packet->>'entity_id')::uuid<>p_entity
    OR p_packet->>'status' NOT IN ('READY_FOR_HUMAN_REVIEW','EXCEPTION') OR p_packet#>>'{action_flags,can_create_draft}'<>'false' OR p_packet#>>'{action_flags,can_review}'<>'false' OR p_packet#>>'{action_flags,can_approve}'<>'false' OR p_packet#>>'{action_flags,can_post}'<>'false'
  THEN RAISE EXCEPTION 'Unsafe AI accounting decision packet' USING ERRCODE='23514'; END IF;
  INSERT INTO idempotency_receipt(tenant_id,operation_scope,idempotency_key,request_hash,status,actor_id) VALUES(p_tenant,'AI_ACCOUNTING_DECISION_RETAIN:'||p_entity,p_idempotency_key,p_request_hash,'IN_PROGRESS',actor) ON CONFLICT DO NOTHING;
  SELECT * INTO receipt FROM idempotency_receipt WHERE tenant_id=p_tenant AND operation_scope='AI_ACCOUNTING_DECISION_RETAIN:'||p_entity AND idempotency_key=p_idempotency_key FOR UPDATE;
  IF receipt.request_hash<>p_request_hash OR receipt.actor_id<>actor THEN RAISE EXCEPTION 'Idempotency key reused with different payload or actor' USING ERRCODE='23505'; END IF;
  IF receipt.status='SUCCEEDED' THEN RETURN receipt.response_body||jsonb_build_object('idempotent',true); END IF;
  INSERT INTO ai_accounting_decision(tenant_id,entity_id,company_code,period_id,source_document_id,settings_snapshot_id,packet,decision_hash,packet_status,created_by)
  VALUES(p_tenant,p_entity,p_packet->>'company_code',(p_packet->>'accounting_period_id')::uuid,(p_packet#>>'{source,source_document_id}')::uuid,(p_packet->>'settings_snapshot_id')::uuid,p_packet,actual_hash,p_packet->>'status','AI_ACCOUNTING_ENGINE')
  ON CONFLICT(tenant_id,entity_id,decision_hash) DO NOTHING RETURNING ai_accounting_decision_id INTO decision_id;
  IF decision_id IS NULL THEN SELECT ai_accounting_decision_id INTO decision_id FROM ai_accounting_decision WHERE tenant_id=p_tenant AND entity_id=p_entity AND decision_hash=actual_hash; END IF;
  event_payload:=jsonb_build_object('schema_version','AI_ACCOUNTING_DECISION_RETAINED_V1','ai_accounting_decision_id',decision_id,'decision_hash',actual_hash,'packet_status',p_packet->>'status','source_document_id',p_packet#>>'{source,source_document_id}','can_create_draft',false,'can_review',false,'can_approve',false,'can_post',false);
  INSERT INTO audit_event(tenant_id,entity_id,event_type,object_type,object_id,action,actor_id,actor_type,permission_used,request_id,correlation_id,idempotency_key,after_hash,metadata) VALUES(p_tenant,p_entity,'AI_ACCOUNTING_DECISION_RETAINED','AI_ACCOUNTING_DECISION',decision_id,'RETAIN',actor,'SYSTEM','AI.ANALYSIS.EXPLAIN',p_idempotency_key,p_idempotency_key,p_idempotency_key,actual_hash,event_payload);
  INSERT INTO outbox_event(tenant_id,entity_id,aggregate_type,aggregate_id,event_type,payload,payload_hash) VALUES(p_tenant,p_entity,'AI_ACCOUNTING_DECISION',decision_id,'AI_ACCOUNTING_DECISION_RETAINED',event_payload,refs_jsonb_hash(event_payload));
  response:=event_payload||jsonb_build_object('idempotent',false);
  UPDATE idempotency_receipt SET status='SUCCEEDED',response_status=201,response_body=response,completed_at=clock_timestamp() WHERE tenant_id=p_tenant AND operation_scope='AI_ACCOUNTING_DECISION_RETAIN:'||p_entity AND idempotency_key=p_idempotency_key;
  RETURN response;
END $$;

CREATE FUNCTION refs_human_decide_ai_accounting(p_tenant uuid,p_entity uuid,p_decision uuid,p_expected_hash text,p_expected_revision bigint,p_outcome text,p_reason text,p_idempotency_key text,p_request_hash text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE actor text:=refs_current_actor(); d ai_accounting_decision; receipt idempotency_receipt; human_id uuid:=gen_random_uuid(); evidence_hash text; response jsonb; event_payload jsonb;
BEGIN
  PERFORM refs_assert_scope(p_tenant,p_entity,'GL.JE.CREATE');
  IF actor IS NULL THEN RAISE EXCEPTION 'Authenticated human decision maker missing' USING ERRCODE='42501'; END IF;
  IF p_expected_revision<>0 OR upper(p_outcome) NOT IN ('ACCEPTED','REJECTED') OR length(btrim(p_reason)) NOT BETWEEN 8 AND 2000 THEN RAISE EXCEPTION 'Closed human decision evidence is required' USING ERRCODE='22023'; END IF;
  IF p_request_hash<>refs_jsonb_hash(jsonb_build_object('tenant_id',p_tenant,'entity_id',p_entity,'decision_id',p_decision,'expected_hash',p_expected_hash,'expected_revision',p_expected_revision,'outcome',upper(p_outcome),'reason',btrim(p_reason))) THEN RAISE EXCEPTION 'Human decision hash is not canonical' USING ERRCODE='22023'; END IF;
  INSERT INTO idempotency_receipt(tenant_id,operation_scope,idempotency_key,request_hash,status,actor_id) VALUES(p_tenant,'AI_ACCOUNTING_HUMAN_DECISION:'||p_entity,p_idempotency_key,p_request_hash,'IN_PROGRESS',actor) ON CONFLICT DO NOTHING;
  SELECT * INTO receipt FROM idempotency_receipt WHERE tenant_id=p_tenant AND operation_scope='AI_ACCOUNTING_HUMAN_DECISION:'||p_entity AND idempotency_key=p_idempotency_key FOR UPDATE;
  IF receipt.request_hash<>p_request_hash OR receipt.actor_id<>actor THEN RAISE EXCEPTION 'Idempotency key reused with different payload or actor' USING ERRCODE='23505'; END IF; IF receipt.status='SUCCEEDED' THEN RETURN receipt.response_body||jsonb_build_object('idempotent',true); END IF;
  SELECT * INTO d FROM ai_accounting_decision WHERE tenant_id=p_tenant AND entity_id=p_entity AND ai_accounting_decision_id=p_decision FOR SHARE;
  IF NOT FOUND OR d.decision_hash<>p_expected_hash THEN RAISE EXCEPTION 'AI accounting decision is missing or changed' USING ERRCODE='40001'; END IF;
  IF actor=d.created_by THEN RAISE EXCEPTION 'AI producer cannot make the human accounting decision' USING ERRCODE='42501'; END IF;
  IF upper(p_outcome)='ACCEPTED' AND d.packet_status<>'READY_FOR_HUMAN_REVIEW' THEN RAISE EXCEPTION 'Only a ready decision may be accepted' USING ERRCODE='23514'; END IF;
  IF EXISTS(SELECT 1 FROM ai_accounting_human_decision WHERE tenant_id=p_tenant AND entity_id=p_entity AND ai_accounting_decision_id=p_decision) THEN RAISE EXCEPTION 'AI accounting decision already has a human outcome' USING ERRCODE='23505'; END IF;
  evidence_hash:=refs_jsonb_hash(jsonb_build_object('decision_id',p_decision,'decision_hash',d.decision_hash,'outcome',upper(p_outcome),'reason',btrim(p_reason),'actor_id',actor));
  INSERT INTO ai_accounting_human_decision(ai_accounting_human_decision_id,tenant_id,entity_id,ai_accounting_decision_id,decision,decision_hash,evidence_hash,reason,decided_by) VALUES(human_id,p_tenant,p_entity,p_decision,upper(p_outcome),d.decision_hash,evidence_hash,btrim(p_reason),actor);
  event_payload:=jsonb_build_object('schema_version','AI_ACCOUNTING_HUMAN_DECISION_V1','ai_accounting_human_decision_id',human_id,'ai_accounting_decision_id',p_decision,'decision_hash',d.decision_hash,'outcome',upper(p_outcome),'evidence_hash',evidence_hash,'can_create_draft',false,'can_review',false,'can_approve',false,'can_post',false);
  INSERT INTO audit_event(tenant_id,entity_id,event_type,object_type,object_id,action,actor_id,actor_type,permission_used,request_id,correlation_id,idempotency_key,after_hash,reason,metadata) VALUES(p_tenant,p_entity,'AI_ACCOUNTING_HUMAN_DECISION','AI_ACCOUNTING_DECISION',p_decision,upper(p_outcome),actor,'USER','GL.JE.CREATE',p_idempotency_key,p_idempotency_key,p_idempotency_key,evidence_hash,btrim(p_reason),event_payload);
  INSERT INTO outbox_event(tenant_id,entity_id,aggregate_type,aggregate_id,event_type,payload,payload_hash) VALUES(p_tenant,p_entity,'AI_ACCOUNTING_DECISION',p_decision,'AI_ACCOUNTING_HUMAN_DECISION',event_payload,refs_jsonb_hash(event_payload));
  response:=event_payload||jsonb_build_object('idempotent',false); UPDATE idempotency_receipt SET status='SUCCEEDED',response_status=201,response_body=response,completed_at=clock_timestamp() WHERE tenant_id=p_tenant AND operation_scope='AI_ACCOUNTING_HUMAN_DECISION:'||p_entity AND idempotency_key=p_idempotency_key; RETURN response;
END $$;

CREATE FUNCTION refs_create_ai_accounting_decision_draft(p_tenant uuid,p_entity uuid,p_decision uuid,p_expected_decision_hash text,p_expected_acceptance_hash text,p_reason text,p_idempotency_key text,p_request_hash text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE actor text:=refs_current_actor(); d ai_accounting_decision; h ai_accounting_human_decision; receipt idempotency_receipt; lines jsonb; attachments uuid[]; create_result jsonb; journal_id uuid; evidence_id uuid:=gen_random_uuid(); evidence_hash text; event_payload jsonb; response jsonb; journal_number text;
BEGIN
  PERFORM refs_assert_scope(p_tenant,p_entity,'GL.JE.CREATE'); IF actor IS NULL THEN RAISE EXCEPTION 'Authenticated human Draft maker missing' USING ERRCODE='42501'; END IF;
  IF p_request_hash<>refs_jsonb_hash(jsonb_build_object('tenant_id',p_tenant,'entity_id',p_entity,'decision_id',p_decision,'expected_decision_hash',p_expected_decision_hash,'expected_acceptance_hash',p_expected_acceptance_hash,'reason',btrim(p_reason))) OR length(btrim(p_reason)) NOT BETWEEN 8 AND 2000 THEN RAISE EXCEPTION 'Draft request is not canonical' USING ERRCODE='22023'; END IF;
  INSERT INTO idempotency_receipt(tenant_id,operation_scope,idempotency_key,request_hash,status,actor_id) VALUES(p_tenant,'AI_ACCOUNTING_DECISION_DRAFT:'||p_entity,p_idempotency_key,p_request_hash,'IN_PROGRESS',actor) ON CONFLICT DO NOTHING;
  SELECT * INTO receipt FROM idempotency_receipt WHERE tenant_id=p_tenant AND operation_scope='AI_ACCOUNTING_DECISION_DRAFT:'||p_entity AND idempotency_key=p_idempotency_key FOR UPDATE;
  IF receipt.request_hash<>p_request_hash OR receipt.actor_id<>actor THEN RAISE EXCEPTION 'Idempotency key reused with different payload or actor' USING ERRCODE='23505'; END IF; IF receipt.status='SUCCEEDED' THEN RETURN receipt.response_body||jsonb_build_object('idempotent',true); END IF;
  SELECT * INTO d FROM ai_accounting_decision WHERE tenant_id=p_tenant AND entity_id=p_entity AND ai_accounting_decision_id=p_decision FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Exact accepted decision evidence is required' USING ERRCODE='40001'; END IF;
  SELECT * INTO h FROM ai_accounting_human_decision WHERE tenant_id=p_tenant AND entity_id=p_entity AND ai_accounting_decision_id=p_decision FOR SHARE;
  IF NOT FOUND OR d.decision_hash<>p_expected_decision_hash OR h.decision<>'ACCEPTED' OR h.evidence_hash<>p_expected_acceptance_hash OR d.packet_status<>'READY_FOR_HUMAN_REVIEW' THEN RAISE EXCEPTION 'Exact accepted decision evidence is required' USING ERRCODE='40001'; END IF;
  IF actor=d.created_by THEN RAISE EXCEPTION 'AI producer cannot create an accounting Draft' USING ERRCODE='42501'; END IF;
  IF EXISTS(SELECT 1 FROM ai_accounting_decision_draft_evidence WHERE tenant_id=p_tenant AND entity_id=p_entity AND ai_accounting_decision_id=p_decision) THEN RAISE EXCEPTION 'Accepted decision already has a Draft' USING ERRCODE='23505'; END IF;
  SELECT array_agg(a.attachment_id ORDER BY a.attachment_id) INTO attachments FROM attachment a JOIN source_link l ON l.tenant_id=a.tenant_id AND l.entity_id=a.entity_id AND l.attachment_id=a.attachment_id WHERE a.tenant_id=p_tenant AND a.entity_id=p_entity AND l.source_document_id=d.source_document_id AND l.link_type='SOURCE_ATTACHMENT' AND a.finalization_status='VERIFIED_CLEAN';
  IF COALESCE(cardinality(attachments),0)=0 THEN RAISE EXCEPTION 'Accepted decision requires clean source attachments' USING ERRCODE='23503'; END IF;
  SELECT jsonb_agg(jsonb_build_object('line_no',(x->>'line_number')::int,'account_code',x->>'account_code','debit_amount',CASE WHEN x->>'side'='DEBIT' THEN x->>'amount' ELSE '0' END,'credit_amount',CASE WHEN x->>'side'='CREDIT' THEN x->>'amount' ELSE '0' END,'member_ref',x->>'member_ref','description',d.packet->>'reason','dimensions',jsonb_strip_nulls(jsonb_build_object('project_ref',x->>'project_ref','property_ref',x->>'property_ref','member_ref',x->>'member_ref','cost_code_ref',x->>'cost_code_ref'))) ORDER BY (x->>'line_number')::int) INTO lines FROM jsonb_array_elements(d.packet#>'{proposed_journal,lines}') x;
  journal_number:='AI-DEC-'||replace(p_decision::text,'-',''); create_result:=refs_create_manual_journal(p_tenant,p_entity,d.period_id,journal_number,(d.packet->>'accounting_date')::date,(d.packet#>>'{source,currency}')::char(3),'Human-created Draft from accepted AI accounting decision',lines,attachments,'AI-DECISION-DRAFT:'||p_idempotency_key,refs_create_manual_journal_hash(p_tenant,p_entity,d.period_id,journal_number,(d.packet->>'accounting_date')::date,(d.packet#>>'{source,currency}')::char(3),'Human-created Draft from accepted AI accounting decision',lines,attachments));
  journal_id:=(create_result->>'journal_entry_id')::uuid; evidence_hash:=refs_jsonb_hash(jsonb_build_object('decision_id',p_decision,'decision_hash',d.decision_hash,'human_decision_id',h.ai_accounting_human_decision_id,'acceptance_hash',h.evidence_hash,'journal_entry_id',journal_id,'maker',actor));
  INSERT INTO ai_accounting_decision_draft_evidence(ai_accounting_decision_draft_evidence_id,tenant_id,entity_id,ai_accounting_decision_id,ai_accounting_human_decision_id,journal_entry_id,decision_hash,acceptance_hash,evidence_hash,created_by) VALUES(evidence_id,p_tenant,p_entity,p_decision,h.ai_accounting_human_decision_id,journal_id,d.decision_hash,h.evidence_hash,evidence_hash,actor);
  INSERT INTO source_link(tenant_id,entity_id,link_type,source_document_id,journal_entry_id,created_by) VALUES(p_tenant,p_entity,'AI_ACCOUNTING_DECISION_SOURCE',d.source_document_id,journal_id,actor);
  event_payload:=jsonb_build_object('schema_version','AI_ACCOUNTING_DECISION_DRAFT_V1','ai_accounting_decision_draft_evidence_id',evidence_id,'ai_accounting_decision_id',p_decision,'ai_accounting_human_decision_id',h.ai_accounting_human_decision_id,'journal_entry_id',journal_id,'status','DRAFT','can_review',false,'can_approve',false,'can_post',false);
  INSERT INTO audit_event(tenant_id,entity_id,event_type,object_type,object_id,action,actor_id,actor_type,permission_used,request_id,correlation_id,idempotency_key,after_hash,reason,metadata) VALUES(p_tenant,p_entity,'AI_ACCOUNTING_DECISION_DRAFT_CREATED','JOURNAL_ENTRY',journal_id,'CREATE_DRAFT',actor,'USER','GL.JE.CREATE',p_idempotency_key,p_idempotency_key,p_idempotency_key,evidence_hash,btrim(p_reason),event_payload);
  INSERT INTO outbox_event(tenant_id,entity_id,aggregate_type,aggregate_id,event_type,payload,payload_hash) VALUES(p_tenant,p_entity,'AI_ACCOUNTING_DECISION_DRAFT_EVIDENCE',evidence_id,'AI_ACCOUNTING_DECISION_DRAFT_CREATED',event_payload,refs_jsonb_hash(event_payload));
  response:=create_result||event_payload||jsonb_build_object('idempotent',false); UPDATE idempotency_receipt SET status='SUCCEEDED',response_status=201,response_body=response,completed_at=clock_timestamp() WHERE tenant_id=p_tenant AND operation_scope='AI_ACCOUNTING_DECISION_DRAFT:'||p_entity AND idempotency_key=p_idempotency_key; RETURN response;
END $$;

REVOKE ALL ON ai_accounting_decision,ai_accounting_human_decision,ai_accounting_decision_draft_evidence FROM PUBLIC,refs_app;
REVOKE EXECUTE ON FUNCTION refs_retain_ai_accounting_decision(uuid,uuid,jsonb,text,text),refs_human_decide_ai_accounting(uuid,uuid,uuid,text,bigint,text,text,text,text),refs_create_ai_accounting_decision_draft(uuid,uuid,uuid,text,text,text,text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION refs_retain_ai_accounting_decision(uuid,uuid,jsonb,text,text),refs_human_decide_ai_accounting(uuid,uuid,uuid,text,bigint,text,text,text,text),refs_create_ai_accounting_decision_draft(uuid,uuid,uuid,text,text,text,text,text) TO refs_app;
COMMIT;
