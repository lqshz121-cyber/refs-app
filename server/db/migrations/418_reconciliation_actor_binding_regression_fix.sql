BEGIN;

ALTER FUNCTION refs_start_reconciliation(uuid,uuid,text,date,numeric,numeric,text,text,text)
  RENAME TO refs_start_reconciliation_418;
CREATE FUNCTION refs_start_reconciliation(
  p_tenant uuid,p_entity uuid,p_bank_account_ref text,p_statement_ending_date date,
  p_statement_opening_balance numeric,p_statement_ending_balance numeric,p_reason text,p_idempotency_key text,p_request_hash text
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
BEGIN
  PERFORM refs_assert_reconciliation_idempotency_actor(p_tenant,'RECONCILIATION_START:'||p_entity,p_idempotency_key);
  RETURN refs_start_reconciliation_418(p_tenant,p_entity,p_bank_account_ref,p_statement_ending_date,p_statement_opening_balance,p_statement_ending_balance,p_reason,p_idempotency_key,p_request_hash);
END;
$$;

ALTER FUNCTION refs_create_reconciliation_adjustment_draft(uuid,uuid,uuid,uuid,bigint,uuid,text,date,char,text,jsonb,uuid[],text,text,text)
  RENAME TO refs_create_reconciliation_adjustment_draft_418;
CREATE FUNCTION refs_create_reconciliation_adjustment_draft(
  p_tenant uuid,p_entity uuid,p_reconciliation uuid,p_bank_source uuid,p_expected_reconciliation_version bigint,
  p_period uuid,p_journal_number text,p_journal_date date,p_currency char,p_description text,
  p_lines jsonb,p_attachment_ids uuid[],p_reason text,p_idempotency_key text,p_request_hash text
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
BEGIN
  PERFORM refs_assert_reconciliation_idempotency_actor(p_tenant,'RECONCILIATION_ADJUSTMENT_DRAFT:'||p_entity,p_idempotency_key);
  RETURN refs_create_reconciliation_adjustment_draft_418(p_tenant,p_entity,p_reconciliation,p_bank_source,p_expected_reconciliation_version,p_period,p_journal_number,p_journal_date,p_currency,p_description,p_lines,p_attachment_ids,p_reason,p_idempotency_key,p_request_hash);
END;
$$;
ALTER FUNCTION refs_set_reconciliation_adjustment_clearance(uuid,uuid,uuid,uuid,bigint,bigint,boolean,text,text,text)
  RENAME TO refs_set_reconciliation_adjustment_clearance_418;
CREATE FUNCTION refs_set_reconciliation_adjustment_clearance(
  p_tenant uuid,p_entity uuid,p_reconciliation uuid,p_bank_source uuid,p_expected_reconciliation_version bigint,
  p_expected_bank_version bigint,p_clear boolean,p_reason text,p_idempotency_key text,p_request_hash text
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
BEGIN
  PERFORM refs_assert_reconciliation_idempotency_actor(p_tenant,'RECONCILIATION_ADJUSTMENT_CLEARANCE:'||p_entity,p_idempotency_key);
  RETURN refs_set_reconciliation_adjustment_clearance_418(p_tenant,p_entity,p_reconciliation,p_bank_source,p_expected_reconciliation_version,p_expected_bank_version,p_clear,p_reason,p_idempotency_key,p_request_hash);
END;
$$;
ALTER FUNCTION refs_set_reconciliation_clearance(uuid,uuid,uuid,uuid,bigint,bigint,boolean,text,text,text)
  RENAME TO refs_set_reconciliation_clearance_418;
CREATE FUNCTION refs_set_reconciliation_clearance(
  p_tenant uuid,p_entity uuid,p_reconciliation uuid,p_bank_source uuid,p_expected_reconciliation_version bigint,
  p_expected_bank_version bigint,p_clear boolean,p_reason text,p_idempotency_key text,p_request_hash text
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
BEGIN
  PERFORM refs_assert_reconciliation_idempotency_actor(p_tenant,'RECONCILIATION_CLEARANCE:'||p_entity,p_idempotency_key);
  RETURN refs_set_reconciliation_clearance_418(p_tenant,p_entity,p_reconciliation,p_bank_source,p_expected_reconciliation_version,p_expected_bank_version,p_clear,p_reason,p_idempotency_key,p_request_hash);
END;
$$;

ALTER FUNCTION refs_transition_reconciliation_adjustment_aware(uuid,uuid,uuid,text,bigint,text,text,text)
  RENAME TO refs_transition_reconciliation_adjustment_aware_418;
CREATE FUNCTION refs_transition_reconciliation_adjustment_aware(
  p_tenant uuid,p_entity uuid,p_reconciliation uuid,p_action text,p_expected_version bigint,p_reason text,
  p_idempotency_key text,p_request_hash text
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
BEGIN
  PERFORM refs_assert_reconciliation_idempotency_actor(p_tenant,'RECONCILIATION_'||upper(p_action)||':'||p_entity,p_idempotency_key);
  RETURN refs_transition_reconciliation_adjustment_aware_418(p_tenant,p_entity,p_reconciliation,p_action,p_expected_version,p_reason,p_idempotency_key,p_request_hash);
END;
$$;

REVOKE ALL ON FUNCTION refs_set_reconciliation_adjustment_clearance_418(uuid,uuid,uuid,uuid,bigint,bigint,boolean,text,text,text) FROM PUBLIC,refs_app;
REVOKE ALL ON FUNCTION refs_set_reconciliation_adjustment_clearance(uuid,uuid,uuid,uuid,bigint,bigint,boolean,text,text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION refs_set_reconciliation_adjustment_clearance(uuid,uuid,uuid,uuid,bigint,bigint,boolean,text,text,text) TO refs_app;
REVOKE ALL ON FUNCTION refs_start_reconciliation_418(uuid,uuid,text,date,numeric,numeric,text,text,text) FROM PUBLIC,refs_app;
REVOKE ALL ON FUNCTION refs_create_reconciliation_adjustment_draft_418(uuid,uuid,uuid,uuid,bigint,uuid,text,date,char,text,jsonb,uuid[],text,text,text) FROM PUBLIC,refs_app;
REVOKE ALL ON FUNCTION refs_start_reconciliation(uuid,uuid,text,date,numeric,numeric,text,text,text) FROM PUBLIC;
REVOKE ALL ON FUNCTION refs_create_reconciliation_adjustment_draft(uuid,uuid,uuid,uuid,bigint,uuid,text,date,char,text,jsonb,uuid[],text,text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION refs_start_reconciliation(uuid,uuid,text,date,numeric,numeric,text,text,text) TO refs_app;
GRANT EXECUTE ON FUNCTION refs_create_reconciliation_adjustment_draft(uuid,uuid,uuid,uuid,bigint,uuid,text,date,char,text,jsonb,uuid[],text,text,text) TO refs_app;
REVOKE ALL ON FUNCTION refs_set_reconciliation_clearance_418(uuid,uuid,uuid,uuid,bigint,bigint,boolean,text,text,text) FROM PUBLIC,refs_app;
REVOKE ALL ON FUNCTION refs_transition_reconciliation_adjustment_aware_418(uuid,uuid,uuid,text,bigint,text,text,text) FROM PUBLIC,refs_app;
REVOKE ALL ON FUNCTION refs_set_reconciliation_clearance(uuid,uuid,uuid,uuid,bigint,bigint,boolean,text,text,text) FROM PUBLIC;
REVOKE ALL ON FUNCTION refs_transition_reconciliation_adjustment_aware(uuid,uuid,uuid,text,bigint,text,text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION refs_set_reconciliation_clearance(uuid,uuid,uuid,uuid,bigint,bigint,boolean,text,text,text) TO refs_app;
GRANT EXECUTE ON FUNCTION refs_transition_reconciliation_adjustment_aware(uuid,uuid,uuid,text,bigint,text,text,text) TO refs_app;

COMMIT;
