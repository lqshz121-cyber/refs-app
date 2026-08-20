BEGIN;

CREATE INDEX business_document_period_read_idx
  ON business_document(tenant_id,entity_id,document_kind,accounting_date DESC,created_at DESC,business_document_id DESC);
CREATE INDEX journal_entry_period_read_idx
  ON journal_entry(tenant_id,entity_id,period_id,journal_date DESC,created_at DESC,journal_entry_id DESC);
CREATE INDEX business_adjustment_period_read_idx
  ON business_adjustment(tenant_id,entity_id,period_id,accounting_date DESC,created_at DESC,business_adjustment_id DESC);

CREATE FUNCTION refs_read_business_document_period_scope(
  p_tenant uuid,p_entity uuid,p_kind text,p_period uuid
)
RETURNS TABLE(entity_id uuid,period_id uuid,period_start date,period_end date,period_status text,total_count bigint)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE required_permission text;
BEGIN
  IF p_kind='AP_BILL' THEN required_permission:='AP.VIEW';
  ELSIF p_kind='AR_INVOICE' THEN required_permission:='AR.VIEW';
  ELSE RAISE EXCEPTION 'Unsupported business document kind' USING ERRCODE='22023';
  END IF;
  PERFORM public.refs_assert_scope(p_tenant,p_entity,required_permission);
  IF NOT EXISTS(SELECT 1 FROM public.accounting_period p WHERE p.tenant_id=p_tenant AND p.entity_id=p_entity AND p.period_id=p_period) THEN
    RAISE EXCEPTION 'Accounting period is absent or outside the entity' USING ERRCODE='P0002';
  END IF;
  RETURN QUERY
    SELECT p.entity_id,p.period_id,p.starts_on,p.ends_on,p.status::text,count(d.business_document_id)::bigint
    FROM public.accounting_period p
    LEFT JOIN public.business_document d
      ON d.tenant_id=p.tenant_id AND d.entity_id=p.entity_id AND d.document_kind=p_kind
     AND d.accounting_date BETWEEN p.starts_on AND p.ends_on
     AND EXISTS(SELECT 1 FROM public.journal_entry j WHERE j.tenant_id=d.tenant_id AND j.entity_id=d.entity_id
       AND j.journal_entry_id=COALESCE(d.draft_journal_entry_id,d.posted_journal_entry_id) AND j.period_id=p.period_id)
    WHERE p.tenant_id=p_tenant AND p.entity_id=p_entity AND p.period_id=p_period
    GROUP BY p.entity_id,p.period_id,p.starts_on,p.ends_on,p.status;
END;
$$;

CREATE FUNCTION refs_read_business_adjustment_period_scope(
  p_tenant uuid,p_entity uuid,p_module text,p_period uuid
)
RETURNS TABLE(entity_id uuid,period_id uuid,period_start date,period_end date,period_status text,total_count bigint)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE required_permission text;
BEGIN
  IF p_module='AP' THEN required_permission:='AP.VIEW';
  ELSIF p_module='AR' THEN required_permission:='AR.VIEW';
  ELSE RAISE EXCEPTION 'Unsupported adjustment module' USING ERRCODE='22023';
  END IF;
  PERFORM public.refs_assert_scope(p_tenant,p_entity,required_permission);
  IF NOT EXISTS(SELECT 1 FROM public.accounting_period p WHERE p.tenant_id=p_tenant AND p.entity_id=p_entity AND p.period_id=p_period) THEN
    RAISE EXCEPTION 'Accounting period is absent or outside the entity' USING ERRCODE='P0002';
  END IF;
  RETURN QUERY
    SELECT p.entity_id,p.period_id,p.starts_on,p.ends_on,p.status::text,count(a.business_adjustment_id)::bigint
    FROM public.accounting_period p
    LEFT JOIN public.business_adjustment a ON a.tenant_id=p.tenant_id AND a.entity_id=p.entity_id AND a.period_id=p.period_id
      AND a.accounting_date BETWEEN p.starts_on AND p.ends_on
      AND ((p_module='AP' AND a.adjustment_kind IN ('AP_BILL_VOID','AP_VENDOR_CREDIT','AP_PAYMENT_REVERSAL'))
        OR (p_module='AR' AND a.adjustment_kind IN ('AR_CREDIT_MEMO','AR_REFUND','AR_RECEIPT_REVERSAL')))
      AND (COALESCE(a.draft_journal_entry_id,a.posted_journal_entry_id) IS NULL OR EXISTS(
        SELECT 1 FROM public.journal_entry j WHERE j.tenant_id=a.tenant_id AND j.entity_id=a.entity_id
          AND j.journal_entry_id=COALESCE(a.draft_journal_entry_id,a.posted_journal_entry_id) AND j.period_id=p.period_id))
    WHERE p.tenant_id=p_tenant AND p.entity_id=p_entity AND p.period_id=p_period
    GROUP BY p.entity_id,p.period_id,p.starts_on,p.ends_on,p.status;
END;
$$;

CREATE FUNCTION refs_list_business_adjustments_period(
  p_tenant uuid,p_entity uuid,p_module text,p_period uuid,p_limit integer,p_offset integer
)
RETURNS TABLE(
  business_adjustment_id uuid,adjustment_kind text,business_document_id uuid,source_adjustment_id uuid,
  amount numeric(20,4),currency char(3),accounting_date date,period_id uuid,reason text,status text,version bigint,
  journal_entry_id uuid,journal_status text,journal_revision bigint,created_at timestamptz
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE required_permission text; scoped_period public.accounting_period%ROWTYPE;
BEGIN
  IF p_module='AP' THEN required_permission:='AP.VIEW';
  ELSIF p_module='AR' THEN required_permission:='AR.VIEW';
  ELSE RAISE EXCEPTION 'Unsupported adjustment module' USING ERRCODE='22023';
  END IF;
  IF p_limit<1 OR p_limit>200 OR p_offset<0 OR p_offset>1000000 THEN RAISE EXCEPTION 'Adjustment page is invalid' USING ERRCODE='22023'; END IF;
  PERFORM public.refs_assert_scope(p_tenant,p_entity,required_permission);
  SELECT * INTO scoped_period FROM public.accounting_period p
   WHERE p.tenant_id=p_tenant AND p.entity_id=p_entity AND p.period_id=p_period;
  IF NOT FOUND THEN RAISE EXCEPTION 'Accounting period is absent or outside the entity' USING ERRCODE='P0002'; END IF;
  RETURN QUERY
    SELECT a.business_adjustment_id,a.adjustment_kind,a.business_document_id,a.source_adjustment_id,
      a.amount,a.currency,a.accounting_date,a.period_id,a.reason,a.status,a.version,
      j.journal_entry_id,j.status::text,j.revision,a.created_at
    FROM public.business_adjustment a
    LEFT JOIN public.journal_entry j ON j.tenant_id=a.tenant_id AND j.entity_id=a.entity_id
      AND j.journal_entry_id=COALESCE(a.draft_journal_entry_id,a.posted_journal_entry_id)
      AND j.period_id=p_period
    WHERE a.tenant_id=p_tenant AND a.entity_id=p_entity AND a.period_id=p_period
      AND a.accounting_date BETWEEN scoped_period.starts_on AND scoped_period.ends_on
      AND ((p_module='AP' AND a.adjustment_kind IN ('AP_BILL_VOID','AP_VENDOR_CREDIT','AP_PAYMENT_REVERSAL'))
        OR (p_module='AR' AND a.adjustment_kind IN ('AR_CREDIT_MEMO','AR_REFUND','AR_RECEIPT_REVERSAL')))
      AND (COALESCE(a.draft_journal_entry_id,a.posted_journal_entry_id) IS NULL OR j.journal_entry_id IS NOT NULL)
    ORDER BY a.accounting_date DESC,a.created_at DESC,a.business_adjustment_id DESC
    LIMIT p_limit OFFSET p_offset;
END;
$$;

CREATE FUNCTION refs_list_business_documents_period(
  p_tenant uuid,p_entity uuid,p_kind text,p_period uuid,p_limit integer,p_offset integer
)
RETURNS TABLE(
  business_document_id uuid,document_number text,counterparty_ref text,counterparty_name text,
  currency char(3),accounting_date date,due_date date,gross_amount numeric(20,4),open_balance numeric(20,4),
  status text,posted_journal_entry_id uuid,version bigint,offset_account_code text,description text,
  created_at timestamptz,updated_at timestamptz,journal_entry_id uuid,journal_status text,journal_revision bigint,period_id uuid
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE required_permission text; scoped_period public.accounting_period%ROWTYPE;
BEGIN
  IF p_kind='AP_BILL' THEN required_permission:='AP.VIEW';
  ELSIF p_kind='AR_INVOICE' THEN required_permission:='AR.VIEW';
  ELSE RAISE EXCEPTION 'Unsupported business document kind' USING ERRCODE='22023';
  END IF;
  IF p_limit<1 OR p_limit>200 OR p_offset<0 OR p_offset>1000000 THEN RAISE EXCEPTION 'Period document page is invalid' USING ERRCODE='22023'; END IF;
  PERFORM public.refs_assert_scope(p_tenant,p_entity,required_permission);
  SELECT * INTO scoped_period FROM public.accounting_period p
   WHERE p.tenant_id=p_tenant AND p.entity_id=p_entity AND p.period_id=p_period;
  IF NOT FOUND THEN RAISE EXCEPTION 'Accounting period is absent or outside the entity' USING ERRCODE='P0002'; END IF;
  RETURN QUERY
    SELECT d.business_document_id,d.document_number,d.counterparty_ref,d.counterparty_name,d.currency,
      d.accounting_date,d.due_date,d.gross_amount,d.open_balance,d.status,d.posted_journal_entry_id,
      d.version,lines.offset_account_code,j.description,d.created_at,d.updated_at,
      j.journal_entry_id,j.status::text,j.revision,j.period_id
    FROM public.business_document d
    JOIN public.journal_entry j ON j.tenant_id=d.tenant_id AND j.entity_id=d.entity_id
      AND j.journal_entry_id=COALESCE(d.draft_journal_entry_id,d.posted_journal_entry_id)
      AND j.period_id=p_period
    LEFT JOIN LATERAL (
      SELECT line.account_code AS offset_account_code FROM public.journal_line line
      WHERE line.tenant_id=d.tenant_id AND line.entity_id=d.entity_id
        AND line.journal_entry_id=j.journal_entry_id
        AND ((d.document_kind='AP_BILL' AND line.line_no=1) OR (d.document_kind='AR_INVOICE' AND line.line_no=2))
      LIMIT 1
    ) lines ON true
    WHERE d.tenant_id=p_tenant AND d.entity_id=p_entity AND d.document_kind=p_kind
      AND d.accounting_date BETWEEN scoped_period.starts_on AND scoped_period.ends_on
    ORDER BY d.accounting_date DESC,d.created_at DESC,d.business_document_id DESC
    LIMIT p_limit OFFSET p_offset;
END;
$$;

CREATE FUNCTION refs_read_journal_period_scope(p_tenant uuid,p_entity uuid,p_period uuid)
RETURNS TABLE(entity_id uuid,period_id uuid,period_start date,period_end date,period_status text,total_count bigint)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
BEGIN
  PERFORM public.refs_assert_scope(p_tenant,p_entity,'GL.JE.VIEW');
  IF NOT EXISTS(SELECT 1 FROM public.accounting_period p WHERE p.tenant_id=p_tenant AND p.entity_id=p_entity AND p.period_id=p_period) THEN
    RAISE EXCEPTION 'Accounting period is absent or outside the entity' USING ERRCODE='P0002';
  END IF;
  RETURN QUERY
    SELECT p.entity_id,p.period_id,p.starts_on,p.ends_on,p.status::text,count(j.journal_entry_id)::bigint
    FROM public.accounting_period p
    LEFT JOIN public.journal_entry j ON j.tenant_id=p.tenant_id AND j.entity_id=p.entity_id AND j.period_id=p.period_id
      AND j.journal_date BETWEEN p.starts_on AND p.ends_on
    WHERE p.tenant_id=p_tenant AND p.entity_id=p_entity AND p.period_id=p_period
    GROUP BY p.entity_id,p.period_id,p.starts_on,p.ends_on,p.status;
END;
$$;

CREATE FUNCTION refs_list_journal_entries_period(
  p_tenant uuid,p_entity uuid,p_period uuid,p_limit integer,p_offset integer
)
RETURNS TABLE(
  journal_entry_id uuid,journal_number text,journal_type text,status text,journal_date date,currency char(3),
  description text,revision bigint,created_at timestamptz,posted_at timestamptz,ledger_line_count bigint,period_id uuid
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE scoped_period public.accounting_period%ROWTYPE;
BEGIN
  IF p_limit<1 OR p_limit>200 OR p_offset<0 OR p_offset>1000000 THEN RAISE EXCEPTION 'Journal page is invalid' USING ERRCODE='22023'; END IF;
  PERFORM public.refs_assert_scope(p_tenant,p_entity,'GL.JE.VIEW');
  SELECT * INTO scoped_period FROM public.accounting_period p
   WHERE p.tenant_id=p_tenant AND p.entity_id=p_entity AND p.period_id=p_period;
  IF NOT FOUND THEN RAISE EXCEPTION 'Accounting period is absent or outside the entity' USING ERRCODE='P0002'; END IF;
  RETURN QUERY
    SELECT j.journal_entry_id,j.journal_number,j.journal_type::text,j.status::text,j.journal_date,j.currency,
      j.description,j.revision,j.created_at,j.posted_at,count(l.ledger_line_id)::bigint,j.period_id
    FROM public.journal_entry j
    LEFT JOIN public.ledger_line l ON l.tenant_id=j.tenant_id AND l.entity_id=j.entity_id AND l.journal_entry_id=j.journal_entry_id
    WHERE j.tenant_id=p_tenant AND j.entity_id=p_entity AND j.period_id=p_period
      AND j.journal_date BETWEEN scoped_period.starts_on AND scoped_period.ends_on
    GROUP BY j.journal_entry_id
    ORDER BY j.journal_date DESC,j.created_at DESC,j.journal_entry_id DESC
    LIMIT p_limit OFFSET p_offset;
END;
$$;

REVOKE ALL ON FUNCTION refs_read_business_document_period_scope(uuid,uuid,text,uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION refs_list_business_documents_period(uuid,uuid,text,uuid,integer,integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION refs_read_journal_period_scope(uuid,uuid,uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION refs_list_journal_entries_period(uuid,uuid,uuid,integer,integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION refs_read_business_adjustment_period_scope(uuid,uuid,text,uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION refs_list_business_adjustments_period(uuid,uuid,text,uuid,integer,integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION refs_read_business_document_period_scope(uuid,uuid,text,uuid) TO refs_app;
GRANT EXECUTE ON FUNCTION refs_list_business_documents_period(uuid,uuid,text,uuid,integer,integer) TO refs_app;
GRANT EXECUTE ON FUNCTION refs_read_journal_period_scope(uuid,uuid,uuid) TO refs_app;
GRANT EXECUTE ON FUNCTION refs_list_journal_entries_period(uuid,uuid,uuid,integer,integer) TO refs_app;
GRANT EXECUTE ON FUNCTION refs_read_business_adjustment_period_scope(uuid,uuid,text,uuid) TO refs_app;
GRANT EXECUTE ON FUNCTION refs_list_business_adjustments_period(uuid,uuid,text,uuid,integer,integer) TO refs_app;

COMMIT;
