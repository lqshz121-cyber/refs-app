BEGIN;

CREATE OR REPLACE FUNCTION refs_ap_vendor_credit_allocation_hash(
  p_tenant uuid,p_entity uuid,p_credit uuid,p_bill uuid,p_amount numeric,p_reason text
) RETURNS text
LANGUAGE sql IMMUTABLE SET search_path=pg_catalog,public,pg_temp AS $$
  SELECT refs_jsonb_hash(jsonb_build_object(
    'tenant_id',p_tenant,'entity_id',p_entity,'business_adjustment_id',p_credit,
    'business_document_id',p_bill,'amount',p_amount,'reason',p_reason
  ))
$$;

CREATE OR REPLACE FUNCTION refs_apply_ap_vendor_credit(
  p_tenant uuid,p_entity uuid,p_credit uuid,p_bill uuid,p_amount numeric,p_reason text,p_idempotency_key text,p_request_hash text
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE actor text:=refs_current_actor(); receipt idempotency_receipt; computed_hash text;
DECLARE credit business_adjustment; bill business_document; allocation_id uuid:=gen_random_uuid(); allocated numeric(20,4); response jsonb; event_payload jsonb;
BEGIN
  PERFORM refs_assert_scope(p_tenant,p_entity,'AP.VENDOR_CREDIT.APPLY');
  IF actor IS NULL THEN RAISE EXCEPTION 'Authenticated actor missing' USING ERRCODE='42501'; END IF;
  computed_hash:=refs_ap_vendor_credit_allocation_hash(p_tenant,p_entity,p_credit,p_bill,p_amount,p_reason);
  IF p_request_hash<>computed_hash THEN RAISE EXCEPTION 'AP vendor credit allocation request hash is not canonical' USING ERRCODE='22023'; END IF;
  IF p_amount<=0 OR COALESCE(length(btrim(p_reason)),0)<8 THEN
    RAISE EXCEPTION 'AP vendor credit allocation requires positive amount and reason' USING ERRCODE='22023';
  END IF;

  INSERT INTO idempotency_receipt(tenant_id,operation_scope,idempotency_key,request_hash,status,actor_id)
    VALUES(p_tenant,'AP_VENDOR_CREDIT_APPLY:'||p_entity,p_idempotency_key,p_request_hash,'IN_PROGRESS',actor)
  ON CONFLICT (tenant_id,operation_scope,idempotency_key) DO NOTHING;
  SELECT * INTO receipt FROM idempotency_receipt
    WHERE tenant_id=p_tenant AND operation_scope='AP_VENDOR_CREDIT_APPLY:'||p_entity AND idempotency_key=p_idempotency_key FOR UPDATE;
  IF receipt.request_hash<>p_request_hash THEN RAISE EXCEPTION 'Idempotency key reused with a different request' USING ERRCODE='23505'; END IF;
  IF receipt.status='SUCCEEDED' THEN RETURN receipt.response_body||jsonb_build_object('idempotent',true); END IF;

  SELECT * INTO credit FROM business_adjustment
    WHERE tenant_id=p_tenant AND entity_id=p_entity AND business_adjustment_id=p_credit FOR UPDATE;
  IF NOT FOUND OR credit.adjustment_kind<>'AP_VENDOR_CREDIT' OR credit.status<>'POSTED' OR credit.posted_journal_entry_id IS NULL THEN
    RAISE EXCEPTION 'Only posted AP vendor credits can be allocated' USING ERRCODE='23514';
  END IF;
  SELECT * INTO bill FROM business_document
    WHERE tenant_id=p_tenant AND entity_id=p_entity AND business_document_id=p_bill FOR UPDATE;
  IF NOT FOUND OR bill.document_kind<>'AP_BILL' OR bill.status NOT IN ('APPROVED','OPEN','PARTIALLY_PAID') OR bill.open_balance<=0 THEN
    RAISE EXCEPTION 'AP vendor credits can only apply to open AP bills' USING ERRCODE='23514';
  END IF;
  IF bill.currency<>credit.currency THEN RAISE EXCEPTION 'AP vendor credit allocation currency mismatch' USING ERRCODE='23514'; END IF;

  PERFORM 1 FROM business_allocation
    WHERE tenant_id=p_tenant AND entity_id=p_entity AND business_adjustment_id=p_credit AND status IN ('PENDING','ACTIVE') FOR UPDATE;
  SELECT COALESCE(sum(amount),0) INTO allocated FROM business_allocation
    WHERE tenant_id=p_tenant AND entity_id=p_entity AND business_adjustment_id=p_credit AND status IN ('PENDING','ACTIVE');
  IF allocated+p_amount>credit.amount OR p_amount>bill.open_balance THEN
    RAISE EXCEPTION 'AP vendor credit allocation exceeds credit or bill open balance' USING ERRCODE='23514';
  END IF;

  INSERT INTO business_allocation(business_allocation_id,tenant_id,entity_id,business_document_id,business_adjustment_id,amount,currency,status,created_by)
    VALUES(allocation_id,p_tenant,p_entity,p_bill,p_credit,p_amount,credit.currency,'PENDING',actor);
  response:=jsonb_build_object('business_allocation_id',allocation_id,'business_adjustment_id',p_credit,'business_document_id',p_bill,'amount',p_amount,'status','PENDING','idempotent',false);
  INSERT INTO audit_event(tenant_id,entity_id,event_type,object_type,object_id,action,actor_id,actor_type,permission_used,request_id,correlation_id,idempotency_key,after_hash,reason)
    VALUES(p_tenant,p_entity,'AP_VENDOR_CREDIT_ALLOCATION_PENDING','BUSINESS_ALLOCATION',allocation_id,'APPLY_AP_VENDOR_CREDIT',actor,'USER','AP.VENDOR_CREDIT.APPLY',p_idempotency_key,p_idempotency_key,p_idempotency_key,p_request_hash,p_reason);
  event_payload:=jsonb_build_object('business_allocation_id',allocation_id,'business_adjustment_id',p_credit,'business_document_id',p_bill,'amount',p_amount,'status','PENDING');
  INSERT INTO outbox_event(tenant_id,entity_id,aggregate_type,aggregate_id,event_type,payload,payload_hash)
    VALUES(p_tenant,p_entity,'BUSINESS_ALLOCATION',allocation_id,'AP_VENDOR_CREDIT_ALLOCATION_PENDING',event_payload,refs_jsonb_hash(event_payload));
  UPDATE idempotency_receipt SET status='SUCCEEDED',response_status=201,response_body=response,completed_at=clock_timestamp()
    WHERE tenant_id=p_tenant AND operation_scope='AP_VENDOR_CREDIT_APPLY:'||p_entity AND idempotency_key=p_idempotency_key;
  RETURN response;
END;
$$;

REVOKE EXECUTE ON FUNCTION refs_ap_vendor_credit_allocation_hash(uuid,uuid,uuid,uuid,numeric,text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION refs_apply_ap_vendor_credit(uuid,uuid,uuid,uuid,numeric,text,text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION refs_ap_vendor_credit_allocation_hash(uuid,uuid,uuid,uuid,numeric,text) TO refs_app;
GRANT EXECUTE ON FUNCTION refs_apply_ap_vendor_credit(uuid,uuid,uuid,uuid,numeric,text,text,text) TO refs_app;

COMMIT;
