BEGIN;

-- Protect receipt replays before delegating to the immutable historical command.
ALTER FUNCTION refs_start_wbs_test_bank_reconciliation(uuid,uuid,uuid,text,text)
  RENAME TO refs_start_wbs_test_bank_reconciliation_453;
CREATE FUNCTION refs_start_wbs_test_bank_reconciliation(
  p_tenant uuid,p_entity uuid,p_receipt uuid,p_expected_receipt_hash text,p_idempotency_key text
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE actor text:=refs_current_actor(); receipt wbs_test_bank_import_receipt;
  period_row accounting_period; started jsonb; retained_status text;
BEGIN
  PERFORM refs_assert_scope(p_tenant,p_entity,'BANK.RECONCILIATION.START');
  IF actor IS NULL OR COALESCE(length(p_idempotency_key),0) NOT BETWEEN 8 AND 200
    OR COALESCE(p_expected_receipt_hash,'')!~'^sha256:[0-9a-f]{64}$' THEN
    RAISE EXCEPTION 'Exact receipt hash and stable start identity required' USING ERRCODE='22023';
  END IF;
  SELECT * INTO receipt FROM wbs_test_bank_import_receipt
    WHERE tenant_id=p_tenant AND entity_id=p_entity AND wbs_test_bank_import_receipt_id=p_receipt FOR UPDATE;
  IF NOT FOUND OR receipt.receipt_hash IS DISTINCT FROM p_expected_receipt_hash OR actor=receipt.imported_by THEN
    RAISE EXCEPTION 'Exact receipt and independent starter required' USING ERRCODE='42501';
  END IF;
  SELECT * INTO period_row FROM accounting_period
    WHERE tenant_id=p_tenant AND entity_id=p_entity AND period_id=receipt.period_id
      AND ledger_code='PRIMARY' AND status='OPEN'
      AND starts_on=receipt.statement_start_date AND ends_on=receipt.statement_end_date FOR SHARE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Exact OPEN PRIMARY receipt period required' USING ERRCODE='55000';
  END IF;
  IF receipt.reconciliation_id IS NOT NULL THEN
    IF actor IS DISTINCT FROM receipt.reconciliation_started_by THEN
      RAISE EXCEPTION 'Receipt retry belongs to another starter' USING ERRCODE='42501';
    END IF;
    IF NOT EXISTS(SELECT 1 FROM audit_event WHERE tenant_id=p_tenant AND entity_id=p_entity
      AND object_id=receipt.reconciliation_id AND event_type='WBS_TEST_BANK_RECONCILIATION_STARTED'
      AND actor_id=actor AND idempotency_key=p_idempotency_key) THEN
      RAISE EXCEPTION 'Receipt retry key differs from original start' USING ERRCODE='23505';
    END IF;
    SELECT status INTO retained_status FROM reconciliation WHERE tenant_id=p_tenant AND entity_id=p_entity
      AND reconciliation_id=receipt.reconciliation_id FOR SHARE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Receipt reconciliation is missing' USING ERRCODE='23514'; END IF;
    RETURN jsonb_build_object('wbs_test_bank_import_receipt_id',p_receipt,'receipt_hash',receipt.receipt_hash,
      'reconciliation_id',receipt.reconciliation_id,'imported_by',receipt.imported_by,'started_by',actor,
      'status',retained_status,'idempotent',true);
  END IF;
  started:=refs_start_wbs_test_bank_reconciliation_453(p_tenant,p_entity,p_receipt,p_expected_receipt_hash,p_idempotency_key);
  RETURN started;
END;
$$;
REVOKE ALL ON FUNCTION refs_start_wbs_test_bank_reconciliation_453(uuid,uuid,uuid,text,text) FROM PUBLIC,refs_app;
REVOKE ALL ON FUNCTION refs_start_wbs_test_bank_reconciliation(uuid,uuid,uuid,text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION refs_start_wbs_test_bank_reconciliation(uuid,uuid,uuid,text,text) TO refs_app;
COMMIT;
