BEGIN;

-- AI may prepare a deterministic, evidence-bound proposal.  It may never
-- create a journal, change a staging state, approve, or post.
INSERT INTO permission_catalog(permission_code,domain,risk_class,sod_class)
  VALUES('AI.PROPOSAL.CREATE','AI','HIGH','AI_PROPOSAL_SERVICE')
  ON CONFLICT (permission_code) DO NOTHING;

CREATE TABLE ai_wbs_payable_draft_proposal (
  ai_wbs_payable_draft_proposal_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  entity_id uuid NOT NULL,
  wbs_payable_review_evidence_id uuid NOT NULL,
  source_document_id uuid NOT NULL,
  staging_item_id uuid NOT NULL,
  mapping_snapshot_id uuid NOT NULL,
  model_id text NOT NULL CHECK(length(btrim(model_id)) BETWEEN 3 AND 128),
  prompt_version text NOT NULL CHECK(length(btrim(prompt_version)) BETWEEN 3 AND 128),
  proposal_lines jsonb NOT NULL CHECK(jsonb_typeof(proposal_lines)='array' AND jsonb_array_length(proposal_lines)=2),
  proposal_hash text NOT NULL CHECK(proposal_hash~'^sha256:[0-9a-f]{64}$'),
  request_hash text NOT NULL CHECK(request_hash~'^sha256:[0-9a-f]{64}$'),
  created_by text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE(tenant_id,entity_id,ai_wbs_payable_draft_proposal_id),
  UNIQUE(tenant_id,entity_id,wbs_payable_review_evidence_id,model_id,prompt_version),
  UNIQUE(tenant_id,entity_id,proposal_hash),
  FOREIGN KEY(tenant_id,entity_id) REFERENCES entity(tenant_id,entity_id),
  FOREIGN KEY(tenant_id,entity_id,wbs_payable_review_evidence_id)
    REFERENCES wbs_payable_review_evidence(tenant_id,entity_id,wbs_payable_review_evidence_id),
  FOREIGN KEY(tenant_id,entity_id,source_document_id)
    REFERENCES source_document(tenant_id,entity_id,source_document_id),
  FOREIGN KEY(tenant_id,entity_id,staging_item_id)
    REFERENCES staging_item(tenant_id,entity_id,staging_item_id),
  FOREIGN KEY(tenant_id,mapping_snapshot_id)
    REFERENCES mapping_snapshot(tenant_id,mapping_snapshot_id)
);

CREATE TABLE ai_wbs_payable_draft_proposal_review (
  ai_wbs_payable_draft_proposal_review_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  entity_id uuid NOT NULL,
  ai_wbs_payable_draft_proposal_id uuid NOT NULL,
  decision text NOT NULL CHECK(decision IN ('ACCEPTED','REJECTED')),
  decision_reason text NOT NULL CHECK(length(btrim(decision_reason)) BETWEEN 8 AND 2000),
  request_hash text NOT NULL CHECK(request_hash~'^sha256:[0-9a-f]{64}$'),
  reviewed_by text NOT NULL,
  reviewed_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE(tenant_id,entity_id,ai_wbs_payable_draft_proposal_id),
  UNIQUE(tenant_id,entity_id,ai_wbs_payable_draft_proposal_review_id),
  FOREIGN KEY(tenant_id,entity_id) REFERENCES entity(tenant_id,entity_id),
  FOREIGN KEY(tenant_id,entity_id,ai_wbs_payable_draft_proposal_id)
    REFERENCES ai_wbs_payable_draft_proposal(tenant_id,entity_id,ai_wbs_payable_draft_proposal_id)
);

ALTER TABLE ai_wbs_payable_draft_proposal ENABLE ROW LEVEL SECURITY;
ALTER TABLE ai_wbs_payable_draft_proposal_review ENABLE ROW LEVEL SECURITY;
CREATE POLICY ai_wbs_payable_draft_proposal_scope ON ai_wbs_payable_draft_proposal
  USING(tenant_id=refs_current_tenant() AND refs_entity_allowed(entity_id))
  WITH CHECK(tenant_id=refs_current_tenant() AND refs_entity_allowed(entity_id));
CREATE POLICY ai_wbs_payable_draft_proposal_review_scope ON ai_wbs_payable_draft_proposal_review
  USING(tenant_id=refs_current_tenant() AND refs_entity_allowed(entity_id))
  WITH CHECK(tenant_id=refs_current_tenant() AND refs_entity_allowed(entity_id));
CREATE TRIGGER ai_wbs_payable_draft_proposal_append_only BEFORE UPDATE OR DELETE ON ai_wbs_payable_draft_proposal
  FOR EACH ROW EXECUTE FUNCTION reject_mutation();
CREATE TRIGGER ai_wbs_payable_draft_proposal_review_append_only BEFORE UPDATE OR DELETE ON ai_wbs_payable_draft_proposal_review
  FOR EACH ROW EXECUTE FUNCTION reject_mutation();

CREATE FUNCTION refs_ai_wbs_payable_draft_proposal_hash(
  p_tenant uuid,p_entity uuid,p_review uuid,p_model text,p_prompt text
) RETURNS text LANGUAGE sql IMMUTABLE SET search_path=pg_catalog,public,pg_temp AS $$
  SELECT refs_jsonb_hash(jsonb_build_object(
    'tenant_id',p_tenant,'entity_id',p_entity,'wbs_payable_review_evidence_id',p_review,
    'model_id',btrim(p_model),'prompt_version',btrim(p_prompt)
  ))
$$;

CREATE FUNCTION refs_propose_ai_wbs_payable_draft(
  p_tenant uuid,p_entity uuid,p_review uuid,p_model text,p_prompt text,
  p_idempotency_key text,p_request_hash text
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE actor text:=refs_current_actor(); idem idempotency_receipt; evidence wbs_payable_review_evidence;
DECLARE evaluation rule_evaluation; source source_document; staging staging_item; proposal_id uuid:=gen_random_uuid();
DECLARE lines jsonb; proposal_hash text; response jsonb; payload jsonb;
BEGIN
  PERFORM refs_assert_scope(p_tenant,p_entity,'AI.PROPOSAL.CREATE');
  IF actor IS NULL THEN RAISE EXCEPTION 'Authenticated AI proposal service missing' USING ERRCODE='42501'; END IF;
  IF p_request_hash<>refs_ai_wbs_payable_draft_proposal_hash(p_tenant,p_entity,p_review,p_model,p_prompt)
     OR length(btrim(COALESCE(p_model,''))) NOT BETWEEN 3 AND 128
     OR length(btrim(COALESCE(p_prompt,''))) NOT BETWEEN 3 AND 128 THEN
    RAISE EXCEPTION 'AI payable proposal request is not canonical' USING ERRCODE='22023';
  END IF;
  INSERT INTO idempotency_receipt(tenant_id,operation_scope,idempotency_key,request_hash,status,actor_id)
    VALUES(p_tenant,'AI_WBS_PAYABLE_DRAFT_PROPOSAL:'||p_entity,p_idempotency_key,p_request_hash,'IN_PROGRESS',actor)
    ON CONFLICT(tenant_id,operation_scope,idempotency_key) DO NOTHING;
  SELECT * INTO idem FROM idempotency_receipt WHERE tenant_id=p_tenant
    AND operation_scope='AI_WBS_PAYABLE_DRAFT_PROPOSAL:'||p_entity AND idempotency_key=p_idempotency_key FOR UPDATE;
  IF idem.request_hash<>p_request_hash THEN RAISE EXCEPTION 'Idempotency key reused with a different AI payable proposal' USING ERRCODE='23505'; END IF;
  IF idem.status='SUCCEEDED' THEN RETURN idem.response_body||jsonb_build_object('idempotent',true); END IF;
  SELECT * INTO evidence FROM wbs_payable_review_evidence WHERE tenant_id=p_tenant AND entity_id=p_entity
    AND wbs_payable_review_evidence_id=p_review FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Reviewed WBS Payable evidence not found' USING ERRCODE='P0002'; END IF;
  SELECT * INTO evaluation FROM rule_evaluation WHERE tenant_id=p_tenant AND rule_evaluation_id=evidence.rule_evaluation_id FOR SHARE;
  SELECT * INTO source FROM source_document WHERE tenant_id=p_tenant AND entity_id=p_entity AND source_document_id=evidence.source_document_id FOR SHARE;
  SELECT * INTO staging FROM staging_item WHERE tenant_id=p_tenant AND entity_id=p_entity AND staging_item_id=evidence.staging_item_id FOR SHARE;
  IF evaluation.rule_evaluation_id IS NULL OR source.source_document_id IS NULL OR staging.staging_item_id IS NULL
     OR source.status<>'READY_FOR_DRAFT' OR staging.status<>'READY_FOR_DRAFT'
     OR evaluation.mapping_snapshot_id<>evidence.mapping_snapshot_id
     OR COALESCE(evaluation.result->>'gross_amount','') !~ '^(0|[1-9][0-9]*)(\.[0-9]{4})$'
     OR COALESCE(evaluation.result->>'offset_account_code','')='' OR source.currency<>COALESCE(evaluation.result->>'currency','') THEN
    RAISE EXCEPTION 'AI payable proposal requires unchanged reviewed evidence' USING ERRCODE='23514';
  END IF;
  lines:=jsonb_build_array(
    jsonb_build_object('line_no',1,'account_code',evaluation.result->>'offset_account_code','debit_amount',evaluation.result->>'gross_amount','credit_amount','0.0000','source','REVIEWED_MAPPING'),
    jsonb_build_object('line_no',2,'account_code','291001','debit_amount','0.0000','credit_amount',evaluation.result->>'gross_amount','source','REVIEWED_MAPPING')
  );
  proposal_hash:=refs_jsonb_hash(jsonb_build_object('schema_version','AI_WBS_PAYABLE_DRAFT_PROPOSAL_V1',
    'wbs_payable_review_evidence_id',p_review,'source_document_id',evidence.source_document_id,
    'mapping_snapshot_id',evidence.mapping_snapshot_id,'model_id',btrim(p_model),'prompt_version',btrim(p_prompt),'proposal_lines',lines));
  INSERT INTO ai_wbs_payable_draft_proposal(ai_wbs_payable_draft_proposal_id,tenant_id,entity_id,wbs_payable_review_evidence_id,
    source_document_id,staging_item_id,mapping_snapshot_id,model_id,prompt_version,proposal_lines,proposal_hash,request_hash,created_by)
  VALUES(proposal_id,p_tenant,p_entity,p_review,evidence.source_document_id,evidence.staging_item_id,evidence.mapping_snapshot_id,
    btrim(p_model),btrim(p_prompt),lines,proposal_hash,p_request_hash,actor);
  payload:=jsonb_build_object('schema_version','AI_WBS_PAYABLE_DRAFT_PROPOSAL_V1','ai_wbs_payable_draft_proposal_id',proposal_id,
    'wbs_payable_review_evidence_id',p_review,'source_document_id',evidence.source_document_id,'staging_item_id',evidence.staging_item_id,
    'proposal_hash',proposal_hash,'status','PENDING_HUMAN_REVIEW','can_create_draft',false,'can_submit',false,'can_review',false,'can_approve',false,'can_post',false);
  INSERT INTO audit_event(tenant_id,entity_id,event_type,object_type,object_id,action,actor_id,actor_type,permission_used,request_id,correlation_id,idempotency_key,after_hash,metadata)
    VALUES(p_tenant,p_entity,'AI_WBS_PAYABLE_DRAFT_PROPOSED','AI_WBS_PAYABLE_DRAFT_PROPOSAL',proposal_id,'PROPOSE',actor,'SERVICE_ACCOUNT','AI.PROPOSAL.CREATE',p_idempotency_key,p_idempotency_key,p_idempotency_key,proposal_hash,payload);
  INSERT INTO outbox_event(tenant_id,entity_id,aggregate_type,aggregate_id,event_type,payload,payload_hash)
    VALUES(p_tenant,p_entity,'AI_WBS_PAYABLE_DRAFT_PROPOSAL',proposal_id,'AI_WBS_PAYABLE_DRAFT_PROPOSED',payload,refs_jsonb_hash(payload));
  response:=payload||jsonb_build_object('idempotent',false);
  UPDATE idempotency_receipt SET status='SUCCEEDED',response_status=201,response_body=response,completed_at=clock_timestamp() WHERE idempotency_receipt_id=idem.idempotency_receipt_id;
  RETURN response;
END;
$$;

CREATE FUNCTION refs_review_ai_wbs_payable_draft_proposal_hash(p_tenant uuid,p_entity uuid,p_proposal uuid,p_decision text,p_reason text) RETURNS text
LANGUAGE sql IMMUTABLE SET search_path=pg_catalog,public,pg_temp AS $$
  SELECT refs_jsonb_hash(jsonb_build_object('tenant_id',p_tenant,'entity_id',p_entity,'ai_wbs_payable_draft_proposal_id',p_proposal,'decision',p_decision,'reason',btrim(p_reason)))
$$;

CREATE FUNCTION refs_review_ai_wbs_payable_draft_proposal(
  p_tenant uuid,p_entity uuid,p_proposal uuid,p_decision text,p_reason text,p_idempotency_key text,p_request_hash text
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE actor text:=refs_current_actor(); idem idempotency_receipt; proposal ai_wbs_payable_draft_proposal;
DECLARE evidence wbs_payable_review_evidence; review_id uuid:=gen_random_uuid(); response jsonb; payload jsonb;
BEGIN
  PERFORM refs_assert_scope(p_tenant,p_entity,'AP.BILL.CREATE');
  IF actor IS NULL THEN RAISE EXCEPTION 'Authenticated AP Bill maker missing' USING ERRCODE='42501'; END IF;
  IF p_decision NOT IN ('ACCEPTED','REJECTED') OR length(btrim(COALESCE(p_reason,''))) NOT BETWEEN 8 AND 2000
     OR p_request_hash<>refs_review_ai_wbs_payable_draft_proposal_hash(p_tenant,p_entity,p_proposal,p_decision,p_reason) THEN
    RAISE EXCEPTION 'AI payable proposal review is not canonical' USING ERRCODE='22023';
  END IF;
  INSERT INTO idempotency_receipt(tenant_id,operation_scope,idempotency_key,request_hash,status,actor_id)
    VALUES(p_tenant,'REVIEW_AI_WBS_PAYABLE_DRAFT_PROPOSAL:'||p_entity,p_idempotency_key,p_request_hash,'IN_PROGRESS',actor)
    ON CONFLICT(tenant_id,operation_scope,idempotency_key) DO NOTHING;
  SELECT * INTO idem FROM idempotency_receipt WHERE tenant_id=p_tenant AND operation_scope='REVIEW_AI_WBS_PAYABLE_DRAFT_PROPOSAL:'||p_entity AND idempotency_key=p_idempotency_key FOR UPDATE;
  IF idem.request_hash<>p_request_hash THEN RAISE EXCEPTION 'Idempotency key reused with a different AI proposal review' USING ERRCODE='23505'; END IF;
  IF idem.status='SUCCEEDED' THEN RETURN idem.response_body||jsonb_build_object('idempotent',true); END IF;
  SELECT * INTO proposal FROM ai_wbs_payable_draft_proposal WHERE tenant_id=p_tenant AND entity_id=p_entity AND ai_wbs_payable_draft_proposal_id=p_proposal FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'AI payable proposal not found' USING ERRCODE='P0002'; END IF;
  SELECT * INTO evidence FROM wbs_payable_review_evidence WHERE tenant_id=p_tenant AND entity_id=p_entity AND wbs_payable_review_evidence_id=proposal.wbs_payable_review_evidence_id FOR SHARE;
  IF NOT FOUND OR actor=evidence.reviewed_by THEN RAISE EXCEPTION 'AI payable proposal maker and evidence reviewer must be different actors' USING ERRCODE='42501'; END IF;
  IF EXISTS(SELECT 1 FROM ai_wbs_payable_draft_proposal_review WHERE tenant_id=p_tenant AND entity_id=p_entity AND ai_wbs_payable_draft_proposal_id=p_proposal) THEN RAISE EXCEPTION 'AI payable proposal was already reviewed' USING ERRCODE='23505'; END IF;
  INSERT INTO ai_wbs_payable_draft_proposal_review(ai_wbs_payable_draft_proposal_review_id,tenant_id,entity_id,ai_wbs_payable_draft_proposal_id,decision,decision_reason,request_hash,reviewed_by)
    VALUES(review_id,p_tenant,p_entity,p_proposal,p_decision,btrim(p_reason),p_request_hash,actor);
  payload:=jsonb_build_object('schema_version','AI_WBS_PAYABLE_DRAFT_PROPOSAL_REVIEW_V1','ai_wbs_payable_draft_proposal_review_id',review_id,
    'ai_wbs_payable_draft_proposal_id',p_proposal,'wbs_payable_review_evidence_id',proposal.wbs_payable_review_evidence_id,'decision',p_decision,
    'can_create_draft',false,'can_submit',false,'can_review',false,'can_approve',false,'can_post',false);
  INSERT INTO audit_event(tenant_id,entity_id,event_type,object_type,object_id,action,actor_id,actor_type,permission_used,request_id,correlation_id,idempotency_key,after_hash,reason,metadata)
    VALUES(p_tenant,p_entity,'AI_WBS_PAYABLE_DRAFT_PROPOSAL_REVIEWED','AI_WBS_PAYABLE_DRAFT_PROPOSAL',p_proposal,'REVIEW',actor,'USER','AP.BILL.CREATE',p_idempotency_key,p_idempotency_key,p_idempotency_key,p_request_hash,btrim(p_reason),payload);
  INSERT INTO outbox_event(tenant_id,entity_id,aggregate_type,aggregate_id,event_type,payload,payload_hash)
    VALUES(p_tenant,p_entity,'AI_WBS_PAYABLE_DRAFT_PROPOSAL',p_proposal,'AI_WBS_PAYABLE_DRAFT_PROPOSAL_REVIEWED',payload,refs_jsonb_hash(payload));
  response:=payload||jsonb_build_object('idempotent',false);
  UPDATE idempotency_receipt SET status='SUCCEEDED',response_status=201,response_body=response,completed_at=clock_timestamp() WHERE idempotency_receipt_id=idem.idempotency_receipt_id;
  RETURN response;
END;
$$;

CREATE FUNCTION refs_read_ai_wbs_payable_draft_proposals(p_tenant uuid,p_entity uuid,p_limit integer DEFAULT 50)
RETURNS TABLE(ai_wbs_payable_draft_proposal_id uuid,wbs_payable_review_evidence_id uuid,source_document_id uuid,staging_item_id uuid,
  mapping_snapshot_id uuid,model_id text,prompt_version text,proposal_lines jsonb,proposal_hash text,created_at timestamptz,
  decision text,decision_reason text,reviewed_by text,reviewed_at timestamptz,
  can_create_draft boolean,can_submit boolean,can_review boolean,can_approve boolean,can_post boolean)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
BEGIN
  PERFORM refs_assert_scope(p_tenant,p_entity,'AP.BILL.CREATE');
  IF p_limit IS NULL OR p_limit<1 OR p_limit>100 THEN RAISE EXCEPTION 'AI payable proposal limit must be between 1 and 100' USING ERRCODE='22023'; END IF;
  RETURN QUERY SELECT p.ai_wbs_payable_draft_proposal_id,p.wbs_payable_review_evidence_id,p.source_document_id,p.staging_item_id,
    p.mapping_snapshot_id,p.model_id,p.prompt_version,p.proposal_lines,p.proposal_hash,p.created_at,r.decision,r.decision_reason,
    r.reviewed_by,r.reviewed_at,false,false,false,false,false
  FROM ai_wbs_payable_draft_proposal p
  LEFT JOIN ai_wbs_payable_draft_proposal_review r ON r.tenant_id=p.tenant_id AND r.entity_id=p.entity_id
    AND r.ai_wbs_payable_draft_proposal_id=p.ai_wbs_payable_draft_proposal_id
  WHERE p.tenant_id=p_tenant AND p.entity_id=p_entity
  ORDER BY p.created_at DESC,p.ai_wbs_payable_draft_proposal_id DESC LIMIT p_limit;
END;
$$;

REVOKE ALL ON ai_wbs_payable_draft_proposal,ai_wbs_payable_draft_proposal_review FROM PUBLIC,refs_app;
GRANT SELECT ON ai_wbs_payable_draft_proposal,ai_wbs_payable_draft_proposal_review TO refs_app;
REVOKE EXECUTE ON FUNCTION refs_ai_wbs_payable_draft_proposal_hash(uuid,uuid,uuid,text,text),refs_propose_ai_wbs_payable_draft(uuid,uuid,uuid,text,text,text,text),refs_review_ai_wbs_payable_draft_proposal_hash(uuid,uuid,uuid,text,text),refs_review_ai_wbs_payable_draft_proposal(uuid,uuid,uuid,text,text,text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION refs_ai_wbs_payable_draft_proposal_hash(uuid,uuid,uuid,text,text),refs_propose_ai_wbs_payable_draft(uuid,uuid,uuid,text,text,text,text),refs_review_ai_wbs_payable_draft_proposal_hash(uuid,uuid,uuid,text,text),refs_review_ai_wbs_payable_draft_proposal(uuid,uuid,uuid,text,text,text,text) TO refs_app;
REVOKE ALL ON FUNCTION refs_read_ai_wbs_payable_draft_proposals(uuid,uuid,integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION refs_read_ai_wbs_payable_draft_proposals(uuid,uuid,integer) TO refs_app;

COMMIT;
