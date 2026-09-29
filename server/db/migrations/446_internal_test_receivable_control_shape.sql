BEGIN;

-- 446 / D-O06-2: refs_ensure_internal_test_customer_master (426) refused to start the internal-test
-- API on staging (STARTUP_INTERNAL_TEST_CUSTOMER_MASTER_FAILED, 2026-09-28) because the entity's
-- 120200 was seeded as a plain account. Same function, one added step: an UNPOSTED 120200 may be
-- made member-bearing; everything else in 426 (scope, receipt, member, audit, outbox) is unchanged.

-- O06: internal full-test AR chains need a visibly test-only CUSTOMER member.
-- Same shape and guard as 419 (bank/cash master): only the configured cash-control
-- maker scope may call it, it accepts no browser-selected master data, it is
-- idempotent under one receipt, and it never touches WBS tables or real customers.
CREATE OR REPLACE FUNCTION refs_ensure_internal_test_customer_master(
  p_tenant uuid,p_entity uuid,p_idempotency_key text
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE
  actor text:=refs_current_actor();
  receipt idempotency_receipt;
  expected text;
  response jsonb;
  audit_id uuid:=gen_random_uuid();
BEGIN
  PERFORM refs_assert_scope(p_tenant,p_entity,'CASH.TRANSFER.CONFIGURE');
  IF actor IS NULL OR p_idempotency_key IS NULL OR p_idempotency_key !~ '^[A-Za-z0-9._:-]{8,128}$' THEN
    RAISE EXCEPTION 'Internal test customer master requires an authenticated configured maker and idempotency key' USING ERRCODE='22023';
  END IF;
  expected:=refs_jsonb_hash(jsonb_build_object(
    'tenant_id',p_tenant,'entity_id',p_entity,
    'customer_member_ref','INTERNAL_TEST_CUSTOMER',
    'receivable_account_code','120200',
    'currency','USD',
    'classification','INTERNAL_TEST_ONLY'
  ));
  PERFORM pg_advisory_xact_lock(hashtextextended('refs-internal-test-customer:'||p_tenant::text||':'||p_entity::text,0));
  INSERT INTO idempotency_receipt(tenant_id,operation_scope,idempotency_key,request_hash,status,actor_id)
    VALUES(p_tenant,'INTERNAL_TEST_CUSTOMER_MASTER:'||p_entity,p_idempotency_key,expected,'IN_PROGRESS',actor)
    ON CONFLICT(tenant_id,operation_scope,idempotency_key) DO NOTHING;
  SELECT * INTO receipt FROM idempotency_receipt
    WHERE tenant_id=p_tenant AND operation_scope='INTERNAL_TEST_CUSTOMER_MASTER:'||p_entity AND idempotency_key=p_idempotency_key
    FOR UPDATE;
  IF receipt.request_hash IS DISTINCT FROM expected OR receipt.actor_id IS DISTINCT FROM actor THEN
    RAISE EXCEPTION 'Internal test customer master idempotency conflict' USING ERRCODE='23505';
  END IF;
  IF receipt.status='SUCCEEDED' THEN
    RETURN receipt.response_body||jsonb_build_object('idempotent',true);
  END IF;

  INSERT INTO member_master(tenant_id,entity_id,member_ref,member_type,display_name,active)
    VALUES(p_tenant,p_entity,'INTERNAL_TEST_CUSTOMER','CUSTOMER','INTERNAL TEST ONLY Customer',true)
    ON CONFLICT DO NOTHING;
  PERFORM 1 FROM member_master
    WHERE tenant_id=p_tenant AND entity_id=p_entity AND member_ref='INTERNAL_TEST_CUSTOMER'
      AND member_type='CUSTOMER' AND display_name='INTERNAL TEST ONLY Customer' AND active
    FOR SHARE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Internal test customer master conflicts with existing company data' USING ERRCODE='23514';
  END IF;

  -- D-O06-2 (446): the internal-test entity carries 120200 seeded without a member requirement
  -- (staging read-back 2026-09-28: requires_member=false, 0 posted lines). AR always posts to
  -- 120200 with a customer member, so the only correct shape is member-bearing. The bootstrap may
  -- give the account that shape ONLY while nothing has ever been posted to it; an account with
  -- journal lines is real evidence and stays fail-closed below. It still never creates the account.
  IF EXISTS(SELECT 1 FROM account_master
            WHERE tenant_id=p_tenant AND entity_id=p_entity AND account_code='120200' AND active
              AND NOT (requires_member AND required_member_type IN ('CUSTOMER','CUSTOMER_OR_AFFILIATE')))
     AND NOT EXISTS(SELECT 1 FROM journal_line WHERE tenant_id=p_tenant AND entity_id=p_entity AND account_code='120200') THEN
    UPDATE account_master SET requires_member=true,required_member_type='CUSTOMER_OR_AFFILIATE'
      WHERE tenant_id=p_tenant AND entity_id=p_entity AND account_code='120200';
    INSERT INTO audit_event(tenant_id,entity_id,audit_event_id,event_type,object_type,object_id,action,actor_id,actor_type,permission_used,request_id,correlation_id,idempotency_key,after_hash,metadata)
      VALUES(p_tenant,p_entity,gen_random_uuid(),'INTERNAL_TEST_RECEIVABLE_CONTROL_RESHAPED','ACCOUNT_MASTER',gen_random_uuid(),'RESHAPE',actor,'USER','CASH.TRANSFER.CONFIGURE',p_idempotency_key,p_idempotency_key,p_idempotency_key,
        refs_jsonb_hash(jsonb_build_object('account_code','120200','requires_member',true,'required_member_type','CUSTOMER_OR_AFFILIATE')),
        jsonb_build_object('account_code','120200','requires_member',true,'required_member_type','CUSTOMER_OR_AFFILIATE','reason','D-O06-2: unposted AR control made member-bearing for the internal-test bootstrap'));
  END IF;

  -- The receivable control account must exist as a member-bearing account that accepts CUSTOMER members.
  -- The bootstrap never creates a control account, and never reshapes one that carries postings.
  PERFORM 1 FROM account_master
    WHERE tenant_id=p_tenant AND entity_id=p_entity AND account_code='120200' AND active
      AND requires_member AND required_member_type IN ('CUSTOMER','CUSTOMER_OR_AFFILIATE')
    FOR SHARE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Internal test customer master requires an active member-bearing 120200 receivable control account' USING ERRCODE='23514';
  END IF;

  response:=jsonb_build_object(
    'customer_member_ref','INTERNAL_TEST_CUSTOMER',
    'receivable_account_code','120200',
    'currency','USD',
    'classification','INTERNAL_TEST_ONLY',
    'idempotent',false
  );
  INSERT INTO audit_event(tenant_id,entity_id,audit_event_id,event_type,object_type,object_id,action,actor_id,actor_type,permission_used,request_id,correlation_id,idempotency_key,after_hash,metadata)
    VALUES(p_tenant,p_entity,audit_id,'INTERNAL_TEST_CUSTOMER_MASTER_READY','INTERNAL_TEST_CUSTOMER_MASTER',audit_id,'ENSURE',actor,'USER','CASH.TRANSFER.CONFIGURE',p_idempotency_key,p_idempotency_key,p_idempotency_key,expected,response);
  INSERT INTO outbox_event(tenant_id,entity_id,aggregate_type,aggregate_id,event_type,payload,payload_hash)
    VALUES(p_tenant,p_entity,'INTERNAL_TEST_CUSTOMER_MASTER',audit_id,'INTERNAL_TEST_CUSTOMER_MASTER_READY',response,refs_jsonb_hash(response));
  UPDATE idempotency_receipt SET status='SUCCEEDED',response_status=201,response_body=response,completed_at=clock_timestamp()
    WHERE idempotency_receipt_id=receipt.idempotency_receipt_id;
  RETURN response;
END;
$$;

REVOKE ALL ON FUNCTION refs_ensure_internal_test_customer_master(uuid,uuid,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION refs_ensure_internal_test_customer_master(uuid,uuid,text) TO refs_app;

COMMIT;
