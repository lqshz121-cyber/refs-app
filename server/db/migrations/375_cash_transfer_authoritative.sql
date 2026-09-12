BEGIN;

-- Cash transfers are one-company movements between two distinct, controlled
-- bank accounts.  This aggregate deliberately owns its Journal Entry and
-- delegates posting to refs_post_journal; it never writes ledger_line itself.
INSERT INTO permission_catalog(permission_code,domain,risk_class,sod_class) VALUES
 ('CASH.TRANSFER.VIEW','CASH','LOW','READ'),
 ('CASH.TRANSFER.CREATE','CASH','HIGH','CASH_TRANSFER_DRAFT'),
 ('CASH.TRANSFER.SUBMIT','CASH','HIGH','CASH_TRANSFER_SUBMIT'),
 ('CASH.TRANSFER.REVIEW','CASH','HIGH','CASH_TRANSFER_REVIEW'),
 ('CASH.TRANSFER.APPROVE','CASH','CRITICAL','CASH_TRANSFER_APPROVE'),
 ('CASH.TRANSFER.CANCEL','CASH','HIGH','CASH_TRANSFER_CANCEL'),
 ('CASH.TRANSFER.POST','CASH','CRITICAL','CASH_TRANSFER_POST'),
 ('CASH.TRANSFER.CONFIGURE','CASH','HIGH','CASH_TRANSFER_CONFIG_DRAFT'),
 ('CASH.TRANSFER.CONFIGURE.APPROVE','CASH','CRITICAL','CASH_TRANSFER_CONFIG_APPROVE'),
 ('CASH.TRANSFER.RECONCILE','CASH','HIGH','CASH_TRANSFER_RECONCILE')
ON CONFLICT(permission_code) DO UPDATE SET active=true,domain=EXCLUDED.domain,risk_class=EXCLUDED.risk_class,
 sod_class=EXCLUDED.sod_class,version=permission_catalog.version+1,effective_to=NULL;
INSERT INTO runtime_human_permission_authority(permission_code,authority_class) VALUES
 ('CASH.TRANSFER.CREATE','DRAFT'),('CASH.TRANSFER.SUBMIT','SUBMIT'),('CASH.TRANSFER.REVIEW','REVIEW'),
 ('CASH.TRANSFER.APPROVE','APPROVE'),('CASH.TRANSFER.CANCEL','JE_REVIEW'),('CASH.TRANSFER.POST','POST'),
 ('CASH.TRANSFER.CONFIGURE','DRAFT'),('CASH.TRANSFER.CONFIGURE.APPROVE','APPROVE'),('CASH.TRANSFER.RECONCILE','JE_REVIEW')
ON CONFLICT(permission_code) DO UPDATE SET authority_class=EXCLUDED.authority_class;

-- The authoritative pairing prevents a valid BANK member from being applied
-- to an unrelated cash GL.  Only an approved, effective pair may be used.
CREATE TABLE cash_transfer_bank_account_control (
 cash_transfer_bank_account_control_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),tenant_id uuid NOT NULL REFERENCES tenant(tenant_id),entity_id uuid NOT NULL,
 mapping_family text NOT NULL DEFAULT 'CASH_TRANSFER_BANK_ACCOUNT' CHECK(mapping_family='CASH_TRANSFER_BANK_ACCOUNT'),
 bank_member_ref text NOT NULL CHECK(bank_member_ref=btrim(bank_member_ref) AND length(bank_member_ref) BETWEEN 1 AND 128),
 cash_account_code text NOT NULL CHECK(cash_account_code=btrim(cash_account_code) AND length(cash_account_code) BETWEEN 1 AND 64),
 currency char(3) NOT NULL CHECK(currency~'^[A-Z]{3}$'),effective_from date NOT NULL,effective_to date,
 status text NOT NULL DEFAULT 'PENDING_APPROVAL' CHECK(status IN('PENDING_APPROVAL','APPROVED','RETIRED')),
 version bigint NOT NULL DEFAULT 0 CHECK(version>=0),created_by text NOT NULL,created_at timestamptz NOT NULL DEFAULT clock_timestamp(),approved_by text,approved_at timestamptz,retired_by text,retired_at timestamptz,
 CHECK(effective_to IS NULL OR effective_to>effective_from),CHECK((status NOT IN('APPROVED','RETIRED')) OR(approved_by IS NOT NULL AND approved_at IS NOT NULL)),CHECK((status='RETIRED')=(retired_by IS NOT NULL AND retired_at IS NOT NULL)),UNIQUE(tenant_id,cash_transfer_bank_account_control_id),
 UNIQUE(tenant_id,entity_id,bank_member_ref,cash_account_code,currency,effective_from),
 FOREIGN KEY(tenant_id,entity_id) REFERENCES entity(tenant_id,entity_id)
);
CREATE INDEX cash_transfer_bank_account_control_current_idx ON cash_transfer_bank_account_control(tenant_id,entity_id,bank_member_ref,cash_account_code,currency,effective_from DESC) WHERE status='APPROVED';
ALTER TABLE cash_transfer_bank_account_control ENABLE ROW LEVEL SECURITY;
CREATE POLICY cash_transfer_bank_account_control_scope ON cash_transfer_bank_account_control USING(tenant_id=refs_current_tenant() AND refs_entity_allowed(entity_id));
REVOKE ALL ON cash_transfer_bank_account_control FROM PUBLIC,refs_app;
CREATE FUNCTION refs_guard_cash_transfer_bank_account_control() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE actor text:=refs_current_actor();
BEGIN
 IF actor IS NULL THEN RAISE EXCEPTION 'Cash Transfer bank-account control requires an authenticated actor' USING ERRCODE='42501'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(NEW.tenant_id::text||':'||NEW.entity_id::text||':BANK:'||NEW.bank_member_ref,0));
 PERFORM pg_advisory_xact_lock(hashtextextended(NEW.tenant_id::text||':'||NEW.entity_id::text||':CASH:'||NEW.cash_account_code||':'||NEW.currency,0));
 IF NEW.status='APPROVED' AND EXISTS(SELECT 1 FROM cash_transfer_bank_account_control c WHERE c.tenant_id=NEW.tenant_id AND c.entity_id=NEW.entity_id AND c.cash_transfer_bank_account_control_id IS DISTINCT FROM NEW.cash_transfer_bank_account_control_id AND c.status='APPROVED' AND(c.bank_member_ref=NEW.bank_member_ref OR c.cash_account_code=NEW.cash_account_code) AND c.currency=NEW.currency AND c.effective_from<COALESCE(NEW.effective_to,'infinity'::date) AND NEW.effective_from<COALESCE(c.effective_to,'infinity'::date)) THEN RAISE EXCEPTION 'Approved Cash Transfer bank-to-cash-GL controls cannot overlap' USING ERRCODE='23505'; END IF;
 IF TG_OP='INSERT' THEN
  IF NEW.status<>'PENDING_APPROVAL' OR NEW.created_by IS DISTINCT FROM actor OR NEW.approved_by IS NOT NULL OR NEW.retired_by IS NOT NULL THEN RAISE EXCEPTION 'Cash Transfer bank-account control must start pending with the session actor' USING ERRCODE='55000';END IF;
 ELSE
  IF NEW.version<>OLD.version+1 OR (NEW.tenant_id,NEW.entity_id,NEW.mapping_family,NEW.bank_member_ref,NEW.cash_account_code,NEW.currency,NEW.effective_from,NEW.effective_to,NEW.created_by,NEW.created_at) IS DISTINCT FROM (OLD.tenant_id,OLD.entity_id,OLD.mapping_family,OLD.bank_member_ref,OLD.cash_account_code,OLD.currency,OLD.effective_from,OLD.effective_to,OLD.created_by,OLD.created_at) THEN RAISE EXCEPTION 'Cash Transfer bank-account control identity is immutable' USING ERRCODE='55000';END IF;
  IF OLD.status='PENDING_APPROVAL' AND NEW.status='APPROVED' AND NEW.approved_by=actor AND NEW.retired_by IS NULL THEN NULL; ELSIF OLD.status='APPROVED' AND NEW.status='RETIRED' AND NEW.retired_by=actor THEN NULL; ELSE RAISE EXCEPTION 'Cash Transfer bank-account control lifecycle is invalid' USING ERRCODE='55000';END IF;
 END IF;
 RETURN NEW;
END;$$;
CREATE TRIGGER cash_transfer_bank_account_control_guard BEFORE INSERT OR UPDATE ON cash_transfer_bank_account_control FOR EACH ROW EXECUTE FUNCTION refs_guard_cash_transfer_bank_account_control();

CREATE TABLE cash_transfer (
  cash_transfer_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant(tenant_id),entity_id uuid NOT NULL,
  period_id uuid NOT NULL,transfer_date date NOT NULL,currency char(3) NOT NULL CHECK(currency~'^[A-Z]{3}$'),
  from_account_code text NOT NULL CHECK(from_account_code=btrim(from_account_code) AND length(from_account_code) BETWEEN 1 AND 64),
  from_bank_member_ref text NOT NULL CHECK(from_bank_member_ref=btrim(from_bank_member_ref) AND length(from_bank_member_ref) BETWEEN 1 AND 128),
  to_account_code text NOT NULL CHECK(to_account_code=btrim(to_account_code) AND length(to_account_code) BETWEEN 1 AND 64),
  to_bank_member_ref text NOT NULL CHECK(to_bank_member_ref=btrim(to_bank_member_ref) AND length(to_bank_member_ref) BETWEEN 1 AND 128),
  from_bank_account_control_id uuid NOT NULL,to_bank_account_control_id uuid NOT NULL,
  amount numeric(20,4) NOT NULL CHECK(amount>0 AND amount<10000000000000000),
  journal_entry_id uuid NOT NULL,
  attachment_ids uuid[] NOT NULL CHECK(cardinality(attachment_ids) BETWEEN 1 AND 25),
  attachment_snapshot_hash text NOT NULL CHECK(attachment_snapshot_hash~'^sha256:[0-9a-f]{64}$'),
  reason text NOT NULL CHECK(reason=btrim(reason) AND length(reason) BETWEEN 8 AND 2000 AND reason !~ '[[:cntrl:]]'),
  status text NOT NULL DEFAULT 'DRAFT' CHECK(status IN('DRAFT','PENDING_REVIEW','PENDING_APPROVAL','APPROVED','POSTED','CANCELLED')),
  revision bigint NOT NULL DEFAULT 0 CHECK(revision>=0),
  created_by text NOT NULL,created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  reviewed_by text,reviewed_at timestamptz,approved_by text,approved_at timestamptz,
  posted_at timestamptz,cancelled_by text,cancelled_at timestamptz,cancel_reason text,
  evidence_hash text NOT NULL CHECK(evidence_hash~'^sha256:[0-9a-f]{64}$'),
  CHECK(from_account_code<>to_account_code AND from_bank_member_ref<>to_bank_member_ref),
  CHECK((status='POSTED')=(posted_at IS NOT NULL)),
  CHECK((status='CANCELLED')=(cancelled_at IS NOT NULL)),
  CHECK((status<>'CANCELLED')=(cancelled_by IS NULL AND cancel_reason IS NULL)),
  CHECK((status NOT IN('PENDING_APPROVAL','APPROVED','POSTED')) OR reviewed_by IS NOT NULL),
  CHECK((status NOT IN('APPROVED','POSTED')) OR approved_by IS NOT NULL),
  UNIQUE(tenant_id,cash_transfer_id),UNIQUE(tenant_id,entity_id,cash_transfer_id),UNIQUE(tenant_id,entity_id,journal_entry_id),
  FOREIGN KEY(tenant_id,entity_id) REFERENCES entity(tenant_id,entity_id),
  FOREIGN KEY(tenant_id,from_bank_account_control_id) REFERENCES cash_transfer_bank_account_control(tenant_id,cash_transfer_bank_account_control_id),
  FOREIGN KEY(tenant_id,to_bank_account_control_id) REFERENCES cash_transfer_bank_account_control(tenant_id,cash_transfer_bank_account_control_id),
  FOREIGN KEY(tenant_id,entity_id,period_id,journal_entry_id) REFERENCES journal_entry(tenant_id,entity_id,period_id,journal_entry_id)
);
CREATE INDEX cash_transfer_register_idx ON cash_transfer(tenant_id,entity_id,period_id,transfer_date DESC,cash_transfer_id DESC);
CREATE UNIQUE INDEX cash_transfer_open_pair_uq ON cash_transfer(tenant_id,entity_id,from_account_code,to_account_code,transfer_date,amount)
 WHERE status NOT IN('POSTED','CANCELLED');
ALTER TABLE cash_transfer ENABLE ROW LEVEL SECURITY;
CREATE POLICY cash_transfer_scope ON cash_transfer USING(tenant_id=refs_current_tenant() AND refs_entity_allowed(entity_id));
REVOKE ALL ON cash_transfer FROM PUBLIC,refs_app;

-- These links are intentionally separate from bank_match.  A future dual-bank
-- reconciliation command must supply a posted transfer, its exact cash ledger
-- line, and one bank source per leg; a bank line can be active in only one leg.
CREATE TABLE cash_transfer_bank_link (
  cash_transfer_bank_link_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,entity_id uuid NOT NULL,cash_transfer_id uuid NOT NULL,
  leg text NOT NULL CHECK(leg IN('SOURCE','DESTINATION')),bank_source_id uuid NOT NULL,
  journal_line_id uuid,ledger_line_id uuid,status text NOT NULL DEFAULT 'PENDING' CHECK(status IN('PENDING','ACTIVE','RETIRED')),
  linked_by text NOT NULL,linked_at timestamptz NOT NULL DEFAULT clock_timestamp(),retired_by text,retired_at timestamptz,
  CHECK((status='RETIRED')=(retired_at IS NOT NULL)),
  UNIQUE(tenant_id,cash_transfer_id,leg),UNIQUE(tenant_id,cash_transfer_bank_link_id),
  FOREIGN KEY(tenant_id,entity_id,cash_transfer_id) REFERENCES cash_transfer(tenant_id,entity_id,cash_transfer_id),
  -- bank_source has the tenant-scoped composite candidate key; the future
  -- linker must additionally assert its entity matches this aggregate.
  FOREIGN KEY(tenant_id,bank_source_id) REFERENCES bank_source(tenant_id,bank_source_id),
  FOREIGN KEY(tenant_id,entity_id,journal_line_id) REFERENCES journal_line(tenant_id,entity_id,journal_line_id),
  FOREIGN KEY(tenant_id,entity_id,ledger_line_id) REFERENCES ledger_line(tenant_id,entity_id,ledger_line_id)
);
CREATE UNIQUE INDEX cash_transfer_bank_link_active_source_uq ON cash_transfer_bank_link(tenant_id,entity_id,bank_source_id) WHERE status='ACTIVE';
ALTER TABLE cash_transfer_bank_link ENABLE ROW LEVEL SECURITY;
CREATE POLICY cash_transfer_bank_link_scope ON cash_transfer_bank_link USING(tenant_id=refs_current_tenant() AND refs_entity_allowed(entity_id));
REVOKE ALL ON cash_transfer_bank_link FROM PUBLIC,refs_app;

CREATE FUNCTION refs_guard_cash_transfer_bank_link() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE t cash_transfer;b bank_source;jl journal_line;ll ledger_line;expected_account text;expected_bank text;expected_amount numeric(20,4);actor text:=refs_current_actor();gate integer;
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Cash Transfer bank-link evidence is retained and cannot be deleted' USING ERRCODE='55000'; END IF;
 IF actor IS NULL THEN RAISE EXCEPTION 'Cash Transfer bank-link requires an authenticated server actor' USING ERRCODE='42501'; END IF;
 IF TG_OP='INSERT' THEN
   IF NEW.status<>'PENDING' THEN RAISE EXCEPTION 'Cash Transfer bank-link must start pending before controlled activation' USING ERRCODE='55000'; END IF;
   DELETE FROM cash_transfer_internal_gate WHERE backend_pid=pg_backend_pid() AND transaction_id=txid_current() AND tenant_id=NEW.tenant_id AND cash_transfer_id=NEW.cash_transfer_id AND resource_kind='BANK_LINK' AND resource_id=NEW.cash_transfer_bank_link_id AND operation='PENDING' RETURNING 1 INTO gate;
   IF gate IS NULL THEN RAISE EXCEPTION 'Cash Transfer bank-link must be created by its controlled linker' USING ERRCODE='0A000'; END IF;
   NEW.linked_by:=actor;NEW.linked_at:=clock_timestamp();NEW.retired_by:=NULL;NEW.retired_at:=NULL;
 ELSE
   IF (NEW.tenant_id,NEW.entity_id,NEW.cash_transfer_id,NEW.leg,NEW.bank_source_id,NEW.linked_by,NEW.linked_at) IS DISTINCT FROM (OLD.tenant_id,OLD.entity_id,OLD.cash_transfer_id,OLD.leg,OLD.bank_source_id,OLD.linked_by,OLD.linked_at) THEN RAISE EXCEPTION 'Cash Transfer bank-link identity and linkage actor are immutable' USING ERRCODE='55000'; END IF;
   IF OLD.status='PENDING' AND NEW.status='ACTIVE' THEN
     IF NEW.retired_by IS NOT NULL OR NEW.retired_at IS NOT NULL THEN RAISE EXCEPTION 'Cash Transfer bank-link activation cannot retire evidence' USING ERRCODE='55000'; END IF;
   ELSIF OLD.status IN('PENDING','ACTIVE') AND NEW.status='RETIRED' THEN
     NEW.retired_by:=refs_current_actor();NEW.retired_at:=clock_timestamp();
   ELSE RAISE EXCEPTION 'Cash Transfer bank-link status transition is invalid' USING ERRCODE='55000'; END IF;
   DELETE FROM cash_transfer_internal_gate WHERE backend_pid=pg_backend_pid() AND transaction_id=txid_current() AND tenant_id=NEW.tenant_id AND cash_transfer_id=NEW.cash_transfer_id AND resource_kind='BANK_LINK' AND resource_id=NEW.cash_transfer_bank_link_id AND operation=NEW.status RETURNING 1 INTO gate;
   IF gate IS NULL THEN RAISE EXCEPTION 'Cash Transfer bank-link must transition through its controlled linker' USING ERRCODE='0A000'; END IF;
 END IF;
 SELECT * INTO t FROM cash_transfer WHERE tenant_id=NEW.tenant_id AND entity_id=NEW.entity_id AND cash_transfer_id=NEW.cash_transfer_id FOR SHARE;
 SELECT * INTO b FROM bank_source WHERE tenant_id=NEW.tenant_id AND bank_source_id=NEW.bank_source_id FOR SHARE;
 IF t.cash_transfer_id IS NULL OR b.bank_source_id IS NULL OR b.entity_id IS DISTINCT FROM NEW.entity_id OR t.status<>'POSTED' THEN RAISE EXCEPTION 'Cash Transfer bank-link requires a posted same-entity transfer and bank source' USING ERRCODE='23514'; END IF;
 expected_account:=CASE NEW.leg WHEN 'SOURCE' THEN t.from_account_code ELSE t.to_account_code END;
 expected_bank:=CASE NEW.leg WHEN 'SOURCE' THEN t.from_bank_member_ref ELSE t.to_bank_member_ref END;
 expected_amount:=CASE NEW.leg WHEN 'SOURCE' THEN -t.amount ELSE t.amount END;
 IF b.bank_account_ref IS DISTINCT FROM expected_bank OR b.currency IS DISTINCT FROM t.currency OR b.amount IS DISTINCT FROM expected_amount THEN RAISE EXCEPTION 'Cash Transfer bank-link direction, currency, amount, or bank member does not match its leg' USING ERRCODE='23514'; END IF;
 IF NEW.status='PENDING' AND (NEW.journal_line_id IS NOT NULL OR NEW.ledger_line_id IS NOT NULL) THEN RAISE EXCEPTION 'Pending Cash Transfer bank-link cannot claim posted lines' USING ERRCODE='23514'; END IF;
 IF NEW.status='ACTIVE' THEN
   IF NEW.journal_line_id IS NULL OR NEW.ledger_line_id IS NULL THEN RAISE EXCEPTION 'Active Cash Transfer bank-link requires exact Journal and Ledger lines' USING ERRCODE='23514'; END IF;
   SELECT * INTO jl FROM journal_line WHERE tenant_id=NEW.tenant_id AND entity_id=NEW.entity_id AND journal_line_id=NEW.journal_line_id FOR SHARE;
   SELECT * INTO ll FROM ledger_line WHERE tenant_id=NEW.tenant_id AND entity_id=NEW.entity_id AND ledger_line_id=NEW.ledger_line_id FOR SHARE;
   IF jl.journal_line_id IS NULL OR ll.ledger_line_id IS NULL OR jl.journal_entry_id IS DISTINCT FROM t.journal_entry_id OR ll.journal_entry_id IS DISTINCT FROM t.journal_entry_id OR ll.journal_line_id IS DISTINCT FROM jl.journal_line_id OR jl.account_code IS DISTINCT FROM expected_account OR jl.member_ref IS DISTINCT FROM expected_bank OR (NEW.leg='SOURCE' AND (jl.credit_amount<>t.amount OR jl.debit_amount<>0)) OR (NEW.leg='DESTINATION' AND (jl.debit_amount<>t.amount OR jl.credit_amount<>0)) OR ll.debit_amount IS DISTINCT FROM jl.debit_amount OR ll.credit_amount IS DISTINCT FROM jl.credit_amount OR ll.currency IS DISTINCT FROM t.currency THEN RAISE EXCEPTION 'Active Cash Transfer bank-link must reference the exact posted cash Journal and Ledger line' USING ERRCODE='23514'; END IF;
 END IF;
 RETURN NEW;
END;$$;
CREATE TRIGGER cash_transfer_bank_link_guard BEFORE INSERT OR UPDATE OR DELETE ON cash_transfer_bank_link FOR EACH ROW EXECUTE FUNCTION refs_guard_cash_transfer_bank_link();

CREATE TABLE cash_transfer_internal_gate (
 backend_pid integer NOT NULL,transaction_id bigint NOT NULL,tenant_id uuid NOT NULL,cash_transfer_id uuid NOT NULL,
 resource_kind text NOT NULL CHECK(resource_kind IN('TRANSFER','JOURNAL','BANK_LINK')),resource_id uuid NOT NULL,operation text NOT NULL,
 PRIMARY KEY(backend_pid,transaction_id,tenant_id,cash_transfer_id,resource_kind,resource_id,operation)
);
REVOKE ALL ON cash_transfer_internal_gate FROM PUBLIC,refs_app;

CREATE FUNCTION refs_cash_transfer_attachment_snapshot(p_tenant uuid,p_entity uuid,p_ids uuid[]) RETURNS text
LANGUAGE sql STABLE SET search_path=pg_catalog,public,pg_temp AS $$
 SELECT CASE WHEN cardinality(COALESCE(p_ids,'{}'::uuid[]))=0 OR count(*)<>cardinality(p_ids)
   OR bool_or(a.finalization_status<>'VERIFIED_CLEAN' OR a.scan_status<>'CLEAN' OR a.verified_at IS NULL OR a.finalized_at IS NULL) THEN NULL
  ELSE refs_jsonb_hash(jsonb_agg(jsonb_build_object('attachment_id',a.attachment_id,'storage_ref',a.storage_ref,'storage_version',a.storage_version,'content_hash',a.content_hash,'verified_at',a.verified_at,'finalized_at',a.finalized_at) ORDER BY a.attachment_id)) END
 FROM attachment a WHERE a.tenant_id=p_tenant AND a.entity_id=p_entity AND a.attachment_id=ANY(COALESCE(p_ids,'{}'::uuid[]))
$$;

-- Extend the platform's closed idempotency scope policy, rather than allowing
-- Cash Transfer commands to insert receipts directly.
CREATE OR REPLACE FUNCTION refs_reserve_idempotency(p_tenant uuid,p_scope text,p_key text,p_request_hash text,p_actor text) RETURNS idempotency_receipt
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE receipt idempotency_receipt;
BEGIN
 IF refs_current_tenant() IS DISTINCT FROM p_tenant THEN RAISE EXCEPTION 'Idempotency tenant scope denied' USING ERRCODE='42501'; END IF;
 IF refs_current_actor() IS DISTINCT FROM p_actor THEN RAISE EXCEPTION 'Actor must come from the authenticated session' USING ERRCODE='42501'; END IF;
 IF p_scope NOT LIKE 'POST_JOURNAL:%' AND p_scope NOT LIKE 'EDIT_JOURNAL:%' AND p_scope NOT LIKE 'CLOSE_PERIOD:%' AND p_scope NOT LIKE 'REOPEN_PERIOD:%' AND p_scope NOT LIKE 'RETIRE_CONFIG:%' AND p_scope NOT LIKE 'CREATE_MANUAL_JOURNAL:%' AND p_scope NOT LIKE 'CREATE_AUTO_JOURNAL:%' AND p_scope NOT LIKE 'CREATE_REVERSAL:%' AND p_scope NOT LIKE 'CREATE_RECLASS:%' AND p_scope NOT LIKE 'JOURNAL_SUBMIT:%' AND p_scope NOT LIKE 'JOURNAL_REVIEW:%' AND p_scope NOT LIKE 'JOURNAL_APPROVE:%' AND p_scope NOT LIKE 'JOURNAL_REJECT:%' AND p_scope NOT LIKE 'AR_RECEIPT_REVERSAL:%' AND p_scope NOT LIKE 'AP_PAYMENT_REVERSAL:%' AND p_scope NOT LIKE 'PREPARE_STATEMENT_SNAPSHOT:%' AND p_scope NOT LIKE 'APPROVE_STATEMENT_SNAPSHOT:%' AND p_scope NOT LIKE 'WBS_H1_PAYABLE_RECLASS_DRAFT:%' AND p_scope NOT LIKE 'CASH_TRANSFER:%' AND p_scope NOT LIKE 'CASH_TRANSFER_SUBMIT:%' AND p_scope NOT LIKE 'CASH_TRANSFER_REVIEW:%' AND p_scope NOT LIKE 'CASH_TRANSFER_APPROVE:%' AND p_scope NOT LIKE 'CASH_TRANSFER_POST:%' AND p_scope NOT LIKE 'CASH_TRANSFER_CANCEL:%' AND p_scope NOT LIKE 'CASH_TRANSFER_CONFIG_CREATE:%' AND p_scope NOT LIKE 'CASH_TRANSFER_CONFIG_APPROVE:%' AND p_scope NOT LIKE 'CASH_TRANSFER_CONFIG_RETIRE:%' AND p_scope NOT LIKE 'CASH_TRANSFER_LINK:%' THEN RAISE EXCEPTION 'Idempotency operation scope denied' USING ERRCODE='42501'; END IF;
 INSERT INTO idempotency_receipt(tenant_id,operation_scope,idempotency_key,request_hash,status,actor_id) VALUES(p_tenant,p_scope,p_key,p_request_hash,'IN_PROGRESS',p_actor) ON CONFLICT(tenant_id,operation_scope,idempotency_key) DO NOTHING;
 SELECT * INTO receipt FROM idempotency_receipt WHERE tenant_id=p_tenant AND operation_scope=p_scope AND idempotency_key=p_key FOR UPDATE;
 IF receipt.request_hash<>p_request_hash OR receipt.actor_id<>p_actor THEN RAISE EXCEPTION 'Idempotency key reused by a different request or actor' USING ERRCODE='23505'; END IF;
 RETURN receipt;
END;$$;

CREATE FUNCTION refs_complete_cash_transfer_idempotency(p_tenant uuid,p_scope text,p_receipt uuid,p_actor text,p_response_status integer,p_response jsonb) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE receipt idempotency_receipt;
BEGIN
 IF refs_current_tenant() IS DISTINCT FROM p_tenant OR refs_current_actor() IS DISTINCT FROM p_actor OR p_scope NOT LIKE 'CASH_TRANSFER:%' AND p_scope NOT LIKE 'CASH_TRANSFER_SUBMIT:%' AND p_scope NOT LIKE 'CASH_TRANSFER_REVIEW:%' AND p_scope NOT LIKE 'CASH_TRANSFER_APPROVE:%' AND p_scope NOT LIKE 'CASH_TRANSFER_POST:%' AND p_scope NOT LIKE 'CASH_TRANSFER_CANCEL:%' AND p_scope NOT LIKE 'CASH_TRANSFER_CONFIG_CREATE:%' AND p_scope NOT LIKE 'CASH_TRANSFER_CONFIG_APPROVE:%' AND p_scope NOT LIKE 'CASH_TRANSFER_CONFIG_RETIRE:%' AND p_scope NOT LIKE 'CASH_TRANSFER_LINK:%' THEN RAISE EXCEPTION 'Cash Transfer idempotency completion denied' USING ERRCODE='42501'; END IF;
 SELECT * INTO receipt FROM idempotency_receipt WHERE tenant_id=p_tenant AND idempotency_receipt_id=p_receipt FOR UPDATE;
 IF receipt.idempotency_receipt_id IS NULL OR receipt.operation_scope IS DISTINCT FROM p_scope OR receipt.actor_id IS DISTINCT FROM p_actor OR receipt.status<>'IN_PROGRESS' THEN RAISE EXCEPTION 'Cash Transfer idempotency receipt cannot be completed' USING ERRCODE='23505'; END IF;
 UPDATE idempotency_receipt SET status='SUCCEEDED',response_status=p_response_status,response_body=p_response,completed_at=clock_timestamp() WHERE idempotency_receipt_id=p_receipt;
END;$$;

CREATE FUNCTION refs_create_cash_transfer_bank_account_control(p_tenant uuid,p_entity uuid,p_bank text,p_account text,p_currency char(3),p_effective_from date,p_effective_to date,p_idempotency_key text,p_request_hash text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE actor text:=refs_current_actor();idem idempotency_receipt;control_id uuid:=gen_random_uuid();payload jsonb;expected text;
BEGIN
 PERFORM refs_assert_scope(p_tenant,p_entity,'CASH.TRANSFER.CONFIGURE');expected:=refs_jsonb_hash(jsonb_build_object('tenant_id',p_tenant,'entity_id',p_entity,'bank_member_ref',btrim(p_bank),'cash_account_code',btrim(p_account),'currency',p_currency,'effective_from',p_effective_from,'effective_to',p_effective_to));
 IF actor IS NULL OR p_effective_from IS NULL OR p_currency !~ '^[A-Z]{3}$' OR length(btrim(coalesce(p_bank,''))) NOT BETWEEN 1 AND 128 OR length(btrim(coalesce(p_account,''))) NOT BETWEEN 1 AND 64 OR p_effective_to IS NOT NULL AND p_effective_to<=p_effective_from OR p_request_hash IS DISTINCT FROM expected THEN RAISE EXCEPTION 'Invalid Cash Transfer bank-account control command' USING ERRCODE='22023'; END IF;
 idem:=refs_reserve_idempotency(p_tenant,'CASH_TRANSFER_CONFIG_CREATE:'||p_entity,p_idempotency_key,p_request_hash,actor);IF idem.status='SUCCEEDED' THEN RETURN idem.response_body||jsonb_build_object('idempotent',true);END IF;
 PERFORM 1 FROM account_master WHERE tenant_id=p_tenant AND entity_id=p_entity AND account_code=btrim(p_account) AND active AND requires_member AND required_member_type='BANK' FOR SHARE;IF NOT FOUND THEN RAISE EXCEPTION 'Cash Transfer control requires an active BANK-controlled GL' USING ERRCODE='23514';END IF;
 PERFORM 1 FROM member_master WHERE tenant_id=p_tenant AND entity_id=p_entity AND member_ref=btrim(p_bank) AND active AND member_type='BANK' FOR SHARE;IF NOT FOUND THEN RAISE EXCEPTION 'Cash Transfer control requires an active BANK member' USING ERRCODE='23514';END IF;
 INSERT INTO cash_transfer_bank_account_control(cash_transfer_bank_account_control_id,tenant_id,entity_id,bank_member_ref,cash_account_code,currency,effective_from,effective_to,status,created_by) VALUES(control_id,p_tenant,p_entity,btrim(p_bank),btrim(p_account),p_currency,p_effective_from,p_effective_to,'PENDING_APPROVAL',actor);
 payload:=jsonb_build_object('cash_transfer_bank_account_control_id',control_id,'status','PENDING_APPROVAL','revision',0,'idempotent',false);INSERT INTO audit_event(tenant_id,entity_id,event_type,object_type,object_id,action,actor_id,actor_type,permission_used,request_id,correlation_id,idempotency_key,after_hash,metadata) VALUES(p_tenant,p_entity,'CASH_TRANSFER_BANK_CONTROL_CREATED','CASH_TRANSFER_BANK_ACCOUNT_CONTROL',control_id,'CREATE',actor,'USER','CASH.TRANSFER.CONFIGURE',p_idempotency_key,p_idempotency_key,p_idempotency_key,refs_jsonb_hash(payload),payload);INSERT INTO outbox_event(tenant_id,entity_id,aggregate_type,aggregate_id,event_type,payload,payload_hash) VALUES(p_tenant,p_entity,'CASH_TRANSFER_BANK_ACCOUNT_CONTROL',control_id,'CASH_TRANSFER_BANK_CONTROL_CREATED',payload,refs_jsonb_hash(payload));PERFORM refs_complete_cash_transfer_idempotency(p_tenant,'CASH_TRANSFER_CONFIG_CREATE:'||p_entity,idem.idempotency_receipt_id,actor,201,payload);RETURN payload;
END;$$;
CREATE FUNCTION refs_approve_cash_transfer_bank_account_control(p_tenant uuid,p_entity uuid,p_control uuid,p_expected_version bigint,p_idempotency_key text,p_request_hash text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE actor text:=refs_current_actor();idem idempotency_receipt;c cash_transfer_bank_account_control;payload jsonb;expected text;
BEGIN
 PERFORM refs_assert_scope(p_tenant,p_entity,'CASH.TRANSFER.CONFIGURE.APPROVE');expected:=refs_jsonb_hash(jsonb_build_object('tenant_id',p_tenant,'entity_id',p_entity,'control_id',p_control,'expected_version',p_expected_version));IF actor IS NULL OR p_expected_version IS NULL OR p_request_hash IS DISTINCT FROM expected THEN RAISE EXCEPTION 'Invalid Cash Transfer bank-account control approval' USING ERRCODE='22023';END IF;idem:=refs_reserve_idempotency(p_tenant,'CASH_TRANSFER_CONFIG_APPROVE:'||p_entity,p_idempotency_key,p_request_hash,actor);IF idem.status='SUCCEEDED' THEN RETURN idem.response_body||jsonb_build_object('idempotent',true);END IF;SELECT * INTO c FROM cash_transfer_bank_account_control WHERE tenant_id=p_tenant AND entity_id=p_entity AND cash_transfer_bank_account_control_id=p_control FOR UPDATE;IF c.cash_transfer_bank_account_control_id IS NULL OR c.status<>'PENDING_APPROVAL' OR c.version<>p_expected_version OR actor=c.created_by THEN RAISE EXCEPTION 'Cash Transfer bank-account control approval state, version, or SoD conflict' USING ERRCODE='40001';END IF;UPDATE cash_transfer_bank_account_control SET status='APPROVED',approved_by=actor,approved_at=clock_timestamp(),version=version+1 WHERE tenant_id=p_tenant AND entity_id=p_entity AND cash_transfer_bank_account_control_id=p_control;payload:=jsonb_build_object('cash_transfer_bank_account_control_id',p_control,'status','APPROVED','revision',p_expected_version+1,'idempotent',false);INSERT INTO audit_event(tenant_id,entity_id,event_type,object_type,object_id,action,actor_id,actor_type,permission_used,request_id,correlation_id,idempotency_key,after_hash,metadata) VALUES(p_tenant,p_entity,'CASH_TRANSFER_BANK_CONTROL_APPROVED','CASH_TRANSFER_BANK_ACCOUNT_CONTROL',p_control,'APPROVE',actor,'USER','CASH.TRANSFER.CONFIGURE.APPROVE',p_idempotency_key,p_idempotency_key,p_idempotency_key,refs_jsonb_hash(payload),payload);INSERT INTO outbox_event(tenant_id,entity_id,aggregate_type,aggregate_id,event_type,payload,payload_hash) VALUES(p_tenant,p_entity,'CASH_TRANSFER_BANK_ACCOUNT_CONTROL',p_control,'CASH_TRANSFER_BANK_CONTROL_APPROVED',payload,refs_jsonb_hash(payload));PERFORM refs_complete_cash_transfer_idempotency(p_tenant,'CASH_TRANSFER_CONFIG_APPROVE:'||p_entity,idem.idempotency_receipt_id,actor,200,payload);RETURN payload;
END;$$;
CREATE FUNCTION refs_retire_cash_transfer_bank_account_control(p_tenant uuid,p_entity uuid,p_control uuid,p_expected_version bigint,p_idempotency_key text,p_request_hash text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE actor text:=refs_current_actor();idem idempotency_receipt;c cash_transfer_bank_account_control;payload jsonb;expected text;
BEGIN
 PERFORM refs_assert_scope(p_tenant,p_entity,'CASH.TRANSFER.CONFIGURE');expected:=refs_jsonb_hash(jsonb_build_object('tenant_id',p_tenant,'entity_id',p_entity,'control_id',p_control,'expected_version',p_expected_version,'action','RETIRE'));IF actor IS NULL OR p_expected_version IS NULL OR p_request_hash IS DISTINCT FROM expected THEN RAISE EXCEPTION 'Invalid Cash Transfer bank-account control retirement' USING ERRCODE='22023';END IF;idem:=refs_reserve_idempotency(p_tenant,'CASH_TRANSFER_CONFIG_RETIRE:'||p_entity,p_idempotency_key,p_request_hash,actor);IF idem.status='SUCCEEDED' THEN RETURN idem.response_body||jsonb_build_object('idempotent',true);END IF;SELECT * INTO c FROM cash_transfer_bank_account_control WHERE tenant_id=p_tenant AND entity_id=p_entity AND cash_transfer_bank_account_control_id=p_control FOR UPDATE;IF c.cash_transfer_bank_account_control_id IS NULL OR c.status<>'APPROVED' OR c.version<>p_expected_version OR actor IN(c.created_by,c.approved_by) OR EXISTS(SELECT 1 FROM cash_transfer t WHERE t.tenant_id=p_tenant AND t.entity_id=p_entity AND t.status<>'POSTED' AND p_control IN(t.from_bank_account_control_id,t.to_bank_account_control_id)) THEN RAISE EXCEPTION 'Cash Transfer bank-account control retirement state, SoD, or open-transfer conflict' USING ERRCODE='40001';END IF;UPDATE cash_transfer_bank_account_control SET status='RETIRED',retired_by=actor,retired_at=clock_timestamp(),version=version+1 WHERE tenant_id=p_tenant AND entity_id=p_entity AND cash_transfer_bank_account_control_id=p_control;payload:=jsonb_build_object('cash_transfer_bank_account_control_id',p_control,'status','RETIRED','revision',p_expected_version+1,'idempotent',false);INSERT INTO audit_event(tenant_id,entity_id,event_type,object_type,object_id,action,actor_id,actor_type,permission_used,request_id,correlation_id,idempotency_key,after_hash,metadata) VALUES(p_tenant,p_entity,'CASH_TRANSFER_BANK_CONTROL_RETIRED','CASH_TRANSFER_BANK_ACCOUNT_CONTROL',p_control,'RETIRE',actor,'USER','CASH.TRANSFER.CONFIGURE',p_idempotency_key,p_idempotency_key,p_idempotency_key,refs_jsonb_hash(payload),payload);INSERT INTO outbox_event(tenant_id,entity_id,aggregate_type,aggregate_id,event_type,payload,payload_hash) VALUES(p_tenant,p_entity,'CASH_TRANSFER_BANK_ACCOUNT_CONTROL',p_control,'CASH_TRANSFER_BANK_CONTROL_RETIRED',payload,refs_jsonb_hash(payload));PERFORM refs_complete_cash_transfer_idempotency(p_tenant,'CASH_TRANSFER_CONFIG_RETIRE:'||p_entity,idem.idempotency_receipt_id,actor,200,payload);RETURN payload;
END;$$;
CREATE FUNCTION refs_read_cash_transfer_bank_account_controls(p_tenant uuid,p_entity uuid,p_as_of date) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$ BEGIN PERFORM refs_assert_scope(p_tenant,p_entity,'CASH.TRANSFER.CONFIGURE');RETURN jsonb_build_object('schema_version','CASH_TRANSFER_BANK_CONTROL_OPTIONS_V1','as_of',p_as_of,'rows',COALESCE((SELECT jsonb_agg(jsonb_build_object('control_id',cash_transfer_bank_account_control_id,'bank_member_ref',bank_member_ref,'cash_account_code',cash_account_code,'currency',currency,'effective_from',effective_from,'effective_to',effective_to,'status',status,'revision',version) ORDER BY bank_member_ref,cash_account_code,effective_from DESC) FROM cash_transfer_bank_account_control WHERE tenant_id=p_tenant AND entity_id=p_entity AND(p_as_of IS NULL OR effective_from<=p_as_of AND(effective_to IS NULL OR effective_to>p_as_of))),'[]'::jsonb));END;$$;

CREATE FUNCTION refs_create_cash_transfer_hash(p_tenant uuid,p_entity uuid,p_period uuid,p_date date,p_currency char(3),p_from_account text,p_from_bank text,p_to_account text,p_to_bank text,p_amount numeric,p_number text,p_attachments uuid[],p_attachment_hash text,p_reason text) RETURNS text
LANGUAGE sql IMMUTABLE SET search_path=pg_catalog,public,pg_temp AS $$
 SELECT refs_jsonb_hash(jsonb_build_object('schema_version','CASH_TRANSFER_COMMAND_V1','tenant_id',p_tenant,'entity_id',p_entity,'period_id',p_period,'transfer_date',p_date,'currency',p_currency,'from_account_code',btrim(p_from_account),'from_bank_member_ref',btrim(p_from_bank),'to_account_code',btrim(p_to_account),'to_bank_member_ref',btrim(p_to_bank),'amount',p_amount,'journal_number',btrim(p_number),'attachment_ids',to_jsonb(ARRAY(SELECT id FROM unnest(COALESCE(p_attachments,'{}'::uuid[])) id ORDER BY id)),'attachment_snapshot_hash',p_attachment_hash,'reason',btrim(p_reason)))
$$;

CREATE FUNCTION refs_create_cash_transfer(
 p_tenant uuid,p_entity uuid,p_period uuid,p_date date,p_currency char(3),p_from_account text,p_from_bank text,p_to_account text,p_to_bank text,p_amount numeric,p_number text,p_attachments uuid[],p_attachment_hash text,p_reason text,p_idempotency_key text,p_request_hash text
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE actor text:=refs_current_actor();idem idempotency_receipt;period_row accounting_period;entity_row entity;from_control cash_transfer_bank_account_control;to_control cash_transfer_bank_account_control;
 transfer_id uuid:=gen_random_uuid();journal_id uuid:=gen_random_uuid();attachments uuid[];actual_attachment_hash text;payload jsonb;proof text;
BEGIN
 PERFORM refs_assert_scope(p_tenant,p_entity,'CASH.TRANSFER.CREATE');PERFORM refs_assert_scope(p_tenant,p_entity,'GL.JE.CREATE');
 IF actor IS NULL OR p_date IS NULL OR p_currency IS NULL OR p_currency !~ '^[A-Z]{3}$' OR p_amount IS NULL OR p_amount<=0 OR p_amount>=10000000000000000 OR p_amount<>round(p_amount,4)
  OR p_from_account IS NULL OR p_to_account IS NULL OR p_from_bank IS NULL OR p_to_bank IS NULL OR btrim(p_from_account)=btrim(p_to_account) OR btrim(p_from_bank)=btrim(p_to_bank)
  OR length(btrim(coalesce(p_number,''))) NOT BETWEEN 1 AND 100 OR cardinality(COALESCE(p_attachments,'{}'::uuid[])) NOT BETWEEN 1 AND 25 OR cardinality(p_attachments)<>(SELECT count(DISTINCT id) FROM unnest(p_attachments) id)
  OR p_attachment_hash IS NULL OR p_attachment_hash !~ '^sha256:[0-9a-f]{64}$' OR length(btrim(coalesce(p_reason,''))) NOT BETWEEN 8 AND 2000 OR p_idempotency_key IS NULL OR length(p_idempotency_key) NOT BETWEEN 8 AND 200
  OR p_request_hash IS DISTINCT FROM refs_create_cash_transfer_hash(p_tenant,p_entity,p_period,p_date,p_currency,p_from_account,p_from_bank,p_to_account,p_to_bank,p_amount,p_number,p_attachments,p_attachment_hash,p_reason)
 THEN RAISE EXCEPTION 'Invalid Cash Transfer command' USING ERRCODE='22023'; END IF;
 idem:=refs_reserve_idempotency(p_tenant,'CASH_TRANSFER:'||p_entity,p_idempotency_key,p_request_hash,actor);
 IF idem.actor_id IS DISTINCT FROM actor OR idem.request_hash IS DISTINCT FROM p_request_hash THEN RAISE EXCEPTION 'Cash Transfer idempotency conflict' USING ERRCODE='23505'; END IF;
 IF idem.status='SUCCEEDED' THEN RETURN idem.response_body||jsonb_build_object('idempotent',true); END IF;
 SELECT * INTO entity_row FROM entity WHERE tenant_id=p_tenant AND entity_id=p_entity AND active FOR SHARE;
 SELECT * INTO period_row FROM accounting_period WHERE tenant_id=p_tenant AND entity_id=p_entity AND period_id=p_period AND ledger_code='PRIMARY' AND status='OPEN' AND p_date BETWEEN starts_on AND ends_on FOR SHARE;
 IF entity_row.entity_id IS NULL OR period_row.period_id IS NULL OR entity_row.base_currency IS DISTINCT FROM p_currency THEN RAISE EXCEPTION 'Cash Transfer requires an active entity, its base currency, and an OPEN primary period' USING ERRCODE='55000'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(p_tenant::text||':'||p_entity::text||':'||LEAST(btrim(p_from_bank),btrim(p_to_bank))||':'||GREATEST(btrim(p_from_bank),btrim(p_to_bank)),0));
 PERFORM 1 FROM account_master WHERE tenant_id=p_tenant AND entity_id=p_entity AND account_code=btrim(p_from_account) AND active AND requires_member AND required_member_type='BANK' FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Cash Transfer source GL must be active and BANK-controlled' USING ERRCODE='23514'; END IF;
 PERFORM 1 FROM account_master WHERE tenant_id=p_tenant AND entity_id=p_entity AND account_code=btrim(p_to_account) AND active AND requires_member AND required_member_type='BANK' FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Cash Transfer destination GL must be active and BANK-controlled' USING ERRCODE='23514'; END IF;
 PERFORM 1 FROM member_master WHERE tenant_id=p_tenant AND entity_id=p_entity AND member_ref=btrim(p_from_bank) AND active AND member_type='BANK' FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Cash Transfer source bank member is unavailable' USING ERRCODE='23514'; END IF;
 PERFORM 1 FROM member_master WHERE tenant_id=p_tenant AND entity_id=p_entity AND member_ref=btrim(p_to_bank) AND active AND member_type='BANK' FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Cash Transfer destination bank member is unavailable' USING ERRCODE='23514'; END IF;
 SELECT * INTO from_control FROM cash_transfer_bank_account_control WHERE tenant_id=p_tenant AND entity_id=p_entity AND mapping_family='CASH_TRANSFER_BANK_ACCOUNT' AND bank_member_ref=btrim(p_from_bank) AND cash_account_code=btrim(p_from_account) AND currency=p_currency AND status='APPROVED' AND effective_from<=p_date AND(effective_to IS NULL OR effective_to>p_date) FOR SHARE;
 SELECT * INTO to_control FROM cash_transfer_bank_account_control WHERE tenant_id=p_tenant AND entity_id=p_entity AND mapping_family='CASH_TRANSFER_BANK_ACCOUNT' AND bank_member_ref=btrim(p_to_bank) AND cash_account_code=btrim(p_to_account) AND currency=p_currency AND status='APPROVED' AND effective_from<=p_date AND(effective_to IS NULL OR effective_to>p_date) FOR SHARE;
 IF from_control.cash_transfer_bank_account_control_id IS NULL OR to_control.cash_transfer_bank_account_control_id IS NULL OR from_control.cash_transfer_bank_account_control_id=to_control.cash_transfer_bank_account_control_id THEN RAISE EXCEPTION 'Cash Transfer requires two distinct exact approved current bank-to-cash-GL controls' USING ERRCODE='23514'; END IF;
 SELECT ARRAY(SELECT id FROM unnest(p_attachments) id ORDER BY id) INTO attachments;actual_attachment_hash:=refs_cash_transfer_attachment_snapshot(p_tenant,p_entity,attachments);
 IF actual_attachment_hash IS NULL OR actual_attachment_hash IS DISTINCT FROM p_attachment_hash THEN RAISE EXCEPTION 'Cash Transfer requires the exact verified-clean attachment snapshot' USING ERRCODE='23514'; END IF;
 INSERT INTO journal_entry(journal_entry_id,tenant_id,entity_id,period_id,journal_number,journal_type,status,journal_date,currency,description,created_by)
 VALUES(journal_id,p_tenant,p_entity,p_period,btrim(p_number),'MANUAL','DRAFT',p_date,p_currency,btrim(p_reason),actor);
 INSERT INTO journal_line(tenant_id,entity_id,period_id,journal_entry_id,line_no,account_code,debit_amount,credit_amount,member_ref,description,dimensions) VALUES
  (p_tenant,p_entity,p_period,journal_id,1,btrim(p_to_account),p_amount,0,btrim(p_to_bank),btrim(p_reason),'{}'::jsonb),
  (p_tenant,p_entity,p_period,journal_id,2,btrim(p_from_account),0,p_amount,btrim(p_from_bank),btrim(p_reason),'{}'::jsonb);
 INSERT INTO source_link(tenant_id,entity_id,link_type,journal_entry_id,attachment_id,created_by) SELECT p_tenant,p_entity,'JE_ATTACHMENT',journal_id,id,actor FROM unnest(attachments) id;
 proof:=refs_jsonb_hash(jsonb_build_object('schema_version','CASH_TRANSFER_EVIDENCE_V1','journal_entry_id',journal_id,'period_id',p_period,'transfer_date',p_date,'currency',p_currency,'from_account_code',btrim(p_from_account),'from_bank_member_ref',btrim(p_from_bank),'from_bank_account_control_id',from_control.cash_transfer_bank_account_control_id,'to_account_code',btrim(p_to_account),'to_bank_member_ref',btrim(p_to_bank),'to_bank_account_control_id',to_control.cash_transfer_bank_account_control_id,'amount',p_amount,'attachment_ids',to_jsonb(attachments),'attachment_snapshot_hash',actual_attachment_hash,'reason',btrim(p_reason)));
 INSERT INTO cash_transfer(cash_transfer_id,tenant_id,entity_id,period_id,transfer_date,currency,from_account_code,from_bank_member_ref,to_account_code,to_bank_member_ref,from_bank_account_control_id,to_bank_account_control_id,amount,journal_entry_id,attachment_ids,attachment_snapshot_hash,reason,created_by,evidence_hash)
 VALUES(transfer_id,p_tenant,p_entity,p_period,p_date,p_currency,btrim(p_from_account),btrim(p_from_bank),btrim(p_to_account),btrim(p_to_bank),from_control.cash_transfer_bank_account_control_id,to_control.cash_transfer_bank_account_control_id,p_amount,journal_id,attachments,actual_attachment_hash,btrim(p_reason),actor,proof);
 payload:=jsonb_build_object('cash_transfer_id',transfer_id,'journal_entry_id',journal_id,'status','DRAFT','revision',0,'evidence_hash',proof,'idempotent',false);
 INSERT INTO audit_event(tenant_id,entity_id,event_type,object_type,object_id,action,actor_id,actor_type,permission_used,request_id,correlation_id,idempotency_key,after_hash,reason,metadata) VALUES(p_tenant,p_entity,'CASH_TRANSFER_DRAFT_CREATED','CASH_TRANSFER',transfer_id,'CREATE',actor,'USER','CASH.TRANSFER.CREATE',p_idempotency_key,p_idempotency_key,p_idempotency_key,refs_jsonb_hash(payload),btrim(p_reason),payload);
 INSERT INTO outbox_event(tenant_id,entity_id,aggregate_type,aggregate_id,event_type,payload,payload_hash) VALUES(p_tenant,p_entity,'CASH_TRANSFER',transfer_id,'CASH_TRANSFER_DRAFT_CREATED',payload,refs_jsonb_hash(payload));
 PERFORM refs_complete_cash_transfer_idempotency(p_tenant,'CASH_TRANSFER:'||p_entity,idem.idempotency_receipt_id,actor,201,payload); RETURN payload;
END;$$;

CREATE FUNCTION refs_cash_transfer_transition_hash(p_tenant uuid,p_entity uuid,p_transfer uuid,p_action text,p_expected_revision bigint,p_expected_journal_revision bigint,p_reason text) RETURNS text
LANGUAGE sql IMMUTABLE SET search_path=pg_catalog,public,pg_temp AS $$ SELECT refs_jsonb_hash(jsonb_build_object('schema_version','CASH_TRANSFER_TRANSITION_V1','tenant_id',p_tenant,'entity_id',p_entity,'cash_transfer_id',p_transfer,'action',p_action,'expected_revision',p_expected_revision,'expected_journal_revision',p_expected_journal_revision,'reason',NULLIF(btrim(p_reason),''))) $$;

CREATE FUNCTION refs_transition_cash_transfer(p_tenant uuid,p_entity uuid,p_transfer uuid,p_action text,p_expected_revision bigint,p_expected_journal_revision bigint,p_reason text,p_idempotency_key text,p_request_hash text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE actor text:=refs_current_actor();t cash_transfer;idem idempotency_receipt;j journal_entry;target text;permission text;child_hash text;child jsonb;payload jsonb;
BEGIN
 IF p_action NOT IN('SUBMIT','REVIEW','APPROVE') OR actor IS NULL OR p_expected_revision IS NULL OR p_expected_revision<0 OR p_expected_journal_revision IS NULL OR p_expected_journal_revision<0 OR length(coalesce(p_idempotency_key,'')) NOT BETWEEN 8 AND 200 OR p_request_hash IS DISTINCT FROM refs_cash_transfer_transition_hash(p_tenant,p_entity,p_transfer,p_action,p_expected_revision,p_expected_journal_revision,p_reason) THEN RAISE EXCEPTION 'Invalid Cash Transfer transition command' USING ERRCODE='22023'; END IF;
 permission:='CASH.TRANSFER.'||p_action;PERFORM refs_assert_scope(p_tenant,p_entity,permission);PERFORM refs_assert_scope(p_tenant,p_entity,'GL.JE.'||p_action);
 idem:=refs_reserve_idempotency(p_tenant,'CASH_TRANSFER_'||p_action||':'||p_entity,p_idempotency_key,p_request_hash,actor);
 IF idem.actor_id IS DISTINCT FROM actor OR idem.request_hash IS DISTINCT FROM p_request_hash THEN RAISE EXCEPTION 'Cash Transfer idempotency conflict' USING ERRCODE='23505'; END IF; IF idem.status='SUCCEEDED' THEN RETURN idem.response_body||jsonb_build_object('idempotent',true); END IF;
 SELECT * INTO t FROM cash_transfer WHERE tenant_id=p_tenant AND entity_id=p_entity AND cash_transfer_id=p_transfer FOR UPDATE; IF NOT FOUND THEN RAISE EXCEPTION 'Cash Transfer was not found' USING ERRCODE='P0002'; END IF;
 SELECT * INTO j FROM journal_entry WHERE tenant_id=p_tenant AND entity_id=p_entity AND journal_entry_id=t.journal_entry_id FOR UPDATE;
 target:=CASE p_action WHEN 'SUBMIT' THEN 'PENDING_REVIEW' WHEN 'REVIEW' THEN 'PENDING_APPROVAL' ELSE 'APPROVED' END;
 IF t.revision<>p_expected_revision OR j.revision<>p_expected_journal_revision OR (p_action='SUBMIT' AND t.status<>'DRAFT') OR (p_action='REVIEW' AND (t.status<>'PENDING_REVIEW' OR actor=t.created_by)) OR (p_action='APPROVE' AND (t.status<>'PENDING_APPROVAL' OR actor IN(t.created_by,t.reviewed_by))) THEN RAISE EXCEPTION 'Cash Transfer state, revision, or segregation-of-duties conflict' USING ERRCODE='40001'; END IF;
 IF refs_cash_transfer_attachment_snapshot(p_tenant,p_entity,t.attachment_ids) IS DISTINCT FROM t.attachment_snapshot_hash THEN RAISE EXCEPTION 'Cash Transfer attachment evidence changed' USING ERRCODE='40001'; END IF;
 INSERT INTO cash_transfer_internal_gate VALUES(pg_backend_pid(),txid_current(),p_tenant,p_transfer,'JOURNAL',t.journal_entry_id,target);
 child_hash:=refs_journal_transition_hash(p_tenant,p_entity,t.journal_entry_id,p_action,p_expected_journal_revision,NULLIF(btrim(p_reason),''));child:=refs_transition_journal(p_tenant,p_entity,t.journal_entry_id,p_action,p_expected_journal_revision,NULLIF(btrim(p_reason),''),'cash-transfer:'||p_transfer||':'||p_action||':'||p_idempotency_key,child_hash);
 INSERT INTO cash_transfer_internal_gate VALUES(pg_backend_pid(),txid_current(),p_tenant,p_transfer,'TRANSFER',p_transfer,target);
 UPDATE cash_transfer SET status=target,revision=revision+1,reviewed_by=CASE WHEN p_action='REVIEW' THEN actor ELSE reviewed_by END,reviewed_at=CASE WHEN p_action='REVIEW' THEN clock_timestamp() ELSE reviewed_at END,approved_by=CASE WHEN p_action='APPROVE' THEN actor ELSE approved_by END,approved_at=CASE WHEN p_action='APPROVE' THEN clock_timestamp() ELSE approved_at END WHERE tenant_id=p_tenant AND entity_id=p_entity AND cash_transfer_id=p_transfer;
 payload:=jsonb_build_object('cash_transfer_id',p_transfer,'journal',child,'status',target,'revision',p_expected_revision+1,'idempotent',false);
 INSERT INTO audit_event(tenant_id,entity_id,event_type,object_type,object_id,action,actor_id,actor_type,permission_used,request_id,correlation_id,idempotency_key,after_hash,reason,metadata) VALUES(p_tenant,p_entity,'CASH_TRANSFER_'||p_action,'CASH_TRANSFER',p_transfer,p_action,actor,'USER',permission,p_idempotency_key,p_idempotency_key,p_idempotency_key,refs_jsonb_hash(payload),NULLIF(btrim(p_reason),''),payload);
 INSERT INTO outbox_event(tenant_id,entity_id,aggregate_type,aggregate_id,event_type,payload,payload_hash) VALUES(p_tenant,p_entity,'CASH_TRANSFER',p_transfer,'CASH_TRANSFER_'||p_action,payload,refs_jsonb_hash(payload));
 PERFORM refs_complete_cash_transfer_idempotency(p_tenant,'CASH_TRANSFER_'||p_action||':'||p_entity,idem.idempotency_receipt_id,actor,200,payload); RETURN payload;
END;$$;

CREATE FUNCTION refs_post_cash_transfer_hash(p_tenant uuid,p_entity uuid,p_transfer uuid,p_expected_revision bigint,p_expected_journal_revision bigint) RETURNS text
LANGUAGE sql IMMUTABLE SET search_path=pg_catalog,public,pg_temp AS $$ SELECT refs_jsonb_hash(jsonb_build_object('schema_version','CASH_TRANSFER_POST_V1','tenant_id',p_tenant,'entity_id',p_entity,'cash_transfer_id',p_transfer,'expected_revision',p_expected_revision,'expected_journal_revision',p_expected_journal_revision)) $$;
CREATE FUNCTION refs_post_cash_transfer(p_tenant uuid,p_entity uuid,p_transfer uuid,p_expected_revision bigint,p_expected_journal_revision bigint,p_idempotency_key text,p_request_hash text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE actor text:=refs_current_actor();t cash_transfer;idem idempotency_receipt;from_control cash_transfer_bank_account_control;to_control cash_transfer_bank_account_control;child_hash text;child jsonb;payload jsonb;
BEGIN
 PERFORM refs_assert_scope(p_tenant,p_entity,'CASH.TRANSFER.POST');PERFORM refs_assert_scope(p_tenant,p_entity,'GL.JE.POST');
 IF actor IS NULL OR p_expected_revision IS NULL OR p_expected_revision<0 OR p_expected_journal_revision IS NULL OR p_expected_journal_revision<0 OR length(coalesce(p_idempotency_key,'')) NOT BETWEEN 8 AND 200 OR p_request_hash IS DISTINCT FROM refs_post_cash_transfer_hash(p_tenant,p_entity,p_transfer,p_expected_revision,p_expected_journal_revision) THEN RAISE EXCEPTION 'Invalid Cash Transfer Post command' USING ERRCODE='22023'; END IF;
 idem:=refs_reserve_idempotency(p_tenant,'CASH_TRANSFER_POST:'||p_entity,p_idempotency_key,p_request_hash,actor);
 IF idem.actor_id IS DISTINCT FROM actor OR idem.request_hash IS DISTINCT FROM p_request_hash THEN RAISE EXCEPTION 'Cash Transfer Post idempotency conflict' USING ERRCODE='23505'; END IF;IF idem.status='SUCCEEDED' THEN RETURN idem.response_body||jsonb_build_object('idempotent',true); END IF;
 SELECT * INTO t FROM cash_transfer WHERE tenant_id=p_tenant AND entity_id=p_entity AND cash_transfer_id=p_transfer FOR UPDATE;IF NOT FOUND THEN RAISE EXCEPTION 'Cash Transfer was not found' USING ERRCODE='P0002'; END IF;
 IF t.status<>'APPROVED' OR t.revision<>p_expected_revision OR actor IN(t.created_by,t.reviewed_by,t.approved_by) OR refs_cash_transfer_attachment_snapshot(p_tenant,p_entity,t.attachment_ids) IS DISTINCT FROM t.attachment_snapshot_hash THEN RAISE EXCEPTION 'Cash Transfer post state, evidence, or segregation-of-duties conflict' USING ERRCODE='40001'; END IF;
 SELECT * INTO from_control FROM cash_transfer_bank_account_control WHERE tenant_id=p_tenant AND entity_id=p_entity AND cash_transfer_bank_account_control_id=t.from_bank_account_control_id AND mapping_family='CASH_TRANSFER_BANK_ACCOUNT' AND bank_member_ref=t.from_bank_member_ref AND cash_account_code=t.from_account_code AND currency=t.currency AND status='APPROVED' AND effective_from<=t.transfer_date AND(effective_to IS NULL OR effective_to>t.transfer_date) FOR SHARE;
 SELECT * INTO to_control FROM cash_transfer_bank_account_control WHERE tenant_id=p_tenant AND entity_id=p_entity AND cash_transfer_bank_account_control_id=t.to_bank_account_control_id AND mapping_family='CASH_TRANSFER_BANK_ACCOUNT' AND bank_member_ref=t.to_bank_member_ref AND cash_account_code=t.to_account_code AND currency=t.currency AND status='APPROVED' AND effective_from<=t.transfer_date AND(effective_to IS NULL OR effective_to>t.transfer_date) FOR SHARE;
 IF from_control.cash_transfer_bank_account_control_id IS NULL OR to_control.cash_transfer_bank_account_control_id IS NULL OR from_control.cash_transfer_bank_account_control_id=to_control.cash_transfer_bank_account_control_id THEN RAISE EXCEPTION 'Cash Transfer bank-to-cash-GL control changed before Post' USING ERRCODE='40001'; END IF;
 INSERT INTO cash_transfer_internal_gate VALUES(pg_backend_pid(),txid_current(),p_tenant,p_transfer,'JOURNAL',t.journal_entry_id,'POSTED');child_hash:=refs_jsonb_hash(jsonb_build_object('tenantId',p_tenant,'entityId',p_entity,'periodId',t.period_id,'journalEntryId',t.journal_entry_id,'expectedRevision',p_expected_journal_revision));child:=refs_post_journal(p_tenant,p_entity,t.period_id,t.journal_entry_id,p_expected_journal_revision,'cash-transfer:'||p_transfer||':POST:'||p_idempotency_key,child_hash,actor);
 INSERT INTO cash_transfer_internal_gate VALUES(pg_backend_pid(),txid_current(),p_tenant,p_transfer,'TRANSFER',p_transfer,'POSTED');UPDATE cash_transfer SET status='POSTED',revision=revision+1,posted_at=clock_timestamp() WHERE tenant_id=p_tenant AND entity_id=p_entity AND cash_transfer_id=p_transfer;
 payload:=jsonb_build_object('cash_transfer_id',p_transfer,'journal',child,'status','POSTED','revision',p_expected_revision+1,'idempotent',false);INSERT INTO audit_event(tenant_id,entity_id,event_type,object_type,object_id,action,actor_id,actor_type,permission_used,request_id,correlation_id,idempotency_key,after_hash,metadata) VALUES(p_tenant,p_entity,'CASH_TRANSFER_POSTED','CASH_TRANSFER',p_transfer,'POST',actor,'USER','CASH.TRANSFER.POST',p_idempotency_key,p_idempotency_key,p_idempotency_key,refs_jsonb_hash(payload),payload);INSERT INTO outbox_event(tenant_id,entity_id,aggregate_type,aggregate_id,event_type,payload,payload_hash) VALUES(p_tenant,p_entity,'CASH_TRANSFER',p_transfer,'CASH_TRANSFER_POSTED',payload,refs_jsonb_hash(payload));PERFORM refs_complete_cash_transfer_idempotency(p_tenant,'CASH_TRANSFER_POST:'||p_entity,idem.idempotency_receipt_id,actor,200,payload);RETURN payload;
END;$$;

CREATE FUNCTION refs_link_cash_transfer_bank_leg(p_tenant uuid,p_entity uuid,p_transfer uuid,p_leg text,p_bank_source uuid,p_expected_transfer_revision bigint,p_idempotency_key text,p_request_hash text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE actor text:=refs_current_actor();idem idempotency_receipt;t cash_transfer;line_id uuid;ledger_id uuid;link_id uuid:=gen_random_uuid();account text;bank text;payload jsonb;expected text;
BEGIN
 PERFORM refs_assert_scope(p_tenant,p_entity,'CASH.TRANSFER.RECONCILE');PERFORM refs_assert_scope(p_tenant,p_entity,'GL.JE.VIEW');expected:=refs_jsonb_hash(jsonb_build_object('tenant_id',p_tenant,'entity_id',p_entity,'cash_transfer_id',p_transfer,'leg',p_leg,'bank_source_id',p_bank_source,'expected_revision',p_expected_transfer_revision));IF actor IS NULL OR p_leg NOT IN('SOURCE','DESTINATION') OR p_expected_transfer_revision IS NULL OR length(coalesce(p_idempotency_key,'')) NOT BETWEEN 8 AND 200 OR p_request_hash IS DISTINCT FROM expected THEN RAISE EXCEPTION 'Invalid Cash Transfer bank-link command' USING ERRCODE='22023';END IF;idem:=refs_reserve_idempotency(p_tenant,'CASH_TRANSFER_LINK:'||p_entity,p_idempotency_key,p_request_hash,actor);IF idem.status='SUCCEEDED' THEN RETURN idem.response_body||jsonb_build_object('idempotent',true);END IF;SELECT * INTO t FROM cash_transfer WHERE tenant_id=p_tenant AND entity_id=p_entity AND cash_transfer_id=p_transfer FOR UPDATE;IF t.cash_transfer_id IS NULL OR t.status<>'POSTED' OR t.revision<>p_expected_transfer_revision THEN RAISE EXCEPTION 'Cash Transfer must be posted at the expected revision before bank linking' USING ERRCODE='40001';END IF;account:=CASE p_leg WHEN 'SOURCE' THEN t.from_account_code ELSE t.to_account_code END;bank:=CASE p_leg WHEN 'SOURCE' THEN t.from_bank_member_ref ELSE t.to_bank_member_ref END;
 SELECT jl.journal_line_id,ll.ledger_line_id INTO line_id,ledger_id FROM journal_line jl JOIN ledger_line ll ON ll.tenant_id=jl.tenant_id AND ll.entity_id=jl.entity_id AND ll.journal_entry_id=jl.journal_entry_id AND ll.journal_line_id=jl.journal_line_id WHERE jl.tenant_id=p_tenant AND jl.entity_id=p_entity AND jl.journal_entry_id=t.journal_entry_id AND jl.account_code=account AND jl.member_ref=bank AND((p_leg='SOURCE' AND jl.credit_amount=t.amount AND jl.debit_amount=0) OR(p_leg='DESTINATION' AND jl.debit_amount=t.amount AND jl.credit_amount=0)) FOR SHARE;IF line_id IS NULL THEN RAISE EXCEPTION 'Cash Transfer exact posted cash ledger leg is missing' USING ERRCODE='23514';END IF;
 INSERT INTO cash_transfer_internal_gate VALUES(pg_backend_pid(),txid_current(),p_tenant,p_transfer,'BANK_LINK',link_id,'PENDING');INSERT INTO cash_transfer_bank_link(cash_transfer_bank_link_id,tenant_id,entity_id,cash_transfer_id,leg,bank_source_id,status,linked_by) VALUES(link_id,p_tenant,p_entity,p_transfer,p_leg,p_bank_source,'PENDING',actor);INSERT INTO cash_transfer_internal_gate VALUES(pg_backend_pid(),txid_current(),p_tenant,p_transfer,'BANK_LINK',link_id,'ACTIVE');UPDATE cash_transfer_bank_link SET status='ACTIVE',journal_line_id=line_id,ledger_line_id=ledger_id WHERE tenant_id=p_tenant AND entity_id=p_entity AND cash_transfer_bank_link_id=link_id;
 payload:=jsonb_build_object('cash_transfer_bank_link_id',link_id,'cash_transfer_id',p_transfer,'leg',p_leg,'status','ACTIVE','idempotent',false);INSERT INTO audit_event(tenant_id,entity_id,event_type,object_type,object_id,action,actor_id,actor_type,permission_used,request_id,correlation_id,idempotency_key,after_hash,metadata) VALUES(p_tenant,p_entity,'CASH_TRANSFER_BANK_LINKED','CASH_TRANSFER_BANK_LINK',link_id,'LINK',actor,'USER','CASH.TRANSFER.RECONCILE',p_idempotency_key,p_idempotency_key,p_idempotency_key,refs_jsonb_hash(payload),payload);INSERT INTO outbox_event(tenant_id,entity_id,aggregate_type,aggregate_id,event_type,payload,payload_hash) VALUES(p_tenant,p_entity,'CASH_TRANSFER_BANK_LINK',link_id,'CASH_TRANSFER_BANK_LINKED',payload,refs_jsonb_hash(payload));PERFORM refs_complete_cash_transfer_idempotency(p_tenant,'CASH_TRANSFER_LINK:'||p_entity,idem.idempotency_receipt_id,actor,201,payload);RETURN payload;
END;$$;

CREATE FUNCTION refs_cancel_cash_transfer_hash(p_tenant uuid,p_entity uuid,p_transfer uuid,p_expected_revision bigint,p_expected_journal_revision bigint,p_reason text) RETURNS text LANGUAGE sql IMMUTABLE SET search_path=pg_catalog,public,pg_temp AS $$ SELECT refs_jsonb_hash(jsonb_build_object('schema_version','CASH_TRANSFER_CANCEL_V1','tenant_id',p_tenant,'entity_id',p_entity,'cash_transfer_id',p_transfer,'expected_revision',p_expected_revision,'expected_journal_revision',p_expected_journal_revision,'reason',btrim(p_reason))) $$;
CREATE FUNCTION refs_cancel_cash_transfer(p_tenant uuid,p_entity uuid,p_transfer uuid,p_expected_revision bigint,p_expected_journal_revision bigint,p_reason text,p_idempotency_key text,p_request_hash text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE actor text:=refs_current_actor();t cash_transfer;idem idempotency_receipt;j journal_entry;child_hash text;child jsonb;payload jsonb;
BEGIN
 PERFORM refs_assert_scope(p_tenant,p_entity,'CASH.TRANSFER.CANCEL');IF actor IS NULL OR p_expected_revision IS NULL OR p_expected_journal_revision IS NULL OR length(btrim(coalesce(p_reason,''))) NOT BETWEEN 8 AND 2000 OR length(coalesce(p_idempotency_key,'')) NOT BETWEEN 8 AND 200 OR p_request_hash IS DISTINCT FROM refs_cancel_cash_transfer_hash(p_tenant,p_entity,p_transfer,p_expected_revision,p_expected_journal_revision,p_reason) THEN RAISE EXCEPTION 'Invalid Cash Transfer cancellation command' USING ERRCODE='22023'; END IF;
 idem:=refs_reserve_idempotency(p_tenant,'CASH_TRANSFER_CANCEL:'||p_entity,p_idempotency_key,p_request_hash,actor);IF idem.status='SUCCEEDED' THEN RETURN idem.response_body||jsonb_build_object('idempotent',true); END IF;
 SELECT * INTO t FROM cash_transfer WHERE tenant_id=p_tenant AND entity_id=p_entity AND cash_transfer_id=p_transfer FOR UPDATE;SELECT * INTO j FROM journal_entry WHERE tenant_id=p_tenant AND entity_id=p_entity AND journal_entry_id=t.journal_entry_id FOR UPDATE;
 IF t.cash_transfer_id IS NULL OR t.status IN('POSTED','CANCELLED') OR t.revision<>p_expected_revision OR j.revision<>p_expected_journal_revision OR actor=t.created_by THEN RAISE EXCEPTION 'Cash Transfer cancellation state or segregation-of-duties conflict' USING ERRCODE='40001'; END IF;
 IF j.status<>'DRAFT' THEN PERFORM refs_assert_scope(p_tenant,p_entity,'GL.JE.REJECT');INSERT INTO cash_transfer_internal_gate VALUES(pg_backend_pid(),txid_current(),p_tenant,p_transfer,'JOURNAL',t.journal_entry_id,'DRAFT');child_hash:=refs_journal_transition_hash(p_tenant,p_entity,t.journal_entry_id,'REJECT',p_expected_journal_revision,btrim(p_reason));child:=refs_transition_journal(p_tenant,p_entity,t.journal_entry_id,'REJECT',p_expected_journal_revision,btrim(p_reason),'cash-transfer:'||p_transfer||':CANCEL:'||p_idempotency_key,child_hash); ELSE child:=jsonb_build_object('journal_entry_id',t.journal_entry_id,'status','DRAFT','revision',j.revision); END IF;
 INSERT INTO cash_transfer_internal_gate VALUES(pg_backend_pid(),txid_current(),p_tenant,p_transfer,'TRANSFER',p_transfer,'CANCELLED');UPDATE cash_transfer SET status='CANCELLED',revision=revision+1,cancelled_by=actor,cancelled_at=clock_timestamp(),cancel_reason=btrim(p_reason) WHERE tenant_id=p_tenant AND entity_id=p_entity AND cash_transfer_id=p_transfer;
 payload:=jsonb_build_object('cash_transfer_id',p_transfer,'journal',child,'status','CANCELLED','revision',p_expected_revision+1,'idempotent',false);INSERT INTO audit_event(tenant_id,entity_id,event_type,object_type,object_id,action,actor_id,actor_type,permission_used,request_id,correlation_id,idempotency_key,after_hash,reason,metadata) VALUES(p_tenant,p_entity,'CASH_TRANSFER_CANCELLED','CASH_TRANSFER',p_transfer,'CANCEL',actor,'USER','CASH.TRANSFER.CANCEL',p_idempotency_key,p_idempotency_key,p_idempotency_key,refs_jsonb_hash(payload),btrim(p_reason),payload);INSERT INTO outbox_event(tenant_id,entity_id,aggregate_type,aggregate_id,event_type,payload,payload_hash) VALUES(p_tenant,p_entity,'CASH_TRANSFER',p_transfer,'CASH_TRANSFER_CANCELLED',payload,refs_jsonb_hash(payload));PERFORM refs_complete_cash_transfer_idempotency(p_tenant,'CASH_TRANSFER_CANCEL:'||p_entity,idem.idempotency_receipt_id,actor,200,payload);RETURN payload;
END;$$;

CREATE FUNCTION refs_guard_cash_transfer_journal() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE t cash_transfer;gate integer;
BEGIN
 IF TG_OP='DELETE' THEN IF EXISTS(SELECT 1 FROM cash_transfer x WHERE x.tenant_id=OLD.tenant_id AND x.entity_id=OLD.entity_id AND x.journal_entry_id=OLD.journal_entry_id) THEN RAISE EXCEPTION 'Cash Transfer journal is retained evidence' USING ERRCODE='55000'; END IF;RETURN OLD; END IF;
 SELECT * INTO t FROM cash_transfer WHERE tenant_id=NEW.tenant_id AND entity_id=NEW.entity_id AND journal_entry_id=NEW.journal_entry_id FOR UPDATE;IF NOT FOUND THEN RETURN NEW; END IF;
 IF NEW.status IS NOT DISTINCT FROM OLD.status OR (NEW.tenant_id,NEW.entity_id,NEW.period_id,NEW.journal_entry_id,NEW.journal_number,NEW.journal_type,NEW.journal_date,NEW.currency,NEW.description,NEW.created_by,NEW.created_at,NEW.reversal_of_id,NEW.reclass_of_id) IS DISTINCT FROM (OLD.tenant_id,OLD.entity_id,OLD.period_id,OLD.journal_entry_id,OLD.journal_number,OLD.journal_type,OLD.journal_date,OLD.currency,OLD.description,OLD.created_by,OLD.created_at,OLD.reversal_of_id,OLD.reclass_of_id) THEN RAISE EXCEPTION 'Cash Transfer journal header is immutable' USING ERRCODE='55000'; END IF;
 DELETE FROM cash_transfer_internal_gate WHERE backend_pid=pg_backend_pid() AND transaction_id=txid_current() AND tenant_id=NEW.tenant_id AND cash_transfer_id=t.cash_transfer_id AND resource_kind='JOURNAL' AND resource_id=NEW.journal_entry_id AND operation=NEW.status RETURNING 1 INTO gate;IF gate IS NULL THEN RAISE EXCEPTION 'Cash Transfer journal must transition through its aggregate' USING ERRCODE='0A000'; END IF;RETURN NEW;
END;$$;
CREATE TRIGGER cash_transfer_journal_guard BEFORE UPDATE OR DELETE ON journal_entry FOR EACH ROW EXECUTE FUNCTION refs_guard_cash_transfer_journal();
CREATE FUNCTION refs_protect_cash_transfer() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE gate integer;
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Cash Transfer evidence is immutable' USING ERRCODE='55000'; END IF;
 DELETE FROM cash_transfer_internal_gate WHERE backend_pid=pg_backend_pid() AND transaction_id=txid_current() AND tenant_id=NEW.tenant_id AND cash_transfer_id=NEW.cash_transfer_id AND resource_kind='TRANSFER' AND resource_id=NEW.cash_transfer_id AND operation=NEW.status RETURNING 1 INTO gate;
 IF gate IS NULL OR NEW.revision<>OLD.revision+1 OR (NEW.tenant_id,NEW.entity_id,NEW.period_id,NEW.transfer_date,NEW.currency,NEW.from_account_code,NEW.from_bank_member_ref,NEW.to_account_code,NEW.to_bank_member_ref,NEW.from_bank_account_control_id,NEW.to_bank_account_control_id,NEW.amount,NEW.journal_entry_id,NEW.attachment_ids,NEW.attachment_snapshot_hash,NEW.reason,NEW.created_by,NEW.created_at,NEW.evidence_hash) IS DISTINCT FROM (OLD.tenant_id,OLD.entity_id,OLD.period_id,OLD.transfer_date,OLD.currency,OLD.from_account_code,OLD.from_bank_member_ref,OLD.to_account_code,OLD.to_bank_member_ref,OLD.from_bank_account_control_id,OLD.to_bank_account_control_id,OLD.amount,OLD.journal_entry_id,OLD.attachment_ids,OLD.attachment_snapshot_hash,OLD.reason,OLD.created_by,OLD.created_at,OLD.evidence_hash) OR NOT(OLD.status='DRAFT' AND NEW.status IN('PENDING_REVIEW','CANCELLED') OR OLD.status='PENDING_REVIEW' AND NEW.status IN('PENDING_APPROVAL','CANCELLED') OR OLD.status='PENDING_APPROVAL' AND NEW.status IN('APPROVED','CANCELLED') OR OLD.status='APPROVED' AND NEW.status IN('POSTED','CANCELLED')) THEN RAISE EXCEPTION 'Cash Transfer lifecycle evidence is immutable' USING ERRCODE='55000'; END IF;
 RETURN NEW;
END;$$;
CREATE TRIGGER cash_transfer_protect BEFORE UPDATE OR DELETE ON cash_transfer FOR EACH ROW EXECUTE FUNCTION refs_protect_cash_transfer();

REVOKE ALL ON FUNCTION refs_cash_transfer_attachment_snapshot(uuid,uuid,uuid[]),refs_create_cash_transfer_hash(uuid,uuid,uuid,date,char(3),text,text,text,text,numeric,text,uuid[],text,text),refs_create_cash_transfer(uuid,uuid,uuid,date,char(3),text,text,text,text,numeric,text,uuid[],text,text,text,text),refs_cash_transfer_transition_hash(uuid,uuid,uuid,text,bigint,bigint,text),refs_transition_cash_transfer(uuid,uuid,uuid,text,bigint,bigint,text,text,text),refs_post_cash_transfer_hash(uuid,uuid,uuid,bigint,bigint),refs_post_cash_transfer(uuid,uuid,uuid,bigint,bigint,text,text),refs_cancel_cash_transfer_hash(uuid,uuid,uuid,bigint,bigint,text),refs_cancel_cash_transfer(uuid,uuid,uuid,bigint,bigint,text,text,text),refs_guard_cash_transfer_journal(),refs_protect_cash_transfer() FROM PUBLIC,refs_app;
REVOKE ALL ON FUNCTION refs_guard_cash_transfer_bank_link() FROM PUBLIC,refs_app;
REVOKE ALL ON FUNCTION refs_guard_cash_transfer_bank_account_control(),refs_complete_cash_transfer_idempotency(uuid,text,uuid,text,integer,jsonb),refs_create_cash_transfer_bank_account_control(uuid,uuid,text,text,char(3),date,date,text,text),refs_approve_cash_transfer_bank_account_control(uuid,uuid,uuid,bigint,text,text),refs_retire_cash_transfer_bank_account_control(uuid,uuid,uuid,bigint,text,text),refs_read_cash_transfer_bank_account_controls(uuid,uuid,date),refs_link_cash_transfer_bank_leg(uuid,uuid,uuid,text,uuid,bigint,text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION refs_create_cash_transfer_bank_account_control(uuid,uuid,text,text,char(3),date,date,text,text),refs_approve_cash_transfer_bank_account_control(uuid,uuid,uuid,bigint,text,text),refs_retire_cash_transfer_bank_account_control(uuid,uuid,uuid,bigint,text,text),refs_read_cash_transfer_bank_account_controls(uuid,uuid,date),refs_link_cash_transfer_bank_leg(uuid,uuid,uuid,text,uuid,bigint,text,text) TO refs_app;
GRANT EXECUTE ON FUNCTION refs_create_cash_transfer_hash(uuid,uuid,uuid,date,char(3),text,text,text,text,numeric,text,uuid[],text,text),refs_create_cash_transfer(uuid,uuid,uuid,date,char(3),text,text,text,text,numeric,text,uuid[],text,text,text,text),refs_cash_transfer_transition_hash(uuid,uuid,uuid,text,bigint,bigint,text),refs_transition_cash_transfer(uuid,uuid,uuid,text,bigint,bigint,text,text,text),refs_post_cash_transfer_hash(uuid,uuid,uuid,bigint,bigint),refs_post_cash_transfer(uuid,uuid,uuid,bigint,bigint,text,text),refs_cancel_cash_transfer_hash(uuid,uuid,uuid,bigint,bigint,text),refs_cancel_cash_transfer(uuid,uuid,uuid,bigint,bigint,text,text,text) TO refs_app;
COMMIT;
