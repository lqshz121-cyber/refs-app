BEGIN;

CREATE TABLE fixed_asset_disposal_source_binding(
 binding_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),tenant_id uuid NOT NULL,entity_id uuid NOT NULL,fixed_asset_register_evidence_id uuid NOT NULL REFERENCES fixed_asset_register_evidence,
 journal_entry_id uuid NOT NULL,source_document_id uuid NOT NULL,source_document_version bigint NOT NULL CHECK(source_document_version>=1),source_payload_hash text NOT NULL CHECK(source_payload_hash~'^sha256:[a-f0-9]{64}$'),
 source_link_id uuid NOT NULL REFERENCES source_link,created_by text NOT NULL,reason text NOT NULL,binding_hash text NOT NULL,created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 UNIQUE(tenant_id,entity_id,journal_entry_id),FOREIGN KEY(tenant_id,entity_id) REFERENCES entity(tenant_id,entity_id),FOREIGN KEY(tenant_id,entity_id,journal_entry_id) REFERENCES journal_entry(tenant_id,entity_id,journal_entry_id),FOREIGN KEY(tenant_id,entity_id,source_document_id) REFERENCES source_document(tenant_id,entity_id,source_document_id));
ALTER TABLE fixed_asset_disposal_source_binding ENABLE ROW LEVEL SECURITY;
CREATE POLICY fixed_asset_disposal_source_binding_scope ON fixed_asset_disposal_source_binding USING(tenant_id=refs_current_tenant() AND refs_entity_allowed(entity_id));
CREATE TRIGGER fixed_asset_disposal_source_binding_immutable BEFORE UPDATE OR DELETE ON fixed_asset_disposal_source_binding FOR EACH ROW EXECUTE FUNCTION reject_mutation();
REVOKE ALL ON fixed_asset_disposal_source_binding FROM PUBLIC,refs_app;
CREATE TABLE fixed_asset_disposal_posting(
 tenant_id uuid NOT NULL,entity_id uuid NOT NULL,fixed_asset_register_evidence_id uuid NOT NULL REFERENCES fixed_asset_register_evidence,
 journal_entry_id uuid NOT NULL,binding_id uuid NOT NULL REFERENCES fixed_asset_disposal_source_binding,posted_by text NOT NULL,created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(tenant_id,entity_id,fixed_asset_register_evidence_id),FOREIGN KEY(tenant_id,entity_id,journal_entry_id) REFERENCES journal_entry(tenant_id,entity_id,journal_entry_id));
ALTER TABLE fixed_asset_disposal_posting ENABLE ROW LEVEL SECURITY;
CREATE POLICY fixed_asset_disposal_posting_scope ON fixed_asset_disposal_posting USING(tenant_id=refs_current_tenant() AND refs_entity_allowed(entity_id));
CREATE TRIGGER fixed_asset_disposal_posting_immutable BEFORE UPDATE OR DELETE ON fixed_asset_disposal_posting FOR EACH ROW EXECUTE FUNCTION reject_mutation();
REVOKE ALL ON fixed_asset_disposal_posting FROM PUBLIC,refs_app;
CREATE FUNCTION refs_guard_fixed_asset_journal_post() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE asset fixed_asset_register_evidence;credit numeric(20,4);prior_balance numeric(20,4);binding uuid;
BEGIN
 IF NEW.status<>'POSTED' OR OLD.status='POSTED' THEN RETURN NEW;END IF;
 FOR asset IN SELECT a.* FROM fixed_asset_register_evidence a WHERE a.tenant_id=NEW.tenant_id AND a.entity_id=NEW.entity_id AND EXISTS(
   SELECT 1 FROM journal_line l WHERE l.tenant_id=NEW.tenant_id AND l.entity_id=NEW.entity_id AND l.journal_entry_id=NEW.journal_entry_id AND l.dimensions->>'fixed_asset_register_evidence_id'=a.fixed_asset_register_evidence_id::text)
   ORDER BY a.fixed_asset_register_evidence_id FOR UPDATE OF a
 LOOP
  IF NEW.currency<>asset.currency OR EXISTS(SELECT 1 FROM fixed_asset_disposal_posting WHERE tenant_id=NEW.tenant_id AND entity_id=NEW.entity_id AND fixed_asset_register_evidence_id=asset.fixed_asset_register_evidence_id)
   OR EXISTS(SELECT 1 FROM fixed_asset_disposal_evidence WHERE tenant_id=NEW.tenant_id AND entity_id=NEW.entity_id AND fixed_asset_register_evidence_id=asset.fixed_asset_register_evidence_id) THEN
    RAISE EXCEPTION 'Posted disposal or incompatible currency prevents further asset posting' USING ERRCODE='23514';
  END IF;
  SELECT coalesce(sum(credit_amount-debit_amount),0) INTO credit FROM journal_line WHERE tenant_id=NEW.tenant_id AND entity_id=NEW.entity_id AND journal_entry_id=NEW.journal_entry_id AND account_code=asset.asset_account_code AND dimensions->>'fixed_asset_register_evidence_id'=asset.fixed_asset_register_evidence_id::text;
  IF credit>0 THEN
   SELECT b.binding_id INTO binding FROM fixed_asset_disposal_source_binding b JOIN source_document d ON d.tenant_id=b.tenant_id AND d.entity_id=b.entity_id AND d.source_document_id=b.source_document_id AND d.payload_hash=b.source_payload_hash AND d.version=b.source_document_version AND d.currency=NEW.currency AND d.status IN('READY_FOR_DRAFT','DRAFT_CREATED','PENDING_JE_REVIEW','PENDING_JE_APPROVAL','APPROVED','POSTED')
    JOIN source_link sl ON sl.source_link_id=b.source_link_id AND sl.link_type='SOURCE_TO_JE' AND sl.source_document_id=b.source_document_id AND sl.journal_entry_id=b.journal_entry_id AND sl.tenant_id=b.tenant_id AND sl.entity_id=b.entity_id
    WHERE b.tenant_id=NEW.tenant_id AND b.entity_id=NEW.entity_id AND b.fixed_asset_register_evidence_id=asset.fixed_asset_register_evidence_id AND b.journal_entry_id=NEW.journal_entry_id FOR SHARE OF d;
   IF NOT FOUND OR credit<>asset.cost_basis THEN RAISE EXCEPTION 'Asset disposal posting requires exact source binding and complete asset cost' USING ERRCODE='23514';END IF;
   IF EXISTS(SELECT 1 FROM ledger_line l JOIN journal_entry j ON j.tenant_id=l.tenant_id AND j.entity_id=l.entity_id AND j.journal_entry_id=l.journal_entry_id AND j.status='POSTED'
    WHERE l.tenant_id=NEW.tenant_id AND l.entity_id=NEW.entity_id AND l.dimensions->>'fixed_asset_register_evidence_id'=asset.fixed_asset_register_evidence_id::text AND j.journal_date>NEW.journal_date AND j.journal_entry_id<>NEW.journal_entry_id) THEN
    RAISE EXCEPTION 'Backdated disposal conflicts with a later Posted asset movement' USING ERRCODE='23514';
   END IF;
   SELECT coalesce(sum(l.debit_amount-l.credit_amount),0) INTO prior_balance FROM ledger_line l JOIN journal_entry j ON j.tenant_id=l.tenant_id AND j.entity_id=l.entity_id AND j.journal_entry_id=l.journal_entry_id AND j.status='POSTED'
    WHERE l.tenant_id=NEW.tenant_id AND l.entity_id=NEW.entity_id AND l.account_code=asset.asset_account_code AND l.dimensions->>'fixed_asset_register_evidence_id'=asset.fixed_asset_register_evidence_id::text AND j.journal_date<=NEW.journal_date AND j.journal_entry_id<>NEW.journal_entry_id;
   IF prior_balance<>credit THEN RAISE EXCEPTION 'Asset disposal must clear its exact prior Posted cost balance' USING ERRCODE='23514';END IF;
   INSERT INTO fixed_asset_disposal_posting(tenant_id,entity_id,fixed_asset_register_evidence_id,journal_entry_id,binding_id,posted_by) VALUES(NEW.tenant_id,NEW.entity_id,asset.fixed_asset_register_evidence_id,NEW.journal_entry_id,binding,NEW.posted_by);
  END IF;
 END LOOP;
 RETURN NEW;
END;$$;
REVOKE EXECUTE ON FUNCTION refs_guard_fixed_asset_journal_post() FROM PUBLIC;
CREATE TRIGGER fixed_asset_journal_post_guard BEFORE UPDATE OF status ON journal_entry FOR EACH ROW WHEN(NEW.status='POSTED' AND OLD.status<>'POSTED') EXECUTE FUNCTION refs_guard_fixed_asset_journal_post();
CREATE FUNCTION refs_bind_fixed_asset_disposal_source_hash(p_tenant uuid,p_entity uuid,p_asset uuid,p_journal uuid,p_source uuid,p_source_hash text,p_revision bigint,p_reason text) RETURNS text LANGUAGE sql IMMUTABLE SET search_path=pg_catalog,public,pg_temp AS $$
 SELECT refs_jsonb_hash(jsonb_build_object('schema_version','FIXED_ASSET_DISPOSAL_SOURCE_BINDING_V1','tenant_id',p_tenant,'entity_id',p_entity,'asset_id',p_asset,'journal_entry_id',p_journal,'source_document_id',p_source,'source_payload_hash',p_source_hash,'expected_revision',p_revision,'reason',btrim(p_reason)))
$$;
CREATE FUNCTION refs_bind_fixed_asset_disposal_source(p_tenant uuid,p_entity uuid,p_asset uuid,p_journal uuid,p_source uuid,p_source_hash text,p_revision bigint,p_reason text,p_key text,p_hash text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE actor text:=refs_current_actor();asset fixed_asset_register_evidence;journal journal_entry;source source_document;idem idempotency_receipt;link_id uuid:=gen_random_uuid();new_id uuid:=gen_random_uuid();payload jsonb;result jsonb;
BEGIN
 PERFORM refs_assert_scope(p_tenant,p_entity,'GL.JE.CREATE');
 IF actor IS NULL OR p_revision IS NULL OR p_revision<0 OR length(btrim(coalesce(p_reason,''))) NOT BETWEEN 8 AND 2000 OR p_source_hash !~ '^sha256:[a-f0-9]{64}$' OR p_hash IS DISTINCT FROM refs_bind_fixed_asset_disposal_source_hash(p_tenant,p_entity,p_asset,p_journal,p_source,p_source_hash,p_revision,p_reason) THEN RAISE EXCEPTION 'Invalid disposal source binding request' USING ERRCODE='22023';END IF;
 INSERT INTO idempotency_receipt(tenant_id,operation_scope,idempotency_key,request_hash,status,actor_id) VALUES(p_tenant,'FIXED_ASSET_DISPOSAL_SOURCE_BIND:'||p_entity,p_key,p_hash,'IN_PROGRESS',actor) ON CONFLICT(tenant_id,operation_scope,idempotency_key) DO NOTHING;
 SELECT * INTO idem FROM idempotency_receipt WHERE tenant_id=p_tenant AND operation_scope='FIXED_ASSET_DISPOSAL_SOURCE_BIND:'||p_entity AND idempotency_key=p_key FOR UPDATE;
 IF idem.actor_id IS DISTINCT FROM actor OR idem.request_hash IS DISTINCT FROM p_hash THEN RAISE EXCEPTION 'Disposal source binding idempotency conflict' USING ERRCODE='23505';END IF;
 IF idem.status='SUCCEEDED' THEN RETURN idem.response_body||jsonb_build_object('idempotent',true);END IF;
 SELECT * INTO asset FROM fixed_asset_register_evidence WHERE tenant_id=p_tenant AND entity_id=p_entity AND fixed_asset_register_evidence_id=p_asset FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Scoped asset evidence missing' USING ERRCODE='23503';END IF;
 SELECT * INTO journal FROM journal_entry WHERE tenant_id=p_tenant AND entity_id=p_entity AND journal_entry_id=p_journal FOR UPDATE;
 IF NOT FOUND OR journal.status<>'DRAFT' OR journal.created_by<>actor OR journal.revision<>p_revision THEN RAISE EXCEPTION 'Disposal source binding requires the current maker-owned Draft revision' USING ERRCODE='40001';END IF;
 IF EXISTS(SELECT 1 FROM fixed_asset_disposal_evidence WHERE tenant_id=p_tenant AND entity_id=p_entity AND fixed_asset_register_evidence_id=p_asset) OR EXISTS(SELECT 1 FROM fixed_asset_disposal_posting WHERE tenant_id=p_tenant AND entity_id=p_entity AND fixed_asset_register_evidence_id=p_asset) THEN RAISE EXCEPTION 'Disposed asset cannot receive another source binding' USING ERRCODE='23514';END IF;
 IF NOT EXISTS(SELECT 1 FROM journal_line WHERE tenant_id=p_tenant AND entity_id=p_entity AND journal_entry_id=p_journal AND account_code=asset.asset_account_code AND credit_amount>debit_amount)
 OR EXISTS(SELECT 1 FROM journal_line WHERE tenant_id=p_tenant AND entity_id=p_entity AND journal_entry_id=p_journal AND dimensions->>'fixed_asset_register_evidence_id' IS DISTINCT FROM p_asset::text) THEN RAISE EXCEPTION 'Draft lines must identify the exact disposed asset' USING ERRCODE='23514';END IF;
 SELECT * INTO source FROM source_document WHERE tenant_id=p_tenant AND entity_id=p_entity AND source_document_id=p_source FOR SHARE;
 IF NOT FOUND OR source.version<1 OR source.payload_hash IS DISTINCT FROM p_source_hash OR source.currency<>journal.currency OR source.status NOT IN('READY_FOR_DRAFT','DRAFT_CREATED','PENDING_JE_REVIEW','PENDING_JE_APPROVAL','APPROVED','POSTED') THEN RAISE EXCEPTION 'Disposal source version hash currency or availability changed' USING ERRCODE='23514';END IF;
 INSERT INTO source_link(source_link_id,tenant_id,entity_id,link_type,source_document_id,journal_entry_id,created_by) VALUES(link_id,p_tenant,p_entity,'SOURCE_TO_JE',p_source,p_journal,actor);
 INSERT INTO fixed_asset_disposal_source_binding(binding_id,tenant_id,entity_id,fixed_asset_register_evidence_id,journal_entry_id,source_document_id,source_document_version,source_payload_hash,source_link_id,created_by,reason,binding_hash) VALUES(new_id,p_tenant,p_entity,p_asset,p_journal,p_source,source.version,source.payload_hash,link_id,actor,btrim(p_reason),p_hash);
 UPDATE journal_entry SET revision=revision+1 WHERE tenant_id=p_tenant AND entity_id=p_entity AND journal_entry_id=p_journal;
 payload:=jsonb_build_object('schema_version','FIXED_ASSET_DISPOSAL_SOURCE_BINDING_V1','binding_id',new_id,'fixed_asset_register_evidence_id',p_asset,'journal_entry_id',p_journal,'source_document_id',p_source,'source_payload_hash',source.payload_hash,'source_document_version',source.version,'source_link_id',link_id,'revision',p_revision+1,'status','DRAFT');
 INSERT INTO audit_event(tenant_id,entity_id,event_type,object_type,object_id,action,actor_id,actor_type,permission_used,request_id,correlation_id,idempotency_key,after_hash,reason,metadata) VALUES(p_tenant,p_entity,'FIXED_ASSET_DISPOSAL_SOURCE_BOUND','JOURNAL_ENTRY',p_journal,'BIND_SOURCE',actor,'USER','GL.JE.CREATE',p_key,p_key,p_key,p_hash,btrim(p_reason),payload);
 INSERT INTO outbox_event(tenant_id,entity_id,aggregate_type,aggregate_id,event_type,payload,payload_hash) VALUES(p_tenant,p_entity,'JOURNAL_ENTRY',p_journal,'FIXED_ASSET_DISPOSAL_SOURCE_BOUND',payload,refs_jsonb_hash(payload));
 result:=payload||jsonb_build_object('idempotent',false);UPDATE idempotency_receipt SET status='SUCCEEDED',response_status=201,response_body=result,completed_at=clock_timestamp() WHERE idempotency_receipt_id=idem.idempotency_receipt_id;RETURN result;
END;$$;
REVOKE EXECUTE ON FUNCTION refs_bind_fixed_asset_disposal_source_hash(uuid,uuid,uuid,uuid,uuid,text,bigint,text),refs_bind_fixed_asset_disposal_source(uuid,uuid,uuid,uuid,uuid,text,bigint,text,text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION refs_bind_fixed_asset_disposal_source_hash(uuid,uuid,uuid,uuid,uuid,text,bigint,text),refs_bind_fixed_asset_disposal_source(uuid,uuid,uuid,uuid,uuid,text,bigint,text,text,text) TO refs_app;

CREATE OR REPLACE FUNCTION refs_review_fixed_asset_disposal(p_tenant uuid,p_entity uuid,p_register uuid,p_period uuid,p_source uuid,p_date date,p_accum numeric,p_proceeds numeric,p_reason text,p_idempotency_key text,p_request_hash text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE actor text:=refs_current_actor();asset fixed_asset_register_evidence;source source_document;idem idempotency_receipt;period accounting_period;credit numeric(20,4);posted_accum numeric(20,4);posted_proceeds numeric(20,4);posted_gain numeric(20,4);prior_depreciation numeric(20,4);posted_impairment numeric(20,4):=0;impairment_accounts text[];impairment_history uuid[]:=ARRAY[]::uuid[];imp_balance record;je_ids uuid[];jl_ids uuid[];ll_ids uuid[];carrying numeric(20,4);gain_loss numeric(20,4);evidence_hash text;disposal_id uuid:=gen_random_uuid();payload jsonb;result jsonb;
BEGIN
  PERFORM refs_assert_scope(p_tenant,p_entity,'FIXED_ASSET.DISPOSAL.REVIEW');IF actor IS NULL THEN RAISE EXCEPTION 'Authenticated disposal reviewer missing' USING ERRCODE='42501';END IF;
  evidence_hash:=refs_review_fixed_asset_disposal_hash(p_tenant,p_entity,p_register,p_period,p_source,p_date,p_accum,p_proceeds,p_reason);IF p_request_hash IS DISTINCT FROM evidence_hash OR p_accum IS NULL OR p_proceeds IS NULL OR p_accum<0 OR p_proceeds<0 OR length(btrim(COALESCE(p_reason,''))) NOT BETWEEN 8 AND 2000 THEN RAISE EXCEPTION 'Disposal review payload is invalid or non-canonical' USING ERRCODE='22023';END IF;
  INSERT INTO idempotency_receipt(tenant_id,operation_scope,idempotency_key,request_hash,status,actor_id) VALUES(p_tenant,'FIXED_ASSET_DISPOSAL_REVIEW:'||p_entity,p_idempotency_key,p_request_hash,'IN_PROGRESS',actor) ON CONFLICT(tenant_id,operation_scope,idempotency_key) DO NOTHING;SELECT * INTO idem FROM idempotency_receipt WHERE tenant_id=p_tenant AND operation_scope='FIXED_ASSET_DISPOSAL_REVIEW:'||p_entity AND idempotency_key=p_idempotency_key FOR UPDATE;IF idem.request_hash<>p_request_hash OR idem.actor_id IS DISTINCT FROM actor THEN RAISE EXCEPTION 'Disposal review idempotency conflict' USING ERRCODE='23505';END IF;IF idem.status='SUCCEEDED' THEN RETURN idem.response_body||jsonb_build_object('idempotent',true);END IF;
  SELECT * INTO asset FROM fixed_asset_register_evidence WHERE tenant_id=p_tenant AND entity_id=p_entity AND fixed_asset_register_evidence_id=p_register FOR UPDATE;IF NOT FOUND OR asset.status<>'ACTIVE' OR asset.reviewed_by=actor OR p_date<asset.placed_in_service_date OR p_accum>asset.cost_basis THEN RAISE EXCEPTION 'Independent disposal review requires active asset evidence, valid dates and a different actor' USING ERRCODE='23514';END IF;
  IF EXISTS(SELECT 1 FROM fixed_asset_impairment_assessment_evidence WHERE tenant_id=p_tenant AND entity_id=p_entity AND fixed_asset_register_evidence_id=p_register AND assessment_date>=p_date) THEN RAISE EXCEPTION 'Disposal date conflicts with an existing same-date or later impairment assessment' USING ERRCODE='23514';END IF;
  SELECT * INTO period FROM accounting_period WHERE tenant_id=p_tenant AND entity_id=p_entity AND period_id=p_period AND ledger_code='PRIMARY' FOR SHARE;IF NOT FOUND OR p_date NOT BETWEEN period.starts_on AND period.ends_on THEN RAISE EXCEPTION 'Disposal date must be in the exact primary accounting period' USING ERRCODE='23514';END IF;
  SELECT * INTO source FROM source_document WHERE tenant_id=p_tenant AND entity_id=p_entity AND source_document_id=p_source FOR SHARE;IF NOT FOUND OR source.version<1 OR source.status NOT IN('READY_FOR_DRAFT','DRAFT_CREATED','PENDING_JE_REVIEW','PENDING_JE_APPROVAL','APPROVED','POSTED') THEN RAISE EXCEPTION 'Retained disposal source is missing or unavailable' USING ERRCODE='23514';END IF;
  SELECT sum(l.credit_amount-l.debit_amount)::numeric(20,4),array_agg(DISTINCT l.journal_entry_id ORDER BY l.journal_entry_id),array_agg(DISTINCT l.journal_line_id ORDER BY l.journal_line_id),array_agg(DISTINCT l.ledger_line_id ORDER BY l.ledger_line_id) INTO credit,je_ids,jl_ids,ll_ids FROM ledger_line l JOIN journal_entry j ON j.tenant_id=l.tenant_id AND j.entity_id=l.entity_id AND j.journal_entry_id=l.journal_entry_id AND j.status='POSTED' WHERE l.tenant_id=p_tenant AND l.entity_id=p_entity AND l.account_code=asset.asset_account_code AND l.dimensions->>'fixed_asset_register_evidence_id'=p_register::text AND j.journal_date BETWEEN period.starts_on AND least(period.ends_on,p_date) AND l.credit_amount>l.debit_amount;
  IF credit IS NULL OR credit<>asset.cost_basis THEN RAISE EXCEPTION 'Posted asset credit must exactly equal the reviewed disposed cost' USING ERRCODE='23514';END IF;
  IF EXISTS(SELECT 1 FROM unnest(je_ids) j(id) LEFT JOIN fixed_asset_disposal_source_binding b ON b.tenant_id=p_tenant AND b.entity_id=p_entity AND b.journal_entry_id=j.id AND b.fixed_asset_register_evidence_id=p_register AND b.source_document_id=p_source AND b.source_payload_hash=source.payload_hash AND b.source_document_version=source.version
    LEFT JOIN source_link sl ON sl.source_link_id=b.source_link_id AND sl.tenant_id=p_tenant AND sl.entity_id=p_entity AND sl.link_type='SOURCE_TO_JE' AND sl.source_document_id=p_source AND sl.journal_entry_id=j.id
    WHERE b.binding_id IS NULL OR sl.source_link_id IS NULL) THEN RAISE EXCEPTION 'Every disposal journal requires an exact immutable source binding' USING ERRCODE='23514';END IF;
  -- The complete disposal journal must belong to this exact asset and currency.
  IF EXISTS(SELECT 1 FROM ledger_line l WHERE l.tenant_id=p_tenant AND l.entity_id=p_entity AND l.journal_entry_id=ANY(je_ids)
    AND (l.dimensions->>'fixed_asset_register_evidence_id' IS DISTINCT FROM p_register::text OR l.currency<>asset.currency)) THEN
    RAISE EXCEPTION 'Disposal journals contain unrelated asset lines or currency' USING ERRCODE='23514';
  END IF;
  SELECT coalesce(array_agg(DISTINCT accumulated_impairment_account_code ORDER BY accumulated_impairment_account_code),ARRAY[]::text[]) INTO impairment_accounts
    FROM fixed_asset_impairment_assessment_evidence WHERE tenant_id=p_tenant AND entity_id=p_entity AND fixed_asset_register_evidence_id=p_register;
  IF asset.asset_account_code=ANY(impairment_accounts) OR asset.accumulated_depreciation_account_code=ANY(impairment_accounts) THEN
    RAISE EXCEPTION 'Impairment and asset depreciation accounts must be distinct' USING ERRCODE='23514';
  END IF;
  IF EXISTS(SELECT 1 FROM ledger_line l JOIN journal_entry j ON j.tenant_id=l.tenant_id AND j.entity_id=l.entity_id AND j.journal_entry_id=l.journal_entry_id AND j.status='POSTED'
    LEFT JOIN fixed_asset_impairment_assessment_evidence i ON i.tenant_id=l.tenant_id AND i.entity_id=l.entity_id AND i.fixed_asset_impairment_assessment_evidence_id::text=l.dimensions->>'fixed_asset_impairment_assessment_evidence_id'
    WHERE l.tenant_id=p_tenant AND l.entity_id=p_entity AND l.dimensions->>'fixed_asset_register_evidence_id'=p_register::text AND l.account_code=ANY(impairment_accounts)
      AND j.journal_date<=p_date AND NOT(l.journal_entry_id=ANY(je_ids))
      AND (i.fixed_asset_impairment_assessment_evidence_id IS NULL OR i.fixed_asset_register_evidence_id<>p_register OR i.accumulated_impairment_account_code<>l.account_code OR j.journal_date<i.assessment_date OR l.currency<>i.currency OR i.currency<>asset.currency)) THEN
    RAISE EXCEPTION 'Posted impairment must bind an exact compatible immutable assessment' USING ERRCODE='23514';
  END IF;
  IF EXISTS(SELECT 1 FROM ledger_line l JOIN journal_entry j ON j.tenant_id=l.tenant_id AND j.entity_id=l.entity_id AND j.journal_entry_id=l.journal_entry_id AND j.status='POSTED'
    JOIN fixed_asset_impairment_assessment_evidence i ON i.tenant_id=l.tenant_id AND i.entity_id=l.entity_id AND i.fixed_asset_impairment_assessment_evidence_id::text=l.dimensions->>'fixed_asset_impairment_assessment_evidence_id'
    WHERE l.tenant_id=p_tenant AND l.entity_id=p_entity AND l.dimensions->>'fixed_asset_register_evidence_id'=p_register::text AND l.account_code=ANY(impairment_accounts)
      AND j.journal_date<=p_date AND NOT(l.journal_entry_id=ANY(je_ids))
    GROUP BY i.fixed_asset_impairment_assessment_evidence_id,i.impairment_loss HAVING sum(l.credit_amount-l.debit_amount)<>i.impairment_loss) THEN
    RAISE EXCEPTION 'Posted impairment amount differs from its immutable assessment loss' USING ERRCODE='23514';
  END IF;
  -- Validate both sides of every historical impairment journal, not just its
  -- accumulated-impairment credit. Extra or differently dimensioned lines fail.
  IF EXISTS(SELECT 1 FROM ledger_line l LEFT JOIN fixed_asset_impairment_assessment_evidence i ON i.tenant_id=l.tenant_id AND i.entity_id=l.entity_id AND i.fixed_asset_impairment_assessment_evidence_id::text=l.dimensions->>'fixed_asset_impairment_assessment_evidence_id'
    WHERE l.tenant_id=p_tenant AND l.entity_id=p_entity AND l.journal_entry_id IN(
      SELECT h.journal_entry_id FROM ledger_line h JOIN journal_entry j ON j.tenant_id=h.tenant_id AND j.entity_id=h.entity_id AND j.journal_entry_id=h.journal_entry_id AND j.status='POSTED'
      WHERE h.tenant_id=p_tenant AND h.entity_id=p_entity AND h.dimensions->>'fixed_asset_register_evidence_id'=p_register::text AND h.account_code=ANY(impairment_accounts) AND j.journal_date<=p_date AND NOT(h.journal_entry_id=ANY(je_ids)))
    AND (i.fixed_asset_impairment_assessment_evidence_id IS NULL OR i.fixed_asset_register_evidence_id<>p_register OR l.dimensions->>'fixed_asset_register_evidence_id' IS DISTINCT FROM p_register::text OR l.currency<>i.currency
      OR l.account_code NOT IN(i.impairment_expense_account_code,i.accumulated_impairment_account_code)
      OR (l.account_code=i.impairment_expense_account_code AND l.credit_amount<>0) OR (l.account_code=i.accumulated_impairment_account_code AND l.debit_amount<>0))) THEN
    RAISE EXCEPTION 'Historical impairment journal has an invalid expense counterpart or extra line' USING ERRCODE='23514';
  END IF;
  IF EXISTS(SELECT 1 FROM ledger_line l JOIN journal_entry j ON j.tenant_id=l.tenant_id AND j.entity_id=l.entity_id AND j.journal_entry_id=l.journal_entry_id AND j.status='POSTED'
    JOIN fixed_asset_impairment_assessment_evidence i ON i.tenant_id=l.tenant_id AND i.entity_id=l.entity_id AND i.fixed_asset_impairment_assessment_evidence_id::text=l.dimensions->>'fixed_asset_impairment_assessment_evidence_id'
    WHERE l.tenant_id=p_tenant AND l.entity_id=p_entity AND l.dimensions->>'fixed_asset_register_evidence_id'=p_register::text AND j.journal_date<=p_date AND NOT(l.journal_entry_id=ANY(je_ids))
    GROUP BY i.fixed_asset_impairment_assessment_evidence_id,i.impairment_loss,i.impairment_expense_account_code
    HAVING coalesce(sum(l.debit_amount-l.credit_amount) FILTER(WHERE l.account_code=i.impairment_expense_account_code),0)<>i.impairment_loss) THEN
    RAISE EXCEPTION 'Historical impairment expense differs from its immutable assessment loss' USING ERRCODE='23514';
  END IF;
  FOR imp_balance IN
    SELECT a.code,
      coalesce(sum(l.credit_amount-l.debit_amount) FILTER(WHERE NOT(l.journal_entry_id=ANY(je_ids))),0) prior_credit,
      coalesce(sum(l.debit_amount-l.credit_amount) FILTER(WHERE l.journal_entry_id=ANY(je_ids)),0) disposal_debit,
      coalesce(array_agg(l.ledger_line_id ORDER BY l.ledger_line_id) FILTER(WHERE NOT(l.journal_entry_id=ANY(je_ids))),ARRAY[]::uuid[]) history_ids
    FROM unnest(impairment_accounts) a(code)
    LEFT JOIN (SELECT ll.* FROM ledger_line ll JOIN journal_entry j ON j.tenant_id=ll.tenant_id AND j.entity_id=ll.entity_id AND j.journal_entry_id=ll.journal_entry_id
       WHERE ll.tenant_id=p_tenant AND ll.entity_id=p_entity AND j.status='POSTED' AND j.journal_date<=p_date AND ll.dimensions->>'fixed_asset_register_evidence_id'=p_register::text) l ON l.account_code=a.code
    GROUP BY a.code ORDER BY a.code
  LOOP
    IF imp_balance.prior_credit<0 OR imp_balance.disposal_debit<>imp_balance.prior_credit THEN
      RAISE EXCEPTION 'Disposal must exactly reverse every Posted accumulated impairment balance' USING ERRCODE='23514';
    END IF;
    posted_impairment:=posted_impairment+imp_balance.prior_credit;
    impairment_history:=impairment_history||imp_balance.history_ids;
  END LOOP;
  SELECT coalesce(sum(l.credit_amount-l.debit_amount),0) INTO prior_depreciation
    FROM ledger_line l JOIN journal_entry j ON j.tenant_id=l.tenant_id AND j.entity_id=l.entity_id AND j.journal_entry_id=l.journal_entry_id AND j.status='POSTED'
    WHERE l.tenant_id=p_tenant AND l.entity_id=p_entity AND l.account_code=asset.accumulated_depreciation_account_code AND l.dimensions->>'fixed_asset_register_evidence_id'=p_register::text
      AND j.journal_date<=p_date AND NOT(l.journal_entry_id=ANY(je_ids));
  IF prior_depreciation<>p_accum OR p_accum+posted_impairment>asset.cost_basis THEN
    RAISE EXCEPTION 'Disposal depreciation and impairment must match prior Posted carrying value' USING ERRCODE='23514';
  END IF;
  SELECT coalesce(sum(l.debit_amount-l.credit_amount) FILTER(WHERE l.account_code=asset.accumulated_depreciation_account_code),0),
    coalesce(sum(l.debit_amount-l.credit_amount) FILTER(WHERE a.required_member_type IN('BANK','CUSTOMER_OR_AFFILIATE')),0),
    coalesce(sum(l.credit_amount-l.debit_amount) FILTER(WHERE l.account_code NOT IN(asset.asset_account_code,asset.accumulated_depreciation_account_code)
      AND NOT(l.account_code=ANY(impairment_accounts)) AND coalesce(a.required_member_type,'') NOT IN('BANK','CUSTOMER_OR_AFFILIATE')),0),
    array_agg(DISTINCT l.journal_line_id ORDER BY l.journal_line_id),array_agg(DISTINCT l.ledger_line_id ORDER BY l.ledger_line_id)
    INTO posted_accum,posted_proceeds,posted_gain,jl_ids,ll_ids
    FROM ledger_line l JOIN account_master a ON a.tenant_id=l.tenant_id AND a.entity_id=l.entity_id AND a.account_code=l.account_code
    WHERE l.tenant_id=p_tenant AND l.entity_id=p_entity AND l.journal_entry_id=ANY(je_ids);
  carrying:=asset.cost_basis-p_accum-posted_impairment;gain_loss:=p_proceeds-carrying;
  IF posted_accum<>p_accum OR posted_proceeds<>p_proceeds OR posted_gain<>gain_loss THEN
    RAISE EXCEPTION 'Disposal amounts do not reconcile to complete Posted depreciation proceeds and gain lines' USING ERRCODE='23514';
  END IF;

  INSERT INTO fixed_asset_disposal_evidence(fixed_asset_disposal_evidence_id,tenant_id,entity_id,fixed_asset_register_evidence_id,accounting_period_id,disposal_source_document_id,disposal_source_payload_hash,disposal_date,currency,disposed_cost,accumulated_depreciation,accumulated_impairment,impairment_ledger_line_ids,carrying_value,proceeds,gain_or_loss,posted_asset_credit,journal_entry_ids,journal_line_ids,ledger_line_ids,reviewed_by,review_reason,disposal_evidence_hash,status) VALUES(disposal_id,p_tenant,p_entity,p_register,p_period,p_source,source.payload_hash,p_date,asset.currency,asset.cost_basis,p_accum,posted_impairment,impairment_history,carrying,p_proceeds,gain_loss,credit,je_ids,jl_ids,ll_ids,actor,btrim(p_reason),evidence_hash,'REVIEWED');
  payload:=jsonb_build_object('schema_version','FIXED_ASSET_DISPOSAL_EVIDENCE_V1','lineage_version','POSTED_DISPOSAL_LINES_V2','timeline_version','DISPOSAL_TIMELINE_V1','carrying_version','DISPOSAL_CARRYING_V2','source_binding_version','DISPOSAL_SOURCE_V1','fixed_asset_disposal_evidence_id',disposal_id,'fixed_asset_register_evidence_id',p_register,'accounting_period_id',p_period,'disposal_source_document_id',p_source,'disposal_source_payload_hash',source.payload_hash,'disposal_date',p_date,'currency',asset.currency,'disposed_cost',to_char(asset.cost_basis,'FM999999999999990.0000'),'accumulated_depreciation',to_char(p_accum,'FM999999999999990.0000'),'accumulated_impairment',to_char(posted_impairment,'FM999999999999990.0000'),'impairment_ledger_line_ids',impairment_history,'carrying_value',to_char(carrying,'FM999999999999990.0000'),'proceeds',to_char(p_proceeds,'FM999999999999990.0000'),'gain_or_loss',to_char(gain_loss,'FM999999999999990.0000'),'posted_asset_credit',to_char(credit,'FM999999999999990.0000'),'journal_entry_ids',je_ids,'journal_line_ids',jl_ids,'ledger_line_ids',ll_ids,'disposal_evidence_hash',evidence_hash,'status','REVIEWED','can_create_draft',false,'can_review',false,'can_approve',false,'can_post',false);
  INSERT INTO audit_event(tenant_id,entity_id,event_type,object_type,object_id,action,actor_id,actor_type,permission_used,request_id,correlation_id,idempotency_key,after_hash,reason,metadata) VALUES(p_tenant,p_entity,'FIXED_ASSET_DISPOSAL_REVIEWED','FIXED_ASSET_DISPOSAL_EVIDENCE',disposal_id,'REVIEW',actor,'USER','FIXED_ASSET.DISPOSAL.REVIEW',p_idempotency_key,p_idempotency_key,p_idempotency_key,evidence_hash,btrim(p_reason),payload);INSERT INTO outbox_event(tenant_id,entity_id,aggregate_type,aggregate_id,event_type,payload,payload_hash) VALUES(p_tenant,p_entity,'FIXED_ASSET_DISPOSAL_EVIDENCE',disposal_id,'FIXED_ASSET_DISPOSAL_REVIEWED',payload,refs_jsonb_hash(payload));result:=payload||jsonb_build_object('idempotent',false);UPDATE idempotency_receipt SET status='SUCCEEDED',response_status=201,response_body=result,completed_at=clock_timestamp() WHERE idempotency_receipt_id=idem.idempotency_receipt_id;RETURN result;
END;$$;

COMMIT;
