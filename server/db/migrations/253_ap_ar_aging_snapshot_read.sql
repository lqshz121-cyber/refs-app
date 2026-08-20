BEGIN;

CREATE INDEX business_allocation_aging_history_idx
  ON business_allocation(tenant_id,entity_id,business_document_id,posted_journal_entry_id);
CREATE INDEX business_adjustment_occurrence_history_idx
  ON business_adjustment(tenant_id,entity_id,source_occurrence_id,adjustment_kind,posted_journal_entry_id);

CREATE FUNCTION refs_ap_ar_aging_snapshot_rows(
  p_tenant uuid,p_entity uuid,p_kind text,p_as_of date
)
RETURNS TABLE(
  business_document_id uuid,document_revision bigint,document_number text,counterparty_ref text,counterparty_name text,
  currency char(3),accounting_date date,due_date date,aging_date date,days_past_due integer,aging_bucket text,
  gross_amount numeric(20,4),open_balance numeric(20,4),source_document_id uuid,source_payload_hash text,
  posted_journal_entry_id uuid,posted_journal_revision bigint
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
  WITH posted_allocations AS (
    SELECT a.business_document_id,
      COALESCE(sum(a.amount) FILTER (
        WHERE original_je.status='POSTED' AND original_je.journal_date<=p_as_of
          AND (reversal_je.journal_entry_id IS NULL OR reversal_je.status<>'POSTED' OR reversal_je.journal_date>p_as_of)
      ),0)::numeric(20,4) AS applied_amount
    FROM public.business_allocation a
    JOIN public.journal_entry original_je
      ON original_je.tenant_id=a.tenant_id AND original_je.entity_id=a.entity_id
     AND original_je.journal_entry_id=a.posted_journal_entry_id
    LEFT JOIN LATERAL (
      SELECT rj.journal_entry_id,rj.status,rj.journal_date
      FROM public.business_adjustment reversal
      JOIN public.journal_entry rj
        ON rj.tenant_id=reversal.tenant_id AND rj.entity_id=reversal.entity_id
       AND rj.journal_entry_id=reversal.posted_journal_entry_id
      WHERE reversal.tenant_id=a.tenant_id AND reversal.entity_id=a.entity_id
        AND reversal.source_occurrence_id=a.payment_occurrence_id
        AND reversal.adjustment_kind IN ('AP_PAYMENT_REVERSAL','AR_RECEIPT_REVERSAL')
      ORDER BY rj.journal_date,rj.journal_entry_id LIMIT 1
    ) reversal_je ON true
    WHERE a.tenant_id=p_tenant AND a.entity_id=p_entity
      AND a.status IN ('ACTIVE','REVERSED') AND a.posted_journal_entry_id IS NOT NULL
    GROUP BY a.business_document_id
  ), posted_voids AS (
    SELECT DISTINCT a.business_document_id
    FROM public.business_adjustment a
    JOIN public.journal_entry j ON j.tenant_id=a.tenant_id AND j.entity_id=a.entity_id
      AND j.journal_entry_id=a.posted_journal_entry_id
    WHERE a.tenant_id=p_tenant AND a.entity_id=p_entity AND p_kind='AP_BILL'
      AND a.adjustment_kind='AP_BILL_VOID' AND a.status='POSTED'
      AND j.status='POSTED' AND j.journal_date<=p_as_of
  ), future_document_versions AS (
    SELECT changes.business_document_id,count(*)::bigint AS increment_count
    FROM (
      SELECT a.business_document_id
      FROM public.business_allocation a
      JOIN public.journal_entry j ON j.tenant_id=a.tenant_id AND j.entity_id=a.entity_id
        AND j.journal_entry_id=a.posted_journal_entry_id
      WHERE a.tenant_id=p_tenant AND a.entity_id=p_entity AND j.status='POSTED' AND j.journal_date>p_as_of
      UNION ALL
      SELECT a.business_document_id
      FROM public.business_allocation a
      JOIN public.business_adjustment reversal ON reversal.tenant_id=a.tenant_id AND reversal.entity_id=a.entity_id
        AND reversal.source_occurrence_id=a.payment_occurrence_id
        AND reversal.adjustment_kind IN ('AP_PAYMENT_REVERSAL','AR_RECEIPT_REVERSAL')
      JOIN public.journal_entry j ON j.tenant_id=reversal.tenant_id AND j.entity_id=reversal.entity_id
        AND j.journal_entry_id=reversal.posted_journal_entry_id
      WHERE a.tenant_id=p_tenant AND a.entity_id=p_entity AND j.status='POSTED' AND j.journal_date>p_as_of
      UNION ALL
      SELECT a.business_document_id
      FROM public.business_adjustment a
      JOIN public.journal_entry j ON j.tenant_id=a.tenant_id AND j.entity_id=a.entity_id
        AND j.journal_entry_id=a.posted_journal_entry_id
      WHERE a.tenant_id=p_tenant AND a.entity_id=p_entity AND a.adjustment_kind='AP_BILL_VOID'
        AND a.business_document_id IS NOT NULL AND j.status='POSTED' AND j.journal_date>p_as_of
    ) changes GROUP BY changes.business_document_id
  ), reconstructed AS (
    SELECT d.*,greatest(0,d.version-COALESCE(future.increment_count,0))::bigint AS historical_document_revision,
      source.payload_hash AS source_payload_hash,original_je.revision AS posted_journal_revision,
      CASE WHEN voided.business_document_id IS NOT NULL THEN 0::numeric(20,4)
        ELSE greatest(0::numeric(20,4),d.gross_amount-COALESCE(applied.applied_amount,0))::numeric(20,4)
      END AS historical_open_balance
    FROM public.business_document d
    JOIN public.journal_entry original_je
      ON original_je.tenant_id=d.tenant_id AND original_je.entity_id=d.entity_id
     AND original_je.journal_entry_id=d.posted_journal_entry_id
     AND original_je.status='POSTED' AND original_je.journal_date<=p_as_of
    LEFT JOIN public.source_document source
      ON source.tenant_id=d.tenant_id AND source.entity_id=d.entity_id AND source.source_document_id=d.source_document_id
    LEFT JOIN posted_allocations applied ON applied.business_document_id=d.business_document_id
    LEFT JOIN posted_voids voided ON voided.business_document_id=d.business_document_id
    LEFT JOIN future_document_versions future ON future.business_document_id=d.business_document_id
    WHERE d.tenant_id=p_tenant AND d.entity_id=p_entity AND d.document_kind=p_kind
      AND d.accounting_date<=p_as_of
  )
  SELECT r.business_document_id,r.historical_document_revision,r.document_number,r.counterparty_ref,r.counterparty_name,r.currency,
    r.accounting_date,r.due_date,COALESCE(r.due_date,r.accounting_date),
    greatest(0,p_as_of-COALESCE(r.due_date,r.accounting_date))::integer,
    CASE WHEN p_as_of<=COALESCE(r.due_date,r.accounting_date) THEN 'CURRENT'
      WHEN p_as_of-COALESCE(r.due_date,r.accounting_date) BETWEEN 1 AND 30 THEN 'DAYS_1_30'
      WHEN p_as_of-COALESCE(r.due_date,r.accounting_date) BETWEEN 31 AND 60 THEN 'DAYS_31_60'
      WHEN p_as_of-COALESCE(r.due_date,r.accounting_date) BETWEEN 61 AND 90 THEN 'DAYS_61_90'
      ELSE 'DAYS_91_PLUS' END,
    r.gross_amount,r.historical_open_balance,r.source_document_id,r.source_payload_hash,
    r.posted_journal_entry_id,r.posted_journal_revision
  FROM reconstructed r WHERE r.historical_open_balance>0
  ORDER BY COALESCE(r.due_date,r.accounting_date),r.counterparty_ref,r.business_document_id;
$$;

CREATE FUNCTION refs_read_ap_ar_aging_snapshot_scope(
  p_tenant uuid,p_entity uuid,p_kind text,p_period uuid,p_as_of date
)
RETURNS TABLE(
  entity_id uuid,period_id uuid,period_start date,period_end date,period_status text,document_kind text,
  as_of_date date,snapshot_id uuid,snapshot_version bigint,snapshot_hash text,detail_count bigint,counterparty_count bigint
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE required_permission text; scoped_period public.accounting_period%ROWTYPE; digest text; details bigint; counterparties bigint;
BEGIN
  IF p_kind='AP_BILL' THEN required_permission:='AP.VIEW';
  ELSIF p_kind='AR_INVOICE' THEN required_permission:='AR.VIEW';
  ELSE RAISE EXCEPTION 'Unsupported aging document kind' USING ERRCODE='22023'; END IF;
  PERFORM public.refs_assert_scope(p_tenant,p_entity,required_permission);
  SELECT * INTO scoped_period FROM public.accounting_period p
   WHERE p.tenant_id=p_tenant AND p.entity_id=p_entity AND p.period_id=p_period;
  IF NOT FOUND THEN RAISE EXCEPTION 'Accounting period is absent or outside the entity' USING ERRCODE='P0002'; END IF;
  IF p_as_of IS NULL OR p_as_of<scoped_period.starts_on OR p_as_of>scoped_period.ends_on THEN
    RAISE EXCEPTION 'Aging as-of date must be inside the selected accounting period' USING ERRCODE='22023';
  END IF;
  SELECT public.refs_jsonb_hash(COALESCE(jsonb_agg(jsonb_build_object(
      'business_document_id',r.business_document_id,'document_revision',r.document_revision,
      'document_number',r.document_number,'counterparty_ref',r.counterparty_ref,'counterparty_name',r.counterparty_name,
      'currency',r.currency,'accounting_date',r.accounting_date,'due_date',r.due_date,'aging_date',r.aging_date,
      'aging_bucket',r.aging_bucket,'gross_amount',r.gross_amount,'open_balance',r.open_balance,
      'source_document_id',r.source_document_id,'source_payload_hash',r.source_payload_hash,
      'posted_journal_entry_id',r.posted_journal_entry_id,'posted_journal_revision',r.posted_journal_revision
    ) ORDER BY r.aging_date,r.counterparty_ref,r.business_document_id),'[]'::jsonb)),
    count(*),count(DISTINCT (r.counterparty_ref,r.counterparty_name,r.currency))
    INTO digest,details,counterparties
  FROM public.refs_ap_ar_aging_snapshot_rows(p_tenant,p_entity,p_kind,p_as_of) r;
  RETURN QUERY SELECT p_entity,p_period,scoped_period.starts_on,scoped_period.ends_on,scoped_period.status::text,p_kind,p_as_of,
    (substr(digest,8,8)||'-'||substr(digest,16,4)||'-5'||substr(digest,21,3)||'-8'||substr(digest,25,3)||'-'||substr(digest,28,12))::uuid,
    1::bigint,digest,details,counterparties;
END;
$$;

CREATE FUNCTION refs_list_ap_ar_aging_summary(
  p_tenant uuid,p_entity uuid,p_kind text,p_period uuid,p_as_of date
)
RETURNS TABLE(
  counterparty_ref text,counterparty_name text,currency char(3),current_amount numeric(20,4),days_1_30 numeric(20,4),
  days_31_60 numeric(20,4),days_61_90 numeric(20,4),days_91_plus numeric(20,4),total_open_balance numeric(20,4),document_count bigint
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
BEGIN
  PERFORM 1 FROM public.refs_read_ap_ar_aging_snapshot_scope(p_tenant,p_entity,p_kind,p_period,p_as_of);
  RETURN QUERY SELECT r.counterparty_ref,r.counterparty_name,r.currency,
    COALESCE(sum(r.open_balance) FILTER(WHERE r.aging_bucket='CURRENT'),0)::numeric(20,4),
    COALESCE(sum(r.open_balance) FILTER(WHERE r.aging_bucket='DAYS_1_30'),0)::numeric(20,4),
    COALESCE(sum(r.open_balance) FILTER(WHERE r.aging_bucket='DAYS_31_60'),0)::numeric(20,4),
    COALESCE(sum(r.open_balance) FILTER(WHERE r.aging_bucket='DAYS_61_90'),0)::numeric(20,4),
    COALESCE(sum(r.open_balance) FILTER(WHERE r.aging_bucket='DAYS_91_PLUS'),0)::numeric(20,4),
    sum(r.open_balance)::numeric(20,4),count(*)
  FROM public.refs_ap_ar_aging_snapshot_rows(p_tenant,p_entity,p_kind,p_as_of) r
  GROUP BY r.counterparty_ref,r.counterparty_name,r.currency ORDER BY r.counterparty_name,r.counterparty_ref,r.currency;
END;
$$;

CREATE FUNCTION refs_read_ap_ar_aging_detail_scope(
  p_tenant uuid,p_entity uuid,p_kind text,p_period uuid,p_as_of date,p_counterparty_ref text,p_counterparty_name text,p_currency char(3)
)
RETURNS TABLE(
  entity_id uuid,period_id uuid,document_kind text,as_of_date date,snapshot_id uuid,snapshot_version bigint,snapshot_hash text,
  counterparty_ref text,counterparty_name text,currency char(3),total_count bigint
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE snapshot record;
BEGIN
  IF p_counterparty_ref IS NULL OR length(btrim(p_counterparty_ref)) NOT BETWEEN 1 AND 128
    OR p_counterparty_name IS NULL OR length(btrim(p_counterparty_name)) NOT BETWEEN 1 AND 255
    OR p_currency IS NULL OR p_currency!~'^[A-Z]{3}$' THEN
    RAISE EXCEPTION 'Aging detail scope is invalid' USING ERRCODE='22023';
  END IF;
  SELECT * INTO snapshot FROM public.refs_read_ap_ar_aging_snapshot_scope(p_tenant,p_entity,p_kind,p_period,p_as_of);
  RETURN QUERY SELECT snapshot.entity_id,snapshot.period_id,snapshot.document_kind,snapshot.as_of_date,
    snapshot.snapshot_id,snapshot.snapshot_version,snapshot.snapshot_hash,p_counterparty_ref,p_counterparty_name,p_currency,count(*)
  FROM public.refs_ap_ar_aging_snapshot_rows(p_tenant,p_entity,p_kind,p_as_of) r
  WHERE r.counterparty_ref=p_counterparty_ref AND r.counterparty_name=p_counterparty_name AND r.currency=p_currency;
END;
$$;

CREATE FUNCTION refs_list_ap_ar_aging_detail(
  p_tenant uuid,p_entity uuid,p_kind text,p_period uuid,p_as_of date,p_counterparty_ref text,p_counterparty_name text,p_currency char(3),p_limit integer,p_offset integer
)
RETURNS TABLE(
  business_document_id uuid,document_revision bigint,document_number text,counterparty_ref text,counterparty_name text,
  currency char(3),accounting_date date,due_date date,aging_date date,days_past_due integer,aging_bucket text,
  gross_amount numeric(20,4),open_balance numeric(20,4),source_document_id uuid,source_payload_hash text,
  posted_journal_entry_id uuid,posted_journal_revision bigint
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
BEGIN
  IF p_limit<1 OR p_limit>200 OR p_offset<0 OR p_offset>1000000 THEN
    RAISE EXCEPTION 'Aging detail page is invalid' USING ERRCODE='22023';
  END IF;
  PERFORM 1 FROM public.refs_read_ap_ar_aging_detail_scope(p_tenant,p_entity,p_kind,p_period,p_as_of,p_counterparty_ref,p_counterparty_name,p_currency);
  RETURN QUERY SELECT r.* FROM public.refs_ap_ar_aging_snapshot_rows(p_tenant,p_entity,p_kind,p_as_of) r
   WHERE r.counterparty_ref=p_counterparty_ref AND r.counterparty_name=p_counterparty_name AND r.currency=p_currency
   ORDER BY r.aging_date,r.business_document_id LIMIT p_limit OFFSET p_offset;
END;
$$;

REVOKE ALL ON FUNCTION refs_ap_ar_aging_snapshot_rows(uuid,uuid,text,date) FROM PUBLIC;
REVOKE ALL ON FUNCTION refs_read_ap_ar_aging_snapshot_scope(uuid,uuid,text,uuid,date) FROM PUBLIC;
REVOKE ALL ON FUNCTION refs_list_ap_ar_aging_summary(uuid,uuid,text,uuid,date) FROM PUBLIC;
REVOKE ALL ON FUNCTION refs_read_ap_ar_aging_detail_scope(uuid,uuid,text,uuid,date,text,text,char) FROM PUBLIC;
REVOKE ALL ON FUNCTION refs_list_ap_ar_aging_detail(uuid,uuid,text,uuid,date,text,text,char,integer,integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION refs_read_ap_ar_aging_snapshot_scope(uuid,uuid,text,uuid,date) TO refs_app;
GRANT EXECUTE ON FUNCTION refs_list_ap_ar_aging_summary(uuid,uuid,text,uuid,date) TO refs_app;
GRANT EXECUTE ON FUNCTION refs_read_ap_ar_aging_detail_scope(uuid,uuid,text,uuid,date,text,text,char) TO refs_app;
GRANT EXECUTE ON FUNCTION refs_list_ap_ar_aging_detail(uuid,uuid,text,uuid,date,text,text,char,integer,integer) TO refs_app;

COMMIT;
