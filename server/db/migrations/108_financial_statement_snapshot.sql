BEGIN;

-- A financial statement snapshot is a retained rendering of only the existing
-- POSTED-ledger report.  It is not an adjustment, a close, or a replacement
-- for the live report.  A second capture is a new immutable version.
INSERT INTO permission_catalog(permission_code,domain,risk_class,sod_class)
VALUES ('GL.REPORT.SNAPSHOT.CREATE','GL','HIGH','GL_REPORT_SNAPSHOT_MAKER')
ON CONFLICT (permission_code) DO UPDATE
  SET active=true,domain=EXCLUDED.domain,risk_class=EXCLUDED.risk_class,sod_class=EXCLUDED.sod_class,
      version=permission_catalog.version+1,effective_to=NULL;

CREATE TABLE financial_statement_snapshot (
  financial_statement_snapshot_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant(tenant_id),
  entity_id uuid NOT NULL,
  period_id uuid NOT NULL,
  version bigint NOT NULL CHECK(version>0),
  statement_hash text NOT NULL CHECK(statement_hash~'^sha256:[0-9a-f]{64}$'),
  statement_rows jsonb NOT NULL CHECK(jsonb_typeof(statement_rows)='array'),
  row_count integer NOT NULL CHECK(row_count>=0),
  captured_by text NOT NULL CHECK(length(btrim(captured_by))>0),
  captured_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  capture_reason text NOT NULL CHECK(length(btrim(capture_reason)) BETWEEN 8 AND 2000),
  FOREIGN KEY(tenant_id,entity_id) REFERENCES entity(tenant_id,entity_id),
  FOREIGN KEY(tenant_id,entity_id,period_id) REFERENCES accounting_period(tenant_id,entity_id,period_id),
  UNIQUE(tenant_id,entity_id,period_id,version),
  UNIQUE(financial_statement_snapshot_id,tenant_id,entity_id,period_id)
);
CREATE INDEX financial_statement_snapshot_read_idx ON financial_statement_snapshot(tenant_id,entity_id,period_id,version DESC);
ALTER TABLE financial_statement_snapshot ENABLE ROW LEVEL SECURITY;
CREATE POLICY financial_statement_snapshot_scope_policy ON financial_statement_snapshot
  USING(tenant_id=refs_current_tenant() AND refs_entity_allowed(entity_id))
  WITH CHECK(tenant_id=refs_current_tenant() AND refs_entity_allowed(entity_id));
CREATE TRIGGER financial_statement_snapshot_append_only BEFORE UPDATE OR DELETE ON financial_statement_snapshot
  FOR EACH ROW EXECUTE FUNCTION reject_mutation();

CREATE FUNCTION refs_financial_statement_snapshot_hash(p_period uuid,p_rows jsonb)
RETURNS text LANGUAGE sql IMMUTABLE SET search_path=pg_catalog,public,pg_temp AS $$
  SELECT refs_jsonb_hash(jsonb_build_object('period_id',p_period,'statement_rows',p_rows))
$$;

CREATE FUNCTION refs_financial_statement_snapshot_request_hash(p_tenant uuid,p_entity uuid,p_period uuid,p_reason text)
RETURNS text LANGUAGE sql IMMUTABLE SET search_path=pg_catalog,public,pg_temp AS $$
  SELECT refs_jsonb_hash(jsonb_build_object('tenant_id',p_tenant,'entity_id',p_entity,'period_id',p_period,'reason',btrim(p_reason)))
$$;

CREATE FUNCTION refs_create_financial_statement_snapshot(
  p_tenant uuid,p_entity uuid,p_period uuid,p_reason text,p_idempotency_key text,p_request_hash text
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE actor text:=refs_current_actor(); receipt idempotency_receipt; rows jsonb; snapshot_id uuid:=gen_random_uuid();
  snapshot_hash text; next_version bigint; response jsonb; event_payload jsonb;
BEGIN
  PERFORM refs_assert_scope(p_tenant,p_entity,'GL.REPORT.SNAPSHOT.CREATE');
  -- This explicitly requires a report reader too; snapshot makers cannot use
  -- this command to bypass the normal POSTED-evidence report read permission.
  PERFORM refs_assert_scope(p_tenant,p_entity,'GL.REPORT.VIEW');
  IF actor IS NULL THEN RAISE EXCEPTION 'Authenticated actor missing' USING ERRCODE='42501'; END IF;
  IF COALESCE(length(btrim(p_reason)),0)<8 OR COALESCE(length(p_reason),0)>2000 THEN
    RAISE EXCEPTION 'Financial statement snapshot requires an 8-2000 character reason' USING ERRCODE='22023';
  END IF;
  IF p_request_hash<>refs_financial_statement_snapshot_request_hash(p_tenant,p_entity,p_period,p_reason) THEN
    RAISE EXCEPTION 'Financial statement snapshot request hash is not canonical' USING ERRCODE='22023';
  END IF;
  INSERT INTO idempotency_receipt(tenant_id,operation_scope,idempotency_key,request_hash,status,actor_id)
    VALUES(p_tenant,'GL_REPORT_SNAPSHOT:'||p_entity,p_idempotency_key,p_request_hash,'IN_PROGRESS',actor) ON CONFLICT DO NOTHING;
  SELECT * INTO receipt FROM idempotency_receipt WHERE tenant_id=p_tenant AND operation_scope='GL_REPORT_SNAPSHOT:'||p_entity AND idempotency_key=p_idempotency_key FOR UPDATE;
  IF receipt.request_hash<>p_request_hash THEN RAISE EXCEPTION 'Idempotency key reused with a different request' USING ERRCODE='23505'; END IF;
  IF receipt.status='SUCCEEDED' THEN RETURN receipt.response_body||jsonb_build_object('idempotent',true); END IF;
  PERFORM 1 FROM accounting_period WHERE tenant_id=p_tenant AND entity_id=p_entity AND period_id=p_period FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'A valid entity-scoped accounting period is required' USING ERRCODE='22023'; END IF;
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'period_id',period_id,'period_code',period_code,'period_start',period_start,'period_end',period_end,
    'statement_type',statement_type,'statement_section',statement_section,'classification_basis',classification_basis,
    'account_code',account_code,'account_name',account_name,'opening_debit',opening_debit,'opening_credit',opening_credit,
    'period_debit',period_debit,'period_credit',period_credit,'ending_debit',ending_debit,'ending_credit',ending_credit,
    'display_balance',display_balance,'journal_entry_ids',journal_entry_ids,'journal_line_ids',journal_line_ids,
    'ledger_line_ids',ledger_line_ids,'source_document_ids',source_document_ids
  ) ORDER BY statement_type,statement_section,account_code),'[]'::jsonb) INTO rows
  FROM refs_get_financial_statements(p_tenant,p_entity,p_period);
  snapshot_hash:=refs_financial_statement_snapshot_hash(p_period,rows);
  SELECT COALESCE(max(version),0)+1 INTO next_version FROM financial_statement_snapshot
    WHERE tenant_id=p_tenant AND entity_id=p_entity AND period_id=p_period;
  INSERT INTO financial_statement_snapshot(financial_statement_snapshot_id,tenant_id,entity_id,period_id,version,statement_hash,statement_rows,row_count,captured_by,capture_reason)
    VALUES(snapshot_id,p_tenant,p_entity,p_period,next_version,snapshot_hash,rows,jsonb_array_length(rows),actor,btrim(p_reason));
  response:=jsonb_build_object('financial_statement_snapshot_id',snapshot_id,'period_id',p_period,'version',next_version,'statement_hash',snapshot_hash,'row_count',jsonb_array_length(rows),'status','CAPTURED','idempotent',false);
  INSERT INTO audit_event(tenant_id,entity_id,event_type,object_type,object_id,action,actor_id,actor_type,permission_used,request_id,correlation_id,idempotency_key,after_hash,reason,metadata)
    VALUES(p_tenant,p_entity,'FINANCIAL_STATEMENT_SNAPSHOT_CAPTURED','FINANCIAL_STATEMENT_SNAPSHOT',snapshot_id,'CAPTURE',actor,'USER','GL.REPORT.SNAPSHOT.CREATE',p_idempotency_key,p_idempotency_key,p_idempotency_key,snapshot_hash,btrim(p_reason),jsonb_build_object('period_id',p_period,'version',next_version,'row_count',jsonb_array_length(rows),'evidence_basis','POSTED_LEDGER'));
  event_payload:=response-'idempotent';
  INSERT INTO outbox_event(tenant_id,entity_id,aggregate_type,aggregate_id,event_type,payload,payload_hash)
    VALUES(p_tenant,p_entity,'FINANCIAL_STATEMENT_SNAPSHOT',snapshot_id,'FINANCIAL_STATEMENT_SNAPSHOT_CAPTURED',event_payload,refs_jsonb_hash(event_payload));
  UPDATE idempotency_receipt SET status='SUCCEEDED',response_status=201,response_body=response,completed_at=clock_timestamp()
    WHERE tenant_id=p_tenant AND operation_scope='GL_REPORT_SNAPSHOT:'||p_entity AND idempotency_key=p_idempotency_key;
  RETURN response;
END;$$;

CREATE FUNCTION refs_list_financial_statement_snapshots(p_tenant uuid,p_entity uuid,p_period uuid)
RETURNS TABLE(financial_statement_snapshot_id uuid,period_id uuid,version bigint,statement_hash text,row_count integer,captured_by text,captured_at timestamptz,capture_reason text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
BEGIN
  PERFORM refs_assert_scope(p_tenant,p_entity,'GL.REPORT.VIEW');
  RETURN QUERY SELECT s.financial_statement_snapshot_id,s.period_id,s.version,s.statement_hash,s.row_count,s.captured_by,s.captured_at,s.capture_reason
    FROM financial_statement_snapshot s WHERE s.tenant_id=p_tenant AND s.entity_id=p_entity AND s.period_id=p_period ORDER BY s.version DESC;
END;$$;

CREATE FUNCTION refs_get_financial_statement_snapshot(p_tenant uuid,p_entity uuid,p_snapshot uuid)
RETURNS TABLE(financial_statement_snapshot_id uuid,period_id uuid,version bigint,statement_hash text,row_count integer,captured_by text,captured_at timestamptz,capture_reason text,statement_rows jsonb)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
BEGIN
  PERFORM refs_assert_scope(p_tenant,p_entity,'GL.REPORT.VIEW');
  RETURN QUERY SELECT s.financial_statement_snapshot_id,s.period_id,s.version,s.statement_hash,s.row_count,s.captured_by,s.captured_at,s.capture_reason,s.statement_rows
    FROM financial_statement_snapshot s WHERE s.tenant_id=p_tenant AND s.entity_id=p_entity AND s.financial_statement_snapshot_id=p_snapshot;
END;$$;

REVOKE ALL ON financial_statement_snapshot FROM PUBLIC,refs_app;
REVOKE ALL ON FUNCTION refs_financial_statement_snapshot_hash(uuid,jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION refs_financial_statement_snapshot_request_hash(uuid,uuid,uuid,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION refs_financial_statement_snapshot_request_hash(uuid,uuid,uuid,text) TO refs_app;
REVOKE ALL ON FUNCTION refs_create_financial_statement_snapshot(uuid,uuid,uuid,text,text,text) FROM PUBLIC;
REVOKE ALL ON FUNCTION refs_list_financial_statement_snapshots(uuid,uuid,uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION refs_get_financial_statement_snapshot(uuid,uuid,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION refs_create_financial_statement_snapshot(uuid,uuid,uuid,text,text,text) TO refs_app;
GRANT EXECUTE ON FUNCTION refs_list_financial_statement_snapshots(uuid,uuid,uuid) TO refs_app;
GRANT EXECUTE ON FUNCTION refs_get_financial_statement_snapshot(uuid,uuid,uuid) TO refs_app;
COMMIT;
