BEGIN;

-- A controlled-test Bank month can contain thousands of rows.  Keep the
-- existing actor boundary intact, but amortize connection latency by running
-- at most one hundred existing per-item commands in one actor-owned
-- transaction.  This helper is private: callers cannot supply or switch an
-- actor, and every child command still checks its own permission and SoD rule.
CREATE FUNCTION refs_private_wbs_test_bank_adjustment_batch_ids(
  p_tenant uuid,
  p_entity uuid,
  p_reconciliation uuid,
  p_bank_source_ids uuid[]
) RETURNS uuid[]
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE
  canonical_ids uuid[];
  item_count integer;
  rec reconciliation;
BEGIN
  item_count:=COALESCE(cardinality(p_bank_source_ids),0);
  IF item_count NOT BETWEEN 1 AND 100 OR array_position(p_bank_source_ids,NULL) IS NOT NULL THEN
    RAISE EXCEPTION 'WBS TEST_ONLY Bank stage batch requires one to one hundred source IDs' USING ERRCODE='22023';
  END IF;
  SELECT array_agg(source_id ORDER BY source_id),count(DISTINCT source_id)
    INTO canonical_ids,item_count
  FROM unnest(p_bank_source_ids) source_id;
  IF item_count<>cardinality(p_bank_source_ids) THEN
    RAISE EXCEPTION 'WBS TEST_ONLY Bank stage batch source IDs must be unique' USING ERRCODE='22023';
  END IF;

  SELECT * INTO rec FROM reconciliation
  WHERE tenant_id=p_tenant AND entity_id=p_entity AND reconciliation_id=p_reconciliation
  FOR SHARE;
  IF NOT FOUND OR rec.status NOT IN ('DRAFT','REOPENED')
     OR rec.bank_account_ref!~'^WBS_TEST_BANK_2026_0[1-6]$'
     OR NOT EXISTS(
       SELECT 1 FROM wbs_controlled_test_bank_import imported
       WHERE imported.tenant_id=p_tenant AND imported.entity_id=p_entity
         AND imported.reconciliation_id=p_reconciliation
         AND imported.bank_account_ref=rec.bank_account_ref
     ) THEN
    RAISE EXCEPTION 'WBS TEST_ONLY Bank stage batch is restricted to an open retained monthly import' USING ERRCODE='42501';
  END IF;

  IF (SELECT count(*) FROM reconciliation_item item
      JOIN wbs_controlled_test_bank_import imported
        ON imported.tenant_id=item.tenant_id AND imported.entity_id=item.entity_id
       AND imported.reconciliation_id=item.reconciliation_id
      JOIN wbs_controlled_test_bank_import_row imported_row
        ON imported_row.tenant_id=imported.tenant_id AND imported_row.entity_id=imported.entity_id
       AND imported_row.wbs_controlled_test_bank_import_id=imported.wbs_controlled_test_bank_import_id
       AND imported_row.bank_source_id=item.bank_source_id
      WHERE item.tenant_id=p_tenant AND item.entity_id=p_entity
        AND item.reconciliation_id=p_reconciliation
        AND item.bank_source_id=ANY(canonical_ids))<>cardinality(canonical_ids) THEN
    RAISE EXCEPTION 'WBS TEST_ONLY Bank stage batch source is outside the retained reconciliation import' USING ERRCODE='42501';
  END IF;
  RETURN canonical_ids;
END;
$$;

CREATE FUNCTION refs_wbs_test_bank_adjustment_draft_batch(
  p_tenant uuid,p_entity uuid,p_reconciliation uuid,p_period uuid,
  p_bank_source_ids uuid[],p_attachment_ids uuid[],p_reason text,p_idempotency_root text
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE
  actor text:=refs_current_actor(); ids uuid[]; source_id uuid; rec reconciliation; bank bank_source;
  draft reconciliation_adjustment_draft; journal journal_entry; lines jsonb; child jsonb;
  results jsonb:='[]'::jsonb; applied integer:=0;
  description constant text:='UNSIGNED TEST ONLY — WBS Bank reconciliation adjustment';
BEGIN
  PERFORM refs_assert_scope(p_tenant,p_entity,'WBS.TEST.IMPORT');
  PERFORM refs_assert_scope(p_tenant,p_entity,'BANK.RECONCILIATION.ADJUSTMENT_DRAFT');
  PERFORM refs_assert_scope(p_tenant,p_entity,'GL.JE.CREATE');
  IF actor IS NULL THEN RAISE EXCEPTION 'Authenticated WBS TEST_ONLY Bank maker missing' USING ERRCODE='42501'; END IF;
  IF COALESCE(length(p_idempotency_root),0) NOT BETWEEN 8 AND 120
     OR COALESCE(length(btrim(p_reason)),0) NOT BETWEEN 8 AND 2000
     OR p_reason NOT LIKE 'UNSIGNED TEST ONLY — %'
     OR COALESCE(cardinality(p_attachment_ids),0)<>1 THEN
    RAISE EXCEPTION 'WBS TEST_ONLY Bank Draft batch requires stable identity, marked reason and one evidence attachment' USING ERRCODE='22023';
  END IF;
  ids:=refs_private_wbs_test_bank_adjustment_batch_ids(p_tenant,p_entity,p_reconciliation,p_bank_source_ids);
  FOREACH source_id IN ARRAY ids LOOP
    SELECT * INTO rec FROM reconciliation WHERE tenant_id=p_tenant AND entity_id=p_entity
      AND reconciliation_id=p_reconciliation FOR SHARE;
    SELECT * INTO bank FROM bank_source WHERE tenant_id=p_tenant AND entity_id=p_entity
      AND bank_source_id=source_id FOR SHARE;
    SELECT * INTO draft FROM reconciliation_adjustment_draft WHERE tenant_id=p_tenant AND entity_id=p_entity
      AND reconciliation_id=p_reconciliation AND bank_source_id=source_id;
    IF draft.reconciliation_adjustment_draft_id IS NULL THEN
      IF bank.bank_source_id IS NULL OR bank.amount=0 OR bank.currency<>rec.currency
         OR bank.bank_account_ref<>rec.bank_account_ref
         OR EXISTS(SELECT 1 FROM bank_match match_row WHERE match_row.tenant_id=p_tenant AND match_row.entity_id=p_entity
           AND match_row.bank_source_id=source_id AND match_row.status='ACTIVE')
         OR EXISTS(SELECT 1 FROM reconciliation_item item WHERE item.tenant_id=p_tenant AND item.entity_id=p_entity
           AND item.reconciliation_id=p_reconciliation AND item.bank_source_id=source_id AND item.state='CLEARED') THEN
        RAISE EXCEPTION 'WBS TEST_ONLY Bank Draft batch source is not an uncleared adjustment candidate' USING ERRCODE='23514';
      END IF;
      lines:=jsonb_build_array(
        jsonb_build_object('line_no',1,'account_code','111000','debit_amount',CASE WHEN bank.amount>0 THEN bank.amount ELSE 0 END,
          'credit_amount',CASE WHEN bank.amount<0 THEN -bank.amount ELSE 0 END,'member_ref',rec.bank_account_ref,'description',description,'dimensions','{}'::jsonb),
        jsonb_build_object('line_no',2,'account_code','610000','debit_amount',CASE WHEN bank.amount<0 THEN -bank.amount ELSE 0 END,
          'credit_amount',CASE WHEN bank.amount>0 THEN bank.amount ELSE 0 END,'member_ref',NULL,'description',description,'dimensions','{}'::jsonb)
      );
      child:=refs_create_reconciliation_adjustment_draft(
        p_tenant,p_entity,p_reconciliation,source_id,rec.version,p_period,
        'WBS-TEST-BANK-'||source_id,bank.transaction_date,bank.currency,description,lines,p_attachment_ids,p_reason,
        p_idempotency_root||':'||source_id||':draft',
        refs_reconciliation_adjustment_draft_hash(p_tenant,p_entity,p_reconciliation,source_id,rec.version,p_period,
          'WBS-TEST-BANK-'||source_id,bank.transaction_date,bank.currency,description,lines,p_attachment_ids,p_reason)
      );
      applied:=applied+1;
    ELSE
      SELECT * INTO journal FROM journal_entry WHERE tenant_id=p_tenant AND entity_id=p_entity
        AND journal_entry_id=draft.journal_entry_id;
      IF journal.status NOT IN ('DRAFT','PENDING_REVIEW','PENDING_APPROVAL','APPROVED','POSTED') THEN
        RAISE EXCEPTION 'WBS TEST_ONLY Bank adjustment journal is not replayable' USING ERRCODE='23514';
      END IF;
      child:=jsonb_build_object('bank_source_id',source_id,'journal_entry_id',draft.journal_entry_id,
        'journal_status',journal.status,'journal_revision',journal.revision,'reconciliation_id',p_reconciliation,
        'reconciliation_revision',rec.version,'bank_delta',draft.bank_delta,'idempotent',true);
    END IF;
    results:=results||jsonb_build_array(child);
  END LOOP;
  RETURN jsonb_build_object('stage','DRAFT','processed_count',cardinality(ids),'applied_count',applied,
    'bank_source_ids',to_jsonb(ids),'results',results,'test_only',true);
END;
$$;

CREATE FUNCTION refs_private_wbs_test_bank_adjustment_transition_batch(
  p_tenant uuid,p_entity uuid,p_reconciliation uuid,p_bank_source_ids uuid[],
  p_action text,p_expected_status journal_status,p_later_statuses journal_status[],p_idempotency_root text
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE
  ids uuid[]; source_id uuid; draft reconciliation_adjustment_draft; journal journal_entry; child jsonb;
  results jsonb:='[]'::jsonb; applied integer:=0;
BEGIN
  IF COALESCE(length(p_idempotency_root),0) NOT BETWEEN 8 AND 120 THEN
    RAISE EXCEPTION 'WBS TEST_ONLY Bank stage batch requires a stable idempotency root' USING ERRCODE='22023';
  END IF;
  ids:=refs_private_wbs_test_bank_adjustment_batch_ids(p_tenant,p_entity,p_reconciliation,p_bank_source_ids);
  FOREACH source_id IN ARRAY ids LOOP
    SELECT * INTO draft FROM reconciliation_adjustment_draft d
      WHERE d.tenant_id=p_tenant AND d.entity_id=p_entity AND d.reconciliation_id=p_reconciliation
        AND d.bank_source_id=source_id FOR SHARE;
    IF draft.reconciliation_adjustment_draft_id IS NULL THEN
      RAISE EXCEPTION 'WBS TEST_ONLY Bank stage batch adjustment Draft is missing' USING ERRCODE='23514';
    END IF;
    SELECT * INTO journal FROM journal_entry j WHERE j.tenant_id=p_tenant AND j.entity_id=p_entity
      AND j.journal_entry_id=draft.journal_entry_id FOR SHARE;
    IF journal.status=p_expected_status THEN
      child:=refs_transition_journal(p_tenant,p_entity,journal.journal_entry_id,p_action,journal.revision,NULL,
        p_idempotency_root||':'||source_id||':'||CASE p_action WHEN 'SUBMIT' THEN 'submit' WHEN 'REVIEW' THEN 'review-je' ELSE 'approve' END,
        refs_journal_transition_hash(p_tenant,p_entity,journal.journal_entry_id,p_action,journal.revision,NULL));
      applied:=applied+1;
    ELSIF journal.status=ANY(p_later_statuses) THEN
      child:=jsonb_build_object('journal_entry_id',journal.journal_entry_id,'status',journal.status,
        'revision',journal.revision,'idempotent',true);
    ELSE
      RAISE EXCEPTION 'WBS TEST_ONLY Bank stage batch journal is not at the expected stage' USING ERRCODE='23514';
    END IF;
    results:=results||jsonb_build_array(child||jsonb_build_object('bank_source_id',source_id));
  END LOOP;
  RETURN jsonb_build_object('stage',p_action,'processed_count',cardinality(ids),'applied_count',applied,
    'bank_source_ids',to_jsonb(ids),'results',results,'test_only',true);
END;
$$;

CREATE FUNCTION refs_wbs_test_bank_adjustment_submit_batch(
  p_tenant uuid,p_entity uuid,p_reconciliation uuid,p_bank_source_ids uuid[],p_idempotency_root text
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
BEGIN
  PERFORM refs_assert_scope(p_tenant,p_entity,'WBS.TEST.IMPORT');
  PERFORM refs_assert_scope(p_tenant,p_entity,'GL.JE.SUBMIT');
  IF refs_current_actor() IS NULL THEN RAISE EXCEPTION 'Authenticated WBS TEST_ONLY Bank submitter missing' USING ERRCODE='42501'; END IF;
  RETURN refs_private_wbs_test_bank_adjustment_transition_batch(p_tenant,p_entity,p_reconciliation,p_bank_source_ids,
    'SUBMIT','DRAFT',ARRAY['PENDING_REVIEW','PENDING_APPROVAL','APPROVED','POSTED']::journal_status[],p_idempotency_root);
END;
$$;

CREATE FUNCTION refs_wbs_test_bank_adjustment_review_batch(
  p_tenant uuid,p_entity uuid,p_reconciliation uuid,p_bank_source_ids uuid[],p_idempotency_root text
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
BEGIN
  PERFORM refs_assert_scope(p_tenant,p_entity,'WBS.TEST.IMPORT');
  PERFORM refs_assert_scope(p_tenant,p_entity,'GL.JE.REVIEW');
  IF refs_current_actor() IS NULL THEN RAISE EXCEPTION 'Authenticated WBS TEST_ONLY Bank reviewer missing' USING ERRCODE='42501'; END IF;
  RETURN refs_private_wbs_test_bank_adjustment_transition_batch(p_tenant,p_entity,p_reconciliation,p_bank_source_ids,
    'REVIEW','PENDING_REVIEW',ARRAY['PENDING_APPROVAL','APPROVED','POSTED']::journal_status[],p_idempotency_root);
END;
$$;

CREATE FUNCTION refs_wbs_test_bank_adjustment_approve_batch(
  p_tenant uuid,p_entity uuid,p_reconciliation uuid,p_bank_source_ids uuid[],p_idempotency_root text
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
BEGIN
  PERFORM refs_assert_scope(p_tenant,p_entity,'WBS.TEST.IMPORT');
  PERFORM refs_assert_scope(p_tenant,p_entity,'GL.JE.APPROVE');
  IF refs_current_actor() IS NULL THEN RAISE EXCEPTION 'Authenticated WBS TEST_ONLY Bank approver missing' USING ERRCODE='42501'; END IF;
  RETURN refs_private_wbs_test_bank_adjustment_transition_batch(p_tenant,p_entity,p_reconciliation,p_bank_source_ids,
    'APPROVE','PENDING_APPROVAL',ARRAY['APPROVED','POSTED']::journal_status[],p_idempotency_root);
END;
$$;

CREATE FUNCTION refs_wbs_test_bank_adjustment_post_clear_batch(
  p_tenant uuid,p_entity uuid,p_reconciliation uuid,p_period uuid,
  p_bank_source_ids uuid[],p_reason text,p_idempotency_root text
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE
  actor text:=refs_current_actor(); ids uuid[]; source_id uuid; rec reconciliation; bank bank_source;
  draft reconciliation_adjustment_draft; journal journal_entry; child jsonb;
  results jsonb:='[]'::jsonb; posted integer:=0;cleared integer:=0;
BEGIN
  PERFORM refs_assert_scope(p_tenant,p_entity,'WBS.TEST.IMPORT');
  PERFORM refs_assert_scope(p_tenant,p_entity,'GL.JE.POST');
  PERFORM refs_assert_scope(p_tenant,p_entity,'BANK.RECONCILIATION.CLEAR');
  IF actor IS NULL THEN RAISE EXCEPTION 'Authenticated WBS TEST_ONLY Bank poster missing' USING ERRCODE='42501'; END IF;
  IF COALESCE(length(p_idempotency_root),0) NOT BETWEEN 8 AND 120
     OR COALESCE(length(btrim(p_reason)),0) NOT BETWEEN 8 AND 2000
     OR p_reason NOT LIKE 'UNSIGNED TEST ONLY — %' THEN
    RAISE EXCEPTION 'WBS TEST_ONLY Bank post batch requires stable identity and marked reason' USING ERRCODE='22023';
  END IF;
  ids:=refs_private_wbs_test_bank_adjustment_batch_ids(p_tenant,p_entity,p_reconciliation,p_bank_source_ids);
  FOREACH source_id IN ARRAY ids LOOP
    SELECT * INTO draft FROM reconciliation_adjustment_draft d
      WHERE d.tenant_id=p_tenant AND d.entity_id=p_entity AND d.reconciliation_id=p_reconciliation
        AND d.bank_source_id=source_id FOR SHARE;
    IF draft.reconciliation_adjustment_draft_id IS NULL THEN
      RAISE EXCEPTION 'WBS TEST_ONLY Bank post batch adjustment Draft is missing' USING ERRCODE='23514';
    END IF;
    SELECT * INTO journal FROM journal_entry j WHERE j.tenant_id=p_tenant AND j.entity_id=p_entity
      AND j.journal_entry_id=draft.journal_entry_id FOR SHARE;
    IF journal.journal_entry_id IS NULL OR journal.status NOT IN ('APPROVED','POSTED') THEN
      RAISE EXCEPTION 'WBS TEST_ONLY Bank post batch requires an Approved adjustment' USING ERRCODE='23514';
    END IF;
    IF journal.status='APPROVED' THEN
      child:=refs_post_journal(p_tenant,p_entity,p_period,journal.journal_entry_id,journal.revision,
        p_idempotency_root||':'||source_id||':post',
        refs_canonical_jsonb_hash(jsonb_build_object('tenantId',p_tenant,'entityId',p_entity,'periodId',p_period,
          'journalEntryId',journal.journal_entry_id,'expectedRevision',journal.revision)),actor);
      posted:=posted+1;
    ELSE
      child:=jsonb_build_object('journal_entry_id',journal.journal_entry_id,'status','POSTED',
        'revision',journal.revision,'idempotent',true);
    END IF;
    SELECT * INTO rec FROM reconciliation WHERE tenant_id=p_tenant AND entity_id=p_entity
      AND reconciliation_id=p_reconciliation FOR SHARE;
    SELECT * INTO bank FROM bank_source WHERE tenant_id=p_tenant AND entity_id=p_entity
      AND bank_source_id=source_id FOR SHARE;
    IF EXISTS(SELECT 1 FROM reconciliation_item item WHERE item.tenant_id=p_tenant AND item.entity_id=p_entity
      AND item.reconciliation_id=p_reconciliation AND item.bank_source_id=source_id AND item.state='CLEARED') THEN
      child:=child||jsonb_build_object('clearance_idempotent',true);
    ELSE
      PERFORM refs_set_reconciliation_adjustment_clearance(p_tenant,p_entity,p_reconciliation,source_id,rec.version,bank.version,true,p_reason,
        p_idempotency_root||':'||source_id||':clear-adjustment',
        refs_reconciliation_adjustment_clearance_hash(p_tenant,p_entity,p_reconciliation,source_id,rec.version,bank.version,true,p_reason));
      child:=child||jsonb_build_object('clearance_idempotent',false);cleared:=cleared+1;
    END IF;
    results:=results||jsonb_build_array(child||jsonb_build_object('bank_source_id',source_id));
  END LOOP;
  RETURN jsonb_build_object('stage','POST_CLEAR','processed_count',cardinality(ids),'posted_count',posted,
    'cleared_count',cleared,'bank_source_ids',to_jsonb(ids),'results',results,'test_only',true);
END;
$$;

REVOKE ALL ON FUNCTION refs_private_wbs_test_bank_adjustment_batch_ids(uuid,uuid,uuid,uuid[]) FROM PUBLIC,refs_app;
REVOKE ALL ON FUNCTION refs_private_wbs_test_bank_adjustment_transition_batch(uuid,uuid,uuid,uuid[],text,journal_status,journal_status[],text) FROM PUBLIC,refs_app;
REVOKE ALL ON FUNCTION refs_wbs_test_bank_adjustment_draft_batch(uuid,uuid,uuid,uuid,uuid[],uuid[],text,text) FROM PUBLIC;
REVOKE ALL ON FUNCTION refs_wbs_test_bank_adjustment_submit_batch(uuid,uuid,uuid,uuid[],text) FROM PUBLIC;
REVOKE ALL ON FUNCTION refs_wbs_test_bank_adjustment_review_batch(uuid,uuid,uuid,uuid[],text) FROM PUBLIC;
REVOKE ALL ON FUNCTION refs_wbs_test_bank_adjustment_approve_batch(uuid,uuid,uuid,uuid[],text) FROM PUBLIC;
REVOKE ALL ON FUNCTION refs_wbs_test_bank_adjustment_post_clear_batch(uuid,uuid,uuid,uuid,uuid[],text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION refs_wbs_test_bank_adjustment_draft_batch(uuid,uuid,uuid,uuid,uuid[],uuid[],text,text) TO refs_app;
GRANT EXECUTE ON FUNCTION refs_wbs_test_bank_adjustment_submit_batch(uuid,uuid,uuid,uuid[],text) TO refs_app;
GRANT EXECUTE ON FUNCTION refs_wbs_test_bank_adjustment_review_batch(uuid,uuid,uuid,uuid[],text) TO refs_app;
GRANT EXECUTE ON FUNCTION refs_wbs_test_bank_adjustment_approve_batch(uuid,uuid,uuid,uuid[],text) TO refs_app;
GRANT EXECUTE ON FUNCTION refs_wbs_test_bank_adjustment_post_clear_batch(uuid,uuid,uuid,uuid,uuid[],text,text) TO refs_app;

COMMENT ON FUNCTION refs_wbs_test_bank_adjustment_draft_batch(uuid,uuid,uuid,uuid,uuid[],uuid[],text,text) IS
  'TEST_ONLY maker-stage batch; invokes the existing per-source adjustment Draft command without changing actor identity.';
COMMENT ON FUNCTION refs_wbs_test_bank_adjustment_post_clear_batch(uuid,uuid,uuid,uuid,uuid[],text,text) IS
  'TEST_ONLY poster-stage batch; Posts and clears each exact per-source adjustment atomically without changing actor identity.';

COMMIT;
