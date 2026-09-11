BEGIN;

CREATE FUNCTION refs_rule_text_is_safe(p_value text) RETURNS boolean
LANGUAGE sql IMMUTABLE SET search_path=pg_catalog,public,pg_temp AS $$
  SELECT p_value IS NULL OR p_value!~*'(bearer[[:space:]]+[[:alnum:]_.~+/-]{8,}|(api[_ -]?key|access[_ -]?token|refresh[_ -]?token|authorization|password|secret|credential|private[_ -]?key)[[:space:]]*[:=][[:space:]]*[^[:space:],;]+|(sk|rk|pk)-[a-z0-9_-]{8,})';
$$;

CREATE FUNCTION refs_rule_redact_text(p_value text) RETURNS text
LANGUAGE sql IMMUTABLE SET search_path=pg_catalog,public,pg_temp AS $$
  SELECT CASE WHEN refs_rule_text_is_safe(p_value) THEN p_value ELSE '[REDACTED]' END;
$$;

CREATE FUNCTION refs_rule_json_is_safe(p_value jsonb) RETURNS boolean
LANGUAGE plpgsql IMMUTABLE SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE pair record;item jsonb;
BEGIN
  IF p_value IS NULL THEN RETURN false;END IF;
  IF jsonb_typeof(p_value)='object' THEN
    FOR pair IN SELECT * FROM jsonb_each(p_value) LOOP
      IF pair.key~*'(password|secret|credential|access[_-]?token|refresh[_-]?token|api[_-]?key|private[_-]?key)' OR NOT refs_rule_json_is_safe(pair.value) THEN RETURN false;END IF;
    END LOOP;
  ELSIF jsonb_typeof(p_value)='array' THEN
    FOR item IN SELECT value FROM jsonb_array_elements(p_value) LOOP IF NOT refs_rule_json_is_safe(item) THEN RETURN false;END IF;END LOOP;
  ELSIF jsonb_typeof(p_value)='string' AND NOT refs_rule_text_is_safe(p_value#>>'{}') THEN RETURN false;
  END IF;
  RETURN true;
END;$$;

CREATE FUNCTION refs_project_rule_register_row(p_tenant uuid,p_entity uuid,p_rule uuid,p_history boolean)
RETURNS jsonb LANGUAGE sql STABLE SET search_path=pg_catalog,public,pg_temp AS $$
  SELECT jsonb_build_object(
    'rule_id',m.mapping_snapshot_id,'rule_kind',CASE m.family WHEN 'BANK' THEN 'BANK' ELSE 'INTEGRATION' END,
    'rule_name',CASE WHEN refs_rule_json_is_safe(m.output_rules) THEN COALESCE(NULLIF(btrim(m.output_rules->>'rule_name'),''),NULLIF(btrim(m.output_rules->>'name'),''),NULLIF(btrim(m.output_rules->>'rule_id'),''),m.family||' '||left(m.mapping_snapshot_id::text,8)) ELSE m.family||' '||left(m.mapping_snapshot_id::text,8) END,
    'family',m.family,'version',m.version::text,'lifecycle_revision',m.lifecycle_revision::text,'priority',m.priority,'status',m.status,
    'scope_type',m.scope_type,'scope_key',refs_rule_redact_text(m.scope_key),'input_key_hash',m.input_key_hash,'snapshot_hash',m.snapshot_hash,
    'configuration_state',CASE WHEN m.snapshot_hash<>refs_jsonb_hash(jsonb_build_object('input_keys',m.input_keys,'output_rules',m.output_rules)) THEN 'BLOCKED_HASH_MISMATCH' WHEN NOT refs_rule_json_is_safe(m.input_keys) OR NOT refs_rule_json_is_safe(m.output_rules) THEN 'SENSITIVE_CONFIGURATION_BLOCKED' ELSE 'AVAILABLE' END,
    'conditions',CASE WHEN m.snapshot_hash=refs_jsonb_hash(jsonb_build_object('input_keys',m.input_keys,'output_rules',m.output_rules)) AND refs_rule_json_is_safe(m.input_keys) AND refs_rule_json_is_safe(m.output_rules) THEN m.input_keys END,
    'actions',CASE WHEN m.snapshot_hash=refs_jsonb_hash(jsonb_build_object('input_keys',m.input_keys,'output_rules',m.output_rules)) AND refs_rule_json_is_safe(m.input_keys) AND refs_rule_json_is_safe(m.output_rules) THEN m.output_rules END,
    'effective_from',m.effective_from,'effective_to',m.effective_to,'created_by',refs_rule_redact_text(m.created_by),'approved_by',refs_rule_redact_text(m.approved_by),'approved_at',m.approved_at,'retired_by',refs_rule_redact_text(m.retired_by),'retired_at',m.retired_at,'retire_reason',refs_rule_redact_text(m.retire_reason),
    'usage_count',(SELECT count(*)::integer FROM rule_evaluation e WHERE e.tenant_id=m.tenant_id AND e.mapping_snapshot_id=m.mapping_snapshot_id),
    'last_used_at',(SELECT max(e.evaluated_at) FROM rule_evaluation e WHERE e.tenant_id=m.tenant_id AND e.mapping_snapshot_id=m.mapping_snapshot_id),
    'audit_event_ids',ARRAY(SELECT a.audit_event_id FROM audit_event a WHERE a.tenant_id=m.tenant_id AND a.entity_id=m.entity_id AND a.object_id=m.mapping_snapshot_id ORDER BY a.occurred_at,a.audit_event_id),
    'history',CASE WHEN p_history THEN COALESCE((SELECT jsonb_agg(jsonb_build_object('audit_event_id',a.audit_event_id,'event_type',refs_rule_redact_text(a.event_type),'action',refs_rule_redact_text(a.action),'actor_id',refs_rule_redact_text(a.actor_id),'permission_used',refs_rule_redact_text(a.permission_used),'occurred_at',a.occurred_at,'before_hash',a.before_hash,'after_hash',a.after_hash,'correlation_id',refs_rule_redact_text(a.correlation_id)) ORDER BY a.occurred_at,a.audit_event_id) FROM audit_event a WHERE a.tenant_id=m.tenant_id AND a.entity_id=m.entity_id AND a.object_id=m.mapping_snapshot_id),'[]'::jsonb) ELSE '[]'::jsonb END,
    'action_flags',jsonb_build_object('can_create',false,'can_edit',false,'can_reorder',false,'can_copy',false,'can_enable',false,'can_auto_categorize',false,'can_auto_match',false,'can_post',false)
  ) FROM mapping_snapshot m WHERE m.tenant_id=p_tenant AND m.entity_id=p_entity AND m.mapping_snapshot_id=p_rule AND m.family IN('BANK','WBS_AUTOREC_MATCH');
$$;

CREATE FUNCTION refs_read_rule_register(p_tenant uuid,p_entity uuid,p_kind text,p_status text,p_after uuid,p_limit integer)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE after_priority integer;after_effective timestamptz;page_rows jsonb;next_id uuid;family_name text;
BEGIN
  IF p_kind='BANK' THEN PERFORM refs_assert_scope(p_tenant,p_entity,'BANK.VIEW');family_name:='BANK';ELSIF p_kind='INTEGRATION' THEN PERFORM refs_assert_scope(p_tenant,p_entity,'WBS.AUTOREC.VIEW');family_name:='WBS_AUTOREC_MATCH';ELSE RAISE EXCEPTION 'Rule kind is invalid' USING ERRCODE='22023';END IF;
  IF p_status IS NULL OR p_status NOT IN('ALL','DRAFT','APPROVED','RETIRED') OR p_limit IS NULL OR p_limit<1 OR p_limit>100 THEN RAISE EXCEPTION 'Rule selection is invalid' USING ERRCODE='22023';END IF;
  IF p_after IS NOT NULL THEN SELECT priority,effective_from INTO after_priority,after_effective FROM mapping_snapshot WHERE tenant_id=p_tenant AND entity_id=p_entity AND mapping_snapshot_id=p_after AND family=family_name AND(p_status='ALL' OR status=p_status);IF NOT FOUND THEN RAISE EXCEPTION 'Rule cursor is outside the selected company and filters' USING ERRCODE='22023';END IF;END IF;
  WITH selected AS MATERIALIZED(SELECT m.* FROM mapping_snapshot m WHERE m.tenant_id=p_tenant AND m.entity_id=p_entity AND m.family=family_name AND(p_status='ALL' OR m.status=p_status) AND(p_after IS NULL OR(m.priority,m.effective_from,m.mapping_snapshot_id)<(after_priority,after_effective,p_after)) ORDER BY m.priority DESC,m.effective_from DESC,m.mapping_snapshot_id DESC LIMIT p_limit)
  SELECT COALESCE(jsonb_agg(refs_project_rule_register_row(p_tenant,p_entity,mapping_snapshot_id,false) ORDER BY priority DESC,effective_from DESC,mapping_snapshot_id DESC),'[]'::jsonb),CASE WHEN count(*)=p_limit THEN (array_agg(mapping_snapshot_id ORDER BY priority DESC,effective_from DESC,mapping_snapshot_id DESC))[p_limit] END INTO page_rows,next_id FROM selected;
  RETURN jsonb_build_object('schema_version','RULE_REGISTER_V1','entity_id',p_entity,'rule_kind',p_kind,'status',p_status,'after_id',p_after,'limit',p_limit,'read_at',statement_timestamp(),'rows',page_rows,'next_id',next_id,'action_flags',jsonb_build_object('can_create',false,'can_edit',false,'can_reorder',false,'can_copy',false,'can_enable',false,'can_auto_categorize',false,'can_auto_match',false,'can_post',false));
END;$$;

CREATE FUNCTION refs_read_rule_detail(p_tenant uuid,p_entity uuid,p_rule uuid,p_kind text)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE result jsonb;expected_kind text;
BEGIN
  IF p_kind='BANK' THEN PERFORM refs_assert_scope(p_tenant,p_entity,'BANK.VIEW');ELSIF p_kind='INTEGRATION' THEN PERFORM refs_assert_scope(p_tenant,p_entity,'WBS.AUTOREC.VIEW');ELSE RAISE EXCEPTION 'Rule kind is invalid' USING ERRCODE='22023';END IF;
  result:=refs_project_rule_register_row(p_tenant,p_entity,p_rule,true);IF result IS NULL THEN RAISE EXCEPTION 'Rule is absent or outside the company' USING ERRCODE='P0002';END IF;expected_kind:=result->>'rule_kind';IF expected_kind<>p_kind THEN RAISE EXCEPTION 'Rule kind does not match the retained rule' USING ERRCODE='22023';END IF;RETURN result;
END;$$;

REVOKE ALL ON FUNCTION refs_rule_json_is_safe(jsonb) FROM PUBLIC,refs_app;
REVOKE ALL ON FUNCTION refs_rule_text_is_safe(text) FROM PUBLIC,refs_app;
REVOKE ALL ON FUNCTION refs_rule_redact_text(text) FROM PUBLIC,refs_app;
REVOKE ALL ON FUNCTION refs_project_rule_register_row(uuid,uuid,uuid,boolean) FROM PUBLIC,refs_app;
REVOKE ALL ON FUNCTION refs_read_rule_register(uuid,uuid,text,text,uuid,integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION refs_read_rule_detail(uuid,uuid,uuid,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION refs_read_rule_register(uuid,uuid,text,text,uuid,integer) TO refs_app;
GRANT EXECUTE ON FUNCTION refs_read_rule_detail(uuid,uuid,uuid,text) TO refs_app;
COMMIT;
