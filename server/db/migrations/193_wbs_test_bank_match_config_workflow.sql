BEGIN;

CREATE FUNCTION refs_propose_wbs_test_bank_match_config(p_tenant uuid,p_entity uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE actor text:=refs_current_actor(); setting public.setting_snapshot; mapping public.mapping_snapshot; changed boolean:=false;
DECLARE setting_body jsonb:=jsonb_build_object('schema_version','WBS_TEST_BANK_MATCH_SETTING_V1','mode','TEST_ONLY','bank_account_ref','WBS_TEST_BANK','cash_account_code','111000');
DECLARE input_body jsonb:=jsonb_build_object('schema_version','WBS_TEST_BANK_MATCH_MAPPING_INPUT_V1','bank_account_ref','WBS_TEST_BANK','currency','USD');
DECLARE output_body jsonb:=jsonb_build_object('schema_version','WBS_TEST_BANK_MATCH_MAPPING_OUTPUT_V1','mode','TEST_ONLY','source_module','payable','payment_method','CONTROLLED_TEST');
BEGIN
  PERFORM refs_assert_scope(p_tenant,p_entity,'WBS.TEST.IMPORT');
  PERFORM refs_assert_scope(p_tenant,p_entity,'AP.PAYMENT.CREATE');
  IF actor IS NULL THEN RAISE EXCEPTION 'Authenticated actor missing' USING ERRCODE='42501'; END IF;
  PERFORM 1 FROM entity WHERE tenant_id=p_tenant AND entity_id=p_entity FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Controlled test Bank Match entity is unavailable' USING ERRCODE='P0002'; END IF;

  SELECT * INTO setting FROM setting_snapshot WHERE tenant_id=p_tenant AND entity_id=p_entity AND family='BANK' AND scope_type='ENTITY' AND scope_key=p_entity::text FOR UPDATE;
  IF FOUND THEN
    IF setting.version<>1 OR setting.effective_from<>'2026-07-01 00:00:00+00'::timestamptz OR setting.effective_to IS DISTINCT FROM '2026-08-01 00:00:00+00'::timestamptz
      OR setting.snapshot<>setting_body OR setting.snapshot_hash<>refs_jsonb_hash(setting_body) OR setting.created_by<>actor OR setting.status NOT IN ('DRAFT','APPROVED') THEN
      RAISE EXCEPTION 'Controlled test Bank Match setting conflicts with retained configuration' USING ERRCODE='23505';
    END IF;
  ELSE
    INSERT INTO setting_snapshot(tenant_id,entity_id,family,scope_type,scope_key,version,effective_from,effective_to,status,snapshot,snapshot_hash,created_by)
      VALUES(p_tenant,p_entity,'BANK','ENTITY',p_entity::text,1,'2026-07-01 00:00:00+00','2026-08-01 00:00:00+00','DRAFT',setting_body,refs_jsonb_hash(setting_body),actor) RETURNING * INTO setting;
    changed:=true;
    INSERT INTO audit_event(tenant_id,entity_id,event_type,object_type,object_id,action,actor_id,actor_type,permission_used,request_id,correlation_id,idempotency_key,after_hash,reason)
      VALUES(p_tenant,p_entity,'CONTROLLED_TEST_BANK_MATCH_CONFIG_PROPOSED','SETTING_SNAPSHOT',setting.setting_snapshot_id,'PROPOSE',actor,'USER','WBS.TEST.IMPORT','wbs-test-bank-match-config','wbs-test-bank-match-config','wbs-test-bank-match-config-setting',setting.snapshot_hash,'TEST_ONLY isolated Bank Match configuration proposal');
  END IF;

  SELECT * INTO mapping FROM mapping_snapshot WHERE tenant_id=p_tenant AND entity_id=p_entity AND family='BANK' AND scope_type='ENTITY' AND scope_key=p_entity::text FOR UPDATE;
  IF FOUND THEN
    IF mapping.version<>1 OR mapping.priority<>0 OR mapping.effective_from<>'2026-07-01 00:00:00+00'::timestamptz OR mapping.effective_to IS DISTINCT FROM '2026-08-01 00:00:00+00'::timestamptz
      OR mapping.input_keys<>input_body OR mapping.input_key_hash<>refs_jsonb_hash(input_body) OR mapping.output_rules<>output_body
      OR mapping.snapshot_hash<>refs_jsonb_hash(jsonb_build_object('input_keys',input_body,'output_rules',output_body)) OR mapping.created_by<>actor OR mapping.status NOT IN ('DRAFT','APPROVED') THEN
      RAISE EXCEPTION 'Controlled test Bank Match mapping conflicts with retained configuration' USING ERRCODE='23505';
    END IF;
  ELSE
    INSERT INTO mapping_snapshot(tenant_id,entity_id,family,scope_type,scope_key,input_key_hash,version,priority,effective_from,effective_to,status,input_keys,output_rules,snapshot_hash,created_by)
      VALUES(p_tenant,p_entity,'BANK','ENTITY',p_entity::text,refs_jsonb_hash(input_body),1,0,'2026-07-01 00:00:00+00','2026-08-01 00:00:00+00','DRAFT',input_body,output_body,refs_jsonb_hash(jsonb_build_object('input_keys',input_body,'output_rules',output_body)),actor) RETURNING * INTO mapping;
    changed:=true;
    INSERT INTO audit_event(tenant_id,entity_id,event_type,object_type,object_id,action,actor_id,actor_type,permission_used,request_id,correlation_id,idempotency_key,after_hash,reason)
      VALUES(p_tenant,p_entity,'CONTROLLED_TEST_BANK_MATCH_CONFIG_PROPOSED','MAPPING_SNAPSHOT',mapping.mapping_snapshot_id,'PROPOSE',actor,'USER','WBS.TEST.IMPORT','wbs-test-bank-match-config','wbs-test-bank-match-config','wbs-test-bank-match-config-mapping',mapping.snapshot_hash,'TEST_ONLY isolated Bank Match configuration proposal');
  END IF;
  RETURN jsonb_build_object('setting_snapshot_id',setting.setting_snapshot_id,'mapping_snapshot_id',mapping.mapping_snapshot_id,'status',CASE WHEN setting.status='APPROVED' AND mapping.status='APPROVED' THEN 'APPROVED' ELSE 'DRAFT' END,'idempotent',NOT changed);
END $$;

CREATE FUNCTION refs_approve_wbs_test_bank_match_config(p_tenant uuid,p_entity uuid,p_setting uuid,p_mapping uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE actor text:=refs_current_actor(); setting public.setting_snapshot; mapping public.mapping_snapshot; changed boolean:=false;
DECLARE setting_body jsonb:=jsonb_build_object('schema_version','WBS_TEST_BANK_MATCH_SETTING_V1','mode','TEST_ONLY','bank_account_ref','WBS_TEST_BANK','cash_account_code','111000');
DECLARE input_body jsonb:=jsonb_build_object('schema_version','WBS_TEST_BANK_MATCH_MAPPING_INPUT_V1','bank_account_ref','WBS_TEST_BANK','currency','USD');
DECLARE output_body jsonb:=jsonb_build_object('schema_version','WBS_TEST_BANK_MATCH_MAPPING_OUTPUT_V1','mode','TEST_ONLY','source_module','payable','payment_method','CONTROLLED_TEST');
BEGIN
  PERFORM refs_assert_scope(p_tenant,p_entity,'GL.JE.REVIEW');
  PERFORM refs_assert_scope(p_tenant,p_entity,'BANK.RECONCILIATION.REVIEW');
  IF actor IS NULL THEN RAISE EXCEPTION 'Authenticated actor missing' USING ERRCODE='42501'; END IF;
  SELECT * INTO setting FROM setting_snapshot WHERE tenant_id=p_tenant AND entity_id=p_entity AND setting_snapshot_id=p_setting FOR UPDATE;
  SELECT * INTO mapping FROM mapping_snapshot WHERE tenant_id=p_tenant AND entity_id=p_entity AND mapping_snapshot_id=p_mapping FOR UPDATE;
  IF setting.setting_snapshot_id IS NULL OR mapping.mapping_snapshot_id IS NULL OR setting.created_by=actor OR mapping.created_by=actor
    OR setting.family<>'BANK' OR mapping.family<>'BANK' OR setting.scope_type<>'ENTITY' OR mapping.scope_type<>'ENTITY' OR setting.scope_key<>p_entity::text OR mapping.scope_key<>p_entity::text
    OR setting.version<>1 OR mapping.version<>1 OR mapping.priority<>0 OR setting.effective_from<>'2026-07-01 00:00:00+00'::timestamptz OR mapping.effective_from<>'2026-07-01 00:00:00+00'::timestamptz
    OR setting.effective_to IS DISTINCT FROM '2026-08-01 00:00:00+00'::timestamptz OR mapping.effective_to IS DISTINCT FROM '2026-08-01 00:00:00+00'::timestamptz
    OR setting.snapshot<>setting_body OR setting.snapshot_hash<>refs_jsonb_hash(setting_body) OR mapping.input_keys<>input_body OR mapping.input_key_hash<>refs_jsonb_hash(input_body)
    OR mapping.output_rules<>output_body OR mapping.snapshot_hash<>refs_jsonb_hash(jsonb_build_object('input_keys',input_body,'output_rules',output_body))
    OR setting.status NOT IN ('DRAFT','APPROVED') OR mapping.status NOT IN ('DRAFT','APPROVED') THEN
    RAISE EXCEPTION 'Controlled test Bank Match configuration approval evidence is incomplete or changed' USING ERRCODE='23514';
  END IF;
  IF setting.status='DRAFT' THEN UPDATE setting_snapshot SET status='APPROVED',approved_by=actor,approved_at=clock_timestamp() WHERE setting_snapshot_id=p_setting; changed:=true; END IF;
  IF mapping.status='DRAFT' THEN UPDATE mapping_snapshot SET status='APPROVED',approved_by=actor,approved_at=clock_timestamp() WHERE mapping_snapshot_id=p_mapping; changed:=true; END IF;
  IF (SELECT approved_by FROM setting_snapshot WHERE setting_snapshot_id=p_setting) IS DISTINCT FROM actor OR (SELECT approved_by FROM mapping_snapshot WHERE mapping_snapshot_id=p_mapping) IS DISTINCT FROM actor THEN
    RAISE EXCEPTION 'Controlled test Bank Match configuration was approved by a different controller' USING ERRCODE='40001';
  END IF;
  IF changed THEN
    INSERT INTO audit_event(tenant_id,entity_id,event_type,object_type,object_id,action,actor_id,actor_type,permission_used,request_id,correlation_id,idempotency_key,after_hash,reason)
      VALUES(p_tenant,p_entity,'CONTROLLED_TEST_BANK_MATCH_CONFIG_APPROVED','SETTING_SNAPSHOT',p_setting,'APPROVE',actor,'USER','BANK.RECONCILIATION.REVIEW','wbs-test-bank-match-config','wbs-test-bank-match-config','wbs-test-bank-match-config-approve-setting',setting.snapshot_hash,'Independent TEST_ONLY Bank Match configuration approval');
    INSERT INTO audit_event(tenant_id,entity_id,event_type,object_type,object_id,action,actor_id,actor_type,permission_used,request_id,correlation_id,idempotency_key,after_hash,reason)
      VALUES(p_tenant,p_entity,'CONTROLLED_TEST_BANK_MATCH_CONFIG_APPROVED','MAPPING_SNAPSHOT',p_mapping,'APPROVE',actor,'USER','BANK.RECONCILIATION.REVIEW','wbs-test-bank-match-config','wbs-test-bank-match-config','wbs-test-bank-match-config-approve-mapping',mapping.snapshot_hash,'Independent TEST_ONLY Bank Match configuration approval');
  END IF;
  RETURN jsonb_build_object('setting_snapshot_id',p_setting,'mapping_snapshot_id',p_mapping,'status','APPROVED','idempotent',NOT changed);
END $$;

REVOKE ALL ON FUNCTION refs_propose_wbs_test_bank_match_config(uuid,uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION refs_approve_wbs_test_bank_match_config(uuid,uuid,uuid,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION refs_propose_wbs_test_bank_match_config(uuid,uuid) TO refs_app;
GRANT EXECUTE ON FUNCTION refs_approve_wbs_test_bank_match_config(uuid,uuid,uuid,uuid) TO refs_app;

COMMIT;
