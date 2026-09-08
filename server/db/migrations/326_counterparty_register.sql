BEGIN;

CREATE INDEX member_master_register_page_idx
  ON member_master(tenant_id,entity_id,member_type,member_ref COLLATE "C");

CREATE FUNCTION refs_read_counterparty_register(
  p_tenant uuid,p_entity uuid,p_kind text,p_status text DEFAULT 'ACTIVE',
  p_query text DEFAULT '',p_after_ref text DEFAULT NULL,p_limit integer DEFAULT 50
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE v_rows jsonb;v_next text;
BEGIN
  IF p_kind IS NULL OR p_kind NOT IN ('VENDOR','CUSTOMER') THEN
    RAISE EXCEPTION 'Unsupported counterparty kind' USING ERRCODE='22023';
  END IF;
  PERFORM refs_assert_scope(p_tenant,p_entity,CASE p_kind WHEN 'VENDOR' THEN 'AP.VIEW' ELSE 'AR.VIEW' END);
  IF p_status IS NULL OR p_status NOT IN ('ACTIVE','INACTIVE','ALL')
     OR p_query IS NULL OR length(p_query)>128 OR p_query<>btrim(p_query)
     OR p_query~'[[:cntrl:]]' OR p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 100
     OR (p_after_ref IS NOT NULL AND (length(p_after_ref) NOT BETWEEN 1 AND 128
         OR p_after_ref<>btrim(p_after_ref) OR p_after_ref~'[[:cntrl:]]')) THEN
    RAISE EXCEPTION 'Counterparty register page is invalid' USING ERRCODE='22023';
  END IF;
  WITH candidates AS MATERIALIZED (
    SELECT m.member_ref,m.member_type,m.display_name,m.active
      FROM member_master m
     WHERE m.tenant_id=p_tenant AND m.entity_id=p_entity AND m.member_type=p_kind
       AND (p_status='ALL' OR m.active=(p_status='ACTIVE'))
       AND (p_after_ref IS NULL OR m.member_ref COLLATE "C">p_after_ref COLLATE "C")
       AND (p_query='' OR strpos(lower(m.member_ref),lower(p_query))>0
         OR strpos(lower(m.display_name),lower(p_query))>0)
     ORDER BY m.member_ref COLLATE "C" LIMIT p_limit+1
  ), page AS MATERIALIZED (
    SELECT * FROM candidates ORDER BY member_ref COLLATE "C" LIMIT p_limit
  )
  SELECT COALESCE((SELECT jsonb_agg(jsonb_build_object('member_ref',member_ref,
      'member_type',member_type,'display_name',display_name,'active',active)
      ORDER BY member_ref COLLATE "C") FROM page),'[]'::jsonb),
    CASE WHEN (SELECT count(*) FROM candidates)>p_limit
      THEN (SELECT member_ref FROM page ORDER BY member_ref COLLATE "C" DESC LIMIT 1) END
    INTO v_rows,v_next;
  RETURN jsonb_build_object('schema_version','COUNTERPARTY_REGISTER_V1',
    'entity_id',p_entity,'kind',p_kind,'status',p_status,'query',p_query,
    'after_ref',p_after_ref,'limit',p_limit,'rows',v_rows,'next_ref',v_next);
END;
$$;
REVOKE ALL ON FUNCTION refs_read_counterparty_register(uuid,uuid,text,text,text,text,integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION refs_read_counterparty_register(uuid,uuid,text,text,text,text,integer) TO refs_app;

COMMIT;
