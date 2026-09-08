BEGIN;

-- One read-only projection for the complete retained Stage 1 Payable chain.
-- It exposes hashes and opaque object versions, never storage locations or raw
-- provider payloads. An incomplete or drifted chain is indistinguishable from
-- a missing record to the caller.
CREATE FUNCTION refs_read_wbs_payable_acceptance_evidence(
  p_tenant uuid,p_entity uuid,p_review uuid
) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE result jsonb;
BEGIN
  PERFORM public.refs_assert_scope(p_tenant,p_entity,'WBS.AUTOREC.VIEW');
  PERFORM public.refs_assert_scope(p_tenant,p_entity,'AP.VIEW');
  IF p_review IS NULL THEN RAISE EXCEPTION 'Review evidence identifier is required' USING ERRCODE='22004'; END IF;

  SELECT jsonb_build_object(
    'schema_version','WBS_PAYABLE_ACCEPTANCE_EVIDENCE_V1',
    'scope',jsonb_build_object('tenant_id',p_tenant,'entity_id',p_entity,'period_id',e.period_id),
    'source',jsonb_build_object(
      'wbs_inbound_row_id',e.wbs_inbound_row_id,'source_record_id',r.source_record_id,
      'source_version',e.source_version,'receipt_hash',e.receipt_hash,
      'provider_receipt_hash',sr.receipt_hash,'evidence_hash',e.evidence_hash,
      'source_document_id',e.source_document_id,'environment',imp.environment,
      'source_module',sr.source_module,'ingestion_kind',sr.ingestion_kind,
      'provider_signed_payable_admission_id',pa.wbs_provider_signed_payable_admission_id,
      'signature_issuer',pa.issuer,'signature_key_id',pa.key_id,'signature_algorithm',pa.algorithm,
      'signed_package_hash',pa.package_hash,'signed_receipt_hash',pa.receipt_hash,'signed_at',pa.signed_at),
    'review',jsonb_build_object(
      'review_evidence_id',e.wbs_payable_review_evidence_id,'reviewed_by',e.reviewed_by,
      'reviewed_at',e.reviewed_at,'attachment_ids',d.attachment_ids),
    'attachments',att.items,
    'draft',jsonb_build_object(
      'draft_evidence_id',d.wbs_payable_draft_evidence_id,'business_document_id',d.business_document_id,
      'journal_entry_id',d.journal_entry_id,'created_by',d.created_by,'created_at',d.created_at),
    'business_document',jsonb_build_object(
      'business_document_id',bd.business_document_id,'source_document_id',bd.source_document_id,
      'document_kind',bd.document_kind,'currency',bd.currency,
      'gross_amount',to_char(bd.gross_amount,'FM9999999999999990.0000'),
      'open_balance',to_char(bd.open_balance,'FM9999999999999990.0000'),
      'status',bd.status,'posted_journal_entry_id',bd.posted_journal_entry_id,
      'counterparty_ref',bd.counterparty_ref,'counterparty_name',bd.counterparty_name),
    'journal',jsonb_build_object(
      'journal_entry_id',j.journal_entry_id,'status',j.status,'revision',j.revision,
      'created_by',j.created_by,'reviewed_by',j.reviewed_by,'approved_by',j.approved_by,
      'posted_by',j.posted_by,'posted_at',j.posted_at)
  ) INTO result
  FROM public.wbs_payable_review_evidence e
  JOIN public.wbs_inbound_row r
    ON (r.tenant_id,r.entity_id,r.wbs_inbound_row_id)=(e.tenant_id,e.entity_id,e.wbs_inbound_row_id)
   AND r.receipt_id=e.receipt_id AND r.source_version=e.source_version
  JOIN public.wbs_inbound_receipt ir
    ON (ir.tenant_id,ir.entity_id,ir.receipt_id)=(e.tenant_id,e.entity_id,e.receipt_id)
   AND ir.receipt_hash=e.receipt_hash
  JOIN public.wbs_snapshot_import imp
    ON (imp.tenant_id,imp.entity_id,imp.wbs_snapshot_import_id)=(e.tenant_id,e.entity_id,e.wbs_snapshot_import_id)
   AND imp.import_batch_id=ir.import_batch_id AND imp.environment='PRODUCTION'
  JOIN public.wbs_snapshot_receipt sr
    ON (sr.tenant_id,sr.entity_id,sr.wbs_snapshot_receipt_id)=(e.tenant_id,e.entity_id,e.wbs_snapshot_receipt_id)
   AND sr.wbs_snapshot_import_id=e.wbs_snapshot_import_id AND sr.source_module='BGDATA.payable'
   AND sr.ingestion_kind='TRANSACTION_CANDIDATE' AND sr.source_record_id=r.source_record_id
   AND sr.source_version=e.source_version AND sr.payload_hash=e.receipt_hash
  JOIN public.wbs_provider_signed_payable_admission pa
    ON (pa.tenant_id,pa.entity_id,pa.wbs_snapshot_import_id)=
       (e.tenant_id,e.entity_id,e.wbs_snapshot_import_id)
   AND pa.import_batch_id=ir.import_batch_id AND pa.snapshot_id=imp.snapshot_id
   AND pa.package_hash=imp.package_hash AND pa.algorithm='Ed25519'
  JOIN public.wbs_payable_draft_evidence d
    ON (d.tenant_id,d.entity_id,d.wbs_payable_review_evidence_id)=(e.tenant_id,e.entity_id,e.wbs_payable_review_evidence_id)
   AND (d.wbs_inbound_row_id,d.source_document_id,d.staging_item_id,d.mapping_snapshot_id)=
       (e.wbs_inbound_row_id,e.source_document_id,e.staging_item_id,e.mapping_snapshot_id)
   AND d.expected_evidence_hash=e.evidence_hash
  JOIN public.business_document bd
    ON (bd.tenant_id,bd.entity_id,bd.business_document_id)=(d.tenant_id,d.entity_id,d.business_document_id)
   AND bd.source_document_id=d.source_document_id AND bd.document_kind='AP_BILL'
   AND bd.posted_journal_entry_id=d.journal_entry_id
  JOIN public.journal_entry j
    ON (j.tenant_id,j.entity_id,j.period_id,j.journal_entry_id)=(e.tenant_id,e.entity_id,e.period_id,d.journal_entry_id)
  CROSS JOIN LATERAL (
    SELECT count(*)::integer AS item_count,
      coalesce(jsonb_agg(jsonb_build_object(
        'attachment_id',a.attachment_id,'content_hash',a.content_hash,'storage_version',a.storage_version,
        'finalization_status',a.finalization_status,'scan_status',a.scan_status,
        'verified_at',a.verified_at,'bound_by',b.bound_by
      ) ORDER BY a.attachment_id),'[]'::jsonb) AS items,
      array_agg(a.attachment_id ORDER BY a.attachment_id) AS attachment_ids
    FROM public.wbs_payable_review_attachment ra
    JOIN public.wbs_payable_attachment_binding b
      ON (b.tenant_id,b.entity_id,b.wbs_inbound_row_id,b.attachment_id)=
         (e.tenant_id,e.entity_id,e.wbs_inbound_row_id,ra.attachment_id)
     AND b.source_version=e.source_version AND b.receipt_hash=e.receipt_hash
     AND b.provider_receipt_hash=sr.receipt_hash AND b.evidence_hash=e.evidence_hash
     AND b.receipt_id=e.receipt_id AND b.wbs_snapshot_import_id=e.wbs_snapshot_import_id
     AND b.wbs_snapshot_receipt_id=e.wbs_snapshot_receipt_id
    JOIN public.attachment a
      ON (a.tenant_id,a.attachment_id)=(b.tenant_id,b.attachment_id)
     AND a.content_hash=b.attachment_content_hash AND a.storage_version=b.attachment_storage_version
     AND a.finalization_status='VERIFIED_CLEAN' AND a.scan_status='CLEAN'
     AND a.verified_at IS NOT NULL AND a.finalized_at IS NOT NULL
    WHERE (ra.tenant_id,ra.entity_id,ra.wbs_payable_review_evidence_id)=
          (e.tenant_id,e.entity_id,e.wbs_payable_review_evidence_id)
  ) att
  WHERE e.tenant_id=p_tenant AND e.entity_id=p_entity AND e.wbs_payable_review_evidence_id=p_review
    AND j.status='POSTED' AND j.posted_at IS NOT NULL
    AND j.created_by<>j.reviewed_by AND j.created_by<>j.approved_by AND j.created_by<>j.posted_by
    AND j.reviewed_by<>j.approved_by AND j.reviewed_by<>j.posted_by AND j.approved_by<>j.posted_by
    AND e.reviewed_by<>j.created_by
    AND att.item_count>0 AND att.item_count=cardinality(d.attachment_ids)
    AND att.attachment_ids=ARRAY(SELECT value FROM unnest(d.attachment_ids) value ORDER BY value);

  IF result IS NULL THEN
    RAISE EXCEPTION 'Complete retained WBS Payable acceptance evidence was not found' USING ERRCODE='P0002';
  END IF;
  RETURN result;
END;
$$;

REVOKE ALL ON FUNCTION refs_read_wbs_payable_acceptance_evidence(uuid,uuid,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION refs_read_wbs_payable_acceptance_evidence(uuid,uuid,uuid) TO refs_app;

COMMIT;
