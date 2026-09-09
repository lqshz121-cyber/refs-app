BEGIN;

-- Vendor credits and credit memos originate with a human-provided business
-- document.  Their Draft JE must therefore carry verified attachment evidence
-- in the same transaction that creates the adjustment, rather than depending
-- on a test-only source fixture after creation.
CREATE FUNCTION refs_credit_adjustment_hash_v2(
  p_tenant uuid,p_entity uuid,p_kind text,p_period uuid,p_number text,p_date date,
  p_counterparty_ref text,p_counterparty_name text,p_amount numeric,p_lines jsonb,
  p_reason text,p_attachment_ids uuid[]
) RETURNS text
LANGUAGE sql IMMUTABLE SET search_path=pg_catalog,public,pg_temp AS $$
  SELECT refs_jsonb_hash(jsonb_build_object(
    'tenant_id',p_tenant,'entity_id',p_entity,'adjustment_kind',p_kind,'period_id',p_period,
    'number',btrim(p_number),'date',p_date,'counterparty_ref',btrim(p_counterparty_ref),
    'counterparty_name',btrim(p_counterparty_name),'amount',p_amount,'lines',p_lines,
    'reason',btrim(p_reason),'attachment_ids',to_jsonb(ARRAY(
      SELECT id FROM unnest(COALESCE(p_attachment_ids,'{}'::uuid[])) id ORDER BY id
    ))
  ))
$$;

CREATE FUNCTION refs_create_credit_adjustment_v2(
  p_tenant uuid,p_entity uuid,p_kind text,p_period uuid,p_number text,p_date date,
  p_counterparty_ref text,p_counterparty_name text,p_amount numeric,p_lines jsonb,
  p_reason text,p_attachment_ids uuid[],p_idempotency_key text,p_request_hash text
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE actor text:=refs_current_actor();permission text;counterparty_type text;control_account text;
DECLARE receipt idempotency_receipt;entity_row entity;journal_id uuid:=gen_random_uuid();adjustment_id uuid:=gen_random_uuid();
DECLARE computed_hash text;line_count integer;response jsonb;event_payload jsonb;
BEGIN
  permission:=CASE p_kind WHEN 'AP_VENDOR_CREDIT' THEN 'AP.VENDOR_CREDIT.CREATE' WHEN 'AR_CREDIT_MEMO' THEN 'AR.CREDIT_MEMO.CREATE' END;
  control_account:=CASE p_kind WHEN 'AP_VENDOR_CREDIT' THEN '291001' WHEN 'AR_CREDIT_MEMO' THEN '120200' END;
  IF permission IS NULL THEN RAISE EXCEPTION 'Unsupported credit adjustment kind' USING ERRCODE='22023'; END IF;
  PERFORM refs_assert_scope(p_tenant,p_entity,permission);
  IF actor IS NULL THEN RAISE EXCEPTION 'Authenticated actor missing' USING ERRCODE='42501'; END IF;
  computed_hash:=refs_credit_adjustment_hash_v2(p_tenant,p_entity,p_kind,p_period,p_number,p_date,p_counterparty_ref,p_counterparty_name,p_amount,p_lines,p_reason,p_attachment_ids);
  IF p_request_hash<>computed_hash THEN RAISE EXCEPTION 'Credit adjustment request hash is not canonical' USING ERRCODE='22023'; END IF;
  IF p_number IS NULL OR length(p_number) NOT BETWEEN 1 AND 128 OR p_number<>btrim(p_number) OR p_number~'[[:cntrl:]]'
     OR p_date IS NULL OR p_counterparty_ref IS NULL OR length(p_counterparty_ref) NOT BETWEEN 1 AND 128
     OR p_counterparty_ref<>btrim(p_counterparty_ref) OR p_counterparty_ref~'[[:cntrl:]]'
     OR p_counterparty_name IS NULL OR length(p_counterparty_name) NOT BETWEEN 1 AND 255
     OR p_counterparty_name<>btrim(p_counterparty_name) OR p_counterparty_name~'[[:cntrl:]]'
     OR p_amount IS NULL OR p_amount<=0 OR p_amount>=10000000000000000 OR p_amount<>round(p_amount,4)
     OR p_reason IS NULL OR length(p_reason) NOT BETWEEN 8 AND 2000 OR p_reason<>btrim(p_reason) OR p_reason~'[[:cntrl:]]'
     OR p_idempotency_key IS NULL OR p_idempotency_key!~'^[A-Za-z0-9._:-]{8,128}$'
     OR COALESCE(cardinality(p_attachment_ids),0) NOT BETWEEN 1 AND 25
     OR cardinality(p_attachment_ids)<>(SELECT count(DISTINCT id) FROM unnest(p_attachment_ids) id) THEN
    RAISE EXCEPTION 'Credit adjustment requires valid header, exact amount, reason and unique attachment evidence' USING ERRCODE='22023';
  END IF;
  IF p_lines IS NULL OR jsonb_typeof(p_lines)<>'array' OR jsonb_array_length(p_lines) NOT BETWEEN 1 AND 499 THEN
    RAISE EXCEPTION 'Credit adjustment lines must be a bounded array' USING ERRCODE='23514';
  END IF;
  SELECT count(*) INTO line_count FROM jsonb_to_recordset(p_lines)
    AS x(line_no integer,account_code text,amount numeric,member_ref text,description text,dimensions jsonb);
  IF line_count<>jsonb_array_length(p_lines) OR EXISTS(
    SELECT 1 FROM jsonb_to_recordset(p_lines)
      AS x(line_no integer,account_code text,amount numeric,dimensions jsonb)
    WHERE x.line_no IS NULL OR x.line_no<=0 OR COALESCE(length(btrim(x.account_code)),0)=0
      OR btrim(x.account_code)=control_account OR COALESCE(x.amount,0)<=0
      OR x.amount>=10000000000000000 OR x.amount<>round(x.amount,4)
      OR (x.dimensions IS NOT NULL AND jsonb_typeof(x.dimensions)<>'object')
  ) OR EXISTS(
    SELECT 1 FROM jsonb_to_recordset(p_lines) AS x(line_no integer) GROUP BY x.line_no HAVING count(*)>1
  ) OR (SELECT COALESCE(sum(x.amount),0)<>p_amount FROM jsonb_to_recordset(p_lines) AS x(amount numeric)) THEN
    RAISE EXCEPTION 'Credit adjustment lines must be unique, non-control, exact, positive and equal header amount' USING ERRCODE='23514';
  END IF;

  INSERT INTO idempotency_receipt(tenant_id,operation_scope,idempotency_key,request_hash,status,actor_id)
    VALUES(p_tenant,p_kind||':'||p_entity,p_idempotency_key,p_request_hash,'IN_PROGRESS',actor)
    ON CONFLICT (tenant_id,operation_scope,idempotency_key) DO NOTHING;
  SELECT * INTO receipt FROM idempotency_receipt
    WHERE tenant_id=p_tenant AND operation_scope=p_kind||':'||p_entity AND idempotency_key=p_idempotency_key FOR UPDATE;
  IF receipt.actor_id IS DISTINCT FROM actor THEN RAISE EXCEPTION 'Credit adjustment receipt belongs to another actor' USING ERRCODE='42501'; END IF;
  IF receipt.request_hash<>p_request_hash THEN RAISE EXCEPTION 'Idempotency key reused with a different request' USING ERRCODE='23505'; END IF;
  IF receipt.status='SUCCEEDED' THEN RETURN receipt.response_body||jsonb_build_object('idempotent',true); END IF;

  PERFORM 1 FROM accounting_period WHERE tenant_id=p_tenant AND entity_id=p_entity AND period_id=p_period
    AND status='OPEN' AND p_date BETWEEN starts_on AND ends_on FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Credit adjustment date must belong to the selected OPEN period' USING ERRCODE='55000'; END IF;
  SELECT * INTO entity_row FROM entity WHERE tenant_id=p_tenant AND entity_id=p_entity FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Entity not found' USING ERRCODE='23503'; END IF;
  SELECT member_type INTO counterparty_type FROM member_master
    WHERE tenant_id=p_tenant AND entity_id=p_entity AND member_ref=p_counterparty_ref AND active FOR SHARE;
  IF (p_kind='AP_VENDOR_CREDIT' AND counterparty_type IS DISTINCT FROM 'VENDOR')
     OR (p_kind='AR_CREDIT_MEMO' AND (counterparty_type IS NULL OR counterparty_type NOT IN ('CUSTOMER','AFFILIATE'))) THEN
    RAISE EXCEPTION 'Credit adjustment counterparty is missing or has an incompatible type' USING ERRCODE='23514';
  END IF;
  PERFORM 1 FROM account_master WHERE tenant_id=p_tenant AND entity_id=p_entity AND account_code=control_account AND active FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Required AP/AR control account is inactive or missing' USING ERRCODE='23514'; END IF;
  IF EXISTS(
    SELECT 1 FROM jsonb_to_recordset(p_lines) AS x(account_code text,member_ref text)
    LEFT JOIN account_master a ON a.tenant_id=p_tenant AND a.entity_id=p_entity AND a.account_code=btrim(x.account_code) AND a.active
    LEFT JOIN member_master m ON m.tenant_id=p_tenant AND m.entity_id=p_entity AND m.member_ref=x.member_ref AND m.active
    WHERE a.account_code IS NULL OR (a.requires_member AND x.member_ref IS NULL)
      OR (x.member_ref IS NOT NULL AND m.member_ref IS NULL)
      OR (a.requires_member AND NOT (m.member_type=a.required_member_type
        OR (a.required_member_type='CUSTOMER_OR_AFFILIATE' AND m.member_type IN ('CUSTOMER','AFFILIATE'))))
  ) THEN RAISE EXCEPTION 'Credit adjustment line account/member validation failed' USING ERRCODE='23514'; END IF;
  PERFORM 1 FROM attachment WHERE tenant_id=p_tenant AND entity_id=p_entity AND attachment_id=ANY(p_attachment_ids)
    ORDER BY attachment_id FOR SHARE;
  IF cardinality(p_attachment_ids)<>(SELECT count(*) FROM attachment WHERE tenant_id=p_tenant AND entity_id=p_entity
      AND attachment_id=ANY(p_attachment_ids) AND finalization_status='VERIFIED_CLEAN' AND scan_status='CLEAN'
      AND verified_at IS NOT NULL AND finalized_at IS NOT NULL) THEN
    RAISE EXCEPTION 'Credit adjustment requires verified clean company-scoped attachment evidence' USING ERRCODE='23503';
  END IF;

  INSERT INTO journal_entry(journal_entry_id,tenant_id,entity_id,period_id,journal_number,journal_type,status,journal_date,currency,description,created_by)
    VALUES(journal_id,p_tenant,p_entity,p_period,p_number,'MANUAL','DRAFT',p_date,entity_row.base_currency,
      CASE p_kind WHEN 'AP_VENDOR_CREDIT' THEN 'Vendor credit ' ELSE 'Credit memo ' END||p_number,actor);
  IF p_kind='AP_VENDOR_CREDIT' THEN
    INSERT INTO journal_line(tenant_id,entity_id,period_id,journal_entry_id,line_no,account_code,debit_amount,credit_amount,member_ref,description,dimensions)
      VALUES(p_tenant,p_entity,p_period,journal_id,1,control_account,p_amount,0,p_counterparty_ref,'Vendor credit '||p_number,'{}'::jsonb);
    INSERT INTO journal_line(tenant_id,entity_id,period_id,journal_entry_id,line_no,account_code,debit_amount,credit_amount,member_ref,description,dimensions)
      SELECT p_tenant,p_entity,p_period,journal_id,x.line_no+1,btrim(x.account_code),0,x.amount,x.member_ref,x.description,COALESCE(x.dimensions,'{}'::jsonb)
      FROM jsonb_to_recordset(p_lines) AS x(line_no integer,account_code text,amount numeric,member_ref text,description text,dimensions jsonb);
  ELSE
    INSERT INTO journal_line(tenant_id,entity_id,period_id,journal_entry_id,line_no,account_code,debit_amount,credit_amount,member_ref,description,dimensions)
      VALUES(p_tenant,p_entity,p_period,journal_id,1,control_account,0,p_amount,p_counterparty_ref,'Credit memo '||p_number,'{}'::jsonb);
    INSERT INTO journal_line(tenant_id,entity_id,period_id,journal_entry_id,line_no,account_code,debit_amount,credit_amount,member_ref,description,dimensions)
      SELECT p_tenant,p_entity,p_period,journal_id,x.line_no+1,btrim(x.account_code),x.amount,0,x.member_ref,x.description,COALESCE(x.dimensions,'{}'::jsonb)
      FROM jsonb_to_recordset(p_lines) AS x(line_no integer,account_code text,amount numeric,member_ref text,description text,dimensions jsonb);
  END IF;
  INSERT INTO source_link(tenant_id,entity_id,link_type,journal_entry_id,attachment_id,created_by)
    SELECT p_tenant,p_entity,'JE_ATTACHMENT',journal_id,id,actor FROM unnest(p_attachment_ids) id;
  INSERT INTO business_adjustment(business_adjustment_id,tenant_id,entity_id,adjustment_kind,amount,currency,accounting_date,period_id,reason,status,draft_journal_entry_id,idempotency_key,request_hash,created_by)
    VALUES(adjustment_id,p_tenant,p_entity,p_kind,p_amount,entity_row.base_currency,p_date,p_period,p_reason,'DRAFT',journal_id,p_idempotency_key,p_request_hash,actor);
  response:=jsonb_build_object('business_adjustment_id',adjustment_id,'journal_entry_id',journal_id,'status','DRAFT','revision',0,'idempotent',false);
  INSERT INTO audit_event(tenant_id,entity_id,event_type,object_type,object_id,action,actor_id,actor_type,permission_used,request_id,correlation_id,idempotency_key,after_hash,reason)
    VALUES(p_tenant,p_entity,p_kind||'_DRAFT_CREATED','BUSINESS_ADJUSTMENT',adjustment_id,'CREATE_'||p_kind,actor,'USER',permission,
      p_idempotency_key,p_idempotency_key,p_idempotency_key,p_request_hash,p_reason);
  event_payload:=jsonb_build_object('business_adjustment_id',adjustment_id,'journal_entry_id',journal_id,'status','DRAFT',
    'attachment_ids',to_jsonb(ARRAY(SELECT id FROM unnest(p_attachment_ids) id ORDER BY id)));
  INSERT INTO outbox_event(tenant_id,entity_id,aggregate_type,aggregate_id,event_type,payload,payload_hash)
    VALUES(p_tenant,p_entity,'BUSINESS_ADJUSTMENT',adjustment_id,p_kind||'_DRAFT_CREATED',event_payload,refs_jsonb_hash(event_payload));
  UPDATE idempotency_receipt SET status='SUCCEEDED',response_status=201,response_body=response,completed_at=clock_timestamp()
    WHERE tenant_id=p_tenant AND operation_scope=p_kind||':'||p_entity AND idempotency_key=p_idempotency_key;
  RETURN response;
END;
$$;

CREATE FUNCTION refs_ap_vendor_credit_hash(
  p_tenant uuid,p_entity uuid,p_period uuid,p_credit_number text,p_credit_date date,p_vendor_ref text,p_vendor_name text,
  p_amount numeric,p_lines jsonb,p_reason text,p_attachment_ids uuid[]
) RETURNS text LANGUAGE sql IMMUTABLE SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
  SELECT refs_credit_adjustment_hash_v2(p_tenant,p_entity,'AP_VENDOR_CREDIT',p_period,p_credit_number,p_credit_date,p_vendor_ref,p_vendor_name,p_amount,p_lines,p_reason,p_attachment_ids)
$$;
CREATE FUNCTION refs_create_ap_vendor_credit(
  p_tenant uuid,p_entity uuid,p_period uuid,p_credit_number text,p_credit_date date,p_vendor_ref text,p_vendor_name text,
  p_amount numeric,p_lines jsonb,p_reason text,p_attachment_ids uuid[],p_idempotency_key text,p_request_hash text
) RETURNS jsonb LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
  SELECT refs_create_credit_adjustment_v2(p_tenant,p_entity,'AP_VENDOR_CREDIT',p_period,p_credit_number,p_credit_date,p_vendor_ref,p_vendor_name,p_amount,p_lines,p_reason,p_attachment_ids,p_idempotency_key,p_request_hash)
$$;
CREATE FUNCTION refs_ar_credit_memo_hash(
  p_tenant uuid,p_entity uuid,p_period uuid,p_memo_number text,p_memo_date date,p_customer_ref text,p_customer_name text,
  p_amount numeric,p_lines jsonb,p_reason text,p_attachment_ids uuid[]
) RETURNS text LANGUAGE sql IMMUTABLE SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
  SELECT refs_credit_adjustment_hash_v2(p_tenant,p_entity,'AR_CREDIT_MEMO',p_period,p_memo_number,p_memo_date,p_customer_ref,p_customer_name,p_amount,p_lines,p_reason,p_attachment_ids)
$$;
CREATE FUNCTION refs_create_ar_credit_memo(
  p_tenant uuid,p_entity uuid,p_period uuid,p_memo_number text,p_memo_date date,p_customer_ref text,p_customer_name text,
  p_amount numeric,p_lines jsonb,p_reason text,p_attachment_ids uuid[],p_idempotency_key text,p_request_hash text
) RETURNS jsonb LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
  SELECT refs_create_credit_adjustment_v2(p_tenant,p_entity,'AR_CREDIT_MEMO',p_period,p_memo_number,p_memo_date,p_customer_ref,p_customer_name,p_amount,p_lines,p_reason,p_attachment_ids,p_idempotency_key,p_request_hash)
$$;

REVOKE EXECUTE ON FUNCTION refs_ap_vendor_credit_hash(uuid,uuid,uuid,text,date,text,text,numeric,jsonb,text) FROM refs_app;
REVOKE EXECUTE ON FUNCTION refs_create_ap_vendor_credit(uuid,uuid,uuid,text,date,text,text,numeric,jsonb,text,text,text) FROM refs_app;
REVOKE EXECUTE ON FUNCTION refs_ar_credit_memo_hash(uuid,uuid,uuid,text,date,text,text,numeric,jsonb,text) FROM refs_app;
REVOKE EXECUTE ON FUNCTION refs_create_ar_credit_memo(uuid,uuid,uuid,text,date,text,text,numeric,jsonb,text,text,text) FROM refs_app;
REVOKE ALL ON FUNCTION refs_credit_adjustment_hash_v2(uuid,uuid,text,uuid,text,date,text,text,numeric,jsonb,text,uuid[]) FROM PUBLIC;
REVOKE ALL ON FUNCTION refs_create_credit_adjustment_v2(uuid,uuid,text,uuid,text,date,text,text,numeric,jsonb,text,uuid[],text,text) FROM PUBLIC;
REVOKE ALL ON FUNCTION refs_ap_vendor_credit_hash(uuid,uuid,uuid,text,date,text,text,numeric,jsonb,text,uuid[]) FROM PUBLIC;
REVOKE ALL ON FUNCTION refs_create_ap_vendor_credit(uuid,uuid,uuid,text,date,text,text,numeric,jsonb,text,uuid[],text,text) FROM PUBLIC;
REVOKE ALL ON FUNCTION refs_ar_credit_memo_hash(uuid,uuid,uuid,text,date,text,text,numeric,jsonb,text,uuid[]) FROM PUBLIC;
REVOKE ALL ON FUNCTION refs_create_ar_credit_memo(uuid,uuid,uuid,text,date,text,text,numeric,jsonb,text,uuid[],text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION refs_ap_vendor_credit_hash(uuid,uuid,uuid,text,date,text,text,numeric,jsonb,text,uuid[]) TO refs_app;
GRANT EXECUTE ON FUNCTION refs_create_ap_vendor_credit(uuid,uuid,uuid,text,date,text,text,numeric,jsonb,text,uuid[],text,text) TO refs_app;
GRANT EXECUTE ON FUNCTION refs_ar_credit_memo_hash(uuid,uuid,uuid,text,date,text,text,numeric,jsonb,text,uuid[]) TO refs_app;
GRANT EXECUTE ON FUNCTION refs_create_ar_credit_memo(uuid,uuid,uuid,text,date,text,text,numeric,jsonb,text,uuid[],text,text) TO refs_app;

COMMIT;
