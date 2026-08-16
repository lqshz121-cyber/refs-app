BEGIN;

CREATE OR REPLACE FUNCTION refs_get_wbs_autorec_match_review(p_tenant uuid,p_entity uuid,p_review uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE review_row wbs_autorec_match_review; completed boolean:=false; result jsonb;
BEGIN
  PERFORM refs_assert_scope(p_tenant,p_entity,'WBS.AUTOREC.VIEW');
  SELECT * INTO review_row FROM wbs_autorec_match_review r
    WHERE r.tenant_id=p_tenant AND r.entity_id=p_entity AND r.wbs_autorec_match_review_id=p_review;
  IF NOT FOUND THEN RAISE EXCEPTION 'AutoRec Bank Match review was not found in the selected entity' USING ERRCODE='P0002'; END IF;

  SELECT EXISTS(
    SELECT 1
    FROM wbs_autorec_g11_completion c
    JOIN wbs_autorec_execution_event release
      ON release.execution_receipt_id=c.release_execution_receipt_id
     AND release.tenant_id=c.tenant_id AND release.entity_id=c.entity_id
     AND release.review_candidate_id=review_row.review_candidate_id
     AND release.version=c.release_execution_version
     AND release.command='RELEASE' AND release.current_state='RESERVED' AND release.next_state='RELEASED'
    JOIN wbs_autorec_execution_event incur
      ON incur.execution_receipt_id=c.incur_execution_receipt_id
     AND incur.tenant_id=c.tenant_id AND incur.entity_id=c.entity_id
     AND incur.review_candidate_id=review_row.review_candidate_id
     AND incur.version=c.incur_execution_version
     AND incur.version=release.version+1
     AND incur.command='INCUR' AND incur.current_state='RELEASED' AND incur.next_state='INCURRED'
    JOIN accounting_event payable_event
      ON payable_event.tenant_id=c.tenant_id AND payable_event.entity_id=c.entity_id
     AND payable_event.accounting_event_id=c.payable_incur_accounting_event_id
     AND payable_event.wbs_autorec_match_review_id=c.wbs_autorec_match_review_id
     AND payable_event.event_type='PAYABLE_INCUR'
    JOIN accounting_event autoc_event
      ON autoc_event.tenant_id=c.tenant_id AND autoc_event.entity_id=c.entity_id
     AND autoc_event.accounting_event_id=c.autoc_accounting_event_id
     AND autoc_event.wbs_autorec_match_review_id=c.wbs_autorec_match_review_id
     AND autoc_event.event_type='AUTOC'
    JOIN journal_accounting_event payable_binding
      ON payable_binding.tenant_id=c.tenant_id AND payable_binding.entity_id=c.entity_id
     AND payable_binding.accounting_event_id=payable_event.accounting_event_id
     AND payable_binding.journal_entry_id=c.payable_incur_journal_entry_id
    JOIN journal_accounting_event autoc_binding
      ON autoc_binding.tenant_id=c.tenant_id AND autoc_binding.entity_id=c.entity_id
     AND autoc_binding.accounting_event_id=autoc_event.accounting_event_id
     AND autoc_binding.journal_entry_id=c.autoc_journal_entry_id
    JOIN journal_entry payable_journal
      ON payable_journal.tenant_id=c.tenant_id AND payable_journal.entity_id=c.entity_id
     AND payable_journal.journal_entry_id=c.payable_incur_journal_entry_id
     AND payable_journal.journal_type='AUTO' AND payable_journal.status='POSTED'
    JOIN journal_entry autoc_journal
      ON autoc_journal.tenant_id=c.tenant_id AND autoc_journal.entity_id=c.entity_id
     AND autoc_journal.journal_entry_id=c.autoc_journal_entry_id
     AND autoc_journal.journal_type='AUTO' AND autoc_journal.status='POSTED'
    JOIN posting_batch payable_batch
      ON payable_batch.tenant_id=c.tenant_id AND payable_batch.entity_id=c.entity_id
     AND payable_batch.posting_batch_id=c.payable_incur_posting_batch_id
    JOIN posting_batch autoc_batch
      ON autoc_batch.tenant_id=c.tenant_id AND autoc_batch.entity_id=c.entity_id
     AND autoc_batch.posting_batch_id=c.autoc_posting_batch_id
    WHERE c.tenant_id=p_tenant AND c.entity_id=p_entity
      AND c.wbs_autorec_match_review_id=p_review AND review_row.decision='ACCEPTED'
      AND refs_jsonb_hash(release.intent->'review_candidate')=review_row.candidate_hash
      AND refs_jsonb_hash(incur.intent->'review_candidate')=review_row.candidate_hash
      AND incur.intent->>'wbs_autorec_match_review_id'=p_review::text
      AND incur.intent->>'payable_incur_accounting_event_id'=c.payable_incur_accounting_event_id::text
      AND incur.intent->>'autoc_accounting_event_id'=c.autoc_accounting_event_id::text
      AND incur.intent->>'payable_incur_journal_entry_id'=c.payable_incur_journal_entry_id::text
      AND incur.intent->>'autoc_journal_entry_id'=c.autoc_journal_entry_id::text
      AND incur.intent->>'g11_evidence_hash'=c.evidence_hash
      AND incur.request_hash=c.request_hash AND incur.idempotency_key=c.idempotency_key
      AND c.evidence_hash=refs_jsonb_hash(jsonb_build_object(
        'review_id',p_review,'review_evidence_hash',review_row.evidence_hash,
        'release_receipt_id',release.execution_receipt_id,'release_version',release.version,
        'payable_event_id',payable_event.accounting_event_id,'autoc_event_id',autoc_event.accounting_event_id,
        'mapping_snapshot_id',payable_event.mapping_snapshot_id,'mapping_snapshot_hash',payable_event.mapping_snapshot_hash,
        'payable_source_document_id',payable_event.source_document_id,'payable_staging_item_id',payable_event.staging_item_id,
        'autoc_source_document_id',autoc_event.source_document_id,'autoc_staging_item_id',autoc_event.staging_item_id,
        'payable_journal_id',payable_journal.journal_entry_id,'autoc_journal_id',autoc_journal.journal_entry_id,
        'payable_batch_id',payable_batch.posting_batch_id,'autoc_batch_id',autoc_batch.posting_batch_id,
        'lines',(SELECT jsonb_agg(jsonb_build_object(
          'event_type',line.event_type,'accounting_event_id',line.accounting_event_id,
          'source_document_id',CASE line.event_type WHEN 'PAYABLE_INCUR' THEN payable_event.source_document_id ELSE autoc_event.source_document_id END,
          'staging_item_id',CASE line.event_type WHEN 'PAYABLE_INCUR' THEN payable_event.staging_item_id ELSE autoc_event.staging_item_id END,
          'journal_entry_id',line.journal_entry_id,'posting_batch_id',line.posting_batch_id,
          'journal_line_id',line.journal_line_id,'ledger_line_id',line.ledger_line_id,
          'line_role',line.line_role,'account_code',line.account_code,
          'debit_amount',to_char(line.debit_amount,'FM999999999999990.0000'),
          'credit_amount',to_char(line.credit_amount,'FM999999999999990.0000'),'member_ref',line.member_ref)
          ORDER BY line.event_type,line.line_role)
          FROM wbs_autorec_g11_completion_line line
          WHERE line.tenant_id=c.tenant_id AND line.entity_id=c.entity_id
            AND line.wbs_autorec_g11_completion_id=c.wbs_autorec_g11_completion_id)))
      AND autoc_event.mapping_snapshot_id=payable_event.mapping_snapshot_id
      AND autoc_event.mapping_snapshot_hash=payable_event.mapping_snapshot_hash
      AND incur.version=(SELECT max(latest.version) FROM wbs_autorec_execution_event latest
        WHERE latest.tenant_id=p_tenant AND latest.entity_id=p_entity
          AND latest.review_candidate_id=review_row.review_candidate_id)
      AND 4=(SELECT count(*) FROM wbs_autorec_g11_completion_line line
        JOIN journal_line journal_line
          ON journal_line.tenant_id=line.tenant_id AND journal_line.entity_id=line.entity_id
         AND journal_line.journal_entry_id=line.journal_entry_id AND journal_line.journal_line_id=line.journal_line_id
        JOIN ledger_line ledger_line
          ON ledger_line.tenant_id=line.tenant_id AND ledger_line.entity_id=line.entity_id
         AND ledger_line.journal_entry_id=line.journal_entry_id AND ledger_line.journal_line_id=line.journal_line_id
         AND ledger_line.ledger_line_id=line.ledger_line_id AND ledger_line.posting_batch_id=line.posting_batch_id
         AND ledger_line.account_code=line.account_code AND ledger_line.debit_amount=line.debit_amount
         AND ledger_line.credit_amount=line.credit_amount AND ledger_line.member_ref IS NOT DISTINCT FROM line.member_ref
        WHERE line.tenant_id=c.tenant_id AND line.entity_id=c.entity_id
          AND line.wbs_autorec_g11_completion_id=c.wbs_autorec_g11_completion_id
          AND journal_line.account_code=line.account_code AND journal_line.debit_amount=line.debit_amount
          AND journal_line.credit_amount=line.credit_amount AND journal_line.member_ref IS NOT DISTINCT FROM line.member_ref
          AND ((line.event_type='PAYABLE_INCUR' AND line.accounting_event_id=c.payable_incur_accounting_event_id
                AND line.journal_entry_id=c.payable_incur_journal_entry_id AND line.posting_batch_id=c.payable_incur_posting_batch_id)
            OR (line.event_type='AUTOC' AND line.accounting_event_id=c.autoc_accounting_event_id
                AND line.journal_entry_id=c.autoc_journal_entry_id AND line.posting_batch_id=c.autoc_posting_batch_id)))
  ) INTO completed;

  result:=jsonb_build_object(
    'wbs_autorec_match_review_id',review_row.wbs_autorec_match_review_id,'tenant_id',review_row.tenant_id,'entity_id',review_row.entity_id,
    'review_candidate_id',review_row.review_candidate_id,'candidate_hash',review_row.candidate_hash,
    'candidate_execution_receipt_id',review_row.candidate_execution_receipt_id,'candidate_execution_version',review_row.candidate_execution_version,
    'bank_match_id',review_row.bank_match_id,'bank_match_revision',review_row.bank_match_revision,'evidence_hash',review_row.evidence_hash,
    'decision',review_row.decision,'decision_reason',review_row.decision_reason,'candidate_prepared_by',review_row.candidate_prepared_by,
    'matched_by',review_row.matched_by,'reviewed_by',review_row.reviewed_by,'reviewed_at',review_row.reviewed_at,
    'sod_verified',(review_row.reviewed_by<>review_row.matched_by AND review_row.reviewed_by<>review_row.candidate_prepared_by),
    'g11_linked',completed,'incurred',completed);
  RETURN result;
END $$;

CREATE OR REPLACE FUNCTION refs_get_wbs_autorec_g11_evidence(p_tenant uuid,p_entity uuid,p_review uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE result jsonb;
BEGIN
  PERFORM refs_assert_scope(p_tenant,p_entity,'WBS.AUTOREC.VIEW');
  SELECT jsonb_build_object('completion',to_jsonb(c),'review',to_jsonb(r),
    'released_candidate',jsonb_set(release.intent->'review_candidate','{allocated_amount}',
      to_jsonb(to_char((release.intent->'review_candidate'->>'allocated_amount')::numeric(20,4),'FM999999999999990.0000')),false),
    'incur_event',to_jsonb(incur),
    'accounting_events',(SELECT jsonb_agg(to_jsonb(ae)||jsonb_build_object(
      'amount',to_char(ae.amount,'FM999999999999990.0000')) ORDER BY ae.event_type)
      FROM accounting_event ae WHERE ae.tenant_id=c.tenant_id AND ae.entity_id=c.entity_id
        AND ae.wbs_autorec_match_review_id=c.wbs_autorec_match_review_id),
    'lines',(SELECT jsonb_agg(to_jsonb(line)||jsonb_build_object(
      'debit_amount',to_char(line.debit_amount,'FM999999999999990.0000'),
      'credit_amount',to_char(line.credit_amount,'FM999999999999990.0000')) ORDER BY line.event_type,line.line_role)
      FROM wbs_autorec_g11_completion_line line WHERE line.tenant_id=c.tenant_id AND line.entity_id=c.entity_id
        AND line.wbs_autorec_g11_completion_id=c.wbs_autorec_g11_completion_id),
    'g11_linked',true,'incurred',true) INTO result
  FROM wbs_autorec_g11_completion c JOIN wbs_autorec_match_review r USING(tenant_id,entity_id,wbs_autorec_match_review_id)
    JOIN wbs_autorec_execution_event release ON release.execution_receipt_id=c.release_execution_receipt_id
    JOIN wbs_autorec_execution_event incur ON incur.execution_receipt_id=c.incur_execution_receipt_id
  WHERE c.tenant_id=p_tenant AND c.entity_id=p_entity AND c.wbs_autorec_match_review_id=p_review
    AND incur.command='INCUR' AND incur.next_state='INCURRED';
  IF result IS NULL THEN RAISE EXCEPTION 'Completed G11 evidence was not found in the selected entity' USING ERRCODE='P0002'; END IF;
  RETURN result;
END $$;

REVOKE ALL ON FUNCTION refs_get_wbs_autorec_match_review(uuid,uuid,uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION refs_get_wbs_autorec_g11_evidence(uuid,uuid,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION refs_get_wbs_autorec_match_review(uuid,uuid,uuid) TO refs_app;
GRANT EXECUTE ON FUNCTION refs_get_wbs_autorec_g11_evidence(uuid,uuid,uuid) TO refs_app;

COMMIT;
