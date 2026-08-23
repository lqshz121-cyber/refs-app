BEGIN;

-- Migration 274 makes v2 the only grant mutation boundary.  The legacy v1
-- reconciler and its self-upgrade wrappers create unversioned, non-expiring
-- LEGACY grants and therefore must not remain callable by grant-sync.
REVOKE EXECUTE ON FUNCTION refs_reconcile_actor_grants(uuid,text,uuid,text[],bigint,text,text) FROM refs_grant_sync;
REVOKE EXECUTE ON FUNCTION refs_upgrade_stage1_wbs_autorec_read(uuid,text,uuid,text,text,bigint) FROM refs_grant_sync;
REVOKE EXECUTE ON FUNCTION refs_upgrade_stage1_wbs_operator_attest(uuid,text,uuid,text,text,bigint) FROM refs_grant_sync;
REVOKE EXECUTE ON FUNCTION refs_upgrade_stage1_controlled_test_workflow(uuid,text,uuid,text,text,bigint) FROM refs_grant_sync;

ALTER TABLE runtime_actor_grant
  ADD COLUMN authority_class text NOT NULL DEFAULT 'LEGACY'
    CHECK(authority_class ~ '^(?:LEGACY|SERVICE|[A-Z][A-Z0-9_]{1,39})$');
ALTER TABLE runtime_grant_sync_receipt
  ADD COLUMN grant_policy_version text,
  ADD COLUMN authority_class text,
  ADD COLUMN valid_until timestamptz,
  ADD CONSTRAINT runtime_grant_sync_policy_ck CHECK(
    (grant_policy_version IS NULL AND authority_class IS NULL AND valid_until IS NULL)
    OR (grant_policy_version='SOD_FINITE_V1' AND authority_class<>'LEGACY' AND authority_class ~ '^(?:SERVICE|[A-Z][A-Z0-9_]{1,39})$'
      AND (authority_class='SERVICE' OR valid_until IS NOT NULL))
  );

CREATE TABLE runtime_service_only_permission(
  permission_code text PRIMARY KEY REFERENCES permission_catalog(permission_code),
  reason text NOT NULL CHECK(length(btrim(reason)) BETWEEN 8 AND 200)
);
INSERT INTO runtime_service_only_permission(permission_code,reason)
SELECT permission_code,'Machine identity only; excluded from every authenticated human workflow role'
FROM permission_catalog WHERE permission_code IN(
  'OUTBOX.DISPATCH','BANK.AUTOREC.SYNC','WBS.SNAPSHOT.IMPORT','WBS.BANK.ADMIT','WBS.TEST.IMPORT','AI.PROPOSAL.CREATE','AI.TEST.WORKFLOW',
  'ATTACHMENT.FINALIZE','ATTACHMENT.CLEANUP'
);

CREATE TABLE runtime_human_permission_authority(
  permission_code text PRIMARY KEY REFERENCES permission_catalog(permission_code),
  authority_class text NOT NULL CHECK(authority_class ~ '^[A-Z][A-Z0-9_]{1,39}$')
);
INSERT INTO runtime_human_permission_authority(permission_code,authority_class) VALUES
  ('GL.JE.CREATE','DRAFT'),('AP.BILL.CREATE','DRAFT'),('AR.INVOICE.CREATE','DRAFT'),
  ('AP.PAYMENT.CREATE','PAYMENT'),('AP.PAYMENT.REVERSE','REVERSAL'),
  ('AP.VENDOR_CREDIT.CREATE','ADJUSTMENT'),('AP.VENDOR_CREDIT.APPLY','ALLOCATION'),
  ('AR.RECEIPT.CREATE','RECEIPT'),('AR.RECEIPT.REVERSE','REVERSAL'),
  ('AR.CREDIT_MEMO.CREATE','ADJUSTMENT'),('AR.CREDIT_MEMO.APPLY','ALLOCATION'),('AR.REFUND.CREATE','REFUND'),
  ('AI.AMORTIZATION.DRAFT','DRAFT'),('PREPAID.AMORTIZATION.DRAFT','DRAFT'),
  ('WBS.COST.CWIP.DRAFT','DRAFT'),('WBS.PROPERTY.RENT.DRAFT','DRAFT'),
  ('GL.JE.AUTO.CREATE','DRAFT'),('WBS.H1.PAYABLE.DRAFT','DRAFT'),
  ('WBS.H1.ACCOUNTING.RECONCILE','RECONCILE'),
  ('BANK.RECONCILIATION.START','DRAFT'),('BANK.RECONCILIATION.CLEAR','DRAFT'),
  ('BANK.RECONCILIATION.ADJUSTMENT_DRAFT','DRAFT'),('BANK.MATCH.CREATE','DRAFT'),
  ('GL.JE.SUBMIT','SUBMIT'),
  ('GL.JE.REVIEW','REVIEW'),('WBS.PAYABLE.REVIEW','REVIEW'),
  ('BANK.MATCH.REVIEW','REVIEW'),('BANK.RECONCILIATION.REVIEW','REVIEW'),
  ('GL.JE.APPROVE','APPROVE'),('BANK.RECONCILIATION.SIGN_OFF','APPROVE'),
  ('GL.REPORT.SNAPSHOT.APPROVE','APPROVE'),
  ('GL.JE.POST','POST'),('BANK.MATCH.UNMATCH','UNMATCH'),
  ('AI.FINDING.ASSIGN','ASSIGN'),('AI.FINDING.RESOLVE','RESOLVE'),
  ('AI.AMORTIZATION.PROPOSE','PREPARE'),('GL.REPORT.SNAPSHOT.PREPARE','PREPARE'),
  ('WBS.PAYABLE.OPERATOR_ATTEST','ATTEST'),('BANK.RECONCILIATION.REOPEN','REOPEN'),
  ('GL.PERIOD.CLOSE','CLOSE');

-- Every active non-read, non-service permission is closed into one authority
-- class.  The explicit rows above deliberately split legacy sod classes such
-- as JE_MAKER and BANK_MATCH_REVIEWER where the operations are mutually
-- exclusive; the remaining classes retain their catalog identity.
INSERT INTO runtime_human_permission_authority(permission_code,authority_class)
SELECT pc.permission_code,pc.sod_class
FROM permission_catalog pc
LEFT JOIN runtime_service_only_permission service ON service.permission_code=pc.permission_code
WHERE pc.active AND service.permission_code IS NULL
  AND pc.sod_class NOT IN('READ','VIEWER') AND pc.sod_class !~ '_READER$'
ON CONFLICT(permission_code) DO NOTHING;

DO $$
BEGIN
  IF EXISTS(
    SELECT 1 FROM permission_catalog pc
    LEFT JOIN runtime_service_only_permission service ON service.permission_code=pc.permission_code
    LEFT JOIN runtime_human_permission_authority human ON human.permission_code=pc.permission_code
    WHERE pc.active AND service.permission_code IS NULL AND human.permission_code IS NULL
      AND pc.sod_class NOT IN('READ','VIEWER') AND pc.sod_class !~ '_READER$'
  ) THEN
    RAISE EXCEPTION 'Every active write permission must have a closed human or service authority';
  END IF;
END;
$$;

CREATE FUNCTION refs_grant_request_hash_v2(
  p_tenant uuid,p_actor text,p_entity uuid,p_permissions text[],p_authority_class text,
  p_valid_until timestamptz,p_expected_version bigint
) RETURNS text
LANGUAGE sql IMMUTABLE SET search_path=pg_catalog,public,pg_temp AS $$
  SELECT 'sha256:'||encode(digest(convert_to(jsonb_build_object(
    'schema_version','RUNTIME_GRANT_REQUEST_V2','tenant_id',p_tenant,'actor_id',p_actor,'entity_id',p_entity,
    'permissions',to_jsonb((SELECT COALESCE(array_agg(DISTINCT permission ORDER BY permission),'{}'::text[]) FROM unnest(COALESCE(p_permissions,'{}'::text[])) permission)),
    'authority_class',upper(btrim(p_authority_class)),
    'valid_until',CASE WHEN p_valid_until IS NULL THEN NULL ELSE to_char(p_valid_until AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') END,
    'expected_version',p_expected_version
  )::text,'UTF8'),'sha256'),'hex')
$$;

CREATE FUNCTION refs_reconcile_actor_grants_v2(
  p_tenant uuid,p_actor text,p_entity uuid,p_permissions text[],p_authority_class text,
  p_valid_until timestamptz,p_expected_version bigint,p_idempotency_key text,p_request_hash text
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE grant_set runtime_actor_grant_set; receipt runtime_grant_sync_receipt; response jsonb;
DECLARE normalized text[]; computed_hash text; event_payload jsonb; authority text:=upper(btrim(p_authority_class));
DECLARE canonical_expiry text; desired_write_class text; desired_write_class_count integer;
BEGIN
  IF session_user<>'refs_grant_sync' THEN RAISE EXCEPTION 'Grant sync identity denied' USING ERRCODE='42501'; END IF;
  IF p_actor IS NULL OR length(btrim(p_actor))=0 OR p_expected_version IS NULL OR p_expected_version<0
    OR p_idempotency_key IS NULL OR length(p_idempotency_key) NOT BETWEEN 8 AND 200
    OR authority='LEGACY' OR authority !~ '^(?:SERVICE|[A-Z][A-Z0-9_]{1,39})$' THEN
    RAISE EXCEPTION 'Invalid grant subject, authority, identity, or version' USING ERRCODE='22023';
  END IF;
  IF NOT EXISTS(SELECT 1 FROM entity WHERE tenant_id=p_tenant AND entity_id=p_entity AND active) THEN
    RAISE EXCEPTION 'Grant entity is absent or outside tenant' USING ERRCODE='42501';
  END IF;
  IF authority<>'SERVICE' AND (p_valid_until IS NULL OR p_valid_until<=statement_timestamp()+interval '5 minutes' OR p_valid_until>statement_timestamp()+interval '24 hours') THEN
    RAISE EXCEPTION 'Human workflow grants require a finite expiry between five minutes and 24 hours' USING ERRCODE='22023';
  ELSIF authority='SERVICE' AND p_valid_until IS NOT NULL AND p_valid_until<=statement_timestamp() THEN
    RAISE EXCEPTION 'Service grant expiry must be future when supplied' USING ERRCODE='22023';
  END IF;
  canonical_expiry:=CASE WHEN p_valid_until IS NULL THEN NULL ELSE to_char(p_valid_until AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') END;
  SELECT COALESCE(array_agg(DISTINCT permission ORDER BY permission),'{}'::text[]) INTO normalized FROM unnest(COALESCE(p_permissions,'{}'::text[])) permission;
  IF EXISTS(SELECT 1 FROM unnest(normalized) requested LEFT JOIN permission_catalog pc ON pc.permission_code=requested
    WHERE pc.permission_code IS NULL OR NOT pc.active OR pc.effective_from>statement_timestamp() OR (pc.effective_to IS NOT NULL AND pc.effective_to<=statement_timestamp())) THEN
    RAISE EXCEPTION 'Unknown or inactive permission in desired grant set' USING ERRCODE='22023';
  END IF;
  IF authority<>'SERVICE' AND EXISTS(SELECT 1 FROM unnest(normalized) requested JOIN runtime_service_only_permission s ON s.permission_code=requested) THEN
    RAISE EXCEPTION 'Service-only permission denied in human workflow grant' USING ERRCODE='42501';
  END IF;
  IF authority='SERVICE' AND EXISTS(SELECT 1 FROM unnest(normalized) requested LEFT JOIN runtime_service_only_permission s ON s.permission_code=requested WHERE s.permission_code IS NULL) THEN
    RAISE EXCEPTION 'Service authority accepts only frozen service permissions' USING ERRCODE='42501';
  END IF;
  IF authority<>'SERVICE' AND EXISTS(
    SELECT 1 FROM unnest(normalized) requested
    JOIN permission_catalog pc ON pc.permission_code=requested
    LEFT JOIN runtime_human_permission_authority a ON a.permission_code=requested
    WHERE pc.sod_class NOT IN('READ','VIEWER') AND pc.sod_class !~ '_READER$' AND a.permission_code IS NULL
  ) THEN
    RAISE EXCEPTION 'Writable permission is missing a closed human authority' USING ERRCODE='42501';
  END IF;
  SELECT count(DISTINCT a.authority_class),min(a.authority_class) INTO desired_write_class_count,desired_write_class
    FROM unnest(normalized) requested JOIN runtime_human_permission_authority a ON a.permission_code=requested;
  IF authority<>'SERVICE' AND (desired_write_class_count>1 OR (desired_write_class_count=1 AND authority<>desired_write_class)) THEN
    RAISE EXCEPTION 'Human workflow grant combines or mislabels mutually exclusive authority' USING ERRCODE='42501';
  END IF;
  computed_hash:=refs_grant_request_hash_v2(p_tenant,p_actor,p_entity,normalized,authority,p_valid_until,p_expected_version);
  IF p_request_hash IS NULL OR p_request_hash<>computed_hash THEN RAISE EXCEPTION 'Grant request hash is not canonical' USING ERRCODE='22023'; END IF;
  INSERT INTO runtime_grant_sync_receipt(tenant_id,actor_id,entity_id,idempotency_key,request_hash,grant_policy_version,authority_class,valid_until)
    VALUES(p_tenant,p_actor,p_entity,p_idempotency_key,p_request_hash,'SOD_FINITE_V1',authority,p_valid_until) ON CONFLICT DO NOTHING;
  SELECT * INTO receipt FROM runtime_grant_sync_receipt WHERE tenant_id=p_tenant AND actor_id=p_actor AND entity_id=p_entity AND idempotency_key=p_idempotency_key FOR UPDATE;
  IF receipt.request_hash<>p_request_hash OR receipt.grant_policy_version IS DISTINCT FROM 'SOD_FINITE_V1'
    OR receipt.authority_class IS DISTINCT FROM authority OR receipt.valid_until IS DISTINCT FROM p_valid_until THEN
    RAISE EXCEPTION 'Grant idempotency key reused with different request' USING ERRCODE='23505';
  END IF;
  IF receipt.completed_at IS NOT NULL THEN RETURN receipt.response_body||jsonb_build_object('idempotent',true); END IF;
  INSERT INTO runtime_actor_grant_set(tenant_id,actor_id,entity_id,version,updated_by)
    VALUES(p_tenant,p_actor,p_entity,0,session_user) ON CONFLICT DO NOTHING;
  SELECT * INTO grant_set FROM runtime_actor_grant_set WHERE tenant_id=p_tenant AND actor_id=p_actor AND entity_id=p_entity FOR UPDATE;
  IF grant_set.version<>p_expected_version THEN RAISE EXCEPTION 'Grant set revision conflict' USING ERRCODE='40001'; END IF;
  UPDATE runtime_actor_grant SET revoked_at=clock_timestamp()
    WHERE tenant_id=p_tenant AND actor_id=p_actor AND entity_id=p_entity AND revoked_at IS NULL AND NOT(permission=ANY(normalized));
  INSERT INTO runtime_actor_grant(tenant_id,actor_id,entity_id,permission,valid_until,revoked_at,authority_class)
    SELECT p_tenant,p_actor,p_entity,permission,p_valid_until,NULL,authority FROM unnest(normalized) permission
    ON CONFLICT(tenant_id,actor_id,entity_id,permission) DO UPDATE
      SET revoked_at=NULL,valid_until=EXCLUDED.valid_until,authority_class=EXCLUDED.authority_class;
  UPDATE runtime_actor_grant_set SET version=version+1,updated_by=session_user,updated_at=clock_timestamp()
    WHERE tenant_id=p_tenant AND actor_id=p_actor AND entity_id=p_entity;
  response:=jsonb_build_object('tenant_id',p_tenant,'actor_id',p_actor,'entity_id',p_entity,'permissions',to_jsonb(normalized),
    'authority_class',authority,'valid_until',canonical_expiry,'version',p_expected_version+1,'idempotent',false);
  INSERT INTO audit_event(tenant_id,entity_id,event_type,object_type,object_id,action,actor_id,actor_type,permission_used,request_id,correlation_id,idempotency_key,after_hash,metadata)
    VALUES(p_tenant,p_entity,'ACTOR_GRANTS_RECONCILED','RUNTIME_ACTOR_GRANT',p_entity,'RECONCILE',session_user,'SERVICE_ACCOUNT','AUTH.GRANT.SYNC',p_idempotency_key,p_idempotency_key,p_idempotency_key,p_request_hash,
      jsonb_build_object('schema_version','RUNTIME_GRANT_EVIDENCE_V2','subject_actor_id',p_actor,'desired_permissions',to_jsonb(normalized),'authority_class',authority,'valid_until',canonical_expiry,'version',p_expected_version+1));
  event_payload:=jsonb_build_object('schema_version','RUNTIME_GRANT_EVIDENCE_V2','actor_id',p_actor,'entity_id',p_entity,'permissions',to_jsonb(normalized),'authority_class',authority,'valid_until',canonical_expiry,'version',p_expected_version+1);
  INSERT INTO outbox_event(tenant_id,entity_id,aggregate_type,aggregate_id,event_type,payload,payload_hash)
    VALUES(p_tenant,p_entity,'RUNTIME_ACTOR_GRANT',p_entity,'ACTOR_GRANTS_RECONCILED',event_payload,refs_jsonb_hash(event_payload));
  UPDATE runtime_grant_sync_receipt SET response_body=response,completed_at=clock_timestamp() WHERE grant_sync_receipt_id=receipt.grant_sync_receipt_id;
  RETURN response;
END;
$$;

CREATE FUNCTION refs_guard_runtime_context_sod() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE grant_expiry timestamptz;
BEGIN
  IF EXISTS(SELECT 1 FROM runtime_actor_grant g JOIN permission_catalog pc ON pc.permission_code=g.permission
    LEFT JOIN runtime_human_permission_authority p ON p.permission_code=g.permission
    WHERE g.tenant_id=NEW.tenant_id AND g.actor_id=NEW.actor_id AND g.revoked_at IS NULL AND g.authority_class<>'SERVICE'
      AND EXISTS(SELECT 1 FROM jsonb_array_elements(NEW.grants) scope WHERE (scope->>'entity_id')::uuid=g.entity_id)
      AND (p.permission_code IS NOT NULL OR (pc.sod_class NOT IN('READ','VIEWER') AND pc.sod_class !~ '_READER$') OR g.permission='AI.ANALYSIS.EXPLAIN')
      AND (g.authority_class='LEGACY' OR g.valid_until IS NULL OR g.valid_until<=statement_timestamp())) THEN
    RAISE EXCEPTION 'Human write authority requires a finite exact-role grant' USING ERRCODE='42501';
  END IF;
  IF EXISTS(
    SELECT 1 FROM runtime_actor_grant g
    JOIN runtime_service_only_permission service ON service.permission_code=g.permission
    WHERE g.tenant_id=NEW.tenant_id AND g.actor_id=NEW.actor_id
      AND g.revoked_at IS NULL AND (g.valid_until IS NULL OR g.valid_until>statement_timestamp())
      AND EXISTS(SELECT 1 FROM jsonb_array_elements(NEW.grants) scope WHERE (scope->>'entity_id')::uuid=g.entity_id AND scope->>'permission'=g.permission)
      AND g.authority_class<>'SERVICE'
  ) THEN
    RAISE EXCEPTION 'Service-only permission requires an exact SERVICE authority grant' USING ERRCODE='42501';
  END IF;
  IF EXISTS(
    SELECT 1 FROM runtime_actor_grant g
    JOIN runtime_human_permission_authority expected ON expected.permission_code=g.permission
    WHERE g.tenant_id=NEW.tenant_id AND g.actor_id=NEW.actor_id
      AND g.revoked_at IS NULL AND (g.valid_until IS NULL OR g.valid_until>statement_timestamp())
      AND EXISTS(SELECT 1 FROM jsonb_array_elements(NEW.grants) scope WHERE (scope->>'entity_id')::uuid=g.entity_id AND scope->>'permission'=g.permission)
      AND g.authority_class<>expected.authority_class
  ) THEN
    RAISE EXCEPTION 'Human permission grant authority does not match its frozen workflow class' USING ERRCODE='42501';
  END IF;
  IF EXISTS(
    SELECT 1 FROM runtime_actor_grant g
    LEFT JOIN runtime_service_only_permission service ON service.permission_code=g.permission
    WHERE g.tenant_id=NEW.tenant_id AND g.actor_id=NEW.actor_id
      AND g.revoked_at IS NULL AND (g.valid_until IS NULL OR g.valid_until>statement_timestamp())
      AND EXISTS(SELECT 1 FROM jsonb_array_elements(NEW.grants) scope WHERE (scope->>'entity_id')::uuid=g.entity_id)
      AND g.authority_class='SERVICE' AND service.permission_code IS NULL
  ) THEN
    RAISE EXCEPTION 'Service authority contains a non-service permission' USING ERRCODE='42501';
  END IF;
  IF EXISTS(
    SELECT 1 FROM runtime_actor_grant g
    JOIN permission_catalog pc ON pc.permission_code=g.permission
    LEFT JOIN runtime_service_only_permission service ON service.permission_code=g.permission
    LEFT JOIN runtime_human_permission_authority human ON human.permission_code=g.permission
    WHERE g.tenant_id=NEW.tenant_id AND g.actor_id=NEW.actor_id
      AND g.revoked_at IS NULL AND (g.valid_until IS NULL OR g.valid_until>statement_timestamp())
      AND EXISTS(SELECT 1 FROM jsonb_array_elements(NEW.grants) scope WHERE (scope->>'entity_id')::uuid=g.entity_id)
      AND pc.sod_class NOT IN('READ','VIEWER') AND pc.sod_class !~ '_READER$'
      AND service.permission_code IS NULL AND human.permission_code IS NULL
  ) THEN
    RAISE EXCEPTION 'Writable permission is outside the closed authority matrix' USING ERRCODE='42501';
  END IF;
  IF EXISTS(
    SELECT 1 FROM runtime_actor_grant g
    JOIN runtime_human_permission_authority p ON p.permission_code=g.permission
    WHERE g.tenant_id=NEW.tenant_id AND g.actor_id=NEW.actor_id AND g.revoked_at IS NULL
      AND (g.valid_until IS NULL OR g.valid_until>statement_timestamp()) AND g.authority_class<>'SERVICE'
      AND EXISTS(SELECT 1 FROM jsonb_array_elements(NEW.grants) scope WHERE (scope->>'entity_id')::uuid=g.entity_id)
    GROUP BY g.entity_id HAVING count(DISTINCT p.authority_class)>1
  ) THEN RAISE EXCEPTION 'Actor has mutually exclusive workflow authorities in one entity' USING ERRCODE='42501'; END IF;
  SELECT min(g.valid_until) INTO grant_expiry
    FROM runtime_actor_grant g
    JOIN LATERAL jsonb_array_elements(NEW.grants) scope
      ON (scope->>'entity_id')::uuid=g.entity_id AND scope->>'permission'=g.permission
    WHERE g.tenant_id=NEW.tenant_id AND g.actor_id=NEW.actor_id AND g.revoked_at IS NULL
      AND (g.valid_until IS NULL OR g.valid_until>statement_timestamp());
  IF grant_expiry IS NOT NULL THEN NEW.expires_at:=LEAST(NEW.expires_at,grant_expiry); END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER runtime_auth_context_sod_guard BEFORE INSERT ON runtime_auth_context
FOR EACH ROW EXECUTE FUNCTION refs_guard_runtime_context_sod();

CREATE OR REPLACE FUNCTION refs_entity_allowed(candidate uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
  SELECT COALESCE(EXISTS(
    SELECT 1 FROM runtime_auth_context c
    JOIN LATERAL jsonb_array_elements(c.grants) scope ON true
    JOIN runtime_actor_grant current_grant
      ON current_grant.tenant_id=c.tenant_id AND current_grant.actor_id=c.actor_id
      AND current_grant.entity_id=(scope->>'entity_id')::uuid AND current_grant.permission=scope->>'permission'
      AND current_grant.revoked_at IS NULL
      AND (current_grant.valid_until IS NULL OR current_grant.valid_until>clock_timestamp())
    JOIN permission_catalog current_permission ON current_permission.permission_code=current_grant.permission
      AND current_permission.active AND current_permission.effective_from<=clock_timestamp()
      AND (current_permission.effective_to IS NULL OR current_permission.effective_to>clock_timestamp())
    WHERE c.token_hash=current_setting('refs.context_hash',true)
      AND c.bound_login=session_user AND c.bound_backend_pid=pg_backend_pid() AND c.bound_txid=txid_current()
      AND c.revoked_at IS NULL AND c.expires_at>clock_timestamp()
      AND (scope->>'entity_id')::uuid=candidate
  ),false)
$$;

CREATE OR REPLACE FUNCTION refs_has_permission(required_permission text) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
  SELECT COALESCE(EXISTS(
    SELECT 1 FROM runtime_auth_context c
    JOIN LATERAL jsonb_array_elements(c.grants) scope ON true
    JOIN runtime_actor_grant current_grant
      ON current_grant.tenant_id=c.tenant_id AND current_grant.actor_id=c.actor_id
      AND current_grant.entity_id=(scope->>'entity_id')::uuid AND current_grant.permission=scope->>'permission'
      AND current_grant.revoked_at IS NULL
      AND (current_grant.valid_until IS NULL OR current_grant.valid_until>clock_timestamp())
    JOIN permission_catalog current_permission ON current_permission.permission_code=current_grant.permission
      AND current_permission.active AND current_permission.effective_from<=clock_timestamp()
      AND (current_permission.effective_to IS NULL OR current_permission.effective_to>clock_timestamp())
    WHERE c.token_hash=current_setting('refs.context_hash',true)
      AND c.bound_login=session_user AND c.bound_backend_pid=pg_backend_pid() AND c.bound_txid=txid_current()
      AND c.revoked_at IS NULL AND c.expires_at>clock_timestamp()
      AND scope->>'permission' IN(required_permission,'*')
  ),false)
$$;

CREATE OR REPLACE FUNCTION refs_entity_has_permission(candidate uuid,required_permission text) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
  SELECT COALESCE(EXISTS(
    SELECT 1 FROM runtime_auth_context c
    JOIN LATERAL jsonb_array_elements(c.grants) scope ON true
    JOIN runtime_actor_grant current_grant
      ON current_grant.tenant_id=c.tenant_id AND current_grant.actor_id=c.actor_id
      AND current_grant.entity_id=(scope->>'entity_id')::uuid AND current_grant.permission=scope->>'permission'
      AND current_grant.revoked_at IS NULL
      AND (current_grant.valid_until IS NULL OR current_grant.valid_until>clock_timestamp())
    JOIN permission_catalog current_permission ON current_permission.permission_code=current_grant.permission
      AND current_permission.active AND current_permission.effective_from<=clock_timestamp()
      AND (current_permission.effective_to IS NULL OR current_permission.effective_to>clock_timestamp())
    WHERE c.token_hash=current_setting('refs.context_hash',true)
      AND c.bound_login=session_user AND c.bound_backend_pid=pg_backend_pid() AND c.bound_txid=txid_current()
      AND c.revoked_at IS NULL AND c.expires_at>clock_timestamp()
      AND (scope->>'entity_id')::uuid=candidate AND scope->>'permission' IN(required_permission,'*')
  ),false)
$$;

REVOKE ALL ON TABLE runtime_service_only_permission,runtime_human_permission_authority FROM PUBLIC,refs_app,refs_runtime,refs_context_issuer,refs_grant_sync;
REVOKE ALL ON FUNCTION refs_grant_request_hash_v2(uuid,text,uuid,text[],text,timestamptz,bigint) FROM PUBLIC,refs_app,refs_runtime,refs_context_issuer;
REVOKE ALL ON FUNCTION refs_reconcile_actor_grants_v2(uuid,text,uuid,text[],text,timestamptz,bigint,text,text) FROM PUBLIC,refs_app,refs_runtime,refs_context_issuer;
GRANT EXECUTE ON FUNCTION refs_grant_request_hash_v2(uuid,text,uuid,text[],text,timestamptz,bigint) TO refs_grant_sync;
GRANT EXECUTE ON FUNCTION refs_reconcile_actor_grants_v2(uuid,text,uuid,text[],text,timestamptz,bigint,text,text) TO refs_grant_sync;

COMMIT;
