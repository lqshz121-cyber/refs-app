BEGIN;

CREATE TABLE ai_admitted_source_review_function_backup(function_identity text PRIMARY KEY,function_definition text NOT NULL);
INSERT INTO ai_admitted_source_review_function_backup VALUES
 ('assign',pg_get_functiondef('refs_assign_ai_finding_action(uuid,uuid,text,uuid,text,text,date,integer,text,text)'::regprocedure)),
 ('candidates',pg_get_functiondef('refs_read_ai_finding_assignment_candidates(uuid,uuid,integer)'::regprocedure));
REVOKE ALL ON ai_admitted_source_review_function_backup FROM PUBLIC,refs_app;

CREATE TABLE ai_admitted_source_review_finding(
  ai_admitted_source_review_finding_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,entity_id uuid NOT NULL,accounting_period_id uuid NOT NULL,
  wbs_final1_retained_source_row_id uuid NOT NULL,source_document_id uuid NOT NULL,source_document_line_id uuid NOT NULL,
  admission_hash text NOT NULL CHECK(admission_hash~'^sha256:[0-9a-f]{64}$'),
  source_payload_hash text NOT NULL CHECK(source_payload_hash~'^sha256:[0-9a-f]{64}$'),
  source_line_hash text NOT NULL CHECK(source_line_hash~'^sha256:[0-9a-f]{64}$'),
  evidence_hash text NOT NULL CHECK(evidence_hash~'^sha256:[0-9a-f]{64}$'),
  finding_type text NOT NULL CHECK(finding_type IN('ADMITTED_SOURCE_UNBOOKED','BLOCKED_SOURCE_INCOMPLETE')),
  finding_hash text NOT NULL CHECK(finding_hash~'^sha256:[0-9a-f]{64}$'),finding jsonb NOT NULL,
  created_by text NOT NULL,created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE(tenant_id,entity_id,ai_admitted_source_review_finding_id),
  UNIQUE(tenant_id,entity_id,source_document_line_id,evidence_hash,finding_type),
  FOREIGN KEY(tenant_id,entity_id) REFERENCES entity(tenant_id,entity_id),
  FOREIGN KEY(tenant_id,entity_id,accounting_period_id) REFERENCES accounting_period(tenant_id,entity_id,period_id),
  FOREIGN KEY(tenant_id,entity_id,wbs_final1_retained_source_row_id) REFERENCES wbs_final1_retained_source_row(tenant_id,entity_id,wbs_final1_retained_source_row_id),
  FOREIGN KEY(tenant_id,entity_id,source_document_id) REFERENCES source_document(tenant_id,entity_id,source_document_id),
  FOREIGN KEY(tenant_id,entity_id,source_document_line_id) REFERENCES source_document_line(tenant_id,entity_id,source_document_line_id),
  CHECK(jsonb_typeof(finding)='object' AND finding_hash=refs_jsonb_hash(finding)
    AND finding->>'schema_version'='AI_ADMITTED_SOURCE_RETAINED_FINDING_V1'
    AND finding->>'finding_type'=finding_type AND finding->>'risk_level'='HIGH'
    AND finding->>'owner_role'='CONTROLLER_REVIEW' AND finding->>'due_basis'='BEFORE_PERIOD_CLOSE'
    AND finding->'suggested_journal'='null'::jsonb
    AND finding->'action_flags'=jsonb_build_object('can_create_draft',false,'can_review',false,'can_approve',false,'can_post',false))
);
ALTER TABLE ai_admitted_source_review_finding ENABLE ROW LEVEL SECURITY;
CREATE POLICY ai_admitted_source_review_finding_scope ON ai_admitted_source_review_finding USING(tenant_id=refs_current_tenant() AND refs_entity_allowed(entity_id)) WITH CHECK(tenant_id=refs_current_tenant() AND refs_entity_allowed(entity_id));
CREATE TRIGGER ai_admitted_source_review_finding_append_only BEFORE UPDATE OR DELETE ON ai_admitted_source_review_finding FOR EACH ROW EXECUTE FUNCTION reject_mutation();

CREATE TABLE ai_admitted_source_review_lifecycle(
  ai_admitted_source_review_lifecycle_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),tenant_id uuid NOT NULL,entity_id uuid NOT NULL,
  ai_admitted_source_review_finding_id uuid NOT NULL,finding_hash text NOT NULL CHECK(finding_hash~'^sha256:[0-9a-f]{64}$'),
  disposition text NOT NULL CHECK(disposition='SUPERSEDED_BY_NEW_EVIDENCE'),successor_finding_id uuid,successor_finding_hash text CHECK(successor_finding_hash IS NULL OR successor_finding_hash~'^sha256:[0-9a-f]{64}$'),
  created_by text NOT NULL,created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE(tenant_id,entity_id,ai_admitted_source_review_finding_id),
  FOREIGN KEY(tenant_id,entity_id) REFERENCES entity(tenant_id,entity_id),
  FOREIGN KEY(tenant_id,entity_id,ai_admitted_source_review_finding_id) REFERENCES ai_admitted_source_review_finding(tenant_id,entity_id,ai_admitted_source_review_finding_id),
  FOREIGN KEY(tenant_id,entity_id,successor_finding_id) REFERENCES ai_admitted_source_review_finding(tenant_id,entity_id,ai_admitted_source_review_finding_id),
  CHECK((successor_finding_id IS NULL AND successor_finding_hash IS NULL) OR (successor_finding_id IS NOT NULL AND successor_finding_hash IS NOT NULL))
);
ALTER TABLE ai_admitted_source_review_lifecycle ENABLE ROW LEVEL SECURITY;
CREATE POLICY ai_admitted_source_review_lifecycle_scope ON ai_admitted_source_review_lifecycle USING(tenant_id=refs_current_tenant() AND refs_entity_allowed(entity_id)) WITH CHECK(tenant_id=refs_current_tenant() AND refs_entity_allowed(entity_id));
CREATE TRIGGER ai_admitted_source_review_lifecycle_append_only BEFORE UPDATE OR DELETE ON ai_admitted_source_review_lifecycle FOR EACH ROW EXECUTE FUNCTION reject_mutation();

CREATE VIEW ai_admitted_source_review_current_finding WITH(security_barrier=true) AS
SELECT f.* FROM ai_admitted_source_review_finding f WHERE NOT EXISTS(
 SELECT 1 FROM ai_admitted_source_review_lifecycle l WHERE l.tenant_id=f.tenant_id AND l.entity_id=f.entity_id AND l.ai_admitted_source_review_finding_id=f.ai_admitted_source_review_finding_id);

CREATE FUNCTION refs_refresh_ai_admitted_source_review(p_tenant uuid,p_entity uuid,p_source_document uuid,p_actor text) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE r record;ap_ids uuid[];journal_ids uuid[];ledger_ids uuid[];evidence jsonb;v_evidence_hash text;finding jsonb;v_finding_hash text;new_id uuid;prior record;action_row record;kind text;event_payload jsonb;action_payload jsonb;actor text:=COALESCE(NULLIF(btrim(p_actor),''),'SYSTEM');
BEGIN
  SELECT retained.*,admission.receipt_hash,document.payload_hash,document.status::text source_status,document.currency::text,document.accounting_date,document.business_date,line.party_ref,line.amount
    INTO r FROM wbs_final1_retained_source_row retained
    JOIN wbs_final1_retained_evidence_admission admission ON admission.tenant_id=retained.tenant_id AND admission.entity_id=retained.entity_id AND admission.wbs_final1_retained_evidence_admission_id=retained.wbs_final1_retained_evidence_admission_id
    JOIN source_document document ON document.tenant_id=retained.tenant_id AND document.entity_id=retained.entity_id AND document.source_document_id=retained.source_document_id
    JOIN source_document_line line ON line.tenant_id=retained.tenant_id AND line.entity_id=retained.entity_id AND line.source_document_line_id=retained.source_document_line_id
   WHERE retained.tenant_id=p_tenant AND retained.entity_id=p_entity AND retained.source_document_id=p_source_document AND retained.domain='PAYABLES';
  IF NOT FOUND THEN RETURN NULL;END IF;
  SELECT COALESCE(array_agg(business_document_id ORDER BY business_document_id),ARRAY[]::uuid[]) INTO ap_ids FROM business_document WHERE tenant_id=p_tenant AND entity_id=p_entity AND source_document_id=p_source_document AND document_kind='AP_BILL';
  SELECT COALESCE(array_agg(journal_entry_id ORDER BY journal_entry_id),ARRAY[]::uuid[]) INTO journal_ids FROM(SELECT DISTINCT journal_entry_id FROM source_link WHERE tenant_id=p_tenant AND entity_id=p_entity AND source_document_id=p_source_document AND journal_entry_id IS NOT NULL)x;
  SELECT COALESCE(array_agg(ledger_line_id ORDER BY ledger_line_id),ARRAY[]::uuid[]) INTO ledger_ids FROM(SELECT DISTINCT ll.ledger_line_id FROM source_link sl JOIN ledger_line ll ON ll.tenant_id=sl.tenant_id AND ll.entity_id=sl.entity_id AND ll.journal_entry_id=sl.journal_entry_id WHERE sl.tenant_id=p_tenant AND sl.entity_id=p_entity AND sl.source_document_id=p_source_document UNION SELECT DISTINCT ledger_line_id FROM source_link WHERE tenant_id=p_tenant AND entity_id=p_entity AND source_document_id=p_source_document AND ledger_line_id IS NOT NULL)x;
  evidence:=jsonb_build_object('schema_version','AI_ADMITTED_SOURCE_BOOKING_EVIDENCE_V1','tenant_id',p_tenant,'entity_id',p_entity,'accounting_period_id',r.accounting_period_id,'retained_source_row_id',r.wbs_final1_retained_source_row_id,'admission_hash',r.receipt_hash,'source_document_id',r.source_document_id,'source_document_line_id',r.source_document_line_id,'source_payload_hash',r.payload_hash,'source_line_hash',r.raw_row_hash,'retained_outcome',r.outcome,'exception_codes',r.exception_codes,'source_status',r.source_status,'ap_document_ids',to_jsonb(ap_ids),'journal_entry_ids',to_jsonb(journal_ids),'ledger_line_ids',to_jsonb(ledger_ids));
  v_evidence_hash:=refs_jsonb_hash(evidence);
  IF cardinality(ap_ids)>0 OR cardinality(journal_ids)>0 OR cardinality(ledger_ids)>0 THEN new_id:=NULL;
  ELSE
    kind:=CASE WHEN r.outcome='STAGING_REVIEW_REQUIRED' AND r.exception_codes='[]'::jsonb AND r.source_status='READY_FOR_DRAFT' THEN 'ADMITTED_SOURCE_UNBOOKED' ELSE 'BLOCKED_SOURCE_INCOMPLETE' END;
    finding:=jsonb_build_object('schema_version','AI_ADMITTED_SOURCE_RETAINED_FINDING_V1','finding_type',kind,'rule_id',CASE WHEN kind='ADMITTED_SOURCE_UNBOOKED' THEN 'ADMITTED_PAYABLE_WITH_ZERO_ACCOUNTING_MATCH_V1' ELSE 'ADMITTED_PAYABLE_SOURCE_INCOMPLETE_V1' END,'risk_level','HIGH','confidence',1,'owner_role','CONTROLLER_REVIEW','due_basis','BEFORE_PERIOD_CLOSE','tenant_id',p_tenant,'entity_id',p_entity,'accounting_period_id',r.accounting_period_id,'source_document_id',r.source_document_id,'source_document_line_id',r.source_document_line_id,'admission_hash',r.receipt_hash,'source_payload_hash',r.payload_hash,'source_line_hash',r.raw_row_hash,'evidence_hash',v_evidence_hash,'reason',CASE WHEN kind='ADMITTED_SOURCE_UNBOOKED' THEN 'An admitted Payable has no AP document, Journal, or ledger line in the exact accounting scope.' ELSE 'An admitted Payable remains blocked by retained source exceptions or source review status and has no accounting booking.' END,'suggested_action',CASE WHEN kind='ADMITTED_SOURCE_UNBOOKED' THEN 'A human accountant must compare the admitted source with AP and GL evidence before deciding whether a Draft Journal is appropriate.' ELSE 'A human controller must resolve the retained source exceptions before any accounting treatment is considered.' END,'suggested_journal',NULL,'action_flags',jsonb_build_object('can_create_draft',false,'can_review',false,'can_approve',false,'can_post',false));
    v_finding_hash:=refs_jsonb_hash(finding);
    INSERT INTO ai_admitted_source_review_finding(tenant_id,entity_id,accounting_period_id,wbs_final1_retained_source_row_id,source_document_id,source_document_line_id,admission_hash,source_payload_hash,source_line_hash,evidence_hash,finding_type,finding_hash,finding,created_by)
    VALUES(p_tenant,p_entity,r.accounting_period_id,r.wbs_final1_retained_source_row_id,r.source_document_id,r.source_document_line_id,r.receipt_hash,r.payload_hash,r.raw_row_hash,v_evidence_hash,kind,v_finding_hash,finding,actor)
    ON CONFLICT(tenant_id,entity_id,source_document_line_id,evidence_hash,finding_type) DO NOTHING RETURNING ai_admitted_source_review_finding_id INTO new_id;
    IF new_id IS NULL THEN SELECT f.ai_admitted_source_review_finding_id INTO STRICT new_id FROM ai_admitted_source_review_finding f WHERE f.tenant_id=p_tenant AND f.entity_id=p_entity AND f.source_document_line_id=r.source_document_line_id AND f.evidence_hash=v_evidence_hash AND f.finding_type=kind;
    ELSE
      event_payload:=jsonb_build_object('schema_version','AI_ADMITTED_SOURCE_RETAINED_FINDING_EVENT_V1','finding_id',new_id,'finding_hash',v_finding_hash,'finding_type',kind,'accounting_period_id',r.accounting_period_id,'source_document_id',r.source_document_id,'source_document_line_id',r.source_document_line_id,'evidence_hash',v_evidence_hash,'can_create_draft',false,'can_review',false,'can_approve',false,'can_post',false);
      INSERT INTO audit_event(tenant_id,entity_id,event_type,object_type,object_id,action,actor_id,actor_type,request_id,correlation_id,after_hash,reason,metadata) VALUES(p_tenant,p_entity,'AI_ADMITTED_SOURCE_REVIEW_FINDING_RETAINED','AI_ADMITTED_SOURCE_REVIEW_FINDING',new_id,'RETAIN',actor,'SYSTEM','AI_ADMITTED_SOURCE_REVIEW:'||new_id,'AI_ADMITTED_SOURCE_REVIEW:'||new_id,v_finding_hash,'Deterministic admitted-source booking review finding retained',event_payload);
      INSERT INTO outbox_event(tenant_id,entity_id,aggregate_type,aggregate_id,event_type,payload,payload_hash) VALUES(p_tenant,p_entity,'AI_ADMITTED_SOURCE_REVIEW_FINDING',new_id,'AI_ADMITTED_SOURCE_REVIEW_FINDING_RETAINED',event_payload,refs_jsonb_hash(event_payload));
    END IF;
  END IF;
  FOR prior IN SELECT f.ai_admitted_source_review_finding_id,f.finding_hash FROM ai_admitted_source_review_current_finding f WHERE f.tenant_id=p_tenant AND f.entity_id=p_entity AND f.source_document_line_id=r.source_document_line_id AND (new_id IS NULL OR f.ai_admitted_source_review_finding_id<>new_id) LOOP
    INSERT INTO ai_admitted_source_review_lifecycle(tenant_id,entity_id,ai_admitted_source_review_finding_id,finding_hash,disposition,successor_finding_id,successor_finding_hash,created_by) VALUES(p_tenant,p_entity,prior.ai_admitted_source_review_finding_id,prior.finding_hash,'SUPERSEDED_BY_NEW_EVIDENCE',new_id,CASE WHEN new_id IS NULL THEN NULL ELSE v_finding_hash END,actor) ON CONFLICT DO NOTHING;
    FOR action_row IN SELECT * FROM ai_finding_action a WHERE a.tenant_id=p_tenant AND a.entity_id=p_entity AND a.finding_kind='ADMITTED_SOURCE_REVIEW' AND a.finding_id=prior.ai_admitted_source_review_finding_id AND a.status='OPEN' FOR UPDATE LOOP
      UPDATE ai_finding_action SET status='RESOLVED',resolution_reason='Superseded automatically by newer authoritative booking or source evidence.',resolved_by=actor,resolved_at=clock_timestamp(),revision=revision+1 WHERE ai_finding_action_id=action_row.ai_finding_action_id;
      action_payload:=jsonb_build_object('schema_version','AI_ADMITTED_SOURCE_ACTION_SUPERSEDED_V1','ai_finding_action_id',action_row.ai_finding_action_id,'finding_id',prior.ai_admitted_source_review_finding_id,'finding_hash',prior.finding_hash,'successor_finding_id',new_id,'successor_finding_hash',CASE WHEN new_id IS NULL THEN NULL ELSE v_finding_hash END,'status','RESOLVED','revision',action_row.revision+1,'can_create_draft',false,'can_review',false,'can_approve',false,'can_post',false);
      INSERT INTO audit_event(tenant_id,entity_id,event_type,object_type,object_id,action,actor_id,actor_type,request_id,correlation_id,after_hash,reason,metadata) VALUES(p_tenant,p_entity,'AI_ADMITTED_SOURCE_ACTION_SUPERSEDED','AI_FINDING_ACTION',action_row.ai_finding_action_id,'SUPERSEDE',actor,'SYSTEM','AI_ADMITTED_SOURCE_SUPERSEDE:'||action_row.ai_finding_action_id,'AI_ADMITTED_SOURCE_SUPERSEDE:'||action_row.ai_finding_action_id,refs_jsonb_hash(action_payload),'Authoritative booking or source evidence superseded the admitted-source review action',action_payload);
      INSERT INTO outbox_event(tenant_id,entity_id,aggregate_type,aggregate_id,event_type,payload,payload_hash) VALUES(p_tenant,p_entity,'AI_FINDING_ACTION',action_row.ai_finding_action_id,'AI_ADMITTED_SOURCE_ACTION_SUPERSEDED',action_payload,refs_jsonb_hash(action_payload));
    END LOOP;
  END LOOP;
  RETURN new_id;
END $$;

CREATE FUNCTION refs_refresh_ai_admitted_source_review_trigger() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
BEGIN
  PERFORM refs_refresh_ai_admitted_source_review(NEW.tenant_id,NEW.entity_id,CASE WHEN TG_TABLE_NAME='wbs_final1_retained_source_row' THEN NEW.source_document_id ELSE NEW.source_document_id END,COALESCE(to_jsonb(NEW)->>'created_by',refs_current_actor(),'SYSTEM'));
  RETURN NEW;
END $$;
CREATE TRIGGER ai_admitted_source_review_after_retained AFTER INSERT ON wbs_final1_retained_source_row FOR EACH ROW WHEN(NEW.domain='PAYABLES') EXECUTE FUNCTION refs_refresh_ai_admitted_source_review_trigger();
CREATE TRIGGER ai_admitted_source_review_after_document AFTER UPDATE OF status,payload_hash ON source_document FOR EACH ROW EXECUTE FUNCTION refs_refresh_ai_admitted_source_review_trigger();
CREATE TRIGGER ai_admitted_source_review_after_business_document AFTER INSERT ON business_document FOR EACH ROW WHEN(NEW.source_document_id IS NOT NULL AND NEW.document_kind='AP_BILL') EXECUTE FUNCTION refs_refresh_ai_admitted_source_review_trigger();
CREATE TRIGGER ai_admitted_source_review_after_source_link AFTER INSERT ON source_link FOR EACH ROW WHEN(NEW.source_document_id IS NOT NULL) EXECUTE FUNCTION refs_refresh_ai_admitted_source_review_trigger();

ALTER TABLE ai_finding_action DROP CONSTRAINT ai_finding_action_finding_kind_check;
ALTER TABLE ai_finding_action ADD CONSTRAINT ai_finding_action_finding_kind_check CHECK(finding_kind IN('WBS_EXCEPTION','PREPAID_COVERAGE','DUPLICATE_PAYABLE','UNMATCHED_BANK_PAYMENT','BANK_DUPLICATE_PAYMENT','VENDOR_INVOICE_AMOUNT_SPIKE','VENDOR_INVOICE_FREQUENCY_SPIKE','VENDOR_INVOICE_AMOUNT_DROP','VENDOR_INVOICE_NEAR_DUPLICATE','MANUAL_JOURNAL_RISK','COST_DIMENSION','LOAN_REFERENCE','ADMITTED_SOURCE_REVIEW'));
DO $$ DECLARE definition text;BEGIN
 SELECT pg_get_functiondef('refs_assign_ai_finding_action(uuid,uuid,text,uuid,text,text,date,integer,text,text)'::regprocedure) INTO definition;
 definition:=replace(definition,'ELSE RAISE EXCEPTION ''AI finding kind is unsupported''','WHEN ''ADMITTED_SOURCE_REVIEW'' THEN SELECT finding_hash INTO actual_hash FROM ai_admitted_source_review_current_finding WHERE tenant_id=p_tenant AND entity_id=p_entity AND ai_admitted_source_review_finding_id=p_finding; ELSE RAISE EXCEPTION ''AI finding kind is unsupported''');
 IF position('ai_admitted_source_review_current_finding' IN definition)=0 THEN RAISE EXCEPTION 'Admitted-source assignment integration failed';END IF;EXECUTE definition;
 SELECT pg_get_functiondef('refs_read_ai_finding_assignment_candidates(uuid,uuid,integer)'::regprocedure) INTO definition;
 definition:=replace(definition,'UNION ALL SELECT ''COST_DIMENSION'',f.ai_cost_dimension_finding_id','UNION ALL SELECT ''ADMITTED_SOURCE_REVIEW'',f.ai_admitted_source_review_finding_id,f.finding_hash,f.finding->>''rule_id'',f.finding->>''risk_level'',f.finding->>''reason'',f.finding->>''suggested_action'',f.finding->>''owner_role'',f.created_at,false,false,false,false FROM ai_admitted_source_review_current_finding f WHERE f.tenant_id=p_tenant AND f.entity_id=p_entity AND NOT EXISTS(SELECT 1 FROM ai_finding_action a WHERE a.tenant_id=f.tenant_id AND a.entity_id=f.entity_id AND a.finding_kind=''ADMITTED_SOURCE_REVIEW'' AND a.finding_id=f.ai_admitted_source_review_finding_id) UNION ALL SELECT ''COST_DIMENSION'',f.ai_cost_dimension_finding_id');
 IF position('ADMITTED_SOURCE_REVIEW' IN definition)=0 THEN RAISE EXCEPTION 'Admitted-source candidate integration failed';END IF;EXECUTE definition;
END $$;

DO $$ DECLARE item record;BEGIN FOR item IN SELECT r.tenant_id,r.entity_id,r.source_document_id FROM wbs_final1_retained_source_row r WHERE r.domain='PAYABLES' LOOP PERFORM refs_refresh_ai_admitted_source_review(item.tenant_id,item.entity_id,item.source_document_id,'MIGRATION_287_BACKFILL');END LOOP;END $$;

REVOKE ALL ON ai_admitted_source_review_finding,ai_admitted_source_review_lifecycle,ai_admitted_source_review_current_finding FROM PUBLIC,refs_app;
REVOKE EXECUTE ON FUNCTION refs_refresh_ai_admitted_source_review(uuid,uuid,uuid,text),refs_refresh_ai_admitted_source_review_trigger() FROM PUBLIC,refs_app;
GRANT SELECT ON ai_admitted_source_review_current_finding TO refs_app;
COMMIT;
