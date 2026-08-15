BEGIN;

-- Preserve the platform one-staging/one-journal rule for every ordinary
-- journal.  A second link is allowed only after the immutable G11
-- source->accounting_event->journal binding already exists and matches every
-- scoped identifier.  Locking the staging row closes the concurrent bypass.
DROP INDEX source_link_one_staging_journal_uq;
CREATE UNIQUE INDEX source_link_staging_journal_exact_uq ON source_link(tenant_id,entity_id,staging_item_id,journal_entry_id)
  WHERE staging_item_id IS NOT NULL AND journal_entry_id IS NOT NULL;
CREATE FUNCTION refs_enforce_source_link_staging_journal() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,public,pg_temp AS $$
BEGIN
  IF NEW.staging_item_id IS NULL OR NEW.journal_entry_id IS NULL THEN RETURN NEW; END IF;
  PERFORM 1 FROM staging_item WHERE tenant_id=NEW.tenant_id AND entity_id=NEW.entity_id AND staging_item_id=NEW.staging_item_id FOR UPDATE;
  IF EXISTS(SELECT 1 FROM source_link sl WHERE sl.tenant_id=NEW.tenant_id AND sl.entity_id=NEW.entity_id
      AND sl.staging_item_id=NEW.staging_item_id AND sl.journal_entry_id<>NEW.journal_entry_id)
     AND NOT EXISTS(
       SELECT 1 FROM accounting_event ae JOIN journal_accounting_event jae
         ON jae.tenant_id=ae.tenant_id AND jae.entity_id=ae.entity_id AND jae.accounting_event_id=ae.accounting_event_id
       WHERE ae.tenant_id=NEW.tenant_id AND ae.entity_id=NEW.entity_id AND ae.staging_item_id=NEW.staging_item_id
         AND ae.source_document_id=NEW.source_document_id AND jae.journal_entry_id=NEW.journal_entry_id
     ) THEN
    RAISE EXCEPTION 'A staging item may support another journal only through an exact immutable G11 event binding' USING ERRCODE='23505';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER source_link_staging_journal_guard BEFORE INSERT ON source_link FOR EACH ROW EXECUTE FUNCTION refs_enforce_source_link_staging_journal();

-- The G11 mapping is an approved immutable mapping_snapshot.  The command
-- accepts no accounting values; all accounts, the clearing member and both
-- source legs are resolved while the accepted review and source rows are
-- locked in PostgreSQL.
CREATE OR REPLACE FUNCTION refs_create_wbs_autorec_event_draft_private(
  p_event_type text,p_tenant uuid,p_entity uuid,p_review uuid,p_period uuid,
  p_expected_evidence_hash text,p_reason text,p_idempotency text,p_request_hash text
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE actor text:=refs_current_actor(); review_row wbs_autorec_match_review; match_row bank_match;
DECLARE candidate jsonb; source_row source_document; stage_row staging_item; mapping_row mapping_snapshot;
DECLARE event_id uuid:=gen_random_uuid(); journal_id uuid:=gen_random_uuid(); receipt idempotency_receipt;
DECLARE company text; currency_code text; bank_ref text; clearing_member_value text; bank_member_ref text; clearing_account text;
DECLARE offset_account text; amount_value numeric(20,4); journal_number text; description_value text;
DECLARE response jsonb; mapping_count integer;
BEGIN
  PERFORM refs_assert_scope(p_tenant,p_entity,'BANK.AUTOREC.G11.DRAFT');
  IF actor IS NULL OR p_event_type NOT IN ('PAYABLE_INCUR','AUTOC')
     OR p_request_hash<>refs_wbs_autorec_event_draft_hash(p_tenant,p_entity,p_review,p_period,p_expected_evidence_hash,p_reason)
     OR coalesce(length(btrim(p_reason)),0) NOT BETWEEN 8 AND 2000
     OR p_idempotency !~ '^[A-Za-z0-9._:-]{8,200}$' THEN
    RAISE EXCEPTION 'AutoRec accounting-event Draft request is invalid' USING ERRCODE='22023';
  END IF;
  SELECT * INTO review_row FROM wbs_autorec_match_review
    WHERE tenant_id=p_tenant AND entity_id=p_entity AND wbs_autorec_match_review_id=p_review
      AND decision='ACCEPTED' FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'An exact ACCEPTED AutoRec review is required' USING ERRCODE='P0002'; END IF;
  IF review_row.evidence_hash<>p_expected_evidence_hash THEN RAISE EXCEPTION 'AutoRec review evidence hash changed' USING ERRCODE='40001'; END IF;
  IF actor IN (review_row.reviewed_by,review_row.matched_by,review_row.candidate_prepared_by) THEN
    RAISE EXCEPTION 'AutoRec accounting-event Draft maker SoD violation' USING ERRCODE='42501';
  END IF;
  SELECT intent->'review_candidate' INTO candidate FROM wbs_autorec_execution_event
    WHERE tenant_id=p_tenant AND entity_id=p_entity
      AND execution_receipt_id=review_row.candidate_execution_receipt_id
      AND review_candidate_id=review_row.review_candidate_id AND command='RESERVE'
      AND next_state='RESERVED' AND version=review_row.candidate_execution_version FOR SHARE;
  IF candidate IS NULL OR refs_jsonb_hash(candidate)<>review_row.candidate_hash
     OR candidate->>'review_candidate_id' IS DISTINCT FROM review_row.review_candidate_id
     OR coalesce(candidate->>'allocated_amount','') !~ '^[0-9]+(\.[0-9]{1,4})?$' THEN
    RAISE EXCEPTION 'Accepted AutoRec candidate is no longer exact' USING ERRCODE='23514';
  END IF;
  company:=candidate->>'company_key'; currency_code:=candidate->>'currency'; bank_ref:=candidate->>'bank_account_ref';
  amount_value:=(candidate->>'allocated_amount')::numeric(20,4);
  IF company IS NULL OR company='' OR currency_code !~ '^[A-Z]{3}$' OR bank_ref IS NULL OR btrim(bank_ref)=''
     OR amount_value<=0 THEN RAISE EXCEPTION 'Accepted AutoRec candidate accounting scope is invalid' USING ERRCODE='23514'; END IF;
  PERFORM 1 FROM accounting_period WHERE tenant_id=p_tenant AND entity_id=p_entity AND period_id=p_period
    AND status='OPEN' FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'AutoRec accounting-event Draft requires an OPEN period' USING ERRCODE='55000'; END IF;
  PERFORM 1 FROM wbs_autorec_execution_event e WHERE e.tenant_id=p_tenant AND e.entity_id=p_entity
    AND e.review_candidate_id=review_row.review_candidate_id AND e.command='RELEASE'
    AND e.current_state='RESERVED' AND e.next_state='RELEASED'
    AND e.version=(SELECT max(latest.version) FROM wbs_autorec_execution_event latest
      WHERE latest.tenant_id=p_tenant AND latest.entity_id=p_entity
        AND latest.review_candidate_id=review_row.review_candidate_id) FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'G11 Draft requires the exact latest RELEASED AutoRec execution' USING ERRCODE='23514'; END IF;
  SELECT * INTO match_row FROM bank_match WHERE tenant_id=p_tenant AND entity_id=p_entity
    AND bank_match_id=review_row.bank_match_id AND version=review_row.bank_match_revision
    AND status='ACTIVE' FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Reviewed Bank Match changed before Draft creation' USING ERRCODE='40001'; END IF;

  IF p_event_type='PAYABLE_INCUR' THEN
    SELECT d.* INTO source_row FROM source_document d
      WHERE d.tenant_id=p_tenant AND d.entity_id=p_entity
        AND d.source_document_id=match_row.business_source_document_id FOR SHARE;
  ELSE
    SELECT d.* INTO source_row FROM bank_source b JOIN source_document d
      ON d.tenant_id=b.tenant_id AND d.entity_id=b.entity_id AND d.source_document_id=b.source_document_id
      WHERE b.tenant_id=p_tenant AND b.entity_id=p_entity AND b.bank_source_id=match_row.bank_source_id
        AND b.bank_account_ref=bank_ref FOR SHARE OF d;
  END IF;
  IF source_row.source_document_id IS NULL OR source_row.source_entity_id<>company
     OR source_row.currency<>currency_code OR abs(source_row.gross_amount)<>amount_value
     OR source_row.accounting_date NOT BETWEEN
       (SELECT starts_on FROM accounting_period WHERE period_id=p_period)
       AND (SELECT ends_on FROM accounting_period WHERE period_id=p_period) THEN
    RAISE EXCEPTION 'G11 source document is outside the accepted scope, amount, currency, or period' USING ERRCODE='23514';
  END IF;
  SELECT * INTO stage_row FROM staging_item WHERE tenant_id=p_tenant AND entity_id=p_entity
    AND source_document_id=source_row.source_document_id AND reviewed_by IS NOT NULL AND reviewed_at IS NOT NULL
    AND status IN ('READY_FOR_DRAFT','APPROVED','POSTED','RECONCILED') FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'G11 source requires one independently reviewed staging row' USING ERRCODE='23514'; END IF;
  IF EXISTS(SELECT 1 FROM accounting_exception WHERE tenant_id=p_tenant AND entity_id=p_entity
      AND status IN ('OPEN','IN_REVIEW') AND (source_document_id=source_row.source_document_id OR staging_item_id=stage_row.staging_item_id)) THEN
    RAISE EXCEPTION 'G11 source has an unresolved accounting exception' USING ERRCODE='23514';
  END IF;

  SELECT count(*) INTO mapping_count FROM mapping_snapshot m
    WHERE m.tenant_id=p_tenant AND m.entity_id=p_entity AND m.family='WBS_AUTOREC_G11'
      AND m.status='APPROVED' AND m.effective_from<=source_row.accounting_date::timestamp AT TIME ZONE 'UTC'
      AND (m.effective_to IS NULL OR m.effective_to>source_row.accounting_date::timestamp AT TIME ZONE 'UTC')
      AND m.input_keys->>'company_key'=company AND m.input_keys->>'currency'=currency_code
      AND m.input_keys->>'bank_account_ref'=bank_ref
      AND m.snapshot_hash=refs_jsonb_hash(jsonb_build_object('input_keys',m.input_keys,'output_rules',m.output_rules));
  IF mapping_count<>1 THEN RAISE EXCEPTION 'G11 requires exactly one effective approved mapping' USING ERRCODE='23514'; END IF;
  SELECT * INTO mapping_row FROM mapping_snapshot m
    WHERE m.tenant_id=p_tenant AND m.entity_id=p_entity AND m.family='WBS_AUTOREC_G11'
      AND m.status='APPROVED' AND m.effective_from<=source_row.accounting_date::timestamp AT TIME ZONE 'UTC'
      AND (m.effective_to IS NULL OR m.effective_to>source_row.accounting_date::timestamp AT TIME ZONE 'UTC')
      AND m.input_keys->>'company_key'=company AND m.input_keys->>'currency'=currency_code
      AND m.input_keys->>'bank_account_ref'=bank_ref
      AND m.snapshot_hash=refs_jsonb_hash(jsonb_build_object('input_keys',m.input_keys,'output_rules',m.output_rules)) FOR SHARE;
  clearing_account:=mapping_row.output_rules->>'clearing_account';
  clearing_member_value:=mapping_row.output_rules->>'clearing_member_ref';
  bank_member_ref:=mapping_row.output_rules->>'bank_member_ref';
  offset_account:=CASE p_event_type WHEN 'PAYABLE_INCUR' THEN mapping_row.output_rules->>'payable_incur_offset_account' ELSE mapping_row.output_rules->>'autoc_offset_account' END;
  IF clearing_account<>'291001' OR coalesce(length(btrim(offset_account)),0) NOT BETWEEN 1 AND 64
     OR offset_account=clearing_account OR coalesce(length(btrim(clearing_member_value)),0) NOT BETWEEN 1 AND 160
     OR coalesce(length(btrim(bank_member_ref)),0) NOT BETWEEN 1 AND 160 THEN
    RAISE EXCEPTION 'G11 mapping rules are incomplete or unsafe' USING ERRCODE='23514';
  END IF;
  PERFORM 1 FROM account_master WHERE tenant_id=p_tenant AND entity_id=p_entity AND account_code=clearing_account
    AND active AND requires_member AND required_member_type='VENDOR';
  IF NOT FOUND THEN RAISE EXCEPTION 'G11 clearing account is not an active vendor-member account' USING ERRCODE='23514'; END IF;
  PERFORM 1 FROM account_master WHERE tenant_id=p_tenant AND entity_id=p_entity AND account_code=offset_account AND active;
  IF NOT FOUND THEN RAISE EXCEPTION 'G11 offset account is not active' USING ERRCODE='23514'; END IF;
  PERFORM 1 FROM member_master mm WHERE mm.tenant_id=p_tenant AND mm.entity_id=p_entity AND mm.member_ref=btrim(clearing_member_value) AND mm.member_type='VENDOR' AND mm.active;
  IF NOT FOUND THEN RAISE EXCEPTION 'G11 clearing member is not an active vendor' USING ERRCODE='23514'; END IF;
  PERFORM 1 FROM member_master mm WHERE mm.tenant_id=p_tenant AND mm.entity_id=p_entity AND mm.member_ref=btrim(bank_member_ref) AND mm.member_type='BANK' AND mm.active;
  IF NOT FOUND THEN RAISE EXCEPTION 'G11 bank member is not active' USING ERRCODE='23514'; END IF;

  INSERT INTO idempotency_receipt(tenant_id,operation_scope,idempotency_key,request_hash,status,actor_id)
  VALUES(p_tenant,'WBS_AUTOREC_G11_DRAFT:'||p_entity||':'||p_event_type,p_idempotency,p_request_hash,'IN_PROGRESS',actor)
  ON CONFLICT (tenant_id,operation_scope,idempotency_key) DO NOTHING;
  SELECT * INTO receipt FROM idempotency_receipt WHERE tenant_id=p_tenant
    AND operation_scope='WBS_AUTOREC_G11_DRAFT:'||p_entity||':'||p_event_type
    AND idempotency_key=p_idempotency FOR UPDATE;
  IF receipt.request_hash<>p_request_hash THEN RAISE EXCEPTION 'Idempotency key reused with a different request' USING ERRCODE='23505'; END IF;
  IF receipt.status='SUCCEEDED' THEN RETURN receipt.response_body||jsonb_build_object('idempotent',true); END IF;
  journal_number:='G11-'||CASE p_event_type WHEN 'PAYABLE_INCUR' THEN 'PI-' ELSE 'AC-' END||substr(replace(p_review::text,'-',''),1,16);
  description_value:=CASE p_event_type WHEN 'PAYABLE_INCUR' THEN 'AutoRec payable incur' ELSE 'AutoRec cash clearing' END||' - '||btrim(p_reason);
  INSERT INTO accounting_event(accounting_event_id,tenant_id,entity_id,wbs_autorec_match_review_id,review_candidate_id,event_type,
    source_document_id,staging_item_id,mapping_snapshot_id,mapping_snapshot_hash,amount,currency,bank_account_ref,clearing_member_ref,evidence_hash,created_by)
  VALUES(event_id,p_tenant,p_entity,p_review,review_row.review_candidate_id,p_event_type,source_row.source_document_id,
    stage_row.staging_item_id,mapping_row.mapping_snapshot_id,mapping_row.snapshot_hash,amount_value,currency_code,bank_ref,btrim(clearing_member_value),
    refs_jsonb_hash(jsonb_build_object('review_evidence_hash',review_row.evidence_hash,'candidate_hash',review_row.candidate_hash,
      'event_type',p_event_type,'source_document_id',source_row.source_document_id,'staging_item_id',stage_row.staging_item_id,
      'mapping_snapshot_id',mapping_row.mapping_snapshot_id,'mapping_snapshot_hash',mapping_row.snapshot_hash,'amount',amount_value,
      'currency',currency_code,'bank_account_ref',bank_ref,'clearing_member_ref',btrim(clearing_member_value))),actor);
  INSERT INTO journal_entry(journal_entry_id,tenant_id,entity_id,period_id,journal_number,journal_type,status,journal_date,currency,description,created_by)
  VALUES(journal_id,p_tenant,p_entity,p_period,journal_number,'AUTO','DRAFT',source_row.accounting_date,currency_code,description_value,actor);
  IF p_event_type='PAYABLE_INCUR' THEN
    INSERT INTO journal_line(tenant_id,entity_id,period_id,journal_entry_id,line_no,account_code,debit_amount,credit_amount,member_ref,description,dimensions)
    VALUES(p_tenant,p_entity,p_period,journal_id,1,btrim(offset_account),amount_value,0,NULL,'Payable incur offset','{}'),
          (p_tenant,p_entity,p_period,journal_id,2,'291001',0,amount_value,btrim(clearing_member_value),'Payable clearing member','{}');
  ELSE
    INSERT INTO journal_line(tenant_id,entity_id,period_id,journal_entry_id,line_no,account_code,debit_amount,credit_amount,member_ref,description,dimensions)
    VALUES(p_tenant,p_entity,p_period,journal_id,1,'291001',amount_value,0,btrim(clearing_member_value),'AutoRec clearing member','{}'),
          (p_tenant,p_entity,p_period,journal_id,2,btrim(offset_account),0,amount_value,btrim(bank_member_ref),'AutoRec cash offset','{}');
  END IF;
  INSERT INTO journal_accounting_event(tenant_id,entity_id,accounting_event_id,journal_entry_id,bound_by)
    VALUES(p_tenant,p_entity,event_id,journal_id,actor);
  INSERT INTO source_link(tenant_id,entity_id,link_type,source_document_id,staging_item_id,journal_entry_id,created_by)
    VALUES(p_tenant,p_entity,'SOURCE_TO_JE',source_row.source_document_id,stage_row.staging_item_id,journal_id,actor);
  response:=jsonb_build_object('accounting_event_id',event_id,'event_type',p_event_type,'journal_entry_id',journal_id,
    'status','DRAFT','revision',0,'review_id',p_review,'source_document_id',source_row.source_document_id,
    'staging_item_id',stage_row.staging_item_id,'mapping_snapshot_id',mapping_row.mapping_snapshot_id,
    'mapping_snapshot_hash',mapping_row.snapshot_hash,'amount',to_char(amount_value,'FM999999999999990.0000'),
    'currency',currency_code,'bank_account_ref',bank_ref,'clearing_member_ref',btrim(clearing_member_value),'idempotent',false);
  INSERT INTO audit_event(tenant_id,entity_id,event_type,object_type,object_id,action,actor_id,actor_type,permission_used,
    request_id,correlation_id,idempotency_key,after_hash,reason,metadata)
  VALUES(p_tenant,p_entity,'AUTO_JOURNAL_CREATED','JOURNAL_ENTRY',journal_id,'CREATE_G11_'||p_event_type,actor,'USER',
    'BANK.AUTOREC.G11.DRAFT',p_idempotency,p_idempotency,p_idempotency,refs_jsonb_hash(response-'idempotent'),btrim(p_reason),
    jsonb_build_object('accounting_event_id',event_id,'review_id',p_review,'event_type',p_event_type));
  INSERT INTO outbox_event(tenant_id,entity_id,aggregate_type,aggregate_id,event_type,payload,payload_hash)
  VALUES(p_tenant,p_entity,'JOURNAL_ENTRY',journal_id,'AUTO_JOURNAL_CREATED',response-'idempotent',refs_jsonb_hash(response-'idempotent'));
  UPDATE idempotency_receipt SET status='SUCCEEDED',response_status=201,response_body=response,completed_at=clock_timestamp()
    WHERE tenant_id=p_tenant AND operation_scope='WBS_AUTOREC_G11_DRAFT:'||p_entity||':'||p_event_type AND idempotency_key=p_idempotency;
  RETURN response;
END $$;

REVOKE ALL ON FUNCTION refs_create_wbs_autorec_event_draft_private(text,uuid,uuid,uuid,uuid,text,text,text,text) FROM PUBLIC,refs_app;

COMMIT;
