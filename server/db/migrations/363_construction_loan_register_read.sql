BEGIN;

CREATE FUNCTION refs_read_construction_loan_register(p_tenant uuid,p_entity uuid,p_period uuid)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE period_row accounting_period;register_rows jsonb;blocked_rows jsonb;exact_count integer;blocked_count integer;
BEGIN
  PERFORM refs_assert_scope(p_tenant,p_entity,'GL.REPORT.VIEW');
  SELECT * INTO period_row FROM accounting_period
    WHERE tenant_id=p_tenant AND entity_id=p_entity AND period_id=p_period AND ledger_code='PRIMARY';
  IF NOT FOUND THEN RAISE EXCEPTION 'Loan Register requires one primary company period' USING ERRCODE='22023'; END IF;

  WITH keys AS MATERIALIZED (
    SELECT DISTINCT ms.input_keys->>'account_code' account_code
    FROM mapping_snapshot ms
    WHERE ms.tenant_id=p_tenant AND ms.entity_id=p_entity
      AND ms.family='CONSTRUCTION_LOAN_ACCOUNT_CLASSIFICATION' AND ms.status IN('APPROVED','RETIRED')
      AND ms.effective_from::date<=period_row.ends_on
      AND(ms.effective_to IS NULL OR ms.effective_to::date>period_row.ends_on)
      AND ms.input_keys? 'account_code'
  ), mappings AS MATERIALIZED (
    SELECT k.account_code,x.mapping_snapshot_id,x.mapping_version,x.mapping_snapshot_hash,x.classification,x.candidate_count
    FROM keys k
    LEFT JOIN LATERAL(
      WITH eligible AS(
        SELECT ms.* FROM mapping_snapshot ms
        WHERE ms.tenant_id=p_tenant AND ms.entity_id=p_entity
          AND ms.family='CONSTRUCTION_LOAN_ACCOUNT_CLASSIFICATION' AND ms.status IN('APPROVED','RETIRED')
          AND ms.effective_from::date<=period_row.ends_on
          AND(ms.effective_to IS NULL OR ms.effective_to::date>period_row.ends_on)
          AND ms.input_keys=jsonb_build_object('account_code',k.account_code)
      ), highest AS(SELECT * FROM eligible WHERE priority=(SELECT max(priority) FROM eligible))
      SELECT count(*)::integer candidate_count,
        (array_agg(mapping_snapshot_id ORDER BY mapping_snapshot_id))[1] mapping_snapshot_id,
        (array_agg(version::text ORDER BY mapping_snapshot_id))[1] mapping_version,
        (array_agg(snapshot_hash ORDER BY mapping_snapshot_id))[1] mapping_snapshot_hash,
        (array_agg(output_rules->>'classification' ORDER BY mapping_snapshot_id))[1] classification
      FROM highest
    ) x ON true
  ), admitted AS MATERIALIZED (
    SELECT * FROM mappings WHERE candidate_count=1 AND classification='CONSTRUCTION_LOAN'
  ), posted AS MATERIALIZED (
    SELECT l.*,j.journal_number,j.journal_date,a.account_name,m.mapping_snapshot_id,m.mapping_version,m.mapping_snapshot_hash
    FROM ledger_line l
    JOIN journal_entry j ON j.tenant_id=l.tenant_id AND j.entity_id=l.entity_id AND j.period_id=l.period_id AND j.journal_entry_id=l.journal_entry_id AND j.status='POSTED'
    JOIN accounting_period lp ON lp.tenant_id=l.tenant_id AND lp.entity_id=l.entity_id AND lp.period_id=l.period_id AND lp.ledger_code='PRIMARY'
    JOIN admitted m ON m.account_code=l.account_code
    LEFT JOIN account_master a ON a.tenant_id=l.tenant_id AND a.entity_id=l.entity_id AND a.account_code=l.account_code AND a.active
    WHERE l.tenant_id=p_tenant AND l.entity_id=p_entity AND j.journal_date<=period_row.ends_on
  ), traced AS MATERIALIZED (
    SELECT p.*,
      COALESCE(ledger_trace.trace_count,0) ledger_trace_count,
      COALESCE(source_trace.source_link_count,0) source_link_count,
      COALESCE(source_trace.source_line_count,0) source_line_count,
      COALESCE(source_trace.non_loan_count,0) non_loan_count,
      COALESCE(source_trace.blank_loan_count,0) blank_loan_count,
      COALESCE(source_trace.loan_ref_count,0) loan_ref_count,source_trace.loan_ref,
      COALESCE(source_trace.blank_lender_count,0) blank_lender_count,
      COALESCE(source_trace.lender_ref_count,0) lender_ref_count,source_trace.lender_ref,
      COALESCE(source_trace.source_document_ids,ARRAY[]::uuid[]) source_document_ids,
      COALESCE(source_trace.source_document_line_ids,ARRAY[]::uuid[]) source_document_line_ids
    FROM posted p
    LEFT JOIN LATERAL(
      SELECT count(*)::integer trace_count FROM source_link sl
      WHERE sl.tenant_id=p.tenant_id AND sl.entity_id=p.entity_id AND sl.link_type='JE_LINE_TO_LEDGER'
        AND sl.journal_entry_id=p.journal_entry_id AND sl.journal_line_id=p.journal_line_id
        AND sl.posting_batch_id=p.posting_batch_id AND sl.ledger_line_id=p.ledger_line_id
    ) ledger_trace ON true
    LEFT JOIN LATERAL(
      WITH links AS MATERIALIZED(
        SELECT sl.source_link_id,sl.source_document_id,sl.source_document_line_id
        FROM source_link sl
        WHERE sl.tenant_id=p.tenant_id AND sl.entity_id=p.entity_id
          AND sl.link_type='SOURCE_TO_JE' AND sl.journal_entry_id=p.journal_entry_id
          AND sl.source_document_id IS NOT NULL
      ), facts AS(
        SELECT DISTINCT l.source_link_id,d.source_document_id,dl.source_document_line_id,d.source_module,
          NULLIF(btrim(dl.loan_ref),'') loan_ref,NULLIF(btrim(dl.party_ref),'') lender_ref
        FROM links l
        JOIN source_document d ON d.tenant_id=p.tenant_id AND d.entity_id=p.entity_id AND d.source_document_id=l.source_document_id
        LEFT JOIN source_document_line dl ON dl.tenant_id=d.tenant_id AND dl.entity_id=d.entity_id
          AND dl.source_document_id=d.source_document_id
          AND(l.source_document_line_id IS NULL OR dl.source_document_line_id=l.source_document_line_id)
      )
      SELECT (SELECT count(*) FROM links)::integer source_link_count,count(source_document_line_id)::integer source_line_count,
        count(*)FILTER(WHERE source_module<>'loan')::integer non_loan_count,
        count(*)FILTER(WHERE source_document_line_id IS NOT NULL AND loan_ref IS NULL)::integer blank_loan_count,
        count(DISTINCT loan_ref)::integer loan_ref_count,min(loan_ref) loan_ref,
        count(*)FILTER(WHERE source_document_line_id IS NOT NULL AND lender_ref IS NULL)::integer blank_lender_count,
        count(DISTINCT lender_ref)::integer lender_ref_count,min(lender_ref) lender_ref,
        ARRAY(SELECT DISTINCT source_document_id FROM facts ORDER BY source_document_id)::uuid[] source_document_ids,
        ARRAY(SELECT DISTINCT source_document_line_id FROM facts WHERE source_document_line_id IS NOT NULL ORDER BY source_document_line_id)::uuid[] source_document_line_ids
      FROM facts
    ) source_trace ON true
  ), classified AS MATERIALIZED (
    SELECT t.*,CASE
      WHEN ledger_trace_count<>1 THEN 'BLOCKED_LEDGER_LINEAGE'
      WHEN source_link_count=0 THEN 'BLOCKED_SOURCE_LINK_REQUIRED'
      WHEN non_loan_count>0 THEN 'BLOCKED_NON_LOAN_SOURCE'
      WHEN source_line_count=0 THEN 'BLOCKED_LOAN_SOURCE_LINE_REQUIRED'
      WHEN blank_loan_count>0 OR loan_ref_count<>1 THEN 'BLOCKED_LOAN_REFERENCE_AMBIGUOUS'
      WHEN blank_lender_count>0 OR lender_ref_count<>1 THEN 'BLOCKED_LENDER_REFERENCE_AMBIGUOUS'
      ELSE 'EXACT_POSTED_LOAN_SOURCE' END source_binding_status
    FROM traced t
  ), exact AS MATERIALIZED (
    SELECT loan_ref,lender_ref,currency,account_code,COALESCE(account_name,'Unmapped account') account_name,
      mapping_snapshot_id,mapping_version,mapping_snapshot_hash,
      sum(CASE WHEN journal_date<period_row.starts_on THEN credit_amount-debit_amount ELSE 0 END)::numeric(20,4) opening_balance,
      sum(CASE WHEN journal_date BETWEEN period_row.starts_on AND period_row.ends_on THEN credit_amount ELSE 0 END)::numeric(20,4) period_draws,
      sum(CASE WHEN journal_date BETWEEN period_row.starts_on AND period_row.ends_on THEN debit_amount ELSE 0 END)::numeric(20,4) period_repayments,
      sum(credit_amount-debit_amount)::numeric(20,4) closing_balance,
      array_agg(DISTINCT journal_entry_id ORDER BY journal_entry_id) journal_entry_ids,
      array_agg(DISTINCT journal_line_id ORDER BY journal_line_id) journal_line_ids,
      array_agg(DISTINCT ledger_line_id ORDER BY ledger_line_id) ledger_line_ids,
      ARRAY(SELECT DISTINCT value FROM classified c2 CROSS JOIN unnest(c2.source_document_ids)value WHERE c2.source_binding_status='EXACT_POSTED_LOAN_SOURCE' AND c2.loan_ref=c.loan_ref AND c2.lender_ref=c.lender_ref AND c2.currency=c.currency AND c2.account_code=c.account_code ORDER BY value)::uuid[] source_document_ids,
      ARRAY(SELECT DISTINCT value FROM classified c2 CROSS JOIN unnest(c2.source_document_line_ids)value WHERE c2.source_binding_status='EXACT_POSTED_LOAN_SOURCE' AND c2.loan_ref=c.loan_ref AND c2.lender_ref=c.lender_ref AND c2.currency=c.currency AND c2.account_code=c.account_code ORDER BY value)::uuid[] source_document_line_ids
    FROM classified c WHERE source_binding_status='EXACT_POSTED_LOAN_SOURCE'
    GROUP BY loan_ref,lender_ref,currency,account_code,account_name,mapping_snapshot_id,mapping_version,mapping_snapshot_hash
  )
  SELECT
    COALESCE((SELECT jsonb_agg(jsonb_build_object(
      'loan_ref',loan_ref,'lender_ref',lender_ref,'currency',currency,'account_code',account_code,'account_name',account_name,
      'opening_balance',opening_balance::text,'period_draws',period_draws::text,'period_repayments',period_repayments::text,'closing_balance',closing_balance::text,
      'source_binding_status','EXACT_POSTED_LOAN_SOURCE','mapping_snapshot_id',mapping_snapshot_id,'mapping_version',mapping_version,'mapping_snapshot_hash',mapping_snapshot_hash,
      'journal_entry_ids',journal_entry_ids,'journal_line_ids',journal_line_ids,'ledger_line_ids',ledger_line_ids,'source_document_ids',source_document_ids,'source_document_line_ids',source_document_line_ids
    ) ORDER BY loan_ref,lender_ref,currency,account_code) FROM exact),'[]'::jsonb),
    COALESCE((SELECT jsonb_agg(jsonb_build_object(
      'ledger_line_id',ledger_line_id,'journal_entry_id',journal_entry_id,'journal_line_id',journal_line_id,'journal_number',journal_number,
      'journal_date',to_char(journal_date,'YYYY-MM-DD'),'currency',currency,'account_code',account_code,
      'debit_amount',debit_amount::text,'credit_amount',credit_amount::text,'source_binding_status',source_binding_status,
      'source_document_ids',source_document_ids,'source_document_line_ids',source_document_line_ids
    ) ORDER BY journal_date,journal_entry_id,journal_line_id) FROM classified WHERE source_binding_status<>'EXACT_POSTED_LOAN_SOURCE'),'[]'::jsonb),
    (SELECT count(*) FROM classified WHERE source_binding_status='EXACT_POSTED_LOAN_SOURCE')::integer,
    (SELECT count(*) FROM classified WHERE source_binding_status<>'EXACT_POSTED_LOAN_SOURCE')::integer
  INTO register_rows,blocked_rows,exact_count,blocked_count;

  RETURN jsonb_build_object(
    'schema_version','CONSTRUCTION_LOAN_REGISTER_V1','entity_id',p_entity,'period_id',p_period,
    'period_code',period_row.period_code,'period_start',to_char(period_row.starts_on,'YYYY-MM-DD'),'period_end',to_char(period_row.ends_on,'YYYY-MM-DD'),
    'rows',register_rows,'blocked_lines',blocked_rows,'exact_ledger_line_count',exact_count,'blocked_ledger_line_count',blocked_count,
    'action_flags',jsonb_build_object('can_create_loan',false,'can_record_draw',false,'can_record_repayment',false,'can_post',false)
  );
END;$$;
REVOKE ALL ON FUNCTION refs_read_construction_loan_register(uuid,uuid,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION refs_read_construction_loan_register(uuid,uuid,uuid) TO refs_app;

COMMIT;
