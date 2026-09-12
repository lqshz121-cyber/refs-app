BEGIN;
-- The application may select verified-clean evidence without receiving object
-- locations, hashes, scan references, or other storage secrets.
DO $$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM pg_class WHERE oid='attachment'::regclass AND relrowsecurity) THEN
  RAISE EXCEPTION 'Cash Transfer attachment candidates require attachment RLS' USING ERRCODE='55000';
 END IF;
 IF has_table_privilege('refs_app','attachment','SELECT') THEN
  RAISE EXCEPTION 'refs_app must not retain direct attachment read access' USING ERRCODE='55000';
 END IF;
END $$;

CREATE FUNCTION refs_read_cash_transfer_attachment_candidates(p_tenant uuid,p_entity uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE attachments jsonb;
BEGIN
 PERFORM refs_assert_scope(p_tenant,p_entity,'CASH.TRANSFER.CREATE');
 PERFORM refs_assert_scope(p_tenant,p_entity,'GL.JE.CREATE');
 SELECT coalesce(jsonb_agg(jsonb_build_object(
   'attachment_id',candidate.attachment_id,
   'name',candidate.name,
   'media_type',candidate.media_type,
   'verified_at',candidate.verified_at
 ) ORDER BY candidate.verified_at DESC,candidate.attachment_id DESC),'[]'::jsonb)
 INTO attachments
 FROM (
  SELECT a.attachment_id,a.name,a.media_type,a.verified_at
  FROM attachment a
  WHERE a.tenant_id=p_tenant AND a.entity_id=p_entity
    AND a.finalization_status='VERIFIED_CLEAN' AND a.scan_status='CLEAN'
    AND a.verified_at IS NOT NULL AND a.finalized_at IS NOT NULL
  ORDER BY a.verified_at DESC,a.attachment_id DESC
  LIMIT 100
 ) candidate;
 RETURN jsonb_build_object('schema_version','CASH_TRANSFER_ATTACHMENT_CANDIDATES_V1','entity_id',p_entity,'attachments',attachments);
END;$$;

REVOKE ALL ON FUNCTION refs_read_cash_transfer_attachment_candidates(uuid,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION refs_read_cash_transfer_attachment_candidates(uuid,uuid) TO refs_app;
COMMIT;
