BEGIN;

CREATE OR REPLACE FUNCTION refs_read_wbs_h1_month_completion(
  p_tenant uuid,p_entity uuid,p_company_code text,p_period_code text
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE result jsonb;
BEGIN
  PERFORM refs_assert_scope(p_tenant,p_entity,'WBS.TEST.IMPORT');
  IF p_company_code IS NULL OR p_company_code !~ '^[A-Z0-9][A-Z0-9_:-]{0,63}$'
     OR p_period_code !~ '^2026-0[1-6]$' THEN
    RAISE EXCEPTION 'WBS H1 completion scope is invalid' USING ERRCODE='22023';
  END IF;

  WITH period_scope AS (
    SELECT period_id,starts_on,ends_on
    FROM accounting_period
    WHERE tenant_id=p_tenant AND entity_id=p_entity AND period_code=p_period_code
      AND starts_on=(p_period_code||'-01')::date AND status='OPEN'
  ), payable AS (
    SELECT count(*)::integer AS month_count
    FROM wbs_test_import_draft d JOIN period_scope p ON p.period_id=d.period_id
    WHERE d.tenant_id=p_tenant AND d.entity_id=p_entity
  ), h1 AS (
    SELECT count(*)::integer AS h1_count
    FROM wbs_test_import_draft d
    JOIN accounting_period hp ON hp.tenant_id=d.tenant_id AND hp.entity_id=d.entity_id AND hp.period_id=d.period_id
    WHERE d.tenant_id=p_tenant AND d.entity_id=p_entity
      AND hp.period_code BETWEEN '2026-01' AND '2026-06'
      AND hp.starts_on BETWEEN DATE '2026-01-01' AND DATE '2026-06-01'
      AND hp.ends_on BETWEEN DATE '2026-01-31' AND DATE '2026-06-30'
  ), bank AS (
    SELECT count(*)::integer AS import_count,coalesce(sum(b.row_count),0)::integer AS row_count,
      (array_agg(b.reconciliation_id ORDER BY b.reconciliation_id)
        FILTER (WHERE b.reconciliation_id IS NOT NULL))[1]::text AS reconciliation_id
    FROM period_scope p
    LEFT JOIN wbs_controlled_test_bank_import b
      ON b.tenant_id=p_tenant AND b.entity_id=p_entity AND b.period_id=p.period_id
      AND b.company_code=p_company_code
      AND b.bank_account_ref='WBS_TEST_BANK_'||replace(p_period_code,'-','_')
  )
  SELECT jsonb_build_object(
    'period_id',p.period_id::text,'starts_on',p.starts_on::text,'ends_on',p.ends_on::text,
    'h1_count',h.h1_count,'month_count',q.month_count,'import_count',b.import_count,
    'row_count',b.row_count,'reconciliation_id',b.reconciliation_id
  ) INTO result
  FROM period_scope p CROSS JOIN payable q CROSS JOIN h1 h CROSS JOIN bank b
  WHERE h.h1_count>0 AND q.month_count>0 AND b.import_count=1 AND b.row_count>0;

  RETURN result;
END $$;

COMMIT;
