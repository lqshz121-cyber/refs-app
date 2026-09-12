BEGIN;
REVOKE EXECUTE ON FUNCTION refs_read_cash_transfer_attachment_candidates(uuid,uuid) FROM refs_app;
DROP FUNCTION refs_read_cash_transfer_attachment_candidates(uuid,uuid);

CREATE FUNCTION refs_read_cash_transfer_attachment_candidates(p_tenant uuid,p_entity uuid,p_limit integer DEFAULT 100,p_before_verified_at timestamptz DEFAULT NULL,p_before_attachment_id uuid DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE attachments jsonb; more boolean; next_cursor jsonb:=NULL;
BEGIN
 IF p_limit NOT BETWEEN 1 AND 100 OR (p_before_verified_at IS NULL)<>(p_before_attachment_id IS NULL) THEN
  RAISE EXCEPTION 'Cash Transfer attachment candidates require limit 1..100 and a complete cursor' USING ERRCODE='22023';
 END IF;
 PERFORM refs_assert_scope(p_tenant,p_entity,'CASH.TRANSFER.CREATE');
 PERFORM refs_assert_scope(p_tenant,p_entity,'GL.JE.CREATE');
 WITH page AS (
  SELECT a.attachment_id,a.name,a.media_type,a.verified_at,row_number() OVER (ORDER BY a.verified_at DESC,a.attachment_id DESC) AS row_no
  FROM attachment a
  WHERE a.tenant_id=p_tenant AND a.entity_id=p_entity
    AND a.finalization_status='VERIFIED_CLEAN' AND a.scan_status='CLEAN'
    AND a.verified_at IS NOT NULL AND a.finalized_at IS NOT NULL
    AND (p_before_verified_at IS NULL OR (a.verified_at,a.attachment_id)<(p_before_verified_at,p_before_attachment_id))
  ORDER BY a.verified_at DESC,a.attachment_id DESC
  LIMIT p_limit+1
 )
 SELECT coalesce(jsonb_agg(jsonb_build_object('attachment_id',attachment_id,'name',name,'media_type',media_type,'verified_at',verified_at) ORDER BY verified_at DESC,attachment_id DESC) FILTER (WHERE row_no<=p_limit),'[]'::jsonb),count(*)>p_limit
 INTO attachments,more FROM page;
 IF more THEN
  WITH page AS (
   SELECT a.attachment_id,a.verified_at,row_number() OVER (ORDER BY a.verified_at DESC,a.attachment_id DESC) AS row_no
   FROM attachment a
   WHERE a.tenant_id=p_tenant AND a.entity_id=p_entity
     AND a.finalization_status='VERIFIED_CLEAN' AND a.scan_status='CLEAN'
     AND a.verified_at IS NOT NULL AND a.finalized_at IS NOT NULL
     AND (p_before_verified_at IS NULL OR (a.verified_at,a.attachment_id)<(p_before_verified_at,p_before_attachment_id))
   ORDER BY a.verified_at DESC,a.attachment_id DESC
   LIMIT p_limit
  ) SELECT jsonb_build_object('verified_at',verified_at,'attachment_id',attachment_id) INTO next_cursor FROM page WHERE row_no=p_limit;
 END IF;
 RETURN jsonb_build_object('schema_version','CASH_TRANSFER_ATTACHMENT_CANDIDATES_V1','entity_id',p_entity,'attachments',attachments,'limit',p_limit,'has_more',more,'next_cursor',next_cursor);
END;$$;

REVOKE ALL ON FUNCTION refs_read_cash_transfer_attachment_candidates(uuid,uuid,integer,timestamptz,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION refs_read_cash_transfer_attachment_candidates(uuid,uuid,integer,timestamptz,uuid) TO refs_app;
COMMIT;