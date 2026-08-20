BEGIN;

CREATE OR REPLACE FUNCTION refs_resolve_wbs_test_bank_match_fixture(p_tenant uuid,p_entity uuid)
RETURNS TABLE(
  period_id uuid,
  bank_source_id uuid,
  bank_version bigint,
  bank_account_ref text,
  transaction_date date,
  currency char(3),
  payment_amount numeric(20,4),
  business_document_id uuid,
  document_number text,
  active_bank_match_id uuid,
  active_payment_occurrence_id uuid,
  active_journal_entry_id uuid,
  active_journal_line_id uuid,
  active_ledger_line_id uuid,
  active_match_revision bigint
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
BEGIN
  PERFORM public.refs_assert_scope(p_tenant,p_entity,'WBS.TEST.IMPORT');
  PERFORM public.refs_assert_scope(p_tenant,p_entity,'BANK.VIEW');
  PERFORM public.refs_assert_scope(p_tenant,p_entity,'AP.VIEW');

  RETURN QUERY
  WITH bank_choice AS (
    SELECT b.*
    FROM public.bank_source b
    JOIN public.source_document d
      ON d.tenant_id=b.tenant_id AND d.entity_id=b.entity_id AND d.source_document_id=b.source_document_id
    WHERE b.tenant_id=p_tenant AND b.entity_id=p_entity
      AND b.bank_account_ref='WBS_TEST_BANK'
      AND b.amount<0
      AND d.document_type='WBS_TEST_BANK_TRANSACTION'
      AND NOT EXISTS(
        SELECT 1 FROM public.reconciliation_item i
        WHERE i.tenant_id=b.tenant_id AND i.entity_id=b.entity_id AND i.bank_source_id=b.bank_source_id
      )
    ORDER BY b.transaction_date,b.bank_source_id
    LIMIT 1
  ), fixture AS (
    SELECT p.period_id,b.bank_source_id,b.version AS bank_version,b.bank_account_ref,b.transaction_date,b.currency,
      -b.amount AS payment_amount,bill.business_document_id,bill.document_number,
      active.bank_match_id AS active_bank_match_id,active.payment_occurrence_id AS active_payment_occurrence_id,
      active.journal_entry_id AS active_journal_entry_id,active.journal_line_id AS active_journal_line_id,
      active.ledger_line_id AS active_ledger_line_id,active.version AS active_match_revision
    FROM bank_choice b
    JOIN public.accounting_period p
      ON p.tenant_id=b.tenant_id AND p.entity_id=b.entity_id AND p.ledger_code='PRIMARY'
        AND p.status='OPEN' AND b.transaction_date BETWEEN p.starts_on AND p.ends_on
    LEFT JOIN LATERAL (
      SELECT bm.bank_match_id,bm.business_source_document_id,bm.payment_occurrence_id,bm.journal_entry_id,
        bm.journal_line_id,bm.ledger_line_id,bm.version
      FROM public.bank_match bm
      WHERE bm.tenant_id=p_tenant AND bm.entity_id=p_entity
        AND bm.bank_source_id=b.bank_source_id AND bm.status='ACTIVE'
      ORDER BY bm.bank_match_id
      LIMIT 1
    ) active ON true
    JOIN LATERAL (
      SELECT bd.business_document_id,bd.document_number
      FROM public.business_document bd
      JOIN public.source_document sd
        ON sd.tenant_id=bd.tenant_id AND sd.entity_id=bd.entity_id AND sd.source_document_id=bd.source_document_id
      WHERE bd.tenant_id=b.tenant_id AND bd.entity_id=b.entity_id
        AND bd.document_kind='AP_BILL'
        AND (bd.status IN ('OPEN','PARTIALLY_PAID') OR (active.bank_match_id IS NOT NULL AND bd.source_document_id=active.business_source_document_id AND bd.status='PAID'))
        AND bd.currency=b.currency AND (active.bank_match_id IS NOT NULL OR bd.open_balance>=-b.amount)
        AND bd.accounting_date BETWEEN p.starts_on AND p.ends_on
        AND sd.accounting_date=bd.accounting_date
        AND sd.source_system IN ('WBS','REFS_STAGE1') AND sd.source_module='payable'
        AND sd.document_type='WBS_TEST_PAYABLE' AND sd.status='POSTED'
        AND bd.document_number LIKE 'WBS-TEST-%'
        AND (active.bank_match_id IS NULL OR bd.source_document_id=active.business_source_document_id)
      ORDER BY CASE WHEN bd.source_document_id=active.business_source_document_id THEN 0 ELSE 1 END,
        bd.open_balance DESC,bd.business_document_id
      LIMIT 1
    ) bill ON true
  )
  SELECT f.period_id,f.bank_source_id,f.bank_version,f.bank_account_ref,f.transaction_date,f.currency,
    f.payment_amount,f.business_document_id,f.document_number,
    f.active_bank_match_id,f.active_payment_occurrence_id,f.active_journal_entry_id,
    f.active_journal_line_id,f.active_ledger_line_id,f.active_match_revision
  FROM fixture f;
END;
$$;

REVOKE ALL ON FUNCTION refs_resolve_wbs_test_bank_match_fixture(uuid,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION refs_resolve_wbs_test_bank_match_fixture(uuid,uuid) TO refs_app;


CREATE OR REPLACE FUNCTION refs_bind_wbs_test_bank_match_payment_source(
  p_tenant uuid,p_entity uuid,p_business_document uuid,p_payment_occurrence uuid,p_journal uuid
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE actor text:=refs_current_actor(); bill public.business_document; source public.source_document;
DECLARE occurrence public.payment_occurrence; journal public.journal_entry; stage public.staging_item; link_id uuid; response jsonb;
DECLARE setting public.setting_snapshot; mapping public.mapping_snapshot; evaluation_id uuid:=gen_random_uuid(); input_digest text; evaluation_digest text;
BEGIN
  PERFORM public.refs_assert_scope(p_tenant,p_entity,'WBS.TEST.IMPORT');
  PERFORM public.refs_assert_scope(p_tenant,p_entity,'AP.PAYMENT.CREATE');
  IF actor IS NULL THEN RAISE EXCEPTION 'Authenticated actor missing' USING ERRCODE='42501'; END IF;

  SELECT * INTO bill FROM public.business_document
    WHERE tenant_id=p_tenant AND entity_id=p_entity AND business_document_id=p_business_document FOR SHARE;
  IF NOT FOUND OR bill.document_kind<>'AP_BILL' OR bill.source_document_id IS NULL
     OR bill.document_number NOT LIKE 'WBS-TEST-%' THEN
    RAISE EXCEPTION 'Controlled test Bank Match payment requires one exact WBS test AP Bill' USING ERRCODE='23514';
  END IF;
  SELECT * INTO source FROM public.source_document
    WHERE tenant_id=p_tenant AND entity_id=p_entity AND source_document_id=bill.source_document_id
      AND source_system IN ('WBS','REFS_STAGE1') AND source_module='payable' AND document_type='WBS_TEST_PAYABLE' AND status='POSTED'
    FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Controlled test Bank Match payment source is absent or unsafe' USING ERRCODE='23514'; END IF;

  SELECT * INTO occurrence FROM public.payment_occurrence
    WHERE tenant_id=p_tenant AND entity_id=p_entity AND payment_occurrence_id=p_payment_occurrence FOR UPDATE;
  SELECT * INTO journal FROM public.journal_entry
    WHERE tenant_id=p_tenant AND entity_id=p_entity AND journal_entry_id=p_journal FOR SHARE;
  IF occurrence.payment_occurrence_id IS NULL OR occurrence.occurrence_kind<>'AP_PAYMENT'
     OR occurrence.business_document_id<>bill.business_document_id OR occurrence.draft_journal_entry_id<>p_journal
     OR journal.journal_entry_id IS NULL OR journal.journal_type<>'AUTO'
     OR journal.period_id<>occurrence.period_id OR journal.currency<>occurrence.currency THEN
    RAISE EXCEPTION 'Controlled test Bank Match payment occurrence and Journal are not an exact Draft pair' USING ERRCODE='23514';
  END IF;
  IF occurrence.source_document_id IS NOT NULL AND occurrence.source_document_id<>source.source_document_id THEN
    RAISE EXCEPTION 'Controlled test Bank Match payment source changed' USING ERRCODE='40001';
  END IF;

  SELECT * INTO stage FROM public.staging_item
    WHERE tenant_id=p_tenant AND entity_id=p_entity AND source_document_id=source.source_document_id FOR UPDATE;
  IF FOUND THEN
    SELECT source_link_id INTO link_id FROM public.source_link
      WHERE tenant_id=p_tenant AND entity_id=p_entity AND link_type='SOURCE_TO_JE'
        AND source_document_id=source.source_document_id AND staging_item_id=stage.staging_item_id AND journal_entry_id=p_journal;
    IF link_id IS NULL THEN
      RAISE EXCEPTION 'Controlled test Bank Match source is already staged for different accounting evidence' USING ERRCODE='23505';
    END IF;
    IF NOT ((occurrence.status='DRAFT' AND journal.status IN ('DRAFT','PENDING_REVIEW','PENDING_APPROVAL','APPROVED'))
      OR (occurrence.status='POSTED' AND journal.status='POSTED')) THEN
      RAISE EXCEPTION 'Controlled test Bank Match payment source replay has an unsafe workflow state' USING ERRCODE='40001';
    END IF;
    UPDATE public.payment_occurrence SET source_document_id=source.source_document_id
      WHERE tenant_id=p_tenant AND entity_id=p_entity AND payment_occurrence_id=p_payment_occurrence AND source_document_id IS NULL;
    RETURN jsonb_build_object('staging_item_id',stage.staging_item_id,'source_link_id',link_id,'idempotent',true);
  END IF;

  IF occurrence.status<>'DRAFT' OR journal.status<>'DRAFT' THEN
    RAISE EXCEPTION 'Controlled test Bank Match source may bind only to an exact Draft payment' USING ERRCODE='40001';
  END IF;

  SELECT * INTO setting FROM public.setting_snapshot s
    WHERE s.tenant_id=p_tenant AND s.family='BANK' AND s.scope_type='ENTITY' AND s.scope_key=p_entity::text
      AND s.status IN ('APPROVED','RETIRED')
      AND (source.accounting_date::timestamp AT TIME ZONE 'UTC')>=s.effective_from
      AND (s.effective_to IS NULL OR (source.accounting_date::timestamp AT TIME ZONE 'UTC')<s.effective_to)
    ORDER BY s.version DESC,s.setting_snapshot_id LIMIT 1;
  IF setting.setting_snapshot_id IS NULL OR 1<>(SELECT count(*) FROM public.setting_snapshot s
    WHERE s.tenant_id=p_tenant AND s.family='BANK' AND s.scope_type='ENTITY' AND s.scope_key=p_entity::text
      AND s.status IN ('APPROVED','RETIRED')
      AND (source.accounting_date::timestamp AT TIME ZONE 'UTC')>=s.effective_from
      AND (s.effective_to IS NULL OR (source.accounting_date::timestamp AT TIME ZONE 'UTC')<s.effective_to)) THEN
    RAISE EXCEPTION 'Controlled test Bank Match requires one exact effective BANK setting' USING ERRCODE='23514';
  END IF;
  SELECT * INTO mapping FROM public.mapping_snapshot m
    WHERE m.tenant_id=p_tenant AND m.family='BANK' AND m.scope_type='ENTITY' AND m.scope_key=p_entity::text
      AND m.status IN ('APPROVED','RETIRED')
      AND (source.accounting_date::timestamp AT TIME ZONE 'UTC')>=m.effective_from
      AND (m.effective_to IS NULL OR (source.accounting_date::timestamp AT TIME ZONE 'UTC')<m.effective_to)
      AND NOT EXISTS(SELECT 1 FROM public.mapping_snapshot higher WHERE higher.tenant_id=m.tenant_id
        AND higher.family=m.family AND higher.scope_type=m.scope_type AND higher.scope_key=m.scope_key
        AND higher.input_key_hash=m.input_key_hash AND higher.status IN ('APPROVED','RETIRED') AND higher.priority>m.priority
        AND (source.accounting_date::timestamp AT TIME ZONE 'UTC')>=higher.effective_from
        AND (higher.effective_to IS NULL OR (source.accounting_date::timestamp AT TIME ZONE 'UTC')<higher.effective_to))
      AND 1=(SELECT count(*) FROM public.mapping_snapshot tied WHERE tied.tenant_id=m.tenant_id
        AND tied.family=m.family AND tied.scope_type=m.scope_type AND tied.scope_key=m.scope_key
        AND tied.input_key_hash=m.input_key_hash AND tied.status IN ('APPROVED','RETIRED') AND tied.priority=m.priority
        AND (source.accounting_date::timestamp AT TIME ZONE 'UTC')>=tied.effective_from
        AND (tied.effective_to IS NULL OR (source.accounting_date::timestamp AT TIME ZONE 'UTC')<tied.effective_to))
    ORDER BY m.input_key_hash,m.priority DESC,m.mapping_snapshot_id LIMIT 1;
  IF mapping.mapping_snapshot_id IS NULL THEN
    RAISE EXCEPTION 'Controlled test Bank Match requires one unambiguous effective BANK mapping' USING ERRCODE='23514';
  END IF;
  input_digest:=public.refs_jsonb_hash(jsonb_build_object('source_document_id',source.source_document_id,'payment_occurrence_id',p_payment_occurrence,'journal_entry_id',p_journal));
  evaluation_digest:=public.refs_rule_evaluation_hash(source.source_document_id,setting.setting_snapshot_id,mapping.mapping_snapshot_id,
    'WBS_TEST_BANK_MATCH_PAYMENT',1,'{}'::jsonb,'{}'::jsonb,input_digest);
  INSERT INTO public.rule_evaluation(rule_evaluation_id,tenant_id,source_document_id,setting_snapshot_id,mapping_snapshot_id,rule_code,rule_version,
    matched_facts,result,reason,input_digest,evaluation_digest,evaluated_at)
    VALUES(evaluation_id,p_tenant,source.source_document_id,setting.setting_snapshot_id,mapping.mapping_snapshot_id,'WBS_TEST_BANK_MATCH_PAYMENT',1,
      '{}'::jsonb,'{}'::jsonb,'TEST_ONLY isolated Bank Match payment source evidence',input_digest,evaluation_digest,
      (source.accounting_date::timestamp AT TIME ZONE 'UTC')+interval '12 hours');

  INSERT INTO public.staging_item(tenant_id,entity_id,source_document_id,setting_snapshot_id,mapping_snapshot_id,rule_evaluation_id,status,reviewed_by,reviewed_at)
    VALUES(p_tenant,p_entity,source.source_document_id,setting.setting_snapshot_id,mapping.mapping_snapshot_id,evaluation_id,'DRAFT_CREATED',actor,clock_timestamp()) RETURNING * INTO stage;
  INSERT INTO public.source_link(tenant_id,entity_id,link_type,source_document_id,staging_item_id,journal_entry_id,created_by)
    VALUES(p_tenant,p_entity,'SOURCE_TO_JE',source.source_document_id,stage.staging_item_id,p_journal,actor)
    RETURNING source_link_id INTO link_id;
  UPDATE public.payment_occurrence SET source_document_id=source.source_document_id
    WHERE tenant_id=p_tenant AND entity_id=p_entity AND payment_occurrence_id=p_payment_occurrence AND source_document_id IS NULL;
  response:=jsonb_build_object('staging_item_id',stage.staging_item_id,'source_link_id',link_id,'idempotent',false);
  INSERT INTO public.audit_event(tenant_id,entity_id,event_type,object_type,object_id,action,actor_id,actor_type,permission_used,request_id,correlation_id,idempotency_key,after_hash,reason)
    VALUES(p_tenant,p_entity,'CONTROLLED_TEST_BANK_PAYMENT_SOURCE_BOUND','PAYMENT_OCCURRENCE',p_payment_occurrence,'BIND_TEST_PAYMENT_SOURCE',actor,'USER','AP.PAYMENT.CREATE',
      'wbs-test-bank-payment-source:'||p_payment_occurrence,'wbs-test-bank-payment-source:'||p_payment_occurrence,'wbs-test-bank-payment-source:'||p_payment_occurrence,
      public.refs_jsonb_hash(response),'TEST_ONLY source linkage for isolated WBS Bank Match');
  RETURN response;
END;
$$;

REVOKE ALL ON FUNCTION refs_bind_wbs_test_bank_match_payment_source(uuid,uuid,uuid,uuid,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION refs_bind_wbs_test_bank_match_payment_source(uuid,uuid,uuid,uuid,uuid) TO refs_app;

COMMIT;
