BEGIN;

DO $$
DECLARE fn text;
BEGIN
  SELECT pg_get_functiondef('refs_create_ar_credit_memo(uuid,uuid,uuid,text,date,text,text,numeric,jsonb,text,text,text)'::regprocedure) INTO fn;
  IF position('AR credit memo lines must be unique, non-control, positive and equal header amount' IN fn)=0 THEN RAISE EXCEPTION 'Cannot restore pre-044 AR credit memo function'; END IF;
  fn:=replace(fn,$r$OR btrim(x.account_code)='120200'$r$,'');
  fn:=replace(fn,'AR credit memo lines must be unique, non-control, positive and equal header amount','AR credit memo lines must be unique, positive and equal header amount');
  fn:=replace(fn,$r$VALUES(p_tenant,p_entity,p_period,journal_id,1,'120200',0,p_amount,btrim(p_customer_ref),'Credit memo '||btrim(p_memo_number),'{}'::jsonb)$r$,$r$VALUES(p_tenant,p_entity,p_period,journal_id,1,'120200',p_amount,0,btrim(p_customer_ref),'Credit memo '||btrim(p_memo_number),'{}'::jsonb)$r$);
  fn:=replace(fn,$r$SELECT p_tenant,p_entity,p_period,journal_id,x.line_no+1,btrim(x.account_code),x.amount,0,x.member_ref,x.description,COALESCE(x.dimensions,'{}'::jsonb)$r$,$r$SELECT p_tenant,p_entity,p_period,journal_id,x.line_no+1,btrim(x.account_code),0,x.amount,x.member_ref,x.description,COALESCE(x.dimensions,'{}'::jsonb)$r$);
  EXECUTE fn;

  SELECT pg_get_functiondef('refs_create_ar_refund(uuid,uuid,uuid,uuid,text,date,text,numeric,text,text,text)'::regprocedure) INTO fn;
  IF position('Refund source credit lacks a posted customer control line' IN fn)=0 THEN RAISE EXCEPTION 'Cannot restore pre-044 AR refund function'; END IF;
  fn:=replace(fn,'; customer_ref text;',';');
  fn:=replace(fn,$r$ SELECT l.member_ref INTO customer_ref FROM journal_line l WHERE l.tenant_id=p_tenant AND l.entity_id=p_entity AND l.journal_entry_id=source_adj.posted_journal_entry_id AND l.account_code='120200' AND l.credit_amount>0 AND l.debit_amount=0 ORDER BY l.line_no FOR SHARE;
 IF customer_ref IS NULL THEN RAISE EXCEPTION 'Refund source credit lacks a posted customer control line' USING ERRCODE='23514'; END IF;
$r$,'');
  fn:=replace(fn,$r$VALUES(p_tenant,p_entity,p_period,journal_id,1,'120200',p_amount,0,customer_ref,'Customer refund','{}'::jsonb),(p_tenant,p_entity,p_period,journal_id,2,btrim(p_cash_account),0,p_amount,NULL,'Cash refund','{}'::jsonb)$r$,$r$VALUES(p_tenant,p_entity,p_period,journal_id,1,'220000',p_amount,0,NULL,'Customer refund','{}'::jsonb),(p_tenant,p_entity,p_period,journal_id,2,btrim(p_cash_account),0,p_amount,NULL,'Cash refund','{}'::jsonb)$r$);
  EXECUTE fn;
END $$;

CREATE OR REPLACE VIEW refs_ap_ar_control_reconciliation WITH (security_invoker=true) AS
WITH document_totals AS (
  SELECT tenant_id,entity_id,currency,
    COALESCE(sum(open_balance) FILTER (WHERE document_kind='AP_BILL' AND status<>'VOID'),0)::numeric(20,4) AS ap_open_balance,
    COALESCE(sum(open_balance) FILTER (WHERE document_kind='AR_INVOICE'),0)::numeric(20,4) AS ar_open_balance
  FROM business_document GROUP BY tenant_id,entity_id,currency
), ledger_totals AS (
  SELECT je.tenant_id,je.entity_id,je.currency,
    COALESCE(sum(ll.credit_amount-ll.debit_amount) FILTER (WHERE ll.account_code='291001'),0)::numeric(20,4) AS ap_control_balance,
    COALESCE(sum(ll.debit_amount-ll.credit_amount) FILTER (WHERE ll.account_code='120200'),0)::numeric(20,4) AS ar_control_balance
  FROM journal_entry je JOIN ledger_line ll ON ll.tenant_id=je.tenant_id AND ll.entity_id=je.entity_id AND ll.journal_entry_id=je.journal_entry_id
  GROUP BY je.tenant_id,je.entity_id,je.currency
)
SELECT COALESCE(d.tenant_id,l.tenant_id) AS tenant_id,COALESCE(d.entity_id,l.entity_id) AS entity_id,COALESCE(d.currency,l.currency) AS currency,
  COALESCE(d.ap_open_balance,0)::numeric(20,4) AS ap_open_balance,COALESCE(l.ap_control_balance,0)::numeric(20,4) AS ap_control_balance,
  COALESCE(d.ap_open_balance,0)=COALESCE(l.ap_control_balance,0) AS ap_in_balance,
  COALESCE(d.ar_open_balance,0)::numeric(20,4) AS ar_open_balance,COALESCE(l.ar_control_balance,0)::numeric(20,4) AS ar_control_balance,
  COALESCE(d.ar_open_balance,0)=COALESCE(l.ar_control_balance,0) AS ar_in_balance
FROM document_totals d FULL OUTER JOIN ledger_totals l ON l.tenant_id=d.tenant_id AND l.entity_id=d.entity_id AND l.currency=d.currency;
GRANT SELECT ON refs_ap_ar_control_reconciliation TO refs_app;
COMMIT;
