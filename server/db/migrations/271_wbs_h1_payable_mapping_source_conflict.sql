BEGIN;

CREATE TABLE wbs_h1_payable_mapping_source_conflict(
  conflict_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  entity_id uuid NOT NULL,
  source_record_hash text NOT NULL CHECK(source_record_hash~'^sha256:[0-9a-f]{64}$'),
  retained_company_code text NOT NULL CHECK(retained_company_code~'^[A-Z0-9][A-Z0-9_:-]{0,63}$'),
  retained_period_code text NOT NULL CHECK(retained_period_code~'^2026-0[1-6]$'),
  retained_wbs_uuid text NOT NULL CHECK(length(retained_wbs_uuid) BETWEEN 1 AND 128 AND retained_wbs_uuid!~'[[:cntrl:]]'),
  retained_accounting_date date NOT NULL,
  retained_amount numeric(24,4) NOT NULL CHECK(retained_amount<>0),
  retained_project_code text,
  retained_cost_code text,
  retained_vendor_no text,
  retained_source_fact_hash text NOT NULL CHECK(retained_source_fact_hash~'^sha256:[0-9a-f]{64}$'),
  retained_provider_content_hash text NOT NULL CHECK(retained_provider_content_hash~'^sha256:[0-9a-f]{64}$'),
  retained_captured_at timestamptz NOT NULL,
  observed_company_code text NOT NULL CHECK(observed_company_code~'^[A-Z0-9][A-Z0-9_:-]{0,63}$'),
  observed_period_code text NOT NULL CHECK(observed_period_code~'^2026-0[1-6]$'),
  observed_wbs_uuid text NOT NULL CHECK(length(observed_wbs_uuid) BETWEEN 1 AND 128 AND observed_wbs_uuid!~'[[:cntrl:]]'),
  observed_accounting_date date NOT NULL,
  observed_amount numeric(24,4) NOT NULL CHECK(observed_amount<>0),
  observed_project_code text,
  observed_cost_code text,
  observed_vendor_no text,
  observed_source_fact_hash text NOT NULL CHECK(observed_source_fact_hash~'^sha256:[0-9a-f]{64}$'),
  observed_provider_content_hash text NOT NULL CHECK(observed_provider_content_hash~'^sha256:[0-9a-f]{64}$'),
  observed_captured_at timestamptz NOT NULL,
  retained_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  FOREIGN KEY(tenant_id,entity_id,source_record_hash)
    REFERENCES wbs_h1_payable_mapping_source_stage(tenant_id,entity_id,source_record_hash),
  UNIQUE(tenant_id,entity_id,source_record_hash,observed_source_fact_hash,observed_provider_content_hash),
  CHECK(retained_source_fact_hash<>observed_source_fact_hash),
  CHECK(retained_project_code IS NULL OR length(retained_project_code) BETWEEN 1 AND 128 AND retained_project_code!~'[[:cntrl:]]'),
  CHECK(retained_cost_code IS NULL OR length(retained_cost_code) BETWEEN 1 AND 128 AND retained_cost_code!~'[[:cntrl:]]'),
  CHECK(retained_vendor_no IS NULL OR length(retained_vendor_no) BETWEEN 1 AND 128 AND retained_vendor_no!~'[[:cntrl:]]'),
  CHECK(observed_project_code IS NULL OR length(observed_project_code) BETWEEN 1 AND 128 AND observed_project_code!~'[[:cntrl:]]'),
  CHECK(observed_cost_code IS NULL OR length(observed_cost_code) BETWEEN 1 AND 128 AND observed_cost_code!~'[[:cntrl:]]'),
  CHECK(observed_vendor_no IS NULL OR length(observed_vendor_no) BETWEEN 1 AND 128 AND observed_vendor_no!~'[[:cntrl:]]')
);

CREATE INDEX wbs_h1_payable_mapping_source_conflict_scope_idx
  ON wbs_h1_payable_mapping_source_conflict(tenant_id,entity_id,source_record_hash,retained_at);
CREATE TRIGGER wbs_h1_payable_mapping_source_conflict_append_only
  BEFORE UPDATE OR DELETE ON wbs_h1_payable_mapping_source_conflict
  FOR EACH ROW EXECUTE FUNCTION reject_mutation();
ALTER TABLE wbs_h1_payable_mapping_source_conflict ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE wbs_h1_payable_mapping_source_conflict FROM PUBLIC,refs_app;

CREATE FUNCTION refs_retain_wbs_h1_payable_mapping_source_rows(p_rows jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE item record; retained wbs_h1_payable_mapping_source_stage; expected_count integer;
DECLARE exact_count integer:=0; inserted_count integer:=0; conflict_count integer:=0; conflict_inserted_count integer:=0;
DECLARE conflict_facts jsonb:='[]'::jsonb;
BEGIN
  IF jsonb_typeof(p_rows)<>'array' OR jsonb_array_length(p_rows) NOT BETWEEN 1 AND 5000 THEN
    RAISE EXCEPTION 'WBS H1 Payable mapping source batch is invalid' USING ERRCODE='22023';
  END IF;
  expected_count:=jsonb_array_length(p_rows);
  IF (SELECT count(DISTINCT (value->>'tenant_id',value->>'entity_id',value->>'source_record_hash')) FROM jsonb_array_elements(p_rows))<>expected_count THEN
    RAISE EXCEPTION 'WBS H1 Payable mapping source batch has duplicate identities' USING ERRCODE='22023';
  END IF;

  FOR item IN SELECT * FROM jsonb_to_recordset(p_rows) AS x(
    tenant_id uuid,entity_id uuid,company_code text,period_code text,wbs_uuid text,
    source_record_hash text,accounting_date date,amount numeric(24,4),project_code text,
    cost_code text,vendor_no text,source_fact_hash text,provider_content_hash text,captured_at timestamptz)
  LOOP
    SELECT * INTO retained FROM wbs_h1_payable_mapping_source_stage
      WHERE tenant_id=item.tenant_id AND entity_id=item.entity_id AND source_record_hash=item.source_record_hash FOR UPDATE;
    IF NOT FOUND THEN
      INSERT INTO wbs_h1_payable_mapping_source_stage(tenant_id,entity_id,company_code,period_code,wbs_uuid,source_record_hash,
        accounting_date,amount,project_code,cost_code,vendor_no,source_fact_hash,provider_content_hash,captured_at)
      VALUES(item.tenant_id,item.entity_id,item.company_code,item.period_code,item.wbs_uuid,item.source_record_hash,
        item.accounting_date,item.amount,item.project_code,item.cost_code,item.vendor_no,item.source_fact_hash,item.provider_content_hash,item.captured_at);
      inserted_count:=inserted_count+1; exact_count:=exact_count+1;
    ELSIF retained.source_fact_hash=item.source_fact_hash THEN
      exact_count:=exact_count+1;
    ELSE
      conflict_count:=conflict_count+1;
      INSERT INTO wbs_h1_payable_mapping_source_conflict(tenant_id,entity_id,source_record_hash,
        retained_company_code,retained_period_code,retained_wbs_uuid,retained_accounting_date,retained_amount,
        retained_project_code,retained_cost_code,retained_vendor_no,retained_source_fact_hash,retained_provider_content_hash,retained_captured_at,
        observed_company_code,observed_period_code,observed_wbs_uuid,observed_accounting_date,observed_amount,
        observed_project_code,observed_cost_code,observed_vendor_no,observed_source_fact_hash,observed_provider_content_hash,observed_captured_at)
      VALUES(item.tenant_id,item.entity_id,item.source_record_hash,
        retained.company_code,retained.period_code,retained.wbs_uuid,retained.accounting_date,retained.amount,
        retained.project_code,retained.cost_code,retained.vendor_no,retained.source_fact_hash,retained.provider_content_hash,retained.captured_at,
        item.company_code,item.period_code,item.wbs_uuid,item.accounting_date,item.amount,
        item.project_code,item.cost_code,item.vendor_no,item.source_fact_hash,item.provider_content_hash,item.captured_at)
      ON CONFLICT DO NOTHING;
      IF FOUND THEN conflict_inserted_count:=conflict_inserted_count+1; END IF;
      conflict_facts:=conflict_facts||jsonb_build_array(jsonb_build_object(
        'source_record_hash',item.source_record_hash,'retained_source_fact_hash',retained.source_fact_hash,
        'observed_source_fact_hash',item.source_fact_hash,'observed_provider_content_hash',item.provider_content_hash));
    END IF;
  END LOOP;

  SELECT coalesce(jsonb_agg(value ORDER BY value->>'source_record_hash',value->>'observed_source_fact_hash'),'[]'::jsonb)
    INTO conflict_facts FROM jsonb_array_elements(conflict_facts);
  RETURN jsonb_build_object('schema_version','WBS_H1_PAYABLE_MAPPING_SOURCE_RETENTION_V1',
    'expected_count',expected_count,'exact_count',exact_count,'inserted_count',inserted_count,
    'conflict_count',conflict_count,'conflict_inserted_count',conflict_inserted_count,
    'conflict_receipt_hash',refs_jsonb_hash(jsonb_build_object('conflicts',conflict_facts)));
END $$;

REVOKE ALL ON FUNCTION refs_retain_wbs_h1_payable_mapping_source_rows(jsonb) FROM PUBLIC,refs_app;

DO $migration$
DECLARE definition text;
BEGIN
  SELECT pg_get_functiondef('public.refs_read_wbs_h1_payable_accounting_proposal(uuid,uuid,uuid,integer,integer)'::regprocedure) INTO definition;
  IF position('SELECT s.*,coalesce(c.cost_code,s.cost_code) exact_cost_code' IN definition)=0
     OR position('array_remove(ARRAY[' IN definition)=0 THEN
    RAISE EXCEPTION 'Migration 271 requires the exact WBS H1 Payable proposal reader' USING ERRCODE='55000';
  END IF;
  definition:=replace(definition,
    'SELECT s.*,coalesce(c.cost_code,s.cost_code) exact_cost_code',
    'SELECT s.*,coalesce(c.cost_code,s.cost_code) exact_cost_code,
      EXISTS(SELECT 1 FROM wbs_h1_payable_mapping_source_conflict f
        WHERE f.tenant_id=s.tenant_id AND f.entity_id=s.entity_id
          AND f.source_record_hash=s.source_record_hash) source_drift_unresolved');
  definition:=replace(definition,'array_remove(ARRAY[','array_remove(ARRAY[
        CASE WHEN m.source_drift_unresolved THEN ''SOURCE_FACT_DRIFT_UNRESOLVED'' END,');
  EXECUTE definition;

  SELECT pg_get_functiondef('public.refs_create_wbs_h1_payable_reclass_draft(uuid,uuid,uuid,text,text,text,text,text)'::regprocedure) INTO definition;
  IF position('SELECT * INTO source_row FROM wbs_h1_payable_mapping_source_stage
    WHERE tenant_id=p_tenant AND entity_id=p_entity AND source_record_hash=p_source_record_hash FOR SHARE;' IN definition)=0
     OR position('WBS H1 Payable source evidence changed or has no controlled posted baseline' IN definition)=0
     OR position('SELECT * INTO trace FROM wbs_test_import_draft' IN definition)=0 THEN
    RAISE EXCEPTION 'Migration 271 requires the exact WBS H1 Payable Draft function' USING ERRCODE='55000';
  END IF;
  definition:=replace(definition,
    'SELECT * INTO trace FROM wbs_test_import_draft',
    'PERFORM 1 FROM wbs_h1_payable_mapping_source_conflict
    WHERE tenant_id=p_tenant AND entity_id=p_entity AND source_record_hash=p_source_record_hash FOR SHARE;
  IF FOUND THEN
    RAISE EXCEPTION ''WBS H1 Payable source has unresolved retained-versus-observed fact drift'' USING ERRCODE=''40001'';
  END IF;

  SELECT * INTO trace FROM wbs_test_import_draft');
  EXECUTE definition;
END
$migration$;

COMMIT;
