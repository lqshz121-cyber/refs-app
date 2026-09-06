BEGIN;
CREATE FUNCTION refs_read_business_record(p_tenant uuid,p_entity uuid,p_record uuid,p_kind text)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE result jsonb;
BEGIN
  IF p_kind IS NULL OR p_kind NOT IN ('AP_BILL','AR_INVOICE','AP_VENDOR_CREDIT','AR_CREDIT_MEMO') OR p_record IS NULL THEN
    RAISE EXCEPTION 'Invalid business record selection' USING ERRCODE='22023';
  END IF;
  PERFORM refs_assert_scope(p_tenant,p_entity,CASE WHEN p_kind IN ('AP_BILL','AP_VENDOR_CREDIT') THEN 'AP.VIEW' ELSE 'AR.VIEW' END);
  IF p_kind IN ('AP_BILL','AR_INVOICE') THEN
    SELECT jsonb_build_object('record_id',d.business_document_id,'record_kind',d.document_kind,
      'number',d.document_number,'counterparty_ref',d.counterparty_ref,'counterparty_name',d.counterparty_name,
      'currency',d.currency,'accounting_date',d.accounting_date,'due_date',d.due_date,
      'amount',d.gross_amount::text,'open_balance',d.open_balance::text,'status',d.status,'revision',d.version::text,
      'description',j.description,'source_document_id',d.source_document_id,
      'journal_entry_id',j.journal_entry_id,'journal_number',j.journal_number,'journal_status',j.status,
      'journal_revision',j.revision::text,'period_id',j.period_id,
      'created_at',to_char(d.created_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'))
    INTO result FROM business_document d
    LEFT JOIN journal_entry j ON j.tenant_id=d.tenant_id AND j.entity_id=d.entity_id
      AND j.journal_entry_id=COALESCE(d.posted_journal_entry_id,d.draft_journal_entry_id)
    WHERE d.tenant_id=p_tenant AND d.entity_id=p_entity AND d.business_document_id=p_record AND d.document_kind=p_kind;
  ELSE
    SELECT jsonb_build_object('record_id',a.business_adjustment_id,'record_kind',a.adjustment_kind,
      'number',j.journal_number,'counterparty_ref',party.member_ref,'counterparty_name',NULL,
      'currency',a.currency,'accounting_date',a.accounting_date,'due_date',NULL,
      'amount',a.amount::text,'open_balance',NULL,'status',a.status,'revision',a.version::text,
      'description',a.reason,'source_document_id',NULL,
      'journal_entry_id',j.journal_entry_id,'journal_number',j.journal_number,'journal_status',j.status,
      'journal_revision',j.revision::text,'period_id',a.period_id,
      'created_at',to_char(a.created_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'))
    INTO result FROM business_adjustment a
    LEFT JOIN journal_entry j ON j.tenant_id=a.tenant_id AND j.entity_id=a.entity_id
      AND j.journal_entry_id=COALESCE(a.posted_journal_entry_id,a.draft_journal_entry_id) AND j.period_id=a.period_id
    LEFT JOIN LATERAL (
      SELECT min(l.member_ref) member_ref FROM journal_line l
      WHERE l.tenant_id=a.tenant_id AND l.entity_id=a.entity_id AND l.journal_entry_id=j.journal_entry_id
        AND l.account_code=CASE p_kind WHEN 'AP_VENDOR_CREDIT' THEN '291001' ELSE '120200' END
      HAVING count(*)=1 AND bool_and(l.member_ref IS NOT NULL AND btrim(l.member_ref)<>'')
    ) party ON true
    WHERE a.tenant_id=p_tenant AND a.entity_id=p_entity AND a.business_adjustment_id=p_record AND a.adjustment_kind=p_kind;
  END IF;
  IF result IS NULL THEN RAISE EXCEPTION 'Business record is not available in this company' USING ERRCODE='P0002'; END IF;
  RETURN jsonb_build_object('schema_version','BUSINESS_RECORD_DETAIL_V1','entity_id',p_entity,'record',result);
END;
$$;
REVOKE ALL ON FUNCTION refs_read_business_record(uuid,uuid,uuid,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION refs_read_business_record(uuid,uuid,uuid,text) TO refs_app;
COMMIT;
