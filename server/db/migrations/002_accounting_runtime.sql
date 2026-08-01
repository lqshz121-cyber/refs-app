BEGIN;

CREATE TABLE account_master (
  tenant_id uuid NOT NULL,
  entity_id uuid NOT NULL,
  account_code text NOT NULL,
  account_name text NOT NULL,
  requires_member boolean NOT NULL DEFAULT false,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, entity_id, account_code),
  FOREIGN KEY (tenant_id, entity_id) REFERENCES entity(tenant_id, entity_id)
);

CREATE TABLE member_master (
  tenant_id uuid NOT NULL,
  entity_id uuid NOT NULL,
  member_ref text NOT NULL,
  member_type text NOT NULL,
  display_name text NOT NULL,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, entity_id, member_ref),
  FOREIGN KEY (tenant_id, entity_id) REFERENCES entity(tenant_id, entity_id)
);

ALTER TABLE journal_line ADD CONSTRAINT journal_line_account_fk
  FOREIGN KEY (tenant_id, entity_id, account_code)
  REFERENCES account_master(tenant_id, entity_id, account_code);
ALTER TABLE journal_line ADD CONSTRAINT journal_line_member_fk
  FOREIGN KEY (tenant_id, entity_id, member_ref)
  REFERENCES member_master(tenant_id, entity_id, member_ref);

CREATE OR REPLACE FUNCTION refs_validate_journal_line_master() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE account_requires_member boolean;
BEGIN
  SELECT requires_member INTO account_requires_member
    FROM account_master
    WHERE tenant_id=NEW.tenant_id AND entity_id=NEW.entity_id
      AND account_code=NEW.account_code AND active
    FOR KEY SHARE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Account is absent, inactive, or outside the JE entity' USING ERRCODE='23503';
  END IF;
  IF account_requires_member AND NEW.member_ref IS NULL THEN
    RAISE EXCEPTION 'Member is required for account %', NEW.account_code USING ERRCODE='23514';
  END IF;
  IF NEW.member_ref IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM member_master
    WHERE tenant_id=NEW.tenant_id AND entity_id=NEW.entity_id
      AND member_ref=NEW.member_ref AND active
  ) THEN
    RAISE EXCEPTION 'Member is absent, inactive, or outside the JE entity' USING ERRCODE='23503';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER journal_line_master_guard
  BEFORE INSERT OR UPDATE OF tenant_id, entity_id, account_code, member_ref ON journal_line
  FOR EACH ROW EXECUTE FUNCTION refs_validate_journal_line_master();

CREATE TABLE runtime_auth_context (
  auth_context_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  token_hash text NOT NULL UNIQUE CHECK (token_hash ~ '^sha256:[0-9a-f]{64}$'),
  tenant_id uuid NOT NULL REFERENCES tenant(tenant_id),
  grants jsonb NOT NULL CHECK (jsonb_typeof(grants)='array' AND jsonb_array_length(grants)>0),
  actor_id text NOT NULL CHECK (length(btrim(actor_id))>0),
  bound_login name NOT NULL,
  bound_backend_pid integer,
  bound_txid bigint,
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
COMMENT ON TABLE runtime_auth_context IS 'Owner-only opaque session capability. Runtime receives only the raw high-entropy token; table rows are never granted to refs_app.';

CREATE TABLE runtime_actor_grant (
  tenant_id uuid NOT NULL,
  actor_id text NOT NULL CHECK (length(btrim(actor_id))>0),
  entity_id uuid NOT NULL,
  permission text NOT NULL CHECK (length(btrim(permission))>0),
  valid_until timestamptz,
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id,actor_id,entity_id,permission),
  FOREIGN KEY (tenant_id,entity_id) REFERENCES entity(tenant_id,entity_id)
);
COMMENT ON TABLE runtime_actor_grant IS 'DB-owned authorization projection populated only by platform IAM sync; request bodies never define tenant, entity, or permissions.';

CREATE OR REPLACE FUNCTION refs_issue_context(p_actor text,p_tenant uuid,p_token_hash text,p_ttl_seconds integer DEFAULT 300)
RETURNS runtime_auth_context
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE issued runtime_auth_context; allowed_grants jsonb;
BEGIN
  IF session_user<>'refs_context_issuer' THEN RAISE EXCEPTION 'Context issuer identity denied' USING ERRCODE='42501'; END IF;
  IF p_token_hash!~'^sha256:[0-9a-f]{64}$' OR p_ttl_seconds<30 OR p_ttl_seconds>300 THEN
    RAISE EXCEPTION 'Invalid context token hash or TTL' USING ERRCODE='22023';
  END IF;
  SELECT jsonb_agg(jsonb_build_object('entity_id',entity_id,'permission',permission) ORDER BY entity_id,permission)
    INTO allowed_grants FROM runtime_actor_grant
    WHERE tenant_id=p_tenant AND actor_id=p_actor AND revoked_at IS NULL
      AND (valid_until IS NULL OR valid_until>clock_timestamp());
  IF allowed_grants IS NULL THEN RAISE EXCEPTION 'Actor has no active DB authorization grant' USING ERRCODE='42501'; END IF;
  INSERT INTO runtime_auth_context(token_hash,tenant_id,grants,actor_id,bound_login,expires_at)
    VALUES(p_token_hash,p_tenant,allowed_grants,p_actor,'refs_runtime',clock_timestamp()+make_interval(secs=>p_ttl_seconds))
    RETURNING * INTO issued;
  INSERT INTO audit_event(tenant_id,event_type,object_type,object_id,action,actor_id,actor_type,permission_used,request_id,correlation_id,after_hash,metadata)
    VALUES(p_tenant,'RUNTIME_CONTEXT_ISSUED','RUNTIME_AUTH_CONTEXT',issued.auth_context_id,'ISSUE',p_actor,'SYSTEM','AUTH.CONTEXT.ISSUE',issued.auth_context_id::text,issued.auth_context_id::text,p_token_hash,jsonb_build_object('expires_at',issued.expires_at,'issuer',session_user));
  RETURN issued;
END;
$$;

CREATE OR REPLACE FUNCTION refs_revoke_context(p_token_hash text,p_reason text) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE changed runtime_auth_context;
BEGIN
  IF session_user<>'refs_context_issuer' THEN RAISE EXCEPTION 'Context issuer identity denied' USING ERRCODE='42501'; END IF;
  UPDATE runtime_auth_context SET revoked_at=clock_timestamp()
    WHERE token_hash=p_token_hash AND revoked_at IS NULL RETURNING * INTO changed;
  IF NOT FOUND THEN RETURN false; END IF;
  INSERT INTO audit_event(tenant_id,event_type,object_type,object_id,action,actor_id,actor_type,permission_used,request_id,correlation_id,before_hash,reason)
    VALUES(changed.tenant_id,'RUNTIME_CONTEXT_REVOKED','RUNTIME_AUTH_CONTEXT',changed.auth_context_id,'REVOKE',changed.actor_id,'SYSTEM','AUTH.CONTEXT.REVOKE',changed.auth_context_id::text,changed.auth_context_id::text,p_token_hash,p_reason);
  RETURN true;
END;
$$;

CREATE OR REPLACE FUNCTION refs_cleanup_contexts(p_retention interval DEFAULT interval '1 day') RETURNS bigint
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE deleted bigint;
BEGIN
  IF session_user<>'refs_context_issuer' THEN RAISE EXCEPTION 'Context issuer identity denied' USING ERRCODE='42501'; END IF;
  IF p_retention<interval '1 hour' THEN RAISE EXCEPTION 'Context retention is too short' USING ERRCODE='22023'; END IF;
  DELETE FROM runtime_auth_context WHERE COALESCE(revoked_at,expires_at)<clock_timestamp()-p_retention;
  GET DIAGNOSTICS deleted=ROW_COUNT;
  RETURN deleted;
END;
$$;

CREATE OR REPLACE FUNCTION refs_bootstrap_context(p_token text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE token_digest text:='sha256:'||encode(digest(convert_to(p_token,'UTF8'),'sha256'),'hex'); context_row runtime_auth_context;
BEGIN
  IF length(p_token)<32 THEN RAISE EXCEPTION 'Invalid runtime context token' USING ERRCODE='42501'; END IF;
  SELECT * INTO context_row FROM runtime_auth_context
    WHERE token_hash=token_digest AND revoked_at IS NULL AND expires_at>clock_timestamp()
      AND bound_login=session_user AND bound_backend_pid IS NULL AND bound_txid IS NULL
    FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Runtime context denied or expired' USING ERRCODE='42501'; END IF;
  UPDATE runtime_auth_context SET bound_backend_pid=pg_backend_pid(),bound_txid=txid_current() WHERE auth_context_id=context_row.auth_context_id;
  PERFORM set_config('refs.context_hash',token_digest,true);
END;
$$;

COMMENT ON FUNCTION refs_bootstrap_context(text) IS 'Binds a pre-issued opaque capability to the current refs_runtime backend. Claims remain DB-owned and are never accepted from caller GUCs.';

CREATE OR REPLACE FUNCTION refs_current_tenant() RETURNS uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
  SELECT tenant_id FROM runtime_auth_context
  WHERE token_hash=current_setting('refs.context_hash',true)
    AND bound_login=session_user AND bound_backend_pid=pg_backend_pid() AND bound_txid=txid_current()
    AND revoked_at IS NULL AND expires_at>clock_timestamp()
$$;

CREATE OR REPLACE FUNCTION refs_entity_allowed(candidate uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
  SELECT COALESCE(EXISTS(
    SELECT 1 FROM runtime_auth_context
    WHERE token_hash=current_setting('refs.context_hash',true)
      AND bound_login=session_user AND bound_backend_pid=pg_backend_pid() AND bound_txid=txid_current()
      AND revoked_at IS NULL AND expires_at>clock_timestamp()
      AND EXISTS (SELECT 1 FROM jsonb_array_elements(grants) g WHERE (g->>'entity_id')::uuid=candidate)
  ),false)
$$;

CREATE OR REPLACE FUNCTION refs_has_permission(required_permission text) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
  SELECT COALESCE(EXISTS(
    SELECT 1 FROM runtime_auth_context
    WHERE token_hash=current_setting('refs.context_hash',true)
      AND bound_login=session_user AND bound_backend_pid=pg_backend_pid() AND bound_txid=txid_current()
      AND revoked_at IS NULL AND expires_at>clock_timestamp()
      AND EXISTS (SELECT 1 FROM jsonb_array_elements(grants) g WHERE g->>'permission' IN (required_permission,'*'))
  ),false)
$$;

CREATE OR REPLACE FUNCTION refs_entity_has_permission(candidate uuid,required_permission text) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
  SELECT COALESCE(EXISTS(
    SELECT 1 FROM runtime_auth_context c, LATERAL jsonb_array_elements(c.grants) g
    WHERE c.token_hash=current_setting('refs.context_hash',true)
      AND c.bound_login=session_user AND c.bound_backend_pid=pg_backend_pid() AND c.bound_txid=txid_current()
      AND c.revoked_at IS NULL AND c.expires_at>clock_timestamp()
      AND (g->>'entity_id')::uuid=candidate AND g->>'permission' IN (required_permission,'*')
  ),false)
$$;

CREATE OR REPLACE FUNCTION refs_current_actor() RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
  SELECT actor_id FROM runtime_auth_context
  WHERE token_hash=current_setting('refs.context_hash',true)
    AND bound_login=session_user AND bound_backend_pid=pg_backend_pid() AND bound_txid=txid_current()
    AND revoked_at IS NULL AND expires_at>clock_timestamp()
$$;

CREATE OR REPLACE FUNCTION refs_assert_scope(target_tenant uuid,target_entity uuid,required_permission text) RETURNS void
LANGUAGE plpgsql STABLE AS $$
BEGIN
  IF refs_current_tenant() IS DISTINCT FROM target_tenant OR refs_entity_allowed(target_entity) IS NOT TRUE THEN
    RAISE EXCEPTION 'Tenant/entity scope denied' USING ERRCODE='42501';
  END IF;
  IF refs_entity_has_permission(target_entity,required_permission) IS NOT TRUE THEN
    RAISE EXCEPTION 'Permission % denied', required_permission USING ERRCODE='42501';
  END IF;
END;
$$;

ALTER TABLE outbox_event
  ADD COLUMN entity_id uuid,
  ADD FOREIGN KEY (tenant_id,entity_id) REFERENCES entity(tenant_id,entity_id);

DO $$
DECLARE table_name text;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='refs_app') OR NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='refs_runtime') OR NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='refs_context_issuer') THEN
    RAISE EXCEPTION 'Platform prerequisite roles refs_app, refs_runtime, and refs_context_issuer are required';
  END IF;
  FOREACH table_name IN ARRAY ARRAY[
    'tenant','entity','accounting_period','sync_cursor','import_batch','raw_event','attachment',
    'source_document','source_document_line','setting_snapshot','mapping_snapshot','rule_evaluation',
    'ai_decision','staging_item','accounting_exception','journal_entry','journal_line','posting_batch',
    'ledger_line','bank_source','bank_match','reconciliation','source_link','idempotency_receipt',
    'audit_event','outbox_event','account_master','member_master'
  ] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY',table_name);
    EXECUTE format('CREATE POLICY %I_tenant_policy ON %I USING (tenant_id=refs_current_tenant()) WITH CHECK (tenant_id=refs_current_tenant())',table_name,table_name);
  END LOOP;
END;
$$;

DO $$
DECLARE table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'entity','accounting_period','source_document','source_document_line','setting_snapshot','mapping_snapshot',
    'staging_item','accounting_exception','journal_entry','journal_line','posting_batch','ledger_line',
    'bank_source','bank_match','reconciliation','source_link','audit_event','outbox_event','account_master','member_master'
  ] LOOP
    EXECUTE format('DROP POLICY %I_tenant_policy ON %I',table_name,table_name);
    EXECUTE format('CREATE POLICY %I_scope_policy ON %I USING (tenant_id=refs_current_tenant() AND (entity_id IS NULL OR refs_entity_allowed(entity_id))) WITH CHECK (tenant_id=refs_current_tenant() AND (entity_id IS NULL OR refs_entity_allowed(entity_id)))',table_name,table_name);
  END LOOP;
END;
$$;

ALTER TABLE outbox_event
  ADD COLUMN locked_by text,
  ADD COLUMN locked_at timestamptz,
  ADD CONSTRAINT outbox_lock_pair_ck CHECK ((locked_by IS NULL)=(locked_at IS NULL));

CREATE OR REPLACE FUNCTION refs_protect_outbox_payload() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP='DELETE' THEN
    RAISE EXCEPTION 'Outbox is append-only' USING ERRCODE='55000';
  END IF;
  IF (NEW.tenant_id,NEW.entity_id,NEW.aggregate_type,NEW.aggregate_id,NEW.event_type,NEW.payload,NEW.payload_hash,NEW.created_at)
     IS DISTINCT FROM
     (OLD.tenant_id,OLD.entity_id,OLD.aggregate_type,OLD.aggregate_id,OLD.event_type,OLD.payload,OLD.payload_hash,OLD.created_at) THEN
    RAISE EXCEPTION 'Outbox business payload is immutable' USING ERRCODE='55000';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER outbox_payload_immutable
  BEFORE UPDATE OR DELETE ON outbox_event
  FOR EACH ROW EXECUTE FUNCTION refs_protect_outbox_payload();

CREATE OR REPLACE FUNCTION refs_reserve_idempotency(
  p_tenant uuid,p_scope text,p_key text,p_request_hash text,p_actor text
) RETURNS idempotency_receipt
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE receipt idempotency_receipt;
BEGIN
  IF refs_current_tenant() IS DISTINCT FROM p_tenant THEN
    RAISE EXCEPTION 'Idempotency tenant scope denied' USING ERRCODE='42501';
  END IF;
  IF refs_current_actor() IS DISTINCT FROM p_actor THEN
    RAISE EXCEPTION 'Actor must come from the authenticated session' USING ERRCODE='42501';
  END IF;
  IF p_scope NOT LIKE 'POST_JOURNAL:%' AND p_scope NOT LIKE 'EDIT_JOURNAL:%' AND p_scope NOT LIKE 'CLOSE_PERIOD:%' THEN
    RAISE EXCEPTION 'Idempotency operation scope denied' USING ERRCODE='42501';
  END IF;
  INSERT INTO idempotency_receipt(tenant_id,operation_scope,idempotency_key,request_hash,status,actor_id)
  VALUES(p_tenant,p_scope,p_key,p_request_hash,'IN_PROGRESS',p_actor)
  ON CONFLICT (tenant_id,operation_scope,idempotency_key) DO NOTHING;
  SELECT * INTO receipt FROM idempotency_receipt
    WHERE tenant_id=p_tenant AND operation_scope=p_scope AND idempotency_key=p_key
    FOR UPDATE;
  IF receipt.request_hash<>p_request_hash THEN
    RAISE EXCEPTION 'Idempotency key reused with different request hash' USING ERRCODE='23505';
  END IF;
  RETURN receipt;
END;
$$;

CREATE OR REPLACE FUNCTION refs_jsonb_hash(value jsonb) RETURNS text
LANGUAGE sql IMMUTABLE AS $$
  SELECT 'sha256:'||encode(digest(convert_to(value::text,'UTF8'),'sha256'),'hex')
$$;

CREATE OR REPLACE FUNCTION refs_update_draft_description(
  p_tenant uuid,p_entity uuid,p_journal uuid,p_expected_revision bigint,p_description text,
  p_idempotency_key text,p_request_hash text
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE je journal_entry; receipt idempotency_receipt; response jsonb; actor text:=refs_current_actor(); event_payload jsonb;
BEGIN
  PERFORM refs_assert_scope(p_tenant,p_entity,'GL.JE.EDIT');
  IF actor IS NULL THEN RAISE EXCEPTION 'Authenticated actor missing' USING ERRCODE='42501'; END IF;
  SELECT * INTO je FROM journal_entry
    WHERE tenant_id=p_tenant AND entity_id=p_entity AND journal_entry_id=p_journal FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Journal not found' USING ERRCODE='P0002'; END IF;
  receipt:=refs_reserve_idempotency(p_tenant,'EDIT_JOURNAL:'||p_entity,p_idempotency_key,p_request_hash,actor);
  IF receipt.status='SUCCEEDED' THEN RETURN receipt.response_body||jsonb_build_object('idempotent',true); END IF;
  IF je.status<>'DRAFT' OR je.revision<>p_expected_revision THEN RAISE EXCEPTION 'Revision conflict or immutable JE' USING ERRCODE='40001'; END IF;
  UPDATE journal_entry SET description=p_description,revision=revision+1
    WHERE tenant_id=p_tenant AND entity_id=p_entity AND journal_entry_id=p_journal AND revision=p_expected_revision;
  response:=jsonb_build_object('journal_entry_id',p_journal,'revision',p_expected_revision+1,'description',p_description,'idempotent',false);
  INSERT INTO audit_event(tenant_id,entity_id,event_type,object_type,object_id,action,actor_id,actor_type,permission_used,request_id,correlation_id,idempotency_key,after_hash)
    VALUES(p_tenant,p_entity,'JOURNAL_DRAFT_EDITED','JOURNAL_ENTRY',p_journal,'EDIT',actor,'USER','GL.JE.EDIT',p_idempotency_key,p_idempotency_key,p_idempotency_key,p_request_hash);
  event_payload:=jsonb_build_object('journal_entry_id',p_journal,'revision',p_expected_revision+1);
  INSERT INTO outbox_event(tenant_id,entity_id,aggregate_type,aggregate_id,event_type,payload,payload_hash)
    VALUES(p_tenant,p_entity,'JOURNAL_ENTRY',p_journal,'JOURNAL_DRAFT_EDITED',event_payload,refs_jsonb_hash(event_payload));
  UPDATE idempotency_receipt SET status='SUCCEEDED',response_status=200,response_body=response,completed_at=now()
    WHERE idempotency_receipt_id=receipt.idempotency_receipt_id;
  RETURN response;
END;
$$;

CREATE OR REPLACE FUNCTION refs_close_period(
  p_tenant uuid,p_entity uuid,p_period uuid,p_expected_version bigint,
  p_idempotency_key text,p_request_hash text,p_actor text
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE period_row accounting_period; receipt idempotency_receipt; response jsonb; event_payload jsonb;
BEGIN
  PERFORM refs_assert_scope(p_tenant,p_entity,'GL.PERIOD.CLOSE');
  IF refs_current_actor() IS DISTINCT FROM p_actor THEN RAISE EXCEPTION 'Actor mismatch' USING ERRCODE='42501'; END IF;
  SELECT * INTO period_row FROM accounting_period
    WHERE tenant_id=p_tenant AND entity_id=p_entity AND period_id=p_period FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Period not found' USING ERRCODE='P0002'; END IF;
  receipt:=refs_reserve_idempotency(p_tenant,'CLOSE_PERIOD:'||p_entity,p_idempotency_key,p_request_hash,p_actor);
  IF receipt.status='SUCCEEDED' THEN RETURN receipt.response_body||jsonb_build_object('idempotent',true); END IF;
  IF period_row.status<>'OPEN' THEN RAISE EXCEPTION 'Only an OPEN period can be closed' USING ERRCODE='55000'; END IF;
  IF period_row.version<>p_expected_version THEN RAISE EXCEPTION 'Revision conflict' USING ERRCODE='40001'; END IF;
  UPDATE accounting_period SET status='CLOSED',closed_by=p_actor,closed_at=now(),version=version+1
    WHERE tenant_id=p_tenant AND entity_id=p_entity AND period_id=p_period;
  response:=jsonb_build_object('period_id',p_period,'version',p_expected_version+1,'status','CLOSED','idempotent',false);
  INSERT INTO audit_event(tenant_id,entity_id,event_type,object_type,object_id,action,actor_id,actor_type,permission_used,request_id,correlation_id,idempotency_key,after_hash)
    VALUES(p_tenant,p_entity,'PERIOD_CLOSED','ACCOUNTING_PERIOD',p_period,'CLOSE',p_actor,'USER','GL.PERIOD.CLOSE',p_idempotency_key,p_idempotency_key,p_idempotency_key,p_request_hash);
  event_payload:=jsonb_build_object('period_id',p_period,'version',p_expected_version+1,'status','CLOSED');
  INSERT INTO outbox_event(tenant_id,entity_id,aggregate_type,aggregate_id,event_type,payload,payload_hash)
    VALUES(p_tenant,p_entity,'ACCOUNTING_PERIOD',p_period,'PERIOD_CLOSED',event_payload,refs_jsonb_hash(event_payload));
  UPDATE idempotency_receipt SET status='SUCCEEDED',response_status=200,response_body=response,completed_at=now()
    WHERE idempotency_receipt_id=receipt.idempotency_receipt_id;
  RETURN response;
END;
$$;

CREATE OR REPLACE FUNCTION refs_post_journal(
  p_tenant uuid,p_entity uuid,p_period uuid,p_journal uuid,p_expected_revision bigint,
  p_idempotency_key text,p_request_hash text,p_actor text
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE period_row accounting_period; je journal_entry; receipt idempotency_receipt;
DECLARE balanced boolean; line_count bigint; batch_id uuid:=gen_random_uuid(); response jsonb; event_payload jsonb;
BEGIN
  PERFORM refs_assert_scope(p_tenant,p_entity,'GL.JE.POST');
  IF refs_current_actor() IS DISTINCT FROM p_actor THEN RAISE EXCEPTION 'Actor mismatch' USING ERRCODE='42501'; END IF;
  SELECT * INTO period_row FROM accounting_period
    WHERE tenant_id=p_tenant AND entity_id=p_entity AND period_id=p_period FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Period not found' USING ERRCODE='P0002'; END IF;

  SELECT * INTO je FROM journal_entry
    WHERE tenant_id=p_tenant AND entity_id=p_entity AND period_id=p_period AND journal_entry_id=p_journal
    FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Journal not found' USING ERRCODE='P0002'; END IF;
  receipt:=refs_reserve_idempotency(p_tenant,'POST_JOURNAL:'||p_entity,p_idempotency_key,p_request_hash,p_actor);
  IF receipt.status='SUCCEEDED' THEN RETURN receipt.response_body||jsonb_build_object('idempotent',true); END IF;
  IF period_row.status<>'OPEN' THEN RAISE EXCEPTION 'Period is not open' USING ERRCODE='55000'; END IF;
  IF je.revision<>p_expected_revision THEN RAISE EXCEPTION 'Revision conflict' USING ERRCODE='40001'; END IF;
  IF je.status<>'APPROVED' THEN RAISE EXCEPTION 'Journal is not approved' USING ERRCODE='55000'; END IF;
  IF p_actor IN (je.created_by,je.reviewed_by,je.approved_by) THEN RAISE EXCEPTION 'Posting SoD violation' USING ERRCODE='42501'; END IF;

  PERFORM 1 FROM journal_line
    WHERE tenant_id=p_tenant AND entity_id=p_entity AND period_id=p_period AND journal_entry_id=p_journal
    ORDER BY journal_line_id FOR UPDATE;
  SELECT count(*),COALESCE(sum(debit_amount),0)=COALESCE(sum(credit_amount),0) AND COALESCE(sum(debit_amount),0)>0
    INTO line_count,balanced FROM journal_line
    WHERE tenant_id=p_tenant AND entity_id=p_entity AND period_id=p_period AND journal_entry_id=p_journal;
  IF line_count<2 OR NOT balanced THEN RAISE EXCEPTION 'Journal is not balanced' USING ERRCODE='23514'; END IF;
  IF EXISTS (
    SELECT 1 FROM journal_line jl
    LEFT JOIN account_master a ON (a.tenant_id,a.entity_id,a.account_code)=(jl.tenant_id,jl.entity_id,jl.account_code) AND a.active
    LEFT JOIN member_master m ON (m.tenant_id,m.entity_id,m.member_ref)=(jl.tenant_id,jl.entity_id,jl.member_ref) AND m.active
    WHERE jl.tenant_id=p_tenant AND jl.entity_id=p_entity AND jl.journal_entry_id=p_journal
      AND (a.account_code IS NULL OR (a.requires_member AND jl.member_ref IS NULL) OR (jl.member_ref IS NOT NULL AND m.member_ref IS NULL))
  ) THEN RAISE EXCEPTION 'Account/member validation failed' USING ERRCODE='23514'; END IF;

  IF je.journal_type IN ('MANUAL','RECLASS') AND NOT EXISTS (
    SELECT 1 FROM source_link sl
    JOIN attachment att ON att.tenant_id=sl.tenant_id AND att.attachment_id=sl.attachment_id
    WHERE sl.tenant_id=p_tenant AND sl.entity_id=p_entity AND sl.journal_entry_id=p_journal
      AND att.finalization_status='VERIFIED_CLEAN' AND att.scan_status='CLEAN'
      AND att.verified_at IS NOT NULL AND att.finalized_at IS NOT NULL
  ) THEN RAISE EXCEPTION 'Manual and reclass journals require a verified clean attachment' USING ERRCODE='23514'; END IF;
  IF je.journal_type='AUTO' AND NOT EXISTS (
    SELECT 1 FROM source_link sl
    WHERE sl.tenant_id=p_tenant AND sl.entity_id=p_entity AND sl.journal_entry_id=p_journal
      AND num_nonnulls(sl.raw_event_id,sl.source_document_id,sl.staging_item_id)>0
  ) THEN RAISE EXCEPTION 'Automatic journals require immutable source evidence' USING ERRCODE='23514'; END IF;

  INSERT INTO posting_batch(posting_batch_id,tenant_id,entity_id,period_id,idempotency_key,request_hash,posted_by)
    VALUES(batch_id,p_tenant,p_entity,p_period,p_idempotency_key,p_request_hash,p_actor);
  INSERT INTO ledger_line(tenant_id,entity_id,period_id,posting_batch_id,journal_entry_id,journal_line_id,account_code,member_ref,currency,debit_amount,credit_amount,dimensions,posted_at)
    SELECT p_tenant,p_entity,p_period,batch_id,p_journal,journal_line_id,account_code,member_ref,je.currency,debit_amount,credit_amount,dimensions,now()
    FROM journal_line WHERE tenant_id=p_tenant AND entity_id=p_entity AND journal_entry_id=p_journal;
  INSERT INTO source_link(tenant_id,entity_id,link_type,journal_entry_id,journal_line_id,posting_batch_id,ledger_line_id,created_by)
    SELECT p_tenant,p_entity,'JE_LINE_TO_LEDGER',p_journal,ll.journal_line_id,batch_id,ll.ledger_line_id,p_actor
    FROM ledger_line ll WHERE tenant_id=p_tenant AND entity_id=p_entity AND posting_batch_id=batch_id;
  UPDATE journal_entry SET status='POSTED',posted_by=p_actor,posted_at=now(),revision=revision+1
    WHERE tenant_id=p_tenant AND entity_id=p_entity AND journal_entry_id=p_journal AND revision=p_expected_revision;
  IF NOT FOUND THEN RAISE EXCEPTION 'Revision conflict' USING ERRCODE='40001'; END IF;
  INSERT INTO audit_event(tenant_id,entity_id,event_type,object_type,object_id,action,actor_id,actor_type,permission_used,request_id,correlation_id,idempotency_key,after_hash)
    VALUES(p_tenant,p_entity,'JOURNAL_POSTED','JOURNAL_ENTRY',p_journal,'POST',p_actor,'USER','GL.JE.POST',p_idempotency_key,p_idempotency_key,p_idempotency_key,p_request_hash);
  event_payload:=jsonb_build_object('journal_entry_id',p_journal,'posting_batch_id',batch_id);
  INSERT INTO outbox_event(tenant_id,entity_id,aggregate_type,aggregate_id,event_type,payload,payload_hash)
    VALUES(p_tenant,p_entity,'JOURNAL_ENTRY',p_journal,'JOURNAL_POSTED',event_payload,refs_jsonb_hash(event_payload));
  response:=jsonb_build_object('journal_entry_id',p_journal,'posting_batch_id',batch_id,'idempotent',false);
  UPDATE idempotency_receipt SET status='SUCCEEDED',response_status=200,response_body=response,completed_at=now()
    WHERE idempotency_receipt_id=receipt.idempotency_receipt_id;
  RETURN response;
END;
$$;

CREATE OR REPLACE FUNCTION refs_claim_outbox(p_tenant uuid,p_worker text,p_limit integer DEFAULT 100)
RETURNS SETOF outbox_event
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
BEGIN
  IF refs_current_tenant() IS DISTINCT FROM p_tenant OR refs_current_actor() IS DISTINCT FROM p_worker THEN
    RAISE EXCEPTION 'Outbox dispatch scope denied' USING ERRCODE='42501';
  END IF;
  RETURN QUERY
  WITH candidates AS (
    SELECT outbox_event_id FROM outbox_event
    WHERE tenant_id=p_tenant AND entity_id IS NOT NULL AND refs_entity_has_permission(entity_id,'OUTBOX.DISPATCH') IS TRUE
      AND status='PENDING' AND locked_by IS NULL AND available_at<=now()
    ORDER BY created_at,outbox_event_id FOR UPDATE SKIP LOCKED LIMIT LEAST(GREATEST(p_limit,1),500)
  )
  UPDATE outbox_event o SET locked_by=p_worker,locked_at=now(),attempt_count=attempt_count+1
  FROM candidates c WHERE o.outbox_event_id=c.outbox_event_id RETURNING o.*;
END;
$$;

CREATE OR REPLACE FUNCTION refs_complete_outbox(p_tenant uuid,p_event uuid,p_worker text,p_success boolean,p_error text DEFAULT NULL)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
BEGIN
  IF refs_current_tenant() IS DISTINCT FROM p_tenant OR refs_current_actor() IS DISTINCT FROM p_worker THEN
    RAISE EXCEPTION 'Outbox dispatch scope denied' USING ERRCODE='42501';
  END IF;
  UPDATE outbox_event SET
    status=CASE WHEN p_success THEN 'PUBLISHED'::outbox_status ELSE 'FAILED'::outbox_status END,
    published_at=CASE WHEN p_success THEN now() ELSE NULL END,
    last_error=CASE WHEN p_success THEN NULL ELSE p_error END,
    locked_by=NULL,locked_at=NULL
  WHERE tenant_id=p_tenant AND outbox_event_id=p_event AND entity_id IS NOT NULL
    AND refs_entity_has_permission(entity_id,'OUTBOX.DISPATCH') IS TRUE AND locked_by=p_worker;
  IF NOT FOUND THEN RAISE EXCEPTION 'Outbox claim not owned by worker' USING ERRCODE='42501'; END IF;
END;
$$;

REVOKE ALL ON ALL TABLES IN SCHEMA public FROM refs_app;
GRANT SELECT ON tenant,entity,accounting_period,sync_cursor,import_batch,raw_event,attachment,
  source_document,source_document_line,setting_snapshot,mapping_snapshot,rule_evaluation,ai_decision,
  staging_item,accounting_exception,journal_entry,journal_line,posting_batch,ledger_line,bank_source,
  bank_match,reconciliation,source_link,idempotency_receipt,audit_event,outbox_event,account_master,member_master TO refs_app;
REVOKE ALL ON TABLE runtime_auth_context,runtime_actor_grant FROM PUBLIC,refs_app,refs_runtime,refs_context_issuer;
REVOKE EXECUTE ON FUNCTION refs_issue_context(text,uuid,text,integer) FROM PUBLIC,refs_app,refs_runtime;
REVOKE EXECUTE ON FUNCTION refs_revoke_context(text,text) FROM PUBLIC,refs_app,refs_runtime;
REVOKE EXECUTE ON FUNCTION refs_cleanup_contexts(interval) FROM PUBLIC,refs_app,refs_runtime;
REVOKE EXECUTE ON FUNCTION refs_bootstrap_context(text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION refs_current_tenant() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION refs_entity_allowed(uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION refs_has_permission(text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION refs_entity_has_permission(uuid,text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION refs_current_actor() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION refs_assert_scope(uuid,uuid,text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION refs_post_journal(uuid,uuid,uuid,uuid,bigint,text,text,text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION refs_close_period(uuid,uuid,uuid,bigint,text,text,text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION refs_claim_outbox(uuid,text,integer) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION refs_complete_outbox(uuid,uuid,text,boolean,text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION refs_reserve_idempotency(uuid,text,text,text,text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION refs_update_draft_description(uuid,uuid,uuid,bigint,text,text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION refs_bootstrap_context(text) TO refs_app;
GRANT EXECUTE ON FUNCTION refs_issue_context(text,uuid,text,integer) TO refs_context_issuer;
GRANT EXECUTE ON FUNCTION refs_revoke_context(text,text) TO refs_context_issuer;
GRANT EXECUTE ON FUNCTION refs_cleanup_contexts(interval) TO refs_context_issuer;
GRANT EXECUTE ON FUNCTION refs_current_tenant() TO refs_app;
GRANT EXECUTE ON FUNCTION refs_entity_allowed(uuid) TO refs_app;
GRANT EXECUTE ON FUNCTION refs_has_permission(text) TO refs_app;
GRANT EXECUTE ON FUNCTION refs_entity_has_permission(uuid,text) TO refs_app;
GRANT EXECUTE ON FUNCTION refs_current_actor() TO refs_app;
GRANT EXECUTE ON FUNCTION refs_assert_scope(uuid,uuid,text) TO refs_app;
GRANT EXECUTE ON FUNCTION refs_post_journal(uuid,uuid,uuid,uuid,bigint,text,text,text) TO refs_app;
GRANT EXECUTE ON FUNCTION refs_close_period(uuid,uuid,uuid,bigint,text,text,text) TO refs_app;
GRANT EXECUTE ON FUNCTION refs_claim_outbox(uuid,text,integer) TO refs_app;
GRANT EXECUTE ON FUNCTION refs_complete_outbox(uuid,uuid,text,boolean,text) TO refs_app;
GRANT EXECUTE ON FUNCTION refs_update_draft_description(uuid,uuid,uuid,bigint,text,text,text) TO refs_app;

COMMIT;
