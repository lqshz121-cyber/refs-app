BEGIN;

-- A formal AP payment remains entity-scoped by the core foreign keys.  This
-- reader identifies the narrower wrong-entity case where the exact signed
-- invoice identity paid in one entity is retained as a payable of another
-- authorized entity.  It is evidence-only and grants no accounting action.
CREATE FUNCTION refs_read_ai_cross_entity_payment_invoices(
  p_tenant uuid,
  p_entity uuid,
  p_period uuid,
  p_counterparty_entity uuid,
  p_counterparty_period uuid,
  p_limit integer DEFAULT 501
)
RETURNS TABLE(
  entity_id uuid,
  accounting_period_id uuid,
  counterparty_entity_id uuid,
  counterparty_period_id uuid,
  payment_occurrence_id uuid,
  business_allocation_id uuid,
  business_document_id uuid,
  payment_journal_entry_id uuid,
  payment_ledger_line_ids uuid[],
  payment_evidence_hash text,
  payment_amount numeric(20,4),
  allocated_amount numeric(20,4),
  currency char(3),
  payment_date date,
  signed_business_id text,
  invoice_number text,
  invoice_date date,
  invoice_amount numeric(20,4),
  current_source_document_id uuid,
  current_source_document_line_id uuid,
  current_source_payload_hash text,
  current_source_line_hash text,
  counterparty_source_document_id uuid,
  counterparty_source_document_line_id uuid,
  counterparty_source_payload_hash text,
  counterparty_source_line_hash text,
  current_invoice_identity_count integer,
  counterparty_invoice_identity_count integer
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE current_period accounting_period; counterparty_period accounting_period;
BEGIN
  IF p_entity=p_counterparty_entity THEN RAISE EXCEPTION 'Cross-entity payment review requires two distinct entities' USING ERRCODE='22023';END IF;
  IF p_limit IS NULL OR p_limit<1 OR p_limit>501 THEN RAISE EXCEPTION 'Cross-entity payment review limit must be between 1 and 501' USING ERRCODE='22023';END IF;
  PERFORM refs_assert_ai_analysis_scope(p_tenant,p_entity);
  PERFORM refs_assert_ai_analysis_scope(p_tenant,p_counterparty_entity);
  SELECT ap.* INTO current_period FROM accounting_period ap WHERE ap.tenant_id=p_tenant AND ap.entity_id=p_entity AND ap.period_id=p_period AND ap.ledger_code='PRIMARY';
  SELECT ap.* INTO counterparty_period FROM accounting_period ap WHERE ap.tenant_id=p_tenant AND ap.entity_id=p_counterparty_entity AND ap.period_id=p_counterparty_period AND ap.ledger_code='PRIMARY';
  IF current_period.period_id IS NULL OR counterparty_period.period_id IS NULL OR current_period.starts_on<>counterparty_period.starts_on OR current_period.ends_on<>counterparty_period.ends_on THEN
    RAISE EXCEPTION 'Cross-entity payment review requires aligned primary accounting periods' USING ERRCODE='22023';
  END IF;

  RETURN QUERY
  WITH current_sources AS (
    SELECT d.business_document_id,d.source_document_id,l.source_document_line_id,d.currency,d.gross_amount,
      NULLIF(btrim(l.external_dimension_refs->>'signed_business_id'),'') signed_business_id,
      NULLIF(btrim(l.external_dimension_refs->>'signed_invoice_no'),'') invoice_number,
      (l.external_dimension_refs->>'signed_invoice_date')::date invoice_date,
      sd.payload_hash source_payload_hash,r.raw_row_hash source_line_hash
    FROM business_document d
    JOIN source_document sd ON sd.tenant_id=d.tenant_id AND sd.entity_id=d.entity_id AND sd.source_document_id=d.source_document_id AND sd.source_system='WBS' AND sd.source_module='payable' AND sd.document_type='WBS_FINAL1_PAYABLE'
    JOIN source_document_line l ON l.tenant_id=sd.tenant_id AND l.entity_id=sd.entity_id AND l.source_document_id=sd.source_document_id
    JOIN wbs_final1_retained_source_row r ON r.tenant_id=l.tenant_id AND r.entity_id=l.entity_id AND r.source_document_id=l.source_document_id AND r.source_document_line_id=l.source_document_line_id AND r.domain='PAYABLES' AND r.raw_row_hash=sd.payload_hash
    JOIN raw_event re ON re.tenant_id=r.tenant_id AND re.entity_id=r.entity_id AND re.raw_event_id=r.raw_event_id AND re.source_record_id=r.source_record_id AND re.source_version=r.source_version AND re.is_current
    JOIN wbs_final1_retained_evidence_admission a ON a.tenant_id=r.tenant_id AND a.entity_id=r.entity_id AND a.wbs_final1_retained_evidence_admission_id=r.wbs_final1_retained_evidence_admission_id AND a.domain='PAYABLES' AND a.algorithm='Ed25519'
    WHERE d.tenant_id=p_tenant AND d.entity_id=p_entity AND d.document_kind='AP_BILL' AND d.status IN ('PARTIALLY_PAID','PAID')
      AND l.external_dimension_refs->>'schema_version'='WBS_FINAL1_RETAINED_SOURCE_LINE_V1' AND l.external_dimension_refs->>'domain'='PAYABLES'
      AND l.external_dimension_refs->>'snapshot_id'=a.snapshot_id::text AND l.external_dimension_refs->>'package_hash'=a.package_hash
      AND l.external_dimension_refs->>'raw_row_hash'=r.raw_row_hash AND l.external_dimension_refs->>'accounting_period_id'=r.accounting_period_id::text
      AND l.external_dimension_refs->>'accounting_period_resolution'='EXACT_PRIMARY_PERIOD'
      AND l.external_dimension_refs ?& ARRAY['source_surface','signed_invoice_no','signed_invoice_date','signed_business_id']
      AND l.external_dimension_refs->'source_surface'=jsonb_build_object('database','wbsdata','table','account_book_payable_info')
      AND NULLIF(btrim(l.external_dimension_refs->>'signed_business_id'),'') IS NOT NULL
      AND NULLIF(btrim(l.external_dimension_refs->>'signed_invoice_no'),'') IS NOT NULL
      AND l.external_dimension_refs->>'signed_invoice_date'=sd.business_date::text
      AND d.document_number=l.external_dimension_refs->>'signed_invoice_no' AND d.accounting_date=sd.accounting_date
      AND d.currency=sd.currency AND d.gross_amount=abs(l.amount)
  ), current_counts AS (
    SELECT cs.signed_business_id,cs.invoice_number,cs.invoice_date,cs.currency,cs.gross_amount,count(DISTINCT cs.source_document_id)::integer identity_count
    FROM current_sources cs GROUP BY cs.signed_business_id,cs.invoice_number,cs.invoice_date,cs.currency,cs.gross_amount
  ), counterparty_sources AS (
    SELECT r.accounting_period_id,sd.source_document_id,l.source_document_line_id,sd.currency,abs(l.amount)::numeric(20,4) invoice_amount,
      NULLIF(btrim(l.external_dimension_refs->>'signed_business_id'),'') signed_business_id,
      NULLIF(btrim(l.external_dimension_refs->>'signed_invoice_no'),'') invoice_number,
      (l.external_dimension_refs->>'signed_invoice_date')::date invoice_date,sd.payload_hash source_payload_hash,r.raw_row_hash source_line_hash
    FROM wbs_final1_retained_source_row r
    JOIN raw_event re ON re.tenant_id=r.tenant_id AND re.entity_id=r.entity_id AND re.raw_event_id=r.raw_event_id AND re.source_record_id=r.source_record_id AND re.source_version=r.source_version AND re.is_current
    JOIN wbs_final1_retained_evidence_admission a ON a.tenant_id=r.tenant_id AND a.entity_id=r.entity_id AND a.wbs_final1_retained_evidence_admission_id=r.wbs_final1_retained_evidence_admission_id AND a.domain='PAYABLES' AND a.algorithm='Ed25519'
    JOIN source_document sd ON sd.tenant_id=r.tenant_id AND sd.entity_id=r.entity_id AND sd.source_document_id=r.source_document_id AND sd.raw_event_id=re.raw_event_id AND sd.source_record_id=r.source_record_id AND sd.source_version=r.source_version AND sd.source_system='WBS' AND sd.source_module='payable' AND sd.document_type='WBS_FINAL1_PAYABLE' AND sd.payload_hash=r.raw_row_hash
    JOIN source_document_line l ON l.tenant_id=r.tenant_id AND l.entity_id=r.entity_id AND l.source_document_id=r.source_document_id AND l.source_document_line_id=r.source_document_line_id
    JOIN accounting_period ap ON ap.tenant_id=r.tenant_id AND ap.entity_id=r.entity_id AND ap.period_id=r.accounting_period_id AND ap.ledger_code='PRIMARY'
    WHERE r.tenant_id=p_tenant AND r.entity_id=p_counterparty_entity AND r.domain='PAYABLES' AND ap.ends_on<=counterparty_period.ends_on
      AND l.external_dimension_refs->>'schema_version'='WBS_FINAL1_RETAINED_SOURCE_LINE_V1' AND l.external_dimension_refs->>'domain'='PAYABLES'
      AND l.external_dimension_refs->>'snapshot_id'=a.snapshot_id::text AND l.external_dimension_refs->>'package_hash'=a.package_hash
      AND l.external_dimension_refs->>'raw_row_hash'=r.raw_row_hash AND l.external_dimension_refs->>'accounting_period_id'=r.accounting_period_id::text
      AND l.external_dimension_refs->>'accounting_period_resolution'='EXACT_PRIMARY_PERIOD'
      AND l.external_dimension_refs ?& ARRAY['source_surface','signed_invoice_no','signed_invoice_date','signed_business_id']
      AND l.external_dimension_refs->'source_surface'=jsonb_build_object('database','wbsdata','table','account_book_payable_info')
      AND NULLIF(btrim(l.external_dimension_refs->>'signed_business_id'),'') IS NOT NULL
      AND NULLIF(btrim(l.external_dimension_refs->>'signed_invoice_no'),'') IS NOT NULL
      AND l.external_dimension_refs->>'signed_invoice_date'=sd.business_date::text AND sd.document_no=l.external_dimension_refs->>'signed_invoice_no'
  ), counterparty_counts AS (
    SELECT cs.signed_business_id,cs.invoice_number,cs.invoice_date,cs.currency,cs.invoice_amount,count(DISTINCT cs.source_document_id)::integer identity_count
    FROM counterparty_sources cs GROUP BY cs.signed_business_id,cs.invoice_number,cs.invoice_date,cs.currency,cs.invoice_amount
  ), payments AS (
    SELECT po,ba,cs,cc.identity_count current_identity_count,je.journal_entry_id,
      ledger.ledger_line_ids,ledger.ledger_hash
    FROM payment_occurrence po
    JOIN business_allocation ba ON ba.tenant_id=po.tenant_id AND ba.entity_id=po.entity_id AND ba.payment_occurrence_id=po.payment_occurrence_id AND ba.business_document_id=po.business_document_id AND ba.status='ACTIVE' AND ba.posted_journal_entry_id=po.posted_journal_entry_id AND ba.currency=po.currency
    JOIN current_sources cs ON cs.business_document_id=po.business_document_id AND cs.currency=po.currency
    JOIN current_counts cc ON cc.signed_business_id=cs.signed_business_id AND cc.invoice_number=cs.invoice_number AND cc.invoice_date=cs.invoice_date AND cc.currency=cs.currency AND cc.gross_amount=cs.gross_amount
    JOIN journal_entry je ON je.tenant_id=po.tenant_id AND je.entity_id=po.entity_id AND je.journal_entry_id=po.posted_journal_entry_id AND je.status='POSTED' AND je.period_id=po.period_id AND je.currency=po.currency
    JOIN LATERAL (
      SELECT array_agg(ll.ledger_line_id ORDER BY ll.ledger_line_id) ledger_line_ids,
        refs_jsonb_hash(jsonb_agg(jsonb_build_object('ledger_line_id',ll.ledger_line_id,'journal_line_id',ll.journal_line_id,'account_code',ll.account_code,'debit_amount',to_char(ll.debit_amount,'FM999999999999999990.0000'),'credit_amount',to_char(ll.credit_amount,'FM999999999999999990.0000'),'currency',ll.currency) ORDER BY ll.ledger_line_id)) ledger_hash,
        count(*) line_count,sum(ll.debit_amount) debit_amount,sum(ll.credit_amount) credit_amount,bool_and(ll.currency=po.currency) currency_match
      FROM ledger_line ll WHERE ll.tenant_id=po.tenant_id AND ll.entity_id=po.entity_id AND ll.journal_entry_id=po.posted_journal_entry_id
        AND EXISTS(SELECT 1 FROM source_link sl WHERE sl.tenant_id=ll.tenant_id AND sl.entity_id=ll.entity_id AND sl.link_type='JE_LINE_TO_LEDGER' AND sl.journal_entry_id=ll.journal_entry_id AND sl.journal_line_id=ll.journal_line_id AND sl.posting_batch_id=ll.posting_batch_id AND sl.ledger_line_id=ll.ledger_line_id)
    ) ledger ON ledger.line_count=2 AND ledger.debit_amount=po.amount AND ledger.credit_amount=po.amount AND ledger.currency_match
    WHERE po.tenant_id=p_tenant AND po.entity_id=p_entity AND po.period_id=p_period AND po.occurrence_kind='AP_PAYMENT' AND po.status='POSTED'
      AND po.accounting_date BETWEEN current_period.starts_on AND current_period.ends_on AND po.amount=ba.amount
  )
  SELECT p_entity,p_period,p_counterparty_entity,p_counterparty_period,
    (p.po).payment_occurrence_id,(p.ba).business_allocation_id,(p.po).business_document_id,p.journal_entry_id,p.ledger_line_ids,
    refs_jsonb_hash(jsonb_build_object('schema_version','AI_CROSS_ENTITY_PAYMENT_EVIDENCE_V1','payment_occurrence_id',(p.po).payment_occurrence_id,'business_allocation_id',(p.ba).business_allocation_id,'business_document_id',(p.po).business_document_id,'journal_entry_id',p.journal_entry_id,'ledger_hash',p.ledger_hash,'request_hash',(p.po).request_hash)),
    (p.po).amount,(p.ba).amount,(p.po).currency,(p.po).accounting_date,p.cs.signed_business_id,p.cs.invoice_number,p.cs.invoice_date,p.cs.gross_amount,
    p.cs.source_document_id,p.cs.source_document_line_id,p.cs.source_payload_hash,p.cs.source_line_hash,
    c.source_document_id,c.source_document_line_id,c.source_payload_hash,c.source_line_hash,p.current_identity_count,counts.identity_count
  FROM payments p
  JOIN counterparty_sources c ON c.signed_business_id=p.cs.signed_business_id AND c.invoice_number=p.cs.invoice_number AND c.invoice_date=p.cs.invoice_date AND c.currency=p.cs.currency AND c.invoice_amount=p.cs.gross_amount
  JOIN counterparty_counts counts ON counts.signed_business_id=c.signed_business_id AND counts.invoice_number=c.invoice_number AND counts.invoice_date=c.invoice_date AND counts.currency=c.currency AND counts.invoice_amount=c.invoice_amount
  ORDER BY (p.po).accounting_date,(p.po).payment_occurrence_id,c.source_document_id,c.source_document_line_id LIMIT p_limit;
END;$$;

REVOKE ALL ON FUNCTION refs_read_ai_cross_entity_payment_invoices(uuid,uuid,uuid,uuid,uuid,integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION refs_read_ai_cross_entity_payment_invoices(uuid,uuid,uuid,uuid,uuid,integer) TO refs_app;

COMMIT;
