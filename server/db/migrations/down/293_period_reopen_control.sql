BEGIN;
DO $$BEGIN
  IF EXISTS(SELECT 1 FROM audit_event WHERE event_type='PERIOD_REOPENED_V1') THEN
    RAISE EXCEPTION 'Cannot remove period reopen control with retained evidence' USING ERRCODE='55000';
  END IF;
END;
$$;
REVOKE EXECUTE ON FUNCTION refs_reopen_period_v1(uuid,uuid,uuid,bigint,uuid,text,text,text,text) FROM refs_app;
DROP FUNCTION refs_reopen_period_v1(uuid,uuid,uuid,bigint,uuid,text,text,text,text);
CREATE OR REPLACE FUNCTION refs_reserve_idempotency(p_tenant uuid,p_scope text,p_key text,p_request_hash text,p_actor text) RETURNS idempotency_receipt
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE receipt idempotency_receipt;
BEGIN
  IF refs_current_tenant() IS DISTINCT FROM p_tenant THEN RAISE EXCEPTION 'Idempotency tenant scope denied' USING ERRCODE='42501'; END IF;
  IF refs_current_actor() IS DISTINCT FROM p_actor THEN RAISE EXCEPTION 'Actor must come from the authenticated session' USING ERRCODE='42501'; END IF;
  IF p_scope NOT LIKE 'POST_JOURNAL:%' AND p_scope NOT LIKE 'EDIT_JOURNAL:%' AND p_scope NOT LIKE 'CLOSE_PERIOD:%' AND p_scope NOT LIKE 'RETIRE_CONFIG:%' AND p_scope NOT LIKE 'CREATE_MANUAL_JOURNAL:%' AND p_scope NOT LIKE 'CREATE_AUTO_JOURNAL:%' AND p_scope NOT LIKE 'CREATE_REVERSAL:%' AND p_scope NOT LIKE 'CREATE_RECLASS:%' AND p_scope NOT LIKE 'JOURNAL_SUBMIT:%' AND p_scope NOT LIKE 'JOURNAL_REVIEW:%' AND p_scope NOT LIKE 'JOURNAL_APPROVE:%' AND p_scope NOT LIKE 'JOURNAL_REJECT:%' AND p_scope NOT LIKE 'AR_RECEIPT_REVERSAL:%' AND p_scope NOT LIKE 'AP_PAYMENT_REVERSAL:%' AND p_scope NOT LIKE 'PREPARE_STATEMENT_SNAPSHOT:%' AND p_scope NOT LIKE 'APPROVE_STATEMENT_SNAPSHOT:%' AND p_scope NOT LIKE 'WBS_H1_PAYABLE_RECLASS_DRAFT:%' THEN RAISE EXCEPTION 'Idempotency operation scope denied' USING ERRCODE='42501'; END IF;
  INSERT INTO idempotency_receipt(tenant_id,operation_scope,idempotency_key,request_hash,status,actor_id) VALUES(p_tenant,p_scope,p_key,p_request_hash,'IN_PROGRESS',p_actor) ON CONFLICT(tenant_id,operation_scope,idempotency_key) DO NOTHING;
  SELECT * INTO receipt FROM idempotency_receipt WHERE tenant_id=p_tenant AND operation_scope=p_scope AND idempotency_key=p_key FOR UPDATE;
  IF receipt.request_hash<>p_request_hash OR receipt.actor_id<>p_actor THEN RAISE EXCEPTION 'Idempotency key reused by a different request or actor' USING ERRCODE='23505'; END IF;
  RETURN receipt;
END;
$$;
DELETE FROM runtime_human_permission_authority WHERE permission_code='GL.PERIOD.REOPEN';
DELETE FROM permission_catalog WHERE permission_code='GL.PERIOD.REOPEN';
COMMIT;
