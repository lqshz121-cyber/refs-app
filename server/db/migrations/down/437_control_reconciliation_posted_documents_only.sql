BEGIN;

-- Restores the 044 definition byte for byte (subledger side counts every non-VOID AP bill and every
-- AR invoice, posted or not) and 044's direct SELECT grant to refs_app. This reinstates the
-- draft-noise defect described in the up body; it exists for chain reversibility only.

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
COMMENT ON VIEW refs_ap_ar_control_reconciliation IS NULL;

COMMIT;
