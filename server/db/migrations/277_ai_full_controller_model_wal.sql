BEGIN;

CREATE FUNCTION refs_ai_full_controller_canonical_json(value jsonb)
RETURNS text LANGUAGE plpgsql IMMUTABLE SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE result text;
BEGIN
  CASE jsonb_typeof(value)
    WHEN 'object' THEN
      SELECT '{'||COALESCE(string_agg(to_jsonb(entry.key)::text||':'||refs_ai_full_controller_canonical_json(entry.value),',' ORDER BY entry.key COLLATE "C"),'')||'}'
      INTO result FROM jsonb_each(value) AS entry;
    WHEN 'array' THEN
      SELECT '['||COALESCE(string_agg(refs_ai_full_controller_canonical_json(item.value),',' ORDER BY item.ordinality),'')||']'
      INTO result FROM jsonb_array_elements(value) WITH ORDINALITY AS item(value,ordinality);
    ELSE result:=value::text;
  END CASE;
  RETURN result;
END $$;

CREATE FUNCTION refs_ai_full_controller_canonical_hash(value jsonb)
RETURNS text LANGUAGE sql IMMUTABLE SET search_path=pg_catalog,public,pg_temp AS $$
  SELECT 'sha256:'||encode(digest(convert_to(refs_ai_full_controller_canonical_json(value),'UTF8'),'sha256'),'hex')
$$;

CREATE TABLE ai_full_controller_model_run (
  ai_full_controller_model_run_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  entity_id uuid NOT NULL,
  accounting_period_id uuid NOT NULL,
  actor_id text NOT NULL,
  idempotency_key text NOT NULL,
  request jsonb NOT NULL,
  request_hash text NOT NULL CHECK (request_hash ~ '^sha256:[0-9a-f]{64}$'),
  input_manifest jsonb,
  run_hash text CHECK (run_hash IS NULL OR run_hash ~ '^sha256:[0-9a-f]{64}$'),
  state text NOT NULL CHECK (state IN ('PREPARED','RUNNING','COMPLETED','FAILED')),
  output jsonb,
  output_hash text CHECK (output_hash IS NULL OR output_hash ~ '^sha256:[0-9a-f]{64}$'),
  error_code text,
  revision bigint NOT NULL DEFAULT 0 CHECK (revision>=0),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  completed_at timestamptz,
  UNIQUE (tenant_id,actor_id,idempotency_key),
  UNIQUE (tenant_id,run_hash),
  FOREIGN KEY (tenant_id,entity_id,accounting_period_id) REFERENCES accounting_period(tenant_id,entity_id,period_id)
);

CREATE FUNCTION refs_prepare_ai_full_controller_model_run(p_tenant uuid,p_entity uuid,p_period uuid,p_actor text,p_key text,p_request jsonb,p_request_hash text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE r ai_full_controller_model_run%ROWTYPE; actual text; prepared_at text;
BEGIN
  PERFORM refs_assert_scope(p_tenant,p_entity,'AI.ANALYSIS.EXPLAIN');
  IF p_actor IS DISTINCT FROM refs_current_actor() OR p_actor IS NULL OR length(p_actor) NOT BETWEEN 1 AND 255 OR p_key IS NULL OR length(p_key) NOT BETWEEN 8 AND 200 THEN RAISE EXCEPTION 'Actor-bound model run identity is invalid' USING ERRCODE='22023'; END IF;
  actual:=refs_ai_full_controller_canonical_hash(p_request);
  IF actual IS DISTINCT FROM p_request_hash OR p_request->>'release_sha' IS NULL OR p_request->>'requested_limit' IS NULL OR jsonb_typeof(p_request->'requested_limit')<>'number' OR p_request<>jsonb_build_object('schema_version','AI_FULL_CONTROLLER_MODEL_RUN_SCOPE_V1','tenant_id',p_tenant,'entity_id',p_entity,'accounting_period_id',p_period,'release_sha',p_request->>'release_sha','requested_limit',(p_request->>'requested_limit')::integer) OR p_request->>'release_sha' !~ '^[0-9a-f]{40}$' OR (p_request->>'requested_limit')::integer NOT BETWEEN 1 AND 2000 THEN RAISE EXCEPTION 'Model run request scope or hash mismatch' USING ERRCODE='22023'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(p_tenant::text||':'||p_actor||':'||p_key,0));
  SELECT * INTO r FROM ai_full_controller_model_run WHERE tenant_id=p_tenant AND actor_id=p_actor AND idempotency_key=p_key FOR UPDATE;
  IF FOUND THEN
    IF r.request_hash<>p_request_hash OR r.request<>p_request OR r.entity_id<>p_entity OR r.accounting_period_id<>p_period THEN RAISE EXCEPTION 'Idempotency key conflicts with another model run request' USING ERRCODE='23505'; END IF;
  ELSE
    INSERT INTO ai_full_controller_model_run(tenant_id,entity_id,accounting_period_id,actor_id,idempotency_key,request,request_hash,state) VALUES(p_tenant,p_entity,p_period,p_actor,p_key,p_request,p_request_hash,'PREPARED') RETURNING * INTO r;
  END IF;
  prepared_at:=to_char(r.created_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');
  IF r.state='COMPLETED' THEN RETURN jsonb_build_object('state','REPLAY','requestHash',r.request_hash,'preparedAt',prepared_at,'runHash',r.run_hash,'inputManifest',r.input_manifest,'output',r.output); END IF;
  IF r.input_manifest IS NOT NULL THEN RETURN jsonb_build_object('state','RESUME','requestHash',r.request_hash,'preparedAt',prepared_at,'runHash',r.run_hash,'inputManifest',r.input_manifest); END IF;
  RETURN jsonb_build_object('state','PREPARED','requestHash',r.request_hash,'preparedAt',prepared_at);
END $$;

CREATE TABLE ai_full_controller_model_chunk (
  ai_full_controller_model_chunk_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  ai_full_controller_model_run_id uuid NOT NULL REFERENCES ai_full_controller_model_run(ai_full_controller_model_run_id),
  chunk_index integer NOT NULL CHECK (chunk_index>=0),
  chunk_hash text NOT NULL CHECK (chunk_hash ~ '^sha256:[0-9a-f]{64}$'),
  state text NOT NULL CHECK (state IN ('RUNNING','COMPLETED')),
  response jsonb,
  response_hash text CHECK (response_hash IS NULL OR response_hash ~ '^sha256:[0-9a-f]{64}$'),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  completed_at timestamptz,
  UNIQUE (tenant_id,ai_full_controller_model_run_id,chunk_index)
);

CREATE TABLE ai_full_controller_model_memo (
  ai_full_controller_model_memo_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  ai_full_controller_model_run_id uuid NOT NULL REFERENCES ai_full_controller_model_run(ai_full_controller_model_run_id),
  reduction_hash text NOT NULL CHECK (reduction_hash ~ '^sha256:[0-9a-f]{64}$'),
  chunk_response_hashes jsonb NOT NULL,
  state text NOT NULL CHECK (state IN ('RUNNING','COMPLETED')),
  response jsonb,
  response_hash text CHECK (response_hash IS NULL OR response_hash ~ '^sha256:[0-9a-f]{64}$'),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  completed_at timestamptz,
  UNIQUE (tenant_id,ai_full_controller_model_run_id)
);

CREATE FUNCTION refs_begin_ai_full_controller_model_run(p_tenant uuid,p_entity uuid,p_period uuid,p_actor text,p_key text,p_manifest jsonb,p_run_hash text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE r ai_full_controller_model_run%ROWTYPE; actual text; event jsonb;
BEGIN
  PERFORM refs_assert_scope(p_tenant,p_entity,'AI.ANALYSIS.EXPLAIN');
  IF p_actor IS DISTINCT FROM refs_current_actor() OR p_key IS NULL OR length(p_key) NOT BETWEEN 8 AND 200 THEN RAISE EXCEPTION 'Actor-bound model run identity is invalid' USING ERRCODE='22023'; END IF;
  IF p_manifest IS NULL OR jsonb_typeof(p_manifest)<>'object' OR jsonb_typeof(p_manifest->'chunks')<>'array' OR jsonb_array_length(p_manifest->'chunks')<1 OR p_run_hash !~ '^sha256:[0-9a-f]{64}$' THEN RAISE EXCEPTION 'Model run manifest is required' USING ERRCODE='22023'; END IF;
  actual:=refs_ai_full_controller_canonical_hash(jsonb_build_object('schema_version','AI_FULL_CONTROLLER_MODEL_RUN_REQUEST_V1','actor_id',p_actor,'idempotency_key',p_key,'input_manifest',p_manifest));
  IF actual IS DISTINCT FROM p_run_hash OR EXISTS(SELECT 1 FROM jsonb_array_elements(p_manifest->'chunks') AS item WHERE item->>'tenant_id' IS DISTINCT FROM p_tenant::text OR item->>'entity_id' IS DISTINCT FROM p_entity::text OR item->>'accounting_period_id' IS DISTINCT FROM p_period::text) THEN RAISE EXCEPTION 'Model run manifest scope or hash mismatch' USING ERRCODE='22023'; END IF;
  SELECT * INTO r FROM ai_full_controller_model_run WHERE tenant_id=p_tenant AND actor_id=p_actor AND idempotency_key=p_key FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Pre-scan model run reservation is required' USING ERRCODE='P0002'; END IF;
  IF r.entity_id<>p_entity OR r.accounting_period_id<>p_period THEN RAISE EXCEPTION 'Reserved model run scope mismatch' USING ERRCODE='22023'; END IF;
  IF r.input_manifest IS NOT NULL AND (r.run_hash IS DISTINCT FROM p_run_hash OR r.input_manifest IS DISTINCT FROM p_manifest) THEN RAISE EXCEPTION 'Idempotency key conflicts with another model run payload' USING ERRCODE='23505'; END IF;
  IF r.state='COMPLETED' THEN RETURN jsonb_build_object('state','REPLAY','runHash',r.run_hash,'output',r.output); END IF;
  UPDATE ai_full_controller_model_run SET input_manifest=p_manifest,run_hash=p_run_hash,state='RUNNING',error_code=NULL,revision=revision+1,updated_at=clock_timestamp() WHERE ai_full_controller_model_run_id=r.ai_full_controller_model_run_id RETURNING * INTO r;
  event:=jsonb_build_object('schema_version','AI_FULL_CONTROLLER_MODEL_RUN_EVENT_V1','run_id',r.ai_full_controller_model_run_id,'run_hash',r.run_hash,'accounting_period_id',p_period,'actor_id',p_actor,'idempotency_key',p_key,'state','RUNNING','can_create_draft',false,'can_review',false,'can_approve',false,'can_post',false);
  IF NOT EXISTS(SELECT 1 FROM audit_event WHERE tenant_id=p_tenant AND object_id=r.ai_full_controller_model_run_id AND event_type='AI_FULL_CONTROLLER_MODEL_RUN_STARTED') THEN INSERT INTO audit_event(tenant_id,entity_id,event_type,object_type,object_id,action,actor_id,actor_type,permission_used,request_id,correlation_id,idempotency_key,after_hash,metadata) VALUES(p_tenant,p_entity,'AI_FULL_CONTROLLER_MODEL_RUN_STARTED','AI_FULL_CONTROLLER_MODEL_RUN',r.ai_full_controller_model_run_id,'START',p_actor,'USER','AI.ANALYSIS.EXPLAIN',p_key,p_key,p_key,r.run_hash,event); INSERT INTO outbox_event(tenant_id,entity_id,aggregate_type,aggregate_id,event_type,payload,payload_hash) VALUES(p_tenant,p_entity,'AI_FULL_CONTROLLER_MODEL_RUN',r.ai_full_controller_model_run_id,'AI_FULL_CONTROLLER_MODEL_RUN_STARTED',event,refs_jsonb_hash(event)); END IF;
  RETURN jsonb_build_object('state','STARTED','runHash',r.run_hash);
END $$;

CREATE FUNCTION refs_begin_ai_full_controller_model_chunk(p_tenant uuid,p_actor text,p_key text,p_run_hash text,p_index integer,p_chunk_hash text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE r ai_full_controller_model_run%ROWTYPE; c ai_full_controller_model_chunk%ROWTYPE;
BEGIN
  SELECT * INTO r FROM ai_full_controller_model_run WHERE tenant_id=p_tenant AND run_hash=p_run_hash FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Model run not found' USING ERRCODE='P0002'; END IF;
  PERFORM refs_assert_scope(r.tenant_id,r.entity_id,'AI.ANALYSIS.EXPLAIN');
  IF p_actor IS DISTINCT FROM refs_current_actor() OR r.actor_id<>p_actor OR r.idempotency_key<>p_key OR p_index<0 OR r.input_manifest#>>ARRAY['chunk_hashes',p_index::text] IS DISTINCT FROM p_chunk_hash THEN RAISE EXCEPTION 'Chunk scope or hash mismatch' USING ERRCODE='22023'; END IF;
  SELECT * INTO c FROM ai_full_controller_model_chunk WHERE tenant_id=p_tenant AND ai_full_controller_model_run_id=r.ai_full_controller_model_run_id AND chunk_index=p_index FOR UPDATE;
  IF FOUND THEN
    IF c.chunk_hash<>p_chunk_hash THEN RAISE EXCEPTION 'Chunk identity conflict' USING ERRCODE='23505'; END IF;
    IF c.state='COMPLETED' THEN RETURN jsonb_build_object('state','REPLAY','runHash',r.run_hash,'chunkIndex',c.chunk_index,'chunkHash',c.chunk_hash,'response',c.response); END IF;
  ELSE INSERT INTO ai_full_controller_model_chunk(tenant_id,ai_full_controller_model_run_id,chunk_index,chunk_hash,state) VALUES(p_tenant,r.ai_full_controller_model_run_id,p_index,p_chunk_hash,'RUNNING'); END IF;
  RETURN jsonb_build_object('state','STARTED','runHash',r.run_hash,'chunkIndex',p_index,'chunkHash',p_chunk_hash);
END $$;

CREATE FUNCTION refs_complete_ai_full_controller_model_chunk(p_tenant uuid,p_actor text,p_key text,p_run_hash text,p_index integer,p_chunk_hash text,p_response jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE r ai_full_controller_model_run%ROWTYPE; c ai_full_controller_model_chunk%ROWTYPE; h text; event jsonb;
BEGIN
  SELECT * INTO r FROM ai_full_controller_model_run WHERE tenant_id=p_tenant AND run_hash=p_run_hash FOR UPDATE; IF NOT FOUND THEN RAISE EXCEPTION 'Model run not found' USING ERRCODE='P0002'; END IF;
  PERFORM refs_assert_scope(r.tenant_id,r.entity_id,'AI.ANALYSIS.EXPLAIN'); IF p_actor IS DISTINCT FROM refs_current_actor() OR r.actor_id<>p_actor OR r.idempotency_key<>p_key THEN RAISE EXCEPTION 'Actor-bound run mismatch' USING ERRCODE='22023'; END IF;
  h:=refs_ai_full_controller_canonical_hash(p_response-'response_hash'); IF p_response->>'response_hash'<>h OR p_response->>'chunk_hash'<>p_chunk_hash OR (p_response->>'chunk_index')::integer<>p_index THEN RAISE EXCEPTION 'Chunk response hash mismatch' USING ERRCODE='22023'; END IF;
  SELECT * INTO c FROM ai_full_controller_model_chunk WHERE tenant_id=p_tenant AND ai_full_controller_model_run_id=r.ai_full_controller_model_run_id AND chunk_index=p_index FOR UPDATE; IF NOT FOUND OR c.chunk_hash<>p_chunk_hash THEN RAISE EXCEPTION 'Chunk reservation mismatch' USING ERRCODE='22023'; END IF;
  IF c.state='COMPLETED' AND c.response<>p_response THEN RAISE EXCEPTION 'Chunk completion conflict' USING ERRCODE='23505'; END IF;
  UPDATE ai_full_controller_model_chunk SET state='COMPLETED',response=p_response,response_hash=h,completed_at=COALESCE(completed_at,clock_timestamp()) WHERE ai_full_controller_model_chunk_id=c.ai_full_controller_model_chunk_id;
  event:=jsonb_build_object('schema_version','AI_FULL_CONTROLLER_MODEL_CHUNK_EVENT_V1','run_hash',p_run_hash,'chunk_index',p_index,'chunk_hash',p_chunk_hash,'response_hash',h,'actor_id',p_actor);
  IF c.state<>'COMPLETED' THEN INSERT INTO audit_event(tenant_id,entity_id,event_type,object_type,object_id,action,actor_id,actor_type,permission_used,request_id,correlation_id,idempotency_key,after_hash,metadata) VALUES(r.tenant_id,r.entity_id,'AI_FULL_CONTROLLER_MODEL_CHUNK_COMPLETED','AI_FULL_CONTROLLER_MODEL_RUN',r.ai_full_controller_model_run_id,'COMPLETE_CHUNK',p_actor,'USER','AI.ANALYSIS.EXPLAIN',p_key,p_key,p_key,h,event); INSERT INTO outbox_event(tenant_id,entity_id,aggregate_type,aggregate_id,event_type,payload,payload_hash) VALUES(r.tenant_id,r.entity_id,'AI_FULL_CONTROLLER_MODEL_RUN',r.ai_full_controller_model_run_id,'AI_FULL_CONTROLLER_MODEL_CHUNK_COMPLETED',event,refs_jsonb_hash(event)); END IF;
  RETURN jsonb_build_object('runHash',p_run_hash,'response',p_response);
END $$;

CREATE FUNCTION refs_begin_ai_full_controller_model_memo(p_tenant uuid,p_actor text,p_key text,p_run_hash text,p_hashes jsonb,p_reduction jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE r ai_full_controller_model_run%ROWTYPE; m ai_full_controller_model_memo%ROWTYPE; rh text;
BEGIN
  SELECT * INTO r FROM ai_full_controller_model_run WHERE tenant_id=p_tenant AND run_hash=p_run_hash FOR UPDATE; IF NOT FOUND THEN RAISE EXCEPTION 'Model run not found' USING ERRCODE='P0002'; END IF; PERFORM refs_assert_scope(r.tenant_id,r.entity_id,'AI.ANALYSIS.EXPLAIN');
  IF p_actor IS DISTINCT FROM refs_current_actor() OR r.actor_id<>p_actor OR r.idempotency_key<>p_key THEN RAISE EXCEPTION 'Actor-bound memo mismatch' USING ERRCODE='22023'; END IF; rh:=p_reduction->>'reduction_hash';
  IF rh IS NULL OR p_hashes<>(SELECT jsonb_agg(response_hash ORDER BY chunk_index) FROM ai_full_controller_model_chunk WHERE tenant_id=p_tenant AND ai_full_controller_model_run_id=r.ai_full_controller_model_run_id AND state='COMPLETED') THEN RAISE EXCEPTION 'Memo chunk population mismatch' USING ERRCODE='22023'; END IF;
  SELECT * INTO m FROM ai_full_controller_model_memo WHERE tenant_id=p_tenant AND ai_full_controller_model_run_id=r.ai_full_controller_model_run_id FOR UPDATE;
  IF FOUND THEN IF m.reduction_hash<>rh OR m.chunk_response_hashes<>p_hashes THEN RAISE EXCEPTION 'Memo identity conflict' USING ERRCODE='23505'; END IF; IF m.state='COMPLETED' THEN RETURN jsonb_build_object('state','REPLAY','runHash',p_run_hash,'reductionHash',rh,'chunkResponseHashes',p_hashes,'response',m.response); END IF;
  ELSE INSERT INTO ai_full_controller_model_memo(tenant_id,ai_full_controller_model_run_id,reduction_hash,chunk_response_hashes,state) VALUES(p_tenant,r.ai_full_controller_model_run_id,rh,p_hashes,'RUNNING'); END IF;
  RETURN jsonb_build_object('state','STARTED','runHash',p_run_hash,'reductionHash',rh,'chunkResponseHashes',p_hashes);
END $$;

CREATE FUNCTION refs_complete_ai_full_controller_model_run(p_tenant uuid,p_actor text,p_key text,p_run_hash text,p_output jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE r ai_full_controller_model_run%ROWTYPE; m ai_full_controller_model_memo%ROWTYPE; oh text; mh text; event jsonb;
BEGIN
  SELECT * INTO r FROM ai_full_controller_model_run WHERE tenant_id=p_tenant AND run_hash=p_run_hash FOR UPDATE; IF NOT FOUND THEN RAISE EXCEPTION 'Model run not found' USING ERRCODE='P0002'; END IF; PERFORM refs_assert_scope(r.tenant_id,r.entity_id,'AI.ANALYSIS.EXPLAIN');
  IF p_actor IS DISTINCT FROM refs_current_actor() OR r.actor_id<>p_actor OR r.idempotency_key<>p_key THEN RAISE EXCEPTION 'Actor-bound completion mismatch' USING ERRCODE='22023'; END IF;
  oh:=refs_ai_full_controller_canonical_hash(p_output-'output_hash'); IF p_output->>'output_hash'<>oh THEN RAISE EXCEPTION 'Model output hash mismatch' USING ERRCODE='22023'; END IF;
  SELECT * INTO m FROM ai_full_controller_model_memo WHERE tenant_id=p_tenant AND ai_full_controller_model_run_id=r.ai_full_controller_model_run_id FOR UPDATE; IF NOT FOUND THEN RAISE EXCEPTION 'Memo reservation missing' USING ERRCODE='22023'; END IF;
  mh:=refs_ai_full_controller_canonical_hash(p_output->'final_memo'); IF m.state='COMPLETED' AND m.response<>p_output->'final_memo' THEN RAISE EXCEPTION 'Memo completion conflict' USING ERRCODE='23505'; END IF;
  UPDATE ai_full_controller_model_memo SET state='COMPLETED',response=p_output->'final_memo',response_hash=mh,completed_at=COALESCE(completed_at,clock_timestamp()) WHERE ai_full_controller_model_memo_id=m.ai_full_controller_model_memo_id;
  IF r.state='COMPLETED' AND r.output<>p_output THEN RAISE EXCEPTION 'Run completion conflict' USING ERRCODE='23505'; END IF;
  UPDATE ai_full_controller_model_run SET state='COMPLETED',output=p_output,output_hash=oh,error_code=NULL,revision=revision+1,updated_at=clock_timestamp(),completed_at=COALESCE(completed_at,clock_timestamp()) WHERE ai_full_controller_model_run_id=r.ai_full_controller_model_run_id;
  event:=jsonb_build_object('schema_version','AI_FULL_CONTROLLER_MODEL_RUN_EVENT_V1','run_id',r.ai_full_controller_model_run_id,'run_hash',p_run_hash,'output_hash',oh,'accounting_period_id',r.accounting_period_id,'actor_id',p_actor,'idempotency_key',p_key,'state','COMPLETED','can_create_draft',false,'can_review',false,'can_approve',false,'can_post',false);
  IF r.state<>'COMPLETED' THEN INSERT INTO audit_event(tenant_id,entity_id,event_type,object_type,object_id,action,actor_id,actor_type,permission_used,request_id,correlation_id,idempotency_key,after_hash,metadata) VALUES(r.tenant_id,r.entity_id,'AI_FULL_CONTROLLER_MODEL_RUN_COMPLETED','AI_FULL_CONTROLLER_MODEL_RUN',r.ai_full_controller_model_run_id,'COMPLETE',p_actor,'USER','AI.ANALYSIS.EXPLAIN',p_key,p_key,p_key,oh,event); INSERT INTO outbox_event(tenant_id,entity_id,aggregate_type,aggregate_id,event_type,payload,payload_hash) VALUES(r.tenant_id,r.entity_id,'AI_FULL_CONTROLLER_MODEL_RUN',r.ai_full_controller_model_run_id,'AI_FULL_CONTROLLER_MODEL_RUN_COMPLETED',event,refs_jsonb_hash(event)); END IF;
  RETURN jsonb_build_object('runHash',p_run_hash,'output',p_output);
END $$;

CREATE FUNCTION refs_abandon_ai_full_controller_model_stage(p_tenant uuid,p_actor text,p_key text,p_run_hash text,p_error text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE r ai_full_controller_model_run%ROWTYPE;
BEGIN SELECT * INTO r FROM ai_full_controller_model_run WHERE tenant_id=p_tenant AND run_hash=p_run_hash FOR UPDATE; IF NOT FOUND THEN RETURN; END IF; PERFORM refs_assert_scope(r.tenant_id,r.entity_id,'AI.ANALYSIS.EXPLAIN'); IF p_actor IS DISTINCT FROM refs_current_actor() OR r.actor_id<>p_actor OR r.idempotency_key<>p_key OR p_error !~ '^[A-Z][A-Z0-9_]{2,127}$' THEN RAISE EXCEPTION 'Invalid abandoned model stage' USING ERRCODE='22023'; END IF; IF r.state<>'COMPLETED' THEN UPDATE ai_full_controller_model_run SET state='FAILED',error_code=p_error,revision=revision+1,updated_at=clock_timestamp() WHERE ai_full_controller_model_run_id=r.ai_full_controller_model_run_id; END IF; END $$;

REVOKE ALL ON ai_full_controller_model_run,ai_full_controller_model_chunk,ai_full_controller_model_memo FROM PUBLIC,refs_app;
REVOKE ALL ON FUNCTION refs_prepare_ai_full_controller_model_run(uuid,uuid,uuid,text,text,jsonb,text),refs_begin_ai_full_controller_model_run(uuid,uuid,uuid,text,text,jsonb,text),refs_begin_ai_full_controller_model_chunk(uuid,text,text,text,integer,text),refs_complete_ai_full_controller_model_chunk(uuid,text,text,text,integer,text,jsonb),refs_begin_ai_full_controller_model_memo(uuid,text,text,text,jsonb,jsonb),refs_complete_ai_full_controller_model_run(uuid,text,text,text,jsonb),refs_abandon_ai_full_controller_model_stage(uuid,text,text,text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION refs_prepare_ai_full_controller_model_run(uuid,uuid,uuid,text,text,jsonb,text),refs_begin_ai_full_controller_model_run(uuid,uuid,uuid,text,text,jsonb,text),refs_begin_ai_full_controller_model_chunk(uuid,text,text,text,integer,text),refs_complete_ai_full_controller_model_chunk(uuid,text,text,text,integer,text,jsonb),refs_begin_ai_full_controller_model_memo(uuid,text,text,text,jsonb,jsonb),refs_complete_ai_full_controller_model_run(uuid,text,text,text,jsonb),refs_abandon_ai_full_controller_model_stage(uuid,text,text,text,text) TO refs_app;
COMMIT;
