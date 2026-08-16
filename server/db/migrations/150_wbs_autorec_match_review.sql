BEGIN;

INSERT INTO permission_catalog(permission_code,domain,risk_class,sod_class)
VALUES ('BANK.MATCH.REVIEW','BANK','HIGH','BANK_MATCH_REVIEWER')
ON CONFLICT (permission_code) DO UPDATE
  SET active=true,domain=EXCLUDED.domain,risk_class=EXCLUDED.risk_class,
      sod_class=EXCLUDED.sod_class,version=permission_catalog.version+1,effective_to=NULL;

-- This is the independent human decision over one already-persisted AutoRec
-- candidate and one exact Bank Match.  It deliberately does not represent a
-- G11 link, an INCUR event, or authority to create/post a journal.
CREATE TABLE wbs_autorec_match_review (
  wbs_autorec_match_review_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant(tenant_id),
  entity_id uuid NOT NULL,
  review_candidate_id text NOT NULL CHECK(review_candidate_id ~ '^sha256:[0-9a-f]{64}$'),
  candidate_hash text NOT NULL CHECK(candidate_hash ~ '^sha256:[0-9a-f]{64}$'),
  candidate_execution_receipt_id uuid NOT NULL REFERENCES wbs_autorec_execution_event(execution_receipt_id),
  candidate_execution_version integer NOT NULL CHECK(candidate_execution_version >= 1),
  candidate_prepared_by text NOT NULL,
  bank_match_id uuid NOT NULL,
  bank_match_revision bigint NOT NULL CHECK(bank_match_revision >= 0),
  matched_by text NOT NULL,
  evidence_hash text NOT NULL CHECK(evidence_hash ~ '^sha256:[0-9a-f]{64}$'),
  decision text NOT NULL CHECK(decision IN ('ACCEPTED','REJECTED')),
  decision_reason text NOT NULL CHECK(length(btrim(decision_reason)) BETWEEN 8 AND 2000),
  reviewed_by text NOT NULL,
  reviewed_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  request_hash text NOT NULL CHECK(request_hash ~ '^sha256:[0-9a-f]{64}$'),
  idempotency_key text NOT NULL,
  CHECK(reviewed_by<>matched_by AND reviewed_by<>candidate_prepared_by),
  UNIQUE(tenant_id,entity_id,review_candidate_id),
  UNIQUE(tenant_id,entity_id,wbs_autorec_match_review_id),
  FOREIGN KEY(tenant_id,entity_id) REFERENCES entity(tenant_id,entity_id),
  FOREIGN KEY(tenant_id,entity_id,bank_match_id) REFERENCES bank_match(tenant_id,entity_id,bank_match_id)
);
CREATE INDEX wbs_autorec_match_review_match_idx
  ON wbs_autorec_match_review(tenant_id,entity_id,bank_match_id);
ALTER TABLE wbs_autorec_match_review ENABLE ROW LEVEL SECURITY;
CREATE POLICY wbs_autorec_match_review_scope ON wbs_autorec_match_review
  USING(tenant_id=refs_current_tenant() AND refs_entity_allowed(entity_id))
  WITH CHECK(tenant_id=refs_current_tenant() AND refs_entity_allowed(entity_id));
CREATE TRIGGER wbs_autorec_match_review_append_only
  BEFORE UPDATE OR DELETE ON wbs_autorec_match_review
  FOR EACH ROW EXECUTE FUNCTION reject_mutation();

CREATE FUNCTION refs_wbs_autorec_match_review_hash(
  p_tenant uuid,p_entity uuid,p_review_candidate text,p_candidate_hash text,
  p_bank_match uuid,p_expected_match_revision bigint,p_decision text,p_reason text
) RETURNS text LANGUAGE sql IMMUTABLE SET search_path=pg_catalog,public,pg_temp AS $$
  SELECT refs_jsonb_hash(jsonb_build_object(
    'tenant_id',p_tenant,'entity_id',p_entity,'review_candidate_id',p_review_candidate,
    'candidate_hash',p_candidate_hash,'bank_match_id',p_bank_match,
    'expected_match_revision',p_expected_match_revision,'decision',upper(p_decision),
    'reason',btrim(p_reason)
  ))
$$;

CREATE FUNCTION refs_review_wbs_autorec_bank_match(
  p_tenant uuid,p_entity uuid,p_review_candidate text,p_candidate_hash text,
  p_bank_match uuid,p_expected_match_revision bigint,p_decision text,p_reason text,
  p_idempotency_key text,p_request_hash text
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE actor text:=refs_current_actor(); receipt idempotency_receipt; match_row bank_match;
DECLARE candidate_event wbs_autorec_execution_event; candidate jsonb; candidate_preparer text;
DECLARE bank_document source_document; business_document source_document;
DECLARE review_id uuid:=gen_random_uuid(); normalized_decision text:=upper(coalesce(p_decision,'')); response jsonb;
BEGIN
  PERFORM refs_assert_scope(p_tenant,p_entity,'BANK.MATCH.REVIEW');
  IF actor IS NULL THEN RAISE EXCEPTION 'Authenticated actor missing' USING ERRCODE='42501'; END IF;
  IF p_request_hash<>refs_wbs_autorec_match_review_hash(p_tenant,p_entity,p_review_candidate,p_candidate_hash,p_bank_match,p_expected_match_revision,p_decision,p_reason) THEN
    RAISE EXCEPTION 'AutoRec Bank Match review request hash is not canonical' USING ERRCODE='22023';
  END IF;
  IF p_review_candidate !~ '^sha256:[0-9a-f]{64}$' OR p_candidate_hash !~ '^sha256:[0-9a-f]{64}$'
     OR p_expected_match_revision IS NULL OR p_expected_match_revision<0
     OR normalized_decision NOT IN ('ACCEPTED','REJECTED')
     OR coalesce(length(btrim(p_reason)),0) NOT BETWEEN 8 AND 2000 THEN
    RAISE EXCEPTION 'AutoRec Bank Match review input is invalid' USING ERRCODE='22023';
  END IF;

  INSERT INTO idempotency_receipt(tenant_id,operation_scope,idempotency_key,request_hash,status,actor_id)
    VALUES(p_tenant,'WBS_AUTOREC_MATCH_REVIEW:'||p_entity,p_idempotency_key,p_request_hash,'IN_PROGRESS',actor)
  ON CONFLICT (tenant_id,operation_scope,idempotency_key) DO NOTHING;
  SELECT * INTO receipt FROM idempotency_receipt
    WHERE tenant_id=p_tenant AND operation_scope='WBS_AUTOREC_MATCH_REVIEW:'||p_entity
      AND idempotency_key=p_idempotency_key FOR UPDATE;
  IF receipt.request_hash<>p_request_hash THEN RAISE EXCEPTION 'Idempotency key reused with a different request' USING ERRCODE='23505'; END IF;
  IF receipt.status='SUCCEEDED' THEN RETURN receipt.response_body||jsonb_build_object('idempotent',true); END IF;

  SELECT * INTO candidate_event FROM wbs_autorec_execution_event e
    WHERE e.tenant_id=p_tenant AND e.entity_id=p_entity AND e.review_candidate_id=p_review_candidate
      AND e.command='RESERVE' AND e.current_state='REVIEW_REQUIRED' AND e.next_state='RESERVED'
    ORDER BY e.version DESC LIMIT 1 FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Persisted reserved AutoRec review candidate was not found in the selected entity' USING ERRCODE='P0002'; END IF;
  candidate:=candidate_event.intent->'review_candidate';
  IF jsonb_typeof(candidate)<>'object' OR candidate->>'review_candidate_id' IS DISTINCT FROM p_review_candidate
     OR refs_jsonb_hash(candidate)<>p_candidate_hash THEN
    RAISE EXCEPTION 'AutoRec review candidate hash or identity changed' USING ERRCODE='40001';
  END IF;
  SELECT a.actor_id INTO candidate_preparer FROM audit_event a
    WHERE a.tenant_id=p_tenant AND a.entity_id=p_entity
      AND a.object_type='WBS_AUTOREC_EXECUTION' AND a.object_id=candidate_event.execution_receipt_id
      AND a.event_type='WBS_AUTOREC_EXECUTION_PERSISTED'
    ORDER BY a.occurred_at,a.audit_event_id LIMIT 1;
  IF candidate_preparer IS NULL THEN RAISE EXCEPTION 'AutoRec candidate preparation audit is missing' USING ERRCODE='23514'; END IF;

  SELECT * INTO match_row FROM bank_match m
    WHERE m.tenant_id=p_tenant AND m.entity_id=p_entity AND m.bank_match_id=p_bank_match FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Bank Match was not found in the selected entity' USING ERRCODE='P0002'; END IF;
  IF match_row.version<>p_expected_match_revision THEN RAISE EXCEPTION 'Bank match version conflict' USING ERRCODE='40001'; END IF;
  IF match_row.status<>'ACTIVE' OR match_row.journal_entry_id IS NULL OR match_row.journal_line_id IS NULL OR match_row.ledger_line_id IS NULL THEN
    RAISE EXCEPTION 'AutoRec review requires one exact ACTIVE Posted Bank Match' USING ERRCODE='23514';
  END IF;
  IF actor IN (match_row.matched_by,candidate_preparer) THEN RAISE EXCEPTION 'AutoRec Bank Match reviewer SoD violation' USING ERRCODE='42501'; END IF;
  SELECT d.* INTO bank_document FROM bank_source b JOIN source_document d
    ON d.tenant_id=b.tenant_id AND d.entity_id=b.entity_id AND d.source_document_id=b.source_document_id
    WHERE b.tenant_id=p_tenant AND b.entity_id=p_entity AND b.bank_source_id=match_row.bank_source_id;
  SELECT * INTO business_document FROM source_document d
    WHERE d.tenant_id=p_tenant AND d.entity_id=p_entity AND d.source_document_id=match_row.business_source_document_id;
  IF bank_document.source_record_id IS DISTINCT FROM candidate->'trace'->>'bank_source_record_id'
     OR bank_document.source_version IS DISTINCT FROM candidate->'trace'->>'bank_source_version'
     OR business_document.source_record_id IS DISTINCT FROM candidate->'trace'->>'business_source_record_id'
     OR business_document.source_version IS DISTINCT FROM candidate->'trace'->>'business_source_version' THEN
    RAISE EXCEPTION 'Bank Match does not bind the exact persisted AutoRec candidate sources' USING ERRCODE='23514';
  END IF;

  INSERT INTO wbs_autorec_match_review(
    wbs_autorec_match_review_id,tenant_id,entity_id,review_candidate_id,candidate_hash,
    candidate_execution_receipt_id,candidate_execution_version,candidate_prepared_by,
    bank_match_id,bank_match_revision,matched_by,evidence_hash,decision,decision_reason,
    reviewed_by,request_hash,idempotency_key
  ) VALUES(
    review_id,p_tenant,p_entity,p_review_candidate,p_candidate_hash,
    candidate_event.execution_receipt_id,candidate_event.version,candidate_preparer,
    p_bank_match,match_row.version,match_row.matched_by,
    refs_jsonb_hash(jsonb_build_object('candidate_hash',p_candidate_hash,'bank_match',to_jsonb(match_row))),
    normalized_decision,btrim(p_reason),actor,p_request_hash,p_idempotency_key
  );
  SELECT jsonb_build_object(
    'wbs_autorec_match_review_id',r.wbs_autorec_match_review_id,'review_candidate_id',r.review_candidate_id,
    'candidate_hash',r.candidate_hash,'candidate_execution_receipt_id',r.candidate_execution_receipt_id,
    'candidate_execution_version',r.candidate_execution_version,'bank_match_id',r.bank_match_id,
    'bank_match_revision',r.bank_match_revision,'evidence_hash',r.evidence_hash,'decision',r.decision,
    'decision_reason',r.decision_reason,'candidate_prepared_by',r.candidate_prepared_by,'matched_by',r.matched_by,
    'reviewed_by',r.reviewed_by,'reviewed_at',r.reviewed_at,'sod_verified',true,
    'g11_linked',false,'incurred',false,'idempotent',false
  ) INTO response FROM wbs_autorec_match_review r WHERE r.wbs_autorec_match_review_id=review_id;
  INSERT INTO audit_event(tenant_id,entity_id,event_type,object_type,object_id,action,actor_id,actor_type,permission_used,
    request_id,correlation_id,idempotency_key,after_hash,reason,metadata)
  VALUES(p_tenant,p_entity,'WBS_AUTOREC_MATCH_REVIEWED','WBS_AUTOREC_MATCH_REVIEW',review_id,
    'REVIEW_'||normalized_decision,actor,'USER','BANK.MATCH.REVIEW',p_idempotency_key,p_idempotency_key,p_idempotency_key,
    refs_jsonb_hash(response-'idempotent'),btrim(p_reason),
    jsonb_build_object('review_candidate_id',p_review_candidate,'bank_match_id',p_bank_match,'bank_match_revision',p_expected_match_revision));
  UPDATE idempotency_receipt SET status='SUCCEEDED',response_status=201,response_body=response,completed_at=clock_timestamp()
    WHERE tenant_id=p_tenant AND operation_scope='WBS_AUTOREC_MATCH_REVIEW:'||p_entity AND idempotency_key=p_idempotency_key;
  RETURN response;
END $$;

CREATE FUNCTION refs_get_wbs_autorec_match_review(p_tenant uuid,p_entity uuid,p_review uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE result jsonb;
BEGIN
  PERFORM refs_assert_scope(p_tenant,p_entity,'WBS.AUTOREC.VIEW');
  SELECT jsonb_build_object(
    'wbs_autorec_match_review_id',r.wbs_autorec_match_review_id,'tenant_id',r.tenant_id,'entity_id',r.entity_id,
    'review_candidate_id',r.review_candidate_id,'candidate_hash',r.candidate_hash,
    'candidate_execution_receipt_id',r.candidate_execution_receipt_id,'candidate_execution_version',r.candidate_execution_version,
    'bank_match_id',r.bank_match_id,'bank_match_revision',r.bank_match_revision,'evidence_hash',r.evidence_hash,
    'decision',r.decision,'decision_reason',r.decision_reason,'candidate_prepared_by',r.candidate_prepared_by,
    'matched_by',r.matched_by,'reviewed_by',r.reviewed_by,'reviewed_at',r.reviewed_at,
    'sod_verified',(r.reviewed_by<>r.matched_by AND r.reviewed_by<>r.candidate_prepared_by),
    'g11_linked',false,'incurred',false
  ) INTO result FROM wbs_autorec_match_review r
    WHERE r.tenant_id=p_tenant AND r.entity_id=p_entity AND r.wbs_autorec_match_review_id=p_review;
  IF result IS NULL THEN RAISE EXCEPTION 'AutoRec Bank Match review was not found in the selected entity' USING ERRCODE='P0002'; END IF;
  RETURN result;
END $$;

REVOKE ALL ON wbs_autorec_match_review FROM PUBLIC,refs_app;
GRANT SELECT ON wbs_autorec_match_review TO refs_app;
REVOKE ALL ON FUNCTION refs_wbs_autorec_match_review_hash(uuid,uuid,text,text,uuid,bigint,text,text) FROM PUBLIC;
REVOKE ALL ON FUNCTION refs_review_wbs_autorec_bank_match(uuid,uuid,text,text,uuid,bigint,text,text,text,text) FROM PUBLIC;
REVOKE ALL ON FUNCTION refs_get_wbs_autorec_match_review(uuid,uuid,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION refs_wbs_autorec_match_review_hash(uuid,uuid,text,text,uuid,bigint,text,text) TO refs_app;
GRANT EXECUTE ON FUNCTION refs_review_wbs_autorec_bank_match(uuid,uuid,text,text,uuid,bigint,text,text,text,text) TO refs_app;
GRANT EXECUTE ON FUNCTION refs_get_wbs_autorec_match_review(uuid,uuid,uuid) TO refs_app;

COMMIT;
