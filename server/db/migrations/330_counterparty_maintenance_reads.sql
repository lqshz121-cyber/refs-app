BEGIN;
CREATE INDEX counterparty_change_queue_idx ON counterparty_change
 (tenant_id,entity_id,member_type,status,created_at DESC,counterparty_change_id DESC);
CREATE INDEX counterparty_change_history_idx ON counterparty_change
 (tenant_id,entity_id,member_type,member_ref,created_at DESC,counterparty_change_id DESC);

CREATE FUNCTION refs_read_counterparty_detail(p_tenant uuid,p_entity uuid,p_kind text,p_ref text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE master member_master;
BEGIN
 IF p_kind IS NULL OR p_kind NOT IN ('VENDOR','CUSTOMER') THEN RAISE EXCEPTION 'Unsupported counterparty kind' USING ERRCODE='22023'; END IF;
 PERFORM refs_assert_scope(p_tenant,p_entity,CASE p_kind WHEN 'VENDOR' THEN 'AP.VIEW' ELSE 'AR.VIEW' END);
 IF p_ref IS NULL OR length(p_ref) NOT BETWEEN 1 AND 128 OR p_ref<>btrim(p_ref) OR p_ref~'[[:cntrl:]]' THEN
  RAISE EXCEPTION 'Counterparty reference is invalid' USING ERRCODE='22023';
 END IF;
 SELECT * INTO master FROM member_master WHERE tenant_id=p_tenant AND entity_id=p_entity AND member_type=p_kind AND member_ref=p_ref;
 IF NOT FOUND THEN RAISE EXCEPTION 'Counterparty is unavailable in this company' USING ERRCODE='23503'; END IF;
 RETURN jsonb_build_object('schema_version','COUNTERPARTY_DETAIL_V1','entity_id',p_entity,'kind',p_kind,
  'member_ref',master.member_ref,'display_name',master.display_name,'active',master.active,'revision',master.counterparty_version);
END; $$;

CREATE FUNCTION refs_read_counterparty_changes(p_tenant uuid,p_entity uuid,p_kind text,
 p_status text DEFAULT 'PENDING',p_ref text DEFAULT NULL,p_after_id uuid DEFAULT NULL,p_limit integer DEFAULT 25)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE cursor_time timestamptz;v_rows jsonb;v_next uuid;
BEGIN
 IF p_kind IS NULL OR p_kind NOT IN ('VENDOR','CUSTOMER') THEN RAISE EXCEPTION 'Unsupported counterparty kind' USING ERRCODE='22023'; END IF;
 PERFORM refs_assert_scope(p_tenant,p_entity,CASE p_kind WHEN 'VENDOR' THEN 'AP.VIEW' ELSE 'AR.VIEW' END);
 IF p_status IS NULL OR p_status NOT IN ('PENDING','APPROVED','REJECTED','ALL') OR p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 100
  OR (p_ref IS NOT NULL AND (length(p_ref) NOT BETWEEN 1 AND 128 OR p_ref<>btrim(p_ref) OR p_ref~'[[:cntrl:]]')) THEN
  RAISE EXCEPTION 'Counterparty history selection is invalid' USING ERRCODE='22023';
 END IF;
 IF p_after_id IS NOT NULL THEN
  SELECT created_at INTO cursor_time FROM counterparty_change WHERE tenant_id=p_tenant AND entity_id=p_entity
   AND member_type=p_kind AND counterparty_change_id=p_after_id AND (p_ref IS NULL OR member_ref=p_ref);
  IF NOT FOUND THEN RAISE EXCEPTION 'Counterparty history cursor is unavailable in this selection' USING ERRCODE='22023'; END IF;
 END IF;
 WITH candidates AS MATERIALIZED (
  SELECT c.* FROM counterparty_change c WHERE tenant_id=p_tenant AND entity_id=p_entity AND member_type=p_kind
   AND (p_status='ALL' OR status=p_status) AND (p_ref IS NULL OR member_ref=p_ref)
   AND (p_after_id IS NULL OR (created_at,counterparty_change_id)<(cursor_time,p_after_id))
   ORDER BY created_at DESC,counterparty_change_id DESC LIMIT p_limit+1
 ), page AS MATERIALIZED (
  SELECT * FROM candidates ORDER BY created_at DESC,counterparty_change_id DESC LIMIT p_limit
 ) SELECT COALESCE((SELECT jsonb_agg(jsonb_build_object(
   'counterparty_change_id',counterparty_change_id,'member_ref',member_ref,'kind',member_type,'change_type',change_type,
   'expected_member_revision',expected_version,'before_state',before_state,'desired_state',desired_state,'reason',reason,
   'proposed_by',proposed_by,'created_at',created_at,'status',status,'revision',version,
   'reviewed_by',reviewed_by,'review_reason',review_reason,'reviewed_at',reviewed_at)
   ORDER BY created_at DESC,counterparty_change_id DESC) FROM page),'[]'::jsonb),
   CASE WHEN (SELECT count(*) FROM candidates)>p_limit THEN
    (SELECT counterparty_change_id FROM page ORDER BY created_at,counterparty_change_id LIMIT 1) END INTO v_rows,v_next;
 RETURN jsonb_build_object('schema_version','COUNTERPARTY_CHANGES_V1','entity_id',p_entity,'kind',p_kind,'status',p_status,
  'member_ref',p_ref,'after_id',p_after_id,'limit',p_limit,'rows',v_rows,'next_change_id',v_next);
END; $$;
REVOKE ALL ON FUNCTION refs_read_counterparty_detail(uuid,uuid,text,text),refs_read_counterparty_changes(uuid,uuid,text,text,text,uuid,integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION refs_read_counterparty_detail(uuid,uuid,text,text),refs_read_counterparty_changes(uuid,uuid,text,text,text,uuid,integer) TO refs_app;
COMMIT;
