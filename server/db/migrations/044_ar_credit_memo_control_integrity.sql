BEGIN;

-- Existing credit memos created by the pre-044 routine debit AR.  They cannot
-- be reinterpreted safely: stop an upgrade rather than silently mixing bases.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM business_adjustment a
    JOIN journal_line l ON l.tenant_id=a.tenant_id AND l.entity_id=a.entity_id
      AND l.journal_entry_id=a.posted_journal_entry_id
    WHERE a.adjustment_kind='AR_CREDIT_MEMO' AND a.status='POSTED'
      AND l.account_code='120200' AND l.debit_amount>0
  ) THEN
    RAISE EXCEPTION 'Legacy AR credit memos use an unsafe AR debit direction; remediate before migration 044' USING ERRCODE='55000';
  END IF;
END $$;

CREATE OR REPLACE FUNCTION refs_create_ar_credit_memo(p_tenant uuid,p_entity uuid,p_period uuid,p_memo_number text,p_memo_date date,p_customer_ref text,p_customer_name text,p_amount numeric,p_lines jsonb,p_reason text,p_idempotency_key text,p_request_hash text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE actor text:=refs_current_actor(); receipt idempotency_receipt; entity_row entity; journal_id uuid:=gen_random_uuid(); adjustment_id uuid:=gen_random_uuid(); computed_hash text; line_count integer; response jsonb; event_payload jsonb;
BEGIN
 PERFORM refs_assert_scope(p_tenant,p_entity,'AR.CREDIT_MEMO.CREATE'); IF actor IS NULL THEN RAISE EXCEPTION 'Authenticated actor missing' USING ERRCODE='42501'; END IF;
 computed_hash:=refs_ar_credit_memo_hash(p_tenant,p_entity,p_period,p_memo_number,p_memo_date,p_customer_ref,p_customer_name,p_amount,p_lines,p_reason); IF p_request_hash<>computed_hash THEN RAISE EXCEPTION 'AR credit memo request hash is not canonical' USING ERRCODE='22023'; END IF;
 IF COALESCE(length(btrim(p_memo_number)),0)=0 OR COALESCE(length(btrim(p_customer_ref)),0)=0 OR COALESCE(length(btrim(p_customer_name)),0)=0 OR p_amount<=0 OR COALESCE(length(btrim(p_reason)),0)<8 THEN RAISE EXCEPTION 'AR credit memo requires valid header and reason' USING ERRCODE='22023'; END IF;
 INSERT INTO idempotency_receipt(tenant_id,operation_scope,idempotency_key,request_hash,status,actor_id) VALUES(p_tenant,'AR_CREDIT_MEMO:'||p_entity,p_idempotency_key,p_request_hash,'IN_PROGRESS',actor) ON CONFLICT DO NOTHING;
 SELECT * INTO receipt FROM idempotency_receipt WHERE tenant_id=p_tenant AND operation_scope='AR_CREDIT_MEMO:'||p_entity AND idempotency_key=p_idempotency_key FOR UPDATE;
 IF receipt.request_hash<>p_request_hash THEN RAISE EXCEPTION 'Idempotency key reused with a different request' USING ERRCODE='23505'; END IF; IF receipt.status='SUCCEEDED' THEN RETURN receipt.response_body||jsonb_build_object('idempotent',true); END IF;
 PERFORM 1 FROM accounting_period WHERE tenant_id=p_tenant AND entity_id=p_entity AND period_id=p_period AND status='OPEN' AND p_memo_date BETWEEN starts_on AND ends_on FOR SHARE; IF NOT FOUND THEN RAISE EXCEPTION 'AR credit memo period must be OPEN and own the memo date' USING ERRCODE='55000'; END IF;
 SELECT * INTO entity_row FROM entity WHERE tenant_id=p_tenant AND entity_id=p_entity FOR SHARE; IF NOT FOUND THEN RAISE EXCEPTION 'Entity not found' USING ERRCODE='23503'; END IF;
 IF jsonb_typeof(p_lines)<>'array' THEN RAISE EXCEPTION 'AR credit memo lines must be an array' USING ERRCODE='23514'; END IF;
 SELECT count(*) INTO line_count FROM jsonb_to_recordset(p_lines) AS x(line_no integer,account_code text,amount numeric,member_ref text,description text,dimensions jsonb);
 IF line_count<>jsonb_array_length(p_lines) OR line_count<1 OR EXISTS(SELECT 1 FROM jsonb_to_recordset(p_lines) AS x(line_no integer,account_code text,amount numeric,dimensions jsonb) WHERE x.line_no IS NULL OR x.line_no<=0 OR COALESCE(length(btrim(x.account_code)),0)=0 OR btrim(x.account_code)='120200' OR COALESCE(x.amount,0)<=0 OR (x.dimensions IS NOT NULL AND jsonb_typeof(x.dimensions)<>'object')) OR EXISTS(SELECT 1 FROM jsonb_to_recordset(p_lines) AS x(line_no integer) GROUP BY x.line_no HAVING count(*)>1) OR (SELECT COALESCE(sum(x.amount),0)<>p_amount FROM jsonb_to_recordset(p_lines) AS x(amount numeric)) THEN RAISE EXCEPTION 'AR credit memo lines must be unique, non-control, positive and equal header amount' USING ERRCODE='23514'; END IF;
 INSERT INTO journal_entry(journal_entry_id,tenant_id,entity_id,period_id,journal_number,journal_type,status,journal_date,currency,description,created_by) VALUES(journal_id,p_tenant,p_entity,p_period,btrim(p_memo_number),'AUTO','DRAFT',p_memo_date,entity_row.base_currency,'Credit memo '||btrim(p_memo_number),actor);
 INSERT INTO journal_line(tenant_id,entity_id,period_id,journal_entry_id,line_no,account_code,debit_amount,credit_amount,member_ref,description,dimensions) VALUES(p_tenant,p_entity,p_period,journal_id,1,'120200',0,p_amount,btrim(p_customer_ref),'Credit memo '||btrim(p_memo_number),'{}'::jsonb);
 INSERT INTO journal_line(tenant_id,entity_id,period_id,journal_entry_id,line_no,account_code,debit_amount,credit_amount,member_ref,description,dimensions) SELECT p_tenant,p_entity,p_period,journal_id,x.line_no+1,btrim(x.account_code),x.amount,0,x.member_ref,x.description,COALESCE(x.dimensions,'{}'::jsonb) FROM jsonb_to_recordset(p_lines) AS x(line_no integer,account_code text,amount numeric,member_ref text,description text,dimensions jsonb);
 INSERT INTO business_adjustment(business_adjustment_id,tenant_id,entity_id,adjustment_kind,amount,currency,accounting_date,period_id,reason,status,draft_journal_entry_id,idempotency_key,request_hash,created_by) VALUES(adjustment_id,p_tenant,p_entity,'AR_CREDIT_MEMO',p_amount,entity_row.base_currency,p_memo_date,p_period,p_reason,'DRAFT',journal_id,p_idempotency_key,p_request_hash,actor);
 response:=jsonb_build_object('business_adjustment_id',adjustment_id,'journal_entry_id',journal_id,'status','DRAFT','revision',0,'idempotent',false);
 INSERT INTO audit_event(tenant_id,entity_id,event_type,object_type,object_id,action,actor_id,actor_type,permission_used,request_id,correlation_id,idempotency_key,after_hash,reason) VALUES(p_tenant,p_entity,'AR_CREDIT_MEMO_DRAFT_CREATED','BUSINESS_ADJUSTMENT',adjustment_id,'CREATE_AR_CREDIT_MEMO',actor,'USER','AR.CREDIT_MEMO.CREATE',p_idempotency_key,p_idempotency_key,p_idempotency_key,p_request_hash,p_reason);
 event_payload:=jsonb_build_object('business_adjustment_id',adjustment_id,'journal_entry_id',journal_id,'status','DRAFT'); INSERT INTO outbox_event(tenant_id,entity_id,aggregate_type,aggregate_id,event_type,payload,payload_hash) VALUES(p_tenant,p_entity,'BUSINESS_ADJUSTMENT',adjustment_id,'AR_CREDIT_MEMO_DRAFT_CREATED',event_payload,refs_jsonb_hash(event_payload));
 UPDATE idempotency_receipt SET status='SUCCEEDED',response_status=201,response_body=response,completed_at=clock_timestamp() WHERE tenant_id=p_tenant AND operation_scope='AR_CREDIT_MEMO:'||p_entity AND idempotency_key=p_idempotency_key; RETURN response;
END;
$$;

CREATE OR REPLACE FUNCTION refs_create_ar_refund(p_tenant uuid,p_entity uuid,p_period uuid,p_source_adjustment uuid,p_refund_number text,p_refund_date date,p_cash_account text,p_amount numeric,p_reason text,p_idempotency_key text,p_request_hash text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE actor text:=refs_current_actor(); receipt idempotency_receipt; source_adj business_adjustment; period_row accounting_period; entity_row entity; computed_hash text; refunded numeric(20,4); allocated numeric(20,4); customer_ref text; journal_id uuid:=gen_random_uuid(); adjustment_id uuid:=gen_random_uuid(); response jsonb; event_payload jsonb;
BEGIN
 PERFORM refs_assert_scope(p_tenant,p_entity,'AR.REFUND.CREATE'); IF actor IS NULL THEN RAISE EXCEPTION 'Authenticated actor missing' USING ERRCODE='42501'; END IF;
 computed_hash:=refs_ar_refund_hash(p_tenant,p_entity,p_period,p_source_adjustment,p_refund_number,p_refund_date,p_cash_account,p_amount,p_reason); IF p_request_hash<>computed_hash THEN RAISE EXCEPTION 'AR refund request hash is not canonical' USING ERRCODE='22023'; END IF;
 IF COALESCE(length(btrim(p_refund_number)),0)=0 OR COALESCE(length(btrim(p_cash_account)),0)=0 OR p_amount<=0 OR COALESCE(length(btrim(p_reason)),0)<8 THEN RAISE EXCEPTION 'AR refund requires valid number, cash account, amount and reason' USING ERRCODE='22023'; END IF;
 INSERT INTO idempotency_receipt(tenant_id,operation_scope,idempotency_key,request_hash,status,actor_id) VALUES(p_tenant,'AR_REFUND:'||p_entity,p_idempotency_key,p_request_hash,'IN_PROGRESS',actor) ON CONFLICT DO NOTHING;
 SELECT * INTO receipt FROM idempotency_receipt WHERE tenant_id=p_tenant AND operation_scope='AR_REFUND:'||p_entity AND idempotency_key=p_idempotency_key FOR UPDATE;
 IF receipt.request_hash<>p_request_hash THEN RAISE EXCEPTION 'Idempotency key reused with a different request' USING ERRCODE='23505'; END IF; IF receipt.status='SUCCEEDED' THEN RETURN receipt.response_body||jsonb_build_object('idempotent',true); END IF;
 SELECT * INTO period_row FROM accounting_period WHERE tenant_id=p_tenant AND entity_id=p_entity AND period_id=p_period AND status='OPEN' AND p_refund_date BETWEEN starts_on AND ends_on FOR SHARE; IF NOT FOUND THEN RAISE EXCEPTION 'AR refund period must be OPEN and own the refund date' USING ERRCODE='55000'; END IF;
 SELECT * INTO entity_row FROM entity WHERE tenant_id=p_tenant AND entity_id=p_entity FOR SHARE; IF NOT FOUND THEN RAISE EXCEPTION 'Entity not found' USING ERRCODE='23503'; END IF;
 SELECT * INTO source_adj FROM business_adjustment WHERE tenant_id=p_tenant AND entity_id=p_entity AND business_adjustment_id=p_source_adjustment FOR UPDATE;
 IF NOT FOUND OR source_adj.adjustment_kind<>'AR_CREDIT_MEMO' OR source_adj.status<>'POSTED' OR source_adj.posted_journal_entry_id IS NULL THEN RAISE EXCEPTION 'Refund requires a posted customer credit memo' USING ERRCODE='23514'; END IF;
 SELECT l.member_ref INTO customer_ref FROM journal_line l WHERE l.tenant_id=p_tenant AND l.entity_id=p_entity AND l.journal_entry_id=source_adj.posted_journal_entry_id AND l.account_code='120200' AND l.credit_amount>0 AND l.debit_amount=0 ORDER BY l.line_no FOR SHARE;
 IF customer_ref IS NULL THEN RAISE EXCEPTION 'Refund source credit lacks a posted customer control line' USING ERRCODE='23514'; END IF;
 PERFORM 1 FROM business_allocation WHERE tenant_id=p_tenant AND entity_id=p_entity AND business_adjustment_id=p_source_adjustment AND status IN ('PENDING','ACTIVE') FOR UPDATE;
 SELECT COALESCE(sum(amount),0) INTO allocated FROM business_allocation WHERE tenant_id=p_tenant AND entity_id=p_entity AND business_adjustment_id=p_source_adjustment AND status IN ('PENDING','ACTIVE');
 SELECT COALESCE(sum(amount),0) INTO refunded FROM business_adjustment WHERE tenant_id=p_tenant AND entity_id=p_entity AND adjustment_kind='AR_REFUND' AND source_adjustment_id=p_source_adjustment AND status IN ('DRAFT','PENDING_REVIEW','PENDING_APPROVAL','APPROVED_PENDING_POST','POSTED');
 IF allocated+refunded+p_amount>source_adj.amount THEN RAISE EXCEPTION 'AR refund exceeds available posted credit' USING ERRCODE='23514'; END IF;
 INSERT INTO journal_entry(journal_entry_id,tenant_id,entity_id,period_id,journal_number,journal_type,status,journal_date,currency,description,created_by) VALUES(journal_id,p_tenant,p_entity,p_period,btrim(p_refund_number),'AUTO','DRAFT',p_refund_date,entity_row.base_currency,'Refund '||btrim(p_refund_number),actor);
 INSERT INTO journal_line(tenant_id,entity_id,period_id,journal_entry_id,line_no,account_code,debit_amount,credit_amount,member_ref,description,dimensions) VALUES(p_tenant,p_entity,p_period,journal_id,1,'120200',p_amount,0,customer_ref,'Customer refund','{}'::jsonb),(p_tenant,p_entity,p_period,journal_id,2,btrim(p_cash_account),0,p_amount,NULL,'Cash refund','{}'::jsonb);
 INSERT INTO business_adjustment(business_adjustment_id,tenant_id,entity_id,adjustment_kind,source_adjustment_id,amount,currency,accounting_date,period_id,reason,status,draft_journal_entry_id,idempotency_key,request_hash,created_by) VALUES(adjustment_id,p_tenant,p_entity,'AR_REFUND',p_source_adjustment,p_amount,entity_row.base_currency,p_refund_date,p_period,p_reason,'DRAFT',journal_id,p_idempotency_key,p_request_hash,actor);
 response:=jsonb_build_object('business_adjustment_id',adjustment_id,'journal_entry_id',journal_id,'source_adjustment_id',p_source_adjustment,'status','DRAFT','revision',0,'idempotent',false);
 INSERT INTO audit_event(tenant_id,entity_id,event_type,object_type,object_id,action,actor_id,actor_type,permission_used,request_id,correlation_id,idempotency_key,after_hash,reason) VALUES(p_tenant,p_entity,'AR_REFUND_DRAFT_CREATED','BUSINESS_ADJUSTMENT',adjustment_id,'CREATE_AR_REFUND',actor,'USER','AR.REFUND.CREATE',p_idempotency_key,p_idempotency_key,p_idempotency_key,p_request_hash,p_reason);
 event_payload:=jsonb_build_object('business_adjustment_id',adjustment_id,'source_adjustment_id',p_source_adjustment,'journal_entry_id',journal_id,'status','DRAFT'); INSERT INTO outbox_event(tenant_id,entity_id,aggregate_type,aggregate_id,event_type,payload,payload_hash) VALUES(p_tenant,p_entity,'BUSINESS_ADJUSTMENT',adjustment_id,'AR_REFUND_DRAFT_CREATED',event_payload,refs_jsonb_hash(event_payload));
 UPDATE idempotency_receipt SET status='SUCCEEDED',response_status=201,response_body=response,completed_at=clock_timestamp() WHERE tenant_id=p_tenant AND operation_scope='AR_REFUND:'||p_entity AND idempotency_key=p_idempotency_key; RETURN response;
END; $$;

CREATE OR REPLACE VIEW refs_ap_ar_control_reconciliation WITH (security_invoker=true) AS
WITH document_totals AS (
  SELECT tenant_id,entity_id,currency,
    COALESCE(sum(open_balance) FILTER (WHERE document_kind='AP_BILL' AND status<>'VOID'),0)::numeric(20,4) AS ap_document_open,
    COALESCE(sum(open_balance) FILTER (WHERE document_kind='AR_INVOICE'),0)::numeric(20,4) AS ar_document_open
  FROM business_document GROUP BY tenant_id,entity_id,currency
), allocation_totals AS (
  SELECT tenant_id,entity_id,business_adjustment_id,COALESCE(sum(amount) FILTER (WHERE status='ACTIVE'),0)::numeric(20,4) AS active_amount
  FROM business_allocation GROUP BY tenant_id,entity_id,business_adjustment_id
), refund_totals AS (
  SELECT tenant_id,entity_id,source_adjustment_id,COALESCE(sum(amount) FILTER (WHERE status='POSTED'),0)::numeric(20,4) AS posted_amount
  FROM business_adjustment WHERE adjustment_kind='AR_REFUND' GROUP BY tenant_id,entity_id,source_adjustment_id
), adjustment_totals AS (
  SELECT a.tenant_id,a.entity_id,a.currency,
    COALESCE(sum(a.amount-COALESCE(at.active_amount,0)) FILTER (WHERE a.adjustment_kind='AP_VENDOR_CREDIT'),0)::numeric(20,4) AS ap_available_credit,
    COALESCE(sum(a.amount-COALESCE(at.active_amount,0)-COALESCE(rt.posted_amount,0)) FILTER (WHERE a.adjustment_kind='AR_CREDIT_MEMO'),0)::numeric(20,4) AS ar_available_credit
  FROM business_adjustment a
  LEFT JOIN allocation_totals at ON at.tenant_id=a.tenant_id AND at.entity_id=a.entity_id AND at.business_adjustment_id=a.business_adjustment_id
  LEFT JOIN refund_totals rt ON rt.tenant_id=a.tenant_id AND rt.entity_id=a.entity_id AND rt.source_adjustment_id=a.business_adjustment_id
  WHERE a.status='POSTED' AND a.adjustment_kind IN ('AP_VENDOR_CREDIT','AR_CREDIT_MEMO')
  GROUP BY a.tenant_id,a.entity_id,a.currency
), ledger_totals AS (
  SELECT je.tenant_id,je.entity_id,je.currency,
    COALESCE(sum(ll.credit_amount-ll.debit_amount) FILTER (WHERE ll.account_code='291001'),0)::numeric(20,4) AS ap_control_balance,
    COALESCE(sum(ll.debit_amount-ll.credit_amount) FILTER (WHERE ll.account_code='120200'),0)::numeric(20,4) AS ar_control_balance
  FROM journal_entry je JOIN ledger_line ll ON ll.tenant_id=je.tenant_id AND ll.entity_id=je.entity_id AND ll.journal_entry_id=je.journal_entry_id
  GROUP BY je.tenant_id,je.entity_id,je.currency
), net_totals AS (
  SELECT COALESCE(d.tenant_id,a.tenant_id,l.tenant_id) AS tenant_id,COALESCE(d.entity_id,a.entity_id,l.entity_id) AS entity_id,COALESCE(d.currency,a.currency,l.currency) AS currency,
    (COALESCE(d.ap_document_open,0)-COALESCE(a.ap_available_credit,0))::numeric(20,4) AS ap_open_balance,
    (COALESCE(d.ar_document_open,0)-COALESCE(a.ar_available_credit,0))::numeric(20,4) AS ar_open_balance,
    COALESCE(l.ap_control_balance,0)::numeric(20,4) AS ap_control_balance,COALESCE(l.ar_control_balance,0)::numeric(20,4) AS ar_control_balance
  FROM document_totals d FULL JOIN adjustment_totals a ON a.tenant_id=d.tenant_id AND a.entity_id=d.entity_id AND a.currency=d.currency
  FULL JOIN ledger_totals l ON l.tenant_id=COALESCE(d.tenant_id,a.tenant_id) AND l.entity_id=COALESCE(d.entity_id,a.entity_id) AND l.currency=COALESCE(d.currency,a.currency)
)
SELECT tenant_id,entity_id,currency,
  ap_open_balance,ap_control_balance,ap_open_balance=ap_control_balance AS ap_in_balance,
  ar_open_balance,ar_control_balance,ar_open_balance=ar_control_balance AS ar_in_balance
FROM net_totals;
GRANT SELECT ON refs_ap_ar_control_reconciliation TO refs_app;
COMMIT;
