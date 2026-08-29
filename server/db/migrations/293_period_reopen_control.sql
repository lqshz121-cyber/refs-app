BEGIN;

INSERT INTO permission_catalog(permission_code,domain,risk_class,sod_class)
VALUES('GL.PERIOD.REOPEN','GL','CRITICAL','PERIOD_REOPEN')
ON CONFLICT(permission_code) DO UPDATE SET active=true,domain=EXCLUDED.domain,risk_class=EXCLUDED.risk_class,
  sod_class=EXCLUDED.sod_class,version=permission_catalog.version+1,effective_to=NULL;

INSERT INTO runtime_human_permission_authority(permission_code,authority_class)
VALUES('GL.PERIOD.REOPEN','REOPEN')
ON CONFLICT(permission_code) DO UPDATE SET authority_class=EXCLUDED.authority_class;

CREATE OR REPLACE FUNCTION refs_reserve_idempotency(p_tenant uuid,p_scope text,p_key text,p_request_hash text,p_actor text) RETURNS idempotency_receipt
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE receipt idempotency_receipt;
BEGIN
  IF refs_current_tenant() IS DISTINCT FROM p_tenant THEN RAISE EXCEPTION 'Idempotency tenant scope denied' USING ERRCODE='42501'; END IF;
  IF refs_current_actor() IS DISTINCT FROM p_actor THEN RAISE EXCEPTION 'Actor must come from the authenticated session' USING ERRCODE='42501'; END IF;
  IF p_scope NOT LIKE 'POST_JOURNAL:%' AND p_scope NOT LIKE 'EDIT_JOURNAL:%' AND p_scope NOT LIKE 'CLOSE_PERIOD:%' AND p_scope NOT LIKE 'REOPEN_PERIOD:%' AND p_scope NOT LIKE 'RETIRE_CONFIG:%' AND p_scope NOT LIKE 'CREATE_MANUAL_JOURNAL:%' AND p_scope NOT LIKE 'CREATE_AUTO_JOURNAL:%' AND p_scope NOT LIKE 'CREATE_REVERSAL:%' AND p_scope NOT LIKE 'CREATE_RECLASS:%' AND p_scope NOT LIKE 'JOURNAL_SUBMIT:%' AND p_scope NOT LIKE 'JOURNAL_REVIEW:%' AND p_scope NOT LIKE 'JOURNAL_APPROVE:%' AND p_scope NOT LIKE 'JOURNAL_REJECT:%' AND p_scope NOT LIKE 'AR_RECEIPT_REVERSAL:%' AND p_scope NOT LIKE 'AP_PAYMENT_REVERSAL:%' AND p_scope NOT LIKE 'PREPARE_STATEMENT_SNAPSHOT:%' AND p_scope NOT LIKE 'APPROVE_STATEMENT_SNAPSHOT:%' AND p_scope NOT LIKE 'WBS_H1_PAYABLE_RECLASS_DRAFT:%' THEN RAISE EXCEPTION 'Idempotency operation scope denied' USING ERRCODE='42501'; END IF;
  INSERT INTO idempotency_receipt(tenant_id,operation_scope,idempotency_key,request_hash,status,actor_id) VALUES(p_tenant,p_scope,p_key,p_request_hash,'IN_PROGRESS',p_actor) ON CONFLICT(tenant_id,operation_scope,idempotency_key) DO NOTHING;
  SELECT * INTO receipt FROM idempotency_receipt WHERE tenant_id=p_tenant AND operation_scope=p_scope AND idempotency_key=p_key FOR UPDATE;
  IF receipt.request_hash<>p_request_hash OR receipt.actor_id<>p_actor THEN RAISE EXCEPTION 'Idempotency key reused by a different request or actor' USING ERRCODE='23505'; END IF;
  RETURN receipt;
END;
$$;

CREATE FUNCTION refs_reopen_period_v1(
  p_tenant uuid,p_entity uuid,p_period uuid,p_expected_version bigint,
  p_expected_close_audit_event_id uuid,p_expected_readiness_hash text,
  p_reason text,p_idempotency_key text,p_request_hash text
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE
  v_actor text:=refs_current_actor();v_period accounting_period%ROWTYPE;v_close audit_event%ROWTYPE;
  v_receipt idempotency_receipt;v_response jsonb;v_event jsonb;v_canonical text;v_prior_closed_at text;
  v_close_metadata_key_count integer:=-1;
BEGIN
  PERFORM refs_assert_scope(p_tenant,p_entity,'GL.PERIOD.REOPEN');
  IF v_actor IS NULL THEN RAISE EXCEPTION 'Authenticated actor missing' USING ERRCODE='42501';END IF;
  IF p_expected_version<1 OR p_expected_close_audit_event_id IS NULL
     OR p_expected_readiness_hash !~ '^sha256:[0-9a-f]{64}$'
     OR p_reason IS NULL OR p_reason<>btrim(p_reason) OR length(p_reason) NOT BETWEEN 8 AND 2000 THEN
    RAISE EXCEPTION 'Reopen version, close evidence, and reason are required' USING ERRCODE='22023';END IF;
  v_canonical:=refs_jsonb_hash(jsonb_build_object(
    'tenant_id',p_tenant,'entity_id',p_entity,'period_id',p_period,'expected_version',p_expected_version::text,
    'expected_close_audit_event_id',p_expected_close_audit_event_id,
    'expected_readiness_hash',p_expected_readiness_hash,'reason',p_reason));
  IF p_request_hash<>v_canonical THEN RAISE EXCEPTION 'Period reopen request hash is not canonical' USING ERRCODE='22023';END IF;
  v_receipt:=refs_reserve_idempotency(p_tenant,'REOPEN_PERIOD:'||p_entity,p_idempotency_key,p_request_hash,v_actor);
  IF v_receipt.status='SUCCEEDED' THEN RETURN v_receipt.response_body||jsonb_build_object('idempotent',true);END IF;

  SELECT * INTO v_period FROM accounting_period
   WHERE tenant_id=p_tenant AND entity_id=p_entity AND period_id=p_period FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Period not found' USING ERRCODE='P0002';END IF;
  IF v_period.status<>'CLOSED' OR v_period.closed_by IS NULL OR v_period.closed_at IS NULL THEN
    RAISE EXCEPTION 'Only a retained CLOSED period can be reopened' USING ERRCODE='55000';END IF;
  IF v_period.version<>p_expected_version THEN RAISE EXCEPTION 'Period version conflict' USING ERRCODE='40001';END IF;

  SELECT * INTO v_close FROM audit_event a
   WHERE a.audit_event_id=p_expected_close_audit_event_id AND a.tenant_id=p_tenant AND a.entity_id=p_entity
     AND a.object_id=p_period AND a.event_type='PERIOD_CLOSED_V2' AND a.object_type='ACCOUNTING_PERIOD' AND a.action='CLOSE'
   FOR SHARE;
  IF NOT FOUND OR EXISTS(
    SELECT 1 FROM audit_event newer WHERE newer.tenant_id=p_tenant AND newer.entity_id=p_entity
      AND newer.object_id=p_period AND newer.event_type='PERIOD_CLOSED_V2'
      AND newer.object_type='ACCOUNTING_PERIOD' AND newer.action='CLOSE'
      AND (newer.occurred_at,newer.audit_event_id)>(v_close.occurred_at,v_close.audit_event_id)
  ) THEN RAISE EXCEPTION 'Expected close receipt is not the latest retained close' USING ERRCODE='40001';END IF;

  IF jsonb_typeof(v_close.metadata)='object' THEN
    SELECT count(*) INTO v_close_metadata_key_count FROM jsonb_object_keys(v_close.metadata);
  END IF;
  IF v_close.permission_used<>'GL.PERIOD.CLOSE' OR v_close.actor_id IS NULL OR v_close.actor_id<>v_period.closed_by
     OR v_close.reason IS NULL OR v_close.reason<>btrim(v_close.reason) OR length(v_close.reason) NOT BETWEEN 8 AND 2000
     OR v_close.idempotency_key IS NULL OR v_close.idempotency_key<>btrim(v_close.idempotency_key)
     OR length(v_close.idempotency_key) NOT BETWEEN 8 AND 512
     OR v_close.after_hash<>p_expected_readiness_hash
     OR v_close_metadata_key_count<>17
     OR v_close.metadata->>'schema_version'<>'PERIOD_CLOSED_EVENT_V2'
     OR v_close.metadata->>'period_id'<>p_period::text OR v_close.metadata->>'status'<>'CLOSED'
     OR v_close.metadata->>'version'<>p_expected_version::text
     OR v_close.metadata->>'readiness_hash'<>p_expected_readiness_hash
     OR v_close.metadata->>'closed_by'<>v_close.actor_id OR v_close.metadata->>'reason'<>v_close.reason
     OR (SELECT count(*) FROM outbox_event o WHERE o.tenant_id=p_tenant AND o.entity_id=p_entity
           AND o.aggregate_type='ACCOUNTING_PERIOD' AND o.aggregate_id=p_period
           AND o.event_type='PERIOD_CLOSED_V2' AND o.payload=v_close.metadata
           AND o.payload_hash=refs_jsonb_hash(v_close.metadata))<>1 THEN
    RAISE EXCEPTION 'Expected close evidence failed retained integrity checks' USING ERRCODE='23514';END IF;
  IF v_actor=v_close.actor_id THEN
    RAISE EXCEPTION 'The period closer cannot reopen the same retained close' USING ERRCODE='42501';END IF;

  v_prior_closed_at:=to_char(v_period.closed_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');
  UPDATE accounting_period SET status='OPEN',closed_by=NULL,closed_at=NULL,version=version+1
   WHERE tenant_id=p_tenant AND entity_id=p_entity AND period_id=p_period AND version=p_expected_version;
  v_response:=jsonb_build_object(
    'schema_version','PERIOD_REOPEN_RECEIPT_V1','period_id',p_period,'version',(p_expected_version+1)::text,
    'status','OPEN','prior_close_audit_event_id',p_expected_close_audit_event_id,
    'prior_readiness_hash',p_expected_readiness_hash,'reopened_by',v_actor,'idempotent',false);
  v_event:=jsonb_build_object(
    'schema_version','PERIOD_REOPENED_EVENT_V1','period_id',p_period,'period_code',v_period.period_code,
    'version',(p_expected_version+1)::text,'prior_close_audit_event_id',p_expected_close_audit_event_id,
    'prior_readiness_hash',p_expected_readiness_hash,'prior_closed_by',v_close.actor_id,
    'prior_closed_at',v_prior_closed_at,'reason',p_reason,'reopened_by',v_actor,'status','OPEN');
  INSERT INTO audit_event(tenant_id,entity_id,event_type,object_type,object_id,action,actor_id,actor_type,permission_used,
    request_id,correlation_id,idempotency_key,before_hash,after_hash,reason,metadata)
   VALUES(p_tenant,p_entity,'PERIOD_REOPENED_V1','ACCOUNTING_PERIOD',p_period,'REOPEN',v_actor,'USER','GL.PERIOD.REOPEN',
    p_idempotency_key,p_idempotency_key,p_idempotency_key,p_expected_readiness_hash,refs_jsonb_hash(v_event),p_reason,v_event);
  INSERT INTO outbox_event(tenant_id,entity_id,aggregate_type,aggregate_id,event_type,payload,payload_hash)
   VALUES(p_tenant,p_entity,'ACCOUNTING_PERIOD',p_period,'PERIOD_REOPENED_V1',v_event,refs_jsonb_hash(v_event));
  UPDATE idempotency_receipt SET status='SUCCEEDED',response_status=200,response_body=v_response,completed_at=clock_timestamp()
   WHERE idempotency_receipt_id=v_receipt.idempotency_receipt_id;
  RETURN v_response;
END;
$$;

REVOKE ALL ON FUNCTION refs_reopen_period_v1(uuid,uuid,uuid,bigint,uuid,text,text,text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION refs_reopen_period_v1(uuid,uuid,uuid,bigint,uuid,text,text,text,text) TO refs_app;

COMMIT;
