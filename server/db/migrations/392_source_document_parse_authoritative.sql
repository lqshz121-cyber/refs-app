BEGIN;

INSERT INTO permission_catalog(permission_code,domain,risk_class,sod_class) VALUES
 ('GL.SOURCE.PARSE','GENERAL_LEDGER','LOW','READ')
ON CONFLICT(permission_code) DO UPDATE SET active=true,domain=EXCLUDED.domain,risk_class=EXCLUDED.risk_class,sod_class=EXCLUDED.sod_class,version=permission_catalog.version+1,effective_to=NULL;
INSERT INTO runtime_human_permission_authority(permission_code,authority_class) VALUES ('GL.SOURCE.PARSE','READ')
ON CONFLICT(permission_code) DO UPDATE SET authority_class=EXCLUDED.authority_class;

CREATE TABLE source_parse_run(
 source_parse_run_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 tenant_id uuid NOT NULL REFERENCES tenant(tenant_id), entity_id uuid NOT NULL,
 source_document_id uuid NOT NULL, period_id uuid NOT NULL,
 source_version text NOT NULL CHECK(length(btrim(source_version)) BETWEEN 1 AND 128 AND source_version !~ '[[:cntrl:]]'),
 source_payload_hash text NOT NULL CHECK(source_payload_hash~'^sha256:[0-9a-f]{64}$'),
 parser_profile text NOT NULL CHECK(parser_profile IN('STANDARD_V1','BANK_V1','PAYABLE_V1','COST_V1','LOAN_V1','PM_CHARGE_V1','CLOSING_V1')),
 status text NOT NULL CHECK(status IN('SUCCEEDED','INCOMPLETE')),
 row_count integer NOT NULL CHECK(row_count BETWEEN 0 AND 10000),
 missing_fields text[] NOT NULL DEFAULT '{}',
 parse_hash text NOT NULL CHECK(parse_hash~'^sha256:[0-9a-f]{64}$'),
 reason text NOT NULL CHECK(length(btrim(reason)) BETWEEN 8 AND 2000 AND reason !~ '[[:cntrl:]]'),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 UNIQUE(tenant_id,source_parse_run_id),
 UNIQUE(tenant_id,entity_id,source_document_id,period_id,source_version,source_payload_hash,parser_profile),
 FOREIGN KEY(tenant_id,entity_id) REFERENCES entity(tenant_id,entity_id),
 FOREIGN KEY(tenant_id,entity_id,period_id) REFERENCES accounting_period(tenant_id,entity_id,period_id),
 FOREIGN KEY(tenant_id,entity_id,source_document_id) REFERENCES source_document(tenant_id,entity_id,source_document_id)
);
ALTER TABLE source_parse_run ENABLE ROW LEVEL SECURITY;
CREATE POLICY source_parse_run_scope ON source_parse_run USING(tenant_id=refs_current_tenant() AND refs_entity_allowed(entity_id));
REVOKE ALL ON source_parse_run FROM PUBLIC,refs_app;
CREATE TRIGGER source_parse_run_append_only BEFORE UPDATE OR DELETE ON source_parse_run FOR EACH ROW EXECUTE FUNCTION reject_mutation();

CREATE FUNCTION refs_parse_source_document_hash(uuid,uuid,uuid,uuid,text,text,text,text) RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
 SELECT refs_jsonb_hash(jsonb_build_object('schema_version','SOURCE_DOCUMENT_PARSE_RUN_V1','tenant_id',$1,'entity_id',$2,'source_document_id',$3,'period_id',$4,'source_version',$5,'source_payload_hash',$6,'parser_profile',$7,'reason',$8));
$$;

CREATE FUNCTION refs_parse_source_document(uuid,uuid,uuid,uuid,text,text,text,text,text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE actor text:=refs_current_actor(); idem idempotency_receipt; run source_parse_run; payload jsonb; request_hash text; n integer; status text; missing text[]; parse_hash text;
BEGIN
 PERFORM refs_assert_scope($1,$2,'GL.SOURCE.PARSE');
 IF $5 IS NULL OR $5<>btrim($5) OR length($5) NOT BETWEEN 1 AND 128 OR $5~'[[:cntrl:]]' OR $6 !~ '^sha256:[0-9a-f]{64}$' OR $7 NOT IN('STANDARD_V1','BANK_V1','PAYABLE_V1','COST_V1','LOAN_V1','PM_CHARGE_V1','CLOSING_V1') OR $8 IS NULL OR length(btrim($8)) NOT BETWEEN 8 AND 2000 OR $8~'[[:cntrl:]]' OR length(coalesce($9,'')) NOT BETWEEN 8 AND 200 THEN RAISE EXCEPTION 'Source parse command is invalid' USING ERRCODE='22023'; END IF;
 request_hash:=refs_parse_source_document_hash($1,$2,$3,$4,$5,$6,$7,$8);
 IF $9 IS NULL OR $9<>btrim($9) THEN RAISE EXCEPTION 'Source parse idempotency key is invalid' USING ERRCODE='22023'; END IF;
 INSERT INTO idempotency_receipt(tenant_id,operation_scope,idempotency_key,request_hash,status,actor_id) VALUES($1,'SOURCE_DOCUMENT_PARSE:'||$2,$9,request_hash,'IN_PROGRESS',actor) ON CONFLICT DO NOTHING;
 SELECT * INTO idem FROM idempotency_receipt WHERE tenant_id=$1 AND operation_scope='SOURCE_DOCUMENT_PARSE:'||$2 AND idempotency_key=$9 FOR UPDATE;
 IF idem.actor_id IS DISTINCT FROM actor OR idem.request_hash IS DISTINCT FROM request_hash THEN RAISE EXCEPTION 'Source parse idempotency conflict' USING ERRCODE='23505'; END IF;
 IF idem.status='SUCCEEDED' THEN RETURN jsonb_set(idem.response_body,'{idempotent}','true'::jsonb); END IF;
 IF NOT EXISTS(SELECT 1 FROM accounting_period WHERE tenant_id=$1 AND entity_id=$2 AND period_id=$4 AND ledger_code='PRIMARY' AND EXISTS(SELECT 1 FROM source_document d WHERE d.tenant_id=$1 AND d.entity_id=$2 AND d.source_document_id=$3 AND d.source_version=$5 AND d.payload_hash=$6 AND d.accounting_date BETWEEN accounting_period.starts_on AND accounting_period.ends_on)) THEN RAISE EXCEPTION 'Source parse source or period evidence is outside the requested PRIMARY scope' USING ERRCODE='22023'; END IF;
 SELECT count(*) INTO n FROM source_document_line WHERE tenant_id=$1 AND entity_id=$2 AND source_document_id=$3;
 missing:=CASE WHEN n=0 THEN ARRAY['source_document_line']::text[] ELSE ARRAY[]::text[] END;
 status:=CASE WHEN n=0 THEN 'INCOMPLETE' ELSE 'SUCCEEDED' END;
 parse_hash:=refs_jsonb_hash(jsonb_build_object('schema_version','SOURCE_DOCUMENT_PARSE_CONTENT_V1','tenant_id',$1,'entity_id',$2,'source_document_id',$3,'period_id',$4,'source_version',$5,'source_payload_hash',$6,'parser_profile',$7,'row_count',n,'missing_fields',missing));
 INSERT INTO source_parse_run(tenant_id,entity_id,source_document_id,period_id,source_version,source_payload_hash,parser_profile,status,row_count,missing_fields,parse_hash,reason) VALUES($1,$2,$3,$4,$5,$6,$7,status,n,missing,parse_hash,$8) RETURNING * INTO run;
 payload:=jsonb_build_object('schema_version','SOURCE_DOCUMENT_PARSE_RUN_V1','parse_run_id',run.source_parse_run_id,'tenant_id',run.tenant_id,'entity_id',run.entity_id,'source_document_id',run.source_document_id,'period_id',run.period_id,'source_version',run.source_version,'source_payload_hash',run.source_payload_hash,'parser_profile',run.parser_profile,'status',run.status,'row_count',run.row_count,'missing_fields',run.missing_fields,'parse_hash',run.parse_hash,'reason',run.reason,'created_at',to_char(run.created_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),'idempotent',false,'action_flags',jsonb_build_object('can_import',false,'can_post',false));
 INSERT INTO audit_event(tenant_id,entity_id,event_type,object_type,object_id,action,actor_id,actor_type,permission_used,request_id,correlation_id,idempotency_key,after_hash,metadata) VALUES($1,$2,'SOURCE_DOCUMENT_PARSED','SOURCE_PARSE_RUN',run.source_parse_run_id,'CREATE',actor,'USER','GL.SOURCE.PARSE',$9,$9,$9,run.parse_hash,payload);
 INSERT INTO outbox_event(tenant_id,entity_id,aggregate_type,aggregate_id,event_type,payload,payload_hash) VALUES($1,$2,'SOURCE_PARSE_RUN',run.source_parse_run_id,'SOURCE_DOCUMENT_PARSED',payload,refs_jsonb_hash(payload));
 UPDATE idempotency_receipt SET status='SUCCEEDED',response_status=201,response_body=payload,completed_at=clock_timestamp() WHERE idempotency_receipt_id=idem.idempotency_receipt_id;
 RETURN payload;
END;$$;
REVOKE ALL ON FUNCTION refs_parse_source_document_hash(uuid,uuid,uuid,uuid,text,text,text,text),refs_parse_source_document(uuid,uuid,uuid,uuid,text,text,text,text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION refs_parse_source_document_hash(uuid,uuid,uuid,uuid,text,text,text,text),refs_parse_source_document(uuid,uuid,uuid,uuid,text,text,text,text,text) TO refs_app;
COMMIT;
