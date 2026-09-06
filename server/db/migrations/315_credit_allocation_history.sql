BEGIN;
CREATE INDEX credit_allocation_credit_history_idx ON business_allocation
  (tenant_id,entity_id,business_adjustment_id,created_at DESC,business_allocation_id DESC)
  WHERE business_adjustment_id IS NOT NULL;
CREATE INDEX credit_allocation_document_history_idx ON business_allocation
  (tenant_id,entity_id,business_document_id,created_at DESC,business_allocation_id DESC)
  WHERE business_adjustment_id IS NOT NULL;

CREATE FUNCTION refs_read_credit_allocation_history(p_tenant uuid,p_entity uuid,p_subject uuid,p_kind text,p_after uuid DEFAULT NULL,p_limit integer DEFAULT 50)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE is_credit boolean;credit_kind text;cursor_time timestamptz;result_rows jsonb;next_id uuid;
BEGIN
  IF p_kind IS NULL OR p_kind NOT IN ('AP_VENDOR_CREDIT','AR_CREDIT_MEMO','AP_BILL','AR_INVOICE')
    OR p_subject IS NULL OR p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 100 THEN
    RAISE EXCEPTION 'Invalid credit allocation history selection' USING ERRCODE='22023';
  END IF;
  PERFORM refs_assert_scope(p_tenant,p_entity,CASE WHEN p_kind IN ('AP_VENDOR_CREDIT','AP_BILL') THEN 'AP.VIEW' ELSE 'AR.VIEW' END);
  is_credit:=p_kind IN ('AP_VENDOR_CREDIT','AR_CREDIT_MEMO');
  credit_kind:=CASE WHEN p_kind IN ('AP_VENDOR_CREDIT','AP_BILL') THEN 'AP_VENDOR_CREDIT' ELSE 'AR_CREDIT_MEMO' END;
  IF is_credit THEN
    IF NOT EXISTS(SELECT 1 FROM business_adjustment WHERE tenant_id=p_tenant AND entity_id=p_entity AND business_adjustment_id=p_subject AND adjustment_kind=p_kind) THEN
      RAISE EXCEPTION 'Credit is not available in this company' USING ERRCODE='P0002';
    END IF;
  ELSE
    IF NOT EXISTS(SELECT 1 FROM business_document WHERE tenant_id=p_tenant AND entity_id=p_entity AND business_document_id=p_subject AND document_kind=p_kind) THEN
      RAISE EXCEPTION 'Document is not available in this company' USING ERRCODE='P0002';
    END IF;
  END IF;
  IF p_after IS NOT NULL THEN
    SELECT a.created_at INTO cursor_time FROM business_allocation a
    JOIN business_adjustment c ON c.tenant_id=a.tenant_id AND c.entity_id=a.entity_id AND c.business_adjustment_id=a.business_adjustment_id
    WHERE a.tenant_id=p_tenant AND a.entity_id=p_entity AND a.business_allocation_id=p_after AND c.adjustment_kind=credit_kind
      AND CASE WHEN is_credit THEN a.business_adjustment_id=p_subject ELSE a.business_document_id=p_subject END;
    IF NOT FOUND THEN RAISE EXCEPTION 'Allocation cursor does not belong to this subject' USING ERRCODE='22023'; END IF;
  END IF;
  WITH candidates AS MATERIALIZED (
    SELECT a.* FROM business_allocation a
    WHERE a.tenant_id=p_tenant AND a.entity_id=p_entity AND a.business_adjustment_id IS NOT NULL
      AND CASE WHEN is_credit THEN a.business_adjustment_id=p_subject ELSE a.business_document_id=p_subject END
      AND EXISTS(SELECT 1 FROM business_adjustment c WHERE c.tenant_id=a.tenant_id AND c.entity_id=a.entity_id AND c.business_adjustment_id=a.business_adjustment_id AND c.adjustment_kind=credit_kind)
      AND (p_after IS NULL OR (a.created_at,a.business_allocation_id)<(cursor_time,p_after))
    ORDER BY a.created_at DESC,a.business_allocation_id DESC LIMIT p_limit+1
  ), page AS MATERIALIZED (
    SELECT * FROM candidates ORDER BY created_at DESC,business_allocation_id DESC LIMIT p_limit
  ), facts AS (
    SELECT a.created_at,a.business_allocation_id,jsonb_build_object(
      'business_allocation_id',a.business_allocation_id,'business_adjustment_id',a.business_adjustment_id,
      'adjustment_kind',c.adjustment_kind,'credit_number',cj.journal_number,
      'business_document_id',a.business_document_id,'document_number',d.document_number,
      'amount',a.amount::text,'currency',a.currency,'status',a.status,'revision',a.version::text,
      'created_at',to_char(a.created_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
      'reversed_by_allocation_id',a.reversed_by_allocation_id,
      'journal_entry_id',a.posted_journal_entry_id,'journal_number',j.journal_number,
      'journal_status',j.status,'journal_revision',j.revision::text,'journal_period_id',j.period_id
    ) row_value FROM page a
    JOIN business_adjustment c ON c.tenant_id=a.tenant_id AND c.entity_id=a.entity_id AND c.business_adjustment_id=a.business_adjustment_id
    JOIN business_document d ON d.tenant_id=a.tenant_id AND d.entity_id=a.entity_id AND d.business_document_id=a.business_document_id
    LEFT JOIN journal_entry cj ON cj.tenant_id=c.tenant_id AND cj.entity_id=c.entity_id AND cj.journal_entry_id=c.posted_journal_entry_id
    LEFT JOIN journal_entry j ON j.tenant_id=a.tenant_id AND j.entity_id=a.entity_id AND j.journal_entry_id=a.posted_journal_entry_id
  )
  SELECT COALESCE((SELECT jsonb_agg(row_value ORDER BY created_at DESC,business_allocation_id DESC) FROM facts),'[]'::jsonb),
    CASE WHEN (SELECT count(*) FROM candidates)>p_limit THEN (SELECT business_allocation_id FROM page ORDER BY created_at,business_allocation_id LIMIT 1) END
    INTO result_rows,next_id;
  RETURN jsonb_build_object('schema_version','CREDIT_ALLOCATION_HISTORY_V1','entity_id',p_entity,'subject_id',p_subject,
    'subject_kind',p_kind,'after_id',p_after,'limit',p_limit,'rows',result_rows,'next_id',next_id);
END;
$$;
REVOKE ALL ON FUNCTION refs_read_credit_allocation_history(uuid,uuid,uuid,text,uuid,integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION refs_read_credit_allocation_history(uuid,uuid,uuid,text,uuid,integer) TO refs_app;
COMMIT;
