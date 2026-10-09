-- Bounded human Bank import request; distinct from service execution.
-- Request authority only: never imports, starts reconciliation, matches or posts.
BEGIN;
INSERT INTO permission_catalog(permission_code,domain,risk_class,sod_class)
VALUES('WBS.TEST.BANK.IMPORT.REQUEST','WBS','HIGH','BANK_IMPORT_REQUEST')
ON CONFLICT(permission_code) DO UPDATE SET active=true,domain=EXCLUDED.domain,
  risk_class=EXCLUDED.risk_class,sod_class=EXCLUDED.sod_class,
  version=permission_catalog.version+1,effective_to=NULL;
INSERT INTO runtime_human_permission_authority(permission_code,authority_class)
VALUES('WBS.TEST.BANK.IMPORT.REQUEST','BANK_IMPORT_REQUEST');

CREATE FUNCTION refs_assert_bounded_wbs_bank_import_request(
  p_tenant uuid,p_entity uuid,p_period uuid,p_company text,
  p_from date,p_to date,p_limit integer
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE selected_period accounting_period; fence_generation integer;
BEGIN
  PERFORM refs_assert_scope(p_tenant,p_entity,'WBS.TEST.BANK.IMPORT.REQUEST');
  LOCK TABLE public.refs_deployment_identity IN SHARE MODE;
  SELECT generation INTO fence_generation FROM refs_deployment_identity_fence WHERE singleton FOR SHARE;
  IF fence_generation IS DISTINCT FROM 1 OR NOT EXISTS(
    SELECT 1 FROM refs_deployment_identity WHERE singleton
      AND deployment_environment='staging' AND database_name=current_database()
  ) THEN RAISE EXCEPTION 'Registered staging request target required' USING ERRCODE='42501'; END IF;
  IF p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 10 OR p_company IS NULL THEN
    RAISE EXCEPTION 'Bounded Bank request required' USING ERRCODE='22023';
  END IF;
  PERFORM 1 FROM entity WHERE tenant_id=p_tenant AND entity_id=p_entity
    AND active AND source_system='WBS' AND entity_code=p_company AND source_entity_id=p_company FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Exact active WBS company required' USING ERRCODE='42501'; END IF;
  SELECT * INTO selected_period FROM accounting_period
    WHERE tenant_id=p_tenant AND entity_id=p_entity AND period_id=p_period
      AND ledger_code='PRIMARY' AND status='OPEN' FOR SHARE;
  IF NOT FOUND OR selected_period.period_code !~ '^2026-0[1-6]$'
    OR selected_period.starts_on IS DISTINCT FROM (selected_period.period_code||'-01')::date
    OR selected_period.ends_on IS DISTINCT FROM (date_trunc('month',selected_period.starts_on)+interval '1 month - 1 day')::date
    OR p_from IS DISTINCT FROM selected_period.starts_on OR p_to IS DISTINCT FROM selected_period.ends_on THEN
    RAISE EXCEPTION 'Exact OPEN H1 monthly request scope required' USING ERRCODE='55000';
  END IF;
END;
$$;
REVOKE ALL ON FUNCTION refs_assert_bounded_wbs_bank_import_request(uuid,uuid,uuid,text,date,date,integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION refs_assert_bounded_wbs_bank_import_request(uuid,uuid,uuid,text,date,date,integer) TO refs_app;
CREATE FUNCTION refs_bounded_wbs_bank_request_ready() RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
  SELECT EXISTS(SELECT 1 FROM permission_catalog p JOIN runtime_human_permission_authority h USING(permission_code)
    WHERE p.permission_code='WBS.TEST.BANK.IMPORT.REQUEST' AND p.active AND h.authority_class='BANK_IMPORT_REQUEST')
    AND NOT EXISTS(SELECT 1 FROM runtime_service_only_permission WHERE permission_code='WBS.TEST.BANK.IMPORT.REQUEST');
$$;
REVOKE ALL ON FUNCTION refs_bounded_wbs_bank_request_ready() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION refs_bounded_wbs_bank_request_ready() TO refs_app,refs_runtime;
COMMIT;
