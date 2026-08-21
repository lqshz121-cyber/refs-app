BEGIN;

INSERT INTO permission_catalog(permission_code,domain,risk_class,sod_class) VALUES
  ('AI.CAPITALIZATION.PROPOSE','AI_ACCOUNTING','MEDIUM','PREPARER'),
  ('AI.CAPITALIZATION.VIEW','AI_ACCOUNTING','LOW','VIEWER')
ON CONFLICT(permission_code) DO UPDATE SET active=true,domain=EXCLUDED.domain,risk_class=EXCLUDED.risk_class,sod_class=EXCLUDED.sod_class,version=permission_catalog.version+1,effective_to=NULL;

CREATE TABLE ai_invoice_capitalization_proposal (
  ai_invoice_capitalization_proposal_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant(tenant_id),
  entity_id uuid NOT NULL,
  ai_invoice_accounting_classification_evidence_id uuid NOT NULL,
  classification_hash text NOT NULL CHECK(classification_hash~'^sha256:[0-9a-f]{64}$'),
  source_document_id uuid NOT NULL,
  source_document_line_id uuid NOT NULL,
  source_payload_hash text NOT NULL CHECK(source_payload_hash~'^sha256:[0-9a-f]{64}$'),
  source_line_hash text NOT NULL CHECK(source_line_hash~'^sha256:[0-9a-f]{64}$'),
  accounting_period_id uuid NOT NULL,
  capitalization_treatment text NOT NULL CHECK(capitalization_treatment IN ('CWIP','FIXED_ASSET')),
  asset_account_code text NOT NULL,
  liability_account_code text NOT NULL,
  asset_class text NOT NULL CHECK(length(btrim(asset_class)) BETWEEN 1 AND 128),
  currency char(3) NOT NULL CHECK(currency~'^[A-Z]{3}$'),
  amount numeric(20,4) NOT NULL CHECK(amount>0),
  member_trace jsonb NOT NULL CHECK(jsonb_typeof(member_trace)='object' AND member_trace ?& ARRAY['project_ref','property_ref','allocation_basis'] AND (member_trace-'project_ref'-'property_ref'-'allocation_basis')='{}'::jsonb),
  placed_in_service_date date,
  useful_life_months integer CHECK(useful_life_months IS NULL OR useful_life_months BETWEEN 1 AND 600),
  rule_id text NOT NULL CHECK(rule_id='AI_CAPITALIZATION_POLICY_V1'),
  policy_snapshot_id uuid NOT NULL,
  policy_snapshot_hash text NOT NULL CHECK(policy_snapshot_hash~'^sha256:[0-9a-f]{64}$'),
  confidence numeric(5,4) NOT NULL CHECK(confidence BETWEEN 0 AND 1),
  proposal_reason text NOT NULL CHECK(length(btrim(proposal_reason)) BETWEEN 8 AND 2000),
  proposal_hash text NOT NULL CHECK(proposal_hash~'^sha256:[0-9a-f]{64}$'),
  status text NOT NULL DEFAULT 'PROPOSED' CHECK(status='PROPOSED'),
  created_by text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE(tenant_id,entity_id,ai_invoice_capitalization_proposal_id),
  UNIQUE(tenant_id,entity_id,ai_invoice_accounting_classification_evidence_id),
  UNIQUE(tenant_id,entity_id,proposal_hash),
  FOREIGN KEY(tenant_id,entity_id) REFERENCES entity(tenant_id,entity_id),
  FOREIGN KEY(tenant_id,entity_id,ai_invoice_accounting_classification_evidence_id) REFERENCES ai_invoice_accounting_classification_evidence(tenant_id,entity_id,ai_invoice_accounting_classification_evidence_id),
  FOREIGN KEY(tenant_id,entity_id,source_document_id) REFERENCES source_document(tenant_id,entity_id,source_document_id),
  FOREIGN KEY(tenant_id,entity_id,source_document_line_id) REFERENCES source_document_line(tenant_id,entity_id,source_document_line_id),
  FOREIGN KEY(tenant_id,entity_id,accounting_period_id) REFERENCES accounting_period(tenant_id,entity_id,period_id),
  FOREIGN KEY(tenant_id,policy_snapshot_id) REFERENCES setting_snapshot(tenant_id,setting_snapshot_id),
  CHECK(asset_account_code<>liability_account_code),
  CHECK((capitalization_treatment='CWIP' AND placed_in_service_date IS NULL AND useful_life_months IS NULL) OR (capitalization_treatment='FIXED_ASSET' AND placed_in_service_date IS NOT NULL AND useful_life_months IS NOT NULL))
);

ALTER TABLE ai_invoice_capitalization_proposal ENABLE ROW LEVEL SECURITY;
CREATE POLICY ai_invoice_capitalization_proposal_scope ON ai_invoice_capitalization_proposal USING(tenant_id=refs_current_tenant() AND refs_entity_allowed(entity_id)) WITH CHECK(tenant_id=refs_current_tenant() AND refs_entity_allowed(entity_id));
CREATE TRIGGER ai_invoice_capitalization_proposal_append_only BEFORE UPDATE OR DELETE ON ai_invoice_capitalization_proposal FOR EACH ROW EXECUTE FUNCTION reject_mutation();

CREATE FUNCTION refs_propose_ai_invoice_capitalization_hash(p_tenant uuid,p_entity uuid,p_evidence uuid,p_classification_hash text,p_period uuid,p_treatment text,p_asset_account text,p_liability_account text,p_asset_class text,p_member_trace jsonb,p_placed_in_service_date date,p_useful_life_months integer,p_reason text) RETURNS text
LANGUAGE sql IMMUTABLE SET search_path=pg_catalog,public,pg_temp AS $$ SELECT refs_jsonb_hash(jsonb_build_object('schema_version','AI_INVOICE_CAPITALIZATION_PROPOSAL_V1','tenant_id',p_tenant,'entity_id',p_entity,'classification_evidence_id',p_evidence,'classification_hash',p_classification_hash,'accounting_period_id',p_period,'capitalization_treatment',p_treatment,'asset_account_code',btrim(p_asset_account),'liability_account_code',btrim(p_liability_account),'asset_class',btrim(p_asset_class),'member_trace',p_member_trace,'placed_in_service_date',p_placed_in_service_date,'useful_life_months',p_useful_life_months,'reason',btrim(p_reason))) $$;

CREATE FUNCTION refs_propose_ai_invoice_capitalization(p_tenant uuid,p_entity uuid,p_evidence uuid,p_classification_hash text,p_period uuid,p_treatment text,p_asset_account text,p_liability_account text,p_asset_class text,p_member_trace jsonb,p_placed_in_service_date date,p_useful_life_months integer,p_reason text,p_idempotency_key text,p_request_hash text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE actor text:=refs_current_actor(); evidence ai_invoice_accounting_classification_evidence; source source_document; line source_document_line; idem idempotency_receipt; proposal_id uuid:=gen_random_uuid(); proposal_hash text; project_ref text; property_ref text; basis text; policy_id uuid; policy_hash text; payload jsonb; result jsonb;
BEGIN
  PERFORM refs_assert_scope(p_tenant,p_entity,'AI.CAPITALIZATION.PROPOSE');
  IF actor IS NULL THEN RAISE EXCEPTION 'Authenticated capitalization proposer missing' USING ERRCODE='42501'; END IF;
  proposal_hash:=refs_propose_ai_invoice_capitalization_hash(p_tenant,p_entity,p_evidence,p_classification_hash,p_period,p_treatment,p_asset_account,p_liability_account,p_asset_class,p_member_trace,p_placed_in_service_date,p_useful_life_months,p_reason);
  IF p_request_hash IS DISTINCT FROM proposal_hash THEN RAISE EXCEPTION 'Capitalization request hash is not canonical' USING ERRCODE='22023'; END IF;
  IF p_treatment NOT IN ('CWIP','FIXED_ASSET') OR btrim(COALESCE(p_asset_account,''))='' OR btrim(COALESCE(p_liability_account,''))='' OR btrim(p_asset_account)=btrim(p_liability_account) OR length(btrim(COALESCE(p_asset_class,''))) NOT BETWEEN 1 AND 128 OR p_member_trace IS NULL OR jsonb_typeof(p_member_trace)<>'object' OR length(btrim(COALESCE(p_reason,''))) NOT BETWEEN 8 AND 2000 OR (p_treatment='CWIP' AND (p_placed_in_service_date IS NOT NULL OR p_useful_life_months IS NOT NULL)) OR (p_treatment='FIXED_ASSET' AND (p_placed_in_service_date IS NULL OR p_useful_life_months NOT BETWEEN 1 AND 600)) THEN RAISE EXCEPTION 'Capitalization proposal requires treatment-specific asset evidence' USING ERRCODE='22023'; END IF;
  project_ref:=NULLIF(btrim(p_member_trace->>'project_ref'),'');property_ref:=NULLIF(btrim(p_member_trace->>'property_ref'),'');basis:=p_member_trace->>'allocation_basis';
  IF (p_member_trace-'project_ref'-'property_ref'-'allocation_basis')<>'{}'::jsonb OR basis NOT IN ('ENTITY_ONLY','SOURCE_DIMENSIONED') OR (basis='ENTITY_ONLY' AND (project_ref IS NOT NULL OR property_ref IS NOT NULL)) THEN RAISE EXCEPTION 'Capitalization member trace is not closed or internally consistent' USING ERRCODE='22023'; END IF;
  INSERT INTO idempotency_receipt(tenant_id,operation_scope,idempotency_key,request_hash,status,actor_id) VALUES(p_tenant,'AI_INVOICE_CAPITALIZATION_PROPOSAL:'||p_entity,p_idempotency_key,p_request_hash,'IN_PROGRESS',actor) ON CONFLICT(tenant_id,operation_scope,idempotency_key) DO NOTHING;
  SELECT * INTO idem FROM idempotency_receipt WHERE tenant_id=p_tenant AND operation_scope='AI_INVOICE_CAPITALIZATION_PROPOSAL:'||p_entity AND idempotency_key=p_idempotency_key FOR UPDATE;
  IF idem.request_hash<>p_request_hash OR idem.actor_id IS DISTINCT FROM actor THEN RAISE EXCEPTION 'Capitalization idempotency key conflicts with another payload or actor' USING ERRCODE='23505'; END IF;
  IF idem.status='SUCCEEDED' THEN RETURN idem.response_body||jsonb_build_object('idempotent',true); END IF;
  SELECT * INTO evidence FROM ai_invoice_accounting_classification_evidence WHERE tenant_id=p_tenant AND entity_id=p_entity AND ai_invoice_accounting_classification_evidence_id=p_evidence FOR SHARE;
  IF NOT FOUND OR evidence.classification_hash<>p_classification_hash OR evidence.classifier_version<>'AI_INVOICE_ACCOUNTING_CLASSIFICATION_V2' OR evidence.classification<>'CAPITALIZATION_REVIEW' OR evidence.status<>'REVIEW_REQUIRED' OR evidence.rule_id<>'AI_CAPITALIZATION_POLICY_V1' OR evidence.policy_snapshot_id IS NULL OR evidence.policy_snapshot_hash IS NULL THEN RAISE EXCEPTION 'Capitalization proposal requires exact retained policy-backed CAPITALIZATION_REVIEW evidence' USING ERRCODE='23514'; END IF;
  policy_id:=evidence.policy_snapshot_id;policy_hash:=evidence.policy_snapshot_hash;
  SELECT * INTO source FROM source_document WHERE tenant_id=p_tenant AND entity_id=p_entity AND source_document_id=evidence.source_document_id FOR SHARE;
  SELECT * INTO line FROM source_document_line WHERE tenant_id=p_tenant AND entity_id=p_entity AND source_document_id=evidence.source_document_id AND source_document_line_id=evidence.source_document_line_id FOR SHARE;
  IF source.source_document_id IS NULL OR line.source_document_line_id IS NULL OR source.payload_hash<>evidence.source_payload_hash OR source.status<>'READY_FOR_DRAFT' OR line.amount<=0 THEN RAISE EXCEPTION 'Capitalization source is missing, changed, or not review-ready' USING ERRCODE='23514'; END IF;
  IF basis='ENTITY_ONLY' AND (NULLIF(btrim(line.project_ref),'') IS NOT NULL OR NULLIF(btrim(line.property_ref),'') IS NOT NULL) OR basis='SOURCE_DIMENSIONED' AND (project_ref IS DISTINCT FROM NULLIF(btrim(line.project_ref),'') OR property_ref IS DISTINCT FROM NULLIF(btrim(line.property_ref),'')) THEN RAISE EXCEPTION 'Capitalization member trace does not exactly match the classified source line' USING ERRCODE='23514'; END IF;
  IF p_treatment='CWIP' AND project_ref IS NULL THEN RAISE EXCEPTION 'CWIP capitalization requires an exact source project reference' USING ERRCODE='23514'; END IF;
  PERFORM 1 FROM accounting_period WHERE tenant_id=p_tenant AND entity_id=p_entity AND period_id=p_period FOR SHARE;IF NOT FOUND THEN RAISE EXCEPTION 'Capitalization period is outside entity scope' USING ERRCODE='23503'; END IF;
  PERFORM 1 FROM account_master WHERE tenant_id=p_tenant AND entity_id=p_entity AND account_code=btrim(p_asset_account) AND active FOR SHARE;IF NOT FOUND THEN RAISE EXCEPTION 'Capitalization asset account is inactive or missing' USING ERRCODE='23503'; END IF;
  PERFORM 1 FROM account_master WHERE tenant_id=p_tenant AND entity_id=p_entity AND account_code=btrim(p_liability_account) AND active FOR SHARE;IF NOT FOUND THEN RAISE EXCEPTION 'Capitalization liability account is inactive or missing' USING ERRCODE='23503'; END IF;
  INSERT INTO ai_invoice_capitalization_proposal(ai_invoice_capitalization_proposal_id,tenant_id,entity_id,ai_invoice_accounting_classification_evidence_id,classification_hash,source_document_id,source_document_line_id,source_payload_hash,source_line_hash,accounting_period_id,capitalization_treatment,asset_account_code,liability_account_code,asset_class,currency,amount,member_trace,placed_in_service_date,useful_life_months,rule_id,policy_snapshot_id,policy_snapshot_hash,confidence,proposal_reason,proposal_hash,created_by) VALUES(proposal_id,p_tenant,p_entity,p_evidence,evidence.classification_hash,evidence.source_document_id,evidence.source_document_line_id,evidence.source_payload_hash,evidence.source_line_hash,p_period,p_treatment,btrim(p_asset_account),btrim(p_liability_account),btrim(p_asset_class),source.currency,line.amount,p_member_trace,p_placed_in_service_date,p_useful_life_months,evidence.rule_id,policy_id,policy_hash,evidence.confidence,btrim(p_reason),proposal_hash,actor);
  payload:=jsonb_build_object('schema_version','AI_INVOICE_CAPITALIZATION_PROPOSAL_V1','ai_invoice_capitalization_proposal_id',proposal_id,'classification_evidence_id',p_evidence,'classification_hash',evidence.classification_hash,'source_document_id',evidence.source_document_id,'source_document_line_id',evidence.source_document_line_id,'source_payload_hash',evidence.source_payload_hash,'source_line_hash',evidence.source_line_hash,'accounting_period_id',p_period,'capitalization_treatment',p_treatment,'asset_account_code',btrim(p_asset_account),'liability_account_code',btrim(p_liability_account),'asset_class',btrim(p_asset_class),'currency',source.currency,'amount',line.amount,'member_trace',p_member_trace,'placed_in_service_date',p_placed_in_service_date,'useful_life_months',p_useful_life_months,'rule_id',evidence.rule_id,'policy_snapshot_id',policy_id,'policy_snapshot_hash',policy_hash,'confidence',evidence.confidence,'status','PROPOSED','can_create_draft',false,'can_review',false,'can_approve',false,'can_post',false);
  INSERT INTO audit_event(tenant_id,entity_id,event_type,object_type,object_id,action,actor_id,actor_type,permission_used,request_id,correlation_id,idempotency_key,after_hash,reason,metadata) VALUES(p_tenant,p_entity,'AI_INVOICE_CAPITALIZATION_PROPOSED','AI_INVOICE_CAPITALIZATION_PROPOSAL',proposal_id,'PROPOSE',actor,'USER','AI.CAPITALIZATION.PROPOSE',p_idempotency_key,p_idempotency_key,p_idempotency_key,proposal_hash,btrim(p_reason),payload);
  INSERT INTO outbox_event(tenant_id,entity_id,aggregate_type,aggregate_id,event_type,payload,payload_hash) VALUES(p_tenant,p_entity,'AI_INVOICE_CAPITALIZATION_PROPOSAL',proposal_id,'AI_INVOICE_CAPITALIZATION_PROPOSED',payload,refs_jsonb_hash(payload));
  result:=payload||jsonb_build_object('idempotent',false);UPDATE idempotency_receipt SET status='SUCCEEDED',response_status=201,response_body=result,completed_at=clock_timestamp() WHERE idempotency_receipt_id=idem.idempotency_receipt_id;RETURN result;
END;
$$;

CREATE FUNCTION refs_read_ai_invoice_capitalization_proposals(p_tenant uuid,p_entity uuid,p_limit integer DEFAULT 50) RETURNS SETOF ai_invoice_capitalization_proposal LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$ BEGIN PERFORM refs_assert_scope(p_tenant,p_entity,'AI.CAPITALIZATION.VIEW');IF p_limit<1 OR p_limit>100 THEN RAISE EXCEPTION 'Capitalization proposal limit must be between 1 and 100' USING ERRCODE='22023';END IF;RETURN QUERY SELECT p.* FROM ai_invoice_capitalization_proposal p WHERE p.tenant_id=p_tenant AND p.entity_id=p_entity ORDER BY p.created_at DESC,p.ai_invoice_capitalization_proposal_id DESC LIMIT p_limit;END;$$;

REVOKE ALL ON ai_invoice_capitalization_proposal FROM PUBLIC,refs_app;
REVOKE EXECUTE ON FUNCTION refs_propose_ai_invoice_capitalization_hash(uuid,uuid,uuid,text,uuid,text,text,text,text,jsonb,date,integer,text),refs_propose_ai_invoice_capitalization(uuid,uuid,uuid,text,uuid,text,text,text,text,jsonb,date,integer,text,text,text),refs_read_ai_invoice_capitalization_proposals(uuid,uuid,integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION refs_propose_ai_invoice_capitalization_hash(uuid,uuid,uuid,text,uuid,text,text,text,text,jsonb,date,integer,text),refs_propose_ai_invoice_capitalization(uuid,uuid,uuid,text,uuid,text,text,text,text,jsonb,date,integer,text,text,text),refs_read_ai_invoice_capitalization_proposals(uuid,uuid,integer) TO refs_app;

COMMIT;
