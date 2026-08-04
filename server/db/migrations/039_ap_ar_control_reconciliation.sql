BEGIN;
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
