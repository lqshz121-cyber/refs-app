BEGIN;

CREATE FUNCTION refs_wbs_h1_accounting_canonical_json(value jsonb) RETURNS text LANGUAGE plpgsql IMMUTABLE SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE kind text:=jsonb_typeof(value);result text;
BEGIN
 IF kind='object' THEN SELECT '{'||coalesce(string_agg(to_json(k)::text||':'||refs_wbs_h1_accounting_canonical_json(v),',' ORDER BY k),'')||'}' INTO result FROM jsonb_each(value) e(k,v);
 ELSIF kind='array' THEN SELECT '['||coalesce(string_agg(refs_wbs_h1_accounting_canonical_json(v),',' ORDER BY n),'')||']' INTO result FROM jsonb_array_elements(value) WITH ORDINALITY e(v,n);
 ELSE result:=value::text;END IF;RETURN result;
END $$;
CREATE FUNCTION refs_wbs_h1_accounting_jsonb_hash(value jsonb) RETURNS text LANGUAGE sql IMMUTABLE SET search_path=pg_catalog,public,pg_temp AS $$SELECT 'sha256:'||encode(digest(convert_to(refs_wbs_h1_accounting_canonical_json(value),'UTF8'),'sha256'),'hex')$$;

CREATE TABLE wbs_h1_accounting_population_run(
 run_id uuid PRIMARY KEY,tenant_id uuid NOT NULL,entity_id uuid NOT NULL,company_code text NOT NULL,
 currency text NOT NULL CHECK(currency~'^[A-Z]{3}$'),date_from date NOT NULL,date_to date NOT NULL,
 source_version text NOT NULL CHECK(source_version~'^sha256:[0-9a-f]{64}$'),snapshot_token_hash text NOT NULL CHECK(snapshot_token_hash~'^sha256:[0-9a-f]{64}$'),
 provider_content_hash text NOT NULL CHECK(provider_content_hash~'^sha256:[0-9a-f]{64}$'),source_manifest jsonb NOT NULL,source_manifest_hash text NOT NULL CHECK(source_manifest_hash~'^sha256:[0-9a-f]{64}$' AND source_manifest_hash=refs_wbs_h1_accounting_jsonb_hash(source_manifest)),captured_at timestamptz NOT NULL,
 expected_row_count integer NOT NULL CHECK(expected_row_count>0),expected_h1_row_count integer NOT NULL CHECK(expected_h1_row_count BETWEEN 0 AND expected_row_count),
 expected_excluded_count integer NOT NULL CHECK(expected_excluded_count=expected_row_count-expected_h1_row_count),
 expected_debit numeric(24,4) NOT NULL,expected_credit numeric(24,4) NOT NULL CHECK(expected_credit=expected_debit),
 population_hash text NOT NULL CHECK(population_hash~'^sha256:[0-9a-f]{64}$'),request_hash text NOT NULL CHECK(request_hash~'^sha256:[0-9a-f]{64}$'),
 idempotency_key text NOT NULL CHECK(length(idempotency_key) BETWEEN 8 AND 200),created_by text NOT NULL,created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 UNIQUE(tenant_id,entity_id,idempotency_key),UNIQUE(tenant_id,entity_id,company_code,source_version,population_hash),
 FOREIGN KEY(tenant_id,entity_id) REFERENCES entity(tenant_id,entity_id),CHECK(date_from=DATE '2026-01-01' AND date_to=DATE '2026-06-30')
);
CREATE TABLE wbs_h1_accounting_evidence_line(
 run_id uuid NOT NULL REFERENCES wbs_h1_accounting_population_run(run_id),tenant_id uuid NOT NULL,entity_id uuid NOT NULL,
 wbs_accounting_info_id bigint NOT NULL,row_ordinal integer NOT NULL CHECK(row_ordinal>0),source_version text NOT NULL,
 journal_group_id text,line_no integer,period_id uuid,period_code text,set_date date,posting_date date,currency text NOT NULL,
 account_code text,debit_amount numeric(24,4) NOT NULL,credit_amount numeric(24,4) NOT NULL,
 member_ref text,project_ref text,property_ref text,cost_code text,unit_ref text,business_guid text,sys_id text,bill_no text,cb_id text,
 come_from text NOT NULL,source text NOT NULL,review_status text NOT NULL,closed_status text NOT NULL,
 completeness_status text NOT NULL CHECK(completeness_status IN('COMPLETE','MISSING_POSTING_DATE','MISSING_ACCOUNT','MISSING_PROJECT','MISSING_COST_CODE','MISSING_PAYEE','ZERO_AMOUNT','MULTIPLE_GAPS','OUTSIDE_H1')),
 gap_codes jsonb NOT NULL CHECK(jsonb_typeof(gap_codes)='array'),excluded_from_h1 boolean NOT NULL,line_document jsonb NOT NULL,
 line_hash text NOT NULL CHECK(line_hash~'^sha256:[0-9a-f]{64}$' AND line_hash=refs_wbs_h1_accounting_jsonb_hash(line_document)),
 PRIMARY KEY(run_id,wbs_accounting_info_id),UNIQUE(run_id,row_ordinal),
 FOREIGN KEY(tenant_id,entity_id,period_id) REFERENCES accounting_period(tenant_id,entity_id,period_id),
 CHECK(debit_amount=0 OR credit_amount=0),
 CHECK((excluded_from_h1 AND period_id IS NULL AND period_code IS NULL AND completeness_status='OUTSIDE_H1') OR
       (NOT excluded_from_h1 AND period_id IS NOT NULL AND period_code~'^2026-0[1-6]$' AND completeness_status<>'OUTSIDE_H1'))
);
CREATE TABLE wbs_h1_accounting_module_receipt(
 receipt_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),run_id uuid NOT NULL REFERENCES wbs_h1_accounting_population_run(run_id),
 tenant_id uuid NOT NULL,entity_id uuid NOT NULL,period_id uuid NOT NULL,period_code text NOT NULL,currency text NOT NULL,module_code text NOT NULL,
 row_count integer NOT NULL CHECK(row_count>0),debit_amount numeric(24,4) NOT NULL,credit_amount numeric(24,4) NOT NULL,
 module_hash text NOT NULL CHECK(module_hash~'^sha256:[0-9a-f]{64}$'),balance_status text NOT NULL CHECK(balance_status='BALANCED' AND debit_amount=credit_amount),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),UNIQUE(run_id,period_code,currency,module_code),
 FOREIGN KEY(tenant_id,entity_id,period_id) REFERENCES accounting_period(tenant_id,entity_id,period_id)
);
CREATE TABLE wbs_h1_accounting_population_receipt(
 receipt_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),run_id uuid NOT NULL UNIQUE REFERENCES wbs_h1_accounting_population_run(run_id),
 tenant_id uuid NOT NULL,entity_id uuid NOT NULL,row_count integer NOT NULL,h1_row_count integer NOT NULL,excluded_row_count integer NOT NULL,
 debit_amount numeric(24,4) NOT NULL,credit_amount numeric(24,4) NOT NULL,population_hash text NOT NULL,module_receipt_count integer NOT NULL CHECK(module_receipt_count>0),
 receipt_document jsonb NOT NULL,receipt_hash text NOT NULL CHECK(receipt_hash=refs_jsonb_hash(receipt_document)),finalized_by text NOT NULL,finalized_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 FOREIGN KEY(tenant_id,entity_id) REFERENCES entity(tenant_id,entity_id)
);

ALTER TABLE wbs_h1_accounting_population_run ENABLE ROW LEVEL SECURITY;ALTER TABLE wbs_h1_accounting_evidence_line ENABLE ROW LEVEL SECURITY;ALTER TABLE wbs_h1_accounting_module_receipt ENABLE ROW LEVEL SECURITY;ALTER TABLE wbs_h1_accounting_population_receipt ENABLE ROW LEVEL SECURITY;
CREATE POLICY wbs_h1_accounting_population_run_scope ON wbs_h1_accounting_population_run USING(tenant_id=refs_current_tenant() AND refs_entity_allowed(entity_id)) WITH CHECK(tenant_id=refs_current_tenant() AND refs_entity_allowed(entity_id));
CREATE POLICY wbs_h1_accounting_evidence_line_scope ON wbs_h1_accounting_evidence_line USING(tenant_id=refs_current_tenant() AND refs_entity_allowed(entity_id)) WITH CHECK(tenant_id=refs_current_tenant() AND refs_entity_allowed(entity_id));
CREATE POLICY wbs_h1_accounting_module_receipt_scope ON wbs_h1_accounting_module_receipt USING(tenant_id=refs_current_tenant() AND refs_entity_allowed(entity_id)) WITH CHECK(tenant_id=refs_current_tenant() AND refs_entity_allowed(entity_id));
CREATE POLICY wbs_h1_accounting_population_receipt_scope ON wbs_h1_accounting_population_receipt USING(tenant_id=refs_current_tenant() AND refs_entity_allowed(entity_id)) WITH CHECK(tenant_id=refs_current_tenant() AND refs_entity_allowed(entity_id));
CREATE TRIGGER wbs_h1_accounting_population_run_append_only BEFORE UPDATE OR DELETE ON wbs_h1_accounting_population_run FOR EACH ROW EXECUTE FUNCTION reject_mutation();
CREATE TRIGGER wbs_h1_accounting_evidence_line_append_only BEFORE UPDATE OR DELETE ON wbs_h1_accounting_evidence_line FOR EACH ROW EXECUTE FUNCTION reject_mutation();
CREATE TRIGGER wbs_h1_accounting_module_receipt_append_only BEFORE UPDATE OR DELETE ON wbs_h1_accounting_module_receipt FOR EACH ROW EXECUTE FUNCTION reject_mutation();
CREATE TRIGGER wbs_h1_accounting_population_receipt_append_only BEFORE UPDATE OR DELETE ON wbs_h1_accounting_population_receipt FOR EACH ROW EXECUTE FUNCTION reject_mutation();
REVOKE ALL ON wbs_h1_accounting_population_run,wbs_h1_accounting_evidence_line,wbs_h1_accounting_module_receipt,wbs_h1_accounting_population_receipt FROM PUBLIC,refs_app;
GRANT SELECT ON wbs_h1_accounting_population_run,wbs_h1_accounting_evidence_line,wbs_h1_accounting_module_receipt,wbs_h1_accounting_population_receipt TO refs_app;

CREATE FUNCTION refs_create_wbs_h1_accounting_population_run(p_run uuid,p_tenant uuid,p_entity uuid,p_company text,p_currency text,p_source_version text,p_snapshot_token_hash text,p_provider_hash text,p_source_manifest jsonb,p_source_manifest_hash text,p_captured_at timestamptz,p_expected_count integer,p_h1_count integer,p_excluded_count integer,p_debit numeric,p_credit numeric,p_population_hash text,p_idempotency text,p_request_hash text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE actor text:=refs_current_actor(); stored wbs_h1_accounting_population_run; expected_hash text;
BEGIN
 PERFORM refs_assert_scope(p_tenant,p_entity,'WBS.SNAPSHOT.IMPORT');
 expected_hash:=refs_jsonb_hash(jsonb_build_object('run_id',p_run,'tenant_id',p_tenant,'entity_id',p_entity,'company_code',p_company,'currency',p_currency,'source_version',p_source_version,'snapshot_token_hash',p_snapshot_token_hash,'provider_content_hash',p_provider_hash,'source_manifest_hash',p_source_manifest_hash,'captured_at',p_captured_at,'expected_row_count',p_expected_count,'included_h1_row_count',p_h1_count,'excluded_row_count',p_excluded_count,'debit_amount',to_char(p_debit,'FM999999999999999999990.0000'),'credit_amount',to_char(p_credit,'FM999999999999999999990.0000'),'population_hash',p_population_hash));
 IF actor IS NULL OR p_run IS NULL OR p_company!~'^[A-Z0-9][A-Z0-9_:-]{0,63}$' OR p_currency!~'^[A-Z]{3}$' OR p_source_version!~'^sha256:[0-9a-f]{64}$' OR p_snapshot_token_hash!~'^sha256:[0-9a-f]{64}$' OR p_provider_hash!~'^sha256:[0-9a-f]{64}$' OR jsonb_typeof(p_source_manifest)<>'object' OR ARRAY(SELECT jsonb_object_keys(p_source_manifest) ORDER BY 1)<>ARRAY['bytes','company_code','date_from','date_to','domain','file_name','generated_at','period','rows','schema_version','sha256'] OR p_source_manifest_hash IS DISTINCT FROM refs_wbs_h1_accounting_jsonb_hash(p_source_manifest) OR p_source_manifest->>'schema_version'<>'WBS_H1_2026_LOCAL_SNAPSHOT_V1' OR p_source_manifest->>'domain'<>'accounting_info' OR p_source_manifest->>'company_code'<>p_company OR p_source_manifest->>'period'<>'2026-H1' OR p_source_manifest->>'date_from'<>'2026-01-01' OR p_source_manifest->>'date_to'<>'2026-06-30' OR p_source_manifest->>'generated_at'!~'^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$' OR (p_source_manifest->>'generated_at')::timestamptz IS DISTINCT FROM p_captured_at OR p_source_manifest->>'file_name'<>'accounting_info__'||p_company||'__2026-H1.ndjson' OR p_source_manifest->>'rows'!~'^[1-9][0-9]*$' OR p_source_manifest->>'bytes'!~'^[1-9][0-9]*$' OR p_source_manifest->>'sha256'!~'^[0-9a-f]{64}$' OR p_source_manifest->>'sha256'<>substring(p_provider_hash from 8) OR (p_source_manifest->>'rows')::integer<>p_expected_count OR p_population_hash!~'^sha256:[0-9a-f]{64}$' OR p_expected_count<1 OR p_h1_count<0 OR p_excluded_count<>p_expected_count-p_h1_count OR p_credit<>p_debit OR length(p_idempotency) NOT BETWEEN 8 AND 200 OR p_request_hash IS DISTINCT FROM expected_hash THEN RAISE EXCEPTION 'WBS H1 accounting population run is invalid' USING ERRCODE='22023';END IF;
 PERFORM 1 FROM entity WHERE tenant_id=p_tenant AND entity_id=p_entity AND active AND source_system='WBS' AND entity_code=p_company AND source_entity_id=p_company FOR SHARE;IF NOT FOUND THEN RAISE EXCEPTION 'WBS company scope is unavailable' USING ERRCODE='23503';END IF;
 IF (SELECT count(*) FROM accounting_period WHERE tenant_id=p_tenant AND entity_id=p_entity AND period_code~'^2026-0[1-6]$' AND starts_on=(period_code||'-01')::date AND ends_on=(starts_on+interval '1 month'-interval '1 day')::date)<>6 THEN RAISE EXCEPTION 'All six exact WBS H1 accounting periods are required' USING ERRCODE='23503';END IF;
 SELECT * INTO stored FROM wbs_h1_accounting_population_run WHERE tenant_id=p_tenant AND entity_id=p_entity AND idempotency_key=p_idempotency FOR SHARE;
 IF FOUND THEN IF stored.request_hash<>p_request_hash OR stored.created_by<>actor THEN RAISE EXCEPTION 'WBS population idempotency conflict' USING ERRCODE='23505';END IF;RETURN jsonb_build_object('run_id',stored.run_id,'idempotent',true);END IF;
 INSERT INTO wbs_h1_accounting_population_run(run_id,tenant_id,entity_id,company_code,currency,date_from,date_to,source_version,snapshot_token_hash,provider_content_hash,source_manifest,source_manifest_hash,captured_at,expected_row_count,expected_h1_row_count,expected_excluded_count,expected_debit,expected_credit,population_hash,request_hash,idempotency_key,created_by)
 VALUES(p_run,p_tenant,p_entity,p_company,p_currency,DATE '2026-01-01',DATE '2026-06-30',p_source_version,p_snapshot_token_hash,p_provider_hash,p_source_manifest,p_source_manifest_hash,p_captured_at,p_expected_count,p_h1_count,p_excluded_count,p_debit,p_credit,p_population_hash,p_request_hash,p_idempotency,actor);
 RETURN jsonb_build_object('run_id',p_run,'idempotent',false);
END $$;

CREATE FUNCTION refs_append_wbs_h1_accounting_population_lines(p_tenant uuid,p_entity uuid,p_run uuid,p_lines jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE run wbs_h1_accounting_population_run; expected integer; exact integer;
BEGIN
 PERFORM refs_assert_scope(p_tenant,p_entity,'WBS.SNAPSHOT.IMPORT');SELECT * INTO run FROM wbs_h1_accounting_population_run WHERE run_id=p_run AND tenant_id=p_tenant AND entity_id=p_entity FOR SHARE;
 IF NOT FOUND OR EXISTS(SELECT 1 FROM wbs_h1_accounting_population_receipt WHERE run_id=p_run) OR jsonb_typeof(p_lines)<>'array' OR jsonb_array_length(p_lines)<1 OR jsonb_array_length(p_lines)>1000 THEN RAISE EXCEPTION 'WBS accounting population page is invalid or finalized' USING ERRCODE='22023';END IF;
 expected:=jsonb_array_length(p_lines);
 IF EXISTS(SELECT 1 FROM jsonb_array_elements(p_lines) x WHERE x - ARRAY['tenant_id','entity_id','company_code','currency','source_version','wbs_accounting_info_id','row_ordinal','journal_group_id','line_no','period_code','set_date','posting_date','account_code','debit_amount','credit_amount','member_ref','project_ref','property_ref','cost_code','unit_ref','business_guid','sys_id','bill_no','cb_id','come_from','source','review_status','closed_status','completeness_status','gap_codes','excluded_from_h1','line_hash']::text[] <> '{}'::jsonb OR x->>'tenant_id'<>p_tenant::text OR x->>'entity_id'<>p_entity::text OR x->>'company_code'<>run.company_code OR x->>'currency'<>run.currency OR x->>'source_version'<>run.source_version OR x->>'line_hash'<>refs_wbs_h1_accounting_jsonb_hash(x-'line_hash')) THEN RAISE EXCEPTION 'WBS accounting population page contains drifted or open fields' USING ERRCODE='23514';END IF;
 IF EXISTS(SELECT 1 FROM jsonb_array_elements(p_lines) x WHERE
   ARRAY(SELECT jsonb_object_keys(x) ORDER BY 1)<>ARRAY['account_code','bill_no','business_guid','cb_id','closed_status','come_from','company_code','completeness_status','cost_code','credit_amount','currency','debit_amount','entity_id','excluded_from_h1','gap_codes','journal_group_id','line_hash','line_no','member_ref','period_code','posting_date','project_ref','property_ref','review_status','row_ordinal','set_date','source','source_version','sys_id','tenant_id','unit_ref','wbs_accounting_info_id']
   OR x->>'wbs_accounting_info_id'!~'^[1-9][0-9]*$' OR x->>'row_ordinal'!~'^[1-9][0-9]*$' OR x->>'debit_amount'!~'^-?(0|[1-9][0-9]{0,19})\.[0-9]{4}$' OR x->>'credit_amount'!~'^-?(0|[1-9][0-9]{0,19})\.[0-9]{4}$' OR (((x->>'debit_amount')::numeric<>0) AND ((x->>'credit_amount')::numeric<>0))
   OR (x->>'posting_date' IS NOT NULL AND x->>'posting_date'!~'^\d{4}-\d{2}-\d{2}$') OR (x->>'set_date' IS NOT NULL AND x->>'set_date'!~'^\d{4}-\d{2}-\d{2}$') OR (x->>'period_code' IS NOT NULL AND x->>'period_code'!~'^2026-0[1-6]$')
   OR jsonb_typeof(x->'gap_codes')<>'array' OR jsonb_typeof(x->'excluded_from_h1')<>'boolean' OR x->>'completeness_status' NOT IN('COMPLETE','MISSING_POSTING_DATE','MISSING_ACCOUNT','MISSING_PROJECT','MISSING_COST_CODE','MISSING_PAYEE','ZERO_AMOUNT','MULTIPLE_GAPS','OUTSIDE_H1')
   OR length(x->>'come_from') NOT BETWEEN 1 AND 256 OR length(x->>'source') NOT BETWEEN 1 AND 256 OR length(x->>'review_status') NOT BETWEEN 1 AND 256 OR length(x->>'closed_status') NOT BETWEEN 1 AND 256
   OR EXISTS(SELECT 1 FROM jsonb_each_text(x-'gap_codes'-'excluded_from_h1'-'wbs_accounting_info_id'-'row_ordinal'-'line_no') f WHERE length(f.value)>256 OR f.value~'[[:cntrl:]]')
 ) THEN RAISE EXCEPTION 'WBS accounting population page has malformed closed facts' USING ERRCODE='23514';END IF;
 WITH input AS(SELECT x,x-'line_hash' AS doc FROM jsonb_array_elements(p_lines) x), normalized AS(
  SELECT (x->>'wbs_accounting_info_id')::bigint source_id,(x->>'row_ordinal')::integer ordinal,NULLIF(x->>'journal_group_id','') journal_group_id,NULLIF(x->>'line_no','')::integer line_no,NULLIF(x->>'period_code','') period_code,NULLIF(x->>'set_date','')::date set_date,NULLIF(x->>'posting_date','')::date posting_date,NULLIF(x->>'account_code','') account_code,(x->>'debit_amount')::numeric debit,(x->>'credit_amount')::numeric credit,NULLIF(x->>'member_ref','') member_ref,NULLIF(x->>'project_ref','') project_ref,NULLIF(x->>'property_ref','') property_ref,NULLIF(x->>'cost_code','') cost_code,NULLIF(x->>'unit_ref','') unit_ref,NULLIF(x->>'business_guid','') business_guid,NULLIF(x->>'sys_id','') sys_id,NULLIF(x->>'bill_no','') bill_no,NULLIF(x->>'cb_id','') cb_id,x->>'come_from' come_from,x->>'source' source,x->>'review_status' review_status,x->>'closed_status' closed_status,x->>'completeness_status' completeness_status,x->'gap_codes' gap_codes,(x->>'excluded_from_h1')::boolean excluded,x->>'line_hash' line_hash,doc FROM input
 ) INSERT INTO wbs_h1_accounting_evidence_line(run_id,tenant_id,entity_id,wbs_accounting_info_id,row_ordinal,source_version,journal_group_id,line_no,period_id,period_code,set_date,posting_date,currency,account_code,debit_amount,credit_amount,member_ref,project_ref,property_ref,cost_code,unit_ref,business_guid,sys_id,bill_no,cb_id,come_from,source,review_status,closed_status,completeness_status,gap_codes,excluded_from_h1,line_document,line_hash)
  SELECT p_run,p_tenant,p_entity,n.source_id,n.ordinal,run.source_version,n.journal_group_id,n.line_no,ap.period_id,n.period_code,n.set_date,n.posting_date,run.currency,n.account_code,n.debit,n.credit,n.member_ref,n.project_ref,n.property_ref,n.cost_code,n.unit_ref,n.business_guid,n.sys_id,n.bill_no,n.cb_id,n.come_from,n.source,n.review_status,n.closed_status,n.completeness_status,n.gap_codes,n.excluded,n.doc,n.line_hash FROM normalized n LEFT JOIN accounting_period ap ON ap.tenant_id=p_tenant AND ap.entity_id=p_entity AND ap.period_code=n.period_code AND ap.starts_on=(n.period_code||'-01')::date AND ap.ends_on=(ap.starts_on+interval '1 month'-interval '1 day')::date
  ON CONFLICT DO NOTHING;
 SELECT count(*) INTO exact FROM jsonb_array_elements(p_lines) x JOIN wbs_h1_accounting_evidence_line l ON l.run_id=p_run AND l.wbs_accounting_info_id=(x->>'wbs_accounting_info_id')::bigint AND l.line_hash=x->>'line_hash';
 IF exact<>expected THEN RAISE EXCEPTION 'WBS accounting population page replay drifted (expected %, exact %)',expected,exact USING ERRCODE='40001';END IF;RETURN jsonb_build_object('run_id',p_run,'accepted_row_count',expected);
END $$;

CREATE FUNCTION refs_finalize_wbs_h1_accounting_population(p_tenant uuid,p_entity uuid,p_run uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE run wbs_h1_accounting_population_run; stored wbs_h1_accounting_population_receipt; actual_count integer;h1_count integer;excluded_count integer;debit numeric;credit numeric;actual_hash text;module_count integer;doc jsonb;payload jsonb;actor text:=refs_current_actor();
BEGIN
 PERFORM refs_assert_scope(p_tenant,p_entity,'WBS.SNAPSHOT.IMPORT');SELECT * INTO run FROM wbs_h1_accounting_population_run WHERE run_id=p_run AND tenant_id=p_tenant AND entity_id=p_entity FOR UPDATE;IF NOT FOUND THEN RAISE EXCEPTION 'WBS population run not found' USING ERRCODE='P0002';END IF;
 SELECT * INTO stored FROM wbs_h1_accounting_population_receipt WHERE run_id=p_run;IF FOUND THEN RETURN stored.receipt_document||jsonb_build_object('idempotent',true);END IF;
 SELECT count(*)::integer,count(*) FILTER(WHERE NOT excluded_from_h1)::integer,count(*) FILTER(WHERE excluded_from_h1)::integer,coalesce(sum(debit_amount) FILTER(WHERE NOT excluded_from_h1),0),coalesce(sum(credit_amount) FILTER(WHERE NOT excluded_from_h1),0),'sha256:'||encode(digest(convert_to(string_agg(line_hash||E'\n','' ORDER BY row_ordinal),'UTF8'),'sha256'),'hex') INTO actual_count,h1_count,excluded_count,debit,credit,actual_hash FROM wbs_h1_accounting_evidence_line WHERE run_id=p_run;
 IF actual_count<>run.expected_row_count OR h1_count<>run.expected_h1_row_count OR excluded_count<>run.expected_excluded_count OR debit<>run.expected_debit OR credit<>run.expected_credit OR actual_hash<>run.population_hash THEN RAISE EXCEPTION 'WBS H1 accounting population is incomplete or drifted' USING ERRCODE='23514';END IF;
 INSERT INTO wbs_h1_accounting_module_receipt(run_id,tenant_id,entity_id,period_id,period_code,currency,module_code,row_count,debit_amount,credit_amount,module_hash,balance_status)
 SELECT p_run,p_tenant,p_entity,period_id,period_code,currency,come_from,count(*)::integer,sum(debit_amount),sum(credit_amount),'sha256:'||encode(digest(convert_to(string_agg(line_hash||E'\n','' ORDER BY row_ordinal),'UTF8'),'sha256'),'hex'),'BALANCED' FROM wbs_h1_accounting_evidence_line WHERE run_id=p_run AND NOT excluded_from_h1 GROUP BY period_id,period_code,currency,come_from HAVING sum(debit_amount)=sum(credit_amount);
 GET DIAGNOSTICS module_count=ROW_COUNT;
 IF module_count=0 OR EXISTS(SELECT 1 FROM wbs_h1_accounting_evidence_line l WHERE l.run_id=p_run AND NOT l.excluded_from_h1 GROUP BY l.period_id,l.period_code,l.currency,l.come_from HAVING sum(l.debit_amount)<>sum(l.credit_amount)) THEN RAISE EXCEPTION 'WBS H1 accounting module population is unbalanced' USING ERRCODE='23514';END IF;
 doc:=jsonb_build_object('schema_version','WBS_H1_ACCOUNTING_CONTROL_RECEIPT_V1','run_id',p_run,'company_code',run.company_code,'date_from',run.date_from,'date_to',run.date_to,'currency',run.currency,'source_version',run.source_version,'snapshot_token_hash',run.snapshot_token_hash,'provider_content_hash',run.provider_content_hash,'source_manifest',run.source_manifest,'source_manifest_hash',run.source_manifest_hash,'row_count',actual_count,'included_h1_row_count',h1_count,'excluded_row_count',excluded_count,'debit_amount',to_char(debit,'FM999999999999999999990.0000'),'credit_amount',to_char(credit,'FM999999999999999999990.0000'),'population_hash',actual_hash,'module_receipt_count',module_count,'accounting_authority','CONTROL_EVIDENCE_ONLY','can_create_draft',false,'can_review',false,'can_approve',false,'can_post',false);
 INSERT INTO wbs_h1_accounting_population_receipt(run_id,tenant_id,entity_id,row_count,h1_row_count,excluded_row_count,debit_amount,credit_amount,population_hash,module_receipt_count,receipt_document,receipt_hash,finalized_by) VALUES(p_run,p_tenant,p_entity,actual_count,h1_count,excluded_count,debit,credit,actual_hash,module_count,doc,refs_jsonb_hash(doc),actor) RETURNING * INTO stored;
 payload:=jsonb_build_object('run_id',p_run,'receipt_id',stored.receipt_id,'receipt_hash',stored.receipt_hash,'population_hash',actual_hash,'row_count',actual_count);
 INSERT INTO audit_event(tenant_id,entity_id,event_type,object_type,object_id,action,actor_id,actor_type,permission_used,request_id,correlation_id,idempotency_key,after_hash,reason,metadata) VALUES(p_tenant,p_entity,'WBS_H1_ACCOUNTING_CONTROL_RETAINED','WBS_H1_ACCOUNTING_CONTROL',p_run,'RETAIN',actor,'SERVICE_ACCOUNT','WBS.SNAPSHOT.IMPORT',run.idempotency_key,run.idempotency_key,run.idempotency_key,stored.receipt_hash,'Complete WBS H1 accounting control population retained',payload);
 INSERT INTO outbox_event(tenant_id,entity_id,aggregate_type,aggregate_id,event_type,payload,payload_hash) VALUES(p_tenant,p_entity,'WBS_H1_ACCOUNTING_CONTROL',p_run,'WBS_H1_ACCOUNTING_CONTROL_RETAINED',payload,refs_jsonb_hash(payload));
 RETURN doc||jsonb_build_object('receipt_id',stored.receipt_id,'receipt_hash',stored.receipt_hash,'idempotent',false);
END $$;

CREATE FUNCTION refs_read_wbs_h1_accounting_population(p_tenant uuid,p_entity uuid,p_run uuid,p_after_ordinal integer DEFAULT 0,p_limit integer DEFAULT 100) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE result jsonb;
BEGIN
 PERFORM refs_assert_scope(p_tenant,p_entity,'WBS.AUTOREC.VIEW');IF p_after_ordinal<0 OR p_limit<1 OR p_limit>500 THEN RAISE EXCEPTION 'WBS population cursor is invalid' USING ERRCODE='22023';END IF;
 SELECT r.receipt_document||jsonb_build_object('receipt_id',r.receipt_id,'receipt_hash',r.receipt_hash,'after_ordinal',p_after_ordinal,'limit',p_limit,'population_complete',true,'run_finalized',true,'page_complete',(SELECT coalesce(max(row_ordinal)>=r.row_count,true) FROM (SELECT row_ordinal FROM wbs_h1_accounting_evidence_line WHERE run_id=p_run AND row_ordinal>p_after_ordinal ORDER BY row_ordinal LIMIT p_limit) p),'rows',coalesce((SELECT jsonb_agg(l.line_document||jsonb_build_object('line_hash',l.line_hash,'period_id',l.period_id) ORDER BY l.row_ordinal) FROM (SELECT * FROM wbs_h1_accounting_evidence_line WHERE run_id=p_run AND row_ordinal>p_after_ordinal ORDER BY row_ordinal LIMIT p_limit) l),'[]'::jsonb),'cursor_next',(SELECT CASE WHEN max(row_ordinal)<r.row_count THEN max(row_ordinal) ELSE NULL END FROM (SELECT row_ordinal FROM wbs_h1_accounting_evidence_line WHERE run_id=p_run AND row_ordinal>p_after_ordinal ORDER BY row_ordinal LIMIT p_limit) p),'module_receipts',(SELECT jsonb_agg(jsonb_build_object('receipt_id',m.receipt_id,'period_id',m.period_id,'period_code',m.period_code,'currency',m.currency,'module_code',m.module_code,'row_count',m.row_count,'debit_amount',to_char(m.debit_amount,'FM999999999999999999990.0000'),'credit_amount',to_char(m.credit_amount,'FM999999999999999999990.0000'),'module_hash',m.module_hash,'balance_status',m.balance_status) ORDER BY m.period_code,m.currency,m.module_code) FROM wbs_h1_accounting_module_receipt m WHERE m.run_id=p_run)) INTO result FROM wbs_h1_accounting_population_receipt r WHERE r.run_id=p_run AND r.tenant_id=p_tenant AND r.entity_id=p_entity;
 RETURN result;
END $$;

REVOKE EXECUTE ON FUNCTION refs_create_wbs_h1_accounting_population_run(uuid,uuid,uuid,text,text,text,text,text,jsonb,text,timestamptz,integer,integer,integer,numeric,numeric,text,text,text),refs_append_wbs_h1_accounting_population_lines(uuid,uuid,uuid,jsonb),refs_finalize_wbs_h1_accounting_population(uuid,uuid,uuid),refs_read_wbs_h1_accounting_population(uuid,uuid,uuid,integer,integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION refs_create_wbs_h1_accounting_population_run(uuid,uuid,uuid,text,text,text,text,text,jsonb,text,timestamptz,integer,integer,integer,numeric,numeric,text,text,text),refs_append_wbs_h1_accounting_population_lines(uuid,uuid,uuid,jsonb),refs_finalize_wbs_h1_accounting_population(uuid,uuid,uuid),refs_read_wbs_h1_accounting_population(uuid,uuid,uuid,integer,integer) TO refs_app;
REVOKE EXECUTE ON FUNCTION refs_wbs_h1_accounting_canonical_json(jsonb),refs_wbs_h1_accounting_jsonb_hash(jsonb) FROM PUBLIC;GRANT EXECUTE ON FUNCTION refs_wbs_h1_accounting_canonical_json(jsonb),refs_wbs_h1_accounting_jsonb_hash(jsonb) TO refs_app;
COMMIT;
