BEGIN;

INSERT INTO permission_catalog(permission_code,domain,risk_class,sod_class) VALUES
  ('AI.AMORTIZATION.PROPOSE','AI_ACCOUNTING','MEDIUM','PREPARER')
ON CONFLICT(permission_code) DO UPDATE SET active=true,domain=EXCLUDED.domain,risk_class=EXCLUDED.risk_class,sod_class=EXCLUDED.sod_class,version=permission_catalog.version+1,effective_to=NULL;

-- An amortization proposal is retained accounting analysis.  It is deliberately
-- not a journal, approval, posting instruction, or a substitute for source
-- coverage evidence.  The first implementation accepts only whole-month
-- coverage so no period allocation is invented from a description or account
-- label.
CREATE TABLE ai_amortization_schedule (
  ai_amortization_schedule_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant(tenant_id),
  entity_id uuid NOT NULL,
  source_document_id uuid NOT NULL,
  source_payload_hash text NOT NULL CHECK(source_payload_hash ~ '^sha256:[0-9a-f]{64}$'),
  source_document_version bigint NOT NULL CHECK(source_document_version >= 0),
  rule_id text NOT NULL CHECK(rule_id='PREPAID_AMORTIZATION_V1'),
  analysis_mode text NOT NULL CHECK(analysis_mode='DETERMINISTIC_EVIDENCE_BACKED'),
  confidence numeric(5,4) NOT NULL CHECK(confidence >= 0 AND confidence <= 1),
  coverage_start date NOT NULL,
  coverage_end date NOT NULL,
  currency char(3) NOT NULL CHECK(currency ~ '^[A-Z]{3}$'),
  original_amount numeric(20,4) NOT NULL CHECK(original_amount > 0),
  prepaid_account_code text NOT NULL,
  expense_account_code text NOT NULL,
  member_trace jsonb NOT NULL CHECK(
    jsonb_typeof(member_trace)='object'
    AND member_trace ?& ARRAY['project_ref','property_ref','allocation_basis']
    AND (member_trace-'project_ref'-'property_ref'-'allocation_basis')='{}'::jsonb
    AND jsonb_typeof(member_trace->'project_ref') IN ('string','null')
    AND jsonb_typeof(member_trace->'property_ref') IN ('string','null')
    AND member_trace->>'allocation_basis' IN ('ENTITY_ONLY','SOURCE_DIMENSIONED')
  ),
  proposal_reason text NOT NULL CHECK(length(btrim(proposal_reason)) BETWEEN 8 AND 2000),
  proposal_hash text NOT NULL CHECK(proposal_hash ~ '^sha256:[0-9a-f]{64}$'),
  status text NOT NULL DEFAULT 'PROPOSED' CHECK(status='PROPOSED'),
  created_by text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE(tenant_id,entity_id,ai_amortization_schedule_id),
  UNIQUE(tenant_id,entity_id,proposal_hash),
  UNIQUE(tenant_id,entity_id,source_document_id),
  FOREIGN KEY(tenant_id,entity_id) REFERENCES entity(tenant_id,entity_id),
  FOREIGN KEY(tenant_id,entity_id,source_document_id) REFERENCES source_document(tenant_id,entity_id,source_document_id)
);

CREATE TABLE ai_amortization_schedule_line (
  ai_amortization_schedule_line_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  entity_id uuid NOT NULL,
  ai_amortization_schedule_id uuid NOT NULL,
  line_no integer NOT NULL CHECK(line_no >= 1),
  amortization_month date NOT NULL CHECK(amortization_month=date_trunc('month',amortization_month)::date),
  amount numeric(20,4) NOT NULL CHECK(amount > 0),
  source_payload_hash text NOT NULL CHECK(source_payload_hash ~ '^sha256:[0-9a-f]{64}$'),
  status text NOT NULL DEFAULT 'PROPOSED' CHECK(status='PROPOSED'),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE(tenant_id,entity_id,ai_amortization_schedule_line_id),
  UNIQUE(tenant_id,entity_id,ai_amortization_schedule_id,line_no),
  UNIQUE(tenant_id,entity_id,ai_amortization_schedule_id,amortization_month),
  FOREIGN KEY(tenant_id,entity_id,ai_amortization_schedule_id)
    REFERENCES ai_amortization_schedule(tenant_id,entity_id,ai_amortization_schedule_id)
);

ALTER TABLE ai_amortization_schedule ENABLE ROW LEVEL SECURITY;
CREATE POLICY ai_amortization_schedule_scope ON ai_amortization_schedule
  USING(tenant_id=refs_current_tenant() AND refs_entity_allowed(entity_id))
  WITH CHECK(tenant_id=refs_current_tenant() AND refs_entity_allowed(entity_id));
ALTER TABLE ai_amortization_schedule_line ENABLE ROW LEVEL SECURITY;
CREATE POLICY ai_amortization_schedule_line_scope ON ai_amortization_schedule_line
  USING(tenant_id=refs_current_tenant() AND refs_entity_allowed(entity_id))
  WITH CHECK(tenant_id=refs_current_tenant() AND refs_entity_allowed(entity_id));
CREATE TRIGGER ai_amortization_schedule_append_only BEFORE UPDATE OR DELETE ON ai_amortization_schedule
  FOR EACH ROW EXECUTE FUNCTION reject_mutation();
CREATE TRIGGER ai_amortization_schedule_line_append_only BEFORE UPDATE OR DELETE ON ai_amortization_schedule_line
  FOR EACH ROW EXECUTE FUNCTION reject_mutation();

CREATE FUNCTION refs_propose_ai_amortization_schedule_hash(
  p_tenant uuid,p_entity uuid,p_source uuid,p_source_payload_hash text,p_coverage_start date,p_coverage_end date,
  p_prepaid_account text,p_expense_account text,p_member_trace jsonb,p_confidence numeric,p_reason text
) RETURNS text LANGUAGE sql IMMUTABLE SET search_path=pg_catalog,public,pg_temp AS $$
  SELECT refs_jsonb_hash(jsonb_build_object(
    'schema_version','AI_AMORTIZATION_PROPOSAL_V1','tenant_id',p_tenant,'entity_id',p_entity,
    'source_document_id',p_source,'source_payload_hash',p_source_payload_hash,'coverage_start',p_coverage_start,
    'coverage_end',p_coverage_end,'prepaid_account_code',btrim(p_prepaid_account),
    'expense_account_code',btrim(p_expense_account),'member_trace',p_member_trace,'confidence',p_confidence,
    'reason',btrim(p_reason)
  ))
$$;

CREATE FUNCTION refs_propose_ai_amortization_schedule(
  p_tenant uuid,p_entity uuid,p_source uuid,p_source_payload_hash text,p_coverage_start date,p_coverage_end date,
  p_prepaid_account text,p_expense_account text,p_member_trace jsonb,p_confidence numeric,p_reason text,
  p_idempotency_key text,p_request_hash text
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE actor text:=refs_current_actor(); idem idempotency_receipt; source source_document;
DECLARE schedule_id uuid:=gen_random_uuid(); proposal_hash text; months integer; base_amount numeric(20,4); last_amount numeric(20,4);
DECLARE project_ref text; property_ref text; trace_basis text; source_project_refs text[]; source_property_refs text[];
DECLARE result jsonb; event_payload jsonb;
BEGIN
  PERFORM refs_assert_scope(p_tenant,p_entity,'AI.AMORTIZATION.PROPOSE');
  IF actor IS NULL THEN RAISE EXCEPTION 'Authenticated amortization proposer missing' USING ERRCODE='42501'; END IF;
  IF p_request_hash<>refs_propose_ai_amortization_schedule_hash(p_tenant,p_entity,p_source,p_source_payload_hash,p_coverage_start,p_coverage_end,p_prepaid_account,p_expense_account,p_member_trace,p_confidence,p_reason) THEN
    RAISE EXCEPTION 'AI amortization proposal request hash is not canonical' USING ERRCODE='22023';
  END IF;
  IF p_source_payload_hash !~ '^sha256:[0-9a-f]{64}$' OR p_coverage_start IS NULL OR p_coverage_end IS NULL
     OR p_coverage_start<>date_trunc('month',p_coverage_start)::date OR p_coverage_end<>(date_trunc('month',p_coverage_end)+interval '1 month - 1 day')::date
     OR p_coverage_end<p_coverage_start OR btrim(COALESCE(p_prepaid_account,''))='' OR btrim(COALESCE(p_expense_account,''))=''
     OR p_member_trace IS NULL OR jsonb_typeof(p_member_trace)<>'object' OR COALESCE(length(btrim(p_reason)),0) NOT BETWEEN 8 AND 2000
     OR p_confidence IS NULL OR p_confidence<0 OR p_confidence>1 THEN
    RAISE EXCEPTION 'AI amortization proposal requires exact source hash, whole-month coverage, accounts, member trace, confidence, and reason' USING ERRCODE='22023';
  END IF;
  project_ref:=NULLIF(btrim(p_member_trace->>'project_ref'),''); property_ref:=NULLIF(btrim(p_member_trace->>'property_ref'),''); trace_basis:=p_member_trace->>'allocation_basis';
  IF trace_basis NOT IN ('ENTITY_ONLY','SOURCE_DIMENSIONED') OR (trace_basis='ENTITY_ONLY' AND (project_ref IS NOT NULL OR property_ref IS NOT NULL)) THEN
    RAISE EXCEPTION 'AI amortization member trace must explicitly be ENTITY_ONLY or source-dimensioned' USING ERRCODE='22023';
  END IF;
  months:=((extract(year from p_coverage_end)::integer-extract(year from p_coverage_start)::integer)*12+extract(month from p_coverage_end)::integer-extract(month from p_coverage_start)::integer)+1;
  IF months<1 OR months>120 THEN RAISE EXCEPTION 'AI amortization coverage must contain between one and 120 whole months' USING ERRCODE='22023'; END IF;

  INSERT INTO idempotency_receipt(tenant_id,operation_scope,idempotency_key,request_hash,status,actor_id)
    VALUES(p_tenant,'AI_AMORTIZATION_PROPOSAL:'||p_entity,p_idempotency_key,p_request_hash,'IN_PROGRESS',actor)
    ON CONFLICT(tenant_id,operation_scope,idempotency_key) DO NOTHING;
  SELECT * INTO idem FROM idempotency_receipt WHERE tenant_id=p_tenant AND operation_scope='AI_AMORTIZATION_PROPOSAL:'||p_entity AND idempotency_key=p_idempotency_key FOR UPDATE;
  IF idem.request_hash<>p_request_hash THEN RAISE EXCEPTION 'Idempotency key reused with a different AI amortization proposal' USING ERRCODE='23505'; END IF;
  IF idem.status='SUCCEEDED' THEN RETURN idem.response_body||jsonb_build_object('idempotent',true); END IF;

  SELECT * INTO source FROM source_document WHERE tenant_id=p_tenant AND entity_id=p_entity AND source_document_id=p_source FOR SHARE;
  IF NOT FOUND OR source.payload_hash<>p_source_payload_hash OR source.status<>'READY_FOR_DRAFT' OR source.gross_amount<=0 THEN
    RAISE EXCEPTION 'AI amortization proposal source is missing, changed, not review-ready, or has no positive amount' USING ERRCODE='23514';
  END IF;
  IF p_prepaid_account=p_expense_account THEN RAISE EXCEPTION 'AI amortization prepaid and expense accounts must differ' USING ERRCODE='22023'; END IF;
  PERFORM 1 FROM account_master WHERE tenant_id=p_tenant AND entity_id=p_entity AND account_code=btrim(p_prepaid_account) AND active FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'AI amortization prepaid account is inactive or missing' USING ERRCODE='23503'; END IF;
  PERFORM 1 FROM account_master WHERE tenant_id=p_tenant AND entity_id=p_entity AND account_code=btrim(p_expense_account) AND active FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'AI amortization expense account is inactive or missing' USING ERRCODE='23503'; END IF;
  SELECT array_agg(DISTINCT NULLIF(btrim(sdl.project_ref),'')),array_agg(DISTINCT NULLIF(btrim(sdl.property_ref),'')) INTO source_project_refs,source_property_refs
    FROM source_document_line sdl WHERE sdl.tenant_id=p_tenant AND sdl.entity_id=p_entity AND sdl.source_document_id=p_source;
  IF trace_basis='ENTITY_ONLY' AND (COALESCE(cardinality(array_remove(source_project_refs,NULL)),0)>0 OR COALESCE(cardinality(array_remove(source_property_refs,NULL)),0)>0)
     OR trace_basis='SOURCE_DIMENSIONED' AND (
       project_ref IS DISTINCT FROM CASE WHEN cardinality(array_remove(source_project_refs,NULL))=1 THEN (array_remove(source_project_refs,NULL))[1] ELSE NULL END
       OR property_ref IS DISTINCT FROM CASE WHEN cardinality(array_remove(source_property_refs,NULL))=1 THEN (array_remove(source_property_refs,NULL))[1] ELSE NULL END) THEN
    RAISE EXCEPTION 'AI amortization member trace is absent, ambiguous, or does not exactly match the source' USING ERRCODE='23514';
  END IF;
  proposal_hash:=p_request_hash;
  IF EXISTS(SELECT 1 FROM ai_amortization_schedule WHERE tenant_id=p_tenant AND entity_id=p_entity AND source_document_id=p_source) THEN
    RAISE EXCEPTION 'Source document already has an immutable AI amortization proposal' USING ERRCODE='23505';
  END IF;
  base_amount:=trunc(source.gross_amount/months,4); last_amount:=source.gross_amount-(base_amount*(months-1));
  INSERT INTO ai_amortization_schedule(ai_amortization_schedule_id,tenant_id,entity_id,source_document_id,source_payload_hash,source_document_version,
    rule_id,analysis_mode,confidence,coverage_start,coverage_end,currency,original_amount,prepaid_account_code,expense_account_code,member_trace,proposal_reason,proposal_hash,created_by)
  VALUES(schedule_id,p_tenant,p_entity,p_source,source.payload_hash,source.version,'PREPAID_AMORTIZATION_V1','DETERMINISTIC_EVIDENCE_BACKED',p_confidence,
    p_coverage_start,p_coverage_end,source.currency,source.gross_amount,btrim(p_prepaid_account),btrim(p_expense_account),p_member_trace,btrim(p_reason),proposal_hash,actor);
  INSERT INTO ai_amortization_schedule_line(tenant_id,entity_id,ai_amortization_schedule_id,line_no,amortization_month,amount,source_payload_hash)
  SELECT p_tenant,p_entity,schedule_id,ordinality,month::date,CASE WHEN ordinality=months THEN last_amount ELSE base_amount END,source.payload_hash
  FROM generate_series(date_trunc('month',p_coverage_start),date_trunc('month',p_coverage_end),interval '1 month') WITH ORDINALITY AS m(month,ordinality);
  event_payload:=jsonb_build_object('schema_version','AI_AMORTIZATION_PROPOSAL_V1','ai_amortization_schedule_id',schedule_id,'source_document_id',p_source,
    'source_payload_hash',source.payload_hash,'coverage_start',p_coverage_start,'coverage_end',p_coverage_end,'line_count',months,'original_amount',source.gross_amount,
    'status','PROPOSED','can_create_draft',false,'can_review',false,'can_approve',false,'can_post',false);
  INSERT INTO audit_event(tenant_id,entity_id,event_type,object_type,object_id,action,actor_id,actor_type,permission_used,request_id,correlation_id,idempotency_key,after_hash,reason,metadata)
    VALUES(p_tenant,p_entity,'AI_AMORTIZATION_PROPOSED','AI_AMORTIZATION_SCHEDULE',schedule_id,'PROPOSE',actor,'USER','AI.AMORTIZATION.PROPOSE',p_idempotency_key,p_idempotency_key,p_idempotency_key,proposal_hash,btrim(p_reason),event_payload);
  INSERT INTO outbox_event(tenant_id,entity_id,aggregate_type,aggregate_id,event_type,payload,payload_hash)
    VALUES(p_tenant,p_entity,'AI_AMORTIZATION_SCHEDULE',schedule_id,'AI_AMORTIZATION_PROPOSED',event_payload,refs_jsonb_hash(event_payload));
  result:=event_payload||jsonb_build_object('idempotent',false);
  UPDATE idempotency_receipt SET status='SUCCEEDED',response_status=201,response_body=result,completed_at=clock_timestamp() WHERE idempotency_receipt_id=idem.idempotency_receipt_id;
  RETURN result;
END;
$$;

REVOKE ALL ON ai_amortization_schedule,ai_amortization_schedule_line FROM PUBLIC,refs_app;
REVOKE EXECUTE ON FUNCTION refs_propose_ai_amortization_schedule_hash(uuid,uuid,uuid,text,date,date,text,text,jsonb,numeric,text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION refs_propose_ai_amortization_schedule(uuid,uuid,uuid,text,date,date,text,text,jsonb,numeric,text,text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION refs_propose_ai_amortization_schedule_hash(uuid,uuid,uuid,text,date,date,text,text,jsonb,numeric,text) TO refs_app;
GRANT EXECUTE ON FUNCTION refs_propose_ai_amortization_schedule(uuid,uuid,uuid,text,date,date,text,text,jsonb,numeric,text,text,text) TO refs_app;

COMMIT;
