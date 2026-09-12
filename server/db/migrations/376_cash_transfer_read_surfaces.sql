BEGIN;

-- Read surfaces remain SECURITY DEFINER so refs_app never receives raw-table
-- access.  Every function binds the tenant/entity through refs_assert_scope.
DO $$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM pg_class WHERE oid='cash_transfer'::regclass AND relrowsecurity)
    OR NOT EXISTS(SELECT 1 FROM pg_class WHERE oid='cash_transfer_bank_account_control'::regclass AND relrowsecurity)
    OR NOT EXISTS(SELECT 1 FROM pg_class WHERE oid='cash_transfer_bank_link'::regclass AND relrowsecurity) THEN
  RAISE EXCEPTION 'Cash Transfer read surfaces require RLS on all retained evidence tables' USING ERRCODE='55000';
 END IF;
 IF has_table_privilege('refs_app','cash_transfer','SELECT')
    OR has_table_privilege('refs_app','cash_transfer_bank_account_control','SELECT')
    OR has_table_privilege('refs_app','cash_transfer_bank_link','SELECT') THEN
  RAISE EXCEPTION 'refs_app must not retain direct Cash Transfer evidence read access' USING ERRCODE='55000';
 END IF;
END $$;

CREATE FUNCTION refs_cash_transfer_control_create_hash(
 p_tenant uuid,p_entity uuid,p_bank text,p_account text,p_currency char(3),p_effective_from date,p_effective_to date
) RETURNS text LANGUAGE sql IMMUTABLE SET search_path=pg_catalog,public,pg_temp AS $$
 SELECT refs_jsonb_hash(jsonb_build_object('tenant_id',p_tenant,'entity_id',p_entity,'bank_member_ref',btrim(p_bank),'cash_account_code',btrim(p_account),'currency',p_currency,'effective_from',p_effective_from,'effective_to',p_effective_to))
$$;

CREATE FUNCTION refs_cash_transfer_control_approve_hash(
 p_tenant uuid,p_entity uuid,p_control uuid,p_expected_version bigint
) RETURNS text LANGUAGE sql IMMUTABLE SET search_path=pg_catalog,public,pg_temp AS $$
 SELECT refs_jsonb_hash(jsonb_build_object('tenant_id',p_tenant,'entity_id',p_entity,'control_id',p_control,'expected_version',p_expected_version))
$$;

CREATE FUNCTION refs_cash_transfer_control_retire_hash(
 p_tenant uuid,p_entity uuid,p_control uuid,p_expected_version bigint
) RETURNS text LANGUAGE sql IMMUTABLE SET search_path=pg_catalog,public,pg_temp AS $$
 SELECT refs_jsonb_hash(jsonb_build_object('tenant_id',p_tenant,'entity_id',p_entity,'control_id',p_control,'expected_version',p_expected_version,'action','RETIRE'))
$$;

CREATE FUNCTION refs_cash_transfer_bank_link_hash(
 p_tenant uuid,p_entity uuid,p_transfer uuid,p_leg text,p_bank_source uuid,p_expected_transfer_revision bigint
) RETURNS text LANGUAGE sql IMMUTABLE SET search_path=pg_catalog,public,pg_temp AS $$
 SELECT refs_jsonb_hash(jsonb_build_object('tenant_id',p_tenant,'entity_id',p_entity,'cash_transfer_id',p_transfer,'leg',p_leg,'bank_source_id',p_bank_source,'expected_revision',p_expected_transfer_revision))
$$;

CREATE FUNCTION refs_read_cash_transfer_create_options(
 p_tenant uuid,p_entity uuid,p_period uuid,p_transfer_date date
) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE options jsonb;eligible_currency_count integer;period_row accounting_period;
BEGIN
 IF p_transfer_date IS NULL THEN RAISE EXCEPTION 'Cash Transfer date is required' USING ERRCODE='22023'; END IF;
 PERFORM refs_assert_scope(p_tenant,p_entity,'CASH.TRANSFER.CREATE');
 PERFORM refs_assert_scope(p_tenant,p_entity,'GL.JE.CREATE');
 PERFORM refs_assert_scope(p_tenant,p_entity,'GL.JE.VIEW');
 SELECT * INTO period_row FROM accounting_period
  WHERE tenant_id=p_tenant AND entity_id=p_entity AND period_id=p_period AND ledger_code='PRIMARY'
    AND status='OPEN' AND p_transfer_date BETWEEN starts_on AND ends_on;
 IF NOT FOUND THEN RAISE EXCEPTION 'Cash Transfer period is not open for the transfer date' USING ERRCODE='P0002'; END IF;
 SELECT count(*) INTO eligible_currency_count FROM (
   SELECT c.currency
   FROM cash_transfer_bank_account_control c
   JOIN account_master a ON a.tenant_id=c.tenant_id AND a.entity_id=c.entity_id AND a.account_code=c.cash_account_code
     AND a.active AND a.requires_member AND a.required_member_type='BANK'
   JOIN member_master m ON m.tenant_id=c.tenant_id AND m.entity_id=c.entity_id AND m.member_ref=c.bank_member_ref
     AND m.active AND m.member_type='BANK'
   WHERE c.tenant_id=p_tenant AND c.entity_id=p_entity AND c.status='APPROVED'
     AND c.effective_from<=p_transfer_date AND (c.effective_to IS NULL OR c.effective_to>p_transfer_date)
   GROUP BY c.currency HAVING count(*)>=2
 ) eligible;
 SELECT coalesce(jsonb_agg(jsonb_build_object(
   'control_id',c.cash_transfer_bank_account_control_id,'bank_member_ref',c.bank_member_ref,
   'bank_display_name',m.display_name,'cash_account_code',c.cash_account_code,'cash_account_name',a.account_name,
   'currency',c.currency,'effective_from',c.effective_from,'effective_to',c.effective_to,'revision',c.version
 ) ORDER BY c.currency,c.bank_member_ref,c.cash_account_code),'[]'::jsonb) INTO options
 FROM cash_transfer_bank_account_control c
 JOIN account_master a ON a.tenant_id=c.tenant_id AND a.entity_id=c.entity_id AND a.account_code=c.cash_account_code
   AND a.active AND a.requires_member AND a.required_member_type='BANK'
 JOIN member_master m ON m.tenant_id=c.tenant_id AND m.entity_id=c.entity_id AND m.member_ref=c.bank_member_ref
   AND m.active AND m.member_type='BANK'
 WHERE c.tenant_id=p_tenant AND c.entity_id=p_entity AND c.status='APPROVED'
   AND c.effective_from<=p_transfer_date AND (c.effective_to IS NULL OR c.effective_to>p_transfer_date);
 RETURN jsonb_build_object('schema_version','CASH_TRANSFER_CREATE_OPTIONS_V1','entity_id',p_entity,
   'period_id',p_period,'transfer_date',p_transfer_date,'controls',options,
   'action_flags',jsonb_build_object('can_create_draft',eligible_currency_count>0,'can_submit',false,'can_review',false,'can_approve',false,'can_cancel',false,'can_post',false,'can_reconcile',false));
END;$$;

CREATE FUNCTION refs_read_cash_transfer_detail(
 p_tenant uuid,p_entity uuid,p_transfer uuid
) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE actor text:=refs_current_actor();t cash_transfer;j journal_entry;lines jsonb;ledger jsonb;links jsonb;from_control jsonb;to_control jsonb;attachment_evidence jsonb;posted_by text;
BEGIN
 PERFORM refs_assert_scope(p_tenant,p_entity,'CASH.TRANSFER.VIEW');
 PERFORM refs_assert_scope(p_tenant,p_entity,'GL.JE.VIEW');
 SELECT * INTO t FROM cash_transfer WHERE tenant_id=p_tenant AND entity_id=p_entity AND cash_transfer_id=p_transfer;
 IF NOT FOUND THEN RAISE EXCEPTION 'Cash Transfer is not available in this entity' USING ERRCODE='P0002'; END IF;
 SELECT * INTO j FROM journal_entry WHERE tenant_id=p_tenant AND entity_id=p_entity AND journal_entry_id=t.journal_entry_id;
 IF NOT FOUND THEN RAISE EXCEPTION 'Cash Transfer Journal evidence is unavailable' USING ERRCODE='55000'; END IF;
 posted_by:=j.posted_by;
 SELECT jsonb_build_object('control_id',c.cash_transfer_bank_account_control_id,'bank_member_ref',c.bank_member_ref,'cash_account_code',c.cash_account_code,'currency',c.currency,'effective_from',c.effective_from,'effective_to',c.effective_to,'status',c.status,'revision',c.version,'created_by',c.created_by,'approved_by',c.approved_by,'retired_by',c.retired_by) INTO from_control FROM cash_transfer_bank_account_control c WHERE c.tenant_id=p_tenant AND c.entity_id=p_entity AND c.cash_transfer_bank_account_control_id=t.from_bank_account_control_id;
 SELECT jsonb_build_object('control_id',c.cash_transfer_bank_account_control_id,'bank_member_ref',c.bank_member_ref,'cash_account_code',c.cash_account_code,'currency',c.currency,'effective_from',c.effective_from,'effective_to',c.effective_to,'status',c.status,'revision',c.version,'created_by',c.created_by,'approved_by',c.approved_by,'retired_by',c.retired_by) INTO to_control FROM cash_transfer_bank_account_control c WHERE c.tenant_id=p_tenant AND c.entity_id=p_entity AND c.cash_transfer_bank_account_control_id=t.to_bank_account_control_id;
 IF from_control IS NULL OR to_control IS NULL THEN RAISE EXCEPTION 'Cash Transfer controlled bank-account evidence is unavailable' USING ERRCODE='55000'; END IF;
 SELECT coalesce(jsonb_agg(jsonb_build_object('journal_line_id',jl.journal_line_id,'line_no',jl.line_no,'account_code',jl.account_code,'member_ref',jl.member_ref,'debit_amount',jl.debit_amount::text,'credit_amount',jl.credit_amount::text,'description',jl.description,'dimensions',jl.dimensions) ORDER BY jl.line_no),'[]'::jsonb) INTO lines FROM journal_line jl WHERE jl.tenant_id=p_tenant AND jl.entity_id=p_entity AND jl.journal_entry_id=t.journal_entry_id;
 SELECT coalesce(jsonb_agg(jsonb_build_object('ledger_line_id',ll.ledger_line_id,'journal_line_id',ll.journal_line_id,'account_code',ll.account_code,'member_ref',ll.member_ref,'currency',ll.currency,'debit_amount',ll.debit_amount::text,'credit_amount',ll.credit_amount::text,'posted_at',ll.posted_at) ORDER BY ll.ledger_line_id),'[]'::jsonb) INTO ledger FROM ledger_line ll WHERE ll.tenant_id=p_tenant AND ll.entity_id=p_entity AND ll.journal_entry_id=t.journal_entry_id;
 SELECT coalesce(jsonb_agg(jsonb_build_object('cash_transfer_bank_link_id',l.cash_transfer_bank_link_id,'leg',l.leg,'status',l.status,'bank_source_id',l.bank_source_id,'bank_account_ref',b.bank_account_ref,'journal_line_id',l.journal_line_id,'ledger_line_id',l.ledger_line_id,'linked_by',l.linked_by,'linked_at',l.linked_at,'retired_by',l.retired_by,'retired_at',l.retired_at) ORDER BY l.leg),'[]'::jsonb) INTO links FROM cash_transfer_bank_link l JOIN bank_source b ON b.tenant_id=l.tenant_id AND b.bank_source_id=l.bank_source_id WHERE l.tenant_id=p_tenant AND l.entity_id=p_entity AND l.cash_transfer_id=t.cash_transfer_id;
 SELECT coalesce(jsonb_agg(jsonb_build_object('attachment_id',a.attachment_id,'verified_at',a.verified_at,'finalized_at',a.finalized_at) ORDER BY a.attachment_id),'[]'::jsonb) INTO attachment_evidence FROM attachment a WHERE a.tenant_id=p_tenant AND a.entity_id=p_entity AND a.attachment_id=ANY(t.attachment_ids) AND a.finalization_status='VERIFIED_CLEAN' AND a.scan_status='CLEAN' AND a.verified_at IS NOT NULL AND a.finalized_at IS NOT NULL;
 IF jsonb_array_length(attachment_evidence)<>cardinality(t.attachment_ids) OR refs_cash_transfer_attachment_snapshot(p_tenant,p_entity,t.attachment_ids) IS DISTINCT FROM t.attachment_snapshot_hash THEN RAISE EXCEPTION 'Cash Transfer retained attachment evidence is unavailable or changed' USING ERRCODE='55000'; END IF;
 RETURN jsonb_build_object('schema_version','CASH_TRANSFER_DETAIL_V1','cash_transfer_id',t.cash_transfer_id,'entity_id',t.entity_id,'period_id',t.period_id,'transfer_date',t.transfer_date,'currency',t.currency,'amount',t.amount::text,'from_account_code',t.from_account_code,'from_bank_member_ref',t.from_bank_member_ref,'to_account_code',t.to_account_code,'to_bank_member_ref',t.to_bank_member_ref,'from_bank_account_control',from_control,'to_bank_account_control',to_control,'attachment_ids',to_jsonb(t.attachment_ids),'attachment_snapshot_hash',t.attachment_snapshot_hash,'attachments',attachment_evidence,'reason',t.reason,'status',t.status,'revision',t.revision,'evidence_hash',t.evidence_hash,'created_by',t.created_by,'created_at',t.created_at,'reviewed_by',t.reviewed_by,'reviewed_at',t.reviewed_at,'approved_by',t.approved_by,'approved_at',t.approved_at,'posted_at',t.posted_at,'cancelled_by',t.cancelled_by,'cancelled_at',t.cancelled_at,'cancel_reason',t.cancel_reason,'journal',jsonb_build_object('journal_entry_id',j.journal_entry_id,'journal_number',j.journal_number,'journal_type',j.journal_type,'journal_date',j.journal_date,'currency',j.currency,'status',j.status,'revision',j.revision,'created_by',j.created_by,'reviewed_by',j.reviewed_by,'approved_by',j.approved_by,'posted_by',j.posted_by,'posted_at',j.posted_at,'lines',lines,'ledger_lines',ledger),'bank_links',links,'action_flags',jsonb_build_object('can_create_draft',false,'can_submit',t.status='DRAFT' AND refs_entity_has_permission(p_entity,'CASH.TRANSFER.SUBMIT') AND refs_entity_has_permission(p_entity,'GL.JE.SUBMIT'),'can_review',t.status='PENDING_REVIEW' AND refs_entity_has_permission(p_entity,'CASH.TRANSFER.REVIEW') AND refs_entity_has_permission(p_entity,'GL.JE.REVIEW') AND actor IS DISTINCT FROM t.created_by AND actor IS DISTINCT FROM j.created_by,'can_approve',t.status='PENDING_APPROVAL' AND refs_entity_has_permission(p_entity,'CASH.TRANSFER.APPROVE') AND refs_entity_has_permission(p_entity,'GL.JE.APPROVE') AND actor IS DISTINCT FROM t.created_by AND actor IS DISTINCT FROM t.reviewed_by AND actor IS DISTINCT FROM j.created_by AND actor IS DISTINCT FROM j.reviewed_by,'can_cancel',t.status NOT IN('POSTED','CANCELLED') AND refs_entity_has_permission(p_entity,'CASH.TRANSFER.CANCEL') AND actor IS DISTINCT FROM t.created_by,'can_post',t.status='APPROVED' AND refs_entity_has_permission(p_entity,'CASH.TRANSFER.POST') AND refs_entity_has_permission(p_entity,'GL.JE.POST') AND actor IS DISTINCT FROM t.created_by AND actor IS DISTINCT FROM t.reviewed_by AND actor IS DISTINCT FROM t.approved_by AND actor IS DISTINCT FROM j.created_by AND actor IS DISTINCT FROM j.reviewed_by AND actor IS DISTINCT FROM j.approved_by,'can_reconcile',t.status='POSTED' AND refs_entity_has_permission(p_entity,'CASH.TRANSFER.RECONCILE') AND refs_entity_has_permission(p_entity,'GL.JE.VIEW')));
END;$$;

CREATE FUNCTION refs_read_cash_transfer_register(
 p_tenant uuid,p_entity uuid,p_period uuid,p_limit integer,p_after_date date,p_after_transfer uuid
) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE rows jsonb;more boolean;next_cursor jsonb;
BEGIN
 IF p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 100 OR num_nonnulls(p_after_date,p_after_transfer) NOT IN(0,2) THEN RAISE EXCEPTION 'Invalid Cash Transfer register cursor' USING ERRCODE='22023'; END IF;
 PERFORM refs_assert_scope(p_tenant,p_entity,'CASH.TRANSFER.VIEW');
 PERFORM refs_assert_scope(p_tenant,p_entity,'GL.JE.VIEW');
 PERFORM 1 FROM accounting_period WHERE tenant_id=p_tenant AND entity_id=p_entity AND period_id=p_period AND ledger_code='PRIMARY';
 IF NOT FOUND THEN RAISE EXCEPTION 'Cash Transfer period is outside the entity' USING ERRCODE='22023'; END IF;
 WITH candidates AS MATERIALIZED(
   SELECT t.transfer_date,t.cash_transfer_id FROM cash_transfer t WHERE t.tenant_id=p_tenant AND t.entity_id=p_entity AND t.period_id=p_period
    AND (p_after_date IS NULL OR (t.transfer_date,t.cash_transfer_id)<(p_after_date,p_after_transfer))
   ORDER BY t.transfer_date DESC,t.cash_transfer_id DESC LIMIT p_limit+1
 ),page AS(
   SELECT c.transfer_date,c.cash_transfer_id,row_number() OVER(ORDER BY c.transfer_date DESC,c.cash_transfer_id DESC) rn,refs_read_cash_transfer_detail(p_tenant,p_entity,c.cash_transfer_id) row FROM candidates c
 )
 SELECT coalesce(jsonb_agg(row ORDER BY transfer_date DESC,cash_transfer_id DESC) FILTER(WHERE rn<=p_limit),'[]'::jsonb),count(*)>p_limit,CASE WHEN count(*)>p_limit THEN (SELECT jsonb_build_object('transfer_date',tail.transfer_date,'cash_transfer_id',tail.cash_transfer_id) FROM page tail WHERE tail.rn=p_limit) ELSE NULL END INTO rows,more,next_cursor FROM page;
 RETURN jsonb_build_object('schema_version','CASH_TRANSFER_REGISTER_V1','entity_id',p_entity,'period_id',p_period,'read_at',statement_timestamp(),'rows',rows,'limit',p_limit,'has_more',more,'next_cursor',next_cursor,'action_flags',jsonb_build_object('can_create_draft',false,'can_submit',false,'can_review',false,'can_approve',false,'can_cancel',false,'can_post',false,'can_reconcile',false));
END;$$;

REVOKE ALL ON FUNCTION refs_cash_transfer_control_create_hash(uuid,uuid,text,text,char(3),date,date),refs_cash_transfer_control_approve_hash(uuid,uuid,uuid,bigint),refs_cash_transfer_control_retire_hash(uuid,uuid,uuid,bigint),refs_cash_transfer_bank_link_hash(uuid,uuid,uuid,text,uuid,bigint),refs_read_cash_transfer_create_options(uuid,uuid,uuid,date),refs_read_cash_transfer_detail(uuid,uuid,uuid),refs_read_cash_transfer_register(uuid,uuid,uuid,integer,date,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION refs_cash_transfer_control_create_hash(uuid,uuid,text,text,char(3),date,date),refs_cash_transfer_control_approve_hash(uuid,uuid,uuid,bigint),refs_cash_transfer_control_retire_hash(uuid,uuid,uuid,bigint),refs_cash_transfer_bank_link_hash(uuid,uuid,uuid,text,uuid,bigint),refs_read_cash_transfer_create_options(uuid,uuid,uuid,date),refs_read_cash_transfer_detail(uuid,uuid,uuid),refs_read_cash_transfer_register(uuid,uuid,uuid,integer,date,uuid) TO refs_app;

COMMIT;
