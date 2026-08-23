BEGIN;

DO $migration$
DECLARE definition text;
BEGIN
  IF EXISTS(SELECT 1 FROM wbs_h1_payable_mapping_source_conflict) THEN
    RAISE EXCEPTION 'REFUSE DATA LOSS: retained WBS H1 Payable source conflict evidence exists' USING ERRCODE='55000';
  END IF;

  SELECT pg_get_functiondef('public.refs_create_wbs_h1_payable_reclass_draft(uuid,uuid,uuid,text,text,text,text,text)'::regprocedure) INTO definition;
  IF position('WBS H1 Payable source has unresolved retained-versus-observed fact drift' IN definition)=0 THEN
    RAISE EXCEPTION 'Migration 271 down requires the exact migration 271 Draft function' USING ERRCODE='55000';
  END IF;
  definition:=replace(definition,
    'SELECT * INTO source_row FROM wbs_h1_payable_mapping_source_stage
    WHERE tenant_id=p_tenant AND entity_id=p_entity AND source_record_hash=p_source_record_hash FOR SHARE;
  PERFORM 1 FROM wbs_h1_payable_mapping_source_conflict
    WHERE tenant_id=p_tenant AND entity_id=p_entity AND source_record_hash=p_source_record_hash FOR SHARE;
  IF FOUND THEN
    RAISE EXCEPTION ''WBS H1 Payable source has unresolved retained-versus-observed fact drift'' USING ERRCODE=''40001'';
  END IF;',
    'SELECT * INTO source_row FROM wbs_h1_payable_mapping_source_stage
    WHERE tenant_id=p_tenant AND entity_id=p_entity AND source_record_hash=p_source_record_hash FOR SHARE;');
  EXECUTE definition;

  SELECT pg_get_functiondef('public.refs_read_wbs_h1_payable_accounting_proposal(uuid,uuid,uuid,integer,integer)'::regprocedure) INTO definition;
  IF position('SOURCE_FACT_DRIFT_UNRESOLVED' IN definition)=0 THEN
    RAISE EXCEPTION 'Migration 271 down requires the exact migration 271 proposal reader' USING ERRCODE='55000';
  END IF;
  definition:=replace(definition,
    '        CASE WHEN m.source_drift_unresolved THEN ''SOURCE_FACT_DRIFT_UNRESOLVED'' END,
', '');
  definition:=replace(definition,
    'SELECT s.*,coalesce(c.cost_code,s.cost_code) exact_cost_code,
      EXISTS(SELECT 1 FROM wbs_h1_payable_mapping_source_conflict f
        WHERE f.tenant_id=s.tenant_id AND f.entity_id=s.entity_id
          AND f.source_record_hash=s.source_record_hash) source_drift_unresolved',
    'SELECT s.*,coalesce(c.cost_code,s.cost_code) exact_cost_code');
  EXECUTE definition;
END
$migration$;

DROP FUNCTION refs_retain_wbs_h1_payable_mapping_source_rows(jsonb);
DROP TABLE wbs_h1_payable_mapping_source_conflict;

COMMIT;
