BEGIN;

CREATE OR REPLACE FUNCTION refs_resolve_ai_finding_action(p_tenant uuid,p_entity uuid,p_action uuid,p_finding_hash text,p_reason text,p_expected_revision integer,p_idempotency_key text,p_request_hash text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE action_row ai_finding_action; idem idempotency_receipt; actor text:=refs_current_actor(); result jsonb;
BEGIN
  PERFORM refs_assert_scope(p_tenant,p_entity,'AI.FINDING.RESOLVE');
  IF actor IS NULL OR p_request_hash IS DISTINCT FROM refs_resolve_ai_finding_action_hash(p_tenant,p_entity,p_action,p_finding_hash,p_reason,p_expected_revision) THEN RAISE EXCEPTION 'AI finding resolution request is not canonical' USING ERRCODE='22023'; END IF;
  INSERT INTO idempotency_receipt(tenant_id,operation_scope,idempotency_key,request_hash,status,actor_id) VALUES(p_tenant,'AI_FINDING_RESOLVE:'||p_entity,p_idempotency_key,p_request_hash,'IN_PROGRESS',actor) ON CONFLICT(tenant_id,operation_scope,idempotency_key) DO NOTHING;
  SELECT * INTO idem FROM idempotency_receipt WHERE tenant_id=p_tenant AND operation_scope='AI_FINDING_RESOLVE:'||p_entity AND idempotency_key=p_idempotency_key FOR UPDATE;
  IF idem.request_hash<>p_request_hash THEN RAISE EXCEPTION 'Idempotency key reused with different AI finding resolution' USING ERRCODE='23505'; END IF;
  IF idem.status='SUCCEEDED' THEN RETURN idem.response_body||jsonb_build_object('idempotent',true); END IF;
  SELECT * INTO action_row FROM ai_finding_action WHERE tenant_id=p_tenant AND entity_id=p_entity AND ai_finding_action_id=p_action FOR UPDATE;
  IF NOT FOUND OR action_row.finding_hash<>p_finding_hash OR action_row.status<>'OPEN' OR action_row.revision<>p_expected_revision OR length(btrim(COALESCE(p_reason,'')))<8 OR length(btrim(p_reason))>2000 THEN RAISE EXCEPTION 'AI finding resolution requires an open exact action, finding hash, reason, and revision' USING ERRCODE=CASE WHEN FOUND AND action_row.revision<>p_expected_revision THEN '40001' ELSE '23514' END; END IF;
  UPDATE ai_finding_action SET status='RESOLVED',resolution_reason=btrim(p_reason),resolved_by=actor,resolved_at=clock_timestamp(),revision=revision+1 WHERE ai_finding_action_id=action_row.ai_finding_action_id RETURNING * INTO action_row;
  result:=jsonb_build_object('schema_version','AI_FINDING_ACTION_RESOLVE_V1','ai_finding_action_id',action_row.ai_finding_action_id,'finding_kind',action_row.finding_kind,'finding_id',action_row.finding_id,'finding_hash',action_row.finding_hash,'status',action_row.status,'resolution_reason',action_row.resolution_reason,'revision',action_row.revision,'can_create_draft',false,'can_review',false,'can_approve',false,'can_post',false,'idempotent',false);
  INSERT INTO audit_event(tenant_id,entity_id,event_type,object_type,object_id,action,actor_id,actor_type,permission_used,request_id,correlation_id,idempotency_key,after_hash,reason,metadata) VALUES(p_tenant,p_entity,'AI_FINDING_ACTION_RESOLVED','AI_FINDING_ACTION',action_row.ai_finding_action_id,'RESOLVE',actor,'USER','AI.FINDING.RESOLVE',p_idempotency_key,p_idempotency_key,p_idempotency_key,p_request_hash,btrim(p_reason),result);
  INSERT INTO outbox_event(tenant_id,entity_id,aggregate_type,aggregate_id,event_type,payload,payload_hash) VALUES(p_tenant,p_entity,'AI_FINDING_ACTION',action_row.ai_finding_action_id,'AI_FINDING_ACTION_RESOLVED',result,refs_jsonb_hash(result));
  UPDATE idempotency_receipt SET status='SUCCEEDED',response_status=201,response_body=result,completed_at=clock_timestamp() WHERE idempotency_receipt_id=idem.idempotency_receipt_id;
  RETURN result;
END;
$$;

REVOKE ALL ON FUNCTION refs_resolve_ai_finding_action(uuid,uuid,uuid,text,text,integer,text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION refs_resolve_ai_finding_action(uuid,uuid,uuid,text,text,integer,text,text) TO refs_app;

COMMIT;
