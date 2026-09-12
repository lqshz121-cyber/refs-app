BEGIN;
-- Source documents are born at version 0. Keep the immutable acquisition
-- binding and its command CAS aligned with source_document.version.
ALTER TABLE fixed_asset_acquisition_binding
  DROP CONSTRAINT fixed_asset_acquisition_binding_source_document_version_check;
ALTER TABLE fixed_asset_acquisition_binding
  ADD CONSTRAINT fixed_asset_acquisition_binding_source_document_version_check
  CHECK (source_document_version >= 0);

CREATE OR REPLACE FUNCTION refs_create_fixed_asset_acquisition(p_tenant uuid,p_entity uuid,p_asset uuid,p_period uuid,p_number text,p_date date,p_source_version bigint,p_attachments uuid[],p_reason text,p_key text,p_hash text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE actor text:=refs_current_actor(); asset fixed_asset_register_evidence; proposal ai_invoice_capitalization_proposal;
 source source_document; source_line source_document_line; idem idempotency_receipt; lines jsonb; dims jsonb;
 result jsonb; journal_id uuid; link_id uuid:=gen_random_uuid(); binding uuid:=gen_random_uuid(); payload jsonb; inner_hash text; source_attachments uuid[]; attachment_hash text;
BEGIN
 PERFORM refs_assert_scope(p_tenant,p_entity,'FIXED_ASSET.ACQUISITION.DRAFT');
 PERFORM refs_assert_scope(p_tenant,p_entity,'GL.JE.CREATE');
 IF actor IS NULL OR p_source_version IS NULL OR p_source_version<0 OR p_date IS NULL OR length(btrim(coalesce(p_number,''))) NOT BETWEEN 1 AND 100 OR length(btrim(coalesce(p_reason,''))) NOT BETWEEN 8 AND 2000
 OR p_hash IS DISTINCT FROM refs_create_fixed_asset_acquisition_hash(p_tenant,p_entity,p_asset,p_period,p_number,p_date,p_source_version,p_attachments,p_reason) THEN RAISE EXCEPTION 'Invalid acquisition command' USING ERRCODE='22023';END IF;
 INSERT INTO idempotency_receipt(tenant_id,operation_scope,idempotency_key,request_hash,status,actor_id)
 VALUES(p_tenant,'FIXED_ASSET_ACQUISITION:'||p_entity,p_key,p_hash,'IN_PROGRESS',actor)
 ON CONFLICT(tenant_id,operation_scope,idempotency_key) DO NOTHING;
 SELECT * INTO idem FROM idempotency_receipt WHERE tenant_id=p_tenant AND operation_scope='FIXED_ASSET_ACQUISITION:'||p_entity AND idempotency_key=p_key FOR UPDATE;
 IF idem.actor_id IS DISTINCT FROM actor OR idem.request_hash IS DISTINCT FROM p_hash THEN RAISE EXCEPTION 'Acquisition idempotency conflict' USING ERRCODE='23505';END IF;
 IF idem.status='SUCCEEDED' THEN RETURN idem.response_body||jsonb_build_object('idempotent',true);END IF;
 SELECT * INTO asset FROM fixed_asset_register_evidence WHERE tenant_id=p_tenant AND entity_id=p_entity AND fixed_asset_register_evidence_id=p_asset FOR UPDATE;
 IF NOT FOUND OR asset.status<>'ACTIVE' THEN RAISE EXCEPTION 'Active scoped asset missing' USING ERRCODE='23503';END IF;
 IF EXISTS(SELECT 1 FROM fixed_asset_acquisition_posting WHERE tenant_id=p_tenant AND entity_id=p_entity AND asset_id=p_asset)
 OR EXISTS(SELECT 1 FROM fixed_asset_disposal_posting WHERE tenant_id=p_tenant AND entity_id=p_entity AND fixed_asset_register_evidence_id=p_asset)
 OR EXISTS(SELECT 1 FROM fixed_asset_disposal_evidence WHERE tenant_id=p_tenant AND entity_id=p_entity AND fixed_asset_register_evidence_id=p_asset) THEN RAISE EXCEPTION 'Asset is already acquired or disposed' USING ERRCODE='23514';END IF;
 SELECT * INTO proposal FROM ai_invoice_capitalization_proposal WHERE tenant_id=p_tenant AND entity_id=p_entity AND ai_invoice_capitalization_proposal_id=asset.capitalization_proposal_id FOR SHARE;
 IF NOT FOUND OR proposal.accounting_period_id IS DISTINCT FROM p_period OR proposal.capitalization_treatment<>'FIXED_ASSET' OR proposal.amount<>asset.cost_basis OR proposal.currency<>asset.currency OR proposal.asset_account_code<>asset.asset_account_code OR proposal.source_document_id<>asset.source_document_id OR proposal.source_payload_hash<>asset.source_payload_hash THEN RAISE EXCEPTION 'Capitalization evidence differs from asset' USING ERRCODE='23514';END IF;
 SELECT * INTO source FROM source_document WHERE tenant_id=p_tenant AND entity_id=p_entity AND source_document_id=asset.source_document_id FOR UPDATE;
 IF NOT FOUND OR source.version<>p_source_version OR source.payload_hash<>asset.source_payload_hash OR source.currency<>asset.currency OR source.status NOT IN('READY_FOR_DRAFT','DRAFT_CREATED','PENDING_JE_REVIEW','PENDING_JE_APPROVAL','APPROVED','POSTED') THEN RAISE EXCEPTION 'Acquisition source changed' USING ERRCODE='40001';END IF;
 SELECT * INTO source_line FROM source_document_line WHERE tenant_id=p_tenant AND entity_id=p_entity AND source_document_id=source.source_document_id AND source_document_line_id=proposal.source_document_line_id FOR UPDATE;
 IF NOT FOUND OR source_line.amount<>asset.cost_basis THEN RAISE EXCEPTION 'Acquisition source line amount differs' USING ERRCODE='23514';END IF;
 PERFORM refs_serialize_asset_source(p_tenant,p_entity,source.source_document_id);
 IF EXISTS(SELECT 1 FROM source_link sl JOIN journal_entry j ON j.tenant_id=sl.tenant_id AND j.entity_id=sl.entity_id AND j.journal_entry_id=sl.journal_entry_id AND j.status='POSTED' WHERE sl.tenant_id=p_tenant AND sl.entity_id=p_entity AND (sl.source_document_line_id=source_line.source_document_line_id OR (sl.source_document_id=source.source_document_id AND sl.source_document_line_id IS NULL)) AND sl.link_type='SOURCE_TO_JE') THEN RAISE EXCEPTION 'Acquisition source is already accounted for' USING ERRCODE='23514';END IF;
 PERFORM 1 FROM attachment a JOIN source_link sl ON sl.tenant_id=a.tenant_id AND sl.entity_id=a.entity_id AND sl.attachment_id=a.attachment_id WHERE sl.tenant_id=p_tenant AND sl.entity_id=p_entity AND sl.source_document_id=source.source_document_id AND sl.link_type='SOURCE_ATTACHMENT' FOR SHARE OF a;
 SELECT array_agg(DISTINCT attachment_id ORDER BY attachment_id) INTO source_attachments FROM source_link WHERE tenant_id=p_tenant AND entity_id=p_entity AND source_document_id=source.source_document_id AND link_type='SOURCE_ATTACHMENT';
 attachment_hash:=refs_asset_acquisition_attachment_snapshot(p_tenant,p_entity,source.source_document_id);
 IF attachment_hash IS NULL OR source_attachments IS DISTINCT FROM ARRAY(SELECT x FROM unnest(p_attachments) x ORDER BY x) THEN RAISE EXCEPTION 'Acquisition attachments must exactly match verified source attachments' USING ERRCODE='23514';END IF;
 PERFORM 1 FROM member_master WHERE tenant_id=p_tenant AND entity_id=p_entity AND member_ref=source_line.party_ref AND member_type='VENDOR' AND active FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Acquisition requires a source-bound active vendor' USING ERRCODE='23503';END IF;
 dims:=jsonb_build_object('fixed_asset_register_evidence_id',p_asset,'project_ref',source_line.project_ref,'property_ref',source_line.property_ref);
 lines:=jsonb_build_array(jsonb_build_object('line_no',1,'account_code',asset.asset_account_code,'debit_amount',asset.cost_basis,'credit_amount',0,'member_ref',NULL,'dimensions',dims),jsonb_build_object('line_no',2,'account_code',proposal.liability_account_code,'debit_amount',0,'credit_amount',asset.cost_basis,'member_ref',source_line.party_ref,'dimensions',dims));
 inner_hash:=refs_create_manual_journal_hash(p_tenant,p_entity,p_period,p_number,p_date,asset.currency,btrim(p_reason),lines,p_attachments);
 result:=refs_create_manual_journal(p_tenant,p_entity,p_period,p_number,p_date,asset.currency,btrim(p_reason),lines,p_attachments,'asset-acquisition:'||binding,inner_hash);
 journal_id:=(result->>'journal_entry_id')::uuid;
 INSERT INTO source_link(source_link_id,tenant_id,entity_id,link_type,source_document_id,source_document_line_id,journal_entry_id,created_by) VALUES(link_id,p_tenant,p_entity,'SOURCE_TO_JE',source.source_document_id,source_line.source_document_line_id,journal_id,actor);
 INSERT INTO fixed_asset_acquisition_binding(binding_id,tenant_id,entity_id,asset_id,journal_entry_id,source_document_id,source_document_version,source_payload_hash,source_document_line_id,source_line_snapshot_hash,source_link_id,journal_snapshot_hash,created_by,attachment_ids,attachment_snapshot_hash)
 VALUES(binding,p_tenant,p_entity,p_asset,journal_id,source.source_document_id,source.version,source.payload_hash,source_line.source_document_line_id,refs_jsonb_hash(to_jsonb(source_line)),link_id,refs_asset_acquisition_journal_snapshot(p_tenant,p_entity,journal_id),actor,source_attachments,attachment_hash);
 payload:=result||jsonb_build_object('schema_version','FIXED_ASSET_ACQUISITION_DRAFT_V1','binding_id',binding,'asset_id',p_asset,'source_document_id',source.source_document_id,'source_document_version',source.version,'source_payload_hash',source.payload_hash,'source_link_id',link_id);
 INSERT INTO audit_event(tenant_id,entity_id,event_type,object_type,object_id,action,actor_id,actor_type,permission_used,request_id,correlation_id,idempotency_key,after_hash,reason,metadata) VALUES(p_tenant,p_entity,'FIXED_ASSET_ACQUISITION_DRAFT_CREATED','JOURNAL_ENTRY',journal_id,'CREATE',actor,'USER','FIXED_ASSET.ACQUISITION.DRAFT',p_key,p_key,p_key,p_hash,btrim(p_reason),payload);
 INSERT INTO outbox_event(tenant_id,entity_id,aggregate_type,aggregate_id,event_type,payload,payload_hash) VALUES(p_tenant,p_entity,'JOURNAL_ENTRY',journal_id,'FIXED_ASSET_ACQUISITION_DRAFT_CREATED',payload,refs_jsonb_hash(payload));
 UPDATE idempotency_receipt SET status='SUCCEEDED',response_status=201,response_body=payload,completed_at=clock_timestamp() WHERE idempotency_receipt_id=idem.idempotency_receipt_id;
 RETURN payload;
END;$$;
COMMIT;
