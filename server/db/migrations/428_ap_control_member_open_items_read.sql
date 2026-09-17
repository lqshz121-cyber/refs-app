BEGIN;

-- P04 / N24 K1: member-level 291001 open-item read model.
-- For each VENDOR member of the AP control account, the POSTED ledger net (credit − debit) is set beside the
-- sub-ledger open balance of that counterparty's AP documents. A member whose two figures differ is an exception
-- the Controller must explain (unapplied vendor credit, manual JE on 291001 without a document, clearing in
-- flight). Read-only, AP.VIEW, entity-wide by default or bounded by a period for the ledger side. Exposes
-- member refs and amounts (business identifiers), never names.
CREATE FUNCTION refs_read_ap_control_member_open_items(p_tenant uuid,p_entity uuid,p_period uuid,p_limit integer,p_offset integer) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE result jsonb; period_row accounting_period;
BEGIN
  PERFORM refs_assert_scope(p_tenant,p_entity,'AP.VIEW');
  IF p_limit IS NULL OR p_limit<1 OR p_limit>200 OR p_offset IS NULL OR p_offset<0 THEN RAISE EXCEPTION 'paging is invalid' USING ERRCODE='22023'; END IF;
  IF p_period IS NOT NULL THEN
    SELECT * INTO period_row FROM accounting_period WHERE tenant_id=p_tenant AND entity_id=p_entity AND period_id=p_period;
    IF NOT FOUND THEN RAISE EXCEPTION 'A valid entity-scoped accounting period is required' USING ERRCODE='22023'; END IF;
  END IF;
  WITH ledger AS (
    SELECT ll.member_ref,sum(ll.credit_amount-ll.debit_amount)::numeric(20,4) AS control_net,count(*)::integer AS ledger_line_count,max(je.journal_date) AS last_posting_date
    FROM ledger_line ll JOIN journal_entry je ON je.tenant_id=ll.tenant_id AND je.entity_id=ll.entity_id AND je.journal_entry_id=ll.journal_entry_id
    WHERE ll.tenant_id=p_tenant AND ll.entity_id=p_entity AND ll.account_code='291001' AND je.status='POSTED'
      AND (p_period IS NULL OR je.journal_date BETWEEN period_row.starts_on AND period_row.ends_on)
    GROUP BY ll.member_ref
  ), documents AS (
    SELECT bd.counterparty_ref AS member_ref,sum(bd.open_balance)::numeric(20,4) AS open_balance,count(*) FILTER (WHERE bd.open_balance<>0)::integer AS open_document_count,
      count(*)::integer AS document_count,min(bd.due_date) FILTER (WHERE bd.open_balance<>0) AS oldest_open_due_date
    FROM business_document bd
    WHERE bd.tenant_id=p_tenant AND bd.entity_id=p_entity AND bd.document_kind='AP_BILL' AND bd.status IN ('APPROVED','OPEN','PARTIALLY_PAID','PAID')
      AND (p_period IS NULL OR bd.accounting_date<=period_row.ends_on)
    GROUP BY bd.counterparty_ref
  ), members AS (
    SELECT coalesce(l.member_ref,d.member_ref) AS member_ref,coalesce(l.control_net,0)::numeric(20,4) AS control_net,coalesce(d.open_balance,0)::numeric(20,4) AS open_balance,
      coalesce(l.ledger_line_count,0) AS ledger_line_count,coalesce(d.open_document_count,0) AS open_document_count,coalesce(d.document_count,0) AS document_count,
      l.last_posting_date,d.oldest_open_due_date,
      (coalesce(l.control_net,0)-coalesce(d.open_balance,0))::numeric(20,4) AS difference
    FROM ledger l FULL OUTER JOIN documents d ON d.member_ref=l.member_ref
  ), classified AS (
    SELECT m.*,
      CASE WHEN m.member_ref IS NULL THEN 'CONTROL_WITHOUT_MEMBER'
           WHEN m.difference=0 AND m.control_net=0 AND m.open_balance=0 THEN 'CLEARED'
           WHEN m.difference=0 THEN 'TIED'
           WHEN m.ledger_line_count=0 THEN 'DOCUMENT_WITHOUT_POSTING'
           WHEN m.document_count=0 THEN 'POSTING_WITHOUT_DOCUMENT'
           ELSE 'MISMATCH' END AS state
    FROM members m
  )
  SELECT jsonb_build_object(
    'schema_version','AP_CONTROL_MEMBER_OPEN_ITEMS_V1','entity_id',p_entity,'period_id',p_period,'account_code','291001','limit',p_limit,'offset',p_offset,
    'totals',jsonb_build_object(
      'member_count',(SELECT count(*) FROM classified),
      'control_net',(SELECT coalesce(sum(control_net),0)::numeric(20,4)::text FROM classified),
      'open_balance',(SELECT coalesce(sum(open_balance),0)::numeric(20,4)::text FROM classified),
      'difference',(SELECT coalesce(sum(difference),0)::numeric(20,4)::text FROM classified),
      'tied_count',(SELECT count(*) FROM classified WHERE state IN ('TIED','CLEARED')),
      'exception_count',(SELECT count(*) FROM classified WHERE state NOT IN ('TIED','CLEARED'))),
    'rows',coalesce((SELECT jsonb_agg(jsonb_build_object('member_ref',c.member_ref,'state',c.state,'control_net',c.control_net::text,'open_balance',c.open_balance::text,'difference',c.difference::text,
        'ledger_line_count',c.ledger_line_count,'open_document_count',c.open_document_count,'document_count',c.document_count,
        'last_posting_date',to_char(c.last_posting_date,'YYYY-MM-DD'),'oldest_open_due_date',to_char(c.oldest_open_due_date,'YYYY-MM-DD')) ORDER BY (c.state NOT IN ('TIED','CLEARED')) DESC,abs(c.difference) DESC,c.member_ref)
      FROM (SELECT * FROM classified ORDER BY (state NOT IN ('TIED','CLEARED')) DESC,abs(difference) DESC,member_ref LIMIT p_limit OFFSET p_offset) c),'[]'::jsonb),
    'accounting_authority','NONE','can_clear',false,'can_post',false
  ) INTO result;
  RETURN result;
END;
$$;
REVOKE ALL ON FUNCTION refs_read_ap_control_member_open_items(uuid,uuid,uuid,integer,integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION refs_read_ap_control_member_open_items(uuid,uuid,uuid,integer,integer) TO refs_app;
COMMENT ON FUNCTION refs_read_ap_control_member_open_items(uuid,uuid,uuid,integer,integer) IS 'Member-level 291001 open items: POSTED control net vs AP sub-ledger open balance per vendor member, exceptions first; read-only.';

COMMIT;
