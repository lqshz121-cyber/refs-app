BEGIN;

-- The original commands protect the receipt row but did not verify its
-- actor_id.  Lock a deterministic receipt identity before delegating so a
-- second actor cannot race between this check and the legacy insert.
CREATE FUNCTION refs_assert_reconciliation_idempotency_actor(
  p_tenant uuid,p_operation_scope text,p_idempotency_key text
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE receipt_actor text; actor text:=refs_current_actor();
BEGIN
  IF actor IS NULL THEN RAISE EXCEPTION 'Authenticated actor missing' USING ERRCODE='42501'; END IF;
  IF COALESCE(length(p_idempotency_key),0) NOT BETWEEN 8 AND 200 THEN
    RAISE EXCEPTION 'Idempotency key is required' USING ERRCODE='22023';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(
    p_tenant::text||':'||p_operation_scope||':'||p_idempotency_key,0
  ));
  SELECT actor_id INTO receipt_actor FROM idempotency_receipt
    WHERE tenant_id=p_tenant AND operation_scope=p_operation_scope AND idempotency_key=p_idempotency_key;
  IF FOUND AND receipt_actor IS DISTINCT FROM actor THEN
    RAISE EXCEPTION 'Reconciliation retry belongs to another actor' USING ERRCODE='42501';
  END IF;
END;
$$;

ALTER FUNCTION refs_start_reconciliation(uuid,uuid,text,date,numeric,numeric,text,text,text)
  RENAME TO refs_start_reconciliation_385;
CREATE FUNCTION refs_start_reconciliation(
  p_tenant uuid,p_entity uuid,p_bank_account_ref text,p_statement_ending_date date,
  p_statement_opening_balance numeric,p_statement_ending_balance numeric,p_reason text,p_idempotency_key text,p_request_hash text
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
BEGIN
  PERFORM refs_assert_reconciliation_idempotency_actor(p_tenant,'RECONCILIATION_START:'||p_entity,p_idempotency_key);
  RETURN refs_start_reconciliation_385(p_tenant,p_entity,p_bank_account_ref,p_statement_ending_date,p_statement_opening_balance,p_statement_ending_balance,p_reason,p_idempotency_key,p_request_hash);
END;
$$;

ALTER FUNCTION refs_set_reconciliation_clearance(uuid,uuid,uuid,uuid,bigint,bigint,boolean,text,text,text)
  RENAME TO refs_set_reconciliation_clearance_385;
CREATE FUNCTION refs_set_reconciliation_clearance(
  p_tenant uuid,p_entity uuid,p_reconciliation uuid,p_bank_source uuid,p_expected_reconciliation_version bigint,
  p_expected_bank_version bigint,p_clear boolean,p_reason text,p_idempotency_key text,p_request_hash text
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
BEGIN
  PERFORM refs_assert_reconciliation_idempotency_actor(p_tenant,'RECONCILIATION_CLEARANCE:'||p_entity,p_idempotency_key);
  RETURN refs_set_reconciliation_clearance_385(p_tenant,p_entity,p_reconciliation,p_bank_source,p_expected_reconciliation_version,p_expected_bank_version,p_clear,p_reason,p_idempotency_key,p_request_hash);
END;
$$;

ALTER FUNCTION refs_transition_reconciliation_adjustment_aware(uuid,uuid,uuid,text,bigint,text,text,text)
  RENAME TO refs_transition_reconciliation_adjustment_aware_385;
CREATE FUNCTION refs_transition_reconciliation_adjustment_aware(
  p_tenant uuid,p_entity uuid,p_reconciliation uuid,p_action text,p_expected_version bigint,p_reason text,p_idempotency_key text,p_request_hash text
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
BEGIN
  PERFORM refs_assert_reconciliation_idempotency_actor(p_tenant,'RECONCILIATION_'||upper(p_action)||':'||p_entity,p_idempotency_key);
  RETURN refs_transition_reconciliation_adjustment_aware_385(p_tenant,p_entity,p_reconciliation,p_action,p_expected_version,p_reason,p_idempotency_key,p_request_hash);
END;
$$;

ALTER FUNCTION refs_create_reconciliation_adjustment_draft(uuid,uuid,uuid,uuid,bigint,uuid,text,date,char,text,jsonb,uuid[],text,text,text)
  RENAME TO refs_create_reconciliation_adjustment_draft_385;
CREATE FUNCTION refs_create_reconciliation_adjustment_draft(
  p_tenant uuid,p_entity uuid,p_reconciliation uuid,p_bank_source uuid,p_expected_reconciliation_version bigint,
  p_period uuid,p_journal_number text,p_journal_date date,p_currency char,p_description text,
  p_lines jsonb,p_attachment_ids uuid[],p_reason text,p_idempotency_key text,p_request_hash text
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
BEGIN
  PERFORM refs_assert_reconciliation_idempotency_actor(p_tenant,'RECONCILIATION_ADJUSTMENT_DRAFT:'||p_entity,p_idempotency_key);
  RETURN refs_create_reconciliation_adjustment_draft_385(p_tenant,p_entity,p_reconciliation,p_bank_source,p_expected_reconciliation_version,p_period,p_journal_number,p_journal_date,p_currency,p_description,p_lines,p_attachment_ids,p_reason,p_idempotency_key,p_request_hash);
END;
$$;

REVOKE ALL ON FUNCTION refs_assert_reconciliation_idempotency_actor(uuid,text,text) FROM PUBLIC;
REVOKE ALL ON FUNCTION refs_start_reconciliation_385(uuid,uuid,text,date,numeric,numeric,text,text,text) FROM PUBLIC,refs_app;
REVOKE ALL ON FUNCTION refs_set_reconciliation_clearance_385(uuid,uuid,uuid,uuid,bigint,bigint,boolean,text,text,text) FROM PUBLIC,refs_app;
REVOKE ALL ON FUNCTION refs_transition_reconciliation_adjustment_aware_385(uuid,uuid,uuid,text,bigint,text,text,text) FROM PUBLIC,refs_app;
REVOKE ALL ON FUNCTION refs_create_reconciliation_adjustment_draft_385(uuid,uuid,uuid,uuid,bigint,uuid,text,date,char,text,jsonb,uuid[],text,text,text) FROM PUBLIC,refs_app;
REVOKE ALL ON FUNCTION refs_start_reconciliation(uuid,uuid,text,date,numeric,numeric,text,text,text) FROM PUBLIC;
REVOKE ALL ON FUNCTION refs_set_reconciliation_clearance(uuid,uuid,uuid,uuid,bigint,bigint,boolean,text,text,text) FROM PUBLIC;
REVOKE ALL ON FUNCTION refs_transition_reconciliation_adjustment_aware(uuid,uuid,uuid,text,bigint,text,text,text) FROM PUBLIC;
REVOKE ALL ON FUNCTION refs_create_reconciliation_adjustment_draft(uuid,uuid,uuid,uuid,bigint,uuid,text,date,char,text,jsonb,uuid[],text,text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION refs_start_reconciliation(uuid,uuid,text,date,numeric,numeric,text,text,text) TO refs_app;
GRANT EXECUTE ON FUNCTION refs_set_reconciliation_clearance(uuid,uuid,uuid,uuid,bigint,bigint,boolean,text,text,text) TO refs_app;
GRANT EXECUTE ON FUNCTION refs_transition_reconciliation_adjustment_aware(uuid,uuid,uuid,text,bigint,text,text,text) TO refs_app;
GRANT EXECUTE ON FUNCTION refs_create_reconciliation_adjustment_draft(uuid,uuid,uuid,uuid,bigint,uuid,text,date,char,text,jsonb,uuid[],text,text,text) TO refs_app;
COMMIT;
