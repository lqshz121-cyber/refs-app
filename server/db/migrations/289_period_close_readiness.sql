BEGIN;

CREATE FUNCTION refs_read_period_close_readiness(p_tenant uuid,p_entity uuid,p_period uuid)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE
  v_period accounting_period%ROWTYPE;v_settings jsonb;v_settings_error text;
  v_rows jsonb;v_current_snapshot_hash text;v_current_ledger_hash text;
  v_snapshot financial_statement_snapshot%ROWTYPE;v_unposted integer;v_source_blockers integer;
  v_blockers jsonb:='[]'::jsonb;v_core jsonb;
BEGIN
  PERFORM refs_assert_scope(p_tenant,p_entity,'GL.PERIOD.CLOSE');
  SELECT * INTO v_period FROM accounting_period WHERE tenant_id=p_tenant AND entity_id=p_entity AND period_id=p_period FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Period is not in the authorized entity scope' USING ERRCODE='P0002';END IF;

  IF v_period.status='OPEN' THEN
    BEGIN
      v_settings:=refs_read_wbs_ai_approved_entity_period_settings(p_tenant,p_entity,p_period);
    EXCEPTION WHEN OTHERS THEN
      v_settings_error:=SQLSTATE||':'||SQLERRM;
      v_blockers:=v_blockers||jsonb_build_array(jsonb_build_object('code','APPROVED_CLOSE_POLICY_UNAVAILABLE','count',1));
    END;
  ELSE
    v_blockers:=v_blockers||jsonb_build_array(jsonb_build_object('code','PERIOD_NOT_OPEN','count',1));
  END IF;

  SELECT count(*) INTO v_unposted FROM journal_entry
   WHERE tenant_id=p_tenant AND entity_id=p_entity AND period_id=p_period AND status<>'POSTED';
  IF v_unposted>0 THEN v_blockers:=v_blockers||jsonb_build_array(jsonb_build_object('code','UNPOSTED_JOURNALS','count',v_unposted));END IF;

  SELECT count(*) INTO v_source_blockers FROM ai_admitted_source_review_current_finding
   WHERE tenant_id=p_tenant AND entity_id=p_entity AND accounting_period_id=p_period;
  IF v_source_blockers>0 THEN v_blockers:=v_blockers||jsonb_build_array(jsonb_build_object('code','ADMITTED_SOURCE_REVIEW_OPEN','count',v_source_blockers));END IF;

  SELECT * INTO v_snapshot FROM financial_statement_snapshot
   WHERE tenant_id=p_tenant AND entity_id=p_entity AND period_id=p_period
   ORDER BY version DESC,financial_statement_snapshot_id DESC LIMIT 1;
  IF NOT FOUND THEN
    v_blockers:=v_blockers||jsonb_build_array(jsonb_build_object('code','APPROVED_STATEMENT_SNAPSHOT_MISSING','count',1));
  ELSE
    SELECT jsonb_agg(jsonb_build_object(
      'statement_type',statement_type,'statement_section',statement_section,'classification_basis',classification_basis,
      'account_code',account_code,'account_name',account_name,'opening_debit',opening_debit,'opening_credit',opening_credit,
      'period_debit',period_debit,'period_credit',period_credit,'ending_debit',ending_debit,'ending_credit',ending_credit,
      'display_balance',display_balance,'journal_entry_ids',journal_entry_ids,'journal_line_ids',journal_line_ids,
      'ledger_line_ids',ledger_line_ids,'source_document_ids',source_document_ids
    ) ORDER BY statement_type,statement_section,account_code) INTO v_rows
    FROM refs_get_financial_statements(p_tenant,p_entity,p_period);
    v_current_snapshot_hash:=CASE WHEN v_rows IS NULL THEN NULL ELSE refs_jsonb_hash(v_rows) END;
    v_current_ledger_hash:=CASE WHEN v_rows IS NULL THEN NULL ELSE refs_jsonb_hash(jsonb_build_object('statement_rows',v_rows)) END;
    IF v_current_snapshot_hash IS NULL OR v_snapshot.snapshot_hash<>v_current_snapshot_hash
       OR v_snapshot.ledger_evidence_hash<>v_current_ledger_hash THEN
      v_blockers:=v_blockers||jsonb_build_array(jsonb_build_object('code','APPROVED_STATEMENT_SNAPSHOT_STALE','count',1));
    END IF;
  END IF;

  v_core:=jsonb_build_object(
    'schema_version','PERIOD_CLOSE_READINESS_V1','tenant_id',p_tenant,'entity_id',p_entity,'period_id',p_period,
    'period_code',v_period.period_code,'period_status',v_period.status,'period_version',v_period.version::text,
    'settings_snapshot_id',v_settings->>'settings_snapshot_id','settings_hash',v_settings->>'settings_hash',
    'close_policy_snapshot_id',v_settings#>>'{period_close_policy,setting_snapshot_id}',
    'close_policy_hash',v_settings#>>'{period_close_policy,snapshot_hash}',
    'financial_statement_snapshot_id',v_snapshot.financial_statement_snapshot_id,
    'financial_statement_snapshot_hash',v_snapshot.snapshot_hash,'ledger_evidence_hash',v_snapshot.ledger_evidence_hash,
    'unposted_journal_count',v_unposted,'admitted_source_blocker_count',v_source_blockers,
    'blockers',v_blockers,'ready',jsonb_array_length(v_blockers)=0
  );
  RETURN v_core||jsonb_build_object('readiness_hash',refs_jsonb_hash(v_core),'can_close',jsonb_array_length(v_blockers)=0);
END $$;

CREATE FUNCTION refs_close_period_v2(
  p_tenant uuid,p_entity uuid,p_period uuid,p_expected_version bigint,p_expected_readiness_hash text,
  p_reason text,p_idempotency_key text,p_request_hash text
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE v_actor text:=refs_current_actor();v_period accounting_period%ROWTYPE;v_receipt idempotency_receipt;
  v_readiness jsonb;v_response jsonb;v_event jsonb;v_canonical text;
BEGIN
  PERFORM refs_assert_scope(p_tenant,p_entity,'GL.PERIOD.CLOSE');
  IF v_actor IS NULL THEN RAISE EXCEPTION 'Authenticated actor missing' USING ERRCODE='42501';END IF;
  IF p_expected_version<0 OR p_expected_readiness_hash !~ '^sha256:[0-9a-f]{64}$'
     OR p_reason IS NULL OR p_reason<>btrim(p_reason) OR length(p_reason) NOT BETWEEN 8 AND 2000 THEN
    RAISE EXCEPTION 'Close version, readiness hash, and reason are required' USING ERRCODE='22023';END IF;
  v_canonical:=refs_jsonb_hash(jsonb_build_object('tenant_id',p_tenant,'entity_id',p_entity,'period_id',p_period,
    'expected_version',p_expected_version::text,'expected_readiness_hash',p_expected_readiness_hash,'reason',p_reason));
  IF p_request_hash<>v_canonical THEN RAISE EXCEPTION 'Period close request hash is not canonical' USING ERRCODE='22023';END IF;
  v_receipt:=refs_reserve_idempotency(p_tenant,'CLOSE_PERIOD:'||p_entity,p_idempotency_key,p_request_hash,v_actor);
  IF v_receipt.status='SUCCEEDED' THEN RETURN v_receipt.response_body||jsonb_build_object('idempotent',true);END IF;

  SELECT * INTO v_period FROM accounting_period WHERE tenant_id=p_tenant AND entity_id=p_entity AND period_id=p_period FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Period not found' USING ERRCODE='P0002';END IF;
  IF v_period.status<>'OPEN' THEN RAISE EXCEPTION 'Only an OPEN period can be closed' USING ERRCODE='55000';END IF;
  IF v_period.version<>p_expected_version THEN RAISE EXCEPTION 'Period version conflict' USING ERRCODE='40001';END IF;
  v_readiness:=refs_read_period_close_readiness(p_tenant,p_entity,p_period);
  IF v_readiness->>'readiness_hash'<>p_expected_readiness_hash THEN RAISE EXCEPTION 'Period close readiness changed' USING ERRCODE='40001';END IF;
  IF v_readiness->>'ready'<>'true' OR jsonb_array_length(v_readiness->'blockers')<>0 THEN
    RAISE EXCEPTION 'Period close readiness is blocked' USING ERRCODE='55000';END IF;

  UPDATE accounting_period SET status='CLOSED',closed_by=v_actor,closed_at=clock_timestamp(),version=version+1
   WHERE tenant_id=p_tenant AND entity_id=p_entity AND period_id=p_period AND version=p_expected_version;
  v_response:=jsonb_build_object('schema_version','PERIOD_CLOSE_RECEIPT_V2','period_id',p_period,
    'version',(p_expected_version+1)::text,'status','CLOSED','readiness_hash',p_expected_readiness_hash,
    'closed_by',v_actor,'idempotent',false);
  v_event:=jsonb_build_object('schema_version','PERIOD_CLOSED_EVENT_V2','period_id',p_period,
    'period_code',v_readiness->>'period_code','version',(p_expected_version+1)::text,
    'readiness_hash',p_expected_readiness_hash,'settings_snapshot_id',v_readiness->'settings_snapshot_id',
    'settings_hash',v_readiness->'settings_hash','close_policy_snapshot_id',v_readiness->'close_policy_snapshot_id',
    'close_policy_hash',v_readiness->'close_policy_hash','financial_statement_snapshot_id',v_readiness->'financial_statement_snapshot_id',
    'financial_statement_snapshot_hash',v_readiness->'financial_statement_snapshot_hash','ledger_evidence_hash',v_readiness->'ledger_evidence_hash',
    'unposted_journal_count',0,'admitted_source_blocker_count',0,'reason',p_reason,'closed_by',v_actor,'status','CLOSED');
  INSERT INTO audit_event(tenant_id,entity_id,event_type,object_type,object_id,action,actor_id,actor_type,permission_used,
    request_id,correlation_id,idempotency_key,after_hash,reason,metadata)
   VALUES(p_tenant,p_entity,'PERIOD_CLOSED_V2','ACCOUNTING_PERIOD',p_period,'CLOSE',v_actor,'USER','GL.PERIOD.CLOSE',
    p_idempotency_key,p_idempotency_key,p_idempotency_key,p_expected_readiness_hash,p_reason,v_event);
  INSERT INTO outbox_event(tenant_id,entity_id,aggregate_type,aggregate_id,event_type,payload,payload_hash)
   VALUES(p_tenant,p_entity,'ACCOUNTING_PERIOD',p_period,'PERIOD_CLOSED_V2',v_event,refs_jsonb_hash(v_event));
  UPDATE idempotency_receipt SET status='SUCCEEDED',response_status=200,response_body=v_response,completed_at=clock_timestamp()
   WHERE idempotency_receipt_id=v_receipt.idempotency_receipt_id;
  RETURN v_response;
END $$;

REVOKE EXECUTE ON FUNCTION refs_close_period(uuid,uuid,uuid,bigint,text,text,text) FROM refs_app;
REVOKE ALL ON FUNCTION refs_read_period_close_readiness(uuid,uuid,uuid),refs_close_period_v2(uuid,uuid,uuid,bigint,text,text,text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION refs_read_period_close_readiness(uuid,uuid,uuid),refs_close_period_v2(uuid,uuid,uuid,bigint,text,text,text,text) TO refs_app;

COMMIT;
