BEGIN;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='refs_app')
    OR NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='refs_runtime')
    OR NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='refs_context_issuer')
    OR NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='refs_grant_sync')
  THEN RAISE EXCEPTION 'Platform prerequisite roles refs_app, refs_runtime, refs_context_issuer, and refs_grant_sync are required'; END IF;
END $$;

DO $$
DECLARE owner_name text;
BEGIN
  SELECT pg_get_userbyid(nspowner) INTO owner_name FROM pg_namespace WHERE nspname='public';
  IF owner_name NOT IN (current_user,'pg_database_owner') THEN
    RAISE EXCEPTION 'public schema owner % is not trusted for SECURITY DEFINER functions',owner_name;
  END IF;
END;
$$;
CREATE TABLE refs_runtime_migration_state (
  singleton boolean PRIMARY KEY DEFAULT true CHECK(singleton),
  public_create_was_granted boolean NOT NULL,
  public_usage_was_granted boolean NOT NULL,
  refs_app_usage_was_granted boolean NOT NULL,
  issuer_usage_was_granted boolean NOT NULL,
  grant_sync_usage_was_granted boolean NOT NULL
);
INSERT INTO refs_runtime_migration_state(public_create_was_granted,public_usage_was_granted,refs_app_usage_was_granted,issuer_usage_was_granted,grant_sync_usage_was_granted)
SELECT COALESCE(bool_or(grantee=0 AND privilege_type='CREATE'),false),
  COALESCE(bool_or(grantee=0 AND privilege_type='USAGE'),false),
  COALESCE(bool_or(grantee=(SELECT oid FROM pg_roles WHERE rolname='refs_app') AND privilege_type='USAGE'),false),
  COALESCE(bool_or(grantee=(SELECT oid FROM pg_roles WHERE rolname='refs_context_issuer') AND privilege_type='USAGE'),false),
  COALESCE(bool_or(grantee=(SELECT oid FROM pg_roles WHERE rolname='refs_grant_sync') AND privilege_type='USAGE'),false)
FROM pg_namespace n, LATERAL aclexplode(COALESCE(n.nspacl,acldefault('n',n.nspowner)))
WHERE n.nspname='public';
REVOKE CREATE ON SCHEMA public FROM PUBLIC;
GRANT USAGE ON SCHEMA public TO refs_app,refs_context_issuer,refs_grant_sync;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_roles
    WHERE rolcanlogin AND NOT rolsuper AND rolname<>current_user
      AND has_schema_privilege(rolname,'public','CREATE')
  ) THEN RAISE EXCEPTION 'An untrusted login retains CREATE on public schema'; END IF;
END;
$$;

CREATE TABLE account_master (
  tenant_id uuid NOT NULL,
  entity_id uuid NOT NULL,
  account_code text NOT NULL,
  account_name text NOT NULL,
  requires_member boolean NOT NULL DEFAULT false,
  required_member_type text,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((requires_member AND required_member_type IN ('BANK','VENDOR','CUSTOMER','AFFILIATE','CUSTOMER_OR_AFFILIATE')) OR (NOT requires_member AND required_member_type IS NULL)),
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
DECLARE account_requires_member boolean; account_required_member_type text; actual_member_type text;
BEGIN
  SELECT requires_member,required_member_type INTO account_requires_member,account_required_member_type
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
  IF NEW.member_ref IS NOT NULL THEN
    SELECT member_type INTO actual_member_type FROM member_master
    WHERE tenant_id=NEW.tenant_id AND entity_id=NEW.entity_id
      AND member_ref=NEW.member_ref AND active;
  END IF;
  IF NEW.member_ref IS NOT NULL AND actual_member_type IS NULL THEN
    RAISE EXCEPTION 'Member is absent, inactive, or outside the JE entity' USING ERRCODE='23503';
  END IF;
  IF account_requires_member AND NOT (
    actual_member_type=account_required_member_type OR
    (account_required_member_type='CUSTOMER_OR_AFFILIATE' AND actual_member_type IN ('CUSTOMER','AFFILIATE'))
  ) THEN
    RAISE EXCEPTION 'Member type % is invalid for account %, expected %',COALESCE(actual_member_type,'NULL'),NEW.account_code,account_required_member_type USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER journal_line_master_guard
  BEFORE INSERT OR UPDATE OF tenant_id, entity_id, account_code, member_ref ON journal_line
  FOR EACH ROW EXECUTE FUNCTION refs_validate_journal_line_master();

CREATE OR REPLACE FUNCTION refs_jsonb_hash(value jsonb) RETURNS text
LANGUAGE sql IMMUTABLE SET search_path=pg_catalog,public,pg_temp AS $$
  SELECT 'sha256:'||encode(digest(convert_to(value::text,'UTF8'),'sha256'),'hex')
$$;

CREATE OR REPLACE FUNCTION refs_rule_evaluation_hash(
  p_source_document uuid,p_setting uuid,p_mapping uuid,p_rule_code text,p_rule_version bigint,
  p_matched_facts jsonb,p_result jsonb,p_input_digest text
) RETURNS text
LANGUAGE sql IMMUTABLE SET search_path=pg_catalog,public,pg_temp AS $$
  SELECT refs_jsonb_hash(jsonb_build_object(
    'source_document_id',p_source_document,'setting_snapshot_id',p_setting,'mapping_snapshot_id',p_mapping,
    'rule_code',p_rule_code,'rule_version',p_rule_version,'matched_facts',p_matched_facts,
    'result',p_result,'input_digest',p_input_digest
  ))
$$;

ALTER TABLE rule_evaluation ADD COLUMN evaluation_digest text CHECK (evaluation_digest ~ '^sha256:[0-9a-f]{64}$');
ALTER TABLE setting_snapshot
  ADD COLUMN lifecycle_revision bigint NOT NULL DEFAULT 0 CHECK (lifecycle_revision>=0),
  ADD COLUMN retired_by text,
  ADD COLUMN retired_at timestamptz,
  ADD COLUMN retire_reason text,
  ADD CONSTRAINT setting_retirement_metadata CHECK (
    (status='RETIRED' AND retired_by IS NOT NULL AND retired_at IS NOT NULL AND length(btrim(retire_reason))>=8)
    OR (status<>'RETIRED' AND retired_by IS NULL AND retired_at IS NULL AND retire_reason IS NULL)
  );
ALTER TABLE mapping_snapshot
  ADD COLUMN lifecycle_revision bigint NOT NULL DEFAULT 0 CHECK (lifecycle_revision>=0),
  ADD COLUMN retired_by text,
  ADD COLUMN retired_at timestamptz,
  ADD COLUMN retire_reason text,
  ADD CONSTRAINT mapping_retirement_metadata CHECK (
    (status='RETIRED' AND retired_by IS NOT NULL AND retired_at IS NOT NULL AND length(btrim(retire_reason))>=8)
    OR (status<>'RETIRED' AND retired_by IS NULL AND retired_at IS NULL AND retire_reason IS NULL)
  );

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM setting_snapshot WHERE status='APPROVED' AND (
    approved_by IS NULL OR approved_at IS NULL OR approved_by=created_by OR snapshot_hash<>refs_jsonb_hash(snapshot)
  )) THEN RAISE EXCEPTION 'Legacy approved setting snapshot failed canonical validation'; END IF;
  IF EXISTS (SELECT 1 FROM mapping_snapshot WHERE status='APPROVED' AND (
    approved_by IS NULL OR approved_at IS NULL OR approved_by=created_by OR snapshot_hash<>refs_jsonb_hash(jsonb_build_object('input_keys',input_keys,'output_rules',output_rules))
  )) THEN RAISE EXCEPTION 'Legacy approved mapping snapshot failed canonical validation'; END IF;
  IF EXISTS (SELECT 1 FROM rule_evaluation WHERE evaluation_digest IS NULL) THEN
    RAISE EXCEPTION 'Legacy rule evaluation has no verifiable canonical digest';
  END IF;
END $$;
ALTER TABLE rule_evaluation ALTER COLUMN evaluation_digest SET NOT NULL;

CREATE OR REPLACE FUNCTION refs_validate_setting_snapshot() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog,public,pg_temp AS $$
BEGIN
  IF NEW.status='APPROVED' THEN
    IF NEW.approved_by IS NULL OR NEW.approved_at IS NULL OR NEW.approved_by=NEW.created_by THEN
      RAISE EXCEPTION 'Approved configuration requires a distinct approver' USING ERRCODE='23514';
    END IF;
    IF NEW.snapshot_hash<>refs_jsonb_hash(NEW.snapshot) THEN
      RAISE EXCEPTION 'Approved configuration snapshot hash mismatch' USING ERRCODE='23514';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION refs_validate_mapping_snapshot() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog,public,pg_temp AS $$
BEGIN
  IF NEW.status='APPROVED' THEN
    IF NEW.approved_by IS NULL OR NEW.approved_at IS NULL OR NEW.approved_by=NEW.created_by THEN
      RAISE EXCEPTION 'Approved configuration requires a distinct approver' USING ERRCODE='23514';
    END IF;
    IF NEW.snapshot_hash<>refs_jsonb_hash(jsonb_build_object('input_keys',NEW.input_keys,'output_rules',NEW.output_rules)) THEN
      RAISE EXCEPTION 'Approved configuration snapshot hash mismatch' USING ERRCODE='23514';
    END IF;
    IF EXISTS (
      SELECT 1 FROM mapping_snapshot prior
      JOIN rule_evaluation re ON re.tenant_id=prior.tenant_id AND re.mapping_snapshot_id=prior.mapping_snapshot_id
      JOIN source_document sd ON sd.tenant_id=re.tenant_id AND sd.source_document_id=re.source_document_id
      WHERE prior.tenant_id=NEW.tenant_id AND prior.family=NEW.family AND prior.scope_type=NEW.scope_type
        AND prior.scope_key=NEW.scope_key AND prior.input_key_hash=NEW.input_key_hash
        AND prior.mapping_snapshot_id<>NEW.mapping_snapshot_id
        AND prior.status IN ('APPROVED','RETIRED') AND prior.priority<NEW.priority
        AND (sd.accounting_date::timestamp AT TIME ZONE 'UTC')>=NEW.effective_from
        AND (NEW.effective_to IS NULL OR (sd.accounting_date::timestamp AT TIME ZONE 'UTC')<NEW.effective_to)
        AND (sd.accounting_date::timestamp AT TIME ZONE 'UTC')>=prior.effective_from
        AND (prior.effective_to IS NULL OR (sd.accounting_date::timestamp AT TIME ZONE 'UTC')<prior.effective_to)
    ) THEN
      RAISE EXCEPTION 'Mapping approval would retroactively change historical rule evidence' USING ERRCODE='23514';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION refs_protect_approved_config() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog,public,pg_temp AS $$
BEGIN
  IF OLD.status='RETIRED' OR (TG_OP='DELETE' AND OLD.status='APPROVED') THEN
    RAISE EXCEPTION 'Approved and retired configuration snapshots are immutable' USING ERRCODE='55000';
  END IF;
  IF OLD.status='APPROVED' THEN
    IF current_setting('refs.config_retire',true)<>'authorized'
      OR NEW.status<>'RETIRED' OR NEW.lifecycle_revision<>OLD.lifecycle_revision+1
      OR NEW.retired_by IS NULL OR NEW.retired_at IS NULL OR length(btrim(NEW.retire_reason))<8
      OR NEW.effective_to IS NULL OR NEW.effective_to<=OLD.effective_from
      OR (OLD.effective_to IS NOT NULL AND NEW.effective_to>OLD.effective_to)
      OR (NEW.tenant_id,NEW.entity_id,NEW.family,NEW.scope_type,NEW.scope_key,NEW.version,NEW.effective_from,
          NEW.snapshot_hash,NEW.created_by,NEW.approved_by,NEW.approved_at)
         IS DISTINCT FROM
         (OLD.tenant_id,OLD.entity_id,OLD.family,OLD.scope_type,OLD.scope_key,OLD.version,OLD.effective_from,
          OLD.snapshot_hash,OLD.created_by,OLD.approved_by,OLD.approved_at)
    THEN RAISE EXCEPTION 'Approved configuration snapshots are immutable outside controlled retirement' USING ERRCODE='55000'; END IF;
    IF TG_TABLE_NAME='setting_snapshot' THEN
      IF NEW.snapshot IS DISTINCT FROM OLD.snapshot THEN
        RAISE EXCEPTION 'Approved setting payload is immutable' USING ERRCODE='55000';
      END IF;
    ELSE
      IF (NEW.input_key_hash,NEW.priority,NEW.input_keys,NEW.output_rules)
        IS DISTINCT FROM (OLD.input_key_hash,OLD.priority,OLD.input_keys,OLD.output_rules) THEN
        RAISE EXCEPTION 'Approved mapping payload is immutable' USING ERRCODE='55000';
      END IF;
    END IF;
  END IF;
  RETURN CASE WHEN TG_OP='DELETE' THEN OLD ELSE NEW END;
END;
$$;

CREATE OR REPLACE FUNCTION refs_protect_rule_evaluation() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog,public,pg_temp AS $$
BEGIN
  RAISE EXCEPTION 'Rule evaluations are append-only' USING ERRCODE='55000';
END;
$$;

CREATE OR REPLACE FUNCTION refs_validate_rule_evaluation_digest() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog,public,pg_temp AS $$
BEGIN
  IF NEW.evaluation_digest<>refs_rule_evaluation_hash(NEW.source_document_id,NEW.setting_snapshot_id,NEW.mapping_snapshot_id,NEW.rule_code,NEW.rule_version,NEW.matched_facts,NEW.result,NEW.input_digest)
  THEN RAISE EXCEPTION 'Rule evaluation canonical digest mismatch' USING ERRCODE='23514'; END IF;
  IF NOT EXISTS (
    SELECT 1 FROM source_document sd
    JOIN setting_snapshot ss ON ss.tenant_id=NEW.tenant_id AND ss.setting_snapshot_id=NEW.setting_snapshot_id
    JOIN mapping_snapshot ms ON ms.tenant_id=NEW.tenant_id AND ms.mapping_snapshot_id=NEW.mapping_snapshot_id
    WHERE sd.tenant_id=NEW.tenant_id AND sd.source_document_id=NEW.source_document_id
      AND ss.status='APPROVED' AND ms.status='APPROVED'
      AND (sd.accounting_date::timestamp AT TIME ZONE 'UTC')>=ss.effective_from
      AND (ss.effective_to IS NULL OR (sd.accounting_date::timestamp AT TIME ZONE 'UTC')<ss.effective_to)
      AND (sd.accounting_date::timestamp AT TIME ZONE 'UTC')>=ms.effective_from
      AND (ms.effective_to IS NULL OR (sd.accounting_date::timestamp AT TIME ZONE 'UTC')<ms.effective_to)
      AND NEW.evaluated_at>=ss.effective_from AND (ss.effective_to IS NULL OR NEW.evaluated_at<ss.effective_to)
      AND NEW.evaluated_at>=ms.effective_from AND (ms.effective_to IS NULL OR NEW.evaluated_at<ms.effective_to)
      AND ss.snapshot_hash=refs_jsonb_hash(ss.snapshot)
      AND ms.snapshot_hash=refs_jsonb_hash(jsonb_build_object('input_keys',ms.input_keys,'output_rules',ms.output_rules))
  ) THEN RAISE EXCEPTION 'Rule evaluation requires effective APPROVED canonical snapshots' USING ERRCODE='23514'; END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER setting_snapshot_approval_guard BEFORE INSERT OR UPDATE ON setting_snapshot
  FOR EACH ROW EXECUTE FUNCTION refs_validate_setting_snapshot();
CREATE TRIGGER mapping_snapshot_approval_guard BEFORE INSERT OR UPDATE ON mapping_snapshot
  FOR EACH ROW EXECUTE FUNCTION refs_validate_mapping_snapshot();
CREATE TRIGGER setting_snapshot_approved_immutable BEFORE UPDATE OR DELETE ON setting_snapshot
  FOR EACH ROW EXECUTE FUNCTION refs_protect_approved_config();
CREATE TRIGGER mapping_snapshot_approved_immutable BEFORE UPDATE OR DELETE ON mapping_snapshot
  FOR EACH ROW EXECUTE FUNCTION refs_protect_approved_config();
CREATE TRIGGER rule_evaluation_append_only BEFORE UPDATE OR DELETE ON rule_evaluation
  FOR EACH ROW EXECUTE FUNCTION refs_protect_rule_evaluation();
CREATE TRIGGER rule_evaluation_digest_guard BEFORE INSERT OR UPDATE ON rule_evaluation
  FOR EACH ROW EXECUTE FUNCTION refs_validate_rule_evaluation_digest();

ALTER TABLE setting_snapshot ADD CONSTRAINT setting_approved_scope_no_overlap
  EXCLUDE USING gist (
    tenant_id WITH =, family WITH =, scope_type WITH =, scope_key WITH =,
    tstzrange(effective_from,COALESCE(effective_to,'infinity'::timestamptz),'[)') WITH &&
  ) WHERE (status IN ('APPROVED','RETIRED'));

ALTER TABLE mapping_snapshot DROP CONSTRAINT mapping_approved_equal_priority_no_overlap;
ALTER TABLE mapping_snapshot ADD CONSTRAINT mapping_approved_equal_priority_no_overlap
  EXCLUDE USING gist (
    tenant_id WITH =,family WITH =,scope_type WITH =,scope_key WITH =,input_key_hash WITH =,priority WITH =,
    tstzrange(effective_from,COALESCE(effective_to,'infinity'::timestamptz),'[)') WITH &&
  ) WHERE (status IN ('APPROVED','RETIRED'));

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

CREATE TABLE permission_catalog (
  permission_code text PRIMARY KEY CHECK (permission_code ~ '^[A-Z][A-Z0-9_.]+$'),
  domain text NOT NULL CHECK (domain ~ '^[A-Z][A-Z0-9_]+$'),
  active boolean NOT NULL DEFAULT true,
  risk_class text NOT NULL CHECK (risk_class IN ('LOW','MEDIUM','HIGH','CRITICAL')),
  sod_class text NOT NULL,
  version bigint NOT NULL DEFAULT 1 CHECK (version>0),
  effective_from timestamptz NOT NULL DEFAULT now(),
  effective_to timestamptz,
  CHECK (effective_to IS NULL OR effective_to>effective_from)
);
INSERT INTO permission_catalog(permission_code,domain,risk_class,sod_class) VALUES
  ('GL.JE.CREATE','GL','HIGH','JE_MAKER'),
  ('GL.JE.SUBMIT','GL','HIGH','JE_MAKER'),
  ('GL.JE.REVIEW','GL','HIGH','JE_REVIEW'),
  ('GL.JE.APPROVE','GL','CRITICAL','JE_APPROVE'),
  ('GL.JE.REJECT','GL','HIGH','JE_REVIEW'),
  ('GL.JE.POST','GL','CRITICAL','JE_POST'),
  ('GL.JE.EDIT','GL','HIGH','JE_MAKER'),
  ('GL.PERIOD.CLOSE','GL','CRITICAL','PERIOD_CLOSE'),
  ('OUTBOX.DISPATCH','PLATFORM','HIGH','OUTBOX_WORKER'),
  ('AP.VIEW','AP','LOW','READ'),
  ('AR.VIEW','AR','LOW','READ'),
  ('BANK.AUTOREC.MANAGE','BANK','CRITICAL','AUTOREC_MANAGER'),
  ('BANK.AUTOREC.SYNC','BANK','HIGH','AUTOREC_SYNC'),
  ('CONFIG.SNAPSHOT.RETIRE','CONFIG','CRITICAL','CONFIG_RETIRE');
ALTER TABLE runtime_actor_grant ADD FOREIGN KEY(permission) REFERENCES permission_catalog(permission_code);

CREATE TABLE runtime_actor_grant_set (
  tenant_id uuid NOT NULL,
  actor_id text NOT NULL CHECK (length(btrim(actor_id))>0),
  entity_id uuid NOT NULL,
  version bigint NOT NULL DEFAULT 0 CHECK (version>=0),
  updated_by text NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id,actor_id,entity_id),
  FOREIGN KEY (tenant_id,entity_id) REFERENCES entity(tenant_id,entity_id)
);

CREATE TABLE runtime_grant_sync_receipt (
  grant_sync_receipt_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant(tenant_id),
  actor_id text NOT NULL,
  entity_id uuid NOT NULL,
  idempotency_key text NOT NULL CHECK (length(idempotency_key) BETWEEN 8 AND 200),
  request_hash text NOT NULL CHECK (request_hash ~ '^sha256:[0-9a-f]{64}$'),
  response_body jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  UNIQUE (tenant_id,actor_id,entity_id,idempotency_key),
  FOREIGN KEY (tenant_id,entity_id) REFERENCES entity(tenant_id,entity_id)
);

CREATE OR REPLACE FUNCTION refs_grant_request_hash(
  p_tenant uuid,p_actor text,p_entity uuid,p_permissions text[],p_expected_version bigint
) RETURNS text
LANGUAGE sql IMMUTABLE SET search_path=pg_catalog,public,pg_temp AS $$
  SELECT 'sha256:'||encode(digest(convert_to(jsonb_build_object(
    'tenant_id',p_tenant,'actor_id',p_actor,'entity_id',p_entity,
    'permissions',to_jsonb((SELECT COALESCE(array_agg(DISTINCT permission ORDER BY permission),'{}'::text[]) FROM unnest(COALESCE(p_permissions,'{}'::text[])) permission)),
    'expected_version',p_expected_version
  )::text,'UTF8'),'sha256'),'hex')
$$;

CREATE OR REPLACE FUNCTION refs_reconcile_actor_grants(
  p_tenant uuid,p_actor text,p_entity uuid,p_permissions text[],p_expected_version bigint,
  p_idempotency_key text,p_request_hash text
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE grant_set runtime_actor_grant_set; receipt runtime_grant_sync_receipt; response jsonb;
DECLARE normalized text[]; computed_hash text; event_payload jsonb;
BEGIN
  IF session_user<>'refs_grant_sync' THEN RAISE EXCEPTION 'Grant sync identity denied' USING ERRCODE='42501'; END IF;
  IF length(btrim(p_actor))=0 OR p_expected_version<0 THEN RAISE EXCEPTION 'Invalid grant subject or version' USING ERRCODE='22023'; END IF;
  IF NOT EXISTS (SELECT 1 FROM entity WHERE tenant_id=p_tenant AND entity_id=p_entity AND active) THEN
    RAISE EXCEPTION 'Grant entity is absent or outside tenant' USING ERRCODE='42501';
  END IF;
  SELECT COALESCE(array_agg(DISTINCT permission ORDER BY permission),'{}'::text[]) INTO normalized FROM unnest(COALESCE(p_permissions,'{}'::text[])) permission;
  IF EXISTS (SELECT 1 FROM unnest(normalized) requested LEFT JOIN permission_catalog pc ON pc.permission_code=requested
    WHERE pc.permission_code IS NULL OR NOT pc.active OR pc.effective_from>clock_timestamp() OR (pc.effective_to IS NOT NULL AND pc.effective_to<=clock_timestamp())) THEN
    RAISE EXCEPTION 'Unknown or inactive permission in desired grant set' USING ERRCODE='22023';
  END IF;
  computed_hash:=refs_grant_request_hash(p_tenant,p_actor,p_entity,normalized,p_expected_version);
  IF p_request_hash<>computed_hash THEN RAISE EXCEPTION 'Grant request hash is not canonical' USING ERRCODE='22023'; END IF;
  INSERT INTO runtime_grant_sync_receipt(tenant_id,actor_id,entity_id,idempotency_key,request_hash)
    VALUES(p_tenant,p_actor,p_entity,p_idempotency_key,p_request_hash) ON CONFLICT DO NOTHING;
  SELECT * INTO receipt FROM runtime_grant_sync_receipt WHERE tenant_id=p_tenant AND actor_id=p_actor AND entity_id=p_entity AND idempotency_key=p_idempotency_key FOR UPDATE;
  IF receipt.request_hash<>p_request_hash THEN RAISE EXCEPTION 'Grant idempotency key reused with different request' USING ERRCODE='23505'; END IF;
  IF receipt.completed_at IS NOT NULL THEN RETURN receipt.response_body||jsonb_build_object('idempotent',true); END IF;
  INSERT INTO runtime_actor_grant_set(tenant_id,actor_id,entity_id,version,updated_by)
    VALUES(p_tenant,p_actor,p_entity,0,session_user) ON CONFLICT DO NOTHING;
  SELECT * INTO grant_set FROM runtime_actor_grant_set WHERE tenant_id=p_tenant AND actor_id=p_actor AND entity_id=p_entity FOR UPDATE;
  IF grant_set.version<>p_expected_version THEN RAISE EXCEPTION 'Grant set revision conflict' USING ERRCODE='40001'; END IF;
  UPDATE runtime_actor_grant SET revoked_at=clock_timestamp()
    WHERE tenant_id=p_tenant AND actor_id=p_actor AND entity_id=p_entity AND revoked_at IS NULL AND NOT (permission=ANY(normalized));
  INSERT INTO runtime_actor_grant(tenant_id,actor_id,entity_id,permission,revoked_at)
    SELECT p_tenant,p_actor,p_entity,permission,NULL FROM unnest(normalized) permission
    ON CONFLICT (tenant_id,actor_id,entity_id,permission) DO UPDATE SET revoked_at=NULL,valid_until=NULL;
  UPDATE runtime_actor_grant_set SET version=version+1,updated_by=session_user,updated_at=clock_timestamp()
    WHERE tenant_id=p_tenant AND actor_id=p_actor AND entity_id=p_entity;
  response:=jsonb_build_object('tenant_id',p_tenant,'actor_id',p_actor,'entity_id',p_entity,'permissions',to_jsonb(normalized),'version',p_expected_version+1,'idempotent',false);
  INSERT INTO audit_event(tenant_id,entity_id,event_type,object_type,object_id,action,actor_id,actor_type,permission_used,request_id,correlation_id,idempotency_key,after_hash,metadata)
    VALUES(p_tenant,p_entity,'ACTOR_GRANTS_RECONCILED','RUNTIME_ACTOR_GRANT',p_entity,'RECONCILE',session_user,'SERVICE_ACCOUNT','AUTH.GRANT.SYNC',p_idempotency_key,p_idempotency_key,p_idempotency_key,p_request_hash,jsonb_build_object('subject_actor_id',p_actor,'desired_permissions',to_jsonb(normalized),'version',p_expected_version+1));
  event_payload:=jsonb_build_object('actor_id',p_actor,'entity_id',p_entity,'permissions',to_jsonb(normalized),'version',p_expected_version+1);
  INSERT INTO outbox_event(tenant_id,entity_id,aggregate_type,aggregate_id,event_type,payload,payload_hash)
    VALUES(p_tenant,p_entity,'RUNTIME_ACTOR_GRANT',p_entity,'ACTOR_GRANTS_RECONCILED',event_payload,'sha256:'||encode(digest(convert_to(event_payload::text,'UTF8'),'sha256'),'hex'));
  UPDATE runtime_grant_sync_receipt SET response_body=response,completed_at=clock_timestamp() WHERE grant_sync_receipt_id=receipt.grant_sync_receipt_id;
  RETURN response;
END;
$$;

CREATE OR REPLACE FUNCTION refs_issue_context(p_actor text,p_tenant uuid,p_token_hash text,p_ttl_seconds integer DEFAULT 300)
RETURNS runtime_auth_context
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE issued runtime_auth_context; allowed_grants jsonb;
BEGIN
  IF session_user<>'refs_context_issuer' THEN RAISE EXCEPTION 'Context issuer identity denied' USING ERRCODE='42501'; END IF;
  IF p_token_hash!~'^sha256:[0-9a-f]{64}$' OR p_ttl_seconds<30 OR p_ttl_seconds>300 THEN
    RAISE EXCEPTION 'Invalid context token hash or TTL' USING ERRCODE='22023';
  END IF;
  SELECT jsonb_agg(jsonb_build_object('entity_id',g.entity_id,'permission',g.permission) ORDER BY g.entity_id,g.permission)
    INTO allowed_grants FROM runtime_actor_grant g JOIN permission_catalog pc ON pc.permission_code=g.permission
    WHERE g.tenant_id=p_tenant AND g.actor_id=p_actor AND g.revoked_at IS NULL
      AND (g.valid_until IS NULL OR g.valid_until>clock_timestamp())
      AND pc.active AND pc.effective_from<=clock_timestamp() AND (pc.effective_to IS NULL OR pc.effective_to>clock_timestamp());
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
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
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
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
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
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
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
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
  SELECT tenant_id FROM runtime_auth_context
  WHERE token_hash=current_setting('refs.context_hash',true)
    AND bound_login=session_user AND bound_backend_pid=pg_backend_pid() AND bound_txid=txid_current()
    AND revoked_at IS NULL AND expires_at>clock_timestamp()
$$;

CREATE OR REPLACE FUNCTION refs_entity_allowed(candidate uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
  SELECT COALESCE(EXISTS(
    SELECT 1 FROM runtime_auth_context
    WHERE token_hash=current_setting('refs.context_hash',true)
      AND bound_login=session_user AND bound_backend_pid=pg_backend_pid() AND bound_txid=txid_current()
      AND revoked_at IS NULL AND expires_at>clock_timestamp()
      AND EXISTS (SELECT 1 FROM jsonb_array_elements(grants) g WHERE (g->>'entity_id')::uuid=candidate)
  ),false)
$$;

CREATE OR REPLACE FUNCTION refs_has_permission(required_permission text) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
  SELECT COALESCE(EXISTS(
    SELECT 1 FROM runtime_auth_context
    WHERE token_hash=current_setting('refs.context_hash',true)
      AND bound_login=session_user AND bound_backend_pid=pg_backend_pid() AND bound_txid=txid_current()
      AND revoked_at IS NULL AND expires_at>clock_timestamp()
      AND EXISTS (SELECT 1 FROM jsonb_array_elements(grants) g WHERE g->>'permission' IN (required_permission,'*'))
  ),false)
$$;

CREATE OR REPLACE FUNCTION refs_entity_has_permission(candidate uuid,required_permission text) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
  SELECT COALESCE(EXISTS(
    SELECT 1 FROM runtime_auth_context c, LATERAL jsonb_array_elements(c.grants) g
    WHERE c.token_hash=current_setting('refs.context_hash',true)
      AND c.bound_login=session_user AND c.bound_backend_pid=pg_backend_pid() AND c.bound_txid=txid_current()
      AND c.revoked_at IS NULL AND c.expires_at>clock_timestamp()
      AND (g->>'entity_id')::uuid=candidate AND g->>'permission' IN (required_permission,'*')
  ),false)
$$;

CREATE OR REPLACE FUNCTION refs_current_actor() RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
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

ALTER TABLE sync_cursor ADD COLUMN entity_id uuid;
ALTER TABLE import_batch ADD COLUMN entity_id uuid;
ALTER TABLE raw_event ADD COLUMN entity_id uuid;
UPDATE sync_cursor sc SET entity_id=e.entity_id FROM entity e
  WHERE e.tenant_id=sc.tenant_id AND e.source_entity_id=sc.source_entity_id
    AND NOT EXISTS (SELECT 1 FROM entity other WHERE other.tenant_id=e.tenant_id AND other.source_entity_id=e.source_entity_id AND other.entity_id<>e.entity_id);
UPDATE import_batch ib SET entity_id=e.entity_id FROM entity e
  WHERE e.tenant_id=ib.tenant_id AND e.source_entity_id=ib.source_entity_id
    AND NOT EXISTS (SELECT 1 FROM entity other WHERE other.tenant_id=e.tenant_id AND other.source_entity_id=e.source_entity_id AND other.entity_id<>e.entity_id);
UPDATE raw_event re SET entity_id=e.entity_id FROM entity e
  WHERE e.tenant_id=re.tenant_id AND e.source_system=re.source_system AND e.source_entity_id=re.source_entity_id;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM sync_cursor WHERE entity_id IS NULL)
    OR EXISTS (SELECT 1 FROM import_batch WHERE entity_id IS NULL)
    OR EXISTS (SELECT 1 FROM raw_event WHERE entity_id IS NULL)
  THEN RAISE EXCEPTION 'Ingestion rows cannot be mapped to one exact entity'; END IF;
END $$;
ALTER TABLE sync_cursor ALTER COLUMN entity_id SET NOT NULL,
  ADD FOREIGN KEY (tenant_id,entity_id) REFERENCES entity(tenant_id,entity_id);
ALTER TABLE import_batch ALTER COLUMN entity_id SET NOT NULL,
  ADD FOREIGN KEY (tenant_id,entity_id) REFERENCES entity(tenant_id,entity_id);
ALTER TABLE raw_event ALTER COLUMN entity_id SET NOT NULL,
  ADD FOREIGN KEY (tenant_id,entity_id) REFERENCES entity(tenant_id,entity_id);

DO $$
DECLARE table_name text;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='refs_app') OR NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='refs_runtime') OR NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='refs_context_issuer') OR NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='refs_grant_sync') THEN
    RAISE EXCEPTION 'Platform prerequisite roles refs_app, refs_runtime, refs_context_issuer, and refs_grant_sync are required';
  END IF;
  FOREACH table_name IN ARRAY ARRAY[
    'tenant','entity','accounting_period','attachment',
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

ALTER TABLE sync_cursor ENABLE ROW LEVEL SECURITY;
ALTER TABLE import_batch ENABLE ROW LEVEL SECURITY;
ALTER TABLE raw_event ENABLE ROW LEVEL SECURITY;
CREATE POLICY sync_cursor_source_scope_policy ON sync_cursor
  USING (tenant_id=refs_current_tenant() AND refs_entity_allowed(entity_id))
  WITH CHECK (tenant_id=refs_current_tenant() AND refs_entity_allowed(entity_id));
CREATE POLICY import_batch_source_scope_policy ON import_batch
  USING (tenant_id=refs_current_tenant() AND refs_entity_allowed(entity_id))
  WITH CHECK (tenant_id=refs_current_tenant() AND refs_entity_allowed(entity_id));
CREATE POLICY raw_event_source_scope_policy ON raw_event
  USING (tenant_id=refs_current_tenant() AND refs_entity_allowed(entity_id))
  WITH CHECK (tenant_id=refs_current_tenant() AND refs_entity_allowed(entity_id));

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
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE receipt idempotency_receipt;
BEGIN
  IF refs_current_tenant() IS DISTINCT FROM p_tenant THEN
    RAISE EXCEPTION 'Idempotency tenant scope denied' USING ERRCODE='42501';
  END IF;
  IF refs_current_actor() IS DISTINCT FROM p_actor THEN
    RAISE EXCEPTION 'Actor must come from the authenticated session' USING ERRCODE='42501';
  END IF;
  IF p_scope NOT LIKE 'POST_JOURNAL:%' AND p_scope NOT LIKE 'EDIT_JOURNAL:%' AND p_scope NOT LIKE 'CLOSE_PERIOD:%'
    AND p_scope NOT LIKE 'RETIRE_CONFIG:%' AND p_scope NOT LIKE 'CREATE_MANUAL_JOURNAL:%'
    AND p_scope NOT LIKE 'JOURNAL_SUBMIT:%' AND p_scope NOT LIKE 'JOURNAL_REVIEW:%'
    AND p_scope NOT LIKE 'JOURNAL_APPROVE:%' AND p_scope NOT LIKE 'JOURNAL_REJECT:%' THEN
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

CREATE OR REPLACE FUNCTION refs_config_retire_hash(
  p_kind text,p_tenant uuid,p_entity uuid,p_snapshot uuid,p_expected_revision bigint,p_cutoff timestamptz,p_reason text
) RETURNS text
LANGUAGE sql IMMUTABLE SET search_path=pg_catalog,public,pg_temp AS $$
  SELECT refs_jsonb_hash(jsonb_build_object(
    'kind',upper(p_kind),'tenant_id',p_tenant,'entity_id',p_entity,'snapshot_id',p_snapshot,
    'expected_revision',p_expected_revision,'cutoff',p_cutoff,'reason',btrim(p_reason)
  ))
$$;

CREATE OR REPLACE FUNCTION refs_retire_config_snapshot(
  p_kind text,p_tenant uuid,p_entity uuid,p_snapshot uuid,p_expected_revision bigint,p_cutoff timestamptz,
  p_reason text,p_idempotency_key text,p_request_hash text
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE actor text:=refs_current_actor(); receipt idempotency_receipt; response jsonb; event_payload jsonb;
DECLARE current_status text; current_created_by text; current_approved_by text; current_effective_from timestamptz;
DECLARE current_effective_to timestamptz; current_revision bigint; computed_hash text; kind text:=upper(p_kind);
BEGIN
  PERFORM refs_assert_scope(p_tenant,p_entity,'CONFIG.SNAPSHOT.RETIRE');
  IF actor IS NULL THEN RAISE EXCEPTION 'Authenticated actor missing' USING ERRCODE='42501'; END IF;
  IF kind NOT IN ('SETTING','MAPPING') OR p_expected_revision<0 OR length(btrim(p_reason))<8 THEN
    RAISE EXCEPTION 'Invalid configuration retirement request' USING ERRCODE='22023';
  END IF;
  computed_hash:=refs_config_retire_hash(kind,p_tenant,p_entity,p_snapshot,p_expected_revision,p_cutoff,p_reason);
  IF p_request_hash<>computed_hash THEN RAISE EXCEPTION 'Retirement request hash is not canonical' USING ERRCODE='22023'; END IF;
  receipt:=refs_reserve_idempotency(p_tenant,'RETIRE_CONFIG:'||p_entity,p_idempotency_key,p_request_hash,actor);
  IF receipt.status='SUCCEEDED' THEN RETURN receipt.response_body||jsonb_build_object('idempotent',true); END IF;
  IF p_cutoff IS DISTINCT FROM (date_trunc('day',p_cutoff AT TIME ZONE 'UTC') AT TIME ZONE 'UTC') THEN
    RAISE EXCEPTION 'Retirement cutoff must be a UTC accounting-date boundary' USING ERRCODE='22023';
  END IF;
  IF p_cutoff<=(date_trunc('day',clock_timestamp() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC') THEN
    RAISE EXCEPTION 'Configuration retirement requires at least the next UTC accounting-date boundary' USING ERRCODE='22023';
  END IF;
  PERFORM 1 FROM accounting_period WHERE tenant_id=p_tenant AND entity_id=p_entity
    AND (p_cutoff AT TIME ZONE 'UTC')::date BETWEEN starts_on AND ends_on AND status='OPEN' FOR SHARE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Retirement cutoff must belong to an OPEN configured period' USING ERRCODE='55000';
  END IF;
  IF (kind='SETTING' AND EXISTS (SELECT 1 FROM setting_snapshot WHERE tenant_id=p_tenant AND setting_snapshot_id=p_snapshot AND entity_id IS NULL))
    OR (kind='MAPPING' AND EXISTS (SELECT 1 FROM mapping_snapshot WHERE tenant_id=p_tenant AND mapping_snapshot_id=p_snapshot AND entity_id IS NULL)) THEN
    RAISE EXCEPTION 'TENANT and SHARED_TEMPLATE retirement scope is not supported by the entity command' USING ERRCODE='0A000';
  END IF;

  IF kind='SETTING' THEN
    SELECT status,created_by,approved_by,effective_from,effective_to,lifecycle_revision
      INTO current_status,current_created_by,current_approved_by,current_effective_from,current_effective_to,current_revision
      FROM setting_snapshot WHERE tenant_id=p_tenant AND entity_id=p_entity AND setting_snapshot_id=p_snapshot FOR UPDATE;
  ELSE
    SELECT status,created_by,approved_by,effective_from,effective_to,lifecycle_revision
      INTO current_status,current_created_by,current_approved_by,current_effective_from,current_effective_to,current_revision
      FROM mapping_snapshot WHERE tenant_id=p_tenant AND entity_id=p_entity AND mapping_snapshot_id=p_snapshot FOR UPDATE;
  END IF;
  IF NOT FOUND THEN RAISE EXCEPTION 'Configuration snapshot not found' USING ERRCODE='P0002'; END IF;
  IF current_status<>'APPROVED' THEN RAISE EXCEPTION 'Only APPROVED configuration can be retired' USING ERRCODE='55000'; END IF;
  IF current_revision<>p_expected_revision THEN RAISE EXCEPTION 'Configuration revision conflict' USING ERRCODE='40001'; END IF;
  IF actor IN (current_created_by,current_approved_by) THEN RAISE EXCEPTION 'Configuration retirement SoD violation' USING ERRCODE='42501'; END IF;
  IF p_cutoff<=current_effective_from OR (current_effective_to IS NOT NULL AND p_cutoff>current_effective_to) THEN
    RAISE EXCEPTION 'Retirement cutoff is outside the snapshot effective window' USING ERRCODE='22023';
  END IF;

  PERFORM set_config('refs.config_retire','authorized',true);
  IF kind='SETTING' THEN
    UPDATE setting_snapshot SET status='RETIRED',effective_to=p_cutoff,retired_by=actor,retired_at=clock_timestamp(),
      retire_reason=btrim(p_reason),lifecycle_revision=lifecycle_revision+1 WHERE setting_snapshot_id=p_snapshot;
  ELSE
    UPDATE mapping_snapshot SET status='RETIRED',effective_to=p_cutoff,retired_by=actor,retired_at=clock_timestamp(),
      retire_reason=btrim(p_reason),lifecycle_revision=lifecycle_revision+1 WHERE mapping_snapshot_id=p_snapshot;
  END IF;
  PERFORM set_config('refs.config_retire','',true);
  response:=jsonb_build_object('kind',kind,'snapshot_id',p_snapshot,'status','RETIRED','effective_to',p_cutoff,
    'revision',p_expected_revision+1,'idempotent',false);
  INSERT INTO audit_event(tenant_id,entity_id,event_type,object_type,object_id,action,actor_id,actor_type,permission_used,
    request_id,correlation_id,idempotency_key,after_hash,reason,metadata)
    VALUES(p_tenant,p_entity,'CONFIG_SNAPSHOT_RETIRED',kind||'_SNAPSHOT',p_snapshot,'RETIRE',actor,'USER','CONFIG.SNAPSHOT.RETIRE',
      p_idempotency_key,p_idempotency_key,p_idempotency_key,p_request_hash,btrim(p_reason),jsonb_build_object('effective_to',p_cutoff,'revision',p_expected_revision+1));
  event_payload:=jsonb_build_object('kind',kind,'snapshot_id',p_snapshot,'effective_to',p_cutoff,'revision',p_expected_revision+1);
  INSERT INTO outbox_event(tenant_id,entity_id,aggregate_type,aggregate_id,event_type,payload,payload_hash)
    VALUES(p_tenant,p_entity,kind||'_SNAPSHOT',p_snapshot,'CONFIG_SNAPSHOT_RETIRED',event_payload,refs_jsonb_hash(event_payload));
  UPDATE idempotency_receipt SET status='SUCCEEDED',response_status=200,response_body=response,completed_at=clock_timestamp()
    WHERE idempotency_receipt_id=receipt.idempotency_receipt_id;
  RETURN response;
END;
$$;

CREATE OR REPLACE FUNCTION refs_create_manual_journal_hash(
  p_tenant uuid,p_entity uuid,p_period uuid,p_journal_number text,p_journal_date date,p_currency char(3),
  p_description text,p_lines jsonb,p_attachment_ids uuid[]
) RETURNS text
LANGUAGE sql IMMUTABLE SET search_path=pg_catalog,public,pg_temp AS $$
  SELECT refs_jsonb_hash(jsonb_build_object(
    'tenant_id',p_tenant,'entity_id',p_entity,'period_id',p_period,'journal_number',btrim(p_journal_number),
    'journal_date',p_journal_date,'currency',upper(p_currency),'description',p_description,'lines',p_lines,
    'attachment_ids',to_jsonb(ARRAY(SELECT value FROM unnest(COALESCE(p_attachment_ids,'{}'::uuid[])) value ORDER BY value))
  ))
$$;

CREATE OR REPLACE FUNCTION refs_create_manual_journal(
  p_tenant uuid,p_entity uuid,p_period uuid,p_journal_number text,p_journal_date date,p_currency char(3),
  p_description text,p_lines jsonb,p_attachment_ids uuid[],p_idempotency_key text,p_request_hash text
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE actor text:=refs_current_actor(); receipt idempotency_receipt; computed_hash text; journal_id uuid:=gen_random_uuid();
DECLARE response jsonb; event_payload jsonb; line_count integer;
BEGIN
  PERFORM refs_assert_scope(p_tenant,p_entity,'GL.JE.CREATE');
  IF actor IS NULL THEN RAISE EXCEPTION 'Authenticated actor missing' USING ERRCODE='42501'; END IF;
  computed_hash:=refs_create_manual_journal_hash(p_tenant,p_entity,p_period,p_journal_number,p_journal_date,p_currency,p_description,p_lines,p_attachment_ids);
  IF p_request_hash<>computed_hash THEN RAISE EXCEPTION 'Create journal request hash is not canonical' USING ERRCODE='22023'; END IF;
  receipt:=refs_reserve_idempotency(p_tenant,'CREATE_MANUAL_JOURNAL:'||p_entity,p_idempotency_key,p_request_hash,actor);
  IF receipt.status='SUCCEEDED' THEN RETURN receipt.response_body||jsonb_build_object('idempotent',true); END IF;
  IF length(btrim(p_journal_number))=0 OR p_currency !~ '^[A-Z]{3}$' OR jsonb_typeof(p_lines)<>'array' OR jsonb_array_length(p_lines)<2 THEN
    RAISE EXCEPTION 'Manual journal requires number, currency and at least two lines' USING ERRCODE='22023';
  END IF;
  PERFORM 1 FROM accounting_period WHERE tenant_id=p_tenant AND entity_id=p_entity AND period_id=p_period
    AND status='OPEN' AND p_journal_date BETWEEN starts_on AND ends_on FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Journal date must belong to the selected OPEN period' USING ERRCODE='55000'; END IF;
  SELECT count(*) INTO line_count FROM jsonb_to_recordset(p_lines) AS x(line_no integer,account_code text,debit_amount numeric,credit_amount numeric,member_ref text,description text,dimensions jsonb);
  IF line_count<>jsonb_array_length(p_lines) OR EXISTS (
      SELECT 1 FROM jsonb_to_recordset(p_lines) AS x(line_no integer,account_code text,debit_amount numeric,credit_amount numeric,member_ref text,description text,dimensions jsonb)
      WHERE x.line_no IS NULL OR x.line_no<=0 OR COALESCE(length(btrim(x.account_code)),0)=0
        OR COALESCE(x.debit_amount,0)<0 OR COALESCE(x.credit_amount,0)<0
        OR NOT ((COALESCE(x.debit_amount,0)>0 AND COALESCE(x.credit_amount,0)=0) OR (COALESCE(x.credit_amount,0)>0 AND COALESCE(x.debit_amount,0)=0))
        OR (x.dimensions IS NOT NULL AND jsonb_typeof(x.dimensions)<>'object')
    ) OR EXISTS (
      SELECT 1 FROM jsonb_to_recordset(p_lines) AS x(line_no integer) GROUP BY x.line_no HAVING count(*)>1
    ) OR (SELECT COALESCE(sum(COALESCE(x.debit_amount,0)),0)<>COALESCE(sum(COALESCE(x.credit_amount,0)),0)
          FROM jsonb_to_recordset(p_lines) AS x(debit_amount numeric,credit_amount numeric)) THEN
    RAISE EXCEPTION 'Journal lines must be unique, valid and balanced' USING ERRCODE='23514';
  END IF;
  IF COALESCE(cardinality(p_attachment_ids),0)=0 OR COALESCE(cardinality(p_attachment_ids),0)<>(
    SELECT count(DISTINCT a.attachment_id) FROM attachment a WHERE a.tenant_id=p_tenant AND a.attachment_id=ANY(p_attachment_ids)
  ) THEN RAISE EXCEPTION 'Manual journal requires tenant-owned attachment evidence' USING ERRCODE='23503'; END IF;

  INSERT INTO journal_entry(journal_entry_id,tenant_id,entity_id,period_id,journal_number,journal_type,status,journal_date,currency,description,created_by)
    VALUES(journal_id,p_tenant,p_entity,p_period,btrim(p_journal_number),'MANUAL','DRAFT',p_journal_date,p_currency,p_description,actor);
  INSERT INTO journal_line(tenant_id,entity_id,period_id,journal_entry_id,line_no,account_code,debit_amount,credit_amount,member_ref,description,dimensions)
    SELECT p_tenant,p_entity,p_period,journal_id,x.line_no,btrim(x.account_code),x.debit_amount,x.credit_amount,x.member_ref,x.description,COALESCE(x.dimensions,'{}'::jsonb)
    FROM jsonb_to_recordset(p_lines) AS x(line_no integer,account_code text,debit_amount numeric,credit_amount numeric,member_ref text,description text,dimensions jsonb);
  INSERT INTO source_link(tenant_id,entity_id,link_type,journal_entry_id,attachment_id,created_by)
    SELECT p_tenant,p_entity,'JE_ATTACHMENT',journal_id,value,actor FROM unnest(p_attachment_ids) value;
  response:=jsonb_build_object('journal_entry_id',journal_id,'status','DRAFT','revision',0,'idempotent',false);
  INSERT INTO audit_event(tenant_id,entity_id,event_type,object_type,object_id,action,actor_id,actor_type,permission_used,request_id,correlation_id,idempotency_key,after_hash)
    VALUES(p_tenant,p_entity,'JOURNAL_CREATED','JOURNAL_ENTRY',journal_id,'CREATE',actor,'USER','GL.JE.CREATE',p_idempotency_key,p_idempotency_key,p_idempotency_key,p_request_hash);
  event_payload:=jsonb_build_object('journal_entry_id',journal_id,'status','DRAFT','revision',0);
  INSERT INTO outbox_event(tenant_id,entity_id,aggregate_type,aggregate_id,event_type,payload,payload_hash)
    VALUES(p_tenant,p_entity,'JOURNAL_ENTRY',journal_id,'JOURNAL_CREATED',event_payload,refs_jsonb_hash(event_payload));
  UPDATE idempotency_receipt SET status='SUCCEEDED',response_status=201,response_body=response,completed_at=clock_timestamp()
    WHERE tenant_id=p_tenant AND operation_scope='CREATE_MANUAL_JOURNAL:'||p_entity AND idempotency_key=p_idempotency_key;
  RETURN response;
END;
$$;

CREATE OR REPLACE FUNCTION refs_journal_transition_hash(
  p_tenant uuid,p_entity uuid,p_journal uuid,p_action text,p_expected_revision bigint,p_reason text
) RETURNS text
LANGUAGE sql IMMUTABLE SET search_path=pg_catalog,public,pg_temp AS $$
  SELECT refs_jsonb_hash(jsonb_build_object('tenant_id',p_tenant,'entity_id',p_entity,'journal_entry_id',p_journal,
    'action',upper(p_action),'expected_revision',p_expected_revision,'reason',NULLIF(btrim(p_reason),'')))
$$;

CREATE OR REPLACE FUNCTION refs_transition_journal(
  p_tenant uuid,p_entity uuid,p_journal uuid,p_action text,p_expected_revision bigint,p_reason text,
  p_idempotency_key text,p_request_hash text
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE actor text:=refs_current_actor(); action text:=upper(p_action); required_permission text; receipt idempotency_receipt;
DECLARE je journal_entry; target journal_status; response jsonb; event_payload jsonb; computed_hash text; initial_period uuid;
BEGIN
  required_permission:=CASE action WHEN 'SUBMIT' THEN 'GL.JE.SUBMIT' WHEN 'REVIEW' THEN 'GL.JE.REVIEW'
    WHEN 'APPROVE' THEN 'GL.JE.APPROVE' WHEN 'REJECT' THEN 'GL.JE.REJECT' ELSE NULL END;
  IF required_permission IS NULL THEN RAISE EXCEPTION 'Unsupported journal transition' USING ERRCODE='0A000'; END IF;
  PERFORM refs_assert_scope(p_tenant,p_entity,required_permission);
  IF actor IS NULL THEN RAISE EXCEPTION 'Authenticated actor missing' USING ERRCODE='42501'; END IF;
  computed_hash:=refs_journal_transition_hash(p_tenant,p_entity,p_journal,action,p_expected_revision,p_reason);
  IF p_request_hash<>computed_hash THEN RAISE EXCEPTION 'Journal transition request hash is not canonical' USING ERRCODE='22023'; END IF;
  receipt:=refs_reserve_idempotency(p_tenant,'JOURNAL_'||action||':'||p_entity,p_idempotency_key,p_request_hash,actor);
  IF receipt.status='SUCCEEDED' THEN RETURN receipt.response_body||jsonb_build_object('idempotent',true); END IF;
  SELECT * INTO je FROM journal_entry WHERE tenant_id=p_tenant AND entity_id=p_entity AND journal_entry_id=p_journal;
  IF NOT FOUND THEN RAISE EXCEPTION 'Journal not found' USING ERRCODE='P0002'; END IF;
  initial_period:=je.period_id;
  IF action<>'REJECT' THEN
    PERFORM 1 FROM accounting_period WHERE tenant_id=p_tenant AND entity_id=p_entity AND period_id=je.period_id
      AND status='OPEN' AND je.journal_date BETWEEN starts_on AND ends_on FOR SHARE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Journal transition requires its accounting period to remain OPEN' USING ERRCODE='55000'; END IF;
  END IF;
  SELECT * INTO je FROM journal_entry WHERE tenant_id=p_tenant AND entity_id=p_entity AND journal_entry_id=p_journal FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Journal not found after period lock' USING ERRCODE='P0002'; END IF;
  IF action<>'REJECT' AND je.period_id<>initial_period THEN RAISE EXCEPTION 'Journal period changed during transition' USING ERRCODE='40001'; END IF;
  IF je.revision<>p_expected_revision THEN RAISE EXCEPTION 'Journal revision conflict' USING ERRCODE='40001'; END IF;
  IF action='SUBMIT' THEN
    IF je.status<>'DRAFT' THEN RAISE EXCEPTION 'Only DRAFT journals can be submitted' USING ERRCODE='55000'; END IF;
    IF (SELECT count(*)<2 OR COALESCE(sum(debit_amount),0)<>COALESCE(sum(credit_amount),0)
        FROM journal_line WHERE tenant_id=p_tenant AND entity_id=p_entity AND journal_entry_id=p_journal) THEN
      RAISE EXCEPTION 'Submitted journal must remain balanced with at least two lines' USING ERRCODE='23514';
    END IF;
    IF EXISTS (
      SELECT 1 FROM journal_line jl
      LEFT JOIN account_master a ON (a.tenant_id,a.entity_id,a.account_code)=(jl.tenant_id,jl.entity_id,jl.account_code) AND a.active
      LEFT JOIN member_master m ON (m.tenant_id,m.entity_id,m.member_ref)=(jl.tenant_id,jl.entity_id,jl.member_ref) AND m.active
      WHERE jl.tenant_id=p_tenant AND jl.entity_id=p_entity AND jl.journal_entry_id=p_journal
        AND (a.account_code IS NULL OR (a.requires_member AND jl.member_ref IS NULL) OR (jl.member_ref IS NOT NULL AND m.member_ref IS NULL)
          OR (a.requires_member AND NOT (m.member_type=a.required_member_type OR (a.required_member_type='CUSTOMER_OR_AFFILIATE' AND m.member_type IN ('CUSTOMER','AFFILIATE')))))
    ) THEN RAISE EXCEPTION 'Submitted journal account/member validation failed' USING ERRCODE='23514'; END IF;
    IF je.journal_type IN ('MANUAL','RECLASS') AND NOT EXISTS (SELECT 1 FROM source_link WHERE tenant_id=p_tenant AND entity_id=p_entity AND journal_entry_id=p_journal AND attachment_id IS NOT NULL) THEN
      RAISE EXCEPTION 'Manual and reclass journals require attachment evidence before submit' USING ERRCODE='23514';
    END IF;
    target:='PENDING_REVIEW';
  ELSIF action='REVIEW' THEN
    IF je.status<>'PENDING_REVIEW' OR actor=je.created_by THEN RAISE EXCEPTION 'Review state or SoD violation' USING ERRCODE='42501'; END IF;
    target:='PENDING_APPROVAL';
  ELSIF action='APPROVE' THEN
    IF je.status<>'PENDING_APPROVAL' OR actor IN (je.created_by,je.reviewed_by) THEN RAISE EXCEPTION 'Approval state or SoD violation' USING ERRCODE='42501'; END IF;
    target:='APPROVED';
  ELSE
    IF je.status NOT IN ('PENDING_REVIEW','PENDING_APPROVAL','APPROVED') OR actor=je.created_by OR COALESCE(length(btrim(p_reason)),0)<8 THEN
      RAISE EXCEPTION 'Reject state, reason or SoD violation' USING ERRCODE='42501';
    END IF;
    target:='DRAFT';
  END IF;
  UPDATE journal_entry SET status=target,reviewed_by=CASE WHEN action='REVIEW' THEN actor WHEN action='REJECT' THEN NULL ELSE reviewed_by END,
    approved_by=CASE WHEN action='APPROVE' THEN actor WHEN action='REJECT' THEN NULL ELSE approved_by END,revision=revision+1
    WHERE tenant_id=p_tenant AND entity_id=p_entity AND journal_entry_id=p_journal;
  response:=jsonb_build_object('journal_entry_id',p_journal,'status',target,'revision',p_expected_revision+1,'idempotent',false);
  INSERT INTO audit_event(tenant_id,entity_id,event_type,object_type,object_id,action,actor_id,actor_type,permission_used,request_id,correlation_id,idempotency_key,after_hash,reason)
    VALUES(p_tenant,p_entity,'JOURNAL_'||action,'JOURNAL_ENTRY',p_journal,action,actor,'USER',required_permission,p_idempotency_key,p_idempotency_key,p_idempotency_key,p_request_hash,NULLIF(btrim(p_reason),''));
  event_payload:=jsonb_build_object('journal_entry_id',p_journal,'status',target,'revision',p_expected_revision+1);
  INSERT INTO outbox_event(tenant_id,entity_id,aggregate_type,aggregate_id,event_type,payload,payload_hash)
    VALUES(p_tenant,p_entity,'JOURNAL_ENTRY',p_journal,'JOURNAL_'||action,event_payload,refs_jsonb_hash(event_payload));
  UPDATE idempotency_receipt SET status='SUCCEEDED',response_status=200,response_body=response,completed_at=clock_timestamp()
    WHERE tenant_id=p_tenant AND operation_scope='JOURNAL_'||action||':'||p_entity AND idempotency_key=p_idempotency_key;
  RETURN response;
END;
$$;

CREATE OR REPLACE FUNCTION refs_update_draft_description(
  p_tenant uuid,p_entity uuid,p_journal uuid,p_expected_revision bigint,p_description text,
  p_idempotency_key text,p_request_hash text
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
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
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
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
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
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
      AND (a.account_code IS NULL OR (a.requires_member AND jl.member_ref IS NULL) OR (jl.member_ref IS NOT NULL AND m.member_ref IS NULL)
        OR (a.requires_member AND NOT (m.member_type=a.required_member_type OR (a.required_member_type='CUSTOMER_OR_AFFILIATE' AND m.member_type IN ('CUSTOMER','AFFILIATE')))))
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
    JOIN source_document sd ON sd.tenant_id=sl.tenant_id AND sd.entity_id=sl.entity_id AND sd.source_document_id=sl.source_document_id
    JOIN staging_item si ON si.tenant_id=sl.tenant_id AND si.entity_id=sl.entity_id AND si.staging_item_id=sl.staging_item_id AND si.source_document_id=sd.source_document_id
    JOIN setting_snapshot ss ON ss.tenant_id=si.tenant_id AND ss.setting_snapshot_id=si.setting_snapshot_id AND ss.status IN ('APPROVED','RETIRED') AND (ss.entity_id IS NULL OR ss.entity_id=p_entity)
    JOIN mapping_snapshot ms ON ms.tenant_id=si.tenant_id AND ms.mapping_snapshot_id=si.mapping_snapshot_id AND ms.status IN ('APPROVED','RETIRED') AND (ms.entity_id IS NULL OR ms.entity_id=p_entity)
    JOIN rule_evaluation re ON re.tenant_id=si.tenant_id AND re.rule_evaluation_id=si.rule_evaluation_id
      AND re.source_document_id=sd.source_document_id AND re.setting_snapshot_id=ss.setting_snapshot_id AND re.mapping_snapshot_id=ms.mapping_snapshot_id
    WHERE sl.tenant_id=p_tenant AND sl.entity_id=p_entity AND sl.journal_entry_id=p_journal
      AND sl.source_document_id IS NOT NULL AND sl.staging_item_id IS NOT NULL
      AND si.reviewed_by IS NOT NULL AND si.reviewed_at IS NOT NULL
      AND si.status IN ('READY_FOR_DRAFT','DRAFT_CREATED','PENDING_JE_REVIEW','PENDING_JE_APPROVAL','APPROVED','POSTED')
      AND (sd.accounting_date::timestamp AT TIME ZONE 'UTC')>=ss.effective_from
      AND (ss.effective_to IS NULL OR (sd.accounting_date::timestamp AT TIME ZONE 'UTC')<ss.effective_to)
      AND (sd.accounting_date::timestamp AT TIME ZONE 'UTC')>=ms.effective_from
      AND (ms.effective_to IS NULL OR (sd.accounting_date::timestamp AT TIME ZONE 'UTC')<ms.effective_to)
      AND ss.snapshot_hash=refs_jsonb_hash(ss.snapshot)
      AND ms.snapshot_hash=refs_jsonb_hash(jsonb_build_object('input_keys',ms.input_keys,'output_rules',ms.output_rules))
      AND re.evaluation_digest=refs_rule_evaluation_hash(re.source_document_id,re.setting_snapshot_id,re.mapping_snapshot_id,re.rule_code,re.rule_version,re.matched_facts,re.result,re.input_digest)
      AND re.evaluated_at>=ss.effective_from AND (ss.effective_to IS NULL OR re.evaluated_at<ss.effective_to)
      AND re.evaluated_at>=ms.effective_from AND (ms.effective_to IS NULL OR re.evaluated_at<ms.effective_to)
      AND 1=(
        SELECT count(*) FROM setting_snapshot setting_candidate
        WHERE setting_candidate.tenant_id=ss.tenant_id AND setting_candidate.family=ss.family
          AND setting_candidate.scope_type=ss.scope_type AND setting_candidate.scope_key=ss.scope_key
          AND setting_candidate.status IN ('APPROVED','RETIRED')
          AND (sd.accounting_date::timestamp AT TIME ZONE 'UTC')>=setting_candidate.effective_from
          AND (setting_candidate.effective_to IS NULL OR (sd.accounting_date::timestamp AT TIME ZONE 'UTC')<setting_candidate.effective_to)
      )
      AND NOT EXISTS (
        SELECT 1 FROM mapping_snapshot higher
        WHERE higher.tenant_id=ms.tenant_id AND higher.family=ms.family AND higher.scope_type=ms.scope_type
          AND higher.scope_key=ms.scope_key AND higher.input_key_hash=ms.input_key_hash AND higher.status IN ('APPROVED','RETIRED')
          AND higher.priority>ms.priority
          AND (sd.accounting_date::timestamp AT TIME ZONE 'UTC')>=higher.effective_from
          AND (higher.effective_to IS NULL OR (sd.accounting_date::timestamp AT TIME ZONE 'UTC')<higher.effective_to)
      )
      AND 1=(
        SELECT count(*) FROM mapping_snapshot tied
        WHERE tied.tenant_id=ms.tenant_id AND tied.family=ms.family AND tied.scope_type=ms.scope_type
          AND tied.scope_key=ms.scope_key AND tied.input_key_hash=ms.input_key_hash AND tied.status IN ('APPROVED','RETIRED')
          AND tied.priority=ms.priority
          AND (sd.accounting_date::timestamp AT TIME ZONE 'UTC')>=tied.effective_from
          AND (tied.effective_to IS NULL OR (sd.accounting_date::timestamp AT TIME ZONE 'UTC')<tied.effective_to)
      )
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
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
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
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
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
REVOKE ALL ON TABLE runtime_auth_context,runtime_actor_grant,runtime_actor_grant_set,runtime_grant_sync_receipt FROM PUBLIC,refs_app,refs_runtime,refs_context_issuer,refs_grant_sync;
REVOKE EXECUTE ON FUNCTION refs_reconcile_actor_grants(uuid,text,uuid,text[],bigint,text,text) FROM PUBLIC,refs_app,refs_runtime,refs_context_issuer;
REVOKE EXECUTE ON FUNCTION refs_grant_request_hash(uuid,text,uuid,text[],bigint) FROM PUBLIC,refs_app,refs_runtime,refs_context_issuer;
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
REVOKE EXECUTE ON FUNCTION refs_create_manual_journal_hash(uuid,uuid,uuid,text,date,char,text,jsonb,uuid[]) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION refs_create_manual_journal(uuid,uuid,uuid,text,date,char,text,jsonb,uuid[],text,text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION refs_journal_transition_hash(uuid,uuid,uuid,text,bigint,text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION refs_transition_journal(uuid,uuid,uuid,text,bigint,text,text,text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION refs_config_retire_hash(text,uuid,uuid,uuid,bigint,timestamptz,text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION refs_retire_config_snapshot(text,uuid,uuid,uuid,bigint,timestamptz,text,text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION refs_bootstrap_context(text) TO refs_app;
GRANT EXECUTE ON FUNCTION refs_issue_context(text,uuid,text,integer) TO refs_context_issuer;
GRANT EXECUTE ON FUNCTION refs_revoke_context(text,text) TO refs_context_issuer;
GRANT EXECUTE ON FUNCTION refs_cleanup_contexts(interval) TO refs_context_issuer;
GRANT EXECUTE ON FUNCTION refs_reconcile_actor_grants(uuid,text,uuid,text[],bigint,text,text) TO refs_grant_sync;
GRANT EXECUTE ON FUNCTION refs_grant_request_hash(uuid,text,uuid,text[],bigint) TO refs_grant_sync;
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
GRANT EXECUTE ON FUNCTION refs_create_manual_journal_hash(uuid,uuid,uuid,text,date,char,text,jsonb,uuid[]) TO refs_app;
GRANT EXECUTE ON FUNCTION refs_create_manual_journal(uuid,uuid,uuid,text,date,char,text,jsonb,uuid[],text,text) TO refs_app;
GRANT EXECUTE ON FUNCTION refs_journal_transition_hash(uuid,uuid,uuid,text,bigint,text) TO refs_app;
GRANT EXECUTE ON FUNCTION refs_transition_journal(uuid,uuid,uuid,text,bigint,text,text,text) TO refs_app;
GRANT EXECUTE ON FUNCTION refs_config_retire_hash(text,uuid,uuid,uuid,bigint,timestamptz,text) TO refs_app;
GRANT EXECUTE ON FUNCTION refs_retire_config_snapshot(text,uuid,uuid,uuid,bigint,timestamptz,text,text,text) TO refs_app;

COMMIT;
