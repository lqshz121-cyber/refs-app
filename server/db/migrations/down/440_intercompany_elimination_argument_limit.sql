BEGIN;

-- Restores 373's definitions of the two functions (which exceed the 100-argument limit).

CREATE OR REPLACE FUNCTION refs_intercompany_elimination_source_snapshot(
 p_tenant uuid,p_reporting_entity uuid,p_reporting_period uuid,p_consolidation_snapshot uuid,
 p_source_entity uuid,p_source_period uuid,p_counterparty_entity uuid,p_counterparty_period uuid,p_source_account text
) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE rec record;src_map mapping_snapshot;cp_map mapping_snapshot;snap consolidation_snapshot;report_period accounting_period;src_period accounting_period;cp_period accounting_period;
 src_member consolidation_member;cp_member consolidation_member;src_account_map consolidation_account_map;cp_account_map consolidation_account_map;
 src_class text;cp_class text;matched numeric(20,4);scope_hash text;evidence jsonb;existing_count integer;member record;member_population_hash text;account_map_population_hash text;
BEGIN
 PERFORM refs_assert_scope(p_tenant,p_reporting_entity,'GROUP.INTERCOMPANY_ELIMINATION.VIEW');
 PERFORM refs_assert_scope(p_tenant,p_source_entity,'GL.REPORT.VIEW');PERFORM refs_assert_scope(p_tenant,p_counterparty_entity,'GL.REPORT.VIEW');
 IF p_source_entity IS NULL OR p_counterparty_entity IS NULL OR p_source_entity=p_counterparty_entity OR p_source_account IS NULL OR p_source_account!~'^[0-9A-Za-z._-]{1,64}$' THEN RAISE EXCEPTION 'Invalid intercompany elimination source scope' USING ERRCODE='22023';END IF;
 SELECT * INTO snap FROM consolidation_snapshot s WHERE s.tenant_id=p_tenant AND s.reporting_entity_id=p_reporting_entity AND s.reporting_period_id=p_reporting_period AND s.consolidation_snapshot_id=p_consolidation_snapshot;
 SELECT * INTO report_period FROM accounting_period p WHERE p.tenant_id=p_tenant AND p.entity_id=p_reporting_entity AND p.period_id=p_reporting_period;
 SELECT * INTO src_period FROM accounting_period p WHERE p.tenant_id=p_tenant AND p.entity_id=p_source_entity AND p.period_id=p_source_period;
 SELECT * INTO cp_period FROM accounting_period p WHERE p.tenant_id=p_tenant AND p.entity_id=p_counterparty_entity AND p.period_id=p_counterparty_period;
 IF snap.consolidation_snapshot_id IS NULL OR report_period.period_id IS NULL OR src_period.period_id IS NULL OR cp_period.period_id IS NULL
  OR report_period.ledger_code<>'PRIMARY' OR src_period.ledger_code<>'PRIMARY' OR cp_period.ledger_code<>'PRIMARY'
  OR EXISTS(SELECT 1 FROM consolidation_snapshot newer WHERE newer.tenant_id=snap.tenant_id AND newer.reporting_entity_id=snap.reporting_entity_id AND newer.reporting_period_id=snap.reporting_period_id AND newer.group_ref=snap.group_ref AND(newer.version,newer.consolidation_snapshot_id)>(snap.version,snap.consolidation_snapshot_id)) THEN
  RAISE EXCEPTION 'Current PRIMARY-ledger consolidation periods and snapshot are required' USING ERRCODE='55000';
 END IF;
 FOR member IN SELECT * FROM consolidation_member m WHERE m.consolidation_snapshot_id=snap.consolidation_snapshot_id LOOP
  PERFORM refs_assert_scope(p_tenant,member.member_entity_id,'GL.REPORT.VIEW');
 END LOOP;
 SELECT refs_jsonb_hash(coalesce(jsonb_agg(to_jsonb(m) ORDER BY m.member_entity_id),'[]'::jsonb)) INTO member_population_hash FROM consolidation_member m WHERE m.consolidation_snapshot_id=snap.consolidation_snapshot_id;
 SELECT refs_jsonb_hash(coalesce(jsonb_agg(to_jsonb(a) ORDER BY a.member_entity_id,a.source_account_code),'[]'::jsonb)) INTO account_map_population_hash FROM consolidation_account_map a WHERE a.consolidation_snapshot_id=snap.consolidation_snapshot_id;
 SELECT * INTO src_member FROM consolidation_member m WHERE m.consolidation_snapshot_id=snap.consolidation_snapshot_id AND m.member_entity_id=p_source_entity AND m.member_period_id=p_source_period;
 SELECT * INTO cp_member FROM consolidation_member m WHERE m.consolidation_snapshot_id=snap.consolidation_snapshot_id AND m.member_entity_id=p_counterparty_entity AND m.member_period_id=p_counterparty_period;
 IF src_member.member_entity_id IS NULL OR cp_member.member_entity_id IS NULL THEN RAISE EXCEPTION 'Both companies must be exact consolidation members for the selected periods' USING ERRCODE='55000';END IF;
 IF src_period.starts_on<>cp_period.starts_on OR src_period.ends_on<>cp_period.ends_on OR src_period.starts_on<>report_period.starts_on OR src_period.ends_on<>report_period.ends_on
  OR NOT EXISTS(SELECT 1 FROM entity a JOIN entity b ON b.tenant_id=a.tenant_id JOIN entity r ON r.tenant_id=a.tenant_id WHERE a.tenant_id=p_tenant AND a.entity_id=p_source_entity AND b.entity_id=p_counterparty_entity AND r.entity_id=p_reporting_entity AND a.base_currency=b.base_currency AND a.base_currency=r.base_currency AND a.base_currency=snap.currency) THEN
  RAISE EXCEPTION 'Intercompany elimination requires aligned periods and one consolidation currency' USING ERRCODE='55000';
 END IF;
 SELECT r.* INTO rec FROM refs_get_intercompany_reconciliation(p_tenant,p_source_entity,p_source_period,p_counterparty_entity,p_counterparty_period) r WHERE r.account_code=p_source_account;
 IF rec.account_code IS NULL OR rec.mapping_status<>'MAPPED_INTERCOMPANY_PAIR' THEN RAISE EXCEPTION 'One exact mapped intercompany reconciliation row is required' USING ERRCODE='55000';END IF;
 SELECT * INTO src_map FROM mapping_snapshot WHERE tenant_id=p_tenant AND mapping_snapshot_id=rec.mapping_snapshot_id;
 SELECT * INTO cp_map FROM mapping_snapshot WHERE tenant_id=p_tenant AND mapping_snapshot_id=rec.counterparty_mapping_snapshot_id;
 src_class:=src_map.output_rules->>'classification';cp_class:=cp_map.output_rules->>'classification';
 IF src_map.snapshot_hash IS DISTINCT FROM rec.mapping_snapshot_hash OR cp_map.snapshot_hash IS DISTINCT FROM rec.counterparty_mapping_snapshot_hash
  OR src_map.output_rules->>'counterparty_classification' IS DISTINCT FROM cp_class OR cp_map.output_rules->>'counterparty_classification' IS DISTINCT FROM src_class
  OR src_map.output_rules->>'counterparty_account_code' IS DISTINCT FROM rec.counterparty_account_code OR cp_map.output_rules->>'counterparty_account_code' IS DISTINCT FROM rec.account_code
  OR NOT((src_class='DUE_FROM' AND cp_class='DUE_TO' AND rec.current_closing_balance>0 AND rec.counterparty_closing_balance<0)
       OR(src_class='DUE_TO' AND cp_class='DUE_FROM' AND rec.current_closing_balance<0 AND rec.counterparty_closing_balance>0)) THEN
  RAISE EXCEPTION 'Reciprocal DUE_FROM and DUE_TO mappings and normal-sign balances are required' USING ERRCODE='55000';
 END IF;
 SELECT * INTO src_account_map FROM consolidation_account_map a WHERE a.consolidation_snapshot_id=snap.consolidation_snapshot_id AND a.member_entity_id=p_source_entity AND a.source_account_code=rec.account_code;
 SELECT * INTO cp_account_map FROM consolidation_account_map a WHERE a.consolidation_snapshot_id=snap.consolidation_snapshot_id AND a.member_entity_id=p_counterparty_entity AND a.source_account_code=rec.counterparty_account_code;
 IF src_account_map.source_account_code IS NULL OR cp_account_map.source_account_code IS NULL
  OR(src_class='DUE_FROM' AND src_account_map.presentation_side<>'DEBIT') OR(src_class='DUE_TO' AND src_account_map.presentation_side<>'CREDIT')
  OR(cp_class='DUE_FROM' AND cp_account_map.presentation_side<>'DEBIT') OR(cp_class='DUE_TO' AND cp_account_map.presentation_side<>'CREDIT') THEN
  RAISE EXCEPTION 'Consolidation mappings must preserve DUE_FROM debit and DUE_TO credit presentation sides' USING ERRCODE='55000';
 END IF;
 SELECT count(*) INTO existing_count FROM consolidation_elimination_evidence e WHERE e.consolidation_snapshot_id=snap.consolidation_snapshot_id
  AND(e.presentation_account_code,e.presentation_side) IN((src_account_map.presentation_account_code,src_account_map.presentation_side),(cp_account_map.presentation_account_code,cp_account_map.presentation_side));
 IF existing_count<>0 THEN RAISE EXCEPTION 'Existing presentation elimination evidence makes source allocation ambiguous' USING ERRCODE='55000';END IF;
 matched:=LEAST(abs(rec.current_closing_balance),abs(rec.counterparty_closing_balance));
 IF matched<=0 THEN RAISE EXCEPTION 'A positive matched intercompany amount is required' USING ERRCODE='55000';END IF;
 scope_hash:=refs_jsonb_hash(CASE WHEN p_source_entity::text<p_counterparty_entity::text THEN jsonb_build_object(
  'consolidation_snapshot_id',snap.consolidation_snapshot_id,'currency',snap.currency,
  'first_entity_id',p_source_entity,'first_period_id',p_source_period,'first_account_code',rec.account_code,'first_mapping_snapshot_id',rec.mapping_snapshot_id,
  'second_entity_id',p_counterparty_entity,'second_period_id',p_counterparty_period,'second_account_code',rec.counterparty_account_code,'second_mapping_snapshot_id',rec.counterparty_mapping_snapshot_id)
 ELSE jsonb_build_object('consolidation_snapshot_id',snap.consolidation_snapshot_id,'currency',snap.currency,
  'first_entity_id',p_counterparty_entity,'first_period_id',p_counterparty_period,'first_account_code',rec.counterparty_account_code,'first_mapping_snapshot_id',rec.counterparty_mapping_snapshot_id,
  'second_entity_id',p_source_entity,'second_period_id',p_source_period,'second_account_code',rec.account_code,'second_mapping_snapshot_id',rec.mapping_snapshot_id) END);
 evidence:=jsonb_build_object('schema_version','INTERCOMPANY_ELIMINATION_SOURCE_V1','reporting_entity_id',p_reporting_entity,'reporting_period_id',p_reporting_period,
  'period_cutoff',report_period.ends_on,'reporting_period_start',report_period.starts_on,'reporting_period_end',report_period.ends_on,'reporting_period_ledger_code',report_period.ledger_code,'reporting_period_status',report_period.status,'reporting_period_version',report_period.version::text,'consolidation_snapshot_id',snap.consolidation_snapshot_id,'consolidation_version',snap.version::text,'consolidation_snapshot_hash',snap.snapshot_hash,'consolidation_receipt_hash',snap.receipt_hash,'consolidation_member_population_hash',member_population_hash,'consolidation_account_map_population_hash',account_map_population_hash,'group_ref',snap.group_ref,'currency',snap.currency,
  'source_entity_id',p_source_entity,'source_period_id',p_source_period,'source_period_start',src_period.starts_on,'source_period_end',src_period.ends_on,'source_period_ledger_code',src_period.ledger_code,'source_period_status',src_period.status,'source_period_version',src_period.version::text,'source_account_code',rec.account_code,'source_classification',src_class,'source_normal_sign',CASE src_class WHEN 'DUE_FROM' THEN 'DEBIT_POSITIVE' ELSE 'CREDIT_NEGATIVE' END,'source_closing_balance',rec.current_closing_balance::text,
  'source_mapping_snapshot_id',rec.mapping_snapshot_id,'source_mapping_version',rec.mapping_version,'source_mapping_snapshot_hash',rec.mapping_snapshot_hash,'source_journal_entry_ids',to_jsonb(rec.journal_entry_ids),'source_journal_line_ids',to_jsonb(rec.journal_line_ids),'source_ledger_line_ids',to_jsonb(rec.ledger_line_ids),'source_document_ids',to_jsonb(rec.source_document_ids),'source_member_snapshot_hash',src_member.member_snapshot_hash,'source_member_receipt_hash',src_member.member_receipt_hash,
  'counterparty_entity_id',p_counterparty_entity,'counterparty_period_id',p_counterparty_period,'counterparty_period_start',cp_period.starts_on,'counterparty_period_end',cp_period.ends_on,'counterparty_period_ledger_code',cp_period.ledger_code,'counterparty_period_status',cp_period.status,'counterparty_period_version',cp_period.version::text,'counterparty_account_code',rec.counterparty_account_code,'counterparty_classification',cp_class,'counterparty_normal_sign',CASE cp_class WHEN 'DUE_FROM' THEN 'DEBIT_POSITIVE' ELSE 'CREDIT_NEGATIVE' END,'counterparty_closing_balance',rec.counterparty_closing_balance::text,
  'counterparty_mapping_snapshot_id',rec.counterparty_mapping_snapshot_id,'counterparty_mapping_version',rec.counterparty_mapping_version,'counterparty_mapping_snapshot_hash',rec.counterparty_mapping_snapshot_hash,'counterparty_journal_entry_ids',to_jsonb(rec.counterparty_journal_entry_ids),'counterparty_journal_line_ids',to_jsonb(rec.counterparty_journal_line_ids),'counterparty_ledger_line_ids',to_jsonb(rec.counterparty_ledger_line_ids),'counterparty_source_document_ids',to_jsonb(rec.counterparty_source_document_ids),'counterparty_member_snapshot_hash',cp_member.member_snapshot_hash,'counterparty_member_receipt_hash',cp_member.member_receipt_hash,
  'source_presentation_account_code',src_account_map.presentation_account_code,'source_presentation_side',src_account_map.presentation_side,'source_consolidation_mapping_hash',src_account_map.mapping_hash,
  'counterparty_presentation_account_code',cp_account_map.presentation_account_code,'counterparty_presentation_side',cp_account_map.presentation_side,'counterparty_consolidation_mapping_hash',cp_account_map.mapping_hash,
  'matched_amount',matched::text,'raw_mismatch',(rec.current_closing_balance+rec.counterparty_closing_balance)::text,'canonical_source_scope_hash',scope_hash);
 RETURN evidence||jsonb_build_object('source_evidence_hash',refs_jsonb_hash(evidence));
END;$$;

CREATE OR REPLACE FUNCTION refs_intercompany_elimination_batch_payload(p_tenant uuid,p_reporting_entity uuid,p_batch uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE b intercompany_elimination_batch;lines jsonb;history jsonb;consolidation_rows jsonb:='[]'::jsonb;actor text:=refs_current_actor();source_current boolean:=false;
BEGIN
 SELECT * INTO b FROM intercompany_elimination_batch WHERE tenant_id=p_tenant AND reporting_entity_id=p_reporting_entity AND intercompany_elimination_batch_id=p_batch;
 IF NOT FOUND THEN RAISE EXCEPTION 'Intercompany elimination batch was not found' USING ERRCODE='P0002';END IF;
 SELECT coalesce(jsonb_agg(jsonb_build_object('line_no',l.line_no,'member_entity_id',l.member_entity_id,'member_period_id',l.member_period_id,'source_account_code',l.source_account_code,
  'source_classification',l.source_classification,'presentation_account_code',l.presentation_account_code,'presentation_side',l.presentation_side,'entry_side',l.entry_side,
  'debit_amount',l.debit_amount::text,'credit_amount',l.credit_amount::text,'consolidation_mapping_hash',l.consolidation_mapping_hash,'line_evidence_hash',l.line_evidence_hash) ORDER BY l.line_no),'[]'::jsonb) INTO lines
 FROM intercompany_elimination_line l WHERE l.tenant_id=p_tenant AND l.intercompany_elimination_batch_id=p_batch;
 SELECT coalesce(jsonb_agg(jsonb_build_object('from_status',h.from_status,'to_status',h.to_status,'revision',h.revision::text,'actor_id',h.actor_id,'reason',h.reason,'event_hash',h.event_hash,'created_at',h.created_at) ORDER BY h.revision),'[]'::jsonb) INTO history
 FROM intercompany_elimination_history h WHERE h.tenant_id=p_tenant AND h.intercompany_elimination_batch_id=p_batch;
 IF b.status='POSTED' THEN
  source_current:=refs_intercompany_elimination_posted_source_current(p_tenant,b.intercompany_elimination_batch_id);
 ELSIF b.status<>'CANCELLED' THEN
  BEGIN source_current:=(refs_intercompany_elimination_source_snapshot(p_tenant,b.reporting_entity_id,b.reporting_period_id,b.consolidation_snapshot_id,b.source_entity_id,b.source_period_id,b.counterparty_entity_id,b.counterparty_period_id,b.source_account_code)->>'source_evidence_hash')=b.source_evidence_hash;EXCEPTION WHEN others THEN source_current:=false;END;
 END IF;
 IF b.status='POSTED' THEN
  SELECT coalesce(jsonb_agg(jsonb_build_object('group_ref',x.group_ref,'period_id',x.period_id,'period_code',x.period_code,'period_start',x.period_start,'period_end',x.period_end,'currency',x.currency,
   'presentation_account_code',x.presentation_account_code,'presentation_side',x.presentation_side,'report_status',x.report_status,'classification_basis',x.classification_basis,
   'member_count',x.member_count,'evidence_member_count',x.evidence_member_count,'member_actual_amount',x.member_actual_amount::text,'elimination_amount',x.elimination_amount::text,'consolidated_amount',x.consolidated_amount::text,
   'consolidation_snapshot_id',x.consolidation_snapshot_id,'consolidation_version',x.consolidation_version,'consolidation_snapshot_hash',x.consolidation_snapshot_hash,'consolidation_receipt_hash',x.consolidation_receipt_hash,'consolidation_source_ref',x.consolidation_source_ref,'consolidation_source_version',x.consolidation_source_version,
   'member_entity_ids',to_jsonb(x.member_entity_ids),'journal_entry_ids',to_jsonb(x.journal_entry_ids),'journal_line_ids',to_jsonb(x.journal_line_ids),'ledger_line_ids',to_jsonb(x.ledger_line_ids),'source_document_ids',to_jsonb(x.source_document_ids),'elimination_refs',to_jsonb(x.elimination_refs)) ORDER BY x.presentation_account_code,x.presentation_side),'[]'::jsonb) INTO consolidation_rows
  FROM refs_get_consolidation(p_tenant,b.reporting_entity_id,b.reporting_period_id,b.group_ref) x
  WHERE EXISTS(SELECT 1 FROM intercompany_elimination_line l WHERE l.intercompany_elimination_batch_id=b.intercompany_elimination_batch_id AND l.presentation_account_code=x.presentation_account_code AND l.presentation_side=x.presentation_side);
 END IF;
 RETURN jsonb_build_object('schema_version','INTERCOMPANY_ELIMINATION_BATCH_V1','intercompany_elimination_batch_id',b.intercompany_elimination_batch_id,
  'reporting_entity_id',b.reporting_entity_id,'reporting_period_id',b.reporting_period_id,'reporting_period_ledger_code',b.reporting_period_ledger_code,'reporting_period_status',b.reporting_period_status,'reporting_period_version',b.reporting_period_version::text,'period_start',b.period_start,'period_end',b.period_end,'consolidation_snapshot_id',b.consolidation_snapshot_id,'consolidation_version',b.consolidation_version::text,'consolidation_snapshot_hash',b.consolidation_snapshot_hash,'consolidation_receipt_hash',b.consolidation_receipt_hash,'consolidation_member_population_hash',b.consolidation_member_population_hash,'consolidation_account_map_population_hash',b.consolidation_account_map_population_hash,'group_ref',b.group_ref,'currency',b.currency,
  'source_entity_id',b.source_entity_id,'source_period_id',b.source_period_id,'source_period_ledger_code',b.source_period_ledger_code,'source_period_status',b.source_period_status,'source_period_version',b.source_period_version::text,'source_account_code',b.source_account_code,'source_classification',b.source_classification,'source_normal_sign',CASE b.source_classification WHEN 'DUE_FROM' THEN 'DEBIT_POSITIVE' ELSE 'CREDIT_NEGATIVE' END,'source_closing_balance',b.source_closing_balance::text,
  'source_mapping_snapshot_id',b.source_mapping_snapshot_id,'source_mapping_snapshot_hash',b.source_mapping_snapshot_hash,'source_journal_entry_ids',to_jsonb(b.source_journal_entry_ids),'source_journal_line_ids',to_jsonb(b.source_journal_line_ids),'source_ledger_line_ids',to_jsonb(b.source_ledger_line_ids),'source_document_ids',to_jsonb(b.source_document_ids),
  'source_presentation_account_code',lines->0->>'presentation_account_code','source_presentation_side',lines->0->>'presentation_side','source_consolidation_mapping_hash',lines->0->>'consolidation_mapping_hash',
  'counterparty_entity_id',b.counterparty_entity_id,'counterparty_period_id',b.counterparty_period_id,'counterparty_period_ledger_code',b.counterparty_period_ledger_code,'counterparty_period_status',b.counterparty_period_status,'counterparty_period_version',b.counterparty_period_version::text,'counterparty_account_code',b.counterparty_account_code,'counterparty_classification',b.counterparty_classification,'counterparty_normal_sign',CASE b.counterparty_classification WHEN 'DUE_FROM' THEN 'DEBIT_POSITIVE' ELSE 'CREDIT_NEGATIVE' END,'counterparty_closing_balance',b.counterparty_closing_balance::text,
  'counterparty_mapping_snapshot_id',b.counterparty_mapping_snapshot_id,'counterparty_mapping_snapshot_hash',b.counterparty_mapping_snapshot_hash,'counterparty_journal_entry_ids',to_jsonb(b.counterparty_journal_entry_ids),'counterparty_journal_line_ids',to_jsonb(b.counterparty_journal_line_ids),'counterparty_ledger_line_ids',to_jsonb(b.counterparty_ledger_line_ids),'counterparty_source_document_ids',to_jsonb(b.counterparty_source_document_ids),
  'counterparty_presentation_account_code',lines->1->>'presentation_account_code','counterparty_presentation_side',lines->1->>'presentation_side','counterparty_consolidation_mapping_hash',lines->1->>'consolidation_mapping_hash',
  'matched_amount',b.matched_amount::text,'raw_mismatch',b.raw_mismatch::text,'canonical_source_scope_hash',b.canonical_source_scope_hash,'source_evidence_hash',b.source_evidence_hash,'source_current',source_current,
  'status',b.status,'revision',b.revision::text,'lines',lines,'history',history,'consolidation_results',consolidation_rows,
  'created_by',b.created_by,'created_at',b.created_at,'submitted_by',b.submitted_by,'submitted_at',b.submitted_at,'reviewed_by',b.reviewed_by,'reviewed_at',b.reviewed_at,'approved_by',b.approved_by,'approved_at',b.approved_at,'posted_by',b.posted_by,'posted_at',b.posted_at,'cancelled_by',b.cancelled_by,'cancelled_at',b.cancelled_at,'cancel_reason',b.cancel_reason,'post_evidence_hash',b.post_evidence_hash,
  'action_flags',jsonb_build_object('can_create_draft',false,
   'can_submit',b.status='DRAFT' AND source_current AND refs_entity_has_permission(b.reporting_entity_id,'GROUP.INTERCOMPANY_ELIMINATION.SUBMIT'),
   'can_review',b.status='PENDING_REVIEW' AND source_current AND actor IS DISTINCT FROM b.created_by AND refs_entity_has_permission(b.reporting_entity_id,'GROUP.INTERCOMPANY_ELIMINATION.REVIEW'),
   'can_approve',b.status='REVIEWED' AND source_current AND actor IS DISTINCT FROM b.created_by AND actor IS DISTINCT FROM b.reviewed_by AND refs_entity_has_permission(b.reporting_entity_id,'GROUP.INTERCOMPANY_ELIMINATION.APPROVE'),
   'can_cancel',b.status NOT IN('POSTED','CANCELLED') AND actor IS DISTINCT FROM b.created_by AND actor IS DISTINCT FROM b.reviewed_by AND actor IS DISTINCT FROM b.approved_by AND refs_entity_has_permission(b.reporting_entity_id,'GROUP.INTERCOMPANY_ELIMINATION.CANCEL'),
   'can_post',b.status='APPROVED' AND source_current AND actor IS DISTINCT FROM b.created_by AND actor IS DISTINCT FROM b.reviewed_by AND actor IS DISTINCT FROM b.approved_by AND refs_entity_has_permission(b.reporting_entity_id,'GROUP.INTERCOMPANY_ELIMINATION.POST')));
END;$$;

CREATE OR REPLACE FUNCTION refs_read_intercompany_elimination_create_options(
 p_tenant uuid,p_reporting_entity uuid,p_reporting_period uuid,p_group_ref text,p_source_entity uuid,p_source_period uuid,p_counterparty_entity uuid,p_counterparty_period uuid
) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE snap consolidation_snapshot;rec record;option jsonb;options jsonb:='[]'::jsonb;
BEGIN
 PERFORM refs_assert_scope(p_tenant,p_reporting_entity,'GROUP.INTERCOMPANY_ELIMINATION.VIEW');
 PERFORM refs_assert_scope(p_tenant,p_source_entity,'GL.REPORT.VIEW');PERFORM refs_assert_scope(p_tenant,p_counterparty_entity,'GL.REPORT.VIEW');
 SELECT s.* INTO snap FROM consolidation_snapshot s JOIN accounting_period p ON p.tenant_id=s.tenant_id AND p.entity_id=s.reporting_entity_id AND p.period_id=s.reporting_period_id AND p.ledger_code='PRIMARY' AND p.status='OPEN' WHERE s.tenant_id=p_tenant AND s.reporting_entity_id=p_reporting_entity AND s.reporting_period_id=p_reporting_period AND s.group_ref=p_group_ref ORDER BY s.version DESC,s.consolidation_snapshot_id DESC LIMIT 1;
 IF NOT FOUND THEN RETURN jsonb_build_object('schema_version','INTERCOMPANY_ELIMINATION_CREATE_OPTIONS_V1','reporting_entity_id',p_reporting_entity,'reporting_period_id',p_reporting_period,'group_ref',p_group_ref,'source_entity_id',p_source_entity,'source_period_id',p_source_period,'counterparty_entity_id',p_counterparty_entity,'counterparty_period_id',p_counterparty_period,'consolidation_snapshot_id',NULL,'currency',NULL,'options','[]'::jsonb,'action_flags',jsonb_build_object('can_create_draft',false,'can_submit',false,'can_review',false,'can_approve',false,'can_cancel',false,'can_post',false));END IF;
 FOR rec IN SELECT * FROM refs_get_intercompany_reconciliation(p_tenant,p_source_entity,p_source_period,p_counterparty_entity,p_counterparty_period) ORDER BY account_code LOOP
  BEGIN
   option:=refs_intercompany_elimination_source_snapshot(p_tenant,p_reporting_entity,p_reporting_period,snap.consolidation_snapshot_id,p_source_entity,p_source_period,p_counterparty_entity,p_counterparty_period,rec.account_code);
   IF NOT EXISTS(SELECT 1 FROM intercompany_elimination_batch b WHERE b.tenant_id=p_tenant AND b.canonical_source_scope_hash=option->>'canonical_source_scope_hash' AND b.status<>'CANCELLED') THEN options:=options||jsonb_build_array(option);END IF;
  EXCEPTION WHEN others THEN NULL;
  END;
 END LOOP;
 RETURN jsonb_build_object('schema_version','INTERCOMPANY_ELIMINATION_CREATE_OPTIONS_V1','reporting_entity_id',p_reporting_entity,'reporting_period_id',p_reporting_period,'group_ref',snap.group_ref,'source_entity_id',p_source_entity,'source_period_id',p_source_period,'counterparty_entity_id',p_counterparty_entity,'counterparty_period_id',p_counterparty_period,'consolidation_snapshot_id',snap.consolidation_snapshot_id,'currency',snap.currency,'options',options,
  'action_flags',jsonb_build_object('can_create_draft',jsonb_array_length(options)>0,'can_submit',false,'can_review',false,'can_approve',false,'can_cancel',false,'can_post',false));
END;$$;

REVOKE EXECUTE ON FUNCTION refs_intercompany_elimination_create_hash(uuid,uuid,uuid,uuid,uuid,uuid,uuid,uuid,text,text,text),refs_intercompany_elimination_transition_hash(uuid,uuid,uuid,text,bigint,text),refs_intercompany_elimination_post_hash(uuid,uuid,uuid,bigint) FROM refs_app;

COMMIT;
