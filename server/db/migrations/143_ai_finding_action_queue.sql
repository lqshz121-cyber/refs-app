BEGIN;

-- A follow-up is deliberately separate from immutable AI finding evidence.
-- It assigns human accountability only; it has no foreign command path to
-- sources, WBS, bank matching, Draft JE creation, approval, or posting.
INSERT INTO permission_catalog(permission_code,domain,risk_class,sod_class) VALUES
  ('AI.FINDING.ASSIGN','AI_ACCOUNTING','MEDIUM','CONTROLLER')
ON CONFLICT(permission_code) DO UPDATE SET active=true,domain=EXCLUDED.domain,risk_class=EXCLUDED.risk_class,sod_class=EXCLUDED.sod_class,version=permission_catalog.version+1,effective_to=NULL;

CREATE TABLE ai_finding_action (
  ai_finding_action_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant(tenant_id), entity_id uuid NOT NULL,
  finding_kind text NOT NULL CHECK(finding_kind IN ('WBS_EXCEPTION','PREPAID_COVERAGE','DUPLICATE_PAYABLE','UNMATCHED_BANK_PAYMENT','COST_DIMENSION','LOAN_REFERENCE')),
  finding_id uuid NOT NULL, finding_hash text NOT NULL CHECK(finding_hash~'^sha256:[0-9a-f]{64}$'),
  owner text NOT NULL CHECK(length(btrim(owner)) BETWEEN 2 AND 128), due_date date NOT NULL,
  revision integer NOT NULL DEFAULT 0 CHECK(revision>=0), assigned_by text NOT NULL, assigned_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE(tenant_id,entity_id,finding_kind,finding_id), UNIQUE(tenant_id,entity_id,ai_finding_action_id),
  FOREIGN KEY(tenant_id,entity_id) REFERENCES entity(tenant_id,entity_id)
);
ALTER TABLE ai_finding_action ENABLE ROW LEVEL SECURITY;
CREATE POLICY ai_finding_action_scope ON ai_finding_action USING(tenant_id=refs_current_tenant() AND refs_entity_allowed(entity_id)) WITH CHECK(tenant_id=refs_current_tenant() AND refs_entity_allowed(entity_id));

CREATE FUNCTION refs_assign_ai_finding_action_hash(p_tenant uuid,p_entity uuid,p_kind text,p_finding uuid,p_finding_hash text,p_owner text,p_due_date date,p_expected_revision integer) RETURNS text LANGUAGE sql IMMUTABLE SET search_path=pg_catalog,public,pg_temp AS $$
  SELECT refs_jsonb_hash(jsonb_build_object('schema_version','AI_FINDING_ACTION_ASSIGN_V1','tenant_id',p_tenant,'entity_id',p_entity,'finding_kind',p_kind,'finding_id',p_finding,'finding_hash',p_finding_hash,'owner',btrim(p_owner),'due_date',p_due_date,'expected_revision',p_expected_revision))
$$;

CREATE FUNCTION refs_assign_ai_finding_action(p_tenant uuid,p_entity uuid,p_kind text,p_finding uuid,p_finding_hash text,p_owner text,p_due_date date,p_expected_revision integer,p_idempotency_key text,p_request_hash text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE actual_hash text; action_row ai_finding_action; idem idempotency_receipt; actor text:=refs_current_actor(); result jsonb;
BEGIN
  PERFORM refs_assert_scope(p_tenant,p_entity,'AI.FINDING.ASSIGN');
  IF actor IS NULL OR p_request_hash IS DISTINCT FROM refs_assign_ai_finding_action_hash(p_tenant,p_entity,p_kind,p_finding,p_finding_hash,p_owner,p_due_date,p_expected_revision) THEN RAISE EXCEPTION 'AI finding assignment request is not canonical' USING ERRCODE='22023'; END IF;
  INSERT INTO idempotency_receipt(tenant_id,operation_scope,idempotency_key,request_hash,status,actor_id) VALUES(p_tenant,'AI_FINDING_ASSIGN:'||p_entity,p_idempotency_key,p_request_hash,'IN_PROGRESS',actor) ON CONFLICT(tenant_id,operation_scope,idempotency_key) DO NOTHING;
  SELECT * INTO idem FROM idempotency_receipt WHERE tenant_id=p_tenant AND operation_scope='AI_FINDING_ASSIGN:'||p_entity AND idempotency_key=p_idempotency_key FOR UPDATE;
  IF idem.request_hash<>p_request_hash THEN RAISE EXCEPTION 'Idempotency key reused with different AI finding assignment' USING ERRCODE='23505'; END IF;
  IF idem.status='SUCCEEDED' THEN RETURN idem.response_body||jsonb_build_object('idempotent',true); END IF;
  CASE p_kind
    WHEN 'WBS_EXCEPTION' THEN SELECT finding_hash INTO actual_hash FROM ai_finding WHERE tenant_id=p_tenant AND entity_id=p_entity AND ai_finding_id=p_finding;
    WHEN 'PREPAID_COVERAGE' THEN SELECT finding_hash INTO actual_hash FROM ai_prepaid_coverage_finding WHERE tenant_id=p_tenant AND entity_id=p_entity AND ai_prepaid_coverage_finding_id=p_finding;
    WHEN 'DUPLICATE_PAYABLE' THEN SELECT finding_hash INTO actual_hash FROM ai_duplicate_payable_finding WHERE tenant_id=p_tenant AND entity_id=p_entity AND ai_duplicate_payable_finding_id=p_finding;
    WHEN 'UNMATCHED_BANK_PAYMENT' THEN SELECT finding_hash INTO actual_hash FROM ai_unmatched_bank_payment_finding WHERE tenant_id=p_tenant AND entity_id=p_entity AND ai_unmatched_bank_payment_finding_id=p_finding;
    WHEN 'COST_DIMENSION' THEN SELECT finding_hash INTO actual_hash FROM ai_cost_dimension_finding WHERE tenant_id=p_tenant AND entity_id=p_entity AND ai_cost_dimension_finding_id=p_finding;
    WHEN 'LOAN_REFERENCE' THEN SELECT finding_hash INTO actual_hash FROM ai_loan_reference_finding WHERE tenant_id=p_tenant AND entity_id=p_entity AND ai_loan_reference_finding_id=p_finding;
    ELSE RAISE EXCEPTION 'AI finding kind is unsupported' USING ERRCODE='22023';
  END CASE;
  IF actual_hash IS NULL OR actual_hash<>p_finding_hash OR p_due_date IS NULL OR btrim(COALESCE(p_owner,''))='' OR p_expected_revision<0 THEN RAISE EXCEPTION 'AI finding assignment requires exact retained finding evidence, owner, due date, and revision' USING ERRCODE='23514'; END IF;
  SELECT * INTO action_row FROM ai_finding_action WHERE tenant_id=p_tenant AND entity_id=p_entity AND finding_kind=p_kind AND finding_id=p_finding FOR UPDATE;
  IF FOUND AND action_row.revision<>p_expected_revision THEN RAISE EXCEPTION 'AI finding action revision is stale' USING ERRCODE='40001'; END IF;
  IF FOUND THEN UPDATE ai_finding_action SET owner=btrim(p_owner),due_date=p_due_date,revision=revision+1,assigned_by=actor,assigned_at=clock_timestamp() WHERE ai_finding_action_id=action_row.ai_finding_action_id RETURNING * INTO action_row;
  ELSE INSERT INTO ai_finding_action(tenant_id,entity_id,finding_kind,finding_id,finding_hash,owner,due_date,assigned_by) VALUES(p_tenant,p_entity,p_kind,p_finding,p_finding_hash,btrim(p_owner),p_due_date,actor) RETURNING * INTO action_row; END IF;
  result:=jsonb_build_object('schema_version','AI_FINDING_ACTION_ASSIGN_V1','ai_finding_action_id',action_row.ai_finding_action_id,'finding_kind',action_row.finding_kind,'finding_id',action_row.finding_id,'finding_hash',action_row.finding_hash,'owner',action_row.owner,'due_date',action_row.due_date,'revision',action_row.revision,'can_create_draft',false,'can_review',false,'can_approve',false,'can_post',false,'idempotent',false);
  INSERT INTO audit_event(tenant_id,entity_id,event_type,object_type,object_id,action,actor_id,actor_type,permission_used,request_id,correlation_id,idempotency_key,after_hash,reason,metadata) VALUES(p_tenant,p_entity,'AI_FINDING_ACTION_ASSIGNED','AI_FINDING_ACTION',action_row.ai_finding_action_id,'ASSIGN',actor,'USER','AI.FINDING.ASSIGN',p_idempotency_key,p_idempotency_key,p_idempotency_key,p_request_hash,'Human owner and due date assigned to immutable AI finding',result);
  INSERT INTO outbox_event(tenant_id,entity_id,aggregate_type,aggregate_id,event_type,payload,payload_hash) VALUES(p_tenant,p_entity,'AI_FINDING_ACTION',action_row.ai_finding_action_id,'AI_FINDING_ACTION_ASSIGNED',result,refs_jsonb_hash(result));
  UPDATE idempotency_receipt SET status='SUCCEEDED',response_status=201,response_body=result,completed_at=clock_timestamp() WHERE idempotency_receipt_id=idem.idempotency_receipt_id;
  RETURN result;
END;
$$;

REVOKE ALL ON ai_finding_action FROM PUBLIC,refs_app;
REVOKE EXECUTE ON FUNCTION refs_assign_ai_finding_action_hash(uuid,uuid,text,uuid,text,text,date,integer),refs_assign_ai_finding_action(uuid,uuid,text,uuid,text,text,date,integer,text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION refs_assign_ai_finding_action_hash(uuid,uuid,text,uuid,text,text,date,integer),refs_assign_ai_finding_action(uuid,uuid,text,uuid,text,text,date,integer,text,text) TO refs_app;
COMMIT;
