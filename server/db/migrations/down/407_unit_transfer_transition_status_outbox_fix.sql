BEGIN;

CREATE OR REPLACE FUNCTION refs_transition_unit_transfer_pair(p_tenant uuid,p_entity uuid,p_pair uuid,p_action text,p_expected_pair_revision bigint,p_expected_source_revision bigint,p_expected_target_revision bigint,p_reason text,p_idempotency_key text,p_request_hash text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE actor text:=refs_current_actor();pair unit_transfer_pair;idem idempotency_receipt;action text:=upper(p_action);target_status text;source_hash text;target_hash text;source_result jsonb;target_result jsonb;payload jsonb;
BEGIN
 IF actor IS NULL OR action NOT IN('SUBMIT','REVIEW','APPROVE','REJECT') OR p_expected_pair_revision IS NULL OR p_expected_pair_revision<0 OR p_expected_source_revision IS NULL OR p_expected_source_revision<0 OR p_expected_target_revision IS NULL OR p_expected_target_revision<0 OR length(coalesce(p_idempotency_key,'')) NOT BETWEEN 8 AND 200 OR length(btrim(coalesce(p_reason,''))) NOT BETWEEN 8 AND 2000 OR p_request_hash IS NULL OR p_request_hash!~'^sha256:[0-9a-f]{64}$' OR p_request_hash IS DISTINCT FROM refs_unit_transfer_transition_hash(p_tenant,p_entity,p_pair,action,p_expected_pair_revision,p_expected_source_revision,p_expected_target_revision,p_reason) THEN RAISE EXCEPTION 'Invalid Unit Transfer transition' USING ERRCODE='22023';END IF;
 INSERT INTO idempotency_receipt(tenant_id,operation_scope,idempotency_key,request_hash,status,actor_id) VALUES(p_tenant,'UNIT_TRANSFER_'||action||':'||p_entity,p_idempotency_key,p_request_hash,'IN_PROGRESS',actor) ON CONFLICT DO NOTHING;
 SELECT * INTO idem FROM idempotency_receipt WHERE tenant_id=p_tenant AND operation_scope='UNIT_TRANSFER_'||action||':'||p_entity AND idempotency_key=p_idempotency_key FOR UPDATE;
 IF idem.actor_id IS DISTINCT FROM actor OR idem.request_hash IS DISTINCT FROM p_request_hash THEN RAISE EXCEPTION 'Unit Transfer transition idempotency conflict' USING ERRCODE='23505';END IF;IF idem.status='SUCCEEDED' THEN RETURN idem.response_body||jsonb_build_object('idempotent',true);END IF;
 SELECT * INTO pair FROM unit_transfer_pair WHERE tenant_id=p_tenant AND unit_transfer_pair_id=p_pair AND p_entity IN(source_entity_id,target_entity_id) FOR UPDATE;IF NOT FOUND THEN RAISE EXCEPTION 'Unit Transfer pair not found' USING ERRCODE='P0002';END IF;
 IF pair.revision<>p_expected_pair_revision THEN RAISE EXCEPTION 'Unit Transfer pair revision conflict' USING ERRCODE='40001';END IF;
 PERFORM refs_assert_scope(p_tenant,pair.source_entity_id,'REAL_ESTATE.UNIT_TRANSFER.'||action);PERFORM refs_assert_scope(p_tenant,pair.target_entity_id,'REAL_ESTATE.UNIT_TRANSFER.'||action);
 target_status:=CASE action WHEN 'SUBMIT' THEN 'PENDING_REVIEW_PAIR' WHEN 'REVIEW' THEN 'PENDING_APPROVAL_PAIR' WHEN 'APPROVE' THEN 'APPROVED_PAIR' ELSE 'DRAFT_PAIR' END;
 INSERT INTO unit_transfer_internal_gate VALUES(pg_backend_pid(),txid_current(),p_tenant,p_pair,'JOURNAL',pair.source_journal_entry_id,replace(target_status,'_PAIR',''));
 source_hash:=refs_journal_transition_hash(p_tenant,pair.source_entity_id,pair.source_journal_entry_id,action,p_expected_source_revision,p_reason);source_result:=refs_transition_journal(p_tenant,pair.source_entity_id,pair.source_journal_entry_id,action,p_expected_source_revision,p_reason,'unit-transfer:'||p_pair||':source:'||action||':'||p_idempotency_key,source_hash);
 INSERT INTO unit_transfer_internal_gate VALUES(pg_backend_pid(),txid_current(),p_tenant,p_pair,'JOURNAL',pair.target_journal_entry_id,replace(target_status,'_PAIR',''));
 target_hash:=refs_journal_transition_hash(p_tenant,pair.target_entity_id,pair.target_journal_entry_id,action,p_expected_target_revision,p_reason);target_result:=refs_transition_journal(p_tenant,pair.target_entity_id,pair.target_journal_entry_id,action,p_expected_target_revision,p_reason,'unit-transfer:'||p_pair||':target:'||action||':'||p_idempotency_key,target_hash);
 INSERT INTO unit_transfer_internal_gate VALUES(pg_backend_pid(),txid_current(),p_tenant,p_pair,'PAIR',p_pair,target_status);
 UPDATE unit_transfer_pair SET status=target_status,revision=revision+1 WHERE tenant_id=p_tenant AND unit_transfer_pair_id=p_pair;
 payload:=jsonb_build_object('schema_version','UNIT_TRANSFER_TRANSITION_RECEIPT_V1','unit_transfer_pair_id',p_pair,'status',target_status,'revision',pair.revision+1,'source_journal',source_result,'target_journal',target_result,'idempotent',false);
 INSERT INTO audit_event(tenant_id,entity_id,event_type,object_type,object_id,action,actor_id,actor_type,permission_used,request_id,correlation_id,idempotency_key,after_hash,reason,metadata) VALUES(p_tenant,pair.source_entity_id,'UNIT_TRANSFER_'||action,'UNIT_TRANSFER_PAIR',p_pair,action,actor,'USER','REAL_ESTATE.UNIT_TRANSFER.'||action,p_idempotency_key,p_idempotency_key,p_idempotency_key,refs_jsonb_hash(payload),NULLIF(btrim(p_reason),''),payload);
 INSERT INTO audit_event(tenant_id,entity_id,event_type,object_type,object_id,action,actor_id,actor_type,permission_used,request_id,correlation_id,idempotency_key,after_hash,reason,metadata) VALUES(p_tenant,pair.target_entity_id,'UNIT_TRANSFER_'||action,'UNIT_TRANSFER_PAIR',p_pair,action,actor,'USER','REAL_ESTATE.UNIT_TRANSFER.'||action,p_idempotency_key,p_idempotency_key,p_idempotency_key,refs_jsonb_hash(payload),NULLIF(btrim(p_reason),''),payload);
 INSERT INTO outbox_event(tenant_id,entity_id,aggregate_type,aggregate_id,event_type,payload,payload_hash) VALUES(p_tenant,pair.source_entity_id,'UNIT_TRANSFER_PAIR',p_pair,'UNIT_TRANSFER_'||action,payload,refs_jsonb_hash(payload));
 INSERT INTO outbox_event(tenant_id,entity_id,aggregate_type,aggregate_id,event_type,payload,payload_hash) VALUES(p_tenant,pair.target_entity_id,'UNIT_TRANSFER_PAIR',p_pair,'UNIT_TRANSFER_'||action,payload,refs_jsonb_hash(payload));
 UPDATE idempotency_receipt SET status='SUCCEEDED',response_status=200,response_body=payload,completed_at=clock_timestamp() WHERE idempotency_receipt_id=idem.idempotency_receipt_id;RETURN payload;
END;$$;

REVOKE ALL ON FUNCTION refs_transition_unit_transfer_pair(uuid,uuid,uuid,text,bigint,bigint,bigint,text,text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION refs_transition_unit_transfer_pair(uuid,uuid,uuid,text,bigint,bigint,bigint,text,text,text) TO refs_app;

COMMIT;
