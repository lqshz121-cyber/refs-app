BEGIN;

INSERT INTO permission_catalog(permission_code,domain,risk_class,sod_class) VALUES
  ('AI.ACCRUAL.PROPOSE','AI_ACCOUNTING','MEDIUM','PREPARER'),
  ('AI.ACCRUAL.VIEW','AI_ACCOUNTING','LOW','VIEWER')
ON CONFLICT(permission_code) DO UPDATE SET active=true,domain=EXCLUDED.domain,risk_class=EXCLUDED.risk_class,sod_class=EXCLUDED.sod_class,version=permission_catalog.version+1,effective_to=NULL;

CREATE TABLE ai_invoice_accrual_proposal (
  ai_invoice_accrual_proposal_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant(tenant_id),
  entity_id uuid NOT NULL,
  ai_invoice_accounting_classification_evidence_id uuid NOT NULL,
  classification_hash text NOT NULL CHECK(classification_hash~'^sha256:[0-9a-f]{64}$'),
  source_document_id uuid NOT NULL,
  source_document_line_id uuid NOT NULL,
  source_payload_hash text NOT NULL CHECK(source_payload_hash~'^sha256:[0-9a-f]{64}$'),
  source_line_hash text NOT NULL CHECK(source_line_hash~'^sha256:[0-9a-f]{64}$'),
  accounting_period_id uuid NOT NULL,
  expense_account_code text NOT NULL,
  liability_account_code text NOT NULL,
  currency char(3) NOT NULL CHECK(currency~'^[A-Z]{3}$'),
  amount numeric(20,4) NOT NULL CHECK(amount>0),
  member_trace jsonb NOT NULL CHECK(
    jsonb_typeof(member_trace)='object'
    AND member_trace ?& ARRAY['project_ref','property_ref','allocation_basis']
    AND (member_trace-'project_ref'-'property_ref'-'allocation_basis')='{}'::jsonb
    AND jsonb_typeof(member_trace->'project_ref') IN ('string','null')
    AND jsonb_typeof(member_trace->'property_ref') IN ('string','null')
    AND member_trace->>'allocation_basis' IN ('ENTITY_ONLY','SOURCE_DIMENSIONED')
  ),
  reversal_decision text NOT NULL CHECK(reversal_decision IN ('REVERSE_NEXT_OPEN_PERIOD','NO_AUTOMATIC_REVERSAL')),
  reversal_date date,
  rule_id text NOT NULL CHECK(rule_id='AI_PRIOR_SERVICE_ACCRUAL_REVIEW_V1'),
  confidence numeric(5,4) NOT NULL CHECK(confidence BETWEEN 0 AND 1),
  proposal_reason text NOT NULL CHECK(length(btrim(proposal_reason)) BETWEEN 8 AND 2000),
  proposal_hash text NOT NULL CHECK(proposal_hash~'^sha256:[0-9a-f]{64}$'),
  status text NOT NULL DEFAULT 'PROPOSED' CHECK(status='PROPOSED'),
  created_by text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE(tenant_id,entity_id,ai_invoice_accrual_proposal_id),
  UNIQUE(tenant_id,entity_id,ai_invoice_accounting_classification_evidence_id),
  UNIQUE(tenant_id,entity_id,proposal_hash),
  FOREIGN KEY(tenant_id,entity_id) REFERENCES entity(tenant_id,entity_id),
  FOREIGN KEY(tenant_id,entity_id,ai_invoice_accounting_classification_evidence_id)
    REFERENCES ai_invoice_accounting_classification_evidence(tenant_id,entity_id,ai_invoice_accounting_classification_evidence_id),
  FOREIGN KEY(tenant_id,entity_id,source_document_id) REFERENCES source_document(tenant_id,entity_id,source_document_id),
  FOREIGN KEY(tenant_id,entity_id,source_document_line_id) REFERENCES source_document_line(tenant_id,entity_id,source_document_line_id),
  FOREIGN KEY(tenant_id,entity_id,accounting_period_id) REFERENCES accounting_period(tenant_id,entity_id,period_id),
  CHECK(expense_account_code<>liability_account_code),
  CHECK((reversal_decision='REVERSE_NEXT_OPEN_PERIOD' AND reversal_date IS NOT NULL) OR (reversal_decision='NO_AUTOMATIC_REVERSAL' AND reversal_date IS NULL))
);

ALTER TABLE ai_invoice_accrual_proposal ENABLE ROW LEVEL SECURITY;
CREATE POLICY ai_invoice_accrual_proposal_scope ON ai_invoice_accrual_proposal
  USING(tenant_id=refs_current_tenant() AND refs_entity_allowed(entity_id))
  WITH CHECK(tenant_id=refs_current_tenant() AND refs_entity_allowed(entity_id));
CREATE TRIGGER ai_invoice_accrual_proposal_append_only BEFORE UPDATE OR DELETE ON ai_invoice_accrual_proposal
  FOR EACH ROW EXECUTE FUNCTION reject_mutation();

CREATE FUNCTION refs_propose_ai_invoice_accrual_hash(
  p_tenant uuid,p_entity uuid,p_evidence uuid,p_classification_hash text,p_period uuid,
  p_expense_account text,p_liability_account text,p_member_trace jsonb,p_reversal_decision text,p_reversal_date date,p_reason text
) RETURNS text LANGUAGE sql IMMUTABLE SET search_path=pg_catalog,public,pg_temp AS $$
  SELECT refs_jsonb_hash(jsonb_build_object(
    'schema_version','AI_INVOICE_ACCRUAL_PROPOSAL_V1','tenant_id',p_tenant,'entity_id',p_entity,
    'classification_evidence_id',p_evidence,'classification_hash',p_classification_hash,'accounting_period_id',p_period,
    'expense_account_code',btrim(p_expense_account),'liability_account_code',btrim(p_liability_account),
    'member_trace',p_member_trace,'reversal_decision',p_reversal_decision,'reversal_date',p_reversal_date,'reason',btrim(p_reason)
  ))
$$;

CREATE FUNCTION refs_propose_ai_invoice_accrual(
  p_tenant uuid,p_entity uuid,p_evidence uuid,p_classification_hash text,p_period uuid,
  p_expense_account text,p_liability_account text,p_member_trace jsonb,p_reversal_decision text,p_reversal_date date,p_reason text,
  p_idempotency_key text,p_request_hash text
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE actor text:=refs_current_actor(); evidence ai_invoice_accounting_classification_evidence; source source_document; source_line source_document_line; period_row accounting_period; idem idempotency_receipt;
DECLARE proposal_id uuid:=gen_random_uuid(); project_ref text; property_ref text; trace_basis text; proposal_hash text; event_payload jsonb; result jsonb;
BEGIN
  PERFORM refs_assert_scope(p_tenant,p_entity,'AI.ACCRUAL.PROPOSE');
  IF actor IS NULL THEN RAISE EXCEPTION 'Authenticated invoice accrual proposer missing' USING ERRCODE='42501'; END IF;
  proposal_hash:=refs_propose_ai_invoice_accrual_hash(p_tenant,p_entity,p_evidence,p_classification_hash,p_period,p_expense_account,p_liability_account,p_member_trace,p_reversal_decision,p_reversal_date,p_reason);
  IF p_request_hash IS DISTINCT FROM proposal_hash THEN RAISE EXCEPTION 'AI invoice accrual request hash is not canonical' USING ERRCODE='22023'; END IF;
  IF COALESCE(p_classification_hash,'')!~'^sha256:[0-9a-f]{64}$' OR btrim(COALESCE(p_expense_account,''))='' OR btrim(COALESCE(p_liability_account,''))=''
     OR btrim(p_expense_account)=btrim(p_liability_account) OR p_member_trace IS NULL OR jsonb_typeof(p_member_trace)<>'object'
     OR COALESCE(p_reversal_decision,'') NOT IN ('REVERSE_NEXT_OPEN_PERIOD','NO_AUTOMATIC_REVERSAL')
     OR (p_reversal_decision='REVERSE_NEXT_OPEN_PERIOD') IS DISTINCT FROM (p_reversal_date IS NOT NULL)
     OR COALESCE(length(btrim(p_reason)),0) NOT BETWEEN 8 AND 2000 THEN
    RAISE EXCEPTION 'AI invoice accrual proposal requires exact evidence, distinct accounts, member trace, reversal decision, and reason' USING ERRCODE='22023';
  END IF;
  project_ref:=NULLIF(btrim(p_member_trace->>'project_ref'),'');property_ref:=NULLIF(btrim(p_member_trace->>'property_ref'),'');trace_basis:=p_member_trace->>'allocation_basis';
  IF (p_member_trace-'project_ref'-'property_ref'-'allocation_basis')<>'{}'::jsonb OR trace_basis NOT IN ('ENTITY_ONLY','SOURCE_DIMENSIONED')
     OR (trace_basis='ENTITY_ONLY' AND (project_ref IS NOT NULL OR property_ref IS NOT NULL)) THEN
    RAISE EXCEPTION 'AI invoice accrual member trace is not closed or internally consistent' USING ERRCODE='22023';
  END IF;
  INSERT INTO idempotency_receipt(tenant_id,operation_scope,idempotency_key,request_hash,status,actor_id)
    VALUES(p_tenant,'AI_INVOICE_ACCRUAL_PROPOSAL:'||p_entity,p_idempotency_key,p_request_hash,'IN_PROGRESS',actor)
    ON CONFLICT(tenant_id,operation_scope,idempotency_key) DO NOTHING;
  SELECT * INTO idem FROM idempotency_receipt WHERE tenant_id=p_tenant AND operation_scope='AI_INVOICE_ACCRUAL_PROPOSAL:'||p_entity AND idempotency_key=p_idempotency_key FOR UPDATE;
  IF idem.request_hash<>p_request_hash OR idem.actor_id IS DISTINCT FROM actor THEN RAISE EXCEPTION 'Invoice accrual idempotency key conflicts with another payload or actor' USING ERRCODE='23505'; END IF;
  IF idem.status='SUCCEEDED' THEN RETURN idem.response_body||jsonb_build_object('idempotent',true); END IF;
  SELECT * INTO evidence FROM ai_invoice_accounting_classification_evidence WHERE tenant_id=p_tenant AND entity_id=p_entity AND ai_invoice_accounting_classification_evidence_id=p_evidence FOR SHARE;
  IF NOT FOUND OR evidence.classification_hash<>p_classification_hash OR evidence.classifier_version<>'AI_INVOICE_ACCOUNTING_CLASSIFICATION_V2'
     OR evidence.classification<>'ACCRUAL_REVIEW' OR evidence.status<>'REVIEW_REQUIRED' OR evidence.rule_id<>'AI_PRIOR_SERVICE_ACCRUAL_REVIEW_V1' THEN
    RAISE EXCEPTION 'Invoice accrual proposal requires exact retained ACCRUAL_REVIEW classification evidence' USING ERRCODE='23514';
  END IF;
  SELECT * INTO source FROM source_document WHERE tenant_id=p_tenant AND entity_id=p_entity AND source_document_id=evidence.source_document_id FOR SHARE;
  SELECT * INTO source_line FROM source_document_line WHERE tenant_id=p_tenant AND entity_id=p_entity AND source_document_id=evidence.source_document_id AND source_document_line_id=evidence.source_document_line_id FOR SHARE;
  IF source.source_document_id IS NULL OR source_line.source_document_line_id IS NULL OR source.payload_hash<>evidence.source_payload_hash OR source.status<>'READY_FOR_DRAFT'
     OR source_line.amount IS NULL OR source_line.amount<=0 THEN RAISE EXCEPTION 'Invoice accrual source is missing, changed, or not review-ready' USING ERRCODE='23514'; END IF;
  SELECT * INTO period_row FROM accounting_period WHERE tenant_id=p_tenant AND entity_id=p_entity AND period_id=p_period FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Invoice accrual accounting period is outside the entity scope' USING ERRCODE='23503'; END IF;
  IF p_reversal_date IS NOT NULL AND p_reversal_date<=period_row.ends_on THEN RAISE EXCEPTION 'Invoice accrual reversal date must follow the accrual period' USING ERRCODE='22023'; END IF;
  IF trace_basis='ENTITY_ONLY' AND (NULLIF(btrim(source_line.project_ref),'') IS NOT NULL OR NULLIF(btrim(source_line.property_ref),'') IS NOT NULL)
     OR trace_basis='SOURCE_DIMENSIONED' AND (project_ref IS DISTINCT FROM NULLIF(btrim(source_line.project_ref),'') OR property_ref IS DISTINCT FROM NULLIF(btrim(source_line.property_ref),'')) THEN
    RAISE EXCEPTION 'Invoice accrual member trace does not exactly match the classified source line' USING ERRCODE='23514';
  END IF;
  PERFORM 1 FROM account_master WHERE tenant_id=p_tenant AND entity_id=p_entity AND account_code=btrim(p_expense_account) AND active FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Invoice accrual expense account is inactive or missing' USING ERRCODE='23503'; END IF;
  PERFORM 1 FROM account_master WHERE tenant_id=p_tenant AND entity_id=p_entity AND account_code=btrim(p_liability_account) AND active FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Invoice accrual liability account is inactive or missing' USING ERRCODE='23503'; END IF;
  INSERT INTO ai_invoice_accrual_proposal(ai_invoice_accrual_proposal_id,tenant_id,entity_id,ai_invoice_accounting_classification_evidence_id,classification_hash,source_document_id,source_document_line_id,source_payload_hash,source_line_hash,accounting_period_id,expense_account_code,liability_account_code,currency,amount,member_trace,reversal_decision,reversal_date,rule_id,confidence,proposal_reason,proposal_hash,created_by)
    VALUES(proposal_id,p_tenant,p_entity,evidence.ai_invoice_accounting_classification_evidence_id,evidence.classification_hash,evidence.source_document_id,evidence.source_document_line_id,evidence.source_payload_hash,evidence.source_line_hash,p_period,btrim(p_expense_account),btrim(p_liability_account),source.currency,source_line.amount,p_member_trace,p_reversal_decision,p_reversal_date,evidence.rule_id,evidence.confidence,btrim(p_reason),proposal_hash,actor);
  event_payload:=jsonb_build_object('schema_version','AI_INVOICE_ACCRUAL_PROPOSAL_V1','ai_invoice_accrual_proposal_id',proposal_id,'classification_evidence_id',p_evidence,'classification_hash',evidence.classification_hash,'source_document_id',evidence.source_document_id,'source_document_line_id',evidence.source_document_line_id,'source_payload_hash',evidence.source_payload_hash,'source_line_hash',evidence.source_line_hash,'accounting_period_id',p_period,'expense_account_code',btrim(p_expense_account),'liability_account_code',btrim(p_liability_account),'currency',source.currency,'amount',source_line.amount,'member_trace',p_member_trace,'reversal_decision',p_reversal_decision,'reversal_date',p_reversal_date,'rule_id',evidence.rule_id,'confidence',evidence.confidence,'status','PROPOSED','can_create_draft',false,'can_review',false,'can_approve',false,'can_post',false);
  INSERT INTO audit_event(tenant_id,entity_id,event_type,object_type,object_id,action,actor_id,actor_type,permission_used,request_id,correlation_id,idempotency_key,after_hash,reason,metadata)
    VALUES(p_tenant,p_entity,'AI_INVOICE_ACCRUAL_PROPOSED','AI_INVOICE_ACCRUAL_PROPOSAL',proposal_id,'PROPOSE',actor,'USER','AI.ACCRUAL.PROPOSE',p_idempotency_key,p_idempotency_key,p_idempotency_key,proposal_hash,btrim(p_reason),event_payload);
  INSERT INTO outbox_event(tenant_id,entity_id,aggregate_type,aggregate_id,event_type,payload,payload_hash)
    VALUES(p_tenant,p_entity,'AI_INVOICE_ACCRUAL_PROPOSAL',proposal_id,'AI_INVOICE_ACCRUAL_PROPOSED',event_payload,refs_jsonb_hash(event_payload));
  result:=event_payload||jsonb_build_object('idempotent',false);
  UPDATE idempotency_receipt SET status='SUCCEEDED',response_status=201,response_body=result,completed_at=clock_timestamp() WHERE idempotency_receipt_id=idem.idempotency_receipt_id;
  RETURN result;
END;
$$;

CREATE FUNCTION refs_read_ai_invoice_accrual_proposals(p_tenant uuid,p_entity uuid,p_limit integer DEFAULT 50) RETURNS SETOF ai_invoice_accrual_proposal
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
BEGIN
  PERFORM refs_assert_scope(p_tenant,p_entity,'AI.ACCRUAL.VIEW');
  IF p_limit<1 OR p_limit>100 THEN RAISE EXCEPTION 'Invoice accrual proposal limit must be between 1 and 100' USING ERRCODE='22023'; END IF;
  RETURN QUERY SELECT p.* FROM ai_invoice_accrual_proposal p WHERE p.tenant_id=p_tenant AND p.entity_id=p_entity ORDER BY p.created_at DESC,p.ai_invoice_accrual_proposal_id DESC LIMIT p_limit;
END;
$$;

REVOKE ALL ON ai_invoice_accrual_proposal FROM PUBLIC,refs_app;
REVOKE EXECUTE ON FUNCTION refs_propose_ai_invoice_accrual_hash(uuid,uuid,uuid,text,uuid,text,text,jsonb,text,date,text),refs_propose_ai_invoice_accrual(uuid,uuid,uuid,text,uuid,text,text,jsonb,text,date,text,text,text),refs_read_ai_invoice_accrual_proposals(uuid,uuid,integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION refs_propose_ai_invoice_accrual_hash(uuid,uuid,uuid,text,uuid,text,text,jsonb,text,date,text),refs_propose_ai_invoice_accrual(uuid,uuid,uuid,text,uuid,text,text,jsonb,text,date,text,text,text),refs_read_ai_invoice_accrual_proposals(uuid,uuid,integer) TO refs_app;

COMMIT;
