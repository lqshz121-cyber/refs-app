BEGIN;

INSERT INTO permission_catalog(permission_code,domain,risk_class,sod_class) VALUES
  ('GL.REPORT.SNAPSHOT.PREPARE','GL','HIGH','GL_REPORT_SNAPSHOT_PREPARER'),
  ('GL.REPORT.SNAPSHOT.APPROVE','GL','CRITICAL','GL_REPORT_SNAPSHOT_APPROVER')
ON CONFLICT(permission_code) DO UPDATE SET active=true,domain=EXCLUDED.domain,risk_class=EXCLUDED.risk_class,sod_class=EXCLUDED.sod_class,version=permission_catalog.version+1,effective_to=NULL;

CREATE TABLE financial_statement_snapshot_proposal (
  financial_statement_snapshot_proposal_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant(tenant_id), entity_id uuid NOT NULL, period_id uuid NOT NULL,
  currency char(3) NOT NULL, snapshot_hash text NOT NULL CHECK(snapshot_hash~'^sha256:[0-9a-f]{64}$'),
  ledger_evidence_hash text NOT NULL CHECK(ledger_evidence_hash~'^sha256:[0-9a-f]{64}$'),
  prepared_by text NOT NULL, prepared_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  FOREIGN KEY(tenant_id,entity_id,period_id) REFERENCES accounting_period(tenant_id,entity_id,period_id)
);
CREATE TABLE financial_statement_snapshot_proposal_row (
  financial_statement_snapshot_proposal_id uuid NOT NULL REFERENCES financial_statement_snapshot_proposal(financial_statement_snapshot_proposal_id),
  statement_type text NOT NULL CHECK(statement_type IN ('TRIAL_BALANCE','BALANCE_SHEET','INCOME_STATEMENT','CASH_FLOW')),
  statement_section text NOT NULL, classification_basis text NOT NULL, account_code text NOT NULL, account_name text NOT NULL,
  opening_debit numeric(20,4) NOT NULL, opening_credit numeric(20,4) NOT NULL, period_debit numeric(20,4) NOT NULL, period_credit numeric(20,4) NOT NULL,
  ending_debit numeric(20,4) NOT NULL, ending_credit numeric(20,4) NOT NULL, display_balance numeric(20,4) NOT NULL,
  journal_entry_ids uuid[] NOT NULL, journal_line_ids uuid[] NOT NULL, ledger_line_ids uuid[] NOT NULL, source_document_ids uuid[] NOT NULL,
  row_hash text NOT NULL CHECK(row_hash~'^sha256:[0-9a-f]{64}$'),
  PRIMARY KEY(financial_statement_snapshot_proposal_id,statement_type,account_code)
);
CREATE TABLE financial_statement_snapshot_approval (
  financial_statement_snapshot_proposal_id uuid PRIMARY KEY REFERENCES financial_statement_snapshot_proposal(financial_statement_snapshot_proposal_id),
  financial_statement_snapshot_id uuid NOT NULL UNIQUE REFERENCES financial_statement_snapshot(financial_statement_snapshot_id),
  tenant_id uuid NOT NULL, entity_id uuid NOT NULL, approved_by text NOT NULL, approved_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
ALTER TABLE financial_statement_snapshot_proposal ENABLE ROW LEVEL SECURITY;
ALTER TABLE financial_statement_snapshot_proposal_row ENABLE ROW LEVEL SECURITY;
ALTER TABLE financial_statement_snapshot_approval ENABLE ROW LEVEL SECURITY;
CREATE POLICY financial_statement_snapshot_proposal_scope ON financial_statement_snapshot_proposal USING(tenant_id=refs_current_tenant() AND refs_entity_allowed(entity_id)) WITH CHECK(false);
CREATE POLICY financial_statement_snapshot_proposal_row_scope ON financial_statement_snapshot_proposal_row USING(EXISTS(SELECT 1 FROM financial_statement_snapshot_proposal p WHERE p.financial_statement_snapshot_proposal_id=financial_statement_snapshot_proposal_row.financial_statement_snapshot_proposal_id AND p.tenant_id=refs_current_tenant() AND refs_entity_allowed(p.entity_id))) WITH CHECK(false);
CREATE POLICY financial_statement_snapshot_approval_scope ON financial_statement_snapshot_approval USING(tenant_id=refs_current_tenant() AND refs_entity_allowed(entity_id)) WITH CHECK(false);
CREATE TRIGGER financial_statement_snapshot_proposal_append_only BEFORE UPDATE OR DELETE ON financial_statement_snapshot_proposal FOR EACH ROW EXECUTE FUNCTION reject_mutation();
CREATE TRIGGER financial_statement_snapshot_proposal_row_append_only BEFORE UPDATE OR DELETE ON financial_statement_snapshot_proposal_row FOR EACH ROW EXECUTE FUNCTION reject_mutation();
CREATE TRIGGER financial_statement_snapshot_approval_append_only BEFORE UPDATE OR DELETE ON financial_statement_snapshot_approval FOR EACH ROW EXECUTE FUNCTION reject_mutation();

CREATE OR REPLACE FUNCTION refs_reserve_idempotency(p_tenant uuid,p_scope text,p_key text,p_request_hash text,p_actor text) RETURNS idempotency_receipt
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE receipt idempotency_receipt;
BEGIN
  IF refs_current_tenant() IS DISTINCT FROM p_tenant THEN RAISE EXCEPTION 'Idempotency tenant scope denied' USING ERRCODE='42501'; END IF;
  IF refs_current_actor() IS DISTINCT FROM p_actor THEN RAISE EXCEPTION 'Actor must come from the authenticated session' USING ERRCODE='42501'; END IF;
  IF p_scope NOT LIKE 'POST_JOURNAL:%' AND p_scope NOT LIKE 'EDIT_JOURNAL:%' AND p_scope NOT LIKE 'CLOSE_PERIOD:%' AND p_scope NOT LIKE 'RETIRE_CONFIG:%' AND p_scope NOT LIKE 'CREATE_MANUAL_JOURNAL:%' AND p_scope NOT LIKE 'CREATE_AUTO_JOURNAL:%' AND p_scope NOT LIKE 'CREATE_REVERSAL:%' AND p_scope NOT LIKE 'CREATE_RECLASS:%' AND p_scope NOT LIKE 'JOURNAL_SUBMIT:%' AND p_scope NOT LIKE 'JOURNAL_REVIEW:%' AND p_scope NOT LIKE 'JOURNAL_APPROVE:%' AND p_scope NOT LIKE 'JOURNAL_REJECT:%' AND p_scope NOT LIKE 'AR_RECEIPT_REVERSAL:%' AND p_scope NOT LIKE 'AP_PAYMENT_REVERSAL:%' AND p_scope NOT LIKE 'PREPARE_STATEMENT_SNAPSHOT:%' AND p_scope NOT LIKE 'APPROVE_STATEMENT_SNAPSHOT:%' THEN RAISE EXCEPTION 'Idempotency operation scope denied' USING ERRCODE='42501'; END IF;
  INSERT INTO idempotency_receipt(tenant_id,operation_scope,idempotency_key,request_hash,status,actor_id) VALUES(p_tenant,p_scope,p_key,p_request_hash,'IN_PROGRESS',p_actor) ON CONFLICT(tenant_id,operation_scope,idempotency_key) DO NOTHING;
  SELECT * INTO receipt FROM idempotency_receipt WHERE tenant_id=p_tenant AND operation_scope=p_scope AND idempotency_key=p_key FOR UPDATE;
  IF receipt.request_hash<>p_request_hash THEN RAISE EXCEPTION 'Idempotency key reused with different request hash' USING ERRCODE='23505'; END IF;
  RETURN receipt;
END; $$;

CREATE FUNCTION refs_prepare_financial_statement_snapshot(p_tenant uuid,p_entity uuid,p_period uuid,p_idempotency_key text,p_request_hash text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE v_actor text:=refs_current_actor(); v_receipt idempotency_receipt; v_rows jsonb; v_row jsonb; v_proposal uuid:=gen_random_uuid(); v_hash text; v_evidence_hash text; v_currency char(3); v_response jsonb;
BEGIN
  PERFORM refs_assert_scope(p_tenant,p_entity,'GL.REPORT.SNAPSHOT.PREPARE');
  PERFORM refs_assert_scope(p_tenant,p_entity,'GL.REPORT.VIEW');
  IF v_actor IS NULL THEN RAISE EXCEPTION 'Authenticated actor missing' USING ERRCODE='42501'; END IF;
  IF p_request_hash<>refs_jsonb_hash(jsonb_build_object('tenant_id',p_tenant,'entity_id',p_entity,'period_id',p_period)) THEN RAISE EXCEPTION 'Statement snapshot request hash is not canonical' USING ERRCODE='22023'; END IF;
  v_receipt:=refs_reserve_idempotency(p_tenant,'PREPARE_STATEMENT_SNAPSHOT:'||p_entity,p_idempotency_key,p_request_hash,v_actor);
  IF v_receipt.status='SUCCEEDED' THEN RETURN v_receipt.response_body; END IF;
  SELECT e.base_currency INTO v_currency FROM entity e WHERE e.tenant_id=p_tenant AND e.entity_id=p_entity;
  SELECT jsonb_agg(jsonb_build_object('statement_type',statement_type,'statement_section',statement_section,'classification_basis',classification_basis,'account_code',account_code,'account_name',account_name,'opening_debit',opening_debit,'opening_credit',opening_credit,'period_debit',period_debit,'period_credit',period_credit,'ending_debit',ending_debit,'ending_credit',ending_credit,'display_balance',display_balance,'journal_entry_ids',journal_entry_ids,'journal_line_ids',journal_line_ids,'ledger_line_ids',ledger_line_ids,'source_document_ids',source_document_ids) ORDER BY statement_type,statement_section,account_code) INTO v_rows FROM refs_get_financial_statements(p_tenant,p_entity,p_period);
  IF v_rows IS NULL OR jsonb_array_length(v_rows)=0 THEN RAISE EXCEPTION 'Posted ledger evidence is required before preparing a statement snapshot' USING ERRCODE='22023'; END IF;
  v_hash:=refs_jsonb_hash(v_rows); v_evidence_hash:=refs_jsonb_hash(jsonb_build_object('statement_rows',v_rows));
  INSERT INTO financial_statement_snapshot_proposal(financial_statement_snapshot_proposal_id,tenant_id,entity_id,period_id,currency,snapshot_hash,ledger_evidence_hash,prepared_by) VALUES(v_proposal,p_tenant,p_entity,p_period,v_currency,v_hash,v_evidence_hash,v_actor);
  FOR v_row IN SELECT value FROM jsonb_array_elements(v_rows) LOOP
    INSERT INTO financial_statement_snapshot_proposal_row SELECT v_proposal,v_row->>'statement_type',v_row->>'statement_section',v_row->>'classification_basis',v_row->>'account_code',v_row->>'account_name',(v_row->>'opening_debit')::numeric,(v_row->>'opening_credit')::numeric,(v_row->>'period_debit')::numeric,(v_row->>'period_credit')::numeric,(v_row->>'ending_debit')::numeric,(v_row->>'ending_credit')::numeric,(v_row->>'display_balance')::numeric,ARRAY(SELECT jsonb_array_elements_text(v_row->'journal_entry_ids'))::uuid[],ARRAY(SELECT jsonb_array_elements_text(v_row->'journal_line_ids'))::uuid[],ARRAY(SELECT jsonb_array_elements_text(v_row->'ledger_line_ids'))::uuid[],ARRAY(SELECT jsonb_array_elements_text(v_row->'source_document_ids'))::uuid[],refs_jsonb_hash(v_row);
  END LOOP;
  v_response:=jsonb_build_object('financial_statement_snapshot_proposal_id',v_proposal,'status','PENDING_APPROVAL','snapshot_hash',v_hash,'ledger_evidence_hash',v_evidence_hash,'prepared_by',v_actor);
  UPDATE idempotency_receipt SET status='SUCCEEDED',response_status=201,response_body=v_response,completed_at=clock_timestamp() WHERE idempotency_receipt_id=v_receipt.idempotency_receipt_id;
  RETURN v_response;
END; $$;

CREATE FUNCTION refs_approve_financial_statement_snapshot(p_tenant uuid,p_entity uuid,p_proposal uuid,p_idempotency_key text,p_request_hash text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE v_actor text:=refs_current_actor(); v_receipt idempotency_receipt; v_proposal_row financial_statement_snapshot_proposal%ROWTYPE; v_snapshot uuid:=gen_random_uuid(); v_version bigint; v_response jsonb;
BEGIN
  PERFORM refs_assert_scope(p_tenant,p_entity,'GL.REPORT.SNAPSHOT.APPROVE');
  IF v_actor IS NULL THEN RAISE EXCEPTION 'Authenticated actor missing' USING ERRCODE='42501'; END IF;
  IF p_request_hash<>refs_jsonb_hash(jsonb_build_object('tenant_id',p_tenant,'entity_id',p_entity,'proposal_id',p_proposal)) THEN RAISE EXCEPTION 'Statement snapshot approval hash is not canonical' USING ERRCODE='22023'; END IF;
  v_receipt:=refs_reserve_idempotency(p_tenant,'APPROVE_STATEMENT_SNAPSHOT:'||p_entity,p_idempotency_key,p_request_hash,v_actor); IF v_receipt.status='SUCCEEDED' THEN RETURN v_receipt.response_body; END IF;
  SELECT * INTO v_proposal_row FROM financial_statement_snapshot_proposal WHERE financial_statement_snapshot_proposal_id=p_proposal AND tenant_id=p_tenant AND entity_id=p_entity FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Statement snapshot proposal not found' USING ERRCODE='P0002'; END IF;
  IF v_actor=v_proposal_row.prepared_by THEN RAISE EXCEPTION 'Statement snapshot preparer cannot approve their own proposal' USING ERRCODE='42501'; END IF;
  IF EXISTS(SELECT 1 FROM financial_statement_snapshot_approval WHERE financial_statement_snapshot_proposal_id=p_proposal) THEN RAISE EXCEPTION 'Statement snapshot proposal has already been approved' USING ERRCODE='23505'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(p_tenant::text||p_entity::text||v_proposal_row.period_id::text,0));
  SELECT COALESCE(max(version),0)+1 INTO v_version FROM financial_statement_snapshot WHERE tenant_id=p_tenant AND entity_id=p_entity AND period_id=v_proposal_row.period_id;
  INSERT INTO financial_statement_snapshot(financial_statement_snapshot_id,tenant_id,entity_id,period_id,version,currency,snapshot_hash,ledger_evidence_hash,prepared_by,approved_by,approved_at) VALUES(v_snapshot,p_tenant,p_entity,v_proposal_row.period_id,v_version,v_proposal_row.currency,v_proposal_row.snapshot_hash,v_proposal_row.ledger_evidence_hash,v_proposal_row.prepared_by,v_actor,clock_timestamp());
  INSERT INTO financial_statement_snapshot_row SELECT v_snapshot,p_tenant,p_entity,v_proposal_row.period_id,statement_type,statement_section,classification_basis,account_code,account_name,opening_debit,opening_credit,period_debit,period_credit,ending_debit,ending_credit,display_balance,journal_entry_ids,journal_line_ids,ledger_line_ids,source_document_ids,row_hash FROM financial_statement_snapshot_proposal_row WHERE financial_statement_snapshot_proposal_id=p_proposal;
  INSERT INTO financial_statement_snapshot_approval(financial_statement_snapshot_proposal_id,financial_statement_snapshot_id,tenant_id,entity_id,approved_by) VALUES(p_proposal,v_snapshot,p_tenant,p_entity,v_actor);
  v_response:=jsonb_build_object('financial_statement_snapshot_id',v_snapshot,'financial_statement_snapshot_proposal_id',p_proposal,'version',v_version::text,'status','APPROVED','prepared_by',v_proposal_row.prepared_by,'approved_by',v_actor,'snapshot_hash',v_proposal_row.snapshot_hash,'ledger_evidence_hash',v_proposal_row.ledger_evidence_hash);
  UPDATE idempotency_receipt SET status='SUCCEEDED',response_status=201,response_body=v_response,completed_at=clock_timestamp() WHERE idempotency_receipt_id=v_receipt.idempotency_receipt_id; RETURN v_response;
END; $$;

REVOKE ALL ON TABLE financial_statement_snapshot_proposal,financial_statement_snapshot_proposal_row,financial_statement_snapshot_approval FROM PUBLIC,refs_app;
REVOKE ALL ON FUNCTION refs_prepare_financial_statement_snapshot(uuid,uuid,uuid,text,text),refs_approve_financial_statement_snapshot(uuid,uuid,uuid,text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION refs_prepare_financial_statement_snapshot(uuid,uuid,uuid,text,text),refs_approve_financial_statement_snapshot(uuid,uuid,uuid,text,text) TO refs_app;
COMMIT;
