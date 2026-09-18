BEGIN;

-- P05 / ADR-P05: persisted project, cost-code and unit masters.
--
-- Until now project_ref / cost_code_ref / unit_ref were free-text dimension
-- keys carried on journal_line.dimensions and source_document_line.  Nothing
-- declared which refs exist, who approved them, whether a cost code is
-- capitalisable, or what a unit's allocation basis is.  The cost layer read
-- below therefore had no master to reconcile against and every "CWIP" or
-- "unit cost" page was a report filter.
--
-- This migration adds the masters and a derived cost-layer read model.  It
-- adds NO posting path: capitalisation, cost transfer and unit release stay
-- ordinary Draft journals (GL.JE.CREATE) that carry dimensions, subject to the
-- unchanged submit/review/approve/post chain.  The masters only make those
-- dimensions declarable, approvable and reconcilable.

INSERT INTO permission_catalog(permission_code,domain,risk_class,sod_class) VALUES
  ('PROJECT.MASTER.VIEW','PROJECT','LOW','READ'),
  ('PROJECT.MASTER.CREATE','PROJECT','HIGH','PROJECT_MASTER_MAKER'),
  ('PROJECT.MASTER.APPROVE','PROJECT','HIGH','PROJECT_MASTER_APPROVER')
ON CONFLICT(permission_code) DO UPDATE SET active=true,version=permission_catalog.version+1,effective_to=NULL;
INSERT INTO runtime_human_permission_authority(permission_code,authority_class) VALUES
  ('PROJECT.MASTER.CREATE','DRAFT'),('PROJECT.MASTER.APPROVE','APPROVE')
ON CONFLICT(permission_code) DO NOTHING;

CREATE TABLE project_master(
  project_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant(tenant_id),
  entity_id uuid NOT NULL,
  project_ref text NOT NULL CHECK(project_ref=btrim(project_ref) AND project_ref~'^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$'),
  project_name text NOT NULL CHECK(project_name=btrim(project_name) AND length(project_name) BETWEEN 1 AND 200),
  project_type text NOT NULL CHECK(project_type IN('DEVELOPMENT','RENTAL','LAND','OTHER')),
  capitalization_policy text NOT NULL CHECK(capitalization_policy IN('CWIP_UNTIL_COMPLETION','EXPENSE_AS_INCURRED')),
  status text NOT NULL DEFAULT 'DRAFT' CHECK(status IN('DRAFT','APPROVED','RETIRED')),
  revision integer NOT NULL DEFAULT 0 CHECK(revision>=0),
  created_by text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  approved_by text,
  approved_at timestamptz,
  retired_by text,
  retired_at timestamptz,
  FOREIGN KEY(tenant_id,entity_id) REFERENCES entity(tenant_id,entity_id),
  UNIQUE(tenant_id,entity_id,project_ref),
  CHECK((status='DRAFT' AND approved_by IS NULL) OR (status<>'DRAFT' AND approved_by IS NOT NULL AND approved_at IS NOT NULL)),
  CHECK((status='RETIRED')=(retired_by IS NOT NULL)),
  CHECK(approved_by IS NULL OR approved_by<>created_by)
);

CREATE TABLE project_cost_code(
  cost_code_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant(tenant_id),
  entity_id uuid NOT NULL,
  project_id uuid NOT NULL REFERENCES project_master(project_id),
  cost_code_ref text NOT NULL CHECK(cost_code_ref=btrim(cost_code_ref) AND cost_code_ref~'^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$'),
  cost_code_name text NOT NULL CHECK(cost_code_name=btrim(cost_code_name) AND length(cost_code_name) BETWEEN 1 AND 200),
  cost_category text NOT NULL CHECK(cost_category IN('LAND','HARD','SOFT','FINANCING','MARKETING','OTHER')),
  capitalizable boolean NOT NULL,
  status text NOT NULL DEFAULT 'DRAFT' CHECK(status IN('DRAFT','APPROVED','RETIRED')),
  revision integer NOT NULL DEFAULT 0 CHECK(revision>=0),
  created_by text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  approved_by text,
  approved_at timestamptz,
  retired_by text,
  retired_at timestamptz,
  UNIQUE(tenant_id,entity_id,project_id,cost_code_ref),
  CHECK((status='DRAFT' AND approved_by IS NULL) OR (status<>'DRAFT' AND approved_by IS NOT NULL AND approved_at IS NOT NULL)),
  CHECK((status='RETIRED')=(retired_by IS NOT NULL)),
  CHECK(approved_by IS NULL OR approved_by<>created_by)
);

CREATE TABLE project_unit(
  unit_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant(tenant_id),
  entity_id uuid NOT NULL,
  project_id uuid NOT NULL REFERENCES project_master(project_id),
  unit_ref text NOT NULL CHECK(unit_ref=btrim(unit_ref) AND unit_ref~'^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$'),
  unit_name text NOT NULL CHECK(unit_name=btrim(unit_name) AND length(unit_name) BETWEEN 1 AND 200),
  allocation_basis text NOT NULL CHECK(allocation_basis IN('AREA','EQUAL','SPECIFIC_IDENTIFICATION')),
  allocation_weight numeric(20,4) NOT NULL CHECK(allocation_weight>0),
  status text NOT NULL DEFAULT 'DRAFT' CHECK(status IN('DRAFT','APPROVED','RETIRED')),
  revision integer NOT NULL DEFAULT 0 CHECK(revision>=0),
  created_by text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  approved_by text,
  approved_at timestamptz,
  retired_by text,
  retired_at timestamptz,
  UNIQUE(tenant_id,entity_id,project_id,unit_ref),
  CHECK((status='DRAFT' AND approved_by IS NULL) OR (status<>'DRAFT' AND approved_by IS NOT NULL AND approved_at IS NOT NULL)),
  CHECK((status='RETIRED')=(retired_by IS NOT NULL)),
  CHECK(approved_by IS NULL OR approved_by<>created_by)
);

-- Append-only lineage of every master command (create / approve / retire).
CREATE TABLE project_master_event(
  project_master_event_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant(tenant_id),
  entity_id uuid NOT NULL,
  object_type text NOT NULL CHECK(object_type IN('PROJECT','COST_CODE','UNIT')),
  object_id uuid NOT NULL,
  event_type text NOT NULL CHECK(event_type IN('CREATED','APPROVED','RETIRED')),
  revision_after integer NOT NULL CHECK(revision_after>=0),
  actor_id text NOT NULL,
  reason text NOT NULL CHECK(length(btrim(reason)) BETWEEN 8 AND 2000),
  snapshot jsonb NOT NULL CHECK(jsonb_typeof(snapshot)='object'),
  snapshot_hash text NOT NULL CHECK(snapshot_hash~'^sha256:[0-9a-f]{64}$'),
  recorded_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX project_master_event_object_idx ON project_master_event(tenant_id,entity_id,object_type,object_id,recorded_at);
CREATE TRIGGER project_master_event_append_only BEFORE UPDATE OR DELETE ON project_master_event FOR EACH ROW EXECUTE FUNCTION reject_mutation();

CREATE FUNCTION refs_project_master_snapshot(p_type text,p_id uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE snap jsonb;
BEGIN
  IF p_type='PROJECT' THEN SELECT to_jsonb(p)-'created_at'-'approved_at'-'retired_at' INTO snap FROM project_master p WHERE project_id=p_id;
  ELSIF p_type='COST_CODE' THEN SELECT to_jsonb(c)-'created_at'-'approved_at'-'retired_at' INTO snap FROM project_cost_code c WHERE cost_code_id=p_id;
  ELSIF p_type='UNIT' THEN SELECT to_jsonb(u)-'created_at'-'approved_at'-'retired_at' INTO snap FROM project_unit u WHERE unit_id=p_id;
  END IF;
  IF snap IS NULL THEN RAISE EXCEPTION 'Project master object missing' USING ERRCODE='P0002'; END IF;
  RETURN snap;
END;$$;

CREATE FUNCTION refs_record_project_master_event(p_tenant uuid,p_entity uuid,p_type text,p_id uuid,p_event text,p_reason text,p_permission text,p_key text) RETURNS jsonb
LANGUAGE plpgsql SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE snap jsonb:=refs_project_master_snapshot(p_type,p_id); h text:=refs_jsonb_hash(refs_project_master_snapshot(p_type,p_id)); actor text:=refs_current_actor();
BEGIN
  INSERT INTO project_master_event(tenant_id,entity_id,object_type,object_id,event_type,revision_after,actor_id,reason,snapshot,snapshot_hash)
  VALUES(p_tenant,p_entity,p_type,p_id,p_event,(snap->>'revision')::integer,actor,btrim(p_reason),snap,h);
  INSERT INTO audit_event(tenant_id,entity_id,event_type,object_type,object_id,action,actor_id,actor_type,permission_used,request_id,correlation_id,idempotency_key,after_hash,reason,metadata)
  VALUES(p_tenant,p_entity,'PROJECT_MASTER_'||p_event,'PROJECT_'||p_type,p_id,CASE p_event WHEN 'CREATED' THEN 'CREATE' ELSE 'UPDATE' END,actor,'USER',p_permission,p_key,p_key,p_key,h,btrim(p_reason),snap);
  RETURN snap||jsonb_build_object('snapshot_hash',h);
END;$$;

CREATE FUNCTION refs_create_project_master_hash(p_tenant uuid,p_entity uuid,p_ref text,p_name text,p_type text,p_policy text,p_reason text) RETURNS text
LANGUAGE sql IMMUTABLE SET search_path=pg_catalog,public,pg_temp AS $$
  SELECT refs_jsonb_hash(jsonb_build_object('op','PROJECT_MASTER_CREATE','tenant_id',p_tenant,'entity_id',p_entity,'project_ref',btrim(p_ref),'project_name',btrim(p_name),'project_type',p_type,'capitalization_policy',p_policy,'reason',btrim(p_reason)))
$$;

CREATE FUNCTION refs_create_project_master(p_tenant uuid,p_entity uuid,p_ref text,p_name text,p_type text,p_policy text,p_reason text,p_key text,p_hash text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE actor text:=refs_current_actor(); idem idempotency_receipt; pid uuid; payload jsonb; scope text:='PROJECT_MASTER_CREATE:'||p_entity;
BEGIN
  PERFORM refs_assert_scope(p_tenant,p_entity,'PROJECT.MASTER.CREATE');
  IF actor IS NULL THEN RAISE EXCEPTION 'Authenticated project master maker missing' USING ERRCODE='42501'; END IF;
  IF p_hash IS DISTINCT FROM refs_create_project_master_hash(p_tenant,p_entity,p_ref,p_name,p_type,p_policy,p_reason) OR length(btrim(coalesce(p_reason,''))) NOT BETWEEN 8 AND 2000 OR length(coalesce(p_key,'')) NOT BETWEEN 8 AND 200
  THEN RAISE EXCEPTION 'Invalid project master command' USING ERRCODE='22023'; END IF;
  INSERT INTO idempotency_receipt(tenant_id,operation_scope,idempotency_key,request_hash,status,actor_id) VALUES(p_tenant,scope,p_key,p_hash,'IN_PROGRESS',actor) ON CONFLICT(tenant_id,operation_scope,idempotency_key) DO NOTHING;
  SELECT * INTO idem FROM idempotency_receipt WHERE tenant_id=p_tenant AND operation_scope=scope AND idempotency_key=p_key FOR UPDATE;
  IF idem.actor_id IS DISTINCT FROM actor OR idem.request_hash IS DISTINCT FROM p_hash THEN RAISE EXCEPTION 'Project master idempotency conflict' USING ERRCODE='23505'; END IF;
  IF idem.status='SUCCEEDED' THEN RETURN idem.response_body||jsonb_build_object('idempotent',true); END IF;
  INSERT INTO project_master(tenant_id,entity_id,project_ref,project_name,project_type,capitalization_policy,created_by)
  VALUES(p_tenant,p_entity,btrim(p_ref),btrim(p_name),p_type,p_policy,actor) RETURNING project_id INTO pid;
  payload:=refs_record_project_master_event(p_tenant,p_entity,'PROJECT',pid,'CREATED',p_reason,'PROJECT.MASTER.CREATE',p_key)||jsonb_build_object('schema_version','PROJECT_MASTER_V1','idempotent',false);
  UPDATE idempotency_receipt SET status='SUCCEEDED',response_status=201,response_body=payload-'idempotent',completed_at=clock_timestamp() WHERE idempotency_receipt_id=idem.idempotency_receipt_id;
  RETURN payload;
END;$$;

CREATE FUNCTION refs_create_project_cost_code_hash(p_tenant uuid,p_entity uuid,p_project uuid,p_ref text,p_name text,p_category text,p_capitalizable boolean,p_reason text) RETURNS text
LANGUAGE sql IMMUTABLE SET search_path=pg_catalog,public,pg_temp AS $$
  SELECT refs_jsonb_hash(jsonb_build_object('op','PROJECT_COST_CODE_CREATE','tenant_id',p_tenant,'entity_id',p_entity,'project_id',p_project,'cost_code_ref',btrim(p_ref),'cost_code_name',btrim(p_name),'cost_category',p_category,'capitalizable',p_capitalizable,'reason',btrim(p_reason)))
$$;

CREATE FUNCTION refs_create_project_cost_code(p_tenant uuid,p_entity uuid,p_project uuid,p_ref text,p_name text,p_category text,p_capitalizable boolean,p_reason text,p_key text,p_hash text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE actor text:=refs_current_actor(); idem idempotency_receipt; cid uuid; payload jsonb; proj project_master; scope text:='PROJECT_COST_CODE_CREATE:'||p_entity;
BEGIN
  PERFORM refs_assert_scope(p_tenant,p_entity,'PROJECT.MASTER.CREATE');
  IF actor IS NULL THEN RAISE EXCEPTION 'Authenticated project master maker missing' USING ERRCODE='42501'; END IF;
  IF p_hash IS DISTINCT FROM refs_create_project_cost_code_hash(p_tenant,p_entity,p_project,p_ref,p_name,p_category,p_capitalizable,p_reason) OR p_capitalizable IS NULL OR length(btrim(coalesce(p_reason,''))) NOT BETWEEN 8 AND 2000 OR length(coalesce(p_key,'')) NOT BETWEEN 8 AND 200
  THEN RAISE EXCEPTION 'Invalid project cost code command' USING ERRCODE='22023'; END IF;
  INSERT INTO idempotency_receipt(tenant_id,operation_scope,idempotency_key,request_hash,status,actor_id) VALUES(p_tenant,scope,p_key,p_hash,'IN_PROGRESS',actor) ON CONFLICT(tenant_id,operation_scope,idempotency_key) DO NOTHING;
  SELECT * INTO idem FROM idempotency_receipt WHERE tenant_id=p_tenant AND operation_scope=scope AND idempotency_key=p_key FOR UPDATE;
  IF idem.actor_id IS DISTINCT FROM actor OR idem.request_hash IS DISTINCT FROM p_hash THEN RAISE EXCEPTION 'Project master idempotency conflict' USING ERRCODE='23505'; END IF;
  IF idem.status='SUCCEEDED' THEN RETURN idem.response_body||jsonb_build_object('idempotent',true); END IF;
  SELECT * INTO proj FROM project_master WHERE tenant_id=p_tenant AND entity_id=p_entity AND project_id=p_project FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Scoped project missing' USING ERRCODE='P0002'; END IF;
  IF proj.status<>'APPROVED' THEN RAISE EXCEPTION 'Cost codes require an APPROVED project' USING ERRCODE='23514'; END IF;
  INSERT INTO project_cost_code(tenant_id,entity_id,project_id,cost_code_ref,cost_code_name,cost_category,capitalizable,created_by)
  VALUES(p_tenant,p_entity,p_project,btrim(p_ref),btrim(p_name),p_category,p_capitalizable,actor) RETURNING cost_code_id INTO cid;
  payload:=refs_record_project_master_event(p_tenant,p_entity,'COST_CODE',cid,'CREATED',p_reason,'PROJECT.MASTER.CREATE',p_key)||jsonb_build_object('schema_version','PROJECT_COST_CODE_V1','idempotent',false);
  UPDATE idempotency_receipt SET status='SUCCEEDED',response_status=201,response_body=payload-'idempotent',completed_at=clock_timestamp() WHERE idempotency_receipt_id=idem.idempotency_receipt_id;
  RETURN payload;
END;$$;

CREATE FUNCTION refs_create_project_unit_hash(p_tenant uuid,p_entity uuid,p_project uuid,p_ref text,p_name text,p_basis text,p_weight numeric,p_reason text) RETURNS text
LANGUAGE sql IMMUTABLE SET search_path=pg_catalog,public,pg_temp AS $$
  SELECT refs_jsonb_hash(jsonb_build_object('op','PROJECT_UNIT_CREATE','tenant_id',p_tenant,'entity_id',p_entity,'project_id',p_project,'unit_ref',btrim(p_ref),'unit_name',btrim(p_name),'allocation_basis',p_basis,'allocation_weight',p_weight::numeric(20,4)::text,'reason',btrim(p_reason)))
$$;

CREATE FUNCTION refs_create_project_unit(p_tenant uuid,p_entity uuid,p_project uuid,p_ref text,p_name text,p_basis text,p_weight numeric,p_reason text,p_key text,p_hash text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE actor text:=refs_current_actor(); idem idempotency_receipt; uid uuid; payload jsonb; proj project_master; scope text:='PROJECT_UNIT_CREATE:'||p_entity;
BEGIN
  PERFORM refs_assert_scope(p_tenant,p_entity,'PROJECT.MASTER.CREATE');
  IF actor IS NULL THEN RAISE EXCEPTION 'Authenticated project master maker missing' USING ERRCODE='42501'; END IF;
  IF p_hash IS DISTINCT FROM refs_create_project_unit_hash(p_tenant,p_entity,p_project,p_ref,p_name,p_basis,p_weight,p_reason) OR p_weight IS NULL OR p_weight<=0 OR length(btrim(coalesce(p_reason,''))) NOT BETWEEN 8 AND 2000 OR length(coalesce(p_key,'')) NOT BETWEEN 8 AND 200
  THEN RAISE EXCEPTION 'Invalid project unit command' USING ERRCODE='22023'; END IF;
  INSERT INTO idempotency_receipt(tenant_id,operation_scope,idempotency_key,request_hash,status,actor_id) VALUES(p_tenant,scope,p_key,p_hash,'IN_PROGRESS',actor) ON CONFLICT(tenant_id,operation_scope,idempotency_key) DO NOTHING;
  SELECT * INTO idem FROM idempotency_receipt WHERE tenant_id=p_tenant AND operation_scope=scope AND idempotency_key=p_key FOR UPDATE;
  IF idem.actor_id IS DISTINCT FROM actor OR idem.request_hash IS DISTINCT FROM p_hash THEN RAISE EXCEPTION 'Project master idempotency conflict' USING ERRCODE='23505'; END IF;
  IF idem.status='SUCCEEDED' THEN RETURN idem.response_body||jsonb_build_object('idempotent',true); END IF;
  SELECT * INTO proj FROM project_master WHERE tenant_id=p_tenant AND entity_id=p_entity AND project_id=p_project FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Scoped project missing' USING ERRCODE='P0002'; END IF;
  IF proj.status<>'APPROVED' THEN RAISE EXCEPTION 'Units require an APPROVED project' USING ERRCODE='23514'; END IF;
  INSERT INTO project_unit(tenant_id,entity_id,project_id,unit_ref,unit_name,allocation_basis,allocation_weight,created_by)
  VALUES(p_tenant,p_entity,p_project,btrim(p_ref),btrim(p_name),p_basis,p_weight,actor) RETURNING unit_id INTO uid;
  payload:=refs_record_project_master_event(p_tenant,p_entity,'UNIT',uid,'CREATED',p_reason,'PROJECT.MASTER.CREATE',p_key)||jsonb_build_object('schema_version','PROJECT_UNIT_V1','idempotent',false);
  UPDATE idempotency_receipt SET status='SUCCEEDED',response_status=201,response_body=payload-'idempotent',completed_at=clock_timestamp() WHERE idempotency_receipt_id=idem.idempotency_receipt_id;
  RETURN payload;
END;$$;

CREATE FUNCTION refs_transition_project_master_hash(p_tenant uuid,p_entity uuid,p_type text,p_id uuid,p_expected_revision integer,p_event text,p_reason text) RETURNS text
LANGUAGE sql IMMUTABLE SET search_path=pg_catalog,public,pg_temp AS $$
  SELECT refs_jsonb_hash(jsonb_build_object('op','PROJECT_MASTER_TRANSITION','tenant_id',p_tenant,'entity_id',p_entity,'object_type',p_type,'object_id',p_id,'expected_revision',p_expected_revision,'event',p_event,'reason',btrim(p_reason)))
$$;

-- APPROVE: DRAFT -> APPROVED, approver must differ from creator (SoD).
-- RETIRE:  APPROVED -> RETIRED, same permission class as approve; a project
-- cannot retire while it still has APPROVED cost codes or units.
CREATE FUNCTION refs_transition_project_master(p_tenant uuid,p_entity uuid,p_type text,p_id uuid,p_expected_revision integer,p_event text,p_reason text,p_key text,p_hash text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE actor text:=refs_current_actor(); idem idempotency_receipt; payload jsonb; cur_status text; cur_rev integer; creator text; scope text:='PROJECT_MASTER_TRANSITION:'||p_entity; live integer;
BEGIN
  PERFORM refs_assert_scope(p_tenant,p_entity,'PROJECT.MASTER.APPROVE');
  IF actor IS NULL THEN RAISE EXCEPTION 'Authenticated project master approver missing' USING ERRCODE='42501'; END IF;
  IF p_type NOT IN('PROJECT','COST_CODE','UNIT') OR p_event NOT IN('APPROVED','RETIRED') OR p_expected_revision IS NULL
     OR p_hash IS DISTINCT FROM refs_transition_project_master_hash(p_tenant,p_entity,p_type,p_id,p_expected_revision,p_event,p_reason)
     OR length(btrim(coalesce(p_reason,''))) NOT BETWEEN 8 AND 2000 OR length(coalesce(p_key,'')) NOT BETWEEN 8 AND 200
  THEN RAISE EXCEPTION 'Invalid project master transition' USING ERRCODE='22023'; END IF;
  INSERT INTO idempotency_receipt(tenant_id,operation_scope,idempotency_key,request_hash,status,actor_id) VALUES(p_tenant,scope,p_key,p_hash,'IN_PROGRESS',actor) ON CONFLICT(tenant_id,operation_scope,idempotency_key) DO NOTHING;
  SELECT * INTO idem FROM idempotency_receipt WHERE tenant_id=p_tenant AND operation_scope=scope AND idempotency_key=p_key FOR UPDATE;
  IF idem.actor_id IS DISTINCT FROM actor OR idem.request_hash IS DISTINCT FROM p_hash THEN RAISE EXCEPTION 'Project master idempotency conflict' USING ERRCODE='23505'; END IF;
  IF idem.status='SUCCEEDED' THEN RETURN idem.response_body||jsonb_build_object('idempotent',true); END IF;

  IF p_type='PROJECT' THEN SELECT status,revision,created_by INTO cur_status,cur_rev,creator FROM project_master WHERE tenant_id=p_tenant AND entity_id=p_entity AND project_id=p_id FOR UPDATE;
  ELSIF p_type='COST_CODE' THEN SELECT status,revision,created_by INTO cur_status,cur_rev,creator FROM project_cost_code WHERE tenant_id=p_tenant AND entity_id=p_entity AND cost_code_id=p_id FOR UPDATE;
  ELSE SELECT status,revision,created_by INTO cur_status,cur_rev,creator FROM project_unit WHERE tenant_id=p_tenant AND entity_id=p_entity AND unit_id=p_id FOR UPDATE; END IF;
  IF cur_status IS NULL THEN RAISE EXCEPTION 'Scoped project master object missing' USING ERRCODE='P0002'; END IF;
  IF cur_rev<>p_expected_revision THEN RAISE EXCEPTION 'Project master revision is stale' USING ERRCODE='40001'; END IF;
  IF p_event='APPROVED' THEN
    IF cur_status<>'DRAFT' THEN RAISE EXCEPTION 'Only DRAFT project master objects can be approved' USING ERRCODE='23514'; END IF;
    IF creator=actor THEN RAISE EXCEPTION 'Project master maker and approver must be different actors' USING ERRCODE='42501'; END IF;
  ELSE
    IF cur_status<>'APPROVED' THEN RAISE EXCEPTION 'Only APPROVED project master objects can be retired' USING ERRCODE='23514'; END IF;
    IF p_type='PROJECT' THEN
      SELECT count(*) INTO live FROM (SELECT 1 FROM project_cost_code WHERE project_id=p_id AND status='APPROVED' UNION ALL SELECT 1 FROM project_unit WHERE project_id=p_id AND status='APPROVED') x;
      IF live>0 THEN RAISE EXCEPTION 'Retire APPROVED cost codes and units before retiring the project' USING ERRCODE='23514'; END IF;
    END IF;
  END IF;

  IF p_type='PROJECT' THEN
    UPDATE project_master SET status=p_event,revision=revision+1,
      approved_by=CASE WHEN p_event='APPROVED' THEN actor ELSE approved_by END,approved_at=CASE WHEN p_event='APPROVED' THEN clock_timestamp() ELSE approved_at END,
      retired_by=CASE WHEN p_event='RETIRED' THEN actor END,retired_at=CASE WHEN p_event='RETIRED' THEN clock_timestamp() END WHERE project_id=p_id;
  ELSIF p_type='COST_CODE' THEN
    UPDATE project_cost_code SET status=p_event,revision=revision+1,
      approved_by=CASE WHEN p_event='APPROVED' THEN actor ELSE approved_by END,approved_at=CASE WHEN p_event='APPROVED' THEN clock_timestamp() ELSE approved_at END,
      retired_by=CASE WHEN p_event='RETIRED' THEN actor END,retired_at=CASE WHEN p_event='RETIRED' THEN clock_timestamp() END WHERE cost_code_id=p_id;
  ELSE
    UPDATE project_unit SET status=p_event,revision=revision+1,
      approved_by=CASE WHEN p_event='APPROVED' THEN actor ELSE approved_by END,approved_at=CASE WHEN p_event='APPROVED' THEN clock_timestamp() ELSE approved_at END,
      retired_by=CASE WHEN p_event='RETIRED' THEN actor END,retired_at=CASE WHEN p_event='RETIRED' THEN clock_timestamp() END WHERE unit_id=p_id;
  END IF;
  payload:=refs_record_project_master_event(p_tenant,p_entity,p_type,p_id,p_event,p_reason,'PROJECT.MASTER.APPROVE',p_key)||jsonb_build_object('schema_version','PROJECT_MASTER_TRANSITION_V1','idempotent',false);
  UPDATE idempotency_receipt SET status='SUCCEEDED',response_status=200,response_body=payload-'idempotent',completed_at=clock_timestamp() WHERE idempotency_receipt_id=idem.idempotency_receipt_id;
  RETURN payload;
END;$$;

CREATE FUNCTION refs_read_project_masters(p_tenant uuid,p_entity uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
BEGIN
  PERFORM refs_assert_scope(p_tenant,p_entity,'PROJECT.MASTER.VIEW');
  RETURN jsonb_build_object(
    'schema_version','PROJECT_MASTERS_V1',
    'accounting_authority','NONE',
    'projects',COALESCE((SELECT jsonb_agg(jsonb_build_object(
        'project_id',p.project_id,'project_ref',p.project_ref,'project_name',p.project_name,'project_type',p.project_type,
        'capitalization_policy',p.capitalization_policy,'status',p.status,'revision',p.revision,'created_by',p.created_by,'approved_by',p.approved_by,
        'cost_codes',COALESCE((SELECT jsonb_agg(jsonb_build_object('cost_code_id',c.cost_code_id,'cost_code_ref',c.cost_code_ref,'cost_code_name',c.cost_code_name,'cost_category',c.cost_category,'capitalizable',c.capitalizable,'status',c.status,'revision',c.revision) ORDER BY c.cost_code_ref) FROM project_cost_code c WHERE c.project_id=p.project_id),'[]'::jsonb),
        'units',COALESCE((SELECT jsonb_agg(jsonb_build_object('unit_id',u.unit_id,'unit_ref',u.unit_ref,'unit_name',u.unit_name,'allocation_basis',u.allocation_basis,'allocation_weight',u.allocation_weight,'status',u.status,'revision',u.revision) ORDER BY u.unit_ref) FROM project_unit u WHERE u.project_id=p.project_id),'[]'::jsonb)
      ) ORDER BY p.project_ref) FROM project_master p WHERE p.tenant_id=p_tenant AND p.entity_id=p_entity),'[]'::jsonb));
END;$$;

-- Cost layers: POSTED ledger lines carrying dimensions.project_ref, grouped by
-- cost_code_ref / unit_ref / account.  An account is a CWIP layer only when an
-- APPROVED CWIP_ACCOUNT_CLASSIFICATION mapping (077) classifies that exact
-- account as of the period end; everything else is reported as NON_CWIP.  A
-- layer whose cost code or unit is not an APPROVED master is an exception.
-- The read never infers capitalisation or transfer: amounts keep ledger form.
CREATE FUNCTION refs_read_project_cost_layers(p_tenant uuid,p_entity uuid,p_project_ref text,p_period uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE v_period_end date; v_period_code text; proj project_master; rows_json jsonb; totals jsonb;
BEGIN
  PERFORM refs_assert_scope(p_tenant,p_entity,'GL.REPORT.VIEW');
  IF p_project_ref IS NULL OR p_project_ref<>btrim(p_project_ref) OR length(p_project_ref) NOT BETWEEN 1 AND 64 THEN RAISE EXCEPTION 'project_ref is required' USING ERRCODE='22023'; END IF;
  IF p_period IS NOT NULL THEN
    SELECT ends_on,period_code INTO v_period_end,v_period_code FROM accounting_period WHERE tenant_id=p_tenant AND entity_id=p_entity AND period_id=p_period;
    IF v_period_end IS NULL THEN RAISE EXCEPTION 'A valid entity-scoped accounting period is required' USING ERRCODE='22023'; END IF;
  END IF;
  SELECT * INTO proj FROM project_master WHERE tenant_id=p_tenant AND entity_id=p_entity AND project_ref=p_project_ref;
  WITH posted AS (
    SELECT l.account_code,NULLIF(btrim(l.dimensions->>'cost_code_ref'),'') AS cost_code_ref,NULLIF(btrim(l.dimensions->>'unit_ref'),'') AS unit_ref,
      l.debit_amount,l.credit_amount,l.journal_entry_id,j.journal_date
    FROM ledger_line l JOIN journal_entry j ON j.tenant_id=l.tenant_id AND j.entity_id=l.entity_id AND j.journal_entry_id=l.journal_entry_id
    WHERE l.tenant_id=p_tenant AND l.entity_id=p_entity AND j.status='POSTED' AND l.dimensions->>'project_ref'=p_project_ref
      AND (v_period_end IS NULL OR j.journal_date<=v_period_end)
  ), cwip_accounts AS (
    SELECT DISTINCT ms.input_keys->>'account_code' AS account_code
    FROM mapping_snapshot ms WHERE ms.tenant_id=p_tenant AND ms.entity_id=p_entity AND ms.family='CWIP_ACCOUNT_CLASSIFICATION' AND ms.status='APPROVED'
      AND ms.input_keys ? 'account_code' AND ms.effective_from::date<=COALESCE(v_period_end,CURRENT_DATE) AND (ms.effective_to IS NULL OR ms.effective_to::date>COALESCE(v_period_end,CURRENT_DATE))
  ), layers AS (
    SELECT p.cost_code_ref,p.unit_ref,p.account_code,
      CASE WHEN c.account_code IS NOT NULL THEN 'CWIP' ELSE 'NON_CWIP' END AS layer_class,
      sum(p.debit_amount)::numeric(20,4) AS debit_total,sum(p.credit_amount)::numeric(20,4) AS credit_total,(sum(p.debit_amount)-sum(p.credit_amount))::numeric(20,4) AS net_amount,
      count(*)::integer AS ledger_line_count,count(DISTINCT p.journal_entry_id)::integer AS journal_entry_count,max(p.journal_date) AS last_journal_date,
      cc.status AS cost_code_status,cc.capitalizable,u.status AS unit_status
    FROM posted p LEFT JOIN cwip_accounts c ON c.account_code=p.account_code
    LEFT JOIN project_cost_code cc ON proj.project_id IS NOT NULL AND cc.project_id=proj.project_id AND cc.cost_code_ref=p.cost_code_ref
    LEFT JOIN project_unit u ON proj.project_id IS NOT NULL AND u.project_id=proj.project_id AND u.unit_ref=p.unit_ref
    GROUP BY p.cost_code_ref,p.unit_ref,p.account_code,c.account_code,cc.status,cc.capitalizable,u.status
  ), classified AS (
    SELECT l.*,
      CASE WHEN proj.project_id IS NULL THEN 'PROJECT_NOT_REGISTERED'
           WHEN proj.status<>'APPROVED' THEN 'PROJECT_NOT_APPROVED'
           WHEN l.cost_code_ref IS NULL THEN 'COST_CODE_MISSING'
           WHEN l.cost_code_status IS DISTINCT FROM 'APPROVED' THEN 'COST_CODE_NOT_APPROVED'
           WHEN l.unit_ref IS NOT NULL AND l.unit_status IS DISTINCT FROM 'APPROVED' THEN 'UNIT_NOT_APPROVED'
           WHEN l.layer_class='CWIP' AND l.capitalizable=false THEN 'CWIP_ON_NON_CAPITALIZABLE_CODE'
           ELSE NULL END AS exception_code
    FROM layers l
  )
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'cost_code_ref',cost_code_ref,'unit_ref',unit_ref,'account_code',account_code,'layer_class',layer_class,
      'debit_total',debit_total,'credit_total',credit_total,'net_amount',net_amount,
      'ledger_line_count',ledger_line_count,'journal_entry_count',journal_entry_count,'last_journal_date',last_journal_date,
      'cost_code_status',cost_code_status,'capitalizable',capitalizable,'unit_status',unit_status,'exception_code',exception_code
    ) ORDER BY (exception_code IS NULL),cost_code_ref NULLS FIRST,unit_ref NULLS FIRST,account_code),'[]'::jsonb),
    jsonb_build_object(
      'layer_count',count(*),'exception_count',count(*) FILTER(WHERE exception_code IS NOT NULL),
      'cwip_net',COALESCE(sum(net_amount) FILTER(WHERE layer_class='CWIP'),0)::numeric(20,4),
      'non_cwip_net',COALESCE(sum(net_amount) FILTER(WHERE layer_class='NON_CWIP'),0)::numeric(20,4),
      'ledger_line_count',COALESCE(sum(ledger_line_count),0))
  INTO rows_json,totals FROM classified;
  RETURN jsonb_build_object(
    'schema_version','PROJECT_COST_LAYERS_V1','accounting_authority','NONE','can_capitalize',false,'can_transfer',false,'can_post',false,
    'project_ref',p_project_ref,'project_id',proj.project_id,'project_status',proj.status,'capitalization_policy',proj.capitalization_policy,
    'period_id',p_period,'period_code',v_period_code,'as_of',v_period_end,
    'layers',rows_json,'totals',totals);
END;$$;

COMMIT;
