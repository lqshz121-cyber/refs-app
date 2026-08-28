BEGIN;

-- Preserve the prior command definitions so a clean, evidence-free down
-- migration restores the exact pre-288 behavior instead of duplicating an
-- historical migration body.
CREATE TABLE financial_statement_snapshot_workflow_function_backup(
  function_identity text PRIMARY KEY,
  function_definition text NOT NULL
);
INSERT INTO financial_statement_snapshot_workflow_function_backup VALUES
  ('prepare',pg_get_functiondef('refs_prepare_financial_statement_snapshot(uuid,uuid,uuid,text,text)'::regprocedure)),
  ('approve',pg_get_functiondef('refs_approve_financial_statement_snapshot(uuid,uuid,uuid,text,text)'::regprocedure));
REVOKE ALL ON financial_statement_snapshot_workflow_function_backup FROM PUBLIC,refs_app;

CREATE FUNCTION refs_financial_statement_snapshot_proposal_rows(p_proposal uuid) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'statement_type',r.statement_type,'statement_section',r.statement_section,
    'classification_basis',r.classification_basis,'account_code',r.account_code,
    'account_name',r.account_name,'opening_debit',r.opening_debit,
    'opening_credit',r.opening_credit,'period_debit',r.period_debit,
    'period_credit',r.period_credit,'ending_debit',r.ending_debit,
    'ending_credit',r.ending_credit,'display_balance',r.display_balance,
    'journal_entry_ids',r.journal_entry_ids,'journal_line_ids',r.journal_line_ids,
    'ledger_line_ids',r.ledger_line_ids,'source_document_ids',r.source_document_ids
  ) ORDER BY r.statement_type,r.statement_section,r.account_code),'[]'::jsonb)
  FROM financial_statement_snapshot_proposal_row r
  WHERE r.financial_statement_snapshot_proposal_id=p_proposal
$$;

CREATE FUNCTION refs_assert_financial_statement_snapshot_proposal(p_tenant uuid,p_entity uuid,p_proposal uuid) RETURNS financial_statement_snapshot_proposal
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE proposal financial_statement_snapshot_proposal%ROWTYPE; rows jsonb;
BEGIN
  SELECT * INTO proposal FROM financial_statement_snapshot_proposal
   WHERE financial_statement_snapshot_proposal_id=p_proposal AND tenant_id=p_tenant AND entity_id=p_entity;
  IF NOT FOUND THEN RAISE EXCEPTION 'Statement snapshot proposal not found' USING ERRCODE='P0002';END IF;
  rows:=refs_financial_statement_snapshot_proposal_rows(p_proposal);
  IF jsonb_array_length(rows)=0
    OR proposal.snapshot_hash<>refs_jsonb_hash(rows)
    OR proposal.ledger_evidence_hash<>refs_jsonb_hash(jsonb_build_object('statement_rows',rows))
    OR EXISTS(
      SELECT 1 FROM financial_statement_snapshot_proposal_row r
      WHERE r.financial_statement_snapshot_proposal_id=p_proposal
        AND r.row_hash<>refs_jsonb_hash(jsonb_build_object(
          'statement_type',r.statement_type,'statement_section',r.statement_section,
          'classification_basis',r.classification_basis,'account_code',r.account_code,
          'account_name',r.account_name,'opening_debit',r.opening_debit,
          'opening_credit',r.opening_credit,'period_debit',r.period_debit,
          'period_credit',r.period_credit,'ending_debit',r.ending_debit,
          'ending_credit',r.ending_credit,'display_balance',r.display_balance,
          'journal_entry_ids',r.journal_entry_ids,'journal_line_ids',r.journal_line_ids,
          'ledger_line_ids',r.ledger_line_ids,'source_document_ids',r.source_document_ids
        ))
    ) THEN
    RAISE EXCEPTION 'Statement snapshot proposal failed canonical evidence validation' USING ERRCODE='23514';
  END IF;
  RETURN proposal;
END $$;

CREATE FUNCTION refs_read_financial_statement_snapshot_proposal_queue(
  p_tenant uuid,p_entity uuid,p_period uuid,p_limit integer DEFAULT 20,p_offset integer DEFAULT 0
) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE total_count integer; result_rows jsonb; proposal record;
BEGIN
  PERFORM refs_assert_scope(p_tenant,p_entity,'GL.REPORT.VIEW');
  IF NOT refs_entity_has_permission(p_entity,'GL.REPORT.SNAPSHOT.PREPARE')
     AND NOT refs_entity_has_permission(p_entity,'GL.REPORT.SNAPSHOT.APPROVE') THEN
    RAISE EXCEPTION 'Statement snapshot workflow permission required' USING ERRCODE='42501';
  END IF;
  IF p_limit NOT BETWEEN 1 AND 100 OR p_offset<0 THEN RAISE EXCEPTION 'Statement snapshot proposal page is invalid' USING ERRCODE='22023';END IF;
  IF NOT EXISTS(SELECT 1 FROM accounting_period WHERE tenant_id=p_tenant AND entity_id=p_entity AND period_id=p_period) THEN
    RAISE EXCEPTION 'Statement snapshot proposal period is unavailable' USING ERRCODE='22023';
  END IF;
  FOR proposal IN SELECT financial_statement_snapshot_proposal_id FROM financial_statement_snapshot_proposal
    WHERE tenant_id=p_tenant AND entity_id=p_entity AND period_id=p_period LOOP
    PERFORM refs_assert_financial_statement_snapshot_proposal(p_tenant,p_entity,proposal.financial_statement_snapshot_proposal_id);
  END LOOP;
  SELECT count(*) INTO total_count FROM financial_statement_snapshot_proposal
   WHERE tenant_id=p_tenant AND entity_id=p_entity AND period_id=p_period;
  WITH page AS (
    SELECT p.*,a.financial_statement_snapshot_id,a.approved_by,a.approved_at,s.version
    FROM financial_statement_snapshot_proposal p
    LEFT JOIN financial_statement_snapshot_approval a USING(financial_statement_snapshot_proposal_id)
    LEFT JOIN financial_statement_snapshot s ON s.financial_statement_snapshot_id=a.financial_statement_snapshot_id
    WHERE p.tenant_id=p_tenant AND p.entity_id=p_entity AND p.period_id=p_period
    ORDER BY p.prepared_at DESC,p.financial_statement_snapshot_proposal_id DESC
    LIMIT p_limit OFFSET p_offset
  ) SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'schema_version','FINANCIAL_STATEMENT_SNAPSHOT_PROPOSAL_QUEUE_ITEM_V1',
      'financial_statement_snapshot_proposal_id',financial_statement_snapshot_proposal_id,
      'period_id',period_id,'currency',currency,'snapshot_hash',snapshot_hash,
      'ledger_evidence_hash',ledger_evidence_hash,'row_count',jsonb_array_length(refs_financial_statement_snapshot_proposal_rows(financial_statement_snapshot_proposal_id)),
      'prepared_by',prepared_by,'prepared_at',to_char(prepared_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
      'status',CASE WHEN financial_statement_snapshot_id IS NULL THEN 'PENDING_APPROVAL' ELSE 'APPROVED' END,
      'financial_statement_snapshot_id',financial_statement_snapshot_id,'version',version,
      'approved_by',approved_by,'approved_at',CASE WHEN approved_at IS NULL THEN NULL ELSE to_char(approved_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') END,
      'can_approve',financial_statement_snapshot_id IS NULL AND prepared_by<>refs_current_actor() AND refs_entity_has_permission(p_entity,'GL.REPORT.SNAPSHOT.APPROVE')
    ) ORDER BY prepared_at DESC,financial_statement_snapshot_proposal_id DESC),'[]'::jsonb)
    INTO result_rows FROM page;
  RETURN jsonb_build_object(
    'schema_version','FINANCIAL_STATEMENT_SNAPSHOT_PROPOSAL_QUEUE_V1',
    'scope',jsonb_build_object('tenant_id',p_tenant,'entity_id',p_entity,'period_id',p_period),
    'total_count',total_count,'read_count',jsonb_array_length(result_rows),'limit',p_limit,'offset',p_offset,
    'population_complete',p_offset+jsonb_array_length(result_rows)>=total_count,'rows',result_rows
  );
END $$;

CREATE FUNCTION refs_read_financial_statement_snapshot_proposal(
  p_tenant uuid,p_entity uuid,p_period uuid,p_proposal uuid
) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE proposal financial_statement_snapshot_proposal%ROWTYPE; approval record; rows jsonb; display_rows jsonb;
BEGIN
  PERFORM refs_assert_scope(p_tenant,p_entity,'GL.REPORT.VIEW');
  IF NOT refs_entity_has_permission(p_entity,'GL.REPORT.SNAPSHOT.PREPARE')
     AND NOT refs_entity_has_permission(p_entity,'GL.REPORT.SNAPSHOT.APPROVE') THEN
    RAISE EXCEPTION 'Statement snapshot workflow permission required' USING ERRCODE='42501';
  END IF;
  proposal:=refs_assert_financial_statement_snapshot_proposal(p_tenant,p_entity,p_proposal);
  IF proposal.period_id<>p_period THEN RAISE EXCEPTION 'Statement snapshot proposal period mismatch' USING ERRCODE='42501';END IF;
  rows:=refs_financial_statement_snapshot_proposal_rows(p_proposal);
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'statement_type',r.statement_type,'statement_section',r.statement_section,
    'classification_basis',r.classification_basis,'account_code',r.account_code,'account_name',r.account_name,
    'opening_debit',r.opening_debit::text,'opening_credit',r.opening_credit::text,
    'period_debit',r.period_debit::text,'period_credit',r.period_credit::text,
    'ending_debit',r.ending_debit::text,'ending_credit',r.ending_credit::text,
    'display_balance',r.display_balance::text,'journal_entry_ids',r.journal_entry_ids,
    'journal_line_ids',r.journal_line_ids,'ledger_line_ids',r.ledger_line_ids,
    'source_document_ids',r.source_document_ids,'row_hash',r.row_hash
  ) ORDER BY r.statement_type,r.statement_section,r.account_code),'[]'::jsonb) INTO display_rows
  FROM financial_statement_snapshot_proposal_row r WHERE r.financial_statement_snapshot_proposal_id=p_proposal;
  SELECT a.financial_statement_snapshot_id,a.approved_by,a.approved_at,s.version INTO approval
    FROM financial_statement_snapshot_approval a JOIN financial_statement_snapshot s USING(financial_statement_snapshot_id)
    WHERE a.financial_statement_snapshot_proposal_id=p_proposal;
  RETURN jsonb_build_object(
    'schema_version','FINANCIAL_STATEMENT_SNAPSHOT_PROPOSAL_V1',
    'financial_statement_snapshot_proposal_id',proposal.financial_statement_snapshot_proposal_id,
    'period_id',proposal.period_id,'currency',proposal.currency,'snapshot_hash',proposal.snapshot_hash,
    'ledger_evidence_hash',proposal.ledger_evidence_hash,'prepared_by',proposal.prepared_by,
    'prepared_at',to_char(proposal.prepared_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    'status',CASE WHEN approval.financial_statement_snapshot_id IS NULL THEN 'PENDING_APPROVAL' ELSE 'APPROVED' END,
    'financial_statement_snapshot_id',approval.financial_statement_snapshot_id,'version',approval.version,
    'approved_by',approval.approved_by,'approved_at',CASE WHEN approval.approved_at IS NULL THEN NULL ELSE to_char(approval.approved_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') END,
    'row_count',jsonb_array_length(rows),'rows',display_rows,
    'can_approve',approval.financial_statement_snapshot_id IS NULL AND proposal.prepared_by<>refs_current_actor() AND refs_entity_has_permission(p_entity,'GL.REPORT.SNAPSHOT.APPROVE')
  );
END $$;

CREATE OR REPLACE FUNCTION refs_prepare_financial_statement_snapshot(p_tenant uuid,p_entity uuid,p_period uuid,p_idempotency_key text,p_request_hash text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE v_actor text:=refs_current_actor();v_receipt idempotency_receipt;v_rows jsonb;v_row jsonb;v_proposal uuid:=gen_random_uuid();v_hash text;v_evidence_hash text;v_currency char(3);v_response jsonb;event_payload jsonb;
BEGIN
  PERFORM refs_assert_scope(p_tenant,p_entity,'GL.REPORT.SNAPSHOT.PREPARE');PERFORM refs_assert_scope(p_tenant,p_entity,'GL.REPORT.VIEW');
  IF v_actor IS NULL THEN RAISE EXCEPTION 'Authenticated actor missing' USING ERRCODE='42501';END IF;
  IF p_request_hash<>refs_jsonb_hash(jsonb_build_object('tenant_id',p_tenant,'entity_id',p_entity,'period_id',p_period)) THEN RAISE EXCEPTION 'Statement snapshot request hash is not canonical' USING ERRCODE='22023';END IF;
  v_receipt:=refs_reserve_idempotency(p_tenant,'PREPARE_STATEMENT_SNAPSHOT:'||p_entity,p_idempotency_key,p_request_hash,v_actor);IF v_receipt.status='SUCCEEDED' THEN RETURN v_receipt.response_body||jsonb_build_object('idempotent',true);END IF;
  SELECT e.base_currency INTO v_currency FROM entity e WHERE e.tenant_id=p_tenant AND e.entity_id=p_entity;
  SELECT jsonb_agg(jsonb_build_object('statement_type',statement_type,'statement_section',statement_section,'classification_basis',classification_basis,'account_code',account_code,'account_name',account_name,'opening_debit',opening_debit,'opening_credit',opening_credit,'period_debit',period_debit,'period_credit',period_credit,'ending_debit',ending_debit,'ending_credit',ending_credit,'display_balance',display_balance,'journal_entry_ids',journal_entry_ids,'journal_line_ids',journal_line_ids,'ledger_line_ids',ledger_line_ids,'source_document_ids',source_document_ids) ORDER BY statement_type,statement_section,account_code) INTO v_rows FROM refs_get_financial_statements(p_tenant,p_entity,p_period);
  IF v_rows IS NULL OR jsonb_array_length(v_rows)=0 THEN RAISE EXCEPTION 'Posted ledger evidence is required before preparing a statement snapshot' USING ERRCODE='22023';END IF;
  v_hash:=refs_jsonb_hash(v_rows);v_evidence_hash:=refs_jsonb_hash(jsonb_build_object('statement_rows',v_rows));
  INSERT INTO financial_statement_snapshot_proposal(financial_statement_snapshot_proposal_id,tenant_id,entity_id,period_id,currency,snapshot_hash,ledger_evidence_hash,prepared_by) VALUES(v_proposal,p_tenant,p_entity,p_period,v_currency,v_hash,v_evidence_hash,v_actor);
  FOR v_row IN SELECT value FROM jsonb_array_elements(v_rows) LOOP
    INSERT INTO financial_statement_snapshot_proposal_row SELECT v_proposal,v_row->>'statement_type',v_row->>'statement_section',v_row->>'classification_basis',v_row->>'account_code',v_row->>'account_name',(v_row->>'opening_debit')::numeric,(v_row->>'opening_credit')::numeric,(v_row->>'period_debit')::numeric,(v_row->>'period_credit')::numeric,(v_row->>'ending_debit')::numeric,(v_row->>'ending_credit')::numeric,(v_row->>'display_balance')::numeric,ARRAY(SELECT jsonb_array_elements_text(v_row->'journal_entry_ids'))::uuid[],ARRAY(SELECT jsonb_array_elements_text(v_row->'journal_line_ids'))::uuid[],ARRAY(SELECT jsonb_array_elements_text(v_row->'ledger_line_ids'))::uuid[],ARRAY(SELECT jsonb_array_elements_text(v_row->'source_document_ids'))::uuid[],refs_jsonb_hash(v_row);
  END LOOP;
  v_response:=jsonb_build_object('financial_statement_snapshot_proposal_id',v_proposal,'status','PENDING_APPROVAL','snapshot_hash',v_hash,'ledger_evidence_hash',v_evidence_hash,'prepared_by',v_actor,'idempotent',false);
  event_payload:=jsonb_build_object('schema_version','FINANCIAL_STATEMENT_SNAPSHOT_PROPOSAL_EVENT_V1','financial_statement_snapshot_proposal_id',v_proposal,'period_id',p_period,'currency',v_currency,'row_count',jsonb_array_length(v_rows),'snapshot_hash',v_hash,'ledger_evidence_hash',v_evidence_hash,'prepared_by',v_actor,'status','PENDING_APPROVAL');
  INSERT INTO audit_event(tenant_id,entity_id,event_type,object_type,object_id,action,actor_id,actor_type,permission_used,request_id,correlation_id,idempotency_key,after_hash,reason,metadata) VALUES(p_tenant,p_entity,'FINANCIAL_STATEMENT_SNAPSHOT_PROPOSED','FINANCIAL_STATEMENT_SNAPSHOT_PROPOSAL',v_proposal,'PREPARE',v_actor,'USER','GL.REPORT.SNAPSHOT.PREPARE',p_idempotency_key,p_idempotency_key,p_idempotency_key,v_hash,'Immutable financial statement snapshot proposed',event_payload);
  INSERT INTO outbox_event(tenant_id,entity_id,aggregate_type,aggregate_id,event_type,payload,payload_hash) VALUES(p_tenant,p_entity,'FINANCIAL_STATEMENT_SNAPSHOT_PROPOSAL',v_proposal,'FINANCIAL_STATEMENT_SNAPSHOT_PROPOSED',event_payload,refs_jsonb_hash(event_payload));
  UPDATE idempotency_receipt SET status='SUCCEEDED',response_status=201,response_body=v_response,completed_at=clock_timestamp() WHERE idempotency_receipt_id=v_receipt.idempotency_receipt_id;
  RETURN v_response;
END $$;

CREATE OR REPLACE FUNCTION refs_approve_financial_statement_snapshot(p_tenant uuid,p_entity uuid,p_proposal uuid,p_idempotency_key text,p_request_hash text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE v_actor text:=refs_current_actor();v_receipt idempotency_receipt;v_proposal_row financial_statement_snapshot_proposal%ROWTYPE;v_snapshot uuid:=gen_random_uuid();v_version bigint;v_response jsonb;event_payload jsonb;
BEGIN
  PERFORM refs_assert_scope(p_tenant,p_entity,'GL.REPORT.SNAPSHOT.APPROVE');
  IF v_actor IS NULL THEN RAISE EXCEPTION 'Authenticated actor missing' USING ERRCODE='42501';END IF;
  IF p_request_hash<>refs_jsonb_hash(jsonb_build_object('tenant_id',p_tenant,'entity_id',p_entity,'proposal_id',p_proposal)) THEN RAISE EXCEPTION 'Statement snapshot approval hash is not canonical' USING ERRCODE='22023';END IF;
  v_receipt:=refs_reserve_idempotency(p_tenant,'APPROVE_STATEMENT_SNAPSHOT:'||p_entity,p_idempotency_key,p_request_hash,v_actor);IF v_receipt.status='SUCCEEDED' THEN RETURN v_receipt.response_body||jsonb_build_object('idempotent',true);END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(p_tenant::text||p_entity::text||p_proposal::text,0));
  v_proposal_row:=refs_assert_financial_statement_snapshot_proposal(p_tenant,p_entity,p_proposal);
  IF v_actor=v_proposal_row.prepared_by THEN RAISE EXCEPTION 'Statement snapshot preparer cannot approve their own proposal' USING ERRCODE='42501';END IF;
  IF EXISTS(SELECT 1 FROM financial_statement_snapshot_approval WHERE financial_statement_snapshot_proposal_id=p_proposal) THEN RAISE EXCEPTION 'Statement snapshot proposal has already been approved' USING ERRCODE='23505';END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(p_tenant::text||p_entity::text||v_proposal_row.period_id::text,0));
  SELECT COALESCE(max(version),0)+1 INTO v_version FROM financial_statement_snapshot WHERE tenant_id=p_tenant AND entity_id=p_entity AND period_id=v_proposal_row.period_id;
  INSERT INTO financial_statement_snapshot(financial_statement_snapshot_id,tenant_id,entity_id,period_id,version,currency,snapshot_hash,ledger_evidence_hash,prepared_by,approved_by,approved_at) VALUES(v_snapshot,p_tenant,p_entity,v_proposal_row.period_id,v_version,v_proposal_row.currency,v_proposal_row.snapshot_hash,v_proposal_row.ledger_evidence_hash,v_proposal_row.prepared_by,v_actor,clock_timestamp());
  INSERT INTO financial_statement_snapshot_row SELECT v_snapshot,p_tenant,p_entity,v_proposal_row.period_id,statement_type,statement_section,classification_basis,account_code,account_name,opening_debit,opening_credit,period_debit,period_credit,ending_debit,ending_credit,display_balance,journal_entry_ids,journal_line_ids,ledger_line_ids,source_document_ids,row_hash FROM financial_statement_snapshot_proposal_row WHERE financial_statement_snapshot_proposal_id=p_proposal;
  INSERT INTO financial_statement_snapshot_approval(financial_statement_snapshot_proposal_id,financial_statement_snapshot_id,tenant_id,entity_id,approved_by) VALUES(p_proposal,v_snapshot,p_tenant,p_entity,v_actor);
  v_response:=jsonb_build_object('financial_statement_snapshot_id',v_snapshot,'financial_statement_snapshot_proposal_id',p_proposal,'version',v_version::text,'status','APPROVED','prepared_by',v_proposal_row.prepared_by,'approved_by',v_actor,'snapshot_hash',v_proposal_row.snapshot_hash,'ledger_evidence_hash',v_proposal_row.ledger_evidence_hash,'idempotent',false);
  event_payload:=jsonb_build_object('schema_version','FINANCIAL_STATEMENT_SNAPSHOT_APPROVAL_EVENT_V1','financial_statement_snapshot_id',v_snapshot,'financial_statement_snapshot_proposal_id',p_proposal,'period_id',v_proposal_row.period_id,'version',v_version::text,'currency',v_proposal_row.currency,'row_count',jsonb_array_length(refs_financial_statement_snapshot_proposal_rows(p_proposal)),'snapshot_hash',v_proposal_row.snapshot_hash,'ledger_evidence_hash',v_proposal_row.ledger_evidence_hash,'prepared_by',v_proposal_row.prepared_by,'approved_by',v_actor,'status','APPROVED');
  INSERT INTO audit_event(tenant_id,entity_id,event_type,object_type,object_id,action,actor_id,actor_type,permission_used,request_id,correlation_id,idempotency_key,after_hash,reason,metadata) VALUES(p_tenant,p_entity,'FINANCIAL_STATEMENT_SNAPSHOT_APPROVED','FINANCIAL_STATEMENT_SNAPSHOT',v_snapshot,'APPROVE',v_actor,'USER','GL.REPORT.SNAPSHOT.APPROVE',p_idempotency_key,p_idempotency_key,p_idempotency_key,v_proposal_row.snapshot_hash,'Immutable financial statement snapshot independently approved',event_payload);
  INSERT INTO outbox_event(tenant_id,entity_id,aggregate_type,aggregate_id,event_type,payload,payload_hash) VALUES(p_tenant,p_entity,'FINANCIAL_STATEMENT_SNAPSHOT',v_snapshot,'FINANCIAL_STATEMENT_SNAPSHOT_APPROVED',event_payload,refs_jsonb_hash(event_payload));
  UPDATE idempotency_receipt SET status='SUCCEEDED',response_status=201,response_body=v_response,completed_at=clock_timestamp() WHERE idempotency_receipt_id=v_receipt.idempotency_receipt_id;
  RETURN v_response;
END $$;

REVOKE ALL ON FUNCTION refs_financial_statement_snapshot_proposal_rows(uuid),refs_assert_financial_statement_snapshot_proposal(uuid,uuid,uuid),refs_read_financial_statement_snapshot_proposal_queue(uuid,uuid,uuid,integer,integer),refs_read_financial_statement_snapshot_proposal(uuid,uuid,uuid,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION refs_read_financial_statement_snapshot_proposal_queue(uuid,uuid,uuid,integer,integer),refs_read_financial_statement_snapshot_proposal(uuid,uuid,uuid,uuid) TO refs_app;

COMMIT;
