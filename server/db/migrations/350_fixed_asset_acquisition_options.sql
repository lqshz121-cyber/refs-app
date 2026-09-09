BEGIN;
CREATE FUNCTION refs_read_fixed_asset_acquisition_options(p_tenant uuid,p_entity uuid,p_asset uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE asset fixed_asset_register_evidence; proposal ai_invoice_capitalization_proposal;
 document source_document; line source_document_line; period accounting_period;
 original wbs_payable_original_row_evidence; attachments jsonb; attachment_status text;
BEGIN
 PERFORM refs_assert_scope(p_tenant,p_entity,'GL.JE.CREATE');
 SELECT * INTO asset FROM fixed_asset_register_evidence WHERE tenant_id=p_tenant AND entity_id=p_entity AND fixed_asset_register_evidence_id=p_asset;
 IF NOT FOUND THEN RAISE EXCEPTION 'Scoped acquisition asset missing' USING ERRCODE='P0002';END IF;
 SELECT * INTO proposal FROM ai_invoice_capitalization_proposal WHERE tenant_id=p_tenant AND entity_id=p_entity AND ai_invoice_capitalization_proposal_id=asset.capitalization_proposal_id;
 IF NOT FOUND THEN RAISE EXCEPTION 'Scoped acquisition proposal missing' USING ERRCODE='P0002';END IF;
 SELECT * INTO document FROM source_document WHERE tenant_id=p_tenant AND entity_id=p_entity AND source_document_id=proposal.source_document_id;
 IF NOT FOUND THEN RAISE EXCEPTION 'Scoped acquisition source missing' USING ERRCODE='P0002';END IF;
 SELECT * INTO line FROM source_document_line WHERE tenant_id=p_tenant AND entity_id=p_entity AND source_document_id=document.source_document_id AND source_document_line_id=proposal.source_document_line_id;
 IF NOT FOUND THEN RAISE EXCEPTION 'Scoped acquisition source line missing' USING ERRCODE='P0002';END IF;
 SELECT * INTO period FROM accounting_period WHERE tenant_id=p_tenant AND entity_id=p_entity AND period_id=proposal.accounting_period_id AND ledger_code='PRIMARY';
 IF NOT FOUND THEN RAISE EXCEPTION 'Scoped acquisition period missing' USING ERRCODE='P0002';END IF;
 SELECT * INTO original FROM wbs_payable_original_row_evidence WHERE tenant_id=p_tenant AND entity_id=p_entity AND source_document_id=document.source_document_id AND source_document_line_id=line.source_document_line_id;
 -- No raw payload, object storage coordinates or mutation capability is returned.
 SELECT coalesce(jsonb_agg(jsonb_build_object('attachment_id',a.attachment_id,'name',a.name) ORDER BY a.attachment_id),'[]'::jsonb) INTO attachments
 FROM (SELECT a.attachment_id,a.name FROM attachment a WHERE a.tenant_id=p_tenant AND a.entity_id=p_entity AND EXISTS(
  SELECT 1 FROM source_link sl WHERE sl.tenant_id=p_tenant AND sl.entity_id=p_entity AND sl.source_document_id=document.source_document_id AND sl.link_type='SOURCE_ATTACHMENT' AND sl.attachment_id=a.attachment_id)
  ORDER BY a.attachment_id LIMIT 26) a;
 attachment_status:=CASE WHEN jsonb_array_length(attachments)=0 THEN 'MISSING' WHEN jsonb_array_length(attachments)>25 THEN 'TOO_MANY' WHEN refs_asset_acquisition_attachment_snapshot(p_tenant,p_entity,document.source_document_id) IS NULL THEN 'UNVERIFIED' ELSE 'VERIFIED' END;
 BEGIN
  PERFORM refs_check_asset_attachment_document_history(p_tenant,p_entity,document.source_document_id);
 EXCEPTION WHEN object_in_use THEN attachment_status:='AMBIGUOUS';
 END;
 RETURN jsonb_build_object('schema_version','FIXED_ASSET_ACQUISITION_OPTIONS_V1','tenant_id',p_tenant,'entity_id',p_entity,'asset_id',p_asset,
  'asset_tag',asset.asset_tag,'asset_status',asset.status,'currency',asset.currency,'cost_basis',asset.cost_basis::text,
  'asset_account_code',asset.asset_account_code,'liability_account_code',proposal.liability_account_code,'vendor_ref',line.party_ref,
  'period',jsonb_build_object('period_id',period.period_id,'period_code',period.period_code,'starts_on',period.starts_on,'ends_on',period.ends_on,'status',period.status),
  'source',jsonb_build_object('source_document_id',document.source_document_id,'source_document_version',document.version,'source_payload_hash',document.payload_hash,'accounting_date',document.accounting_date,'document_no',document.document_no),
  'original_evidence',CASE WHEN original.evidence_id IS NULL THEN NULL ELSE jsonb_build_object('evidence_id',original.evidence_id,'evidence_hash',original.evidence_hash) END,
  'attachments',attachments,'attachment_status',attachment_status,
  'acquisition_posted',EXISTS(SELECT 1 FROM fixed_asset_acquisition_posting WHERE tenant_id=p_tenant AND entity_id=p_entity AND asset_id=p_asset),
  'disposal_recorded',EXISTS(SELECT 1 FROM fixed_asset_disposal_evidence WHERE tenant_id=p_tenant AND entity_id=p_entity AND fixed_asset_register_evidence_id=p_asset)
    OR EXISTS(SELECT 1 FROM fixed_asset_disposal_posting WHERE tenant_id=p_tenant AND entity_id=p_entity AND fixed_asset_register_evidence_id=p_asset),
  'requires_command_validation',true);
END;$$;
REVOKE ALL ON FUNCTION refs_read_fixed_asset_acquisition_options(uuid,uuid,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION refs_read_fixed_asset_acquisition_options(uuid,uuid,uuid) TO refs_app;
COMMIT;
