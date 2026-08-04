BEGIN;

-- Keep 002 immutable.  The installed posting routine has been extended by
-- later forward migrations, so amend that installed definition rather than
-- replacing it with an out-of-date copy.
DO $$
DECLARE fn text; rewritten text;
BEGIN
  SELECT pg_get_functiondef('refs_post_journal(uuid,uuid,uuid,uuid,bigint,text,text,text)'::regprocedure) INTO fn;
  rewritten:=replace(fn,
    'DECLARE balanced boolean; line_count bigint; batch_id uuid:=gen_random_uuid(); response jsonb; event_payload jsonb;',
    'DECLARE balanced boolean; line_count bigint; batch_id uuid:=gen_random_uuid(); response jsonb; event_payload jsonb; posted_state_hash text;');
  IF rewritten=fn THEN RAISE EXCEPTION 'Post integrity migration could not add state-hash variable' USING ERRCODE='55000'; END IF;
  fn:=rewritten;
  rewritten:=replace(fn,
    '  INSERT INTO audit_event(tenant_id,entity_id,event_type,object_type,object_id,action,actor_id,actor_type,permission_used,request_id,correlation_id,idempotency_key,after_hash)' || E'\n' ||
    '    VALUES(p_tenant,p_entity,''JOURNAL_POSTED'',''JOURNAL_ENTRY'',p_journal,''POST'',p_actor,''USER'',''GL.JE.POST'',p_idempotency_key,p_idempotency_key,p_idempotency_key,p_request_hash);',
    '  SELECT refs_jsonb_hash(to_jsonb(posted_entry)) INTO posted_state_hash FROM journal_entry posted_entry WHERE posted_entry.tenant_id=p_tenant AND posted_entry.entity_id=p_entity AND posted_entry.journal_entry_id=p_journal;' || E'\n' ||
    '  IF posted_state_hash IS NULL THEN RAISE EXCEPTION ''Posted journal state is missing'' USING ERRCODE=''55000''; END IF;' || E'\n' ||
    '  INSERT INTO audit_event(tenant_id,entity_id,event_type,object_type,object_id,action,actor_id,actor_type,permission_used,request_id,correlation_id,idempotency_key,after_hash,metadata)' || E'\n' ||
    '    VALUES(p_tenant,p_entity,''JOURNAL_POSTED'',''JOURNAL_ENTRY'',p_journal,''POST'',p_actor,''USER'',''GL.JE.POST'',p_idempotency_key,p_idempotency_key,p_idempotency_key,posted_state_hash,jsonb_build_object(''request_hash'',p_request_hash));');
  IF rewritten=fn THEN RAISE EXCEPTION 'Post integrity migration could not bind audit state hash' USING ERRCODE='55000'; END IF;
  fn:=rewritten;
  rewritten:=replace(fn,
    '  response:=jsonb_build_object(''journal_entry_id'',p_journal,''posting_batch_id'',batch_id,''idempotent'',false);',
    '  response:=jsonb_build_object(''journal_entry_id'',p_journal,''posting_batch_id'',batch_id,''revision'',p_expected_revision+1,''idempotent'',false);');
  IF rewritten=fn THEN RAISE EXCEPTION 'Post integrity migration could not return revision' USING ERRCODE='55000'; END IF;
  EXECUTE rewritten;
END $$;

COMMIT;
