BEGIN;

CREATE FUNCTION refs_read_reconciliation_adjustment_attachment_candidates(
  p_tenant uuid,p_entity uuid,p_limit integer DEFAULT 25
) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE attachments jsonb;
BEGIN
  PERFORM refs_assert_scope(p_tenant,p_entity,'BANK.RECONCILIATION.ADJUSTMENT_DRAFT');
  PERFORM refs_assert_scope(p_tenant,p_entity,'GL.JE.CREATE');
  IF p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 100 THEN
    RAISE EXCEPTION 'Reconciliation adjustment attachment limit must be between 1 and 100' USING ERRCODE='22023';
  END IF;
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'attachment_id',candidate.attachment_id,'name',candidate.name,
    'media_type',candidate.media_type,'verified_at',candidate.verified_at
  ) ORDER BY candidate.verified_at DESC,candidate.attachment_id DESC),'[]'::jsonb)
  INTO attachments
  FROM (
    SELECT a.attachment_id,a.name,a.media_type,a.verified_at
    FROM attachment a
    WHERE a.tenant_id=p_tenant AND a.entity_id=p_entity
      AND a.finalization_status='VERIFIED_CLEAN' AND a.scan_status='CLEAN'
      AND a.verified_at IS NOT NULL AND a.finalized_at IS NOT NULL
    ORDER BY a.verified_at DESC,a.attachment_id DESC
    LIMIT p_limit
  ) candidate;
  RETURN jsonb_build_object(
    'schema_version','RECONCILIATION_ADJUSTMENT_ATTACHMENT_CANDIDATES_V1',
    'entity_id',p_entity,'attachments',attachments
  );
END;
$$;

REVOKE ALL ON FUNCTION refs_read_reconciliation_adjustment_attachment_candidates(uuid,uuid,integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION refs_read_reconciliation_adjustment_attachment_candidates(uuid,uuid,integer) TO refs_app;

COMMIT;
