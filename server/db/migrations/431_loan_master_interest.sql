BEGIN;

-- P07 / ADR-P07: loan master, approved draws, a deterministic interest accrual
-- computation, and a controlled Draft journal for the computed interest.
--
-- What exists before this migration is entirely read-side: 078 and 363 roll
-- forward accounts an APPROVED CONSTRUCTION_LOAN_ACCOUNT_CLASSIFICATION mapping
-- admits, and 199/200/219/232/247/248/259/283/296 are AI proposal and evidence
-- reads.  There is no loan object, no rate, no draw, no accrual, and therefore
-- no way to say what interest *should* be, only what somebody posted.
--
-- This migration adds the master data an accrual needs and computes the accrual
-- arithmetically from it.  The computation is pure: outstanding drawn principal
-- per day x rate / day-count basis, summed over the days of the period, split
-- into the capitalisation window and the rest.  No estimate, no AI, no policy
-- choice is embedded: everything that is a policy (which days capitalise, which
-- accounts, which rate) is an approved master field or an approved mapping.
--
-- Nothing posts.  The interest command creates a MANUAL Draft journal and stops.

INSERT INTO permission_catalog(permission_code,domain,risk_class,sod_class) VALUES
  ('LOAN.MASTER.VIEW','LOAN','LOW','READ'),
  ('LOAN.MASTER.CREATE','LOAN','HIGH','LOAN_MASTER_MAKER'),
  ('LOAN.MASTER.APPROVE','LOAN','HIGH','LOAN_MASTER_APPROVER'),
  ('LOAN.INTEREST.DRAFT','LOAN','HIGH','LOAN_INTEREST_MAKER')
ON CONFLICT(permission_code) DO UPDATE SET active=true,version=permission_catalog.version+1,effective_to=NULL;
INSERT INTO runtime_human_permission_authority(permission_code,authority_class) VALUES
  ('LOAN.MASTER.CREATE','DRAFT'),('LOAN.MASTER.APPROVE','APPROVE'),('LOAN.INTEREST.DRAFT','DRAFT')
ON CONFLICT(permission_code) DO NOTHING;

CREATE TABLE loan_master(
  loan_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant(tenant_id),
  entity_id uuid NOT NULL,
  loan_ref text NOT NULL CHECK(loan_ref=btrim(loan_ref) AND loan_ref~'^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$'),
  lender_member_ref text NOT NULL CHECK(lender_member_ref=btrim(lender_member_ref) AND length(lender_member_ref) BETWEEN 1 AND 128),
  facility_amount numeric(20,4) NOT NULL CHECK(facility_amount>0),
  currency char(3) NOT NULL CHECK(currency~'^[A-Z]{3}$'),
  -- annual nominal rate as a decimal fraction, e.g. 0.075000 = 7.5%
  annual_rate numeric(9,6) NOT NULL CHECK(annual_rate>=0 AND annual_rate<1),
  day_count_basis text NOT NULL CHECK(day_count_basis IN('ACT_360','ACT_365')),
  -- the capitalisation window is a declared, approved fact, not a judgement the
  -- kernel makes; outside it interest is expensed
  capitalization_start date,
  capitalization_end date,
  project_ref text CHECK(project_ref IS NULL OR project_ref~'^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$'),
  cwip_account_code text,
  interest_expense_account_code text NOT NULL,
  accrued_interest_account_code text NOT NULL,
  status text NOT NULL DEFAULT 'DRAFT' CHECK(status IN('DRAFT','APPROVED','RETIRED')),
  revision integer NOT NULL DEFAULT 0 CHECK(revision>=0),
  created_by text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  approved_by text,
  approved_at timestamptz,
  retired_by text,
  retired_at timestamptz,
  FOREIGN KEY(tenant_id,entity_id) REFERENCES entity(tenant_id,entity_id),
  UNIQUE(tenant_id,entity_id,loan_ref),
  CHECK(capitalization_start IS NULL OR capitalization_end IS NULL OR capitalization_end>=capitalization_start),
  -- a capitalisation window is meaningless without somewhere to capitalise to
  CHECK((capitalization_start IS NULL AND capitalization_end IS NULL AND cwip_account_code IS NULL AND project_ref IS NULL)
     OR (capitalization_start IS NOT NULL AND cwip_account_code IS NOT NULL AND project_ref IS NOT NULL)),
  CHECK((status='DRAFT' AND approved_by IS NULL) OR (status<>'DRAFT' AND approved_by IS NOT NULL AND approved_at IS NOT NULL)),
  CHECK((status='RETIRED')=(retired_by IS NOT NULL)),
  CHECK(approved_by IS NULL OR approved_by<>created_by)
);

-- A draw is the event that changes outstanding principal.  Positive amounts are
-- advances, negative amounts are principal repayments; both are approved facts.
CREATE TABLE loan_draw(
  loan_draw_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant(tenant_id),
  entity_id uuid NOT NULL,
  loan_id uuid NOT NULL REFERENCES loan_master(loan_id),
  draw_ref text NOT NULL CHECK(draw_ref=btrim(draw_ref) AND draw_ref~'^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$'),
  draw_date date NOT NULL,
  amount numeric(20,4) NOT NULL CHECK(amount<>0),
  status text NOT NULL DEFAULT 'DRAFT' CHECK(status IN('DRAFT','APPROVED','RETIRED')),
  revision integer NOT NULL DEFAULT 0 CHECK(revision>=0),
  created_by text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  approved_by text,
  approved_at timestamptz,
  retired_by text,
  retired_at timestamptz,
  UNIQUE(tenant_id,entity_id,loan_id,draw_ref),
  CHECK((status='DRAFT' AND approved_by IS NULL) OR (status<>'DRAFT' AND approved_by IS NOT NULL AND approved_at IS NOT NULL)),
  CHECK((status='RETIRED')=(retired_by IS NOT NULL)),
  CHECK(approved_by IS NULL OR approved_by<>created_by)
);
CREATE INDEX loan_draw_loan_idx ON loan_draw(tenant_id,entity_id,loan_id,draw_date);

CREATE TABLE loan_master_event(
  loan_master_event_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant(tenant_id),
  entity_id uuid NOT NULL,
  object_type text NOT NULL CHECK(object_type IN('LOAN','DRAW')),
  object_id uuid NOT NULL,
  event_type text NOT NULL CHECK(event_type IN('CREATED','APPROVED','RETIRED')),
  revision_after integer NOT NULL CHECK(revision_after>=0),
  actor_id text NOT NULL,
  reason text NOT NULL CHECK(length(btrim(reason)) BETWEEN 8 AND 2000),
  snapshot jsonb NOT NULL CHECK(jsonb_typeof(snapshot)='object'),
  snapshot_hash text NOT NULL CHECK(snapshot_hash~'^sha256:[0-9a-f]{64}$'),
  recorded_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX loan_master_event_object_idx ON loan_master_event(tenant_id,entity_id,object_type,object_id,recorded_at);
CREATE TRIGGER loan_master_event_append_only BEFORE UPDATE OR DELETE ON loan_master_event FOR EACH ROW EXECUTE FUNCTION reject_mutation();

CREATE TABLE loan_interest_draft_binding(
  loan_interest_draft_binding_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant(tenant_id),
  entity_id uuid NOT NULL,
  loan_id uuid NOT NULL REFERENCES loan_master(loan_id),
  period_id uuid NOT NULL,
  journal_entry_id uuid NOT NULL,
  capitalized_amount numeric(20,4) NOT NULL CHECK(capitalized_amount>=0),
  expensed_amount numeric(20,4) NOT NULL CHECK(expensed_amount>=0),
  computation jsonb NOT NULL CHECK(jsonb_typeof(computation)='object'),
  computation_hash text NOT NULL CHECK(computation_hash~'^sha256:[0-9a-f]{64}$'),
  created_by text NOT NULL,
  reason text NOT NULL CHECK(length(btrim(reason)) BETWEEN 8 AND 2000),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CHECK(capitalized_amount+expensed_amount>0),
  UNIQUE(tenant_id,journal_entry_id),
  -- one interest Draft per loan per period; a second one must wait for the
  -- first to be rejected or reversed, so an accrual cannot be booked twice
  UNIQUE(tenant_id,entity_id,loan_id,period_id)
);
CREATE TRIGGER loan_interest_draft_binding_append_only BEFORE UPDATE OR DELETE ON loan_interest_draft_binding FOR EACH ROW EXECUTE FUNCTION reject_mutation();

CREATE FUNCTION refs_loan_master_snapshot(p_type text,p_id uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE snap jsonb;
BEGIN
  IF p_type='LOAN' THEN SELECT to_jsonb(l)-'created_at'-'approved_at'-'retired_at' INTO snap FROM loan_master l WHERE loan_id=p_id;
  ELSIF p_type='DRAW' THEN SELECT to_jsonb(d)-'created_at'-'approved_at'-'retired_at' INTO snap FROM loan_draw d WHERE loan_draw_id=p_id;
  END IF;
  IF snap IS NULL THEN RAISE EXCEPTION 'Loan master object missing' USING ERRCODE='P0002'; END IF;
  RETURN snap;
END;$$;

CREATE FUNCTION refs_record_loan_master_event(p_tenant uuid,p_entity uuid,p_type text,p_id uuid,p_event text,p_reason text,p_permission text,p_key text) RETURNS jsonb
LANGUAGE plpgsql SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE snap jsonb:=refs_loan_master_snapshot(p_type,p_id); h text; actor text:=refs_current_actor();
BEGIN
  h:=refs_jsonb_hash(snap);
  INSERT INTO loan_master_event(tenant_id,entity_id,object_type,object_id,event_type,revision_after,actor_id,reason,snapshot,snapshot_hash)
  VALUES(p_tenant,p_entity,p_type,p_id,p_event,(snap->>'revision')::integer,actor,btrim(p_reason),snap,h);
  INSERT INTO audit_event(tenant_id,entity_id,event_type,object_type,object_id,action,actor_id,actor_type,permission_used,request_id,correlation_id,idempotency_key,after_hash,reason,metadata)
  VALUES(p_tenant,p_entity,'LOAN_MASTER_'||p_event,'LOAN_'||p_type,p_id,CASE p_event WHEN 'CREATED' THEN 'CREATE' ELSE 'UPDATE' END,actor,'USER',p_permission,p_key,p_key,p_key,h,btrim(p_reason),snap);
  RETURN snap||jsonb_build_object('snapshot_hash',h);
END;$$;

CREATE FUNCTION refs_create_loan_master_hash(
  p_tenant uuid,p_entity uuid,p_ref text,p_lender text,p_facility numeric,p_currency text,p_rate numeric,p_basis text,
  p_cap_start date,p_cap_end date,p_project_ref text,p_cwip text,p_interest text,p_accrued text,p_reason text
) RETURNS text LANGUAGE sql IMMUTABLE SET search_path=pg_catalog,public,pg_temp AS $$
  SELECT refs_jsonb_hash(jsonb_build_object('op','LOAN_MASTER_CREATE','tenant_id',p_tenant,'entity_id',p_entity,'loan_ref',btrim(p_ref),
    'lender_member_ref',btrim(p_lender),'facility_amount',to_char(p_facility,'FM999999999999999990.0000'),'currency',upper(p_currency),
    'annual_rate',to_char(p_rate,'FM990.000000'),'day_count_basis',p_basis,'capitalization_start',p_cap_start,'capitalization_end',p_cap_end,
    'project_ref',p_project_ref,'cwip_account_code',p_cwip,'interest_expense_account_code',btrim(p_interest),
    'accrued_interest_account_code',btrim(p_accrued),'reason',btrim(p_reason)))
$$;

CREATE FUNCTION refs_create_loan_master(
  p_tenant uuid,p_entity uuid,p_ref text,p_lender text,p_facility numeric,p_currency text,p_rate numeric,p_basis text,
  p_cap_start date,p_cap_end date,p_project_ref text,p_cwip text,p_interest text,p_accrued text,p_reason text,p_key text,p_hash text
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE actor text:=refs_current_actor(); idem idempotency_receipt; lid uuid; payload jsonb; scope text:='LOAN_MASTER_CREATE:'||p_entity;
BEGIN
  PERFORM refs_assert_scope(p_tenant,p_entity,'LOAN.MASTER.CREATE');
  IF actor IS NULL THEN RAISE EXCEPTION 'Authenticated loan master maker missing' USING ERRCODE='42501'; END IF;
  IF p_hash IS DISTINCT FROM refs_create_loan_master_hash(p_tenant,p_entity,p_ref,p_lender,p_facility,p_currency,p_rate,p_basis,p_cap_start,p_cap_end,p_project_ref,p_cwip,p_interest,p_accrued,p_reason)
     OR length(btrim(coalesce(p_reason,''))) NOT BETWEEN 8 AND 2000 OR length(coalesce(p_key,'')) NOT BETWEEN 8 AND 200
  THEN RAISE EXCEPTION 'Invalid loan master command' USING ERRCODE='22023'; END IF;
  INSERT INTO idempotency_receipt(tenant_id,operation_scope,idempotency_key,request_hash,status,actor_id) VALUES(p_tenant,scope,p_key,p_hash,'IN_PROGRESS',actor) ON CONFLICT(tenant_id,operation_scope,idempotency_key) DO NOTHING;
  SELECT * INTO idem FROM idempotency_receipt WHERE tenant_id=p_tenant AND operation_scope=scope AND idempotency_key=p_key FOR UPDATE;
  IF idem.actor_id IS DISTINCT FROM actor OR idem.request_hash IS DISTINCT FROM p_hash THEN RAISE EXCEPTION 'Loan master idempotency conflict' USING ERRCODE='23505'; END IF;
  IF idem.status='SUCCEEDED' THEN RETURN idem.response_body||jsonb_build_object('idempotent',true); END IF;
  PERFORM 1 FROM member_master WHERE tenant_id=p_tenant AND entity_id=p_entity AND member_ref=btrim(p_lender) AND active FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'A loan requires an active scoped lender member' USING ERRCODE='23503'; END IF;
  IF NOT EXISTS(SELECT 1 FROM account_master WHERE tenant_id=p_tenant AND entity_id=p_entity AND account_code=btrim(p_interest) AND active)
     OR NOT EXISTS(SELECT 1 FROM account_master WHERE tenant_id=p_tenant AND entity_id=p_entity AND account_code=btrim(p_accrued) AND active)
     OR (p_cwip IS NOT NULL AND NOT EXISTS(SELECT 1 FROM account_master WHERE tenant_id=p_tenant AND entity_id=p_entity AND account_code=btrim(p_cwip) AND active))
  THEN RAISE EXCEPTION 'Loan accounts must exist and be active in the company chart of accounts' USING ERRCODE='23503'; END IF;
  INSERT INTO loan_master(tenant_id,entity_id,loan_ref,lender_member_ref,facility_amount,currency,annual_rate,day_count_basis,
    capitalization_start,capitalization_end,project_ref,cwip_account_code,interest_expense_account_code,accrued_interest_account_code,created_by)
  VALUES(p_tenant,p_entity,btrim(p_ref),btrim(p_lender),p_facility,upper(p_currency),p_rate,p_basis,p_cap_start,p_cap_end,p_project_ref,
    NULLIF(btrim(coalesce(p_cwip,'')),''),btrim(p_interest),btrim(p_accrued),actor) RETURNING loan_id INTO lid;
  payload:=refs_record_loan_master_event(p_tenant,p_entity,'LOAN',lid,'CREATED',p_reason,'LOAN.MASTER.CREATE',p_key)||jsonb_build_object('schema_version','LOAN_MASTER_V1','idempotent',false);
  UPDATE idempotency_receipt SET status='SUCCEEDED',response_status=201,response_body=payload-'idempotent',completed_at=clock_timestamp() WHERE idempotency_receipt_id=idem.idempotency_receipt_id;
  RETURN payload;
END;$$;

CREATE FUNCTION refs_create_loan_draw_hash(p_tenant uuid,p_entity uuid,p_loan uuid,p_ref text,p_date date,p_amount numeric,p_reason text)
RETURNS text LANGUAGE sql IMMUTABLE SET search_path=pg_catalog,public,pg_temp AS $$
  SELECT refs_jsonb_hash(jsonb_build_object('op','LOAN_DRAW_CREATE','tenant_id',p_tenant,'entity_id',p_entity,'loan_id',p_loan,
    'draw_ref',btrim(p_ref),'draw_date',p_date,'amount',to_char(p_amount,'FM999999999999999990.0000'),'reason',btrim(p_reason)))
$$;

CREATE FUNCTION refs_create_loan_draw(p_tenant uuid,p_entity uuid,p_loan uuid,p_ref text,p_date date,p_amount numeric,p_reason text,p_key text,p_hash text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE actor text:=refs_current_actor(); idem idempotency_receipt; did uuid; payload jsonb; loan loan_master; outstanding numeric(20,4); scope text:='LOAN_DRAW_CREATE:'||p_entity;
BEGIN
  PERFORM refs_assert_scope(p_tenant,p_entity,'LOAN.MASTER.CREATE');
  IF actor IS NULL THEN RAISE EXCEPTION 'Authenticated loan master maker missing' USING ERRCODE='42501'; END IF;
  IF p_hash IS DISTINCT FROM refs_create_loan_draw_hash(p_tenant,p_entity,p_loan,p_ref,p_date,p_amount,p_reason)
     OR p_amount IS NULL OR p_amount=0 OR p_amount<>round(p_amount,4) OR p_date IS NULL
     OR length(btrim(coalesce(p_reason,''))) NOT BETWEEN 8 AND 2000 OR length(coalesce(p_key,'')) NOT BETWEEN 8 AND 200
  THEN RAISE EXCEPTION 'Invalid loan draw command' USING ERRCODE='22023'; END IF;
  INSERT INTO idempotency_receipt(tenant_id,operation_scope,idempotency_key,request_hash,status,actor_id) VALUES(p_tenant,scope,p_key,p_hash,'IN_PROGRESS',actor) ON CONFLICT(tenant_id,operation_scope,idempotency_key) DO NOTHING;
  SELECT * INTO idem FROM idempotency_receipt WHERE tenant_id=p_tenant AND operation_scope=scope AND idempotency_key=p_key FOR UPDATE;
  IF idem.actor_id IS DISTINCT FROM actor OR idem.request_hash IS DISTINCT FROM p_hash THEN RAISE EXCEPTION 'Loan draw idempotency conflict' USING ERRCODE='23505'; END IF;
  IF idem.status='SUCCEEDED' THEN RETURN idem.response_body||jsonb_build_object('idempotent',true); END IF;
  SELECT * INTO loan FROM loan_master WHERE tenant_id=p_tenant AND entity_id=p_entity AND loan_id=p_loan FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Scoped loan missing' USING ERRCODE='P0002'; END IF;
  IF loan.status<>'APPROVED' THEN RAISE EXCEPTION 'Draws require an APPROVED loan' USING ERRCODE='23514'; END IF;
  SELECT COALESCE(sum(amount),0)::numeric(20,4) INTO outstanding FROM loan_draw WHERE tenant_id=p_tenant AND entity_id=p_entity AND loan_id=p_loan AND status='APPROVED';
  IF outstanding+p_amount<0 THEN RAISE EXCEPTION 'A repayment may not drive outstanding principal below zero' USING ERRCODE='23514'; END IF;
  IF outstanding+p_amount>loan.facility_amount THEN RAISE EXCEPTION 'Draws may not exceed the approved facility amount' USING ERRCODE='23514'; END IF;
  INSERT INTO loan_draw(tenant_id,entity_id,loan_id,draw_ref,draw_date,amount,created_by)
  VALUES(p_tenant,p_entity,p_loan,btrim(p_ref),p_date,p_amount,actor) RETURNING loan_draw_id INTO did;
  payload:=refs_record_loan_master_event(p_tenant,p_entity,'DRAW',did,'CREATED',p_reason,'LOAN.MASTER.CREATE',p_key)||jsonb_build_object('schema_version','LOAN_DRAW_V1','idempotent',false);
  UPDATE idempotency_receipt SET status='SUCCEEDED',response_status=201,response_body=payload-'idempotent',completed_at=clock_timestamp() WHERE idempotency_receipt_id=idem.idempotency_receipt_id;
  RETURN payload;
END;$$;

CREATE FUNCTION refs_transition_loan_master_hash(p_tenant uuid,p_entity uuid,p_type text,p_id uuid,p_expected_revision integer,p_event text,p_reason text)
RETURNS text LANGUAGE sql IMMUTABLE SET search_path=pg_catalog,public,pg_temp AS $$
  SELECT refs_jsonb_hash(jsonb_build_object('op','LOAN_MASTER_TRANSITION','tenant_id',p_tenant,'entity_id',p_entity,'object_type',p_type,'object_id',p_id,
    'expected_revision',p_expected_revision,'event',p_event,'reason',btrim(p_reason)))
$$;

CREATE FUNCTION refs_transition_loan_master(p_tenant uuid,p_entity uuid,p_type text,p_id uuid,p_expected_revision integer,p_event text,p_reason text,p_key text,p_hash text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE actor text:=refs_current_actor(); idem idempotency_receipt; payload jsonb; cur_status text; cur_rev integer; creator text; live integer;
  loan_row loan_master; draw_row loan_draw; outstanding numeric(20,4); scope text:='LOAN_MASTER_TRANSITION:'||p_entity;
BEGIN
  PERFORM refs_assert_scope(p_tenant,p_entity,'LOAN.MASTER.APPROVE');
  IF actor IS NULL THEN RAISE EXCEPTION 'Authenticated loan master approver missing' USING ERRCODE='42501'; END IF;
  IF p_type NOT IN('LOAN','DRAW') OR p_event NOT IN('APPROVED','RETIRED') OR p_expected_revision IS NULL
     OR p_hash IS DISTINCT FROM refs_transition_loan_master_hash(p_tenant,p_entity,p_type,p_id,p_expected_revision,p_event,p_reason)
     OR length(btrim(coalesce(p_reason,''))) NOT BETWEEN 8 AND 2000 OR length(coalesce(p_key,'')) NOT BETWEEN 8 AND 200
  THEN RAISE EXCEPTION 'Invalid loan master transition' USING ERRCODE='22023'; END IF;
  INSERT INTO idempotency_receipt(tenant_id,operation_scope,idempotency_key,request_hash,status,actor_id) VALUES(p_tenant,scope,p_key,p_hash,'IN_PROGRESS',actor) ON CONFLICT(tenant_id,operation_scope,idempotency_key) DO NOTHING;
  SELECT * INTO idem FROM idempotency_receipt WHERE tenant_id=p_tenant AND operation_scope=scope AND idempotency_key=p_key FOR UPDATE;
  IF idem.actor_id IS DISTINCT FROM actor OR idem.request_hash IS DISTINCT FROM p_hash THEN RAISE EXCEPTION 'Loan master idempotency conflict' USING ERRCODE='23505'; END IF;
  IF idem.status='SUCCEEDED' THEN RETURN idem.response_body||jsonb_build_object('idempotent',true); END IF;

  IF p_type='LOAN' THEN
    SELECT * INTO loan_row FROM loan_master WHERE tenant_id=p_tenant AND entity_id=p_entity AND loan_id=p_id FOR UPDATE;
    cur_status:=loan_row.status; cur_rev:=loan_row.revision; creator:=loan_row.created_by;
  ELSE
    SELECT * INTO draw_row FROM loan_draw WHERE tenant_id=p_tenant AND entity_id=p_entity AND loan_draw_id=p_id FOR UPDATE;
    cur_status:=draw_row.status; cur_rev:=draw_row.revision; creator:=draw_row.created_by;
  END IF;
  IF cur_status IS NULL THEN RAISE EXCEPTION 'Scoped loan master object missing' USING ERRCODE='P0002'; END IF;
  IF cur_rev<>p_expected_revision THEN RAISE EXCEPTION 'Loan master revision is stale' USING ERRCODE='40001'; END IF;
  IF p_event='APPROVED' THEN
    IF cur_status<>'DRAFT' THEN RAISE EXCEPTION 'Only DRAFT loan master objects can be approved' USING ERRCODE='23514'; END IF;
    IF creator=actor THEN RAISE EXCEPTION 'Loan master maker and approver must be different actors' USING ERRCODE='42501'; END IF;
    IF p_type='DRAW' THEN
      SELECT COALESCE(sum(amount),0)::numeric(20,4) INTO outstanding FROM loan_draw WHERE tenant_id=p_tenant AND entity_id=p_entity AND loan_id=draw_row.loan_id AND status='APPROVED';
      SELECT * INTO loan_row FROM loan_master WHERE loan_id=draw_row.loan_id FOR SHARE;
      IF outstanding+draw_row.amount<0 OR outstanding+draw_row.amount>loan_row.facility_amount THEN
        RAISE EXCEPTION 'Approving this draw would breach the facility or drive principal negative' USING ERRCODE='23514';
      END IF;
    END IF;
  ELSE
    IF cur_status<>'APPROVED' THEN RAISE EXCEPTION 'Only APPROVED loan master objects can be retired' USING ERRCODE='23514'; END IF;
    IF p_type='LOAN' THEN
      SELECT count(*) INTO live FROM loan_draw WHERE loan_id=p_id AND status='APPROVED';
      IF live>0 THEN RAISE EXCEPTION 'Retire APPROVED draws before retiring the loan' USING ERRCODE='23514'; END IF;
    END IF;
  END IF;

  IF p_type='LOAN' THEN
    UPDATE loan_master SET status=p_event,revision=revision+1,
      approved_by=CASE WHEN p_event='APPROVED' THEN actor ELSE approved_by END,approved_at=CASE WHEN p_event='APPROVED' THEN clock_timestamp() ELSE approved_at END,
      retired_by=CASE WHEN p_event='RETIRED' THEN actor END,retired_at=CASE WHEN p_event='RETIRED' THEN clock_timestamp() END WHERE loan_id=p_id;
  ELSE
    UPDATE loan_draw SET status=p_event,revision=revision+1,
      approved_by=CASE WHEN p_event='APPROVED' THEN actor ELSE approved_by END,approved_at=CASE WHEN p_event='APPROVED' THEN clock_timestamp() ELSE approved_at END,
      retired_by=CASE WHEN p_event='RETIRED' THEN actor END,retired_at=CASE WHEN p_event='RETIRED' THEN clock_timestamp() END WHERE loan_draw_id=p_id;
  END IF;
  payload:=refs_record_loan_master_event(p_tenant,p_entity,p_type,p_id,p_event,p_reason,'LOAN.MASTER.APPROVE',p_key)||jsonb_build_object('schema_version','LOAN_MASTER_TRANSITION_V1','idempotent',false);
  UPDATE idempotency_receipt SET status='SUCCEEDED',response_status=200,response_body=payload-'idempotent',completed_at=clock_timestamp() WHERE idempotency_receipt_id=idem.idempotency_receipt_id;
  RETURN payload;
END;$$;

CREATE FUNCTION refs_read_loan_masters(p_tenant uuid,p_entity uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
BEGIN
  PERFORM refs_assert_scope(p_tenant,p_entity,'LOAN.MASTER.VIEW');
  RETURN jsonb_build_object('schema_version','LOAN_MASTERS_V1','accounting_authority','NONE',
    'loans',COALESCE((SELECT jsonb_agg(jsonb_build_object(
      'loan_id',l.loan_id,'loan_ref',l.loan_ref,'lender_member_ref',l.lender_member_ref,'facility_amount',l.facility_amount,'currency',l.currency,
      'annual_rate',l.annual_rate,'day_count_basis',l.day_count_basis,'capitalization_start',l.capitalization_start,'capitalization_end',l.capitalization_end,
      'project_ref',l.project_ref,'cwip_account_code',l.cwip_account_code,'interest_expense_account_code',l.interest_expense_account_code,
      'accrued_interest_account_code',l.accrued_interest_account_code,'status',l.status,'revision',l.revision,'created_by',l.created_by,'approved_by',l.approved_by,
      'outstanding_principal',COALESCE((SELECT sum(d.amount) FROM loan_draw d WHERE d.loan_id=l.loan_id AND d.status='APPROVED'),0)::numeric(20,4),
      'draws',COALESCE((SELECT jsonb_agg(jsonb_build_object('loan_draw_id',d.loan_draw_id,'draw_ref',d.draw_ref,'draw_date',d.draw_date,'amount',d.amount,'status',d.status,'revision',d.revision) ORDER BY d.draw_date,d.draw_ref) FROM loan_draw d WHERE d.loan_id=l.loan_id),'[]'::jsonb)
    ) ORDER BY l.loan_ref) FROM loan_master l WHERE l.tenant_id=p_tenant AND l.entity_id=p_entity),'[]'::jsonb));
END;$$;

-- Deterministic accrual.  For every day of the period:
--   outstanding(day) = sum of APPROVED draws with draw_date <= day
--   interest(day)    = outstanding(day) * annual_rate / basis_days
-- The day is capitalisable when it falls inside the approved capitalisation
-- window; otherwise it is expensed.  Rounding happens once per bucket, at the
-- end, so the two buckets always add up to the rounded total.
-- The computation itself carries no scope assertion: it is called both by the
-- GL.REPORT.VIEW read below and by the LOAN.INTEREST.DRAFT command, which must
-- not require a reporting permission to do its own job.
CREATE FUNCTION refs_compute_loan_interest_accrual(p_tenant uuid,p_entity uuid,p_loan uuid,p_period uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE loan loan_master; period_row accounting_period; basis integer; cap_days integer; exp_days integer;
  cap_raw numeric; exp_raw numeric; cap_amt numeric(20,4); exp_amt numeric(20,4); opening numeric(20,4); closing numeric(20,4);
  drawn_in_period numeric(20,4); computation jsonb; existing jsonb;
BEGIN
  SELECT * INTO loan FROM loan_master WHERE tenant_id=p_tenant AND entity_id=p_entity AND loan_id=p_loan;
  IF NOT FOUND THEN RAISE EXCEPTION 'Scoped loan missing' USING ERRCODE='P0002'; END IF;
  SELECT * INTO period_row FROM accounting_period WHERE tenant_id=p_tenant AND entity_id=p_entity AND period_id=p_period;
  IF NOT FOUND THEN RAISE EXCEPTION 'A valid entity-scoped accounting period is required' USING ERRCODE='22023'; END IF;
  basis:=CASE loan.day_count_basis WHEN 'ACT_360' THEN 360 ELSE 365 END;

  SELECT COALESCE(sum(d.amount),0)::numeric(20,4) INTO opening FROM loan_draw d
    WHERE d.tenant_id=p_tenant AND d.entity_id=p_entity AND d.loan_id=p_loan AND d.status='APPROVED' AND d.draw_date<period_row.starts_on;
  SELECT COALESCE(sum(d.amount),0)::numeric(20,4) INTO closing FROM loan_draw d
    WHERE d.tenant_id=p_tenant AND d.entity_id=p_entity AND d.loan_id=p_loan AND d.status='APPROVED' AND d.draw_date<=period_row.ends_on;
  drawn_in_period:=(closing-opening)::numeric(20,4);

  WITH days AS (SELECT generate_series(period_row.starts_on,period_row.ends_on,interval '1 day')::date AS day),
  daily AS (
    SELECT d.day,
      COALESCE((SELECT sum(x.amount) FROM loan_draw x WHERE x.tenant_id=p_tenant AND x.entity_id=p_entity AND x.loan_id=p_loan AND x.status='APPROVED' AND x.draw_date<=d.day),0)::numeric(20,4) AS outstanding,
      (loan.capitalization_start IS NOT NULL AND d.day>=loan.capitalization_start AND (loan.capitalization_end IS NULL OR d.day<=loan.capitalization_end)) AS capitalizable
    FROM days d
  )
  SELECT COALESCE(sum(outstanding*loan.annual_rate/basis) FILTER(WHERE capitalizable),0),
         COALESCE(sum(outstanding*loan.annual_rate/basis) FILTER(WHERE NOT capitalizable),0),
         count(*) FILTER(WHERE capitalizable)::integer,count(*) FILTER(WHERE NOT capitalizable)::integer
  INTO cap_raw,exp_raw,cap_days,exp_days FROM daily;
  cap_amt:=round(cap_raw,4); exp_amt:=round(exp_raw,4);

  SELECT jsonb_build_object('journal_entry_id',b.journal_entry_id,'capitalized_amount',b.capitalized_amount,'expensed_amount',b.expensed_amount,'computation_hash',b.computation_hash,'journal_status',j.status)
    INTO existing FROM loan_interest_draft_binding b JOIN journal_entry j ON j.journal_entry_id=b.journal_entry_id
    WHERE b.tenant_id=p_tenant AND b.entity_id=p_entity AND b.loan_id=p_loan AND b.period_id=p_period;

  computation:=jsonb_build_object('method','DAILY_SIMPLE_INTEREST_ON_APPROVED_DRAWS','day_count_basis',loan.day_count_basis,'basis_days',basis,
    'annual_rate',to_char(loan.annual_rate,'FM990.000000'),'period_start',period_row.starts_on,'period_end',period_row.ends_on,
    'opening_principal',to_char(opening,'FM999999999999999990.0000'),'closing_principal',to_char(closing,'FM999999999999999990.0000'),
    'drawn_in_period',to_char(drawn_in_period,'FM999999999999999990.0000'),
    'capitalization_start',loan.capitalization_start,'capitalization_end',loan.capitalization_end,
    'capitalizable_days',cap_days,'expensed_days',exp_days,
    'capitalized_amount',to_char(cap_amt,'FM999999999999999990.0000'),'expensed_amount',to_char(exp_amt,'FM999999999999999990.0000'));

  RETURN jsonb_build_object('schema_version','LOAN_INTEREST_ACCRUAL_V1','accounting_authority','NONE','can_post',false,'can_draft',false,
    'loan_id',p_loan,'loan_ref',loan.loan_ref,'loan_status',loan.status,'period_id',p_period,'period_code',period_row.period_code,
    'currency',loan.currency,'capitalized_amount',cap_amt,'expensed_amount',exp_amt,'total_amount',(cap_amt+exp_amt)::numeric(20,4),
    'computation',computation,'computation_hash',refs_jsonb_hash(computation),'existing_draft',existing);
END;$$;

CREATE FUNCTION refs_read_loan_interest_accrual(p_tenant uuid,p_entity uuid,p_loan uuid,p_period uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
BEGIN
  PERFORM refs_assert_scope(p_tenant,p_entity,'GL.REPORT.VIEW');
  RETURN refs_compute_loan_interest_accrual(p_tenant,p_entity,p_loan,p_period);
END;$$;

CREATE FUNCTION refs_create_loan_interest_draft_hash(p_tenant uuid,p_entity uuid,p_loan uuid,p_period uuid,p_number text,p_date date,p_expected_computation_hash text,p_reason text,p_attachments uuid[])
RETURNS text LANGUAGE sql IMMUTABLE SET search_path=pg_catalog,public,pg_temp AS $$
  SELECT refs_jsonb_hash(jsonb_build_object('op','LOAN_INTEREST_DRAFT','tenant_id',p_tenant,'entity_id',p_entity,'loan_id',p_loan,'period_id',p_period,
    'journal_number',btrim(p_number),'journal_date',p_date,'expected_computation_hash',p_expected_computation_hash,'reason',btrim(p_reason),
    'attachment_ids',to_jsonb(ARRAY(SELECT id FROM unnest(p_attachments) id ORDER BY id))))
$$;

-- The maker must echo the computation hash they reviewed; if any approved draw,
-- rate or window changed since, the hash differs and the command refuses (40001).
-- The amounts are taken from the computation, never from the request.
CREATE FUNCTION refs_create_loan_interest_draft(
  p_tenant uuid,p_entity uuid,p_loan uuid,p_period uuid,p_number text,p_date date,p_expected_computation_hash text,p_reason text,p_attachments uuid[],p_key text,p_hash text
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE actor text:=refs_current_actor(); idem idempotency_receipt; scope text:='LOAN_INTEREST_DRAFT:'||p_entity;
  loan loan_master; accrual jsonb; cap_amt numeric(20,4); exp_amt numeric(20,4); lines jsonb; line_no integer:=0;
  inner_hash text; journal jsonb; journal_id uuid; binding uuid:=gen_random_uuid(); payload jsonb; cwip_class text; cwip_n integer; dims jsonb;
BEGIN
  PERFORM refs_assert_scope(p_tenant,p_entity,'LOAN.INTEREST.DRAFT');
  PERFORM refs_assert_scope(p_tenant,p_entity,'GL.JE.CREATE');
  IF actor IS NULL THEN RAISE EXCEPTION 'Authenticated loan interest maker missing' USING ERRCODE='42501'; END IF;
  IF p_hash IS DISTINCT FROM refs_create_loan_interest_draft_hash(p_tenant,p_entity,p_loan,p_period,p_number,p_date,p_expected_computation_hash,p_reason,p_attachments)
     OR p_expected_computation_hash !~ '^sha256:[0-9a-f]{64}$' OR p_date IS NULL
     OR length(btrim(coalesce(p_reason,''))) NOT BETWEEN 8 AND 2000 OR length(coalesce(p_key,'')) NOT BETWEEN 8 AND 200
     OR COALESCE(cardinality(p_attachments),0)<1
  THEN RAISE EXCEPTION 'Invalid loan interest command' USING ERRCODE='22023'; END IF;

  INSERT INTO idempotency_receipt(tenant_id,operation_scope,idempotency_key,request_hash,status,actor_id) VALUES(p_tenant,scope,p_key,p_hash,'IN_PROGRESS',actor) ON CONFLICT(tenant_id,operation_scope,idempotency_key) DO NOTHING;
  SELECT * INTO idem FROM idempotency_receipt WHERE tenant_id=p_tenant AND operation_scope=scope AND idempotency_key=p_key FOR UPDATE;
  IF idem.actor_id IS DISTINCT FROM actor OR idem.request_hash IS DISTINCT FROM p_hash THEN RAISE EXCEPTION 'Loan interest idempotency conflict' USING ERRCODE='23505'; END IF;
  IF idem.status='SUCCEEDED' THEN RETURN idem.response_body||jsonb_build_object('idempotent',true); END IF;

  SELECT * INTO loan FROM loan_master WHERE tenant_id=p_tenant AND entity_id=p_entity AND loan_id=p_loan FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Scoped loan missing' USING ERRCODE='P0002'; END IF;
  IF loan.status<>'APPROVED' THEN RAISE EXCEPTION 'Interest accrual requires an APPROVED loan' USING ERRCODE='23514'; END IF;
  accrual:=refs_compute_loan_interest_accrual(p_tenant,p_entity,p_loan,p_period);
  IF accrual->>'computation_hash' IS DISTINCT FROM p_expected_computation_hash THEN
    RAISE EXCEPTION 'The reviewed interest computation changed before the Draft was created' USING ERRCODE='40001';
  END IF;
  cap_amt:=(accrual->>'capitalized_amount')::numeric(20,4); exp_amt:=(accrual->>'expensed_amount')::numeric(20,4);
  IF cap_amt+exp_amt<=0 THEN RAISE EXCEPTION 'There is no interest to accrue for this loan and period' USING ERRCODE='23514'; END IF;
  IF cap_amt>0 THEN
    SELECT c.classification,c.candidate_count INTO cwip_class,cwip_n FROM refs_cwip_account_class(p_tenant,p_entity,loan.cwip_account_code,p_date) c;
    IF cwip_n IS DISTINCT FROM 1 OR cwip_class IS DISTINCT FROM 'CWIP' THEN
      RAISE EXCEPTION 'Capitalised interest requires the loan CWIP account to carry one approved CWIP classification' USING ERRCODE='23514';
    END IF;
  END IF;

  dims:=CASE WHEN loan.project_ref IS NULL THEN '{}'::jsonb ELSE jsonb_build_object('project_ref',loan.project_ref) END;
  lines:='[]'::jsonb;
  IF cap_amt>0 THEN line_no:=line_no+1;
    lines:=lines||jsonb_build_array(jsonb_build_object('line_no',line_no,'account_code',loan.cwip_account_code,'debit_amount',cap_amt,'credit_amount',0,'member_ref',NULL,'dimensions',dims));
  END IF;
  IF exp_amt>0 THEN line_no:=line_no+1;
    lines:=lines||jsonb_build_array(jsonb_build_object('line_no',line_no,'account_code',loan.interest_expense_account_code,'debit_amount',exp_amt,'credit_amount',0,'member_ref',NULL,'dimensions',dims));
  END IF;
  line_no:=line_no+1;
  lines:=lines||jsonb_build_array(jsonb_build_object('line_no',line_no,'account_code',loan.accrued_interest_account_code,'debit_amount',0,'credit_amount',(cap_amt+exp_amt)::numeric(20,4),'member_ref',loan.lender_member_ref,'dimensions',dims));

  inner_hash:=refs_create_manual_journal_hash(p_tenant,p_entity,p_period,btrim(p_number),p_date,loan.currency,btrim(p_reason),lines,p_attachments);
  journal:=refs_create_manual_journal(p_tenant,p_entity,p_period,btrim(p_number),p_date,loan.currency,btrim(p_reason),lines,p_attachments,'loan-interest:'||binding,inner_hash);
  journal_id:=(journal->>'journal_entry_id')::uuid;

  INSERT INTO loan_interest_draft_binding(loan_interest_draft_binding_id,tenant_id,entity_id,loan_id,period_id,journal_entry_id,
    capitalized_amount,expensed_amount,computation,computation_hash,created_by,reason)
  VALUES(binding,p_tenant,p_entity,p_loan,p_period,journal_id,cap_amt,exp_amt,accrual->'computation',p_expected_computation_hash,actor,btrim(p_reason));

  payload:=journal||jsonb_build_object('schema_version','LOAN_INTEREST_DRAFT_V1','loan_interest_draft_binding_id',binding,'loan_id',p_loan,'loan_ref',loan.loan_ref,
    'capitalized_amount',to_char(cap_amt,'FM999999999999999990.0000'),'expensed_amount',to_char(exp_amt,'FM999999999999999990.0000'),
    'total_amount',to_char((cap_amt+exp_amt)::numeric(20,4),'FM999999999999999990.0000'),'computation_hash',p_expected_computation_hash);
  INSERT INTO audit_event(tenant_id,entity_id,event_type,object_type,object_id,action,actor_id,actor_type,permission_used,request_id,correlation_id,idempotency_key,after_hash,reason,metadata)
  VALUES(p_tenant,p_entity,'LOAN_INTEREST_DRAFT_CREATED','JOURNAL_ENTRY',journal_id,'CREATE',actor,'USER','LOAN.INTEREST.DRAFT',p_key,p_key,p_key,refs_jsonb_hash(payload),btrim(p_reason),payload);
  INSERT INTO outbox_event(tenant_id,entity_id,aggregate_type,aggregate_id,event_type,payload,payload_hash)
  VALUES(p_tenant,p_entity,'JOURNAL_ENTRY',journal_id,'LOAN_INTEREST_DRAFT_CREATED',payload,refs_jsonb_hash(payload));
  UPDATE idempotency_receipt SET status='SUCCEEDED',response_status=201,response_body=payload,completed_at=clock_timestamp() WHERE idempotency_receipt_id=idem.idempotency_receipt_id;
  RETURN payload||jsonb_build_object('idempotent',false);
END;$$;

COMMIT;
