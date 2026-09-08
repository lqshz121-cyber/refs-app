BEGIN;
CREATE FUNCTION refs_sales_receipt_bank_match_hash(p_tenant uuid,p_entity uuid,p_bank uuid,p_sale uuid,p_bank_version bigint,p_sale_version bigint,p_reason text)
RETURNS text LANGUAGE sql IMMUTABLE SET search_path=pg_catalog,public,pg_temp AS $$
 SELECT refs_jsonb_hash(jsonb_build_object('tenant_id',p_tenant,'entity_id',p_entity,'bank_source_id',p_bank,
   'sales_receipt_id',p_sale,'expected_bank_version',p_bank_version,'expected_receipt_version',p_sale_version,'reason',btrim(p_reason)))
$$;
CREATE FUNCTION refs_create_sales_receipt_bank_match(p_tenant uuid,p_entity uuid,p_bank uuid,p_sale uuid,p_bank_version bigint,p_sale_version bigint,p_reason text,p_key text,p_hash text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE actor text:=refs_current_actor();receipt idempotency_receipt;bank_row bank_source;sale sales_receipt;je journal_entry;
DECLARE account_ref text;line_ids uuid[];ledger_ids uuid[];match_id uuid:=gen_random_uuid();response jsonb;payload jsonb;
BEGIN
 PERFORM refs_assert_scope(p_tenant,p_entity,'BANK.MATCH.CREATE');
 IF actor IS NULL THEN RAISE EXCEPTION 'Authenticated actor missing' USING ERRCODE='42501';END IF;
 IF p_bank IS NULL OR p_sale IS NULL OR p_bank_version IS NULL OR p_bank_version<0 OR p_sale_version IS NULL OR p_sale_version<0
   OR COALESCE(length(btrim(p_reason)),0) NOT BETWEEN 8 AND 2000 OR COALESCE(length(p_key),0) NOT BETWEEN 8 AND 200
   OR p_hash IS DISTINCT FROM refs_sales_receipt_bank_match_hash(p_tenant,p_entity,p_bank,p_sale,p_bank_version,p_sale_version,p_reason) THEN
   RAISE EXCEPTION 'Cash sale matching requires exact identities, revisions, reason and canonical request' USING ERRCODE='22023';
 END IF;
 INSERT INTO idempotency_receipt(tenant_id,operation_scope,idempotency_key,request_hash,status,actor_id)
 VALUES(p_tenant,'SALES_RECEIPT_BANK_MATCH:'||p_entity,p_key,p_hash,'IN_PROGRESS',actor)
 ON CONFLICT(tenant_id,operation_scope,idempotency_key) DO NOTHING;
 SELECT * INTO receipt FROM idempotency_receipt WHERE tenant_id=p_tenant AND operation_scope='SALES_RECEIPT_BANK_MATCH:'||p_entity AND idempotency_key=p_key FOR UPDATE;
 IF receipt.actor_id IS DISTINCT FROM actor THEN RAISE EXCEPTION 'Cash sale matching retry belongs to another actor' USING ERRCODE='42501';END IF;
 IF receipt.request_hash IS DISTINCT FROM p_hash THEN RAISE EXCEPTION 'Idempotency key reused with another match request' USING ERRCODE='23505';END IF;
 IF receipt.status='SUCCEEDED' THEN RETURN receipt.response_body||jsonb_build_object('idempotent',true);END IF;

 SELECT bank_account_ref INTO account_ref FROM bank_source WHERE tenant_id=p_tenant AND entity_id=p_entity AND bank_source_id=p_bank;
 IF NOT FOUND THEN RAISE EXCEPTION 'Bank transaction not found in this company' USING ERRCODE='P0002';END IF;
 -- Share the account-level lock used by reconciliation sign-off. Do not lock
 -- reconciliation rows after this lock: sign-off takes its row lock first.
 PERFORM pg_advisory_xact_lock(hashtextextended(p_tenant::text||':'||p_entity::text||':'||account_ref,0));
 SELECT * INTO bank_row FROM bank_source WHERE tenant_id=p_tenant AND entity_id=p_entity AND bank_source_id=p_bank FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Bank transaction not found in this company' USING ERRCODE='P0002';END IF;
 IF bank_row.version<>p_bank_version OR bank_row.bank_account_ref<>account_ref THEN RAISE EXCEPTION 'Bank transaction version conflict' USING ERRCODE='40001';END IF;
 IF EXISTS(SELECT 1 FROM reconciliation WHERE tenant_id=p_tenant AND entity_id=p_entity AND bank_account_ref=account_ref
   AND status='RECONCILED' AND statement_ending_date>=bank_row.transaction_date) THEN
   RAISE EXCEPTION 'Reopen the signed reconciliation before matching this bank transaction' USING ERRCODE='23514';
 END IF;
 SELECT * INTO sale FROM sales_receipt WHERE tenant_id=p_tenant AND entity_id=p_entity AND sales_receipt_id=p_sale FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Sales receipt not found in this company' USING ERRCODE='P0002';END IF;
 IF sale.version<>p_sale_version THEN RAISE EXCEPTION 'Sales receipt version conflict' USING ERRCODE='40001';END IF;
 IF sale.status<>'POSTED' OR sale.bank_member_ref<>account_ref OR sale.currency<>bank_row.currency OR sale.amount<>bank_row.amount
   OR abs(bank_row.transaction_date-sale.accounting_date)>31 THEN
   RAISE EXCEPTION 'Bank evidence must exactly match the posted cash sale' USING ERRCODE='23514';
 END IF;
 IF EXISTS(SELECT 1 FROM bank_match WHERE tenant_id=p_tenant AND entity_id=p_entity AND status='ACTIVE'
   AND (bank_source_id=p_bank OR sales_receipt_id=p_sale)) THEN
   RAISE EXCEPTION 'Bank transaction or sales receipt already has an active match' USING ERRCODE='23505';
 END IF;
 SELECT * INTO je FROM journal_entry WHERE tenant_id=p_tenant AND entity_id=p_entity AND journal_entry_id=sale.journal_entry_id FOR SHARE;
 IF NOT FOUND OR je.status<>'POSTED' OR je.period_id<>sale.period_id OR je.currency<>sale.currency OR je.journal_date<>sale.accounting_date THEN
   RAISE EXCEPTION 'Posted cash sale journal evidence is missing or changed' USING ERRCODE='23514';
 END IF;
 SELECT array_agg(jl.journal_line_id),array_agg(ll.ledger_line_id) INTO line_ids,ledger_ids
 FROM journal_line jl JOIN ledger_line ll ON ll.tenant_id=jl.tenant_id AND ll.entity_id=jl.entity_id AND ll.journal_entry_id=jl.journal_entry_id AND ll.journal_line_id=jl.journal_line_id
 WHERE jl.tenant_id=p_tenant AND jl.entity_id=p_entity AND jl.journal_entry_id=je.journal_entry_id
   AND jl.account_code=sale.cash_account_code AND jl.member_ref=account_ref AND jl.debit_amount=sale.amount AND jl.credit_amount=0
   AND ll.account_code=jl.account_code AND ll.member_ref=jl.member_ref AND ll.debit_amount=jl.debit_amount AND ll.credit_amount=jl.credit_amount AND ll.currency=sale.currency;
 IF COALESCE(cardinality(line_ids),0)<>1 THEN RAISE EXCEPTION 'Exactly one immutable posted cash ledger line is required' USING ERRCODE='23514';END IF;
 INSERT INTO bank_match(bank_match_id,tenant_id,entity_id,bank_source_id,sales_receipt_id,journal_entry_id,journal_line_id,ledger_line_id,
   candidate_rule_code,amount_delta,currency_match,date_delta_days,status,matched_by)
 VALUES(match_id,p_tenant,p_entity,p_bank,p_sale,je.journal_entry_id,line_ids[1],ledger_ids[1],
   'EXACT_POSTED_SALES_RECEIPT',0,true,bank_row.transaction_date-sale.accounting_date,'ACTIVE',actor);
 INSERT INTO source_link(tenant_id,entity_id,link_type,journal_entry_id,journal_line_id,ledger_line_id,bank_source_id,bank_match_id,created_by)
 VALUES(p_tenant,p_entity,'POSTED_SALES_RECEIPT_BANK_MATCH',je.journal_entry_id,line_ids[1],ledger_ids[1],p_bank,match_id,actor);
 response:=jsonb_build_object('bank_match_id',match_id,'bank_source_id',p_bank,'sales_receipt_id',p_sale,
   'journal_entry_id',je.journal_entry_id,'journal_line_id',line_ids[1],'ledger_line_id',ledger_ids[1],'status','ACTIVE','revision',0,'idempotent',false);
 INSERT INTO audit_event(tenant_id,entity_id,event_type,object_type,object_id,action,actor_id,actor_type,permission_used,request_id,correlation_id,idempotency_key,before_hash,after_hash,reason)
 VALUES(p_tenant,p_entity,'SALES_RECEIPT_BANK_MATCH_CREATED','BANK_MATCH',match_id,'CREATE_SALES_RECEIPT_BANK_MATCH',actor,'USER','BANK.MATCH.CREATE',p_key,p_key,p_key,refs_jsonb_hash(to_jsonb(bank_row)),refs_jsonb_hash(response),btrim(p_reason));
 payload:=response-'idempotent';
 INSERT INTO outbox_event(tenant_id,entity_id,aggregate_type,aggregate_id,event_type,payload,payload_hash)
 VALUES(p_tenant,p_entity,'BANK_MATCH',match_id,'SALES_RECEIPT_BANK_MATCH_CREATED',payload,refs_jsonb_hash(payload));
 UPDATE idempotency_receipt SET status='SUCCEEDED',response_status=201,response_body=response,completed_at=clock_timestamp()
 WHERE tenant_id=p_tenant AND operation_scope='SALES_RECEIPT_BANK_MATCH:'||p_entity AND idempotency_key=p_key;
 RETURN response;
END;
$$;
REVOKE ALL ON FUNCTION refs_sales_receipt_bank_match_hash(uuid,uuid,uuid,uuid,bigint,bigint,text) FROM PUBLIC;
REVOKE ALL ON FUNCTION refs_create_sales_receipt_bank_match(uuid,uuid,uuid,uuid,bigint,bigint,text,text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION refs_sales_receipt_bank_match_hash(uuid,uuid,uuid,uuid,bigint,bigint,text) TO refs_app;
GRANT EXECUTE ON FUNCTION refs_create_sales_receipt_bank_match(uuid,uuid,uuid,uuid,bigint,bigint,text,text,text) TO refs_app;
COMMIT;
