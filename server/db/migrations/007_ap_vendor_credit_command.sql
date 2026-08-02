BEGIN;

CREATE OR REPLACE FUNCTION refs_ap_vendor_credit_hash(
  p_tenant uuid,p_entity uuid,p_period uuid,p_credit_number text,p_credit_date date,p_vendor_ref text,p_vendor_name text,p_amount numeric,p_lines jsonb,p_reason text
) RETURNS text
LANGUAGE sql IMMUTABLE SET search_path=pg_catalog,public,pg_temp AS $$
  SELECT refs_jsonb_hash(jsonb_build_object(
    'tenant_id',p_tenant,'entity_id',p_entity,'period_id',p_period,'credit_number',btrim(p_credit_number),
    'credit_date',p_credit_date,'vendor_ref',btrim(p_vendor_ref),'vendor_name',btrim(p_vendor_name),
    'amount',p_amount,'lines',p_lines,'reason',p_reason
  ))
$$;

CREATE OR REPLACE FUNCTION refs_create_ap_vendor_credit(
  p_tenant uuid,p_entity uuid,p_period uuid,p_credit_number text,p_credit_date date,p_vendor_ref text,p_vendor_name text,
  p_amount numeric,p_lines jsonb,p_reason text,p_idempotency_key text,p_request_hash text
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE actor text:=refs_current_actor(); receipt idempotency_receipt; computed_hash text;
DECLARE period_row accounting_period; entity_row entity; journal_id uuid:=gen_random_uuid(); adjustment_id uuid:=gen_random_uuid();
DECLARE line_count integer; response jsonb; event_payload jsonb;
BEGIN
  PERFORM refs_assert_scope(p_tenant,p_entity,'AP.VENDOR_CREDIT.CREATE');
  IF actor IS NULL THEN RAISE EXCEPTION 'Authenticated actor missing' USING ERRCODE='42501'; END IF;
  computed_hash:=refs_ap_vendor_credit_hash(p_tenant,p_entity,p_period,p_credit_number,p_credit_date,p_vendor_ref,p_vendor_name,p_amount,p_lines,p_reason);
  IF p_request_hash<>computed_hash THEN RAISE EXCEPTION 'AP vendor credit request hash is not canonical' USING ERRCODE='22023'; END IF;
  IF COALESCE(length(btrim(p_credit_number)),0)=0 OR COALESCE(length(btrim(p_vendor_ref)),0)=0 OR COALESCE(length(btrim(p_vendor_name)),0)=0 OR p_amount<=0 THEN
    RAISE EXCEPTION 'AP vendor credit requires number, vendor and positive amount' USING ERRCODE='22023';
  END IF;

  INSERT INTO idempotency_receipt(tenant_id,operation_scope,idempotency_key,request_hash,status,actor_id)
    VALUES(p_tenant,'AP_VENDOR_CREDIT:'||p_entity,p_idempotency_key,p_request_hash,'IN_PROGRESS',actor)
  ON CONFLICT (tenant_id,operation_scope,idempotency_key) DO NOTHING;
  SELECT * INTO receipt FROM idempotency_receipt
    WHERE tenant_id=p_tenant AND operation_scope='AP_VENDOR_CREDIT:'||p_entity AND idempotency_key=p_idempotency_key FOR UPDATE;
  IF receipt.request_hash<>p_request_hash THEN RAISE EXCEPTION 'Idempotency key reused with a different request' USING ERRCODE='23505'; END IF;
  IF receipt.status='SUCCEEDED' THEN RETURN receipt.response_body||jsonb_build_object('idempotent',true); END IF;

  SELECT * INTO period_row FROM accounting_period WHERE tenant_id=p_tenant AND entity_id=p_entity AND period_id=p_period FOR UPDATE;
  IF NOT FOUND OR period_row.status<>'OPEN' OR p_credit_date NOT BETWEEN period_row.starts_on AND period_row.ends_on THEN
    RAISE EXCEPTION 'AP vendor credit period must be OPEN and own the credit date' USING ERRCODE='55000';
  END IF;
  SELECT * INTO entity_row FROM entity WHERE tenant_id=p_tenant AND entity_id=p_entity FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Entity not found' USING ERRCODE='23503'; END IF;
  IF jsonb_typeof(p_lines)<>'array' THEN
    RAISE EXCEPTION 'AP vendor credit lines must be an array' USING ERRCODE='23514';
  END IF;
  SELECT count(*) INTO line_count FROM jsonb_to_recordset(p_lines) AS x(line_no integer,account_code text,amount numeric,member_ref text,description text,dimensions jsonb);
  IF line_count<>jsonb_array_length(p_lines) OR line_count<1 OR EXISTS (
      SELECT 1 FROM jsonb_to_recordset(p_lines) AS x(line_no integer,account_code text,amount numeric,dimensions jsonb)
      WHERE x.line_no IS NULL OR x.line_no<=0 OR COALESCE(length(btrim(x.account_code)),0)=0 OR COALESCE(x.amount,0)<=0
        OR (x.dimensions IS NOT NULL AND jsonb_typeof(x.dimensions)<>'object')
    ) OR EXISTS (SELECT 1 FROM jsonb_to_recordset(p_lines) AS x(line_no integer) GROUP BY x.line_no HAVING count(*)>1)
      OR (SELECT COALESCE(sum(x.amount),0)<>p_amount FROM jsonb_to_recordset(p_lines) AS x(amount numeric)) THEN
    RAISE EXCEPTION 'AP vendor credit lines must be unique, positive and equal header amount' USING ERRCODE='23514';
  END IF;

  INSERT INTO journal_entry(journal_entry_id,tenant_id,entity_id,period_id,journal_number,journal_type,status,journal_date,currency,description,created_by)
    VALUES(journal_id,p_tenant,p_entity,p_period,btrim(p_credit_number),'AUTO','DRAFT',p_credit_date,entity_row.base_currency,'Vendor credit '||btrim(p_credit_number),actor);
  INSERT INTO journal_line(tenant_id,entity_id,period_id,journal_entry_id,line_no,account_code,debit_amount,credit_amount,member_ref,description,dimensions)
    VALUES(p_tenant,p_entity,p_period,journal_id,1,'291001',p_amount,0,btrim(p_vendor_ref),'Vendor credit '||btrim(p_credit_number),'{}'::jsonb);
  INSERT INTO journal_line(tenant_id,entity_id,period_id,journal_entry_id,line_no,account_code,debit_amount,credit_amount,member_ref,description,dimensions)
    SELECT p_tenant,p_entity,p_period,journal_id,x.line_no+1,btrim(x.account_code),0,x.amount,x.member_ref,x.description,COALESCE(x.dimensions,'{}'::jsonb)
    FROM jsonb_to_recordset(p_lines) AS x(line_no integer,account_code text,amount numeric,member_ref text,description text,dimensions jsonb);
  IF (SELECT COALESCE(sum(debit_amount),0)<>COALESCE(sum(credit_amount),0) FROM journal_line WHERE tenant_id=p_tenant AND entity_id=p_entity AND journal_entry_id=journal_id) THEN
    RAISE EXCEPTION 'AP vendor credit Draft JE must be balanced' USING ERRCODE='23514';
  END IF;
  INSERT INTO business_adjustment(business_adjustment_id,tenant_id,entity_id,adjustment_kind,amount,currency,accounting_date,period_id,reason,status,draft_journal_entry_id,idempotency_key,request_hash,created_by)
    VALUES(adjustment_id,p_tenant,p_entity,'AP_VENDOR_CREDIT',p_amount,entity_row.base_currency,p_credit_date,p_period,p_reason,'DRAFT',journal_id,p_idempotency_key,p_request_hash,actor);
  response:=jsonb_build_object('business_adjustment_id',adjustment_id,'journal_entry_id',journal_id,'status','DRAFT','revision',0,'idempotent',false);
  INSERT INTO audit_event(tenant_id,entity_id,event_type,object_type,object_id,action,actor_id,actor_type,permission_used,request_id,correlation_id,idempotency_key,after_hash,reason)
    VALUES(p_tenant,p_entity,'AP_VENDOR_CREDIT_DRAFT_CREATED','BUSINESS_ADJUSTMENT',adjustment_id,'CREATE_AP_VENDOR_CREDIT',actor,'USER','AP.VENDOR_CREDIT.CREATE',p_idempotency_key,p_idempotency_key,p_idempotency_key,p_request_hash,p_reason);
  event_payload:=jsonb_build_object('business_adjustment_id',adjustment_id,'journal_entry_id',journal_id,'status','DRAFT');
  INSERT INTO outbox_event(tenant_id,entity_id,aggregate_type,aggregate_id,event_type,payload,payload_hash)
    VALUES(p_tenant,p_entity,'BUSINESS_ADJUSTMENT',adjustment_id,'AP_VENDOR_CREDIT_DRAFT_CREATED',event_payload,refs_jsonb_hash(event_payload));
  UPDATE idempotency_receipt SET status='SUCCEEDED',response_status=201,response_body=response,completed_at=clock_timestamp()
    WHERE tenant_id=p_tenant AND operation_scope='AP_VENDOR_CREDIT:'||p_entity AND idempotency_key=p_idempotency_key;
  RETURN response;
END;
$$;

REVOKE EXECUTE ON FUNCTION refs_ap_vendor_credit_hash(uuid,uuid,uuid,text,date,text,text,numeric,jsonb,text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION refs_create_ap_vendor_credit(uuid,uuid,uuid,text,date,text,text,numeric,jsonb,text,text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION refs_ap_vendor_credit_hash(uuid,uuid,uuid,text,date,text,text,numeric,jsonb,text) TO refs_app;
GRANT EXECUTE ON FUNCTION refs_create_ap_vendor_credit(uuid,uuid,uuid,text,date,text,text,numeric,jsonb,text,text,text) TO refs_app;

COMMIT;
