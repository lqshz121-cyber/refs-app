BEGIN;

INSERT INTO permission_catalog(permission_code,domain,risk_class,sod_class)
  VALUES('WBS.BANK.ADMIT','WBS','HIGH','WBS_INGEST_SERVICE')
  ON CONFLICT (permission_code) DO NOTHING;

CREATE UNIQUE INDEX wbs_snapshot_receipt_tenant_entity_id_uq
  ON wbs_snapshot_receipt(tenant_id,entity_id,wbs_snapshot_receipt_id);

CREATE TABLE wbs_bank_statement_receipt (
  wbs_bank_statement_receipt_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant(tenant_id),
  entity_id uuid NOT NULL,
  wbs_snapshot_import_id uuid NOT NULL,
  statement_id text NOT NULL CHECK (length(btrim(statement_id)) BETWEEN 1 AND 128),
  bank_account_ref text NOT NULL CHECK (length(btrim(bank_account_ref)) BETWEEN 1 AND 128),
  statement_start_date date NOT NULL,
  statement_end_date date NOT NULL,
  currency char(3) NOT NULL CHECK (currency ~ '^[A-Z]{3}$'),
  opening_balance numeric(20,4) NOT NULL,
  ending_balance numeric(20,4) NOT NULL,
  statement_payload_hash text NOT NULL CHECK (statement_payload_hash ~ '^sha256:[0-9a-f]{64}$'),
  statement_payload_ref text NOT NULL CHECK (statement_payload_ref ~ '^(object|s3)://'),
  admission_hash text NOT NULL CHECK (admission_hash ~ '^sha256:[0-9a-f]{64}$'),
  signature_key_id text NOT NULL CHECK (length(btrim(signature_key_id)) BETWEEN 1 AND 128),
  signature_algorithm text NOT NULL CHECK (signature_algorithm='Ed25519'),
  signature_verified boolean NOT NULL CHECK (signature_verified),
  admission_status text NOT NULL CHECK (admission_status='ADMITTED'),
  created_by text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CHECK (statement_start_date<=statement_end_date),
  UNIQUE(tenant_id,entity_id,statement_id),
  UNIQUE(tenant_id,entity_id,wbs_bank_statement_receipt_id),
  FOREIGN KEY(tenant_id,entity_id) REFERENCES entity(tenant_id,entity_id),
  FOREIGN KEY(tenant_id,entity_id,wbs_snapshot_import_id) REFERENCES wbs_snapshot_import(tenant_id,entity_id,wbs_snapshot_import_id)
);

CREATE TABLE wbs_bank_statement_transaction (
  tenant_id uuid NOT NULL REFERENCES tenant(tenant_id),
  entity_id uuid NOT NULL,
  wbs_bank_statement_receipt_id uuid NOT NULL,
  wbs_snapshot_receipt_id uuid NOT NULL,
  source_document_id uuid NOT NULL REFERENCES source_document(source_document_id),
  bank_source_id uuid NOT NULL REFERENCES bank_source(bank_source_id),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY(tenant_id,entity_id,wbs_bank_statement_receipt_id,wbs_snapshot_receipt_id),
  UNIQUE(tenant_id,entity_id,source_document_id),
  UNIQUE(tenant_id,entity_id,bank_source_id),
  FOREIGN KEY(tenant_id,entity_id,wbs_bank_statement_receipt_id) REFERENCES wbs_bank_statement_receipt(tenant_id,entity_id,wbs_bank_statement_receipt_id),
  FOREIGN KEY(tenant_id,entity_id,wbs_snapshot_receipt_id) REFERENCES wbs_snapshot_receipt(tenant_id,entity_id,wbs_snapshot_receipt_id),
  FOREIGN KEY(tenant_id,entity_id,source_document_id) REFERENCES source_document(tenant_id,entity_id,source_document_id),
  FOREIGN KEY(tenant_id,entity_id,bank_source_id) REFERENCES bank_source(tenant_id,entity_id,bank_source_id)
);

ALTER TABLE wbs_bank_statement_receipt ENABLE ROW LEVEL SECURITY;
ALTER TABLE wbs_bank_statement_transaction ENABLE ROW LEVEL SECURITY;
CREATE POLICY wbs_bank_statement_receipt_scope_policy ON wbs_bank_statement_receipt
  USING (tenant_id=refs_current_tenant() AND refs_entity_allowed(entity_id))
  WITH CHECK (tenant_id=refs_current_tenant() AND refs_entity_allowed(entity_id));
CREATE POLICY wbs_bank_statement_transaction_scope_policy ON wbs_bank_statement_transaction
  USING (tenant_id=refs_current_tenant() AND refs_entity_allowed(entity_id))
  WITH CHECK (tenant_id=refs_current_tenant() AND refs_entity_allowed(entity_id));
CREATE TRIGGER wbs_bank_statement_receipt_append_only BEFORE UPDATE OR DELETE ON wbs_bank_statement_receipt
  FOR EACH ROW EXECUTE FUNCTION reject_mutation();
CREATE TRIGGER wbs_bank_statement_transaction_append_only BEFORE UPDATE OR DELETE ON wbs_bank_statement_transaction
  FOR EACH ROW EXECUTE FUNCTION reject_mutation();

CREATE FUNCTION refs_wbs_signed_bank_admission_hash(
  p_tenant uuid,p_entity uuid,p_snapshot uuid,p_package_hash text,p_admission_hash text,
  p_signature_key_id text,p_signature_algorithm text,p_statement jsonb,p_transactions jsonb
) RETURNS text
LANGUAGE sql IMMUTABLE SET search_path=pg_catalog,public,pg_temp AS $$
  SELECT refs_jsonb_hash(jsonb_build_object(
    'tenant_id',p_tenant,'entity_id',p_entity,'snapshot_id',p_snapshot,'package_hash',p_package_hash,
    'admission_hash',p_admission_hash,'signature_key_id',p_signature_key_id,
    'signature_algorithm',p_signature_algorithm,'statement',p_statement,'transactions',p_transactions
  ))
$$;

CREATE FUNCTION refs_admit_wbs_signed_bank_statement(
  p_tenant uuid,p_entity uuid,p_snapshot uuid,p_package_hash text,p_admission_hash text,
  p_signature_key_id text,p_signature_algorithm text,p_statement jsonb,p_transactions jsonb,
  p_idempotency_key text,p_request_hash text
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE actor text:=refs_current_actor(); idem idempotency_receipt; computed_hash text; snapshot_row wbs_snapshot_import;
DECLARE statement_receipt_id uuid:=gen_random_uuid(); statement_id text; bank_ref text; statement_currency text;
DECLARE starts_on date; ends_on date; opening_amount numeric(20,4); ending_amount numeric(20,4); statement_hash text; statement_ref text;
DECLARE item jsonb; source_receipt wbs_snapshot_receipt; raw_id uuid; document_id uuid; bank_id uuid; item_date date; item_amount numeric(20,4);
DECLARE response jsonb; event_payload jsonb; admitted_count integer:=0;
BEGIN
  PERFORM refs_assert_scope(p_tenant,p_entity,'WBS.BANK.ADMIT');
  IF actor IS NULL THEN RAISE EXCEPTION 'Authenticated actor missing' USING ERRCODE='42501'; END IF;
  computed_hash:=refs_wbs_signed_bank_admission_hash(p_tenant,p_entity,p_snapshot,p_package_hash,p_admission_hash,p_signature_key_id,p_signature_algorithm,p_statement,p_transactions);
  IF p_request_hash<>computed_hash THEN RAISE EXCEPTION 'WBS bank admission request hash is not canonical' USING ERRCODE='22023'; END IF;
  IF p_admission_hash !~ '^sha256:[0-9a-f]{64}$' OR p_package_hash !~ '^sha256:[0-9a-f]{64}$'
     OR length(btrim(p_signature_key_id))=0 OR p_signature_algorithm<>'Ed25519' THEN
    RAISE EXCEPTION 'WBS bank admission signature evidence is invalid' USING ERRCODE='22023';
  END IF;

  INSERT INTO idempotency_receipt(tenant_id,operation_scope,idempotency_key,request_hash,status,actor_id)
    VALUES(p_tenant,'WBS_BANK_ADMISSION:'||p_entity,p_idempotency_key,p_request_hash,'IN_PROGRESS',actor)
    ON CONFLICT (tenant_id,operation_scope,idempotency_key) DO NOTHING;
  SELECT * INTO idem FROM idempotency_receipt
    WHERE tenant_id=p_tenant AND operation_scope='WBS_BANK_ADMISSION:'||p_entity AND idempotency_key=p_idempotency_key FOR UPDATE;
  IF idem.request_hash<>p_request_hash THEN RAISE EXCEPTION 'Idempotency key reused with different request hash' USING ERRCODE='23505'; END IF;
  IF idem.status='SUCCEEDED' THEN RETURN idem.response_body||jsonb_build_object('idempotent',true); END IF;

  SELECT * INTO snapshot_row FROM wbs_snapshot_import
    WHERE tenant_id=p_tenant AND entity_id=p_entity AND snapshot_id=p_snapshot AND package_hash=p_package_hash AND environment='PRODUCTION' FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'An exact admitted production WBS snapshot is required' USING ERRCODE='23514'; END IF;
  IF jsonb_typeof(p_statement)<>'object' OR jsonb_typeof(p_transactions)<>'array' OR jsonb_array_length(p_transactions)<1 OR jsonb_array_length(p_transactions)>1000 THEN
    RAISE EXCEPTION 'WBS bank statement admission payload is invalid' USING ERRCODE='22023';
  END IF;
  statement_id:=p_statement->>'statement_id'; bank_ref:=p_statement->>'bank_account_ref'; statement_currency:=p_statement->>'currency';
  starts_on:=(p_statement->>'statement_start_date')::date; ends_on:=(p_statement->>'statement_end_date')::date;
  opening_amount:=(p_statement->>'opening_balance')::numeric(20,4); ending_amount:=(p_statement->>'ending_balance')::numeric(20,4);
  statement_hash:=p_statement->>'payload_hash'; statement_ref:=p_statement->>'payload_ref';
  IF statement_id IS NULL OR length(btrim(statement_id))=0 OR bank_ref IS NULL OR length(btrim(bank_ref))=0 OR statement_currency !~ '^[A-Z]{3}$'
     OR starts_on>ends_on OR statement_hash !~ '^sha256:[0-9a-f]{64}$' OR statement_ref !~ '^(object|s3)://' THEN
    RAISE EXCEPTION 'WBS bank statement header is invalid' USING ERRCODE='22023';
  END IF;
  IF NOT EXISTS(SELECT 1 FROM member_master WHERE tenant_id=p_tenant AND entity_id=p_entity AND member_ref=bank_ref AND member_type='BANK' AND active) THEN
    RAISE EXCEPTION 'Bank statement account is not an active configured BANK member' USING ERRCODE='23503';
  END IF;

  INSERT INTO wbs_bank_statement_receipt(wbs_bank_statement_receipt_id,tenant_id,entity_id,wbs_snapshot_import_id,statement_id,bank_account_ref,statement_start_date,statement_end_date,currency,opening_balance,ending_balance,statement_payload_hash,statement_payload_ref,admission_hash,signature_key_id,signature_algorithm,signature_verified,admission_status,created_by)
    VALUES(statement_receipt_id,p_tenant,p_entity,snapshot_row.wbs_snapshot_import_id,statement_id,bank_ref,starts_on,ends_on,statement_currency,opening_amount,ending_amount,statement_hash,statement_ref,p_admission_hash,p_signature_key_id,p_signature_algorithm,true,'ADMITTED',actor);

  FOR item IN SELECT value FROM jsonb_array_elements(p_transactions) LOOP
    SELECT * INTO source_receipt FROM wbs_snapshot_receipt
      WHERE tenant_id=p_tenant AND entity_id=p_entity AND wbs_snapshot_import_id=snapshot_row.wbs_snapshot_import_id
        AND source_module='BGDATA.bank_transaction' AND ingestion_kind='TRANSACTION_CANDIDATE'
        AND source_entity_id=(SELECT source_entity_id FROM entity WHERE tenant_id=p_tenant AND entity_id=p_entity)
        AND source_record_id=item->>'source_record_id' AND source_version=item->>'source_version'
        AND payload_hash=item->>'payload_hash' AND payload_ref=item->>'payload_ref' FOR SHARE;
    IF NOT FOUND THEN RAISE EXCEPTION 'WBS bank transaction is not backed by the exact signed snapshot receipt' USING ERRCODE='23514'; END IF;
    item_date:=(item->>'transaction_date')::date; item_amount:=(item->>'amount')::numeric(20,4);
    IF item->>'bank_account_ref'<>bank_ref OR item->>'currency'<>statement_currency OR item_date<starts_on OR item_date>ends_on OR item_amount=0
       OR length(btrim(COALESCE(item->>'external_bank_line_id','')))=0 THEN
      RAISE EXCEPTION 'WBS bank transaction is outside signed statement scope' USING ERRCODE='23514';
    END IF;
    raw_id:=gen_random_uuid();document_id:=gen_random_uuid();bank_id:=gen_random_uuid();
    INSERT INTO raw_event(raw_event_id,tenant_id,entity_id,import_batch_id,source_system,source_module,source_entity_id,source_record_id,source_version,event_type,occurred_at,payload_hash,payload_ref,correlation_id)
      VALUES(raw_id,p_tenant,p_entity,snapshot_row.import_batch_id,'WBS','bankFeed',source_receipt.source_entity_id,source_receipt.source_record_id,source_receipt.source_version,'UPSERT',item_date::timestamptz,source_receipt.payload_hash,source_receipt.payload_ref,p_idempotency_key);
    INSERT INTO source_document(source_document_id,tenant_id,entity_id,raw_event_id,source_system,source_module,source_entity_id,source_record_id,source_version,document_type,document_no,business_date,accounting_date,currency,gross_amount,status,source_ref,payload_hash)
      VALUES(document_id,p_tenant,p_entity,raw_id,'WBS','bankFeed',source_receipt.source_entity_id,source_receipt.source_record_id,source_receipt.source_version,'BANK_TRANSACTION',item->>'external_bank_line_id',item_date,item_date,statement_currency,item_amount,'RECEIVED','WBS:'||source_receipt.source_record_id,source_receipt.payload_hash);
    INSERT INTO bank_source(bank_source_id,tenant_id,entity_id,source_document_id,bank_account_ref,external_bank_line_id,transaction_date,currency,amount)
      VALUES(bank_id,p_tenant,p_entity,document_id,bank_ref,item->>'external_bank_line_id',item_date,statement_currency,item_amount);
    INSERT INTO wbs_bank_statement_transaction(tenant_id,entity_id,wbs_bank_statement_receipt_id,wbs_snapshot_receipt_id,source_document_id,bank_source_id)
      VALUES(p_tenant,p_entity,statement_receipt_id,source_receipt.wbs_snapshot_receipt_id,document_id,bank_id);
    admitted_count:=admitted_count+1;
  END LOOP;

  event_payload:=jsonb_build_object('statement_receipt_id',statement_receipt_id,'statement_id',statement_id,'snapshot_id',p_snapshot,'bank_account_ref',bank_ref,'transaction_count',admitted_count,'admission_hash',p_admission_hash);
  INSERT INTO audit_event(tenant_id,entity_id,event_type,object_type,object_id,action,actor_id,actor_type,permission_used,request_id,correlation_id,idempotency_key,after_hash,metadata)
    VALUES(p_tenant,p_entity,'WBS_BANK_STATEMENT_ADMITTED','WBS_BANK_STATEMENT',statement_receipt_id,'ADMIT',actor,'SERVICE_ACCOUNT','WBS.BANK.ADMIT',p_idempotency_key,p_idempotency_key,p_idempotency_key,p_admission_hash,event_payload);
  INSERT INTO outbox_event(tenant_id,entity_id,aggregate_type,aggregate_id,event_type,payload,payload_hash)
    VALUES(p_tenant,p_entity,'WBS_BANK_STATEMENT',statement_receipt_id,'WBS_BANK_STATEMENT_ADMITTED',event_payload,refs_jsonb_hash(event_payload));
  response:=jsonb_build_object('statement_receipt_id',statement_receipt_id,'snapshot_id',p_snapshot,'transaction_count',admitted_count,'idempotent',false);
  UPDATE idempotency_receipt SET status='SUCCEEDED',response_status=201,response_body=response,completed_at=clock_timestamp()
    WHERE idempotency_receipt_id=idem.idempotency_receipt_id;
  RETURN response;
END;
$$;

REVOKE ALL ON wbs_bank_statement_receipt,wbs_bank_statement_transaction FROM PUBLIC,refs_app;
GRANT SELECT ON wbs_bank_statement_receipt,wbs_bank_statement_transaction TO refs_app;
REVOKE EXECUTE ON FUNCTION refs_wbs_signed_bank_admission_hash(uuid,uuid,uuid,text,text,text,text,jsonb,jsonb) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION refs_admit_wbs_signed_bank_statement(uuid,uuid,uuid,text,text,text,text,jsonb,jsonb,text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION refs_wbs_signed_bank_admission_hash(uuid,uuid,uuid,text,text,text,text,jsonb,jsonb) TO refs_app;
GRANT EXECUTE ON FUNCTION refs_admit_wbs_signed_bank_statement(uuid,uuid,uuid,text,text,text,text,jsonb,jsonb,text,text) TO refs_app;

COMMIT;
