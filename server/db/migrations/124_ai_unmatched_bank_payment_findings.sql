BEGIN;

-- A retained AI Audit observation, not a bank-reconciliation command.  It
-- never updates bank_source or bank_match and cannot create accounting work.
CREATE TABLE ai_unmatched_bank_payment_finding (
  ai_unmatched_bank_payment_finding_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant(tenant_id),
  entity_id uuid NOT NULL,
  bank_source_id uuid NOT NULL,
  source_document_id uuid NOT NULL,
  source_payload_hash text NOT NULL CHECK(source_payload_hash~'^sha256:[0-9a-f]{64}$'),
  source_document_version bigint NOT NULL CHECK(source_document_version>=0),
  bank_account_ref text NOT NULL CHECK(length(btrim(bank_account_ref)) BETWEEN 1 AND 128),
  external_bank_line_id text NOT NULL CHECK(length(btrim(external_bank_line_id)) BETWEEN 1 AND 256),
  transaction_date date NOT NULL,
  currency char(3) NOT NULL CHECK(currency~'^[A-Z]{3}$'),
  amount numeric(20,4) NOT NULL CHECK(amount<0),
  bank_version bigint NOT NULL CHECK(bank_version>=0),
  finding_hash text NOT NULL CHECK(finding_hash~'^sha256:[0-9a-f]{64}$'),
  rule_id text NOT NULL CHECK(rule_id='BANK_PAYMENT_UNMATCHED'),
  risk_level text NOT NULL CHECK(risk_level='MEDIUM'),
  confidence numeric(5,4) NOT NULL CHECK(confidence=1.0000),
  status text NOT NULL DEFAULT 'OPEN' CHECK(status='OPEN'),
  reason text NOT NULL CHECK(length(btrim(reason)) BETWEEN 8 AND 2000),
  suggested_action text NOT NULL CHECK(length(btrim(suggested_action)) BETWEEN 8 AND 2000),
  suggested_owner text NOT NULL CHECK(suggested_owner='CONTROLLER'),
  due_date date,
  due_date_status text NOT NULL CHECK(due_date_status='HUMAN_ASSIGNMENT_REQUIRED'),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE(tenant_id,entity_id,ai_unmatched_bank_payment_finding_id),
  UNIQUE(tenant_id,entity_id,bank_source_id,rule_id),
  UNIQUE(tenant_id,entity_id,finding_hash),
  FOREIGN KEY(tenant_id,entity_id) REFERENCES entity(tenant_id,entity_id),
  FOREIGN KEY(bank_source_id) REFERENCES bank_source(bank_source_id),
  FOREIGN KEY(source_document_id) REFERENCES source_document(source_document_id)
);
ALTER TABLE ai_unmatched_bank_payment_finding ENABLE ROW LEVEL SECURITY;
CREATE POLICY ai_unmatched_bank_payment_finding_scope ON ai_unmatched_bank_payment_finding
  USING(tenant_id=refs_current_tenant() AND refs_entity_allowed(entity_id))
  WITH CHECK(tenant_id=refs_current_tenant() AND refs_entity_allowed(entity_id));
CREATE TRIGGER ai_unmatched_bank_payment_finding_append_only BEFORE UPDATE OR DELETE ON ai_unmatched_bank_payment_finding
  FOR EACH ROW EXECUTE FUNCTION reject_mutation();

CREATE FUNCTION refs_materialize_ai_unmatched_bank_payment_finding(p_bank_source uuid) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE bank_row bank_source; document_row source_document; result_id uuid; finding_hash text; payload jsonb; actor text:=COALESCE(refs_current_actor(),'SYSTEM');
BEGIN
  SELECT b.* INTO bank_row FROM bank_source b WHERE b.bank_source_id=p_bank_source FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'AI unmatched bank finding source is absent' USING ERRCODE='23503'; END IF;
  IF bank_row.amount>=0 OR EXISTS(SELECT 1 FROM bank_match m WHERE m.tenant_id=bank_row.tenant_id AND m.entity_id=bank_row.entity_id AND m.bank_source_id=bank_row.bank_source_id AND m.status='ACTIVE') THEN RETURN NULL; END IF;
  SELECT d.* INTO document_row FROM source_document d WHERE d.tenant_id=bank_row.tenant_id AND d.entity_id=bank_row.entity_id AND d.source_document_id=bank_row.source_document_id FOR SHARE;
  IF NOT FOUND OR document_row.payload_hash !~ '^sha256:[0-9a-f]{64}$' THEN RAISE EXCEPTION 'AI unmatched bank finding requires retained source hash' USING ERRCODE='23503'; END IF;
  finding_hash:=refs_jsonb_hash(jsonb_build_object('schema_version','AI_UNMATCHED_BANK_PAYMENT_V1','tenant_id',bank_row.tenant_id,'entity_id',bank_row.entity_id,'bank_source_id',bank_row.bank_source_id,'source_document_id',document_row.source_document_id,'source_payload_hash',document_row.payload_hash,'source_document_version',document_row.version,'bank_version',bank_row.version,'bank_account_ref',bank_row.bank_account_ref,'external_bank_line_id',bank_row.external_bank_line_id,'transaction_date',bank_row.transaction_date,'currency',bank_row.currency,'amount',bank_row.amount,'rule_id','BANK_PAYMENT_UNMATCHED'));
  INSERT INTO ai_unmatched_bank_payment_finding(ai_unmatched_bank_payment_finding_id,tenant_id,entity_id,bank_source_id,source_document_id,source_payload_hash,source_document_version,bank_account_ref,external_bank_line_id,transaction_date,currency,amount,bank_version,finding_hash,rule_id,risk_level,confidence,reason,suggested_action,suggested_owner,due_date,due_date_status)
  VALUES(gen_random_uuid(),bank_row.tenant_id,bank_row.entity_id,bank_row.bank_source_id,document_row.source_document_id,document_row.payload_hash,document_row.version,bank_row.bank_account_ref,bank_row.external_bank_line_id,bank_row.transaction_date,bank_row.currency,bank_row.amount,bank_row.version,finding_hash,'BANK_PAYMENT_UNMATCHED','MEDIUM',1.0000,'A retained bank payment has no active AP, source-document, or posted-payment match at the time of analysis. This finding does not change the bank line.','Compare the payment against payable evidence and retain a controller conclusion before any matching, Draft, or payment action.','CONTROLLER',NULL,'HUMAN_ASSIGNMENT_REQUIRED')
  ON CONFLICT(tenant_id,entity_id,bank_source_id,rule_id) DO NOTHING
  RETURNING ai_unmatched_bank_payment_finding_id INTO result_id;
  IF result_id IS NULL THEN RETURN NULL; END IF;
  payload:=jsonb_build_object('schema_version','AI_UNMATCHED_BANK_PAYMENT_V1','ai_unmatched_bank_payment_finding_id',result_id,'bank_source_id',bank_row.bank_source_id,'source_document_id',document_row.source_document_id,'source_payload_hash',document_row.payload_hash,'source_document_version',document_row.version,'bank_version',bank_row.version,'rule_id','BANK_PAYMENT_UNMATCHED','risk_level','MEDIUM','confidence',1.0000,'can_create_draft',false,'can_review',false,'can_approve',false,'can_post',false);
  INSERT INTO audit_event(tenant_id,entity_id,event_type,object_type,object_id,action,actor_id,actor_type,request_id,correlation_id,after_hash,reason,metadata)
    VALUES(bank_row.tenant_id,bank_row.entity_id,'AI_UNMATCHED_BANK_PAYMENT_FINDING_MATERIALIZED','AI_UNMATCHED_BANK_PAYMENT_FINDING',result_id,'MATERIALIZE',actor,'SYSTEM','AI_UNMATCHED_BANK_PAYMENT:'||result_id,'AI_UNMATCHED_BANK_PAYMENT:'||result_id,finding_hash,'Deterministic unmatched bank-payment evidence finding',payload);
  INSERT INTO outbox_event(tenant_id,entity_id,aggregate_type,aggregate_id,event_type,payload,payload_hash)
    VALUES(bank_row.tenant_id,bank_row.entity_id,'AI_UNMATCHED_BANK_PAYMENT_FINDING',result_id,'AI_UNMATCHED_BANK_PAYMENT_FINDING_MATERIALIZED',payload,refs_jsonb_hash(payload));
  RETURN result_id;
END;
$$;

CREATE FUNCTION refs_materialize_ai_unmatched_bank_payment_finding_from_bank_trigger() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$ BEGIN PERFORM refs_materialize_ai_unmatched_bank_payment_finding(NEW.bank_source_id); RETURN NEW; END; $$;
CREATE FUNCTION refs_materialize_ai_unmatched_bank_payment_finding_from_match_trigger() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$ BEGIN IF NEW.status<>'ACTIVE' THEN PERFORM refs_materialize_ai_unmatched_bank_payment_finding(NEW.bank_source_id); END IF; RETURN NEW; END; $$;
CREATE TRIGGER materialize_ai_unmatched_bank_payment_finding_from_bank AFTER INSERT OR UPDATE OF amount,transaction_date,currency,version ON bank_source
  FOR EACH ROW EXECUTE FUNCTION refs_materialize_ai_unmatched_bank_payment_finding_from_bank_trigger();
CREATE TRIGGER materialize_ai_unmatched_bank_payment_finding_from_match AFTER INSERT OR UPDATE OF status ON bank_match
  FOR EACH ROW EXECUTE FUNCTION refs_materialize_ai_unmatched_bank_payment_finding_from_match_trigger();

CREATE FUNCTION refs_read_ai_unmatched_bank_payment_findings(p_tenant uuid,p_entity uuid,p_limit integer DEFAULT 50)
RETURNS TABLE(ai_unmatched_bank_payment_finding_id uuid,bank_source_id uuid,source_document_id uuid,source_payload_hash text,source_document_version bigint,bank_account_ref text,external_bank_line_id text,transaction_date date,currency char(3),amount numeric,bank_version bigint,rule_id text,risk_level text,confidence numeric,status text,current_match_state text,reason text,suggested_action text,suggested_owner text,due_date date,due_date_status text,created_at timestamptz,can_create_draft boolean,can_review boolean,can_approve boolean,can_post boolean)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
BEGIN
  PERFORM refs_assert_scope(p_tenant,p_entity,'AI.AMORTIZATION.PROPOSE');
  IF p_limit IS NULL OR p_limit<1 OR p_limit>100 THEN RAISE EXCEPTION 'AI unmatched bank finding limit must be between 1 and 100' USING ERRCODE='22023'; END IF;
  RETURN QUERY SELECT f.ai_unmatched_bank_payment_finding_id,f.bank_source_id,f.source_document_id,f.source_payload_hash,f.source_document_version,f.bank_account_ref,f.external_bank_line_id,f.transaction_date,f.currency,f.amount,f.bank_version,f.rule_id,f.risk_level,f.confidence,f.status,CASE WHEN EXISTS(SELECT 1 FROM bank_match m WHERE m.tenant_id=f.tenant_id AND m.entity_id=f.entity_id AND m.bank_source_id=f.bank_source_id AND m.status='ACTIVE') THEN 'MATCHED_AFTER_FINDING' ELSE 'OPEN' END,f.reason,f.suggested_action,f.suggested_owner,f.due_date,f.due_date_status,f.created_at,false,false,false,false FROM ai_unmatched_bank_payment_finding f WHERE f.tenant_id=p_tenant AND f.entity_id=p_entity ORDER BY f.created_at DESC,f.ai_unmatched_bank_payment_finding_id DESC LIMIT p_limit;
END;
$$;

REVOKE ALL ON ai_unmatched_bank_payment_finding FROM PUBLIC,refs_app;
REVOKE ALL ON FUNCTION refs_materialize_ai_unmatched_bank_payment_finding(uuid) FROM PUBLIC,refs_app;
REVOKE ALL ON FUNCTION refs_read_ai_unmatched_bank_payment_findings(uuid,uuid,integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION refs_read_ai_unmatched_bank_payment_findings(uuid,uuid,integer) TO refs_app;

COMMIT;
