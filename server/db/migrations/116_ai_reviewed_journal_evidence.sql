BEGIN;

-- A reviewed AI recommendation is not itself an accounting command.  The
-- review evidence is recorded by a separate human actor, then a different
-- journal maker may bind it to one ordinary Draft JE.  Both records are
-- append-only so an AI suggestion can never silently become a posted entry.
INSERT INTO permission_catalog(permission_code,domain,risk_class,sod_class) VALUES
  ('AI.REVIEW','AI','HIGH','AI_JOURNAL_REVIEWER')
ON CONFLICT(permission_code) DO UPDATE SET
  active=true,domain=EXCLUDED.domain,risk_class=EXCLUDED.risk_class,
  sod_class=EXCLUDED.sod_class,version=permission_catalog.version+1,effective_to=NULL;

CREATE TABLE ai_journal_review_evidence (
  ai_journal_review_evidence_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant(tenant_id),
  entity_id uuid NOT NULL,
  proposal_id text NOT NULL CHECK(length(btrim(proposal_id)) BETWEEN 8 AND 200),
  finding_id text NOT NULL CHECK(length(btrim(finding_id)) BETWEEN 8 AND 240),
  review_outcome_id text NOT NULL CHECK(length(btrim(review_outcome_id)) BETWEEN 8 AND 200),
  proposal_hash text NOT NULL CHECK(proposal_hash~'^sha256:[0-9a-f]{64}$'),
  reviewed_by text NOT NULL CHECK(length(btrim(reviewed_by)) BETWEEN 2 AND 128),
  reviewed_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE(tenant_id,entity_id,ai_journal_review_evidence_id),
  UNIQUE(tenant_id,entity_id,proposal_id),
  UNIQUE(tenant_id,entity_id,review_outcome_id),
  FOREIGN KEY(tenant_id,entity_id) REFERENCES entity(tenant_id,entity_id)
);

CREATE TABLE ai_journal_review_link (
  ai_journal_review_evidence_id uuid PRIMARY KEY REFERENCES ai_journal_review_evidence(ai_journal_review_evidence_id),
  tenant_id uuid NOT NULL,
  entity_id uuid NOT NULL,
  journal_entry_id uuid NOT NULL,
  linked_by text NOT NULL CHECK(length(btrim(linked_by)) BETWEEN 2 AND 128),
  linked_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE(tenant_id,entity_id,journal_entry_id),
  FOREIGN KEY(tenant_id,entity_id) REFERENCES entity(tenant_id,entity_id),
  FOREIGN KEY(tenant_id,entity_id,journal_entry_id) REFERENCES journal_entry(tenant_id,entity_id,journal_entry_id)
);

ALTER TABLE ai_journal_review_evidence ENABLE ROW LEVEL SECURITY;
ALTER TABLE ai_journal_review_link ENABLE ROW LEVEL SECURITY;
CREATE POLICY ai_journal_review_evidence_scope ON ai_journal_review_evidence
  USING(tenant_id=refs_current_tenant() AND refs_entity_allowed(entity_id))
  WITH CHECK(tenant_id=refs_current_tenant() AND refs_entity_allowed(entity_id));
CREATE POLICY ai_journal_review_link_scope ON ai_journal_review_link
  USING(tenant_id=refs_current_tenant() AND refs_entity_allowed(entity_id))
  WITH CHECK(tenant_id=refs_current_tenant() AND refs_entity_allowed(entity_id));
CREATE TRIGGER ai_journal_review_evidence_append_only BEFORE UPDATE OR DELETE ON ai_journal_review_evidence
  FOR EACH ROW EXECUTE FUNCTION reject_mutation();
CREATE TRIGGER ai_journal_review_link_append_only BEFORE UPDATE OR DELETE ON ai_journal_review_link
  FOR EACH ROW EXECUTE FUNCTION reject_mutation();

CREATE FUNCTION refs_record_ai_journal_review_evidence_hash(
  p_tenant uuid,p_entity uuid,p_proposal_id text,p_finding_id text,p_review_outcome_id text,p_proposal_hash text,p_reviewed_at timestamptz
) RETURNS text LANGUAGE sql IMMUTABLE SET search_path=pg_catalog,public,pg_temp AS $$
  SELECT refs_jsonb_hash(jsonb_build_object('tenant_id',p_tenant,'entity_id',p_entity,'proposal_id',btrim(p_proposal_id),
    'finding_id',btrim(p_finding_id),'review_outcome_id',btrim(p_review_outcome_id),'proposal_hash',p_proposal_hash,'reviewed_at',p_reviewed_at))
$$;

CREATE FUNCTION refs_record_ai_journal_review_evidence(
  p_tenant uuid,p_entity uuid,p_proposal_id text,p_finding_id text,p_review_outcome_id text,p_proposal_hash text,p_reviewed_at timestamptz,
  p_idempotency_key text,p_request_hash text
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE actor text:=refs_current_actor(); evidence_id uuid:=gen_random_uuid(); computed_hash text; receipt idempotency_receipt; response jsonb;
BEGIN
  PERFORM refs_assert_scope(p_tenant,p_entity,'AI.REVIEW');
  IF actor IS NULL THEN RAISE EXCEPTION 'Authenticated reviewer missing' USING ERRCODE='42501'; END IF;
  computed_hash:=refs_record_ai_journal_review_evidence_hash(p_tenant,p_entity,p_proposal_id,p_finding_id,p_review_outcome_id,p_proposal_hash,p_reviewed_at);
  IF p_request_hash<>computed_hash THEN RAISE EXCEPTION 'AI review evidence request hash is not canonical' USING ERRCODE='22023'; END IF;
  receipt:=refs_reserve_idempotency(p_tenant,'JOURNAL_REVIEW:'||p_entity,p_idempotency_key,p_request_hash,actor);
  IF receipt.status='SUCCEEDED' THEN RETURN receipt.response_body||jsonb_build_object('idempotent',true); END IF;
  IF p_proposal_hash !~ '^sha256:[0-9a-f]{64}$' OR p_reviewed_at IS NULL THEN RAISE EXCEPTION 'AI review requires one retained proposal hash and review timestamp' USING ERRCODE='22023'; END IF;
  INSERT INTO ai_journal_review_evidence(ai_journal_review_evidence_id,tenant_id,entity_id,proposal_id,finding_id,review_outcome_id,proposal_hash,reviewed_by,reviewed_at)
  VALUES(evidence_id,p_tenant,p_entity,btrim(p_proposal_id),btrim(p_finding_id),btrim(p_review_outcome_id),p_proposal_hash,actor,p_reviewed_at);
  response:=jsonb_build_object('ai_journal_review_evidence_id',evidence_id,'status','APPROVED_FOR_DRAFT','idempotent',false);
  INSERT INTO audit_event(tenant_id,entity_id,event_type,object_type,object_id,action,actor_id,actor_type,permission_used,request_id,correlation_id,idempotency_key,after_hash,metadata)
  VALUES(p_tenant,p_entity,'AI_JOURNAL_REVIEW_RECORDED','AI_JOURNAL_REVIEW',evidence_id,'REVIEW',actor,'USER','AI.REVIEW',p_idempotency_key,p_idempotency_key,p_idempotency_key,p_request_hash,response);
  INSERT INTO outbox_event(tenant_id,entity_id,aggregate_type,aggregate_id,event_type,payload,payload_hash)
  VALUES(p_tenant,p_entity,'AI_JOURNAL_REVIEW',evidence_id,'AI_JOURNAL_REVIEW_RECORDED',response,refs_jsonb_hash(response));
  UPDATE idempotency_receipt SET status='SUCCEEDED',response_status=201,response_body=response,completed_at=clock_timestamp()
    WHERE tenant_id=p_tenant AND operation_scope='AI_JOURNAL_REVIEW:'||p_entity AND idempotency_key=p_idempotency_key;
  RETURN response;
END;
$$;

CREATE FUNCTION refs_link_ai_reviewed_journal(
  p_tenant uuid,p_entity uuid,p_evidence_id uuid,p_journal_id uuid,p_idempotency_key text,p_request_hash text
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE actor text:=refs_current_actor(); evidence ai_journal_review_evidence; journal journal_entry; computed_hash text; receipt idempotency_receipt; response jsonb;
BEGIN
  PERFORM refs_assert_scope(p_tenant,p_entity,'GL.JE.CREATE');
  IF actor IS NULL THEN RAISE EXCEPTION 'Authenticated journal maker missing' USING ERRCODE='42501'; END IF;
  computed_hash:=refs_jsonb_hash(jsonb_build_object('tenant_id',p_tenant,'entity_id',p_entity,'ai_journal_review_evidence_id',p_evidence_id,'journal_entry_id',p_journal_id));
  IF p_request_hash<>computed_hash THEN RAISE EXCEPTION 'AI journal link request hash is not canonical' USING ERRCODE='22023'; END IF;
  receipt:=refs_reserve_idempotency(p_tenant,'CREATE_MANUAL_JOURNAL:'||p_entity,p_idempotency_key,p_request_hash,actor);
  IF receipt.status='SUCCEEDED' THEN RETURN receipt.response_body||jsonb_build_object('idempotent',true); END IF;
  SELECT * INTO evidence FROM ai_journal_review_evidence WHERE tenant_id=p_tenant AND entity_id=p_entity AND ai_journal_review_evidence_id=p_evidence_id FOR SHARE;
  IF NOT FOUND OR evidence.reviewed_by=actor THEN RAISE EXCEPTION 'AI Draft requires separate retained human review evidence' USING ERRCODE='42501'; END IF;
  SELECT * INTO journal FROM journal_entry WHERE tenant_id=p_tenant AND entity_id=p_entity AND journal_entry_id=p_journal_id FOR SHARE;
  IF NOT FOUND OR journal.status<>'DRAFT' OR journal.created_by<>actor THEN RAISE EXCEPTION 'AI evidence can link only to this maker''s Draft journal' USING ERRCODE='23514'; END IF;
  INSERT INTO ai_journal_review_link(ai_journal_review_evidence_id,tenant_id,entity_id,journal_entry_id,linked_by)
  VALUES(p_evidence_id,p_tenant,p_entity,p_journal_id,actor);
  response:=jsonb_build_object('ai_journal_review_evidence_id',p_evidence_id,'journal_entry_id',p_journal_id,'status','DRAFT_LINKED','idempotent',false);
  INSERT INTO audit_event(tenant_id,entity_id,event_type,object_type,object_id,action,actor_id,actor_type,permission_used,request_id,correlation_id,idempotency_key,after_hash,metadata)
  VALUES(p_tenant,p_entity,'AI_JOURNAL_REVIEW_LINKED','JOURNAL_ENTRY',p_journal_id,'LINK_AI_REVIEW',actor,'USER','GL.JE.CREATE',p_idempotency_key,p_idempotency_key,p_idempotency_key,p_request_hash,response);
  UPDATE idempotency_receipt SET status='SUCCEEDED',response_status=201,response_body=response,completed_at=clock_timestamp()
    WHERE tenant_id=p_tenant AND operation_scope='LINK_AI_JOURNAL:'||p_entity AND idempotency_key=p_idempotency_key;
  RETURN response;
END;
$$;

REVOKE ALL ON ai_journal_review_evidence,ai_journal_review_link FROM PUBLIC,refs_app;
REVOKE ALL ON FUNCTION refs_record_ai_journal_review_evidence_hash(uuid,uuid,text,text,text,text,timestamptz) FROM PUBLIC;
REVOKE ALL ON FUNCTION refs_record_ai_journal_review_evidence(uuid,uuid,text,text,text,text,timestamptz,text,text) FROM PUBLIC;
REVOKE ALL ON FUNCTION refs_link_ai_reviewed_journal(uuid,uuid,uuid,uuid,text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION refs_record_ai_journal_review_evidence_hash(uuid,uuid,text,text,text,text,timestamptz) TO refs_app;
GRANT EXECUTE ON FUNCTION refs_record_ai_journal_review_evidence(uuid,uuid,text,text,text,text,timestamptz,text,text) TO refs_app;
GRANT EXECUTE ON FUNCTION refs_link_ai_reviewed_journal(uuid,uuid,uuid,uuid,text,text) TO refs_app;

COMMIT;
