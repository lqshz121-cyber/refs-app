BEGIN;

CREATE INDEX payment_occurrence_document_history_idx ON payment_occurrence
  (tenant_id,entity_id,business_document_id,occurrence_kind,created_at DESC,payment_occurrence_id DESC);

CREATE FUNCTION refs_read_document_settlements(p_tenant uuid,p_entity uuid,p_document uuid,p_kind text,p_after uuid DEFAULT NULL,p_limit integer DEFAULT 50)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE cursor_time timestamptz;result_rows jsonb;next_id uuid;
BEGIN
  PERFORM refs_assert_scope(p_tenant,p_entity,'READ');
  IF p_kind IS NULL OR p_kind NOT IN ('AP_PAYMENT','AR_RECEIPT') OR p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 100 THEN
    RAISE EXCEPTION 'Invalid settlement history selection' USING ERRCODE='22023';
  END IF;
  IF NOT EXISTS(SELECT 1 FROM business_document WHERE tenant_id=p_tenant AND entity_id=p_entity
      AND business_document_id=p_document AND document_kind=(CASE p_kind WHEN 'AP_PAYMENT' THEN 'AP_BILL' ELSE 'AR_INVOICE' END)) THEN
    RAISE EXCEPTION 'Source document is not available in this company' USING ERRCODE='P0002';
  END IF;
  IF p_after IS NOT NULL THEN
    SELECT created_at INTO cursor_time FROM payment_occurrence WHERE tenant_id=p_tenant AND entity_id=p_entity
      AND business_document_id=p_document AND occurrence_kind=p_kind AND payment_occurrence_id=p_after;
    IF NOT FOUND THEN RAISE EXCEPTION 'Settlement cursor does not belong to this document' USING ERRCODE='22023'; END IF;
  END IF;
  WITH candidates AS MATERIALIZED (
    SELECT p.* FROM payment_occurrence p WHERE p.tenant_id=p_tenant AND p.entity_id=p_entity
      AND p.business_document_id=p_document AND p.occurrence_kind=p_kind
      AND (p_after IS NULL OR (p.created_at,p.payment_occurrence_id)<(cursor_time,p_after))
    ORDER BY p.created_at DESC,p.payment_occurrence_id DESC LIMIT p_limit+1
  ), page AS MATERIALIZED (
    SELECT * FROM candidates ORDER BY created_at DESC,payment_occurrence_id DESC LIMIT p_limit
  ), facts AS (
    SELECT p.created_at,p.payment_occurrence_id,jsonb_build_object(
      'payment_occurrence_id',p.payment_occurrence_id,'business_document_id',p.business_document_id,
      'settlement_kind',p.occurrence_kind,'amount',p.amount::text,'currency',p.currency,
      'accounting_date',p.accounting_date,'period_id',p.period_id,'period_code',period.period_code,
      'status',p.status,'revision',p.version::text,
      'created_at',to_char(p.created_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
      'draft_journal_entry_id',p.draft_journal_entry_id,'posted_journal_entry_id',p.posted_journal_entry_id,
      'journal_number',j.journal_number,'journal_status',j.status,'journal_revision',j.revision::text
    ) row_value FROM page p
    JOIN accounting_period period ON period.tenant_id=p.tenant_id AND period.entity_id=p.entity_id AND period.period_id=p.period_id
    LEFT JOIN journal_entry j ON j.tenant_id=p.tenant_id AND j.entity_id=p.entity_id
      AND j.journal_entry_id=COALESCE(p.posted_journal_entry_id,p.draft_journal_entry_id)
  )
  SELECT COALESCE((SELECT jsonb_agg(row_value ORDER BY created_at DESC,payment_occurrence_id DESC) FROM facts),'[]'::jsonb),
    CASE WHEN (SELECT count(*) FROM candidates)>p_limit THEN (SELECT payment_occurrence_id FROM page ORDER BY created_at,payment_occurrence_id LIMIT 1) END
    INTO result_rows,next_id;
  RETURN jsonb_build_object('schema_version','DOCUMENT_SETTLEMENT_HISTORY_V1','entity_id',p_entity,
    'business_document_id',p_document,'settlement_kind',p_kind,'after_id',p_after,'limit',p_limit,'rows',result_rows,'next_id',next_id);
END;
$$;
REVOKE ALL ON FUNCTION refs_read_document_settlements(uuid,uuid,uuid,text,uuid,integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION refs_read_document_settlements(uuid,uuid,uuid,text,uuid,integer) TO refs_app;
COMMIT;
