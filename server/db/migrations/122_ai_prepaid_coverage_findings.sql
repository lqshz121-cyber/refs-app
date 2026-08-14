BEGIN;

-- A deterministic exception for source documents that explicitly look like an
-- insurance/prepaid item but do not yet carry whole-month coverage evidence.
-- It is an audit finding only: it never creates a journal, a Draft request,
-- or a workflow transition.
CREATE TABLE ai_prepaid_coverage_finding (
  ai_prepaid_coverage_finding_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant(tenant_id),
  entity_id uuid NOT NULL,
  source_document_id uuid NOT NULL,
  source_document_line_id uuid NOT NULL,
  source_payload_hash text NOT NULL CHECK(source_payload_hash~'^sha256:[0-9a-f]{64}$'),
  source_document_version bigint NOT NULL CHECK(source_document_version>=0),
  source_line_hash text NOT NULL CHECK(source_line_hash~'^sha256:[0-9a-f]{64}$'),
  finding_hash text NOT NULL CHECK(finding_hash~'^sha256:[0-9a-f]{64}$'),
  rule_id text NOT NULL CHECK(rule_id='PREPAID_COVERAGE_REQUIRED'),
  risk_level text NOT NULL CHECK(risk_level='MEDIUM'),
  confidence numeric(5,4) NOT NULL CHECK(confidence=0.9500),
  status text NOT NULL DEFAULT 'OPEN' CHECK(status='OPEN'),
  reason text NOT NULL CHECK(length(btrim(reason)) BETWEEN 8 AND 2000),
  suggested_action text NOT NULL CHECK(length(btrim(suggested_action)) BETWEEN 8 AND 2000),
  suggested_owner text NOT NULL CHECK(suggested_owner='CONTROLLER'),
  due_date date,
  due_date_status text NOT NULL CHECK(due_date_status='HUMAN_ASSIGNMENT_REQUIRED'),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE(tenant_id,entity_id,ai_prepaid_coverage_finding_id),
  UNIQUE(tenant_id,entity_id,source_document_line_id,source_document_version,rule_id),
  UNIQUE(tenant_id,entity_id,finding_hash),
  FOREIGN KEY(tenant_id,entity_id) REFERENCES entity(tenant_id,entity_id),
  FOREIGN KEY(tenant_id,entity_id,source_document_id) REFERENCES source_document(tenant_id,entity_id,source_document_id),
  FOREIGN KEY(tenant_id,entity_id,source_document_line_id) REFERENCES source_document_line(tenant_id,entity_id,source_document_line_id)
);
ALTER TABLE ai_prepaid_coverage_finding ENABLE ROW LEVEL SECURITY;
CREATE POLICY ai_prepaid_coverage_finding_scope ON ai_prepaid_coverage_finding
  USING(tenant_id=refs_current_tenant() AND refs_entity_allowed(entity_id))
  WITH CHECK(tenant_id=refs_current_tenant() AND refs_entity_allowed(entity_id));
CREATE TRIGGER ai_prepaid_coverage_finding_append_only BEFORE UPDATE OR DELETE ON ai_prepaid_coverage_finding
  FOR EACH ROW EXECUTE FUNCTION reject_mutation();

CREATE FUNCTION refs_materialize_ai_prepaid_coverage_finding(p_source_line uuid) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE line_row source_document_line; document_row source_document; result_id uuid:=gen_random_uuid(); line_hash text; finding_hash text; payload jsonb; actor text:=COALESCE(refs_current_actor(),'SYSTEM');
BEGIN
  SELECT * INTO line_row FROM source_document_line WHERE source_document_line_id=p_source_line FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'AI prepaid finding source line is absent' USING ERRCODE='23503'; END IF;
  SELECT * INTO document_row FROM source_document WHERE tenant_id=line_row.tenant_id AND entity_id=line_row.entity_id AND source_document_id=line_row.source_document_id FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'AI prepaid finding source document is absent' USING ERRCODE='23503'; END IF;
  IF document_row.status<>'READY_FOR_DRAFT' OR COALESCE(line_row.description,'') !~* '(^|[^a-z])(insurance|policy|premium)([^a-z]|$)' THEN RETURN NULL; END IF;
  IF EXISTS(SELECT 1 FROM ai_amortization_coverage_evidence e WHERE e.tenant_id=document_row.tenant_id AND e.entity_id=document_row.entity_id AND e.source_document_id=document_row.source_document_id AND e.source_document_version=document_row.version AND e.source_payload_hash=document_row.payload_hash) THEN RETURN NULL; END IF;
  line_hash:=refs_jsonb_hash(jsonb_build_object('schema_version','AI_PREPAID_COVERAGE_FINDING_V1','source_document_line_id',line_row.source_document_line_id,'source_line_id',line_row.source_line_id,'line_no',line_row.line_no,'description',line_row.description,'amount',line_row.amount,'project_ref',line_row.project_ref,'property_ref',line_row.property_ref));
  finding_hash:=refs_jsonb_hash(jsonb_build_object('schema_version','AI_PREPAID_COVERAGE_FINDING_V1','tenant_id',document_row.tenant_id,'entity_id',document_row.entity_id,'source_document_id',document_row.source_document_id,'source_document_version',document_row.version,'source_payload_hash',document_row.payload_hash,'source_line_hash',line_hash,'rule_id','PREPAID_COVERAGE_REQUIRED'));
  INSERT INTO ai_prepaid_coverage_finding(ai_prepaid_coverage_finding_id,tenant_id,entity_id,source_document_id,source_document_line_id,source_payload_hash,source_document_version,source_line_hash,finding_hash,rule_id,risk_level,confidence,reason,suggested_action,suggested_owner,due_date,due_date_status)
  VALUES(result_id,document_row.tenant_id,document_row.entity_id,document_row.source_document_id,line_row.source_document_line_id,document_row.payload_hash,document_row.version,line_hash,finding_hash,'PREPAID_COVERAGE_REQUIRED','MEDIUM',0.9500,'A source line explicitly references insurance, policy, or premium but the same source version has no retained whole-month coverage evidence.','Obtain the policy coverage start and end dates, retain source evidence, then request controller review of a prepaid amortization proposal.','CONTROLLER',NULL,'HUMAN_ASSIGNMENT_REQUIRED')
  ON CONFLICT(tenant_id,entity_id,source_document_line_id,source_document_version,rule_id) DO NOTHING
  RETURNING ai_prepaid_coverage_finding_id INTO result_id;
  IF result_id IS NULL THEN RETURN NULL; END IF;
  payload:=jsonb_build_object('schema_version','AI_PREPAID_COVERAGE_FINDING_V1','ai_prepaid_coverage_finding_id',result_id,'source_document_id',document_row.source_document_id,'source_document_line_id',line_row.source_document_line_id,'source_payload_hash',document_row.payload_hash,'source_document_version',document_row.version,'source_line_hash',line_hash,'rule_id','PREPAID_COVERAGE_REQUIRED','risk_level','MEDIUM','confidence',0.9500,'can_create_draft',false,'can_review',false,'can_approve',false,'can_post',false);
  INSERT INTO audit_event(tenant_id,entity_id,event_type,object_type,object_id,action,actor_id,actor_type,request_id,correlation_id,after_hash,reason,metadata)
  VALUES(document_row.tenant_id,document_row.entity_id,'AI_PREPAID_COVERAGE_FINDING_MATERIALIZED','AI_PREPAID_COVERAGE_FINDING',result_id,'MATERIALIZE',actor,'SYSTEM','AI_PREPAID_COVERAGE:'||result_id,'AI_PREPAID_COVERAGE:'||result_id,finding_hash,'Deterministic insurance/prepaid coverage evidence gap',payload);
  INSERT INTO outbox_event(tenant_id,entity_id,aggregate_type,aggregate_id,event_type,payload,payload_hash)
  VALUES(document_row.tenant_id,document_row.entity_id,'AI_PREPAID_COVERAGE_FINDING',result_id,'AI_PREPAID_COVERAGE_FINDING_MATERIALIZED',payload,refs_jsonb_hash(payload));
  RETURN result_id;
END;
$$;

CREATE FUNCTION refs_materialize_ai_prepaid_coverage_finding_from_line_trigger() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$ BEGIN PERFORM refs_materialize_ai_prepaid_coverage_finding(NEW.source_document_line_id); RETURN NEW; END; $$;
CREATE TRIGGER materialize_ai_prepaid_coverage_finding_from_line AFTER INSERT OR UPDATE OF description ON source_document_line
  FOR EACH ROW EXECUTE FUNCTION refs_materialize_ai_prepaid_coverage_finding_from_line_trigger();

CREATE FUNCTION refs_materialize_ai_prepaid_coverage_findings_from_document_trigger() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$ DECLARE source_line uuid; BEGIN
  IF NEW.status='READY_FOR_DRAFT' THEN FOR source_line IN SELECT source_document_line_id FROM source_document_line WHERE tenant_id=NEW.tenant_id AND entity_id=NEW.entity_id AND source_document_id=NEW.source_document_id LOOP PERFORM refs_materialize_ai_prepaid_coverage_finding(source_line); END LOOP; END IF;
  RETURN NEW;
END; $$;
CREATE TRIGGER materialize_ai_prepaid_coverage_findings_from_document AFTER UPDATE OF status ON source_document
  FOR EACH ROW EXECUTE FUNCTION refs_materialize_ai_prepaid_coverage_findings_from_document_trigger();

CREATE FUNCTION refs_read_ai_prepaid_coverage_findings(p_tenant uuid,p_entity uuid,p_limit integer DEFAULT 50)
RETURNS TABLE(ai_prepaid_coverage_finding_id uuid,source_document_id uuid,source_document_line_id uuid,source_payload_hash text,source_document_version bigint,source_line_hash text,rule_id text,risk_level text,confidence numeric,status text,reason text,suggested_action text,suggested_owner text,due_date date,due_date_status text,created_at timestamptz,can_create_draft boolean,can_review boolean,can_approve boolean,can_post boolean)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$ BEGIN
  PERFORM refs_assert_scope(p_tenant,p_entity,'AI.AMORTIZATION.PROPOSE');
  IF p_limit IS NULL OR p_limit<1 OR p_limit>100 THEN RAISE EXCEPTION 'AI prepaid coverage finding limit must be between 1 and 100' USING ERRCODE='22023'; END IF;
  RETURN QUERY SELECT f.ai_prepaid_coverage_finding_id,f.source_document_id,f.source_document_line_id,f.source_payload_hash,f.source_document_version,f.source_line_hash,f.rule_id,f.risk_level,f.confidence,f.status,f.reason,f.suggested_action,f.suggested_owner,f.due_date,f.due_date_status,f.created_at,false,false,false,false FROM ai_prepaid_coverage_finding f WHERE f.tenant_id=p_tenant AND f.entity_id=p_entity ORDER BY f.created_at DESC,f.ai_prepaid_coverage_finding_id DESC LIMIT p_limit;
END; $$;

REVOKE ALL ON ai_prepaid_coverage_finding FROM PUBLIC,refs_app;
REVOKE ALL ON FUNCTION refs_materialize_ai_prepaid_coverage_finding(uuid) FROM PUBLIC,refs_app;
REVOKE ALL ON FUNCTION refs_read_ai_prepaid_coverage_findings(uuid,uuid,integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION refs_read_ai_prepaid_coverage_findings(uuid,uuid,integer) TO refs_app;

COMMIT;
