BEGIN;

CREATE FUNCTION refs_recurring_status(p_value text) RETURNS text
LANGUAGE sql IMMUTABLE SET search_path=pg_catalog,public,pg_temp AS $$
  SELECT CASE upper(COALESCE(btrim(p_value),''))
    WHEN 'ACTIVE' THEN 'ACTIVE'
    WHEN 'INACTIVE' THEN 'INACTIVE'
    WHEN 'PAUSED' THEN 'INACTIVE'
    WHEN 'ENDED' THEN 'INACTIVE'
    WHEN 'CANCELLED' THEN 'INACTIVE'
    WHEN 'CANCELED' THEN 'INACTIVE'
    ELSE 'UNKNOWN'
  END;
$$;

CREATE FUNCTION refs_recurring_interval(p_value text) RETURNS text
LANGUAGE sql IMMUTABLE SET search_path=pg_catalog,public,pg_temp AS $$
  SELECT CASE upper(COALESCE(btrim(p_value),''))
    WHEN 'DAILY' THEN 'DAILY' WHEN 'WEEKLY' THEN 'WEEKLY' WHEN 'MONTHLY' THEN 'MONTHLY'
    WHEN 'QUARTERLY' THEN 'QUARTERLY' WHEN 'ANNUAL' THEN 'ANNUAL' WHEN 'YEARLY' THEN 'ANNUAL'
    WHEN '' THEN 'UNKNOWN' ELSE 'OTHER'
  END;
$$;

CREATE FUNCTION refs_recurring_date(p_value text) RETURNS date
LANGUAGE plpgsql IMMUTABLE SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE cleaned text:=btrim(p_value);result date;
BEGIN
  IF cleaned IS NULL OR cleaned!~'^[0-9]{4}-(0[1-9]|1[0-2])-([012][0-9]|3[01])$' THEN RETURN NULL;END IF;
  BEGIN result:=cleaned::date;EXCEPTION WHEN datetime_field_overflow OR invalid_datetime_format THEN RETURN NULL;END;
  RETURN CASE WHEN to_char(result,'YYYY-MM-DD')=cleaned THEN result ELSE NULL END;
END;$$;

CREATE FUNCTION refs_project_recurring_transaction_row(p_tenant uuid,p_entity uuid,p_line uuid,p_history boolean)
RETURNS jsonb LANGUAGE sql STABLE SET search_path=pg_catalog,public,pg_temp AS $$
  SELECT jsonb_build_object(
    'recurring_transaction_id',l.source_document_line_id,
    'recurring_obligation_id',refs_rule_redact_text(l.external_dimension_refs->>'signed_recurring_obligation_id'),
    'transaction_type','BILL','interval',refs_recurring_interval(l.external_dimension_refs->>'signed_service_frequency'),
    'source_obligation_status',refs_rule_redact_text(NULLIF(btrim(l.external_dimension_refs->>'signed_obligation_status'),'')),
    'status',refs_recurring_status(l.external_dimension_refs->>'signed_obligation_status'),
    'service_period_start',refs_recurring_date(l.external_dimension_refs->>'signed_service_period_start'),
    'service_period_end',refs_recurring_date(l.external_dimension_refs->>'signed_service_period_end'),
    'counterparty_ref',refs_rule_redact_text(l.party_ref),'currency',d.currency::text,'amount',l.amount::text,
    'contract_id',refs_rule_redact_text(NULLIF(btrim(l.external_dimension_refs->>'signed_contract_id'),'')),
    'charge_code',refs_rule_redact_text(NULLIF(btrim(l.external_dimension_refs->>'signed_charge_code'),'')),
    'source_document_id',d.source_document_id,'source_document_line_id',l.source_document_line_id,'source_document_version',d.version::text,
    'source_system',refs_rule_redact_text(d.source_system),'source_module',refs_rule_redact_text(d.source_module),
    'source_entity_id',refs_rule_redact_text(d.source_entity_id),'source_record_id',refs_rule_redact_text(d.source_record_id),'source_version',refs_rule_redact_text(d.source_version),
    'source_payload_hash',d.payload_hash,'source_line_hash',r.raw_row_hash,'is_current',e.is_current,
    'evidence_state',CASE WHEN refs_recurring_date(l.external_dimension_refs->>'signed_service_period_start') IS NOT NULL AND refs_recurring_date(l.external_dimension_refs->>'signed_service_period_end') IS NOT NULL AND refs_recurring_date(l.external_dimension_refs->>'signed_service_period_start')<=refs_recurring_date(l.external_dimension_refs->>'signed_service_period_end') AND refs_recurring_interval(l.external_dimension_refs->>'signed_service_frequency')<>'UNKNOWN' THEN 'COMPLETE' ELSE 'INCOMPLETE_SOURCE' END,
    'received_at',e.received_at,
    'audit_event_ids',ARRAY(SELECT a.audit_event_id FROM audit_event a WHERE a.tenant_id=d.tenant_id AND a.entity_id=d.entity_id AND a.object_id IN(r.wbs_final1_retained_source_row_id,d.source_document_id,l.source_document_line_id) ORDER BY a.occurred_at,a.audit_event_id),
    'history',CASE WHEN p_history THEN COALESCE((SELECT jsonb_agg(jsonb_build_object('audit_event_id',a.audit_event_id,'event_type',refs_rule_redact_text(a.event_type),'action',refs_rule_redact_text(a.action),'actor_id',refs_rule_redact_text(a.actor_id),'permission_used',refs_rule_redact_text(a.permission_used),'occurred_at',a.occurred_at,'after_hash',a.after_hash,'correlation_id',refs_rule_redact_text(a.correlation_id)) ORDER BY a.occurred_at,a.audit_event_id) FROM audit_event a WHERE a.tenant_id=d.tenant_id AND a.entity_id=d.entity_id AND a.object_id IN(r.wbs_final1_retained_source_row_id,d.source_document_id,l.source_document_line_id)),'[]'::jsonb) ELSE '[]'::jsonb END,
    'action_flags',jsonb_build_object('can_create_template',false,'can_edit',false,'can_pause',false,'can_resume',false,'can_execute',false,'can_manage_payment',false,'can_create_draft',false,'can_post',false)
  )
  FROM source_document_line l
  JOIN source_document d ON d.tenant_id=l.tenant_id AND d.entity_id=l.entity_id AND d.source_document_id=l.source_document_id
  JOIN raw_event e ON e.tenant_id=d.tenant_id AND e.entity_id=d.entity_id AND e.raw_event_id=d.raw_event_id
  JOIN wbs_final1_retained_source_row r ON r.tenant_id=l.tenant_id AND r.entity_id=l.entity_id AND r.source_document_id=d.source_document_id AND r.source_document_line_id=l.source_document_line_id AND r.raw_event_id=e.raw_event_id AND r.raw_row_hash=l.external_dimension_refs->>'raw_row_hash'
  WHERE l.tenant_id=p_tenant AND l.entity_id=p_entity AND l.source_document_line_id=p_line AND r.domain='PAYABLES' AND e.is_current AND NULLIF(btrim(l.external_dimension_refs->>'signed_recurring_obligation_id'),'') IS NOT NULL;
$$;

CREATE FUNCTION refs_read_recurring_transaction_register(p_tenant uuid,p_entity uuid,p_status text,p_interval text,p_after uuid,p_limit integer)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE after_received timestamptz;page_rows jsonb;next_id uuid;
BEGIN
  PERFORM refs_assert_scope(p_tenant,p_entity,'AP.VIEW');
  IF p_status IS NULL OR p_status NOT IN('ALL','ACTIVE','INACTIVE','UNKNOWN') OR p_interval IS NULL OR p_interval NOT IN('ALL','DAILY','WEEKLY','MONTHLY','QUARTERLY','ANNUAL','OTHER','UNKNOWN') OR p_limit IS NULL OR p_limit<1 OR p_limit>100 THEN RAISE EXCEPTION 'Recurring transaction selection is invalid' USING ERRCODE='22023';END IF;
  IF p_after IS NOT NULL THEN
    SELECT e.received_at INTO after_received FROM source_document_line l JOIN source_document d ON d.tenant_id=l.tenant_id AND d.entity_id=l.entity_id AND d.source_document_id=l.source_document_id JOIN raw_event e ON e.tenant_id=d.tenant_id AND e.entity_id=d.entity_id AND e.raw_event_id=d.raw_event_id JOIN wbs_final1_retained_source_row r ON r.tenant_id=l.tenant_id AND r.entity_id=l.entity_id AND r.source_document_id=d.source_document_id AND r.source_document_line_id=l.source_document_line_id AND r.raw_event_id=e.raw_event_id AND r.raw_row_hash=l.external_dimension_refs->>'raw_row_hash'
    WHERE l.tenant_id=p_tenant AND l.entity_id=p_entity AND l.source_document_line_id=p_after AND r.domain='PAYABLES' AND e.is_current AND NULLIF(btrim(l.external_dimension_refs->>'signed_recurring_obligation_id'),'') IS NOT NULL AND(p_status='ALL' OR refs_recurring_status(l.external_dimension_refs->>'signed_obligation_status')=p_status) AND(p_interval='ALL' OR refs_recurring_interval(l.external_dimension_refs->>'signed_service_frequency')=p_interval);
    IF NOT FOUND THEN RAISE EXCEPTION 'Recurring transaction cursor is outside the selected company and filters' USING ERRCODE='22023';END IF;
  END IF;
  WITH selected AS MATERIALIZED(
    SELECT l.source_document_line_id,e.received_at FROM source_document_line l JOIN source_document d ON d.tenant_id=l.tenant_id AND d.entity_id=l.entity_id AND d.source_document_id=l.source_document_id JOIN raw_event e ON e.tenant_id=d.tenant_id AND e.entity_id=d.entity_id AND e.raw_event_id=d.raw_event_id JOIN wbs_final1_retained_source_row r ON r.tenant_id=l.tenant_id AND r.entity_id=l.entity_id AND r.source_document_id=d.source_document_id AND r.source_document_line_id=l.source_document_line_id AND r.raw_event_id=e.raw_event_id AND r.raw_row_hash=l.external_dimension_refs->>'raw_row_hash'
    WHERE l.tenant_id=p_tenant AND l.entity_id=p_entity AND r.domain='PAYABLES' AND e.is_current AND NULLIF(btrim(l.external_dimension_refs->>'signed_recurring_obligation_id'),'') IS NOT NULL AND(p_status='ALL' OR refs_recurring_status(l.external_dimension_refs->>'signed_obligation_status')=p_status) AND(p_interval='ALL' OR refs_recurring_interval(l.external_dimension_refs->>'signed_service_frequency')=p_interval) AND(p_after IS NULL OR(e.received_at,l.source_document_line_id)<(after_received,p_after)) ORDER BY e.received_at DESC,l.source_document_line_id DESC LIMIT p_limit)
  SELECT COALESCE(jsonb_agg(refs_project_recurring_transaction_row(p_tenant,p_entity,source_document_line_id,false) ORDER BY received_at DESC,source_document_line_id DESC),'[]'::jsonb),CASE WHEN count(*)=p_limit THEN (array_agg(source_document_line_id ORDER BY received_at DESC,source_document_line_id DESC))[p_limit] END INTO page_rows,next_id FROM selected;
  RETURN jsonb_build_object('schema_version','RECURRING_TRANSACTION_REGISTER_V1','entity_id',p_entity,'status',p_status,'interval',p_interval,'after_id',p_after,'limit',p_limit,'read_at',statement_timestamp(),'rows',page_rows,'next_id',next_id,'action_flags',jsonb_build_object('can_create_template',false,'can_edit',false,'can_pause',false,'can_resume',false,'can_execute',false,'can_manage_payment',false,'can_create_draft',false,'can_post',false));
END;$$;

CREATE FUNCTION refs_read_recurring_transaction_detail(p_tenant uuid,p_entity uuid,p_recurring_transaction uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE result jsonb;
BEGIN
  PERFORM refs_assert_scope(p_tenant,p_entity,'AP.VIEW');result:=refs_project_recurring_transaction_row(p_tenant,p_entity,p_recurring_transaction,true);IF result IS NULL THEN RAISE EXCEPTION 'Recurring transaction is absent, superseded, or outside the company' USING ERRCODE='P0002';END IF;RETURN result;
END;$$;

REVOKE ALL ON FUNCTION refs_recurring_status(text) FROM PUBLIC,refs_app;
REVOKE ALL ON FUNCTION refs_recurring_interval(text) FROM PUBLIC,refs_app;
REVOKE ALL ON FUNCTION refs_recurring_date(text) FROM PUBLIC,refs_app;
REVOKE ALL ON FUNCTION refs_project_recurring_transaction_row(uuid,uuid,uuid,boolean) FROM PUBLIC,refs_app;
REVOKE ALL ON FUNCTION refs_read_recurring_transaction_register(uuid,uuid,text,text,uuid,integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION refs_read_recurring_transaction_detail(uuid,uuid,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION refs_read_recurring_transaction_register(uuid,uuid,text,text,uuid,integer) TO refs_app;
GRANT EXECUTE ON FUNCTION refs_read_recurring_transaction_detail(uuid,uuid,uuid) TO refs_app;
COMMIT;
