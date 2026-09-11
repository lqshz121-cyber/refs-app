BEGIN;

CREATE OR REPLACE FUNCTION refs_read_bill_payment_register(
  p_tenant uuid,p_entity uuid,p_period uuid,p_after uuid DEFAULT NULL,p_limit integer DEFAULT 50
) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE cursor_time timestamptz;period_code_value text;result_rows jsonb;next_id uuid;
BEGIN
  PERFORM refs_assert_scope(p_tenant,p_entity,'AP.VIEW');
  IF p_period IS NULL OR p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 100 THEN
    RAISE EXCEPTION 'Invalid Bill Payment register selection' USING ERRCODE='22023';
  END IF;
  SELECT period_code INTO period_code_value FROM accounting_period
    WHERE tenant_id=p_tenant AND entity_id=p_entity AND period_id=p_period;
  IF NOT FOUND THEN RAISE EXCEPTION 'Bill Payment period is outside this company' USING ERRCODE='22023'; END IF;
  IF p_after IS NOT NULL THEN
    SELECT created_at INTO cursor_time FROM payment_occurrence
      WHERE tenant_id=p_tenant AND entity_id=p_entity AND period_id=p_period
        AND occurrence_kind='AP_PAYMENT' AND payment_occurrence_id=p_after;
    IF NOT FOUND THEN RAISE EXCEPTION 'Bill Payment cursor is outside this company and period' USING ERRCODE='22023'; END IF;
  END IF;

  WITH candidates AS MATERIALIZED (
    SELECT po.* FROM payment_occurrence po
    WHERE po.tenant_id=p_tenant AND po.entity_id=p_entity AND po.period_id=p_period
      AND po.occurrence_kind='AP_PAYMENT'
      AND (p_after IS NULL OR (po.created_at,po.payment_occurrence_id)<(cursor_time,p_after))
    ORDER BY po.created_at DESC,po.payment_occurrence_id DESC LIMIT p_limit+1
  ), page AS MATERIALIZED (
    SELECT * FROM candidates ORDER BY created_at DESC,payment_occurrence_id DESC LIMIT p_limit
  ), facts AS (
    SELECT po.created_at,po.payment_occurrence_id,jsonb_build_object(
      'payment_occurrence_id',po.payment_occurrence_id,'payment_revision',po.version::text,
      'business_document_id',bill.business_document_id,'bill_number',bill.document_number,
      'vendor_ref',bill.counterparty_ref,'vendor_name',bill.counterparty_name,
      'bill_status',bill.status,'bill_revision',bill.version::text,
      'amount',po.amount::text,'currency',po.currency,'accounting_date',po.accounting_date,
      'payment_status',po.status,
      'created_at',to_char(po.created_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
      'source_document_id',po.source_document_id,
      'journal_entry_id',journal.journal_entry_id,'journal_number',journal.journal_number,
      'journal_status',journal.status,'journal_revision',journal.revision::text,
      'journal_line_id',match.journal_line_id,'ledger_line_id',match.ledger_line_id,
      'bank_match_id',match.bank_match_id,'bank_match_status',match.status,'bank_match_revision',match.version::text,
      'draft_audit_event_id',draft_event.audit_event_id,'posted_audit_event_id',posted_event.audit_event_id
    ) row_value
    FROM page po
    JOIN business_document bill ON bill.tenant_id=po.tenant_id AND bill.entity_id=po.entity_id
      AND bill.business_document_id=po.business_document_id AND bill.document_kind='AP_BILL'
    LEFT JOIN journal_entry journal ON journal.tenant_id=po.tenant_id AND journal.entity_id=po.entity_id
      AND journal.period_id=po.period_id AND journal.journal_entry_id=coalesce(po.posted_journal_entry_id,po.draft_journal_entry_id)
    LEFT JOIN LATERAL (
      SELECT m.bank_match_id,m.journal_line_id,m.ledger_line_id,m.status,m.version
      FROM bank_match m WHERE m.tenant_id=po.tenant_id AND m.entity_id=po.entity_id
        AND m.payment_occurrence_id=po.payment_occurrence_id AND m.status='ACTIVE'
    ) match ON true
    LEFT JOIN LATERAL (
      SELECT a.audit_event_id FROM audit_event a
      WHERE a.tenant_id=po.tenant_id AND a.entity_id=po.entity_id AND a.object_type='PAYMENT_OCCURRENCE'
        AND a.object_id=po.payment_occurrence_id AND a.event_type='AP_PAYMENT_DRAFT_CREATED'
      ORDER BY a.occurred_at,a.audit_event_id LIMIT 1
    ) draft_event ON true
    LEFT JOIN LATERAL (
      SELECT a.audit_event_id FROM audit_event a
      WHERE a.tenant_id=po.tenant_id AND a.entity_id=po.entity_id AND a.object_type='PAYMENT_OCCURRENCE'
        AND a.object_id=po.payment_occurrence_id AND a.event_type='AP_PAYMENT_POSTED'
      ORDER BY a.occurred_at,a.audit_event_id LIMIT 1
    ) posted_event ON true
  )
  SELECT coalesce((SELECT jsonb_agg(row_value ORDER BY created_at DESC,payment_occurrence_id DESC) FROM facts),'[]'::jsonb),
    CASE WHEN (SELECT count(*) FROM candidates)>p_limit THEN
      (SELECT payment_occurrence_id FROM page ORDER BY created_at,payment_occurrence_id LIMIT 1) END
    INTO result_rows,next_id;
  RETURN jsonb_build_object(
    'schema_version','BILL_PAYMENT_REGISTER_V1','entity_id',p_entity,'period_id',p_period,
    'period_code',period_code_value,'after_id',p_after,'limit',p_limit,'rows',result_rows,'next_id',next_id,
    'action_flags',jsonb_build_object('can_initiate_payment',false,'can_approve',false,'can_void',false,'can_release',false)
  );
END;
$$;
REVOKE ALL ON FUNCTION refs_read_bill_payment_register(uuid,uuid,uuid,uuid,integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION refs_read_bill_payment_register(uuid,uuid,uuid,uuid,integer) TO refs_app;

COMMIT;
