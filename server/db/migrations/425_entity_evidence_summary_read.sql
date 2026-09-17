-- 425: read-only evidence summary per entity/period (P0-F6).
-- Staging showed 200 / [] for entities that never had any evidence imported;
-- the client could not distinguish that from a real zero. This function counts
-- what already exists (journals, posted journals, raw events, staging items,
-- source documents) and names the state. It writes nothing and uses the same
-- GL.REPORT.VIEW scope as refs_read_authoritative_scope.
BEGIN;

CREATE FUNCTION public.refs_read_entity_evidence_summary(p_tenant uuid,p_entity uuid,p_period uuid)
RETURNS TABLE(
  entity_id uuid,
  period_id uuid,
  journal_count integer,
  posted_journal_count integer,
  raw_event_count integer,
  staging_item_count integer,
  source_document_count integer,
  last_raw_event_at timestamptz,
  evidence_state text
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE e public.entity; p public.accounting_period; j integer; pj integer; r integer; s integer; d integer; last_raw timestamptz;
BEGIN
  PERFORM public.refs_assert_scope(p_tenant,p_entity,'GL.REPORT.VIEW');
  SELECT * INTO e FROM public.entity WHERE tenant_id=p_tenant AND entity.entity_id=p_entity;
  IF NOT FOUND THEN RAISE EXCEPTION 'A valid entity-scoped accounting period is required' USING ERRCODE='22023'; END IF;
  SELECT * INTO p FROM public.accounting_period ap WHERE ap.tenant_id=p_tenant AND ap.entity_id=p_entity AND ap.period_id=p_period;
  IF NOT FOUND THEN RAISE EXCEPTION 'A valid entity-scoped accounting period is required' USING ERRCODE='22023'; END IF;
  SELECT count(*)::integer, count(*) FILTER (WHERE je.status='POSTED')::integer INTO j,pj
    FROM public.journal_entry je WHERE je.tenant_id=p_tenant AND je.entity_id=p_entity AND je.period_id=p_period;
  SELECT count(*)::integer, max(re.received_at) INTO r,last_raw
    FROM public.raw_event re WHERE re.tenant_id=p_tenant AND re.source_system=e.source_system AND re.source_entity_id=e.source_entity_id
      AND re.occurred_at >= p.starts_on AND re.occurred_at < (p.ends_on + 1);
  SELECT count(*)::integer INTO s FROM public.staging_item si WHERE si.tenant_id=p_tenant AND si.entity_id=p_entity;
  SELECT count(*)::integer INTO d FROM public.source_document sd WHERE sd.tenant_id=p_tenant AND sd.entity_id=p_entity;
  RETURN QUERY SELECT p_entity,p_period,j,pj,r,s,d,last_raw,
    CASE WHEN j=0 AND r=0 AND s=0 AND d=0 THEN 'NO_EVIDENCE_IMPORTED'
         WHEN pj=0 THEN 'EVIDENCE_WITHOUT_POSTINGS'
         ELSE 'POSTED_EVIDENCE' END;
END;
$$;

REVOKE ALL ON FUNCTION public.refs_read_entity_evidence_summary(uuid,uuid,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.refs_read_entity_evidence_summary(uuid,uuid,uuid) TO refs_app;

COMMIT;
