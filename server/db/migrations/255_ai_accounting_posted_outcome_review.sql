BEGIN;

CREATE TABLE ai_accounting_posted_outcome_review (
  ai_accounting_posted_outcome_review_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL, entity_id uuid NOT NULL, ai_accounting_decision_id uuid NOT NULL,
  journal_entry_id uuid, financial_statement_snapshot_id uuid,
  review_revision bigint NOT NULL CHECK(review_revision>=0),
  review_status text NOT NULL CHECK(review_status IN ('CONSISTENT','MISSING','AMBIGUOUS','MISMATCH')),
  reason_codes jsonb NOT NULL CHECK(jsonb_typeof(reason_codes)='array'),
  evidence jsonb NOT NULL CHECK(jsonb_typeof(evidence)='object'),
  review_hash text NOT NULL CHECK(review_hash~'^sha256:[0-9a-f]{64}$'),
  reviewed_by text NOT NULL, reviewed_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE(tenant_id,entity_id,ai_accounting_decision_id,review_revision),
  UNIQUE(tenant_id,entity_id,ai_accounting_posted_outcome_review_id),
  FOREIGN KEY(tenant_id,entity_id,ai_accounting_decision_id) REFERENCES ai_accounting_decision(tenant_id,entity_id,ai_accounting_decision_id),
  FOREIGN KEY(tenant_id,entity_id,journal_entry_id) REFERENCES journal_entry(tenant_id,entity_id,journal_entry_id),
  FOREIGN KEY(financial_statement_snapshot_id) REFERENCES financial_statement_snapshot(financial_statement_snapshot_id)
);
ALTER TABLE ai_accounting_posted_outcome_review ENABLE ROW LEVEL SECURITY;
CREATE POLICY ai_accounting_posted_outcome_review_scope ON ai_accounting_posted_outcome_review
  USING(tenant_id=refs_current_tenant() AND refs_entity_allowed(entity_id))
  WITH CHECK(tenant_id=refs_current_tenant() AND refs_entity_allowed(entity_id));
CREATE TRIGGER ai_accounting_posted_outcome_review_append_only BEFORE UPDATE OR DELETE ON ai_accounting_posted_outcome_review FOR EACH ROW EXECUTE FUNCTION reject_mutation();

CREATE FUNCTION refs_retain_ai_accounting_posted_outcome_review(
  p_tenant uuid,p_entity uuid,p_decision uuid,p_expected_decision_hash text,p_expected_review_revision bigint,
  p_idempotency_key text,p_request_hash text
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE
  actor text:=refs_current_actor(); receipt idempotency_receipt; d ai_accounting_decision;
  h ai_accounting_human_decision; draft ai_accounting_decision_draft_evidence; je journal_entry;
  snapshot financial_statement_snapshot; current_revision bigint; next_revision bigint;
  decision_count integer; human_count integer; draft_count integer; journal_count integer;
  journal_line_count integer; proposed_line_count integer; ledger_count integer; workflow_audit_count integer; workflow_outbox_count integer;
  snapshot_count integer; snapshot_bad_row_count integer; expected_delta_count integer; covered_delta_count integer;
  source_line_count integer; source_link_count integer;
  proposed_matches boolean:=false; ledger_matches boolean:=false; balanced boolean:=false; actors_distinct boolean:=false;
  workflow_matches boolean:=false; snapshot_hash_matches boolean:=false; report_lineage_matches boolean:=false;
  proposed_lines jsonb:='[]'::jsonb; journal_lines jsonb:='[]'::jsonb; ledger_lines jsonb:='[]'::jsonb;
  workflow_evidence jsonb:='[]'::jsonb; snapshot_rows jsonb:='[]'::jsonb; expected_report_deltas jsonb:='[]'::jsonb; actual_report_deltas jsonb:='[]'::jsonb; reasons jsonb:='[]'::jsonb;
  status text; evidence jsonb; review_hash text; review_id uuid:=gen_random_uuid(); review_time timestamptz:=clock_timestamp(); event_payload jsonb; response jsonb;
BEGIN
  PERFORM refs_assert_scope(p_tenant,p_entity,'AI.ANALYSIS.EXPLAIN');
  IF actor IS NULL THEN RAISE EXCEPTION 'Authenticated AI outcome reviewer missing' USING ERRCODE='42501'; END IF;
  IF p_expected_decision_hash !~ '^sha256:[0-9a-f]{64}$' OR p_expected_review_revision< -1 THEN RAISE EXCEPTION 'Closed outcome review CAS is required' USING ERRCODE='22023'; END IF;
  IF p_request_hash<>refs_jsonb_hash(jsonb_build_object('tenant_id',p_tenant,'entity_id',p_entity,'decision_id',p_decision,'expected_decision_hash',p_expected_decision_hash,'expected_review_revision',p_expected_review_revision)) THEN RAISE EXCEPTION 'Outcome review request hash is not canonical' USING ERRCODE='22023'; END IF;
  INSERT INTO idempotency_receipt(tenant_id,operation_scope,idempotency_key,request_hash,status,actor_id)
    VALUES(p_tenant,'AI_ACCOUNTING_POSTED_OUTCOME_REVIEW:'||p_entity,p_idempotency_key,p_request_hash,'IN_PROGRESS',actor) ON CONFLICT DO NOTHING;
  SELECT * INTO receipt FROM idempotency_receipt WHERE tenant_id=p_tenant AND operation_scope='AI_ACCOUNTING_POSTED_OUTCOME_REVIEW:'||p_entity AND idempotency_key=p_idempotency_key FOR UPDATE;
  IF receipt.request_hash<>p_request_hash OR receipt.actor_id<>actor THEN RAISE EXCEPTION 'Idempotency key reused with different payload or actor' USING ERRCODE='23505'; END IF;
  IF receipt.status='SUCCEEDED' THEN RETURN receipt.response_body||jsonb_build_object('idempotent',true); END IF;

  SELECT count(*) INTO decision_count FROM ai_accounting_decision WHERE tenant_id=p_tenant AND entity_id=p_entity AND ai_accounting_decision_id=p_decision;
  IF decision_count<>1 THEN RAISE EXCEPTION 'Persisted AI accounting decision is missing or ambiguous' USING ERRCODE='P0002'; END IF;
  SELECT * INTO d FROM ai_accounting_decision WHERE tenant_id=p_tenant AND entity_id=p_entity AND ai_accounting_decision_id=p_decision FOR SHARE;
  IF d.decision_hash<>p_expected_decision_hash OR d.decision_hash<>refs_jsonb_hash(d.packet) THEN RAISE EXCEPTION 'Persisted AI accounting decision changed' USING ERRCODE='40001'; END IF;
  SELECT COALESCE(max(review_revision),-1) INTO current_revision FROM ai_accounting_posted_outcome_review WHERE tenant_id=p_tenant AND entity_id=p_entity AND ai_accounting_decision_id=p_decision;
  IF current_revision<>p_expected_review_revision THEN RAISE EXCEPTION 'Outcome review revision conflict' USING ERRCODE='40001'; END IF;
  next_revision:=current_revision+1;

  SELECT count(*) INTO human_count FROM ai_accounting_human_decision WHERE tenant_id=p_tenant AND entity_id=p_entity AND ai_accounting_decision_id=p_decision AND decision='ACCEPTED';
  IF human_count=1 THEN SELECT * INTO h FROM ai_accounting_human_decision WHERE tenant_id=p_tenant AND entity_id=p_entity AND ai_accounting_decision_id=p_decision AND decision='ACCEPTED'; END IF;
  SELECT count(*) INTO draft_count FROM ai_accounting_decision_draft_evidence WHERE tenant_id=p_tenant AND entity_id=p_entity AND ai_accounting_decision_id=p_decision;
  IF draft_count=1 THEN SELECT * INTO draft FROM ai_accounting_decision_draft_evidence WHERE tenant_id=p_tenant AND entity_id=p_entity AND ai_accounting_decision_id=p_decision; END IF;
  IF draft_count=1 THEN SELECT count(*) INTO journal_count FROM journal_entry WHERE tenant_id=p_tenant AND entity_id=p_entity AND journal_entry_id=draft.journal_entry_id; ELSE journal_count:=0; END IF;
  IF journal_count=1 THEN SELECT * INTO je FROM journal_entry WHERE tenant_id=p_tenant AND entity_id=p_entity AND journal_entry_id=draft.journal_entry_id FOR SHARE; END IF;

  IF human_count=0 THEN reasons:=reasons||'"HUMAN_ACCEPTANCE_MISSING"'::jsonb; ELSIF human_count>1 THEN reasons:=reasons||'"HUMAN_ACCEPTANCE_AMBIGUOUS"'::jsonb; END IF;
  IF draft_count=0 THEN reasons:=reasons||'"DRAFT_RECEIPT_MISSING"'::jsonb; ELSIF draft_count>1 THEN reasons:=reasons||'"DRAFT_RECEIPT_AMBIGUOUS"'::jsonb; END IF;
  IF journal_count=0 THEN reasons:=reasons||'"JOURNAL_MISSING"'::jsonb; ELSIF journal_count>1 THEN reasons:=reasons||'"JOURNAL_AMBIGUOUS"'::jsonb; END IF;
  IF human_count=1 AND (h.decision_hash IS DISTINCT FROM d.decision_hash OR h.evidence_hash IS DISTINCT FROM refs_jsonb_hash(jsonb_build_object('decision_id',p_decision,'decision_hash',d.decision_hash,'outcome','ACCEPTED','reason',h.reason,'actor_id',h.decided_by))) THEN reasons:=reasons||'"ACCEPTANCE_EVIDENCE_MISMATCH"'::jsonb; END IF;
  IF draft_count=1 AND (draft.ai_accounting_human_decision_id IS DISTINCT FROM h.ai_accounting_human_decision_id OR draft.decision_hash IS DISTINCT FROM d.decision_hash OR draft.acceptance_hash IS DISTINCT FROM h.evidence_hash OR draft.evidence_hash IS DISTINCT FROM refs_jsonb_hash(jsonb_build_object('decision_id',p_decision,'decision_hash',d.decision_hash,'human_decision_id',h.ai_accounting_human_decision_id,'acceptance_hash',h.evidence_hash,'journal_entry_id',draft.journal_entry_id,'maker',draft.created_by))) THEN reasons:=reasons||'"DRAFT_EVIDENCE_MISMATCH"'::jsonb; END IF;

  IF journal_count=1 THEN
    SELECT count(*) INTO source_line_count FROM source_document_line WHERE tenant_id=p_tenant AND entity_id=p_entity AND source_document_id=d.source_document_id AND source_document_line_id=(d.packet#>>'{source,source_document_line_id}')::uuid;
    SELECT count(*) INTO source_link_count FROM source_link WHERE tenant_id=p_tenant AND entity_id=p_entity AND link_type='AI_ACCOUNTING_DECISION_SOURCE' AND source_document_id=d.source_document_id AND journal_entry_id=je.journal_entry_id;
    IF je.period_id IS DISTINCT FROM d.period_id OR je.journal_date IS DISTINCT FROM (d.packet->>'accounting_date')::date OR je.currency::text IS DISTINCT FROM d.packet#>>'{source,currency}' OR je.journal_type<>'MANUAL' OR draft.journal_entry_id IS DISTINCT FROM je.journal_entry_id THEN reasons:=reasons||'"JOURNAL_SCOPE_MISMATCH"'::jsonb; END IF;
    IF source_line_count<>1 OR source_link_count<>1 THEN reasons:=reasons||'"SOURCE_LINEAGE_MISMATCH"'::jsonb; END IF;
    SELECT COALESCE(jsonb_agg(jsonb_build_object('line_number',line_no,'side',CASE WHEN debit_amount>0 THEN 'DEBIT' ELSE 'CREDIT' END,'account_code',account_code,'amount',to_char(GREATEST(debit_amount,credit_amount),'FM999999999999990.0000'),'currency',je.currency,'member_ref',member_ref,'project_ref',dimensions->>'project_ref','property_ref',dimensions->>'property_ref','cost_code_ref',dimensions->>'cost_code_ref') ORDER BY line_no),'[]'::jsonb),count(*),COALESCE(sum(debit_amount)=sum(credit_amount) AND sum(debit_amount)>0,false)
      INTO journal_lines,journal_line_count,balanced FROM journal_line WHERE tenant_id=p_tenant AND entity_id=p_entity AND journal_entry_id=je.journal_entry_id;
    SELECT COALESCE(jsonb_agg(x ORDER BY (x->>'line_number')::integer),'[]'::jsonb),count(*) INTO proposed_lines,proposed_line_count FROM jsonb_array_elements(COALESCE(d.packet#>'{proposed_journal,lines}','[]'::jsonb)) x;
    proposed_matches:=proposed_line_count=journal_line_count AND proposed_line_count>=2 AND NOT EXISTS(
      SELECT 1 FROM jsonb_array_elements(COALESCE(d.packet#>'{proposed_journal,lines}','[]'::jsonb)) x
      LEFT JOIN journal_line jl ON jl.tenant_id=p_tenant AND jl.entity_id=p_entity AND jl.journal_entry_id=je.journal_entry_id AND jl.line_no=(x->>'line_number')::integer
      LEFT JOIN LATERAL (SELECT p FROM jsonb_array_elements(COALESCE(d.packet->'approved_account_policies','[]'::jsonb)) p WHERE p->>'account_code'=x->>'account_code') policy ON true
      WHERE jl.journal_line_id IS NULL OR policy.p IS NULL OR (CASE WHEN jl.debit_amount>0 THEN 'DEBIT' ELSE 'CREDIT' END) IS DISTINCT FROM x->>'side'
        OR jl.account_code IS DISTINCT FROM x->>'account_code' OR GREATEST(jl.debit_amount,jl.credit_amount) IS DISTINCT FROM (x->>'amount')::numeric
        OR je.currency::text IS DISTINCT FROM x->>'currency' OR jl.member_ref IS DISTINCT FROM x->>'member_ref'
        OR jl.dimensions->>'project_ref' IS DISTINCT FROM x->>'project_ref' OR jl.dimensions->>'property_ref' IS DISTINCT FROM x->>'property_ref' OR jl.dimensions->>'cost_code_ref' IS DISTINCT FROM x->>'cost_code_ref'
        OR policy.p->>'account_class' IS DISTINCT FROM x->>'account_class' OR policy.p->>'account_type' IS DISTINCT FROM x->>'account_type' OR policy.p->'required_dimensions' IS DISTINCT FROM x->'dimension_requirements'
        OR x->>'source_document_id' IS DISTINCT FROM d.source_document_id::text OR x->>'source_document_line_id' IS DISTINCT FROM d.packet#>>'{source,source_document_line_id}' OR x->>'source_line_hash' IS DISTINCT FROM d.packet#>>'{source,source_line_hash}'
    );
    SELECT COALESCE(jsonb_agg(jsonb_build_object('journal_line_id',journal_line_id,'ledger_line_id',ledger_line_id,'account_code',account_code,'member_ref',member_ref,'currency',currency,'debit_amount',to_char(debit_amount,'FM999999999999990.0000'),'credit_amount',to_char(credit_amount,'FM999999999999990.0000'),'dimensions',dimensions) ORDER BY journal_line_id),'[]'::jsonb),count(*)
      INTO ledger_lines,ledger_count FROM ledger_line WHERE tenant_id=p_tenant AND entity_id=p_entity AND journal_entry_id=je.journal_entry_id;
    ledger_matches:=ledger_count=journal_line_count AND NOT EXISTS(SELECT 1 FROM journal_line jl FULL JOIN ledger_line ll ON ll.tenant_id=jl.tenant_id AND ll.entity_id=jl.entity_id AND ll.journal_line_id=jl.journal_line_id WHERE COALESCE(jl.tenant_id,ll.tenant_id)=p_tenant AND COALESCE(jl.entity_id,ll.entity_id)=p_entity AND COALESCE(jl.journal_entry_id,ll.journal_entry_id)=je.journal_entry_id AND (jl.journal_line_id IS NULL OR ll.ledger_line_id IS NULL OR jl.period_id IS DISTINCT FROM ll.period_id OR jl.account_code<>ll.account_code OR jl.member_ref IS DISTINCT FROM ll.member_ref OR jl.dimensions<>ll.dimensions OR jl.debit_amount<>ll.debit_amount OR jl.credit_amount<>ll.credit_amount OR ll.currency IS DISTINCT FROM je.currency OR NOT EXISTS(SELECT 1 FROM source_link sl WHERE sl.tenant_id=p_tenant AND sl.entity_id=p_entity AND sl.link_type='JE_LINE_TO_LEDGER' AND sl.journal_entry_id=je.journal_entry_id AND sl.journal_line_id=jl.journal_line_id AND sl.posting_batch_id=ll.posting_batch_id AND sl.ledger_line_id=ll.ledger_line_id)));
    actors_distinct:=je.created_by IS NOT NULL AND je.reviewed_by IS NOT NULL AND je.approved_by IS NOT NULL AND je.posted_by IS NOT NULL AND cardinality(ARRAY(SELECT DISTINCT x FROM unnest(ARRAY[je.created_by,je.reviewed_by,je.approved_by,je.posted_by]) x))=4 AND (draft.created_by=je.created_by);
    SELECT count(*),COALESCE(jsonb_agg(jsonb_build_object('kind','AUDIT','event_type',event_type,'action',action,'actor_id',actor_id,'permission',permission_used,'at',occurred_at,'idempotency_key',idempotency_key,'request_hash',after_hash) ORDER BY occurred_at,audit_event_id),'[]'::jsonb) INTO workflow_audit_count,workflow_evidence FROM audit_event WHERE tenant_id=p_tenant AND entity_id=p_entity AND object_type='JOURNAL_ENTRY' AND object_id=je.journal_entry_id AND event_type IN ('JOURNAL_SUBMIT','JOURNAL_REVIEW','JOURNAL_APPROVE','JOURNAL_POSTED');
    SELECT count(*) INTO workflow_outbox_count FROM outbox_event WHERE tenant_id=p_tenant AND entity_id=p_entity AND aggregate_type='JOURNAL_ENTRY' AND aggregate_id=je.journal_entry_id AND event_type IN ('JOURNAL_SUBMIT','JOURNAL_REVIEW','JOURNAL_APPROVE','JOURNAL_POSTED') AND payload_hash=refs_jsonb_hash(payload);
    workflow_matches:=workflow_audit_count=4 AND workflow_outbox_count=4
      AND (SELECT count(*)=1 FROM audit_event a JOIN idempotency_receipt i ON i.tenant_id=a.tenant_id AND i.operation_scope='JOURNAL_SUBMIT:'||p_entity AND i.idempotency_key=a.idempotency_key AND i.actor_id=a.actor_id AND i.request_hash=a.after_hash AND i.status='SUCCEEDED' WHERE a.tenant_id=p_tenant AND a.entity_id=p_entity AND a.object_type='JOURNAL_ENTRY' AND a.object_id=je.journal_entry_id AND a.event_type='JOURNAL_SUBMIT' AND a.action='SUBMIT' AND a.actor_type='USER' AND a.actor_id=je.created_by AND a.permission_used='GL.JE.SUBMIT' AND i.response_body->>'status'='PENDING_REVIEW' AND (i.response_body->>'revision')::bigint=1)
      AND (SELECT count(*)=1 FROM audit_event a JOIN idempotency_receipt i ON i.tenant_id=a.tenant_id AND i.operation_scope='JOURNAL_REVIEW:'||p_entity AND i.idempotency_key=a.idempotency_key AND i.actor_id=a.actor_id AND i.request_hash=a.after_hash AND i.status='SUCCEEDED' WHERE a.tenant_id=p_tenant AND a.entity_id=p_entity AND a.object_type='JOURNAL_ENTRY' AND a.object_id=je.journal_entry_id AND a.event_type='JOURNAL_REVIEW' AND a.action='REVIEW' AND a.actor_type='USER' AND a.actor_id=je.reviewed_by AND a.permission_used='GL.JE.REVIEW' AND i.response_body->>'status'='PENDING_APPROVAL' AND (i.response_body->>'revision')::bigint=2)
      AND (SELECT count(*)=1 FROM audit_event a JOIN idempotency_receipt i ON i.tenant_id=a.tenant_id AND i.operation_scope='JOURNAL_APPROVE:'||p_entity AND i.idempotency_key=a.idempotency_key AND i.actor_id=a.actor_id AND i.request_hash=a.after_hash AND i.status='SUCCEEDED' WHERE a.tenant_id=p_tenant AND a.entity_id=p_entity AND a.object_type='JOURNAL_ENTRY' AND a.object_id=je.journal_entry_id AND a.event_type='JOURNAL_APPROVE' AND a.action='APPROVE' AND a.actor_type='USER' AND a.actor_id=je.approved_by AND a.permission_used='GL.JE.APPROVE' AND i.response_body->>'status'='APPROVED' AND (i.response_body->>'revision')::bigint=3)
      AND (SELECT count(*)=1 FROM audit_event a JOIN idempotency_receipt i ON i.tenant_id=a.tenant_id AND i.operation_scope='POST_JOURNAL:'||p_entity AND i.idempotency_key=a.idempotency_key AND i.actor_id=a.actor_id AND i.request_hash=a.metadata->>'request_hash' AND i.status='SUCCEEDED' JOIN posting_batch pb ON pb.tenant_id=p_tenant AND pb.entity_id=p_entity AND pb.posting_batch_id=(i.response_body->>'posting_batch_id')::uuid AND pb.period_id=je.period_id AND pb.posted_by=je.posted_by AND pb.request_hash=i.request_hash WHERE a.tenant_id=p_tenant AND a.entity_id=p_entity AND a.object_type='JOURNAL_ENTRY' AND a.object_id=je.journal_entry_id AND a.event_type='JOURNAL_POSTED' AND a.action='POST' AND a.actor_type='USER' AND a.actor_id=je.posted_by AND a.permission_used='GL.JE.POST' AND a.after_hash=refs_jsonb_hash(to_jsonb(je)) AND (i.response_body->>'journal_entry_id')::uuid=je.journal_entry_id AND EXISTS(SELECT 1 FROM ledger_line ll WHERE ll.tenant_id=p_tenant AND ll.entity_id=p_entity AND ll.journal_entry_id=je.journal_entry_id AND ll.posting_batch_id=pb.posting_batch_id))
      AND (SELECT array_agg(event_type ORDER BY occurred_at,audit_event_id)=ARRAY['JOURNAL_SUBMIT','JOURNAL_REVIEW','JOURNAL_APPROVE','JOURNAL_POSTED'] FROM audit_event WHERE tenant_id=p_tenant AND entity_id=p_entity AND object_type='JOURNAL_ENTRY' AND object_id=je.journal_entry_id AND event_type IN ('JOURNAL_SUBMIT','JOURNAL_REVIEW','JOURNAL_APPROVE','JOURNAL_POSTED'))
      AND (SELECT count(*)=4 FROM outbox_event o WHERE o.tenant_id=p_tenant AND o.entity_id=p_entity AND o.aggregate_type='JOURNAL_ENTRY' AND o.aggregate_id=je.journal_entry_id AND o.payload_hash=refs_jsonb_hash(o.payload) AND ((o.event_type='JOURNAL_SUBMIT' AND o.payload=jsonb_build_object('journal_entry_id',je.journal_entry_id,'status','PENDING_REVIEW','revision',1)) OR (o.event_type='JOURNAL_REVIEW' AND o.payload=jsonb_build_object('journal_entry_id',je.journal_entry_id,'status','PENDING_APPROVAL','revision',2)) OR (o.event_type='JOURNAL_APPROVE' AND o.payload=jsonb_build_object('journal_entry_id',je.journal_entry_id,'status','APPROVED','revision',3)) OR (o.event_type='JOURNAL_POSTED' AND o.payload->>'journal_entry_id'=je.journal_entry_id::text AND (o.payload->>'posting_batch_id')::uuid IN (SELECT posting_batch_id FROM ledger_line WHERE tenant_id=p_tenant AND entity_id=p_entity AND journal_entry_id=je.journal_entry_id))));
    IF je.status<>'POSTED' THEN reasons:=reasons||'"POSTED_JOURNAL_MISSING"'::jsonb; END IF;
    IF NOT proposed_matches THEN reasons:=reasons||'"POSTED_JOURNAL_MISMATCH"'::jsonb; END IF;
    IF NOT balanced OR NOT ledger_matches THEN reasons:=reasons||'"LEDGER_MISMATCH"'::jsonb; END IF;
    IF NOT actors_distinct OR NOT workflow_matches THEN reasons:=reasons||CASE WHEN workflow_audit_count>4 OR workflow_outbox_count>4 THEN '"WORKFLOW_EVIDENCE_AMBIGUOUS"'::jsonb ELSE '"WORKFLOW_EVIDENCE_MISSING_OR_MISMATCHED"'::jsonb END; END IF;

    IF je.status='POSTED' THEN
      SELECT COALESCE(jsonb_agg(delta ORDER BY delta::text),'[]'::jsonb) INTO expected_report_deltas FROM jsonb_array_elements(COALESCE(d.packet->'expected_report_deltas','[]'::jsonb)) delta;
      WITH line_effects AS (
        SELECT policy->>'report_statement' AS statement,'NONE'::text AS cash_flow_classification,je.period_id AS accounting_period_id,jl.account_code,policy->>'account_class' AS account_class,je.currency::text AS currency,jl.dimensions->>'project_ref' AS project_ref,jl.dimensions->>'property_ref' AS property_ref,jl.member_ref,jl.dimensions->>'cost_code_ref' AS cost_code_ref,(d.packet#>>'{source,source_document_line_id}')::uuid AS source_document_line_id,
          CASE WHEN (jl.debit_amount>0 AND policy->>'normal_balance'='DEBIT') OR (jl.credit_amount>0 AND policy->>'normal_balance'='CREDIT') THEN GREATEST(jl.debit_amount,jl.credit_amount) ELSE -GREATEST(jl.debit_amount,jl.credit_amount) END AS signed_amount
        FROM journal_line jl JOIN LATERAL (SELECT p AS policy FROM jsonb_array_elements(COALESCE(d.packet->'approved_account_policies','[]'::jsonb)) p WHERE p->>'account_code'=jl.account_code) p ON true
        WHERE jl.tenant_id=p_tenant AND jl.entity_id=p_entity AND jl.journal_entry_id=je.journal_entry_id
        UNION ALL
        SELECT 'CASH_FLOW',policy->>'cash_flow_classification',je.period_id,jl.account_code,policy->>'account_class',je.currency::text,jl.dimensions->>'project_ref',jl.dimensions->>'property_ref',jl.member_ref,jl.dimensions->>'cost_code_ref',(d.packet#>>'{source,source_document_line_id}')::uuid,
          CASE WHEN (jl.debit_amount>0 AND policy->>'normal_balance'='DEBIT') OR (jl.credit_amount>0 AND policy->>'normal_balance'='CREDIT') THEN GREATEST(jl.debit_amount,jl.credit_amount) ELSE -GREATEST(jl.debit_amount,jl.credit_amount) END
        FROM journal_line jl JOIN LATERAL (SELECT p AS policy FROM jsonb_array_elements(COALESCE(d.packet->'approved_account_policies','[]'::jsonb)) p WHERE p->>'account_code'=jl.account_code) p ON true
        WHERE jl.tenant_id=p_tenant AND jl.entity_id=p_entity AND jl.journal_entry_id=je.journal_entry_id AND d.packet#>>'{source,cash_direction}'<>'NON_CASH' AND policy->>'cash_flow_classification'<>'NONE'
      ), grouped AS (
        SELECT statement,cash_flow_classification,accounting_period_id,account_code,account_class,currency,project_ref,property_ref,member_ref,cost_code_ref,source_document_line_id,sum(signed_amount) AS signed_amount FROM line_effects GROUP BY statement,cash_flow_classification,accounting_period_id,account_code,account_class,currency,project_ref,property_ref,member_ref,cost_code_ref,source_document_line_id HAVING sum(signed_amount)<>0
      )
      SELECT COALESCE(jsonb_agg(jsonb_build_object('statement',statement,'cash_flow_classification',cash_flow_classification,'accounting_period_id',accounting_period_id,'account_code',account_code,'account_class',account_class,'currency',currency,'project_ref',project_ref,'property_ref',property_ref,'member_ref',member_ref,'cost_code_ref',cost_code_ref,'source_document_line_id',source_document_line_id,'direction',CASE WHEN signed_amount>0 THEN 'INCREASE' ELSE 'DECREASE' END,'amount',to_char(abs(signed_amount),'FM999999999999990.0000')) ORDER BY jsonb_build_object('statement',statement,'cash_flow_classification',cash_flow_classification,'accounting_period_id',accounting_period_id,'account_code',account_code,'account_class',account_class,'currency',currency,'project_ref',project_ref,'property_ref',property_ref,'member_ref',member_ref,'cost_code_ref',cost_code_ref,'source_document_line_id',source_document_line_id,'direction',CASE WHEN signed_amount>0 THEN 'INCREASE' ELSE 'DECREASE' END,'amount',to_char(abs(signed_amount),'FM999999999999990.0000'))::text),'[]'::jsonb) INTO actual_report_deltas FROM grouped;
      SELECT count(*) INTO snapshot_count FROM financial_statement_snapshot WHERE tenant_id=p_tenant AND entity_id=p_entity AND period_id=je.period_id AND captured_at>=je.posted_at;
      IF snapshot_count>0 THEN
        SELECT * INTO snapshot FROM financial_statement_snapshot WHERE tenant_id=p_tenant AND entity_id=p_entity AND period_id=je.period_id AND captured_at>=je.posted_at ORDER BY version DESC,financial_statement_snapshot_id DESC LIMIT 1;
        SELECT COALESCE(jsonb_agg(jsonb_build_object('statement_type',statement_type,'statement_section',statement_section,'classification_basis',classification_basis,'account_code',account_code,'account_name',account_name,'opening_debit',opening_debit,'opening_credit',opening_credit,'period_debit',period_debit,'period_credit',period_credit,'ending_debit',ending_debit,'ending_credit',ending_credit,'display_balance',display_balance,'journal_entry_ids',journal_entry_ids,'journal_line_ids',journal_line_ids,'ledger_line_ids',ledger_line_ids,'source_document_ids',source_document_ids) ORDER BY statement_type,statement_section,account_code),'[]'::jsonb),count(*) FILTER(WHERE row_hash<>refs_jsonb_hash(jsonb_build_object('statement_type',statement_type,'statement_section',statement_section,'classification_basis',classification_basis,'account_code',account_code,'account_name',account_name,'opening_debit',opening_debit,'opening_credit',opening_credit,'period_debit',period_debit,'period_credit',period_credit,'ending_debit',ending_debit,'ending_credit',ending_credit,'display_balance',display_balance,'journal_entry_ids',journal_entry_ids,'journal_line_ids',journal_line_ids,'ledger_line_ids',ledger_line_ids,'source_document_ids',source_document_ids)))
          INTO snapshot_rows,snapshot_bad_row_count FROM financial_statement_snapshot_row WHERE financial_statement_snapshot_id=snapshot.financial_statement_snapshot_id;
        snapshot_hash_matches:=snapshot_bad_row_count=0 AND snapshot.snapshot_hash=refs_jsonb_hash(snapshot_rows) AND snapshot.ledger_evidence_hash=refs_jsonb_hash(jsonb_build_object('statement_rows',snapshot_rows));
        expected_delta_count:=jsonb_array_length(expected_report_deltas);
        SELECT count(*) INTO covered_delta_count FROM jsonb_array_elements(actual_report_deltas) delta WHERE EXISTS(SELECT 1 FROM financial_statement_snapshot_row r WHERE r.financial_statement_snapshot_id=snapshot.financial_statement_snapshot_id AND r.statement_type=delta->>'statement' AND r.account_code=delta->>'account_code' AND je.journal_entry_id=ANY(r.journal_entry_ids) AND d.source_document_id=ANY(r.source_document_ids) AND (SELECT array_agg(journal_line_id ORDER BY journal_line_id) FROM journal_line WHERE tenant_id=p_tenant AND entity_id=p_entity AND journal_entry_id=je.journal_entry_id AND account_code=delta->>'account_code') <@ r.journal_line_ids AND (SELECT array_agg(ledger_line_id ORDER BY ledger_line_id) FROM ledger_line WHERE tenant_id=p_tenant AND entity_id=p_entity AND journal_entry_id=je.journal_entry_id AND account_code=delta->>'account_code') <@ r.ledger_line_ids);
        report_lineage_matches:=snapshot.currency=je.currency AND expected_delta_count>0 AND actual_report_deltas=expected_report_deltas AND covered_delta_count=jsonb_array_length(actual_report_deltas) AND EXISTS(SELECT 1 FROM financial_statement_snapshot_row r WHERE r.financial_statement_snapshot_id=snapshot.financial_statement_snapshot_id AND r.statement_type='TRIAL_BALANCE' AND je.journal_entry_id=ANY(r.journal_entry_ids) AND d.source_document_id=ANY(r.source_document_ids));
      END IF;
      IF snapshot_count=0 THEN reasons:=reasons||'"REPORT_SNAPSHOT_MISSING"'::jsonb;
      ELSIF NOT snapshot_hash_matches OR NOT report_lineage_matches THEN reasons:=reasons||'"REPORT_SNAPSHOT_MISMATCH"'::jsonb; END IF;
    END IF;
  END IF;

  status:=CASE WHEN EXISTS(SELECT 1 FROM jsonb_array_elements_text(reasons) r WHERE r.value LIKE '%AMBIGUOUS%') THEN 'AMBIGUOUS'
    WHEN EXISTS(SELECT 1 FROM jsonb_array_elements_text(reasons) r WHERE r.value LIKE '%MISSING%') THEN 'MISSING'
    WHEN jsonb_array_length(reasons)>0 THEN 'MISMATCH' ELSE 'CONSISTENT' END;
  evidence:=jsonb_build_object('schema_version','AI_ACCOUNTING_POSTED_OUTCOME_EVIDENCE_V1','ai_accounting_decision_id',p_decision,'decision_hash',d.decision_hash,'human_decision_id',h.ai_accounting_human_decision_id,'acceptance_hash',h.evidence_hash,'draft_evidence_id',draft.ai_accounting_decision_draft_evidence_id,'draft_evidence_hash',draft.evidence_hash,'journal_entry_id',je.journal_entry_id,'journal_status',je.status,'journal_revision',je.revision,'proposed_lines_hash',refs_jsonb_hash(proposed_lines),'journal_lines_hash',refs_jsonb_hash(journal_lines),'ledger_lines_hash',refs_jsonb_hash(ledger_lines),'workflow_evidence_hash',refs_jsonb_hash(workflow_evidence),'expected_report_deltas_hash',refs_jsonb_hash(expected_report_deltas),'actual_report_deltas_hash',refs_jsonb_hash(actual_report_deltas),'financial_statement_snapshot_id',snapshot.financial_statement_snapshot_id,'financial_statement_snapshot_hash',snapshot.snapshot_hash,'ledger_evidence_hash',snapshot.ledger_evidence_hash,'proposed_journal_exact',proposed_matches,'posted_ledger_exact',ledger_matches,'workflow_exact',workflow_matches,'report_snapshot_exact',snapshot_hash_matches AND report_lineage_matches,'can_create_draft',false,'can_review',false,'can_approve',false,'can_post',false);
  review_hash:=refs_jsonb_hash(jsonb_build_object('decision_id',p_decision,'revision',next_revision,'status',status,'reason_codes',reasons,'evidence',evidence));
  INSERT INTO ai_accounting_posted_outcome_review(ai_accounting_posted_outcome_review_id,tenant_id,entity_id,ai_accounting_decision_id,journal_entry_id,financial_statement_snapshot_id,review_revision,review_status,reason_codes,evidence,review_hash,reviewed_by,reviewed_at)
    VALUES(review_id,p_tenant,p_entity,p_decision,je.journal_entry_id,snapshot.financial_statement_snapshot_id,next_revision,status,reasons,evidence,review_hash,actor,review_time);
  event_payload:=jsonb_build_object('schema_version','AI_ACCOUNTING_POSTED_OUTCOME_REVIEW_V1','ai_accounting_posted_outcome_review_id',review_id,'ai_accounting_decision_id',p_decision,'review_revision',next_revision,'status',status,'reason_codes',reasons,'review_hash',review_hash,'reviewed_by',actor,'reviewed_at',review_time,'evidence',evidence,'can_create_draft',false,'can_review',false,'can_approve',false,'can_post',false);
  INSERT INTO audit_event(tenant_id,entity_id,event_type,object_type,object_id,action,actor_id,actor_type,permission_used,request_id,correlation_id,idempotency_key,after_hash,reason,metadata)
    VALUES(p_tenant,p_entity,'AI_ACCOUNTING_POSTED_OUTCOME_REVIEWED','AI_ACCOUNTING_DECISION',p_decision,'REVIEW_POSTED_OUTCOME',actor,'SYSTEM','AI.ANALYSIS.EXPLAIN',p_idempotency_key,p_idempotency_key,p_idempotency_key,review_hash,'Server-derived Posted outcome review; no accounting action',event_payload);
  INSERT INTO outbox_event(tenant_id,entity_id,aggregate_type,aggregate_id,event_type,payload,payload_hash)
    VALUES(p_tenant,p_entity,'AI_ACCOUNTING_POSTED_OUTCOME_REVIEW',review_id,'AI_ACCOUNTING_POSTED_OUTCOME_REVIEWED',event_payload,refs_jsonb_hash(event_payload));
  response:=event_payload||jsonb_build_object('idempotent',false);
  UPDATE idempotency_receipt SET status='SUCCEEDED',response_status=201,response_body=response,completed_at=clock_timestamp() WHERE tenant_id=p_tenant AND operation_scope='AI_ACCOUNTING_POSTED_OUTCOME_REVIEW:'||p_entity AND idempotency_key=p_idempotency_key;
  RETURN response;
END $$;

CREATE FUNCTION refs_read_ai_accounting_posted_outcome_reviews(
  p_tenant uuid,p_entity uuid,p_decision uuid,p_limit integer DEFAULT 100
) RETURNS SETOF jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
BEGIN
  PERFORM refs_assert_scope(p_tenant,p_entity,'AI.ANALYSIS.EXPLAIN');
  IF p_limit<1 OR p_limit>200 THEN RAISE EXCEPTION 'Posted outcome review history limit must be 1..200' USING ERRCODE='22023'; END IF;
  IF NOT EXISTS(SELECT 1 FROM ai_accounting_decision WHERE tenant_id=p_tenant AND entity_id=p_entity AND ai_accounting_decision_id=p_decision) THEN
    RAISE EXCEPTION 'Persisted AI accounting decision was not found in scope' USING ERRCODE='P0002';
  END IF;
  RETURN QUERY
    SELECT jsonb_build_object(
      'schema_version','AI_ACCOUNTING_POSTED_OUTCOME_REVIEW_V1',
      'ai_accounting_posted_outcome_review_id',r.ai_accounting_posted_outcome_review_id,
      'ai_accounting_decision_id',r.ai_accounting_decision_id,
      'review_revision',r.review_revision,
      'status',r.review_status,
      'reason_codes',r.reason_codes,
      'review_hash',r.review_hash,
      'reviewed_by',r.reviewed_by,
      'reviewed_at',r.reviewed_at,
      'evidence',r.evidence,
      'can_create_draft',false,'can_review',false,'can_approve',false,'can_post',false
    )
    FROM ai_accounting_posted_outcome_review r
    WHERE r.tenant_id=p_tenant AND r.entity_id=p_entity AND r.ai_accounting_decision_id=p_decision
    ORDER BY r.review_revision DESC,r.ai_accounting_posted_outcome_review_id DESC
    LIMIT p_limit;
END $$;

REVOKE ALL ON ai_accounting_posted_outcome_review FROM PUBLIC,refs_app;
REVOKE ALL ON FUNCTION refs_retain_ai_accounting_posted_outcome_review(uuid,uuid,uuid,text,bigint,text,text) FROM PUBLIC;
REVOKE ALL ON FUNCTION refs_read_ai_accounting_posted_outcome_reviews(uuid,uuid,uuid,integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION refs_retain_ai_accounting_posted_outcome_review(uuid,uuid,uuid,text,bigint,text,text) TO refs_app;
GRANT EXECUTE ON FUNCTION refs_read_ai_accounting_posted_outcome_reviews(uuid,uuid,uuid,integer) TO refs_app;
COMMIT;
