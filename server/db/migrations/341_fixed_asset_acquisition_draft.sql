BEGIN;

-- Retain one binding per Draft; abandoned Drafts do not consume the asset.
CREATE TABLE fixed_asset_acquisition_binding (
 binding_id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL, entity_id uuid NOT NULL,
 asset_id uuid NOT NULL REFERENCES fixed_asset_register_evidence, journal_entry_id uuid NOT NULL,
 source_document_id uuid NOT NULL, source_document_version bigint NOT NULL CHECK(source_document_version>0),
 source_payload_hash text NOT NULL, source_document_line_id uuid NOT NULL, source_line_snapshot_hash text NOT NULL,
 source_link_id uuid NOT NULL REFERENCES source_link, journal_snapshot_hash text NOT NULL,
 created_by text NOT NULL, created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 UNIQUE(tenant_id,entity_id,journal_entry_id),
 FOREIGN KEY(tenant_id,entity_id,journal_entry_id) REFERENCES journal_entry(tenant_id,entity_id,journal_entry_id),
 FOREIGN KEY(tenant_id,entity_id,source_document_id,source_document_line_id) REFERENCES source_document_line(tenant_id,entity_id,source_document_id,source_document_line_id)
);
ALTER TABLE fixed_asset_acquisition_binding ENABLE ROW LEVEL SECURITY;
CREATE POLICY fixed_asset_acquisition_binding_scope ON fixed_asset_acquisition_binding USING(tenant_id=refs_current_tenant() AND refs_entity_allowed(entity_id));
CREATE TRIGGER fixed_asset_acquisition_binding_immutable BEFORE UPDATE OR DELETE ON fixed_asset_acquisition_binding FOR EACH ROW EXECUTE FUNCTION reject_mutation();
CREATE TABLE fixed_asset_acquisition_posting (
 tenant_id uuid NOT NULL, entity_id uuid NOT NULL, asset_id uuid NOT NULL REFERENCES fixed_asset_register_evidence,
 binding_id uuid NOT NULL REFERENCES fixed_asset_acquisition_binding, journal_entry_id uuid NOT NULL,
 posted_by text NOT NULL, created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(tenant_id,entity_id,asset_id),
 FOREIGN KEY(tenant_id,entity_id,journal_entry_id) REFERENCES journal_entry(tenant_id,entity_id,journal_entry_id)
);
ALTER TABLE fixed_asset_acquisition_posting ENABLE ROW LEVEL SECURITY;
CREATE POLICY fixed_asset_acquisition_posting_scope ON fixed_asset_acquisition_posting USING(tenant_id=refs_current_tenant() AND refs_entity_allowed(entity_id));
CREATE TRIGGER fixed_asset_acquisition_posting_immutable BEFORE UPDATE OR DELETE ON fixed_asset_acquisition_posting FOR EACH ROW EXECUTE FUNCTION reject_mutation();
REVOKE ALL ON fixed_asset_acquisition_binding,fixed_asset_acquisition_posting FROM PUBLIC,refs_app;

CREATE FUNCTION refs_asset_acquisition_journal_snapshot(p_tenant uuid,p_entity uuid,p_journal uuid) RETURNS text
LANGUAGE sql STABLE SET search_path=pg_catalog,public,pg_temp AS $$
 SELECT refs_jsonb_hash(jsonb_build_object('period_id',j.period_id,'journal_date',j.journal_date,'currency',j.currency,'journal_type',j.journal_type,
 'lines',(SELECT jsonb_agg(jsonb_build_object('line_no',l.line_no,'account_code',l.account_code,'debit_amount',l.debit_amount,'credit_amount',l.credit_amount,'member_ref',l.member_ref,'dimensions',l.dimensions) ORDER BY l.line_no)
 FROM journal_line l WHERE l.tenant_id=j.tenant_id AND l.entity_id=j.entity_id AND l.journal_entry_id=j.journal_entry_id)))
 FROM journal_entry j WHERE j.tenant_id=p_tenant AND j.entity_id=p_entity AND j.journal_entry_id=p_journal
$$;
REVOKE EXECUTE ON FUNCTION refs_asset_acquisition_journal_snapshot(uuid,uuid,uuid) FROM PUBLIC,refs_app;

CREATE FUNCTION refs_create_fixed_asset_acquisition_hash(p_tenant uuid,p_entity uuid,p_asset uuid,p_period uuid,p_number text,p_date date,p_source_version bigint,p_attachments uuid[],p_reason text) RETURNS text
LANGUAGE sql IMMUTABLE SET search_path=pg_catalog,public,pg_temp AS $$
 SELECT refs_jsonb_hash(jsonb_build_object('schema_version','FIXED_ASSET_ACQUISITION_DRAFT_V1','tenant_id',p_tenant,'entity_id',p_entity,'asset_id',p_asset,'period_id',p_period,'journal_number',btrim(p_number),'journal_date',p_date,'expected_source_version',p_source_version,'attachment_ids',ARRAY(SELECT x FROM unnest(p_attachments) x ORDER BY x),'reason',btrim(p_reason)))
$$;

CREATE FUNCTION refs_create_fixed_asset_acquisition(p_tenant uuid,p_entity uuid,p_asset uuid,p_period uuid,p_number text,p_date date,p_source_version bigint,p_attachments uuid[],p_reason text,p_key text,p_hash text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE actor text:=refs_current_actor(); asset fixed_asset_register_evidence; proposal ai_invoice_capitalization_proposal;
 source source_document; source_line source_document_line; idem idempotency_receipt; lines jsonb; dims jsonb;
 result jsonb; journal_id uuid; link_id uuid:=gen_random_uuid(); binding uuid:=gen_random_uuid(); payload jsonb; inner_hash text;
BEGIN
 PERFORM refs_assert_scope(p_tenant,p_entity,'GL.JE.CREATE');
 IF actor IS NULL OR p_source_version IS NULL OR p_source_version<1 OR p_date IS NULL OR length(btrim(coalesce(p_number,''))) NOT BETWEEN 1 AND 100 OR length(btrim(coalesce(p_reason,''))) NOT BETWEEN 8 AND 2000
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
 IF NOT FOUND OR proposal.capitalization_treatment<>'FIXED_ASSET' OR proposal.amount<>asset.cost_basis OR proposal.currency<>asset.currency OR proposal.asset_account_code<>asset.asset_account_code OR proposal.source_document_id<>asset.source_document_id OR proposal.source_payload_hash<>asset.source_payload_hash THEN RAISE EXCEPTION 'Capitalization evidence differs from asset' USING ERRCODE='23514';END IF;
 SELECT * INTO source FROM source_document WHERE tenant_id=p_tenant AND entity_id=p_entity AND source_document_id=asset.source_document_id FOR SHARE;
 IF NOT FOUND OR source.version<>p_source_version OR source.payload_hash<>asset.source_payload_hash OR source.currency<>asset.currency OR source.status NOT IN('READY_FOR_DRAFT','DRAFT_CREATED','PENDING_JE_REVIEW','PENDING_JE_APPROVAL','APPROVED','POSTED') THEN RAISE EXCEPTION 'Acquisition source changed' USING ERRCODE='40001';END IF;
 SELECT * INTO source_line FROM source_document_line WHERE tenant_id=p_tenant AND entity_id=p_entity AND source_document_id=source.source_document_id AND source_document_line_id=proposal.source_document_line_id FOR SHARE;
 IF NOT FOUND OR source_line.amount<>asset.cost_basis THEN RAISE EXCEPTION 'Acquisition source line amount differs' USING ERRCODE='23514';END IF;
 PERFORM 1 FROM member_master WHERE tenant_id=p_tenant AND entity_id=p_entity AND member_ref=source_line.party_ref AND member_type='VENDOR' AND active FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Acquisition requires a source-bound active vendor' USING ERRCODE='23503';END IF;
 dims:=jsonb_build_object('fixed_asset_register_evidence_id',p_asset,'project_ref',source_line.project_ref,'property_ref',source_line.property_ref);
 lines:=jsonb_build_array(jsonb_build_object('line_no',1,'account_code',asset.asset_account_code,'debit_amount',asset.cost_basis,'credit_amount',0,'member_ref',NULL,'dimensions',dims),jsonb_build_object('line_no',2,'account_code',proposal.liability_account_code,'debit_amount',0,'credit_amount',asset.cost_basis,'member_ref',source_line.party_ref,'dimensions',dims));
 inner_hash:=refs_create_manual_journal_hash(p_tenant,p_entity,p_period,p_number,p_date,asset.currency,btrim(p_reason),lines,p_attachments);
 result:=refs_create_manual_journal(p_tenant,p_entity,p_period,p_number,p_date,asset.currency,btrim(p_reason),lines,p_attachments,'asset-acquisition:'||binding,inner_hash);
 journal_id:=(result->>'journal_entry_id')::uuid;
 INSERT INTO source_link(source_link_id,tenant_id,entity_id,link_type,source_document_id,journal_entry_id,created_by) VALUES(link_id,p_tenant,p_entity,'SOURCE_TO_JE',source.source_document_id,journal_id,actor);
 INSERT INTO fixed_asset_acquisition_binding(binding_id,tenant_id,entity_id,asset_id,journal_entry_id,source_document_id,source_document_version,source_payload_hash,source_document_line_id,source_line_snapshot_hash,source_link_id,journal_snapshot_hash,created_by)
 VALUES(binding,p_tenant,p_entity,p_asset,journal_id,source.source_document_id,source.version,source.payload_hash,source_line.source_document_line_id,refs_jsonb_hash(to_jsonb(source_line)),link_id,refs_asset_acquisition_journal_snapshot(p_tenant,p_entity,journal_id),actor);
 payload:=result||jsonb_build_object('schema_version','FIXED_ASSET_ACQUISITION_DRAFT_V1','binding_id',binding,'asset_id',p_asset,'source_document_id',source.source_document_id,'source_document_version',source.version,'source_payload_hash',source.payload_hash,'source_link_id',link_id);
 INSERT INTO audit_event(tenant_id,entity_id,event_type,object_type,object_id,action,actor_id,actor_type,permission_used,request_id,correlation_id,idempotency_key,after_hash,reason,metadata) VALUES(p_tenant,p_entity,'FIXED_ASSET_ACQUISITION_DRAFT_CREATED','JOURNAL_ENTRY',journal_id,'CREATE',actor,'USER','GL.JE.CREATE',p_key,p_key,p_key,p_hash,btrim(p_reason),payload);
 INSERT INTO outbox_event(tenant_id,entity_id,aggregate_type,aggregate_id,event_type,payload,payload_hash) VALUES(p_tenant,p_entity,'JOURNAL_ENTRY',journal_id,'FIXED_ASSET_ACQUISITION_DRAFT_CREATED',payload,refs_jsonb_hash(payload));
 UPDATE idempotency_receipt SET status='SUCCEEDED',response_status=201,response_body=payload,completed_at=clock_timestamp() WHERE idempotency_receipt_id=idem.idempotency_receipt_id;
 RETURN payload;
END;$$;

CREATE FUNCTION refs_guard_bound_asset_acquisition_post() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE binding fixed_asset_acquisition_binding;asset fixed_asset_register_evidence;
BEGIN
 SELECT * INTO binding FROM fixed_asset_acquisition_binding WHERE tenant_id=NEW.tenant_id AND entity_id=NEW.entity_id AND journal_entry_id=NEW.journal_entry_id;
 IF NOT FOUND THEN RETURN NEW;END IF;
 SELECT * INTO asset FROM fixed_asset_register_evidence WHERE tenant_id=NEW.tenant_id AND entity_id=NEW.entity_id AND fixed_asset_register_evidence_id=binding.asset_id FOR UPDATE;
 IF binding.journal_snapshot_hash IS DISTINCT FROM refs_asset_acquisition_journal_snapshot(NEW.tenant_id,NEW.entity_id,NEW.journal_entry_id) THEN RAISE EXCEPTION 'Acquisition financial lines changed; create a corrected source-bound Draft' USING ERRCODE='23514';END IF;
 PERFORM 1 FROM source_document d JOIN source_document_line l ON l.tenant_id=d.tenant_id AND l.entity_id=d.entity_id AND l.source_document_id=d.source_document_id
 JOIN source_link sl ON sl.source_link_id=binding.source_link_id AND sl.tenant_id=d.tenant_id AND sl.entity_id=d.entity_id AND sl.source_document_id=d.source_document_id AND sl.journal_entry_id=NEW.journal_entry_id AND sl.link_type='SOURCE_TO_JE'
 WHERE d.tenant_id=NEW.tenant_id AND d.entity_id=NEW.entity_id AND d.source_document_id=binding.source_document_id AND d.version=binding.source_document_version AND d.payload_hash=binding.source_payload_hash AND d.currency=NEW.currency AND d.status IN('READY_FOR_DRAFT','DRAFT_CREATED','PENDING_JE_REVIEW','PENDING_JE_APPROVAL','APPROVED','POSTED') AND l.source_document_line_id=binding.source_document_line_id AND refs_jsonb_hash(to_jsonb(l))=binding.source_line_snapshot_hash FOR SHARE OF d,l;
 IF NOT FOUND THEN RAISE EXCEPTION 'Acquisition source or line changed before Post' USING ERRCODE='23514';END IF;
 IF EXISTS(SELECT 1 FROM ledger_line l JOIN journal_entry j ON j.tenant_id=l.tenant_id AND j.entity_id=l.entity_id AND j.journal_entry_id=l.journal_entry_id AND j.status='POSTED' WHERE l.tenant_id=NEW.tenant_id AND l.entity_id=NEW.entity_id AND l.dimensions->>'fixed_asset_register_evidence_id'=binding.asset_id::text AND l.account_code=asset.asset_account_code AND l.debit_amount>0) THEN RAISE EXCEPTION 'Asset already has a Posted acquisition' USING ERRCODE='23514';END IF;
 INSERT INTO fixed_asset_acquisition_posting(tenant_id,entity_id,asset_id,binding_id,journal_entry_id,posted_by) VALUES(NEW.tenant_id,NEW.entity_id,binding.asset_id,binding.binding_id,NEW.journal_entry_id,NEW.posted_by);
 RETURN NEW;
END;$$;
CREATE TRIGGER fixed_asset_acquisition_post_guard BEFORE UPDATE OF status ON journal_entry FOR EACH ROW WHEN(NEW.status='POSTED' AND OLD.status<>'POSTED') EXECUTE FUNCTION refs_guard_bound_asset_acquisition_post();
REVOKE EXECUTE ON FUNCTION refs_guard_bound_asset_acquisition_post() FROM PUBLIC,refs_app;
REVOKE EXECUTE ON FUNCTION refs_create_fixed_asset_acquisition_hash(uuid,uuid,uuid,uuid,text,date,bigint,uuid[],text),refs_create_fixed_asset_acquisition(uuid,uuid,uuid,uuid,text,date,bigint,uuid[],text,text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION refs_create_fixed_asset_acquisition_hash(uuid,uuid,uuid,uuid,text,date,bigint,uuid[],text),refs_create_fixed_asset_acquisition(uuid,uuid,uuid,uuid,text,date,bigint,uuid[],text,text,text) TO refs_app;
COMMIT;
