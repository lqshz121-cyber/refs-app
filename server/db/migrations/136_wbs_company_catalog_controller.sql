BEGIN;

INSERT INTO permission_catalog(permission_code,domain,risk_class,sod_class) VALUES
  ('WBS.COMPANY.CATALOG.VIEW','WBS','LOW','READ'),
  ('WBS.COMPANY.CATALOG.RETAIN','WBS','HIGH','WBS_COMPANY_CATALOG_RETAINER'),
  ('WBS.COMPANY.CATALOG.CLASSIFY','WBS','HIGH','WBS_COMPANY_CATALOG_CLASSIFIER'),
  ('WBS.COMPANY.CATALOG.APPROVE','WBS','CRITICAL','WBS_COMPANY_CATALOG_APPROVER')
ON CONFLICT(permission_code) DO NOTHING;

CREATE TABLE wbs_company_catalog_candidate (
  wbs_company_catalog_candidate_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant(tenant_id),
  entity_id uuid NOT NULL,
  catalog_version text NOT NULL CHECK(length(btrim(catalog_version)) BETWEEN 1 AND 128),
  generated_at timestamptz NOT NULL,
  provider_environment text NOT NULL CHECK(provider_environment='PRODUCTION'),
  source_name text NOT NULL CHECK(length(btrim(source_name)) BETWEEN 1 AND 128),
  source_version text NOT NULL CHECK(length(btrim(source_version)) BETWEEN 1 AND 128),
  raw_file_hash text NOT NULL CHECK(raw_file_hash ~ '^sha256:[0-9a-f]{64}$'),
  catalog_hash text NOT NULL CHECK(catalog_hash ~ '^sha256:[0-9a-f]{64}$'),
  source_row_count integer NOT NULL CHECK(source_row_count>=0),
  accepted_row_count integer NOT NULL CHECK(accepted_row_count>=0),
  rejected_row_count integer NOT NULL CHECK(rejected_row_count>=0),
  source_rejections jsonb NOT NULL CHECK(jsonb_typeof(source_rejections)='array'),
  declared_account_book_total integer NOT NULL CHECK(declared_account_book_total>=0),
  declared_account_book_open integer NOT NULL CHECK(declared_account_book_open>=0),
  declared_account_book_closed integer NOT NULL CHECK(declared_account_book_closed>=0),
  declared_companies_with_books integer NOT NULL CHECK(declared_companies_with_books>=0),
  recomputed_account_book_total integer NOT NULL CHECK(recomputed_account_book_total>=0),
  recomputed_account_book_open integer NOT NULL CHECK(recomputed_account_book_open>=0),
  recomputed_account_book_closed integer NOT NULL CHECK(recomputed_account_book_closed>=0),
  recomputed_companies_with_books integer NOT NULL CHECK(recomputed_companies_with_books>=0),
  retained_by text NOT NULL,
  retained_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  request_hash text NOT NULL CHECK(request_hash ~ '^sha256:[0-9a-f]{64}$'),
  UNIQUE(tenant_id,entity_id,catalog_hash),
  UNIQUE(tenant_id,entity_id,wbs_company_catalog_candidate_id),
  FOREIGN KEY(tenant_id,entity_id) REFERENCES entity(tenant_id,entity_id),
  CHECK(source_row_count=accepted_row_count+rejected_row_count)
);

CREATE TABLE wbs_company_catalog_candidate_row (
  wbs_company_catalog_candidate_row_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  entity_id uuid NOT NULL,
  wbs_company_catalog_candidate_id uuid NOT NULL,
  row_ordinal integer NOT NULL CHECK(row_ordinal>=0),
  company_code text,
  wbs_company_id text,
  display_name text,
  legal_name text,
  proposed_active_status text,
  proposed_entity_type text,
  proposed_base_currency text,
  operationally_active_2026 boolean NOT NULL DEFAULT false,
  account_books jsonb NOT NULL CHECK(jsonb_typeof(account_books)='array'),
  domains jsonb NOT NULL CHECK(jsonb_typeof(domains)='object'),
  account_book_count integer NOT NULL CHECK(account_book_count>=0),
  open_account_book_count integer NOT NULL CHECK(open_account_book_count>=0),
  row_hash text NOT NULL CHECK(row_hash ~ '^sha256:[0-9a-f]{64}$'),
  retained_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE(tenant_id,entity_id,wbs_company_catalog_candidate_id,row_ordinal),
  UNIQUE(tenant_id,entity_id,wbs_company_catalog_candidate_row_id),
  FOREIGN KEY(tenant_id,entity_id,wbs_company_catalog_candidate_id)
    REFERENCES wbs_company_catalog_candidate(tenant_id,entity_id,wbs_company_catalog_candidate_id)
);

CREATE TABLE wbs_company_catalog_validation_finding (
  wbs_company_catalog_validation_finding_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  entity_id uuid NOT NULL,
  wbs_company_catalog_candidate_id uuid NOT NULL,
  wbs_company_catalog_candidate_row_id uuid,
  row_ordinal integer,
  severity text NOT NULL CHECK(severity IN ('ERROR','REVIEW','INFO')),
  finding_code text NOT NULL CHECK(finding_code ~ '^[A-Z][A-Z0-9_]{2,95}$'),
  message text NOT NULL CHECK(length(btrim(message)) BETWEEN 1 AND 1000),
  details jsonb NOT NULL DEFAULT '{}'::jsonb CHECK(jsonb_typeof(details)='object'),
  finding_hash text NOT NULL CHECK(finding_hash ~ '^sha256:[0-9a-f]{64}$'),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE(tenant_id,entity_id,wbs_company_catalog_candidate_id,row_ordinal,finding_code,finding_hash),
  FOREIGN KEY(tenant_id,entity_id,wbs_company_catalog_candidate_id)
    REFERENCES wbs_company_catalog_candidate(tenant_id,entity_id,wbs_company_catalog_candidate_id),
  FOREIGN KEY(tenant_id,entity_id,wbs_company_catalog_candidate_row_id)
    REFERENCES wbs_company_catalog_candidate_row(tenant_id,entity_id,wbs_company_catalog_candidate_row_id),
  CHECK((row_ordinal IS NULL AND wbs_company_catalog_candidate_row_id IS NULL) OR (row_ordinal IS NOT NULL AND wbs_company_catalog_candidate_row_id IS NOT NULL))
);

CREATE TABLE wbs_company_catalog_controller_decision (
  wbs_company_catalog_controller_decision_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  entity_id uuid NOT NULL,
  wbs_company_catalog_candidate_id uuid NOT NULL,
  wbs_company_catalog_candidate_row_id uuid NOT NULL,
  revision bigint NOT NULL CHECK(revision>0),
  decision_type text NOT NULL CHECK(decision_type IN ('CLASSIFIED','APPROVED')),
  company_code text NOT NULL CHECK(company_code ~ '^[A-Z0-9][A-Z0-9_-]{0,63}$'),
  display_name text NOT NULL CHECK(length(btrim(display_name)) BETWEEN 1 AND 200),
  legal_name text NOT NULL CHECK(length(btrim(legal_name)) BETWEEN 1 AND 200),
  entity_type text NOT NULL CHECK(entity_type IN ('LEGAL_ENTITY','CONSOLIDATION','INACTIVE','TEST','OTHER')),
  active_status text NOT NULL CHECK(active_status IN ('ACTIVE','INACTIVE','CLOSED')),
  base_currency char(3) NOT NULL CHECK(base_currency ~ '^[A-Z]{3}$'),
  effective_from date,
  effective_to date,
  mapping_version text,
  mapping_document jsonb,
  mapping_hash text CHECK(mapping_hash IS NULL OR mapping_hash ~ '^sha256:[0-9a-f]{64}$'),
  reason text NOT NULL CHECK(length(btrim(reason)) BETWEEN 8 AND 2000),
  decided_by text NOT NULL,
  decided_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  prior_decision_hash text CHECK(prior_decision_hash IS NULL OR prior_decision_hash ~ '^sha256:[0-9a-f]{64}$'),
  decision_hash text NOT NULL CHECK(decision_hash ~ '^sha256:[0-9a-f]{64}$'),
  request_hash text NOT NULL CHECK(request_hash ~ '^sha256:[0-9a-f]{64}$'),
  UNIQUE(tenant_id,entity_id,wbs_company_catalog_candidate_row_id,revision),
  UNIQUE(tenant_id,entity_id,wbs_company_catalog_controller_decision_id),
  FOREIGN KEY(tenant_id,entity_id,wbs_company_catalog_candidate_id)
    REFERENCES wbs_company_catalog_candidate(tenant_id,entity_id,wbs_company_catalog_candidate_id),
  FOREIGN KEY(tenant_id,entity_id,wbs_company_catalog_candidate_row_id)
    REFERENCES wbs_company_catalog_candidate_row(tenant_id,entity_id,wbs_company_catalog_candidate_row_id),
  CHECK(effective_to IS NULL OR effective_to>=effective_from),
  CHECK(mapping_version IS NULL OR length(btrim(mapping_version)) BETWEEN 1 AND 160),
  CHECK((decision_type='CLASSIFIED' AND effective_from IS NULL AND effective_to IS NULL AND mapping_version IS NULL AND mapping_document IS NULL AND mapping_hash IS NULL)
     OR (decision_type='APPROVED' AND effective_from IS NOT NULL AND mapping_version IS NOT NULL AND mapping_document IS NOT NULL AND mapping_hash IS NOT NULL))
);

ALTER TABLE wbs_company_catalog_candidate ENABLE ROW LEVEL SECURITY;
ALTER TABLE wbs_company_catalog_candidate_row ENABLE ROW LEVEL SECURITY;
ALTER TABLE wbs_company_catalog_validation_finding ENABLE ROW LEVEL SECURITY;
ALTER TABLE wbs_company_catalog_controller_decision ENABLE ROW LEVEL SECURITY;
CREATE POLICY wbs_company_catalog_candidate_scope ON wbs_company_catalog_candidate USING(tenant_id=refs_current_tenant() AND refs_entity_allowed(entity_id)) WITH CHECK(tenant_id=refs_current_tenant() AND refs_entity_allowed(entity_id));
CREATE POLICY wbs_company_catalog_candidate_row_scope ON wbs_company_catalog_candidate_row USING(tenant_id=refs_current_tenant() AND refs_entity_allowed(entity_id)) WITH CHECK(tenant_id=refs_current_tenant() AND refs_entity_allowed(entity_id));
CREATE POLICY wbs_company_catalog_validation_finding_scope ON wbs_company_catalog_validation_finding USING(tenant_id=refs_current_tenant() AND refs_entity_allowed(entity_id)) WITH CHECK(tenant_id=refs_current_tenant() AND refs_entity_allowed(entity_id));
CREATE POLICY wbs_company_catalog_controller_decision_scope ON wbs_company_catalog_controller_decision USING(tenant_id=refs_current_tenant() AND refs_entity_allowed(entity_id)) WITH CHECK(tenant_id=refs_current_tenant() AND refs_entity_allowed(entity_id));
CREATE TRIGGER wbs_company_catalog_candidate_append_only BEFORE UPDATE OR DELETE ON wbs_company_catalog_candidate FOR EACH ROW EXECUTE FUNCTION reject_mutation();
CREATE TRIGGER wbs_company_catalog_candidate_row_append_only BEFORE UPDATE OR DELETE ON wbs_company_catalog_candidate_row FOR EACH ROW EXECUTE FUNCTION reject_mutation();
CREATE TRIGGER wbs_company_catalog_validation_finding_append_only BEFORE UPDATE OR DELETE ON wbs_company_catalog_validation_finding FOR EACH ROW EXECUTE FUNCTION reject_mutation();
CREATE TRIGGER wbs_company_catalog_controller_decision_append_only BEFORE UPDATE OR DELETE ON wbs_company_catalog_controller_decision FOR EACH ROW EXECUTE FUNCTION reject_mutation();

CREATE FUNCTION refs_retain_wbs_company_catalog_hash(p_tenant uuid,p_entity uuid,p_catalog jsonb) RETURNS text
LANGUAGE sql IMMUTABLE SET search_path=pg_catalog,public,pg_temp AS $$
  SELECT refs_jsonb_hash(jsonb_build_object('tenant_id',p_tenant,'entity_id',p_entity,'catalog',p_catalog))
$$;

CREATE FUNCTION refs_retain_wbs_company_catalog(p_tenant uuid,p_entity uuid,p_catalog jsonb,p_idempotency_key text,p_request_hash text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE actor text:=refs_current_actor(); idem idempotency_receipt; candidate_id uuid:=gen_random_uuid(); response jsonb; event_payload jsonb;
  row_value jsonb; finding_value jsonb; row_id uuid; row_ids jsonb:='{}'::jsonb; computed_hash text; source_control jsonb; book_control jsonb;
BEGIN
  PERFORM refs_assert_scope(p_tenant,p_entity,'WBS.COMPANY.CATALOG.RETAIN');
  computed_hash:=refs_retain_wbs_company_catalog_hash(p_tenant,p_entity,p_catalog);
  IF actor IS NULL OR computed_hash<>p_request_hash OR jsonb_typeof(p_catalog)<>'object' THEN RAISE EXCEPTION 'Company catalog retention request is invalid' USING ERRCODE='22023'; END IF;
  IF p_catalog->>'provider_environment'<>'PRODUCTION' OR p_catalog->>'raw_file_hash' !~ '^sha256:[0-9a-f]{64}$' OR p_catalog->>'catalog_hash' !~ '^sha256:[0-9a-f]{64}$' OR jsonb_typeof(p_catalog->'rows')<>'array' OR jsonb_array_length(p_catalog->'rows') NOT BETWEEN 1 AND 500 OR jsonb_typeof(p_catalog->'findings')<>'array' OR jsonb_array_length(p_catalog->'findings')>5000 THEN RAISE EXCEPTION 'Company catalog metadata or bounded rows are invalid' USING ERRCODE='22023'; END IF;
  source_control:=p_catalog->'source_control'; book_control:=p_catalog->'account_book_control';
  IF jsonb_typeof(source_control)<>'object' OR jsonb_typeof(source_control->'rejected_rows')<>'array' OR jsonb_typeof(book_control)<>'object' OR (source_control->>'source_row_count')::integer<>(source_control->>'accepted_row_count')::integer+(source_control->>'rejected_row_count')::integer OR (source_control->>'accepted_row_count')::integer<>jsonb_array_length(p_catalog->'rows') OR (source_control->>'rejected_row_count')::integer<>jsonb_array_length(source_control->'rejected_rows') OR EXISTS(SELECT 1 FROM jsonb_array_elements(source_control->'rejected_rows') rejected WHERE rejected->>'row_hash' !~ '^sha256:[0-9a-f]{64}$' OR length(btrim(coalesce(rejected->>'source_row_key',''))) NOT BETWEEN 1 AND 256 OR length(btrim(coalesce(rejected->>'reason',''))) NOT BETWEEN 1 AND 1000) THEN RAISE EXCEPTION 'Company catalog source row control is invalid' USING ERRCODE='23514'; END IF;
  INSERT INTO idempotency_receipt(tenant_id,operation_scope,idempotency_key,request_hash,status,actor_id) VALUES(p_tenant,'WBS_COMPANY_CATALOG_RETAIN:'||p_entity,p_idempotency_key,p_request_hash,'IN_PROGRESS',actor) ON CONFLICT DO NOTHING;
  SELECT * INTO idem FROM idempotency_receipt WHERE tenant_id=p_tenant AND operation_scope='WBS_COMPANY_CATALOG_RETAIN:'||p_entity AND idempotency_key=p_idempotency_key FOR UPDATE;
  IF idem.request_hash<>p_request_hash THEN RAISE EXCEPTION 'Idempotency key reused with different company catalog' USING ERRCODE='23505'; END IF;
  IF idem.status='SUCCEEDED' THEN RETURN idem.response_body||jsonb_build_object('idempotent',true); END IF;
  INSERT INTO wbs_company_catalog_candidate(wbs_company_catalog_candidate_id,tenant_id,entity_id,catalog_version,generated_at,provider_environment,source_name,source_version,raw_file_hash,catalog_hash,source_row_count,accepted_row_count,rejected_row_count,source_rejections,declared_account_book_total,declared_account_book_open,declared_account_book_closed,declared_companies_with_books,recomputed_account_book_total,recomputed_account_book_open,recomputed_account_book_closed,recomputed_companies_with_books,retained_by,request_hash)
  VALUES(candidate_id,p_tenant,p_entity,p_catalog->>'catalog_version',(p_catalog->>'generated_at')::timestamptz,p_catalog->>'provider_environment',p_catalog->>'source_name',p_catalog->>'source_version',p_catalog->>'raw_file_hash',p_catalog->>'catalog_hash',(source_control->>'source_row_count')::integer,(source_control->>'accepted_row_count')::integer,(source_control->>'rejected_row_count')::integer,source_control->'rejected_rows',(book_control->>'declared_total')::integer,(book_control->>'declared_open')::integer,(book_control->>'declared_closed')::integer,(book_control->>'declared_companies_with_books')::integer,(book_control->>'recomputed_total')::integer,(book_control->>'recomputed_open')::integer,(book_control->>'recomputed_closed')::integer,(book_control->>'recomputed_companies_with_books')::integer,actor,p_request_hash);
  FOR row_value IN SELECT value FROM jsonb_array_elements(p_catalog->'rows') LOOP
    row_id:=gen_random_uuid(); row_ids:=row_ids||jsonb_build_object(row_value->>'row_ordinal',row_id);
    INSERT INTO wbs_company_catalog_candidate_row(wbs_company_catalog_candidate_row_id,tenant_id,entity_id,wbs_company_catalog_candidate_id,row_ordinal,company_code,wbs_company_id,display_name,legal_name,proposed_active_status,proposed_entity_type,proposed_base_currency,operationally_active_2026,account_books,domains,account_book_count,open_account_book_count,row_hash)
    VALUES(row_id,p_tenant,p_entity,candidate_id,(row_value->>'row_ordinal')::integer,NULLIF(row_value->>'company_code',''),NULLIF(row_value->>'wbs_company_id',''),NULLIF(row_value->>'display_name',''),NULLIF(row_value->>'legal_name',''),NULLIF(row_value->>'active_status',''),NULLIF(row_value->>'entity_type',''),NULLIF(row_value->>'base_currency',''),coalesce((row_value->>'operationally_active_2026')::boolean,false),row_value->'account_books',row_value->'domains',(row_value->>'account_book_count')::integer,(row_value->>'open_account_book_count')::integer,row_value->>'row_hash');
  END LOOP;
  FOR finding_value IN SELECT value FROM jsonb_array_elements(p_catalog->'findings') LOOP
    row_id:=CASE WHEN finding_value->>'row_ordinal' IS NULL THEN NULL ELSE (row_ids->>(finding_value->>'row_ordinal'))::uuid END;
    INSERT INTO wbs_company_catalog_validation_finding(tenant_id,entity_id,wbs_company_catalog_candidate_id,wbs_company_catalog_candidate_row_id,row_ordinal,severity,finding_code,message,details,finding_hash)
    VALUES(p_tenant,p_entity,candidate_id,row_id,(finding_value->>'row_ordinal')::integer,finding_value->>'severity',finding_value->>'code',finding_value->>'message',finding_value->'details',finding_value->>'finding_hash');
  END LOOP;
  response:=jsonb_build_object('wbs_company_catalog_candidate_id',candidate_id,'catalog_version',p_catalog->>'catalog_version','catalog_hash',p_catalog->>'catalog_hash','record_count',jsonb_array_length(p_catalog->'rows'),'error_count',(SELECT count(*) FROM wbs_company_catalog_validation_finding WHERE tenant_id=p_tenant AND entity_id=p_entity AND wbs_company_catalog_candidate_id=candidate_id AND severity='ERROR'),'review_count',(SELECT count(*) FROM wbs_company_catalog_validation_finding WHERE tenant_id=p_tenant AND entity_id=p_entity AND wbs_company_catalog_candidate_id=candidate_id AND severity='REVIEW'),'revision',0,'idempotent',false,'can_approve',false,'can_create_mapping_snapshot',false);
  event_payload:=response-'idempotent';
  INSERT INTO audit_event(tenant_id,entity_id,event_type,object_type,object_id,action,actor_id,actor_type,permission_used,request_id,correlation_id,idempotency_key,after_hash,metadata) VALUES(p_tenant,p_entity,'WBS_COMPANY_CATALOG_RETAINED','WBS_COMPANY_CATALOG',candidate_id,'RETAIN',actor,'USER','WBS.COMPANY.CATALOG.RETAIN',p_idempotency_key,p_idempotency_key,p_idempotency_key,p_request_hash,event_payload);
  INSERT INTO outbox_event(tenant_id,entity_id,aggregate_type,aggregate_id,event_type,payload,payload_hash) VALUES(p_tenant,p_entity,'WBS_COMPANY_CATALOG',candidate_id,'WBS_COMPANY_CATALOG_RETAINED',event_payload,refs_jsonb_hash(event_payload));
  UPDATE idempotency_receipt SET status='SUCCEEDED',response_status=201,response_body=response,completed_at=clock_timestamp() WHERE idempotency_receipt_id=idem.idempotency_receipt_id;
  RETURN response;
END $$;

CREATE FUNCTION refs_read_wbs_company_catalogs(p_tenant uuid,p_entity uuid,p_limit integer,p_offset integer) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE result jsonb;
BEGIN
  PERFORM refs_assert_scope(p_tenant,p_entity,'WBS.COMPANY.CATALOG.VIEW');
  IF p_limit NOT BETWEEN 1 AND 100 OR p_offset NOT BETWEEN 0 AND 100000 THEN RAISE EXCEPTION 'Company catalog read bounds are invalid' USING ERRCODE='22023'; END IF;
  SELECT coalesce(jsonb_agg(item ORDER BY item->>'retained_at' DESC),'[]'::jsonb) INTO result FROM (
    SELECT jsonb_build_object('wbs_company_catalog_candidate_id',c.wbs_company_catalog_candidate_id,'catalog_version',c.catalog_version,'generated_at',c.generated_at,'provider_environment',c.provider_environment,'source_name',c.source_name,'source_version',c.source_version,'raw_file_hash',c.raw_file_hash,'catalog_hash',c.catalog_hash,'source_row_count',c.source_row_count,'record_count',c.accepted_row_count,'rejected_row_count',c.rejected_row_count,'source_rejections',c.source_rejections,'account_book_control',jsonb_build_object('declared_total',c.declared_account_book_total,'declared_open',c.declared_account_book_open,'declared_closed',c.declared_account_book_closed,'declared_companies_with_books',c.declared_companies_with_books,'recomputed_total',c.recomputed_account_book_total,'recomputed_open',c.recomputed_account_book_open,'recomputed_closed',c.recomputed_account_book_closed,'recomputed_companies_with_books',c.recomputed_companies_with_books,'reconciled',c.declared_account_book_total=c.recomputed_account_book_total AND c.declared_account_book_open=c.recomputed_account_book_open AND c.declared_account_book_closed=c.recomputed_account_book_closed AND c.declared_companies_with_books=c.recomputed_companies_with_books),'error_count',count(f.*) FILTER(WHERE f.severity='ERROR'),'review_count',count(f.*) FILTER(WHERE f.severity='REVIEW'),'info_count',count(f.*) FILTER(WHERE f.severity='INFO'),'retained_by',c.retained_by,'retained_at',c.retained_at,'can_create_mapping_snapshot',false) item
    FROM wbs_company_catalog_candidate c LEFT JOIN wbs_company_catalog_validation_finding f ON f.tenant_id=c.tenant_id AND f.entity_id=c.entity_id AND f.wbs_company_catalog_candidate_id=c.wbs_company_catalog_candidate_id
    WHERE c.tenant_id=p_tenant AND c.entity_id=p_entity GROUP BY c.wbs_company_catalog_candidate_id ORDER BY c.retained_at DESC,c.wbs_company_catalog_candidate_id LIMIT p_limit OFFSET p_offset
  ) q;
  RETURN result;
END $$;

CREATE FUNCTION refs_read_wbs_company_catalog_rows(p_tenant uuid,p_entity uuid,p_candidate uuid,p_limit integer,p_offset integer) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE result jsonb;
BEGIN
  PERFORM refs_assert_scope(p_tenant,p_entity,'WBS.COMPANY.CATALOG.VIEW');
  IF p_limit NOT BETWEEN 1 AND 50 OR p_offset NOT BETWEEN 0 AND 100000 OR NOT EXISTS(SELECT 1 FROM wbs_company_catalog_candidate WHERE tenant_id=p_tenant AND entity_id=p_entity AND wbs_company_catalog_candidate_id=p_candidate) THEN RAISE EXCEPTION 'Company catalog row read scope is invalid' USING ERRCODE='22023'; END IF;
  SELECT coalesce(jsonb_agg(item ORDER BY (item->>'row_ordinal')::integer),'[]'::jsonb) INTO result FROM (
    SELECT jsonb_build_object('wbs_company_catalog_candidate_row_id',r.wbs_company_catalog_candidate_row_id,'row_ordinal',r.row_ordinal,'company_code',r.company_code,'wbs_company_id',r.wbs_company_id,'display_name',r.display_name,'legal_name',r.legal_name,'active_status',r.proposed_active_status,'entity_type',r.proposed_entity_type,'base_currency',r.proposed_base_currency,'operationally_active_2026',r.operationally_active_2026,'account_books',r.account_books,'domains',r.domains,'account_book_count',r.account_book_count,'open_account_book_count',r.open_account_book_count,'row_hash',r.row_hash,'findings',coalesce((SELECT jsonb_agg(jsonb_build_object('severity',f.severity,'code',f.finding_code,'message',f.message,'details',f.details,'finding_hash',f.finding_hash) ORDER BY f.severity,f.finding_code) FROM wbs_company_catalog_validation_finding f WHERE f.tenant_id=r.tenant_id AND f.entity_id=r.entity_id AND f.wbs_company_catalog_candidate_row_id=r.wbs_company_catalog_candidate_row_id),'[]'::jsonb),'current_decision',(SELECT jsonb_build_object('decision_id',d.wbs_company_catalog_controller_decision_id,'revision',d.revision,'decision_type',d.decision_type,'company_code',d.company_code,'display_name',d.display_name,'legal_name',d.legal_name,'entity_type',d.entity_type,'active_status',d.active_status,'base_currency',d.base_currency,'effective_from',d.effective_from,'effective_to',d.effective_to,'mapping_version',d.mapping_version,'mapping_hash',d.mapping_hash,'decided_by',d.decided_by,'decided_at',d.decided_at,'decision_hash',d.decision_hash) FROM wbs_company_catalog_controller_decision d WHERE d.tenant_id=r.tenant_id AND d.entity_id=r.entity_id AND d.wbs_company_catalog_candidate_row_id=r.wbs_company_catalog_candidate_row_id ORDER BY d.revision DESC LIMIT 1),'can_create_mapping_snapshot',false) item
    FROM wbs_company_catalog_candidate_row r WHERE r.tenant_id=p_tenant AND r.entity_id=p_entity AND r.wbs_company_catalog_candidate_id=p_candidate ORDER BY r.row_ordinal LIMIT p_limit OFFSET p_offset
  ) q;
  RETURN result;
END $$;

CREATE FUNCTION refs_classify_wbs_company_catalog_hash(p_tenant uuid,p_entity uuid,p_row uuid,p_expected_revision bigint,p_classification jsonb,p_reason text) RETURNS text LANGUAGE sql IMMUTABLE SET search_path=pg_catalog,public,pg_temp AS $$
 SELECT refs_jsonb_hash(jsonb_build_object('tenant_id',p_tenant,'entity_id',p_entity,'row_id',p_row,'expected_revision',p_expected_revision,'classification',p_classification,'reason',btrim(p_reason)))
$$;

CREATE FUNCTION refs_classify_wbs_company_catalog_row(p_tenant uuid,p_entity uuid,p_row uuid,p_expected_revision bigint,p_classification jsonb,p_reason text,p_idempotency_key text,p_request_hash text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE actor text:=refs_current_actor(); idem idempotency_receipt; candidate wbs_company_catalog_candidate; row_record wbs_company_catalog_candidate_row; latest wbs_company_catalog_controller_decision; new_id uuid:=gen_random_uuid(); new_revision bigint; response jsonb; event_payload jsonb; computed_hash text; decision_hash text;
BEGIN
 PERFORM refs_assert_scope(p_tenant,p_entity,'WBS.COMPANY.CATALOG.CLASSIFY');
 computed_hash:=refs_classify_wbs_company_catalog_hash(p_tenant,p_entity,p_row,p_expected_revision,p_classification,p_reason);
 IF actor IS NULL OR computed_hash<>p_request_hash OR jsonb_typeof(p_classification)<>'object' OR p_classification->>'company_code' !~ '^[A-Z0-9][A-Z0-9_-]{0,63}$' OR p_classification->>'base_currency' !~ '^[A-Z]{3}$' OR p_classification->>'active_status' NOT IN ('ACTIVE','INACTIVE','CLOSED') OR p_classification->>'entity_type' NOT IN ('LEGAL_ENTITY','CONSOLIDATION','INACTIVE','TEST','OTHER') OR length(btrim(coalesce(p_classification->>'display_name',''))) NOT BETWEEN 1 AND 200 OR length(btrim(coalesce(p_classification->>'legal_name',''))) NOT BETWEEN 1 AND 200 OR length(btrim(coalesce(p_reason,''))) NOT BETWEEN 8 AND 2000 THEN RAISE EXCEPTION 'Company catalog classification is invalid' USING ERRCODE='22023'; END IF;
 INSERT INTO idempotency_receipt(tenant_id,operation_scope,idempotency_key,request_hash,status,actor_id) VALUES(p_tenant,'WBS_COMPANY_CATALOG_CLASSIFY:'||p_entity||':'||p_row,p_idempotency_key,p_request_hash,'IN_PROGRESS',actor) ON CONFLICT DO NOTHING;
 SELECT * INTO idem FROM idempotency_receipt WHERE tenant_id=p_tenant AND operation_scope='WBS_COMPANY_CATALOG_CLASSIFY:'||p_entity||':'||p_row AND idempotency_key=p_idempotency_key FOR UPDATE;
 IF idem.request_hash<>p_request_hash THEN RAISE EXCEPTION 'Classification idempotency conflict' USING ERRCODE='23505'; END IF; IF idem.status='SUCCEEDED' THEN RETURN idem.response_body||jsonb_build_object('idempotent',true); END IF;
 SELECT * INTO row_record FROM wbs_company_catalog_candidate_row WHERE tenant_id=p_tenant AND entity_id=p_entity AND wbs_company_catalog_candidate_row_id=p_row FOR SHARE; IF NOT FOUND THEN RAISE EXCEPTION 'Company catalog row not found' USING ERRCODE='P0002'; END IF;
 IF row_record.company_code IS NULL OR p_classification->>'company_code' IS DISTINCT FROM row_record.company_code THEN RAISE EXCEPTION 'Controller classification company code must equal the exact retained WBS company code' USING ERRCODE='23514'; END IF;
 SELECT * INTO candidate FROM wbs_company_catalog_candidate WHERE tenant_id=p_tenant AND entity_id=p_entity AND wbs_company_catalog_candidate_id=row_record.wbs_company_catalog_candidate_id FOR SHARE;
 SELECT * INTO latest FROM wbs_company_catalog_controller_decision WHERE tenant_id=p_tenant AND entity_id=p_entity AND wbs_company_catalog_candidate_row_id=p_row ORDER BY revision DESC LIMIT 1 FOR UPDATE;
 IF coalesce(latest.revision,0)<>p_expected_revision THEN RAISE EXCEPTION 'Company catalog decision revision conflict' USING ERRCODE='40001'; END IF; IF latest.decision_type='APPROVED' THEN RAISE EXCEPTION 'Approved company catalog decisions are immutable' USING ERRCODE='55000'; END IF; IF actor=candidate.retained_by THEN RAISE EXCEPTION 'Catalog retainer cannot classify the same candidate' USING ERRCODE='42501'; END IF;
 new_revision:=p_expected_revision+1; decision_hash:=refs_jsonb_hash(jsonb_build_object('row_id',p_row,'revision',new_revision,'decision_type','CLASSIFIED','classification',p_classification,'reason',btrim(p_reason),'decided_by',actor,'prior_decision_hash',latest.decision_hash));
 INSERT INTO wbs_company_catalog_controller_decision(wbs_company_catalog_controller_decision_id,tenant_id,entity_id,wbs_company_catalog_candidate_id,wbs_company_catalog_candidate_row_id,revision,decision_type,company_code,display_name,legal_name,entity_type,active_status,base_currency,reason,decided_by,prior_decision_hash,decision_hash,request_hash) VALUES(new_id,p_tenant,p_entity,row_record.wbs_company_catalog_candidate_id,p_row,new_revision,'CLASSIFIED',p_classification->>'company_code',p_classification->>'display_name',p_classification->>'legal_name',p_classification->>'entity_type',p_classification->>'active_status',p_classification->>'base_currency',btrim(p_reason),actor,latest.decision_hash,decision_hash,p_request_hash);
 response:=jsonb_build_object('decision_id',new_id,'row_id',p_row,'decision_type','CLASSIFIED','company_code',p_classification->>'company_code','revision',new_revision,'decision_hash',decision_hash,'idempotent',false,'can_approve',true,'can_create_mapping_snapshot',false); event_payload:=response-'idempotent';
 INSERT INTO audit_event(tenant_id,entity_id,event_type,object_type,object_id,action,actor_id,actor_type,permission_used,request_id,correlation_id,idempotency_key,before_hash,after_hash,reason,metadata) VALUES(p_tenant,p_entity,'WBS_COMPANY_CATALOG_CLASSIFIED','WBS_COMPANY_CATALOG_DECISION',new_id,'CLASSIFY',actor,'USER','WBS.COMPANY.CATALOG.CLASSIFY',p_idempotency_key,p_idempotency_key,p_idempotency_key,latest.decision_hash,decision_hash,btrim(p_reason),event_payload);
 INSERT INTO outbox_event(tenant_id,entity_id,aggregate_type,aggregate_id,event_type,payload,payload_hash) VALUES(p_tenant,p_entity,'WBS_COMPANY_CATALOG_DECISION',new_id,'WBS_COMPANY_CATALOG_CLASSIFIED',event_payload,refs_jsonb_hash(event_payload));
 UPDATE idempotency_receipt SET status='SUCCEEDED',response_status=201,response_body=response,completed_at=clock_timestamp() WHERE idempotency_receipt_id=idem.idempotency_receipt_id; RETURN response;
END $$;

CREATE FUNCTION refs_approve_wbs_company_catalog_hash(p_tenant uuid,p_entity uuid,p_row uuid,p_expected_revision bigint,p_expected_catalog_hash text,p_expected_row_hash text,p_effective_from date,p_effective_to date,p_reason text) RETURNS text LANGUAGE sql IMMUTABLE SET search_path=pg_catalog,public,pg_temp AS $$
 SELECT refs_jsonb_hash(jsonb_build_object('tenant_id',p_tenant,'entity_id',p_entity,'row_id',p_row,'expected_revision',p_expected_revision,'expected_catalog_hash',p_expected_catalog_hash,'expected_row_hash',p_expected_row_hash,'effective_from',p_effective_from,'effective_to',p_effective_to,'reason',btrim(p_reason)))
$$;

CREATE FUNCTION refs_approve_wbs_company_catalog_row(p_tenant uuid,p_entity uuid,p_row uuid,p_expected_revision bigint,p_expected_catalog_hash text,p_expected_row_hash text,p_effective_from date,p_effective_to date,p_reason text,p_idempotency_key text,p_request_hash text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE actor text:=refs_current_actor(); idem idempotency_receipt; candidate wbs_company_catalog_candidate; row_record wbs_company_catalog_candidate_row; latest wbs_company_catalog_controller_decision; entity_record entity; new_id uuid:=gen_random_uuid(); new_revision bigint; approved_at timestamptz:=clock_timestamp(); mapping_version text; mapping_document jsonb; mapping_hash text; response jsonb; event_payload jsonb; computed_hash text; decision_hash text; binding_before text;
BEGIN
 PERFORM refs_assert_scope(p_tenant,p_entity,'WBS.COMPANY.CATALOG.APPROVE');
 computed_hash:=refs_approve_wbs_company_catalog_hash(p_tenant,p_entity,p_row,p_expected_revision,p_expected_catalog_hash,p_expected_row_hash,p_effective_from,p_effective_to,p_reason);
 IF actor IS NULL OR computed_hash<>p_request_hash OR p_expected_catalog_hash !~ '^sha256:[0-9a-f]{64}$' OR p_expected_row_hash !~ '^sha256:[0-9a-f]{64}$' OR p_effective_from IS NULL OR (p_effective_to IS NOT NULL AND p_effective_to<p_effective_from) OR length(btrim(coalesce(p_reason,''))) NOT BETWEEN 8 AND 2000 THEN RAISE EXCEPTION 'Company catalog approval is invalid' USING ERRCODE='22023'; END IF;
 INSERT INTO idempotency_receipt(tenant_id,operation_scope,idempotency_key,request_hash,status,actor_id) VALUES(p_tenant,'WBS_COMPANY_CATALOG_APPROVE:'||p_entity||':'||p_row,p_idempotency_key,p_request_hash,'IN_PROGRESS',actor) ON CONFLICT DO NOTHING;
 SELECT * INTO idem FROM idempotency_receipt WHERE tenant_id=p_tenant AND operation_scope='WBS_COMPANY_CATALOG_APPROVE:'||p_entity||':'||p_row AND idempotency_key=p_idempotency_key FOR UPDATE;
 IF idem.request_hash<>p_request_hash THEN RAISE EXCEPTION 'Approval idempotency conflict' USING ERRCODE='23505'; END IF; IF idem.status='SUCCEEDED' THEN RETURN idem.response_body||jsonb_build_object('idempotent',true); END IF;
 SELECT * INTO row_record FROM wbs_company_catalog_candidate_row WHERE tenant_id=p_tenant AND entity_id=p_entity AND wbs_company_catalog_candidate_row_id=p_row FOR SHARE; IF NOT FOUND THEN RAISE EXCEPTION 'Company catalog row not found' USING ERRCODE='P0002'; END IF;
 SELECT * INTO candidate FROM wbs_company_catalog_candidate WHERE tenant_id=p_tenant AND entity_id=p_entity AND wbs_company_catalog_candidate_id=row_record.wbs_company_catalog_candidate_id FOR SHARE;
 SELECT * INTO latest FROM wbs_company_catalog_controller_decision WHERE tenant_id=p_tenant AND entity_id=p_entity AND wbs_company_catalog_candidate_row_id=p_row ORDER BY revision DESC LIMIT 1 FOR UPDATE;
 IF NOT FOUND OR coalesce(latest.revision,0)<>p_expected_revision THEN RAISE EXCEPTION 'Company catalog decision revision conflict' USING ERRCODE='40001'; END IF; IF latest.decision_type<>'CLASSIFIED' OR latest.active_status<>'ACTIVE' OR latest.entity_type<>'LEGAL_ENTITY' THEN RAISE EXCEPTION 'Only a classified active legal entity may be approved' USING ERRCODE='23514'; END IF; IF actor IN (candidate.retained_by,latest.decided_by) THEN RAISE EXCEPTION 'Catalog retention, classification, and approval actors must be distinct' USING ERRCODE='42501'; END IF;
 IF candidate.catalog_hash<>p_expected_catalog_hash OR row_record.row_hash<>p_expected_row_hash OR candidate.declared_account_book_total<>candidate.recomputed_account_book_total OR candidate.declared_account_book_open<>candidate.recomputed_account_book_open OR candidate.declared_account_book_closed<>candidate.recomputed_account_book_closed OR candidate.declared_companies_with_books<>candidate.recomputed_companies_with_books OR candidate.source_row_count<>candidate.accepted_row_count+candidate.rejected_row_count OR EXISTS(SELECT 1 FROM wbs_company_catalog_validation_finding f WHERE f.tenant_id=p_tenant AND f.entity_id=p_entity AND f.wbs_company_catalog_candidate_id=candidate.wbs_company_catalog_candidate_id AND f.severity='ERROR') THEN RAISE EXCEPTION 'Catalog controls or exact evidence hash are not approval-ready' USING ERRCODE='23514'; END IF;
 SELECT * INTO entity_record FROM entity WHERE tenant_id=p_tenant AND entity_id=p_entity FOR UPDATE; IF NOT FOUND OR NOT entity_record.active OR entity_record.base_currency<>latest.base_currency THEN RAISE EXCEPTION 'Entity and classified currency scope do not match' USING ERRCODE='23514'; END IF;
 binding_before:=refs_jsonb_hash(jsonb_build_object('source_system',entity_record.source_system,'source_entity_id',entity_record.source_entity_id));
 IF entity_record.source_system='WBS' THEN IF entity_record.source_entity_id<>latest.company_code THEN RAISE EXCEPTION 'Entity is already bound to a different WBS company' USING ERRCODE='23514'; END IF;
 ELSE IF EXISTS(SELECT 1 FROM source_document WHERE tenant_id=p_tenant AND entity_id=p_entity) OR EXISTS(SELECT 1 FROM journal_entry WHERE tenant_id=p_tenant AND entity_id=p_entity) OR EXISTS(SELECT 1 FROM bank_source WHERE tenant_id=p_tenant AND entity_id=p_entity) OR EXISTS(SELECT 1 FROM business_document WHERE tenant_id=p_tenant AND entity_id=p_entity) THEN RAISE EXCEPTION 'A non-WBS entity with accounting source evidence cannot be rebound' USING ERRCODE='23514'; END IF; UPDATE entity SET source_system='WBS',source_entity_id=latest.company_code WHERE tenant_id=p_tenant AND entity_id=p_entity; END IF;
 new_revision:=p_expected_revision+1; mapping_version:=candidate.catalog_version||'-r'||new_revision::text;
 mapping_document:=jsonb_build_object('tenant_id',p_tenant,'refs_entity_id',p_entity,'company_code',latest.company_code,'base_currency',latest.base_currency,'effective_from',to_char(p_effective_from,'YYYY-MM-DD'),'effective_to',CASE WHEN p_effective_to IS NULL THEN NULL ELSE to_jsonb(to_char(p_effective_to,'YYYY-MM-DD')) END,'approval_status','APPROVED','approved_by',actor,'approved_at',to_char(approved_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),'mapping_version',mapping_version);
 mapping_hash:=refs_jsonb_hash(mapping_document); mapping_document:=mapping_document||jsonb_build_object('mapping_hash',mapping_hash);
 decision_hash:=refs_jsonb_hash(jsonb_build_object('row_id',p_row,'revision',new_revision,'decision_type','APPROVED','mapping',mapping_document,'reason',btrim(p_reason),'decided_by',actor,'prior_decision_hash',latest.decision_hash));
 INSERT INTO wbs_company_catalog_controller_decision(wbs_company_catalog_controller_decision_id,tenant_id,entity_id,wbs_company_catalog_candidate_id,wbs_company_catalog_candidate_row_id,revision,decision_type,company_code,display_name,legal_name,entity_type,active_status,base_currency,effective_from,effective_to,mapping_version,mapping_document,mapping_hash,reason,decided_by,prior_decision_hash,decision_hash,request_hash) VALUES(new_id,p_tenant,p_entity,row_record.wbs_company_catalog_candidate_id,p_row,new_revision,'APPROVED',latest.company_code,latest.display_name,latest.legal_name,latest.entity_type,latest.active_status,latest.base_currency,p_effective_from,p_effective_to,mapping_version,mapping_document,mapping_hash,btrim(p_reason),actor,latest.decision_hash,decision_hash,p_request_hash);
 response:=jsonb_build_object('decision_id',new_id,'row_id',p_row,'decision_type','APPROVED','company_code',latest.company_code,'revision',new_revision,'mapping',mapping_document,'entity_binding',jsonb_build_object('source_system','WBS','source_entity_id',latest.company_code),'decision_hash',decision_hash,'idempotent',false,'can_create_mapping_snapshot',false); event_payload:=response-'idempotent';
 INSERT INTO audit_event(tenant_id,entity_id,event_type,object_type,object_id,action,actor_id,actor_type,permission_used,request_id,correlation_id,idempotency_key,before_hash,after_hash,reason,metadata) VALUES(p_tenant,p_entity,'WBS_COMPANY_CATALOG_APPROVED','WBS_COMPANY_CATALOG_DECISION',new_id,'APPROVE_AND_BIND_ENTITY',actor,'USER','WBS.COMPANY.CATALOG.APPROVE',p_idempotency_key,p_idempotency_key,p_idempotency_key,latest.decision_hash,decision_hash,btrim(p_reason),event_payload||jsonb_build_object('binding_before_hash',binding_before));
 INSERT INTO outbox_event(tenant_id,entity_id,aggregate_type,aggregate_id,event_type,payload,payload_hash) VALUES(p_tenant,p_entity,'WBS_COMPANY_CATALOG_DECISION',new_id,'WBS_COMPANY_CATALOG_APPROVED',event_payload,refs_jsonb_hash(event_payload));
 UPDATE idempotency_receipt SET status='SUCCEEDED',response_status=201,response_body=response,completed_at=clock_timestamp() WHERE idempotency_receipt_id=idem.idempotency_receipt_id; RETURN response;
END $$;

REVOKE ALL ON wbs_company_catalog_candidate,wbs_company_catalog_candidate_row,wbs_company_catalog_validation_finding,wbs_company_catalog_controller_decision FROM PUBLIC,refs_app;
GRANT SELECT ON wbs_company_catalog_candidate,wbs_company_catalog_candidate_row,wbs_company_catalog_validation_finding,wbs_company_catalog_controller_decision TO refs_app;
REVOKE EXECUTE ON FUNCTION refs_retain_wbs_company_catalog_hash(uuid,uuid,jsonb),refs_retain_wbs_company_catalog(uuid,uuid,jsonb,text,text),refs_read_wbs_company_catalogs(uuid,uuid,integer,integer),refs_read_wbs_company_catalog_rows(uuid,uuid,uuid,integer,integer),refs_classify_wbs_company_catalog_hash(uuid,uuid,uuid,bigint,jsonb,text),refs_classify_wbs_company_catalog_row(uuid,uuid,uuid,bigint,jsonb,text,text,text),refs_approve_wbs_company_catalog_hash(uuid,uuid,uuid,bigint,text,text,date,date,text),refs_approve_wbs_company_catalog_row(uuid,uuid,uuid,bigint,text,text,date,date,text,text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION refs_retain_wbs_company_catalog_hash(uuid,uuid,jsonb),refs_retain_wbs_company_catalog(uuid,uuid,jsonb,text,text),refs_read_wbs_company_catalogs(uuid,uuid,integer,integer),refs_read_wbs_company_catalog_rows(uuid,uuid,uuid,integer,integer),refs_classify_wbs_company_catalog_hash(uuid,uuid,uuid,bigint,jsonb,text),refs_classify_wbs_company_catalog_row(uuid,uuid,uuid,bigint,jsonb,text,text,text),refs_approve_wbs_company_catalog_hash(uuid,uuid,uuid,bigint,text,text,date,date,text),refs_approve_wbs_company_catalog_row(uuid,uuid,uuid,bigint,text,text,date,date,text,text,text) TO refs_app;

COMMIT;
