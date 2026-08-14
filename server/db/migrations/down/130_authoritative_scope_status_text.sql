BEGIN;

CREATE OR REPLACE FUNCTION public.refs_read_authoritative_scope(p_tenant uuid,p_entity uuid,p_period uuid)
RETURNS TABLE(
  entity_id uuid,
  entity_name text,
  entity_code text,
  base_currency char(3),
  period_id uuid,
  period_code text,
  period_start text,
  period_end text,
  period_status text
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
BEGIN
  PERFORM public.refs_assert_scope(p_tenant,p_entity,'GL.REPORT.VIEW');
  RETURN QUERY
  SELECT e.entity_id,e.name,e.entity_code,e.base_currency,p.period_id,p.period_code,
    to_char(p.starts_on,'YYYY-MM-DD'),to_char(p.ends_on,'YYYY-MM-DD'),p.status
  FROM public.entity e
  JOIN public.accounting_period p
    ON p.tenant_id=e.tenant_id AND p.entity_id=e.entity_id
  WHERE e.tenant_id=p_tenant AND e.entity_id=p_entity AND p.period_id=p_period;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'A valid entity-scoped accounting period is required' USING ERRCODE='22023';
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.refs_read_authoritative_scope(uuid,uuid,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.refs_read_authoritative_scope(uuid,uuid,uuid) TO refs_app;

COMMIT;
