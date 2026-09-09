BEGIN;
-- Blocking installation; all accounting/source writers must be drained.
LOCK TABLE journal_entry,source_document,source_document_line,raw_event,fixed_asset_acquisition_binding,wbs_payable_original_row_evidence IN ACCESS EXCLUSIVE MODE;
ALTER TABLE wbs_payable_original_row_evidence ADD CONSTRAINT original_payable_scoped_hash_unique UNIQUE(tenant_id,entity_id,evidence_id,evidence_hash);
CREATE FUNCTION refs_validate_asset_original_source(p_tenant uuid,p_entity uuid,p_asset uuid) RETURNS wbs_payable_original_row_evidence
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE asset fixed_asset_register_evidence;proposal ai_invoice_capitalization_proposal;classification ai_invoice_accounting_classification_evidence;original wbs_payable_original_row_evidence;retained wbs_final1_retained_source_row;document source_document;line source_document_line;policy setting_snapshot;period accounting_period;
BEGIN
 SELECT * INTO asset FROM fixed_asset_register_evidence WHERE tenant_id=p_tenant AND entity_id=p_entity AND fixed_asset_register_evidence_id=p_asset;
 SELECT * INTO proposal FROM ai_invoice_capitalization_proposal WHERE tenant_id=p_tenant AND entity_id=p_entity AND ai_invoice_capitalization_proposal_id=asset.capitalization_proposal_id;
 SELECT * INTO classification FROM ai_invoice_accounting_classification_evidence WHERE tenant_id=p_tenant AND entity_id=p_entity AND ai_invoice_accounting_classification_evidence_id=proposal.ai_invoice_accounting_classification_evidence_id;
 SELECT * INTO original FROM wbs_payable_original_row_evidence WHERE tenant_id=p_tenant AND entity_id=p_entity AND source_document_id=proposal.source_document_id AND source_document_line_id=proposal.source_document_line_id;
 IF NOT FOUND THEN RAISE EXCEPTION 'Acquisition requires verified original payable evidence' USING ERRCODE='55006';END IF;
 SELECT * INTO retained FROM wbs_final1_retained_source_row WHERE tenant_id=p_tenant AND entity_id=p_entity AND wbs_final1_retained_source_row_id=original.retained_source_row_id;
 SELECT * INTO document FROM source_document WHERE tenant_id=p_tenant AND entity_id=p_entity AND source_document_id=original.source_document_id FOR UPDATE;
 SELECT * INTO line FROM source_document_line WHERE tenant_id=p_tenant AND entity_id=p_entity AND source_document_id=original.source_document_id AND source_document_line_id=original.source_document_line_id FOR UPDATE;
 SELECT * INTO period FROM accounting_period WHERE tenant_id=p_tenant AND entity_id=p_entity AND period_id=proposal.accounting_period_id AND ledger_code='PRIMARY' FOR SHARE;
 IF NOT FOUND OR document.accounting_date NOT BETWEEN period.starts_on AND period.ends_on THEN RAISE EXCEPTION 'Original source accounting period differs' USING ERRCODE='23514';END IF;
 IF classification.classification IS DISTINCT FROM 'CAPITALIZATION_REVIEW' OR classification.status IS DISTINCT FROM 'REVIEW_REQUIRED'
  OR classification.classifier_version IS DISTINCT FROM 'AI_INVOICE_ACCOUNTING_CLASSIFICATION_V2' OR classification.rule_id IS DISTINCT FROM 'AI_CAPITALIZATION_POLICY_V1'
  OR classification.classification_hash IS DISTINCT FROM proposal.classification_hash
  OR classification.source_document_id IS DISTINCT FROM original.source_document_id OR classification.source_document_line_id IS DISTINCT FROM original.source_document_line_id
  OR classification.source_line_hash IS DISTINCT FROM original.raw_row_hash OR proposal.source_line_hash IS DISTINCT FROM original.raw_row_hash
  OR retained.raw_row_hash IS DISTINCT FROM original.raw_row_hash OR retained.raw_event_id IS DISTINCT FROM original.raw_event_id
  OR retained.source_document_id IS DISTINCT FROM original.source_document_id OR retained.source_document_line_id IS DISTINCT FROM original.source_document_line_id
  OR retained.domain IS DISTINCT FROM 'PAYABLES' OR retained.accounting_period_id IS DISTINCT FROM proposal.accounting_period_id
  OR classification.accounting_period_id IS DISTINCT FROM proposal.accounting_period_id OR original.accounting_period_id IS DISTINCT FROM proposal.accounting_period_id
  OR classification.source_payload_hash IS DISTINCT FROM document.payload_hash OR proposal.source_payload_hash IS DISTINCT FROM document.payload_hash
  OR asset.source_payload_hash IS DISTINCT FROM document.payload_hash OR asset.source_document_id IS DISTINCT FROM document.source_document_id
  OR document.payload_hash IS DISTINCT FROM original.raw_row_hash OR document.raw_event_id IS DISTINCT FROM original.raw_event_id
  OR document.gross_amount<=0 OR line.amount IS DISTINCT FROM asset.cost_basis OR proposal.amount IS DISTINCT FROM asset.cost_basis
  OR proposal.currency IS DISTINCT FROM asset.currency OR document.currency IS DISTINCT FROM asset.currency
  OR proposal.capitalization_treatment IS DISTINCT FROM 'FIXED_ASSET' OR proposal.asset_account_code IS DISTINCT FROM asset.asset_account_code
  OR to_jsonb(line) IS DISTINCT FROM original.source_line_snapshot
  OR (to_jsonb(document)-ARRAY['status','version','updated_at']) IS DISTINCT FROM (original.source_document_snapshot-ARRAY['status','version','updated_at'])
  OR proposal.member_trace->>'project_ref' IS DISTINCT FROM line.project_ref OR proposal.member_trace->>'property_ref' IS DISTINCT FROM line.property_ref
 THEN RAISE EXCEPTION 'Acquisition classification and original source evidence disagree' USING ERRCODE='23514';END IF;
 SELECT * INTO policy FROM setting_snapshot WHERE tenant_id=p_tenant AND setting_snapshot_id=proposal.policy_snapshot_id FOR SHARE;
 IF NOT FOUND OR policy.snapshot_hash IS DISTINCT FROM refs_jsonb_hash(policy.snapshot) OR policy.snapshot_hash IS DISTINCT FROM proposal.policy_snapshot_hash OR classification.policy_snapshot_id IS DISTINCT FROM proposal.policy_snapshot_id
  OR classification.policy_snapshot_hash IS DISTINCT FROM proposal.policy_snapshot_hash OR policy.family<>'AI_CAPITALIZATION_POLICY'
  OR policy.status NOT IN('APPROVED','RETIRED') OR policy.entity_id IS DISTINCT FROM p_entity OR policy.scope_type<>'ENTITY' OR policy.scope_key<>p_entity::text
  OR policy.snapshot->>'schema_version' IS DISTINCT FROM 'AI_CAPITALIZATION_POLICY_SNAPSHOT_V1' OR policy.snapshot->>'rule_id' IS DISTINCT FROM 'AI_CAPITALIZATION_POLICY_V1'
  OR ARRAY(SELECT jsonb_object_keys(policy.snapshot) ORDER BY 1) IS DISTINCT FROM ARRAY['capitalization_threshold','charge_code_classification','currency','eligible_cost_classes','policy_version','post_completion_treatment','project_status_by_ref','rule_id','schema_version','useful_life_months_by_cost_class']
  OR COALESCE(policy.snapshot->>'capitalization_threshold','')!~'^(0|[1-9][0-9]*)\.[0-9]{4}$'
  OR jsonb_typeof(policy.snapshot->'policy_version') IS DISTINCT FROM 'number' OR jsonb_typeof(policy.snapshot->'eligible_cost_classes') IS DISTINCT FROM 'array'
  OR jsonb_typeof(policy.snapshot->'charge_code_classification') IS DISTINCT FROM 'object' OR jsonb_typeof(policy.snapshot->'project_status_by_ref') IS DISTINCT FROM 'object'
  OR jsonb_typeof(policy.snapshot->'useful_life_months_by_cost_class') IS DISTINCT FROM 'object' OR policy.snapshot->>'post_completion_treatment' IS DISTINCT FROM 'EXPENSE_OR_RECLASS_REVIEW'
  OR policy.snapshot->>'currency' IS DISTINCT FROM document.currency::text
  OR classification.policy_evidence->>'schema_version' IS DISTINCT FROM 'AI_CAPITALIZATION_POLICY_EVIDENCE_V1'
  OR classification.policy_evidence->>'setting_snapshot_id' IS DISTINCT FROM policy.setting_snapshot_id::text OR classification.policy_evidence->>'setting_snapshot_hash' IS DISTINCT FROM policy.snapshot_hash
  OR policy.effective_from>period.ends_on OR (policy.effective_to IS NOT NULL AND policy.effective_to<=period.ends_on)
 THEN RAISE EXCEPTION 'Acquisition capitalization policy identity changed' USING ERRCODE='23514';END IF;
 PERFORM 1 FROM raw_event r JOIN wbs_final1_retained_evidence_admission a ON a.tenant_id=r.tenant_id AND a.entity_id=r.entity_id AND a.wbs_final1_retained_evidence_admission_id=retained.wbs_final1_retained_evidence_admission_id
 WHERE r.tenant_id=p_tenant AND r.entity_id=p_entity AND r.raw_event_id=original.raw_event_id AND r.is_current AND r.superseded_at IS NULL
  AND r.source_record_id=retained.source_record_id AND r.source_version=retained.source_version AND r.payload_hash=a.package_raw_hash FOR SHARE OF r;
 IF NOT FOUND THEN RAISE EXCEPTION 'Acquisition raw source has been superseded or changed' USING ERRCODE='23514';END IF;
 RETURN original;
END;$$;
REVOKE EXECUTE ON FUNCTION refs_validate_asset_original_source(uuid,uuid,uuid) FROM PUBLIC,refs_app;
CREATE TABLE fixed_asset_original_source_binding (
 binding_id uuid PRIMARY KEY REFERENCES fixed_asset_acquisition_binding(binding_id),tenant_id uuid NOT NULL,entity_id uuid NOT NULL,asset_id uuid NOT NULL,journal_entry_id uuid NOT NULL,
 original_evidence_id uuid NOT NULL,original_evidence_hash text NOT NULL,
 FOREIGN KEY(tenant_id,entity_id,asset_id,binding_id,journal_entry_id) REFERENCES fixed_asset_acquisition_binding(tenant_id,entity_id,asset_id,binding_id,journal_entry_id),
 FOREIGN KEY(tenant_id,entity_id,original_evidence_id,original_evidence_hash) REFERENCES wbs_payable_original_row_evidence(tenant_id,entity_id,evidence_id,evidence_hash)
);
ALTER TABLE fixed_asset_original_source_binding ENABLE ROW LEVEL SECURITY;
CREATE POLICY fixed_asset_original_binding_scope ON fixed_asset_original_source_binding USING(tenant_id=refs_current_tenant() AND refs_entity_allowed(entity_id));
CREATE TRIGGER fixed_asset_original_binding_immutable BEFORE UPDATE OR DELETE ON fixed_asset_original_source_binding FOR EACH ROW EXECUTE FUNCTION reject_mutation();
REVOKE ALL ON fixed_asset_original_source_binding FROM PUBLIC,refs_app;
CREATE FUNCTION refs_bind_asset_original_source() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE original wbs_payable_original_row_evidence;payload jsonb;
BEGIN
 original:=refs_validate_asset_original_source(NEW.tenant_id,NEW.entity_id,NEW.asset_id);
 IF NEW.source_document_id<>original.source_document_id OR NEW.source_document_line_id<>original.source_document_line_id OR NEW.source_line_snapshot_hash<>refs_jsonb_hash(original.source_line_snapshot) THEN RAISE EXCEPTION 'Acquisition binding does not identify original source' USING ERRCODE='23514';END IF;
 INSERT INTO fixed_asset_original_source_binding VALUES(NEW.binding_id,NEW.tenant_id,NEW.entity_id,NEW.asset_id,NEW.journal_entry_id,original.evidence_id,original.evidence_hash);
 payload:=jsonb_build_object('schema_version','FIXED_ASSET_ORIGINAL_SOURCE_BINDING_V1','binding_id',NEW.binding_id,'asset_id',NEW.asset_id,'journal_entry_id',NEW.journal_entry_id,'original_evidence_id',original.evidence_id,'original_evidence_hash',original.evidence_hash,'source_document_id',original.source_document_id,'source_document_line_id',original.source_document_line_id,'raw_row_hash',original.raw_row_hash);
 INSERT INTO audit_event(tenant_id,entity_id,event_type,object_type,object_id,action,actor_id,actor_type,permission_used,request_id,correlation_id,after_hash,metadata)
 VALUES(NEW.tenant_id,NEW.entity_id,'FIXED_ASSET_ORIGINAL_SOURCE_BOUND','JOURNAL_ENTRY',NEW.journal_entry_id,'BIND',NEW.created_by,'USER','GL.JE.CREATE',NEW.binding_id::text,NEW.journal_entry_id::text,refs_jsonb_hash(payload),payload);
 INSERT INTO outbox_event(tenant_id,entity_id,aggregate_type,aggregate_id,event_type,payload,payload_hash)
 VALUES(NEW.tenant_id,NEW.entity_id,'JOURNAL_ENTRY',NEW.journal_entry_id,'FIXED_ASSET_ORIGINAL_SOURCE_BOUND',payload,refs_jsonb_hash(payload));
 RETURN NEW;
END;$$;
CREATE TRIGGER fixed_asset_original_source_bind AFTER INSERT ON fixed_asset_acquisition_binding FOR EACH ROW EXECUTE FUNCTION refs_bind_asset_original_source();
DO $$ DECLARE binding fixed_asset_acquisition_binding;original wbs_payable_original_row_evidence;payload jsonb;BEGIN
 FOR binding IN SELECT * FROM fixed_asset_acquisition_binding LOOP
  original:=refs_validate_asset_original_source(binding.tenant_id,binding.entity_id,binding.asset_id);
  IF binding.source_document_id<>original.source_document_id OR binding.source_document_line_id<>original.source_document_line_id OR binding.source_line_snapshot_hash<>refs_jsonb_hash(original.source_line_snapshot) THEN RAISE EXCEPTION 'Historical acquisition lacks matching original evidence' USING ERRCODE='55006';END IF;
  INSERT INTO fixed_asset_original_source_binding VALUES(binding.binding_id,binding.tenant_id,binding.entity_id,binding.asset_id,binding.journal_entry_id,original.evidence_id,original.evidence_hash);
  payload:=jsonb_build_object('schema_version','FIXED_ASSET_ORIGINAL_SOURCE_BINDING_V1','binding_id',binding.binding_id,'asset_id',binding.asset_id,'journal_entry_id',binding.journal_entry_id,'original_evidence_id',original.evidence_id,'original_evidence_hash',original.evidence_hash,'verification_origin','MIGRATION_349');
  INSERT INTO audit_event(tenant_id,entity_id,event_type,object_type,object_id,action,actor_id,actor_type,request_id,correlation_id,after_hash,metadata)
  VALUES(binding.tenant_id,binding.entity_id,'FIXED_ASSET_ORIGINAL_SOURCE_MIGRATED','JOURNAL_ENTRY',binding.journal_entry_id,'VALIDATE',session_user,'SERVICE_ACCOUNT','migration-349:'||binding.binding_id,binding.journal_entry_id::text,refs_jsonb_hash(payload),payload);
  INSERT INTO outbox_event(tenant_id,entity_id,aggregate_type,aggregate_id,event_type,payload,payload_hash)
  VALUES(binding.tenant_id,binding.entity_id,'JOURNAL_ENTRY',binding.journal_entry_id,'FIXED_ASSET_ORIGINAL_SOURCE_MIGRATED',payload,refs_jsonb_hash(payload));
 END LOOP;
END;$$;
CREATE FUNCTION refs_guard_asset_original_source_post() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE binding fixed_asset_acquisition_binding;original wbs_payable_original_row_evidence;
BEGIN
 SELECT * INTO binding FROM fixed_asset_acquisition_binding WHERE tenant_id=NEW.tenant_id AND entity_id=NEW.entity_id AND journal_entry_id=NEW.journal_entry_id;
 IF NOT FOUND THEN RETURN NEW;END IF;
 original:=refs_validate_asset_original_source(NEW.tenant_id,NEW.entity_id,binding.asset_id);
 PERFORM 1 FROM fixed_asset_original_source_binding WHERE binding_id=binding.binding_id AND tenant_id=NEW.tenant_id AND entity_id=NEW.entity_id AND original_evidence_id=original.evidence_id AND original_evidence_hash=original.evidence_hash;
 IF NOT FOUND THEN RAISE EXCEPTION 'Acquisition original evidence binding is missing' USING ERRCODE='23514';END IF;
 RETURN NEW;
END;$$;
CREATE TRIGGER fixed_asset_source_original_post_guard BEFORE UPDATE OF status ON journal_entry FOR EACH ROW WHEN(NEW.status='POSTED' AND OLD.status<>'POSTED') EXECUTE FUNCTION refs_guard_asset_original_source_post();
REVOKE EXECUTE ON FUNCTION refs_bind_asset_original_source(),refs_guard_asset_original_source_post() FROM PUBLIC,refs_app;
COMMIT;
