BEGIN;

CREATE FUNCTION refs_ap_ar_period_control_lineage(
  p_tenant uuid,
  p_entity uuid,
  p_period uuid,
  p_module text
)
RETURNS TABLE(
  period_id uuid,
  account_code text,
  currency char(3),
  open_balance numeric(20,4),
  control_balance numeric(20,4),
  in_balance boolean,
  business_document_ids uuid[],
  document_source_document_ids uuid[],
  journal_entry_ids uuid[],
  journal_line_ids uuid[],
  ledger_line_ids uuid[],
  source_document_ids uuid[],
  document_contributors jsonb,
  ledger_contributors jsonb
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE
  module_code text:=upper(COALESCE(p_module,''));
  v_document_kind text;
  v_control_account text;
  v_permission_code text;
BEGIN
  IF module_code='AP' THEN
    v_document_kind:='AP_BILL';v_control_account:='291001';v_permission_code:='AP.VIEW';
  ELSIF module_code='AR' THEN
    v_document_kind:='AR_INVOICE';v_control_account:='120200';v_permission_code:='AR.VIEW';
  ELSE
    RAISE EXCEPTION 'AP/AR control module is invalid' USING ERRCODE='22023';
  END IF;

  PERFORM refs_assert_scope(p_tenant,p_entity,v_permission_code);
  IF NOT EXISTS(
    SELECT 1 FROM accounting_period p
    WHERE p.tenant_id=p_tenant AND p.entity_id=p_entity AND p.period_id=p_period
  ) THEN
    RAISE EXCEPTION 'Accounting period is absent or outside the entity' USING ERRCODE='P0002';
  END IF;

  RETURN QUERY
  WITH target AS MATERIALIZED (
    SELECT p.period_id,p.ends_on
    FROM accounting_period p
    WHERE p.tenant_id=p_tenant AND p.entity_id=p_entity AND p.period_id=p_period
  ), eligible_documents AS MATERIALIZED (
    SELECT d.business_document_id,d.source_document_id,d.posted_journal_entry_id,d.currency,d.gross_amount
    FROM business_document d
    JOIN journal_entry origin
      ON origin.tenant_id=d.tenant_id AND origin.entity_id=d.entity_id
     AND origin.journal_entry_id=d.posted_journal_entry_id AND origin.status='POSTED'
    JOIN accounting_period origin_period
      ON origin_period.tenant_id=origin.tenant_id AND origin_period.entity_id=origin.entity_id
     AND origin_period.period_id=origin.period_id
    CROSS JOIN target t
    WHERE d.tenant_id=p_tenant AND d.entity_id=p_entity
      AND d.document_kind=v_document_kind AND origin_period.ends_on<=t.ends_on
  ), document_rows AS MATERIALIZED (
    SELECT d.business_document_id,d.source_document_id,d.posted_journal_entry_id,d.currency,
      (d.gross_amount
       - COALESCE((SELECT sum(a.amount) FROM business_allocation a
          JOIN journal_entry j ON j.tenant_id=a.tenant_id AND j.entity_id=a.entity_id AND j.journal_entry_id=a.posted_journal_entry_id AND j.status='POSTED'
          JOIN accounting_period ap ON ap.tenant_id=j.tenant_id AND ap.entity_id=j.entity_id AND ap.period_id=j.period_id
          CROSS JOIN target t
          WHERE a.tenant_id=p_tenant AND a.entity_id=p_entity AND a.business_document_id=d.business_document_id
            AND ap.ends_on<=t.ends_on AND a.created_at<((t.ends_on+1)::timestamp AT TIME ZONE 'UTC')),0)
       - COALESCE((SELECT sum(a.amount) FROM business_adjustment a
          JOIN journal_entry j ON j.tenant_id=a.tenant_id AND j.entity_id=a.entity_id AND j.journal_entry_id=a.posted_journal_entry_id AND j.status='POSTED'
          JOIN accounting_period ap ON ap.tenant_id=j.tenant_id AND ap.entity_id=j.entity_id AND ap.period_id=j.period_id
          CROSS JOIN target t
          WHERE module_code='AP' AND a.tenant_id=p_tenant AND a.entity_id=p_entity
            AND a.business_document_id=d.business_document_id AND a.adjustment_kind='AP_BILL_VOID' AND a.status='POSTED' AND ap.ends_on<=t.ends_on),0)
       + COALESCE((SELECT sum(a.amount) FROM business_adjustment a
          JOIN payment_occurrence o ON o.tenant_id=a.tenant_id AND o.entity_id=a.entity_id AND o.payment_occurrence_id=a.source_occurrence_id
          JOIN journal_entry j ON j.tenant_id=a.tenant_id AND j.entity_id=a.entity_id AND j.journal_entry_id=a.posted_journal_entry_id AND j.status='POSTED'
          JOIN accounting_period ap ON ap.tenant_id=j.tenant_id AND ap.entity_id=j.entity_id AND ap.period_id=j.period_id
          CROSS JOIN target t
          WHERE a.tenant_id=p_tenant AND a.entity_id=p_entity AND o.business_document_id=d.business_document_id
            AND a.adjustment_kind=CASE WHEN module_code='AP' THEN 'AP_PAYMENT_REVERSAL' ELSE 'AR_RECEIPT_REVERSAL' END
            AND a.status='POSTED' AND ap.ends_on<=t.ends_on),0))::numeric(20,4) AS open_amount
    FROM eligible_documents d
  ), ledger_rows AS MATERIALIZED (
    SELECT ll.currency,ll.journal_entry_id,ll.journal_line_id,ll.ledger_line_id,
      (CASE WHEN module_code='AP' THEN ll.credit_amount-ll.debit_amount ELSE ll.debit_amount-ll.credit_amount END)::numeric(20,4) AS control_amount,
      ARRAY(SELECT DISTINCT sl.source_document_id FROM source_link sl
        WHERE sl.tenant_id=p_tenant AND sl.entity_id=p_entity AND sl.journal_entry_id=ll.journal_entry_id
          AND sl.source_document_id IS NOT NULL ORDER BY sl.source_document_id)::uuid[] AS linked_source_document_ids
    FROM ledger_line ll
    JOIN journal_entry j
      ON j.tenant_id=ll.tenant_id AND j.entity_id=ll.entity_id
     AND j.journal_entry_id=ll.journal_entry_id AND j.status='POSTED'
    JOIN accounting_period lp
      ON lp.tenant_id=ll.tenant_id AND lp.entity_id=ll.entity_id AND lp.period_id=ll.period_id
    CROSS JOIN target t
    WHERE ll.tenant_id=p_tenant AND ll.entity_id=p_entity
      AND ll.account_code=v_control_account AND lp.ends_on<=t.ends_on
  ), currencies AS MATERIALIZED (
    SELECT d.currency FROM document_rows d UNION SELECT l.currency FROM ledger_rows l
  )
  SELECT p_period,v_control_account,c.currency,
    COALESCE((SELECT sum(d.open_amount) FROM document_rows d WHERE d.currency=c.currency),0)::numeric(20,4),
    COALESCE((SELECT sum(l.control_amount) FROM ledger_rows l WHERE l.currency=c.currency),0)::numeric(20,4),
    COALESCE((SELECT sum(d.open_amount) FROM document_rows d WHERE d.currency=c.currency),0)
      =COALESCE((SELECT sum(l.control_amount) FROM ledger_rows l WHERE l.currency=c.currency),0),
    ARRAY(SELECT d.business_document_id FROM document_rows d WHERE d.currency=c.currency ORDER BY d.business_document_id)::uuid[],
    ARRAY(SELECT DISTINCT d.source_document_id FROM document_rows d WHERE d.currency=c.currency AND d.source_document_id IS NOT NULL ORDER BY d.source_document_id)::uuid[],
    ARRAY(SELECT DISTINCT l.journal_entry_id FROM ledger_rows l WHERE l.currency=c.currency ORDER BY l.journal_entry_id)::uuid[],
    ARRAY(SELECT DISTINCT l.journal_line_id FROM ledger_rows l WHERE l.currency=c.currency ORDER BY l.journal_line_id)::uuid[],
    ARRAY(SELECT DISTINCT l.ledger_line_id FROM ledger_rows l WHERE l.currency=c.currency ORDER BY l.ledger_line_id)::uuid[],
    ARRAY(SELECT s.source_document_id FROM (
      SELECT d.source_document_id FROM document_rows d WHERE d.currency=c.currency AND d.source_document_id IS NOT NULL
      UNION
      SELECT unnest(l.linked_source_document_ids) FROM ledger_rows l WHERE l.currency=c.currency
    ) s ORDER BY s.source_document_id)::uuid[],
    COALESCE((SELECT jsonb_agg(jsonb_build_object(
      'business_document_id',d.business_document_id,
      'source_document_id',d.source_document_id,
      'posted_journal_entry_id',d.posted_journal_entry_id,
      'open_balance',to_char(d.open_amount,'FM9999999999999990.0000')
    ) ORDER BY d.business_document_id) FROM document_rows d WHERE d.currency=c.currency),'[]'::jsonb),
    COALESCE((SELECT jsonb_agg(jsonb_build_object(
      'journal_entry_id',l.journal_entry_id,
      'journal_line_id',l.journal_line_id,
      'ledger_line_id',l.ledger_line_id,
      'source_document_ids',to_jsonb(l.linked_source_document_ids),
      'control_amount',to_char(l.control_amount,'FM9999999999999990.0000')
    ) ORDER BY l.ledger_line_id) FROM ledger_rows l WHERE l.currency=c.currency),'[]'::jsonb)
  FROM currencies c ORDER BY c.currency;
END;
$$;

CREATE FUNCTION refs_ap_control_total(p_tenant uuid,p_entity uuid,p_period uuid)
RETURNS TABLE(
  period_id uuid,account_code text,currency char(3),open_balance numeric(20,4),control_balance numeric(20,4),in_balance boolean,
  business_document_ids uuid[],document_source_document_ids uuid[],journal_entry_ids uuid[],journal_line_ids uuid[],ledger_line_ids uuid[],source_document_ids uuid[],document_contributors jsonb,ledger_contributors jsonb
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
  SELECT * FROM public.refs_ap_ar_period_control_lineage(p_tenant,p_entity,p_period,'AP')
$$;

CREATE FUNCTION refs_ar_control_total(p_tenant uuid,p_entity uuid,p_period uuid)
RETURNS TABLE(
  period_id uuid,account_code text,currency char(3),open_balance numeric(20,4),control_balance numeric(20,4),in_balance boolean,
  business_document_ids uuid[],document_source_document_ids uuid[],journal_entry_ids uuid[],journal_line_ids uuid[],ledger_line_ids uuid[],source_document_ids uuid[],document_contributors jsonb,ledger_contributors jsonb
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
  SELECT * FROM public.refs_ap_ar_period_control_lineage(p_tenant,p_entity,p_period,'AR')
$$;

REVOKE ALL ON FUNCTION refs_ap_ar_period_control_lineage(uuid,uuid,uuid,text) FROM PUBLIC;
REVOKE ALL ON FUNCTION refs_ap_control_total(uuid,uuid,uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION refs_ar_control_total(uuid,uuid,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION refs_ap_control_total(uuid,uuid,uuid) TO refs_app;
GRANT EXECUTE ON FUNCTION refs_ar_control_total(uuid,uuid,uuid) TO refs_app;

COMMENT ON FUNCTION refs_ap_control_total(uuid,uuid,uuid) IS 'Period-scoped AP subsidiary/control reconciliation with separate exact document and posted-ledger contributors; no amount or source association is inferred.';
COMMENT ON FUNCTION refs_ar_control_total(uuid,uuid,uuid) IS 'Period-scoped AR subsidiary/control reconciliation with separate exact document and posted-ledger contributors; no amount or source association is inferred.';

COMMIT;
