BEGIN;

-- History is evidence only. Import execution remains in the existing WBS/raw
-- pipeline, and exports are snapshots of the immutable POSTED ledger.
INSERT INTO permission_catalog(permission_code,domain,risk_class,sod_class) VALUES
 ('DATA.EXCHANGE.HISTORY.VIEW','INTEGRATION','LOW','READ'),
 ('DATA.EXCHANGE.POSTED_LEDGER.EXPORT','INTEGRATION','MEDIUM','POSTED_LEDGER_EXPORT')
ON CONFLICT(permission_code) DO UPDATE SET active=true,domain=EXCLUDED.domain,risk_class=EXCLUDED.risk_class,sod_class=EXCLUDED.sod_class,version=permission_catalog.version+1,effective_to=NULL;
INSERT INTO runtime_human_permission_authority(permission_code,authority_class) VALUES
 ('DATA.EXCHANGE.HISTORY.VIEW','READ'),
 ('DATA.EXCHANGE.POSTED_LEDGER.EXPORT','EXPORT')
ON CONFLICT(permission_code) DO UPDATE SET authority_class=EXCLUDED.authority_class;

CREATE TABLE import_export_history_job(
 import_export_history_job_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 tenant_id uuid NOT NULL REFERENCES tenant(tenant_id), entity_id uuid NOT NULL, job_type text NOT NULL CHECK(job_type IN('IMPORT','EXPORT')),
 source_kind text NOT NULL CHECK(source_kind=btrim(source_kind) AND length(source_kind) BETWEEN 1 AND 80 AND source_kind !~ '[[:cntrl:]]'), period_id uuid NOT NULL,
 status text NOT NULL CHECK(status IN('SUCCEEDED','FAILED','PARTIAL')), record_count bigint NOT NULL CHECK(record_count>=0), content_hash text NOT NULL CHECK(content_hash~'^sha256:[0-9a-f]{64}$'),
 source_version bigint NOT NULL CHECK(source_version>0), failure_code text CHECK(failure_code IS NULL OR failure_code~'^[A-Z][A-Z0-9_]{2,127}$'),
 completed_at timestamptz NOT NULL DEFAULT clock_timestamp(), created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 UNIQUE(tenant_id,import_export_history_job_id),
 FOREIGN KEY(tenant_id,entity_id) REFERENCES entity(tenant_id,entity_id),
 FOREIGN KEY(tenant_id,entity_id,period_id) REFERENCES accounting_period(tenant_id,entity_id,period_id),
 CHECK((status='SUCCEEDED' AND failure_code IS NULL) OR(status IN('FAILED','PARTIAL') AND failure_code IS NOT NULL))
);
CREATE INDEX import_export_history_job_page_idx ON import_export_history_job(tenant_id,entity_id,completed_at DESC,import_export_history_job_id DESC);
ALTER TABLE import_export_history_job ENABLE ROW LEVEL SECURITY;
CREATE POLICY import_export_history_job_scope ON import_export_history_job USING(tenant_id=refs_current_tenant() AND refs_entity_allowed(entity_id));
REVOKE ALL ON import_export_history_job FROM PUBLIC,refs_app;
CREATE TRIGGER import_export_history_job_append_only BEFORE UPDATE OR DELETE ON import_export_history_job FOR EACH ROW EXECUTE FUNCTION reject_mutation();

CREATE FUNCTION refs_import_export_history_payload(p_tenant uuid,p_entity uuid,p_job uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE j import_export_history_job;
BEGIN
 PERFORM refs_assert_scope(p_tenant,p_entity,'DATA.EXCHANGE.HISTORY.VIEW');
 SELECT * INTO j FROM import_export_history_job WHERE tenant_id=p_tenant AND entity_id=p_entity AND import_export_history_job_id=p_job;
 IF NOT FOUND THEN RAISE EXCEPTION 'Import/export history job not found' USING ERRCODE='P0002'; END IF;
 RETURN jsonb_build_object('schema_version','IMPORT_EXPORT_HISTORY_JOB_V1','job_id',j.import_export_history_job_id,'tenant_id',j.tenant_id,'entity_id',j.entity_id,'job_type',j.job_type,'source_kind',j.source_kind,'period_id',j.period_id,'status',j.status,'record_count',j.record_count,'content_hash',j.content_hash,'source_version',j.source_version::text,'failure_code',j.failure_code,'completed_at',to_char(j.completed_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),'created_at',to_char(j.created_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'));
END;$$;

CREATE FUNCTION refs_read_import_export_history(p_tenant uuid,p_entity uuid,p_job_type text,p_limit integer,p_after_completed_at timestamptz,p_after_job_id uuid) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE rows jsonb;cursor jsonb;
BEGIN
 PERFORM refs_assert_scope(p_tenant,p_entity,'DATA.EXCHANGE.HISTORY.VIEW');
 IF p_job_type NOT IN('ALL','IMPORT','EXPORT') OR p_limit NOT BETWEEN 1 AND 100 OR (p_after_completed_at IS NULL)<>(p_after_job_id IS NULL) THEN RAISE EXCEPTION 'Import/export history page is invalid' USING ERRCODE='22023'; END IF;
 IF p_after_job_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM import_export_history_job WHERE tenant_id=p_tenant AND entity_id=p_entity AND import_export_history_job_id=p_after_job_id AND(p_job_type='ALL' OR job_type=p_job_type) AND completed_at=p_after_completed_at) THEN RAISE EXCEPTION 'Import/export history cursor is outside selected scope' USING ERRCODE='22023'; END IF;
 SELECT COALESCE(jsonb_agg(refs_import_export_history_payload(p_tenant,p_entity,x.import_export_history_job_id) ORDER BY x.completed_at DESC,x.import_export_history_job_id DESC),'[]'::jsonb) INTO rows FROM(SELECT import_export_history_job_id,completed_at FROM import_export_history_job WHERE tenant_id=p_tenant AND entity_id=p_entity AND(p_job_type='ALL' OR job_type=p_job_type) AND(p_after_completed_at IS NULL OR(completed_at,import_export_history_job_id)<(p_after_completed_at,p_after_job_id)) ORDER BY completed_at DESC,import_export_history_job_id DESC LIMIT p_limit)x;
 IF jsonb_array_length(rows)=p_limit THEN cursor:=jsonb_build_object('completed_at',rows->(p_limit-1)->>'completed_at','job_id',rows->(p_limit-1)->>'job_id'); END IF;
 RETURN jsonb_build_object('schema_version','IMPORT_EXPORT_HISTORY_PAGE_V1','tenant_id',p_tenant,'entity_id',p_entity,'job_type',p_job_type,'limit',p_limit,'after_completed_at',CASE WHEN p_after_completed_at IS NULL THEN NULL ELSE to_char(p_after_completed_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') END,'after_job_id',p_after_job_id,'next_cursor',cursor,'rows',rows,'action_flags',jsonb_build_object('can_import',false,'can_export',false,'can_post',false));
END;$$;

-- Only an authenticated caller with the history-read capability can derive a
-- metadata-only export history record. The row set is exactly the POSTED ledger.
CREATE FUNCTION refs_record_posted_ledger_export_history(p_tenant uuid,p_entity uuid,p_period uuid,p_source_kind text,p_idempotency_key text,p_request_hash text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE actor text:=refs_current_actor();idem idempotency_receipt;job uuid:=gen_random_uuid();n bigint;hash text;payload jsonb;
BEGIN
 IF actor IS NULL OR p_source_kind IS NULL OR p_source_kind<>btrim(p_source_kind) OR length(p_source_kind) NOT BETWEEN 1 AND 80 OR p_source_kind~'[[:cntrl:] ]' OR length(coalesce(p_idempotency_key,'')) NOT BETWEEN 8 AND 200 THEN RAISE EXCEPTION 'Invalid ledger export history command' USING ERRCODE='22023'; END IF;
 PERFORM refs_assert_scope(p_tenant,p_entity,'DATA.EXCHANGE.POSTED_LEDGER.EXPORT');
 IF p_request_hash IS DISTINCT FROM refs_jsonb_hash(jsonb_build_object('schema_version','POSTED_LEDGER_EXPORT_HISTORY_V1','tenant_id',p_tenant,'entity_id',p_entity,'period_id',p_period,'source_kind',p_source_kind)) THEN RAISE EXCEPTION 'Ledger export history request hash mismatch' USING ERRCODE='22023'; END IF;
 INSERT INTO idempotency_receipt(tenant_id,operation_scope,idempotency_key,request_hash,status,actor_id) VALUES(p_tenant,'POSTED_LEDGER_EXPORT_HISTORY:'||p_entity,p_idempotency_key,p_request_hash,'IN_PROGRESS',actor) ON CONFLICT DO NOTHING;
 SELECT * INTO idem FROM idempotency_receipt WHERE tenant_id=p_tenant AND operation_scope='POSTED_LEDGER_EXPORT_HISTORY:'||p_entity AND idempotency_key=p_idempotency_key FOR UPDATE;
 IF idem.actor_id IS DISTINCT FROM actor OR idem.request_hash IS DISTINCT FROM p_request_hash THEN RAISE EXCEPTION 'Ledger export history idempotency conflict' USING ERRCODE='23505'; END IF;
 IF idem.status='SUCCEEDED' THEN RETURN idem.response_body; END IF;
 IF NOT EXISTS(SELECT 1 FROM accounting_period WHERE tenant_id=p_tenant AND entity_id=p_entity AND period_id=p_period) THEN RAISE EXCEPTION 'Export period is outside selected company' USING ERRCODE='22023'; END IF;
 SELECT count(*),refs_jsonb_hash(jsonb_build_object('schema_version','POSTED_LEDGER_EXPORT_V1','tenant_id',p_tenant,'entity_id',p_entity,'period_id',p_period,'rows',COALESCE(jsonb_agg(jsonb_build_object('ledger_line_id',l.ledger_line_id,'journal_entry_id',l.journal_entry_id,'journal_line_id',l.journal_line_id,'account_code',l.account_code,'debit_amount',l.debit_amount::text,'credit_amount',l.credit_amount::text,'posted_at',to_char(l.posted_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') ) ORDER BY l.ledger_line_id),'[]'::jsonb))) INTO n,hash FROM ledger_line l JOIN journal_entry j ON j.tenant_id=l.tenant_id AND j.entity_id=l.entity_id AND j.journal_entry_id=l.journal_entry_id WHERE l.tenant_id=p_tenant AND l.entity_id=p_entity AND l.period_id=p_period AND j.status='POSTED';
 INSERT INTO import_export_history_job(import_export_history_job_id,tenant_id,entity_id,job_type,source_kind,period_id,status,record_count,content_hash,source_version) VALUES(job,p_tenant,p_entity,'EXPORT',p_source_kind,p_period,'SUCCEEDED',n,hash,1);
 payload:=refs_import_export_history_payload(p_tenant,p_entity,job);
 INSERT INTO audit_event(tenant_id,entity_id,event_type,object_type,object_id,action,actor_id,actor_type,permission_used,request_id,correlation_id,idempotency_key,after_hash,metadata) VALUES(p_tenant,p_entity,'POSTED_LEDGER_EXPORT_RECORDED','IMPORT_EXPORT_HISTORY_JOB',job,'CREATE',actor,'USER','DATA.EXCHANGE.POSTED_LEDGER.EXPORT',p_idempotency_key,p_idempotency_key,p_idempotency_key,hash,payload);
 INSERT INTO outbox_event(tenant_id,entity_id,aggregate_type,aggregate_id,event_type,payload,payload_hash) VALUES(p_tenant,p_entity,'IMPORT_EXPORT_HISTORY_JOB',job,'POSTED_LEDGER_EXPORT_RECORDED',payload,refs_jsonb_hash(payload));
 UPDATE idempotency_receipt SET status='SUCCEEDED',response_status=201,response_body=payload,completed_at=clock_timestamp() WHERE idempotency_receipt_id=idem.idempotency_receipt_id;
 RETURN payload;
END;$$;

-- Existing import_batch is the authoritative import record. This append-only
-- projection writes one safe history row per completed import batch.
CREATE FUNCTION refs_project_import_batch_history(p_tenant uuid,p_entity uuid,p_import_batch uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE b import_batch;period uuid;job uuid:=gen_random_uuid();payload jsonb;state text;
BEGIN
 PERFORM refs_assert_scope(p_tenant,p_entity,'DATA.EXCHANGE.HISTORY.VIEW');
 SELECT * INTO b FROM import_batch WHERE tenant_id=p_tenant AND entity_id=p_entity AND import_batch_id=p_import_batch FOR SHARE;
 IF NOT FOUND OR b.status NOT IN('SUCCEEDED','FAILED','PARTIAL') THEN RAISE EXCEPTION 'Completed import batch is required' USING ERRCODE='22023'; END IF;
 SELECT period_id INTO period FROM accounting_period WHERE tenant_id=p_tenant AND entity_id=p_entity ORDER BY ends_on DESC,period_id DESC LIMIT 1;
 IF period IS NULL THEN RAISE EXCEPTION 'Import history requires an entity period' USING ERRCODE='22023'; END IF;
 state:=b.status::text;
 INSERT INTO import_export_history_job(import_export_history_job_id,tenant_id,entity_id,job_type,source_kind,period_id,status,record_count,content_hash,source_version,failure_code,completed_at,created_at) VALUES(job,p_tenant,p_entity,'IMPORT',b.connector_code||':'||b.source_module,period,state,b.row_count,refs_jsonb_hash(jsonb_build_object('import_batch_id',b.import_batch_id,'request_hash',b.request_hash,'status',state,'row_count',b.row_count,'completed_at',b.completed_at)),b.version+1,CASE WHEN state='SUCCEEDED' THEN NULL ELSE COALESCE(b.error_code,'IMPORT_FAILED') END,COALESCE(b.completed_at,b.created_at),b.created_at) ON CONFLICT DO NOTHING;
 SELECT import_export_history_job_id INTO job FROM import_export_history_job WHERE tenant_id=p_tenant AND entity_id=p_entity AND job_type='IMPORT' AND content_hash=refs_jsonb_hash(jsonb_build_object('import_batch_id',b.import_batch_id,'request_hash',b.request_hash,'status',state,'row_count',b.row_count,'completed_at',b.completed_at));
 payload:=refs_import_export_history_payload(p_tenant,p_entity,job);
 RETURN payload;
END;$$;
REVOKE ALL ON FUNCTION refs_import_export_history_payload(uuid,uuid,uuid),refs_read_import_export_history(uuid,uuid,text,integer,timestamptz,uuid),refs_record_posted_ledger_export_history(uuid,uuid,uuid,text,text,text),refs_project_import_batch_history(uuid,uuid,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION refs_import_export_history_payload(uuid,uuid,uuid),refs_read_import_export_history(uuid,uuid,text,integer,timestamptz,uuid),refs_record_posted_ledger_export_history(uuid,uuid,uuid,text,text,text),refs_project_import_batch_history(uuid,uuid,uuid) TO refs_app;
COMMIT;
