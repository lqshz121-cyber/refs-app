BEGIN;
-- Blocking installation: drain accounting/source writers before applying.
LOCK TABLE source_document,source_document_line,wbs_final1_retained_source_row IN ACCESS EXCLUSIVE MODE;
CREATE FUNCTION refs_original_payable_snapshot_hash(p_tenant uuid,p_entity uuid,p_retained uuid,p_document uuid,p_line uuid,p_raw_event uuid,p_period uuid,p_raw_hash text,p_raw jsonb,p_normalized jsonb,p_document_snapshot jsonb,p_line_snapshot jsonb) RETURNS text
LANGUAGE sql IMMUTABLE SET search_path=pg_catalog,public,pg_temp AS $$
 SELECT refs_jsonb_hash(jsonb_build_object('schema_version','WBS_PAYABLE_ORIGINAL_ROW_V1','tenant_id',p_tenant,'entity_id',p_entity,'retained_source_row_id',p_retained,'source_document_id',p_document,'source_document_line_id',p_line,'raw_event_id',p_raw_event,'accounting_period_id',p_period,'raw_row_hash',p_raw_hash,'raw_row',p_raw,'normalized_row',p_normalized,'source_document_snapshot',p_document_snapshot,'source_line_snapshot',p_line_snapshot))
$$;
CREATE TABLE wbs_payable_original_row_evidence (
 evidence_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 tenant_id uuid NOT NULL,entity_id uuid NOT NULL,retained_source_row_id uuid NOT NULL,
 source_document_id uuid NOT NULL,source_document_line_id uuid NOT NULL,
 raw_event_id uuid NOT NULL,accounting_period_id uuid,
 raw_row_hash text NOT NULL,raw_row jsonb NOT NULL,normalized_row jsonb NOT NULL,
 source_document_snapshot jsonb NOT NULL,source_line_snapshot jsonb NOT NULL,
 evidence_hash text GENERATED ALWAYS AS (refs_original_payable_snapshot_hash(tenant_id,entity_id,retained_source_row_id,source_document_id,source_document_line_id,raw_event_id,accounting_period_id,raw_row_hash,raw_row,normalized_row,source_document_snapshot,source_line_snapshot)) STORED,
 retained_by text NOT NULL,retained_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 UNIQUE(tenant_id,entity_id,retained_source_row_id),
 UNIQUE(tenant_id,entity_id,source_document_line_id),
 FOREIGN KEY(tenant_id,entity_id,retained_source_row_id) REFERENCES wbs_final1_retained_source_row(tenant_id,entity_id,wbs_final1_retained_source_row_id),
 FOREIGN KEY(tenant_id,entity_id,source_document_id,source_document_line_id) REFERENCES source_document_line(tenant_id,entity_id,source_document_id,source_document_line_id),
 FOREIGN KEY(tenant_id,raw_event_id) REFERENCES raw_event(tenant_id,raw_event_id),
 CHECK(jsonb_typeof(raw_row)='object' AND jsonb_typeof(normalized_row)='object'),
 CHECK(raw_row_hash=refs_canonical_jsonb_hash(raw_row)),
 CHECK(jsonb_typeof(source_document_snapshot)='object' AND jsonb_typeof(source_line_snapshot)='object')
);
ALTER TABLE wbs_payable_original_row_evidence ENABLE ROW LEVEL SECURITY;
CREATE POLICY wbs_payable_original_row_scope ON wbs_payable_original_row_evidence USING(tenant_id=refs_current_tenant() AND refs_entity_allowed(entity_id));
CREATE TRIGGER wbs_payable_original_row_append_only BEFORE UPDATE OR DELETE ON wbs_payable_original_row_evidence FOR EACH ROW EXECUTE FUNCTION reject_mutation();
REVOKE ALL ON wbs_payable_original_row_evidence FROM PUBLIC,refs_app;
CREATE FUNCTION refs_emit_original_payable_evidence() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE payload jsonb:=jsonb_build_object('schema_version','WBS_PAYABLE_ORIGINAL_ROW_V1','evidence_id',NEW.evidence_id,'source_document_id',NEW.source_document_id,'source_document_line_id',NEW.source_document_line_id,'retained_source_row_id',NEW.retained_source_row_id,'raw_row_hash',NEW.raw_row_hash,'evidence_hash',NEW.evidence_hash);
BEGIN
 INSERT INTO audit_event(tenant_id,entity_id,event_type,object_type,object_id,action,actor_id,actor_type,permission_used,request_id,correlation_id,after_hash,metadata)
 VALUES(NEW.tenant_id,NEW.entity_id,'WBS_PAYABLE_ORIGINAL_EVIDENCE_RETAINED','WBS_SOURCE_EVIDENCE',NEW.evidence_id,'RETAIN',NEW.retained_by,'SERVICE_ACCOUNT','WBS.SNAPSHOT.IMPORT',NEW.evidence_id::text,NEW.retained_source_row_id::text,NEW.evidence_hash,payload);
 INSERT INTO outbox_event(tenant_id,entity_id,aggregate_type,aggregate_id,event_type,payload,payload_hash)
 VALUES(NEW.tenant_id,NEW.entity_id,'WBS_SOURCE',NEW.source_document_id,'WBS_PAYABLE_ORIGINAL_EVIDENCE_RETAINED',payload,refs_jsonb_hash(payload));
 RETURN NEW;
END;$$;
CREATE TRIGGER original_payable_evidence_event AFTER INSERT ON wbs_payable_original_row_evidence FOR EACH ROW EXECUTE FUNCTION refs_emit_original_payable_evidence();
REVOKE EXECUTE ON FUNCTION refs_emit_original_payable_evidence(),refs_original_payable_snapshot_hash(uuid,uuid,uuid,uuid,uuid,uuid,uuid,text,jsonb,jsonb,jsonb,jsonb) FROM PUBLIC,refs_app;

CREATE FUNCTION refs_guard_original_payable_line() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
BEGIN
 IF EXISTS(SELECT 1 FROM wbs_payable_original_row_evidence WHERE tenant_id=OLD.tenant_id AND entity_id=OLD.entity_id AND source_document_line_id=OLD.source_document_line_id)
 AND (TG_OP='DELETE' OR to_jsonb(NEW) IS DISTINCT FROM to_jsonb(OLD)) THEN
  RAISE EXCEPTION 'Original retained payable line cannot be changed; retain a corrected source version' USING ERRCODE='23514';
 END IF;
 IF TG_OP='DELETE' THEN RETURN OLD;END IF;RETURN NEW;
END;$$;
CREATE TRIGGER original_payable_line_guard BEFORE UPDATE OR DELETE ON source_document_line FOR EACH ROW EXECUTE FUNCTION refs_guard_original_payable_line();
CREATE FUNCTION refs_guard_original_payable_document() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
BEGIN
 IF EXISTS(SELECT 1 FROM wbs_payable_original_row_evidence WHERE tenant_id=OLD.tenant_id AND entity_id=OLD.entity_id AND source_document_id=OLD.source_document_id)
 AND (TG_OP='DELETE' OR (to_jsonb(NEW)-ARRAY['status','version','updated_at']) IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['status','version','updated_at'])) THEN
  RAISE EXCEPTION 'Original retained payable document evidence cannot be changed' USING ERRCODE='23514';
 END IF;
 IF TG_OP='DELETE' THEN RETURN OLD;END IF;RETURN NEW;
END;$$;
CREATE TRIGGER original_payable_document_guard BEFORE UPDATE OR DELETE ON source_document FOR EACH ROW EXECUTE FUNCTION refs_guard_original_payable_document();

ALTER FUNCTION refs_retain_wbs_final1_source_evidence_with_signed_controls(uuid,uuid,jsonb,jsonb,jsonb,text,text) RENAME TO refs_retain_final1_signed_source_v298;
REVOKE ALL ON FUNCTION refs_retain_final1_signed_source_v298(uuid,uuid,jsonb,jsonb,jsonb,text,text) FROM PUBLIC,refs_app;
CREATE FUNCTION refs_retain_wbs_final1_source_evidence_with_signed_controls(p_tenant uuid,p_entity uuid,p_delivery jsonb,p_artifacts jsonb,p_plan jsonb,p_idempotency_key text,p_request_hash text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE result jsonb;row_value jsonb;raw jsonb;normalized jsonb;retained wbs_final1_retained_source_row;existing wbs_payable_original_row_evidence;document source_document;line source_document_line;current_xid text:=(txid_current()%4294967296)::text;
BEGIN
 PERFORM refs_assert_scope(p_tenant,p_entity,'WBS.SNAPSHOT.IMPORT');
 IF p_delivery->>'domain'='PAYABLES' THEN
  IF jsonb_typeof(p_plan->'staging_rows') IS DISTINCT FROM 'array' THEN RAISE EXCEPTION 'Original payable rows are required' USING ERRCODE='23514';END IF;
  FOR row_value IN SELECT value FROM jsonb_array_elements(p_plan->'staging_rows') LOOP
   raw:=row_value->'raw_row';normalized:=row_value->'normalized';
   IF jsonb_typeof(raw) IS DISTINCT FROM 'object' OR jsonb_typeof(normalized) IS DISTINCT FROM 'object'
    OR row_value->>'raw_row_hash' IS DISTINCT FROM refs_canonical_jsonb_hash(raw)
    OR raw->>'ap_guid' IS DISTINCT FROM row_value->>'source_record_id'
    OR raw->>'company_code' IS DISTINCT FROM p_delivery->>'company_code'
    OR raw->>'amount' IS DISTINCT FROM normalized->>'amount'
    OR NULLIF(btrim(raw->>'vendor_no'),'') IS DISTINCT FROM NULLIF(normalized->>'vendorRef','')
    OR NULLIF(btrim(raw->>'vendor_name'),'') IS DISTINCT FROM NULLIF(normalized->>'vendorName','')
    OR NULLIF(btrim(raw->>'project_guid'),'') IS DISTINCT FROM NULLIF(normalized->>'projectRef','')
    OR NULLIF(btrim(raw->>'controlled_property_ref'),'') IS DISTINCT FROM COALESCE(NULLIF(normalized->>'propertyRef',''),NULLIF(normalized->>'controlledPropertyRef',''))
    OR NULLIF(btrim(raw->>'charge_code'),'') IS DISTINCT FROM NULLIF(normalized->>'chargeCode','')
    OR NULLIF(btrim(raw->>'contract_id'),'') IS DISTINCT FROM NULLIF(normalized->>'contractId','')
    OR NULLIF(btrim(raw->>'service_period_start'),'') IS DISTINCT FROM NULLIF(normalized->>'servicePeriodStart','')
    OR NULLIF(btrim(raw->>'service_period_end'),'') IS DISTINCT FROM NULLIF(normalized->>'servicePeriodEnd','')
    OR NULLIF(btrim(raw->>'invoice_no'),'') IS DISTINCT FROM NULLIF(normalized->>'invoiceNo','')
    OR NULLIF(btrim(raw->>'invoice_date'),'') IS DISTINCT FROM NULLIF(normalized->>'invoiceDate','')
    OR NULLIF(btrim(raw->>'posting_date'),'') IS DISTINCT FROM NULLIF(normalized->>'postingDate','')
    OR NULLIF(btrim(raw->>'incurred_date'),'') IS DISTINCT FROM NULLIF(normalized->>'incurredDate','') THEN
    RAISE EXCEPTION 'Original payable row hash or normalized accounting facts disagree' USING ERRCODE='23514';
   END IF;
  END LOOP;
 END IF;
 result:=refs_retain_final1_signed_source_v298(p_tenant,p_entity,p_delivery,p_artifacts,p_plan,p_idempotency_key,p_request_hash);
 IF p_delivery->>'domain'<>'PAYABLES' THEN RETURN result;END IF;
 FOR row_value IN SELECT value FROM jsonb_array_elements(p_plan->'staging_rows') LOOP
  SELECT * INTO retained FROM wbs_final1_retained_source_row WHERE tenant_id=p_tenant AND entity_id=p_entity AND wbs_final1_retained_evidence_admission_id=(result->>'admission_id')::uuid AND source_record_id=row_value->>'source_record_id' AND raw_row_hash=row_value->>'raw_row_hash';
  IF NOT FOUND THEN RAISE EXCEPTION 'Original payable retained identity is missing' USING ERRCODE='23514';END IF;
  SELECT * INTO existing FROM wbs_payable_original_row_evidence WHERE tenant_id=p_tenant AND entity_id=p_entity AND retained_source_row_id=retained.wbs_final1_retained_source_row_id;
  IF FOUND THEN
   IF existing.raw_row IS DISTINCT FROM row_value->'raw_row' OR existing.normalized_row IS DISTINCT FROM row_value->'normalized' THEN RAISE EXCEPTION 'Original payable replay evidence differs' USING ERRCODE='23514';END IF;
   CONTINUE;
  END IF;
  -- Never certify an older normalized row as original just by replaying a request.
  -- This row is append-only: unlike mutable source tuples, its xmin cannot be
  -- refreshed by a no-op business UPDATE in a later replay transaction.
  PERFORM 1 FROM wbs_final1_retained_source_row WHERE tenant_id=p_tenant AND entity_id=p_entity AND wbs_final1_retained_source_row_id=retained.wbs_final1_retained_source_row_id AND xmin::text=current_xid;
  IF NOT FOUND THEN RAISE EXCEPTION 'Historical retained identity cannot be certified by replay' USING ERRCODE='55006';END IF;
  PERFORM 1 FROM source_document WHERE tenant_id=p_tenant AND entity_id=p_entity AND source_document_id=retained.source_document_id AND xmin::text=current_xid;
  IF NOT FOUND THEN RAISE EXCEPTION 'Historical payable requires original source re-verification' USING ERRCODE='55006';END IF;
  SELECT * INTO document FROM source_document WHERE tenant_id=p_tenant AND entity_id=p_entity AND source_document_id=retained.source_document_id FOR UPDATE;
  SELECT * INTO line FROM source_document_line WHERE tenant_id=p_tenant AND entity_id=p_entity AND source_document_id=retained.source_document_id AND source_document_line_id=retained.source_document_line_id AND xmin::text=current_xid FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Historical payable line cannot be certified from current values' USING ERRCODE='55006';END IF;
  INSERT INTO wbs_payable_original_row_evidence(tenant_id,entity_id,retained_source_row_id,source_document_id,source_document_line_id,raw_event_id,accounting_period_id,raw_row_hash,raw_row,normalized_row,source_document_snapshot,source_line_snapshot,retained_by)
  VALUES(p_tenant,p_entity,retained.wbs_final1_retained_source_row_id,retained.source_document_id,retained.source_document_line_id,retained.raw_event_id,retained.accounting_period_id,retained.raw_row_hash,row_value->'raw_row',row_value->'normalized',to_jsonb(document),to_jsonb(line),refs_current_actor());
 END LOOP;
 RETURN result;
END;$$;
REVOKE EXECUTE ON FUNCTION refs_guard_original_payable_line(),refs_guard_original_payable_document() FROM PUBLIC,refs_app;
REVOKE ALL ON FUNCTION refs_retain_wbs_final1_source_evidence_with_signed_controls(uuid,uuid,jsonb,jsonb,jsonb,text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION refs_retain_wbs_final1_source_evidence_with_signed_controls(uuid,uuid,jsonb,jsonb,jsonb,text,text) TO refs_app;
COMMIT;
