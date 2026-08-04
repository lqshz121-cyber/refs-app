BEGIN;

CREATE OR REPLACE FUNCTION refs_create_ar_refund(p_tenant uuid,p_entity uuid,p_period uuid,p_source_adjustment uuid,p_refund_number text,p_refund_date date,p_cash_account text,p_amount numeric,p_reason text,p_idempotency_key text,p_request_hash text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE actor text:=refs_current_actor(); receipt idempotency_receipt; source_adj business_adjustment; period_row accounting_period; entity_row entity; computed_hash text; refunded numeric(20,4); allocated numeric(20,4); journal_id uuid:=gen_random_uuid(); adjustment_id uuid:=gen_random_uuid(); response jsonb; event_payload jsonb;
BEGIN
 PERFORM refs_assert_scope(p_tenant,p_entity,'AR.REFUND.CREATE'); IF actor IS NULL THEN RAISE EXCEPTION 'Authenticated actor missing' USING ERRCODE='42501'; END IF;
 computed_hash:=refs_ar_refund_hash(p_tenant,p_entity,p_period,p_source_adjustment,p_refund_number,p_refund_date,p_cash_account,p_amount,p_reason); IF p_request_hash<>computed_hash THEN RAISE EXCEPTION 'AR refund request hash is not canonical' USING ERRCODE='22023'; END IF;
 IF COALESCE(length(btrim(p_refund_number)),0)=0 OR COALESCE(length(btrim(p_cash_account)),0)=0 OR p_amount<=0 OR COALESCE(length(btrim(p_reason)),0)<8 THEN RAISE EXCEPTION 'AR refund requires valid number, cash account, amount and reason' USING ERRCODE='22023'; END IF;
 INSERT INTO idempotency_receipt(tenant_id,operation_scope,idempotency_key,request_hash,status,actor_id) VALUES(p_tenant,'AR_REFUND:'||p_entity,p_idempotency_key,p_request_hash,'IN_PROGRESS',actor) ON CONFLICT DO NOTHING;
 SELECT * INTO receipt FROM idempotency_receipt WHERE tenant_id=p_tenant AND operation_scope='AR_REFUND:'||p_entity AND idempotency_key=p_idempotency_key FOR UPDATE;
 IF receipt.request_hash<>p_request_hash THEN RAISE EXCEPTION 'Idempotency key reused with a different request' USING ERRCODE='23505'; END IF; IF receipt.status='SUCCEEDED' THEN RETURN receipt.response_body||jsonb_build_object('idempotent',true); END IF;
 SELECT * INTO period_row FROM accounting_period WHERE tenant_id=p_tenant AND entity_id=p_entity AND period_id=p_period AND status='OPEN' AND p_refund_date BETWEEN starts_on AND ends_on FOR SHARE; IF NOT FOUND THEN RAISE EXCEPTION 'AR refund period must be OPEN and own the refund date' USING ERRCODE='55000'; END IF;
 SELECT * INTO entity_row FROM entity WHERE tenant_id=p_tenant AND entity_id=p_entity FOR SHARE; IF NOT FOUND THEN RAISE EXCEPTION 'Entity not found' USING ERRCODE='23503'; END IF;
 SELECT * INTO source_adj FROM business_adjustment WHERE tenant_id=p_tenant AND entity_id=p_entity AND business_adjustment_id=p_source_adjustment FOR UPDATE;
 IF NOT FOUND OR source_adj.adjustment_kind<>'AR_CREDIT_MEMO' OR source_adj.status<>'POSTED' OR source_adj.posted_journal_entry_id IS NULL THEN RAISE EXCEPTION 'Refund requires a posted customer credit memo' USING ERRCODE='23514'; END IF;
 PERFORM 1 FROM business_allocation WHERE tenant_id=p_tenant AND entity_id=p_entity AND business_adjustment_id=p_source_adjustment AND status IN ('PENDING','ACTIVE') FOR UPDATE;
 SELECT COALESCE(sum(amount),0) INTO allocated FROM business_allocation WHERE tenant_id=p_tenant AND entity_id=p_entity AND business_adjustment_id=p_source_adjustment AND status IN ('PENDING','ACTIVE');
 SELECT COALESCE(sum(amount),0) INTO refunded FROM business_adjustment WHERE tenant_id=p_tenant AND entity_id=p_entity AND adjustment_kind='AR_REFUND' AND source_adjustment_id=p_source_adjustment AND status IN ('DRAFT','PENDING_REVIEW','PENDING_APPROVAL','APPROVED_PENDING_POST','POSTED');
 IF allocated+refunded+p_amount>source_adj.amount THEN RAISE EXCEPTION 'AR refund exceeds available posted credit' USING ERRCODE='23514'; END IF;
 INSERT INTO journal_entry(journal_entry_id,tenant_id,entity_id,period_id,journal_number,journal_type,status,journal_date,currency,description,created_by) VALUES(journal_id,p_tenant,p_entity,p_period,btrim(p_refund_number),'AUTO','DRAFT',p_refund_date,entity_row.base_currency,'Refund '||btrim(p_refund_number),actor);
 INSERT INTO journal_line(tenant_id,entity_id,period_id,journal_entry_id,line_no,account_code,debit_amount,credit_amount,member_ref,description,dimensions) VALUES(p_tenant,p_entity,p_period,journal_id,1,'220000',p_amount,0,NULL,'Customer refund','{}'::jsonb),(p_tenant,p_entity,p_period,journal_id,2,btrim(p_cash_account),0,p_amount,NULL,'Cash refund','{}'::jsonb);
 INSERT INTO business_adjustment(business_adjustment_id,tenant_id,entity_id,adjustment_kind,source_adjustment_id,amount,currency,accounting_date,period_id,reason,status,draft_journal_entry_id,idempotency_key,request_hash,created_by) VALUES(adjustment_id,p_tenant,p_entity,'AR_REFUND',p_source_adjustment,p_amount,entity_row.base_currency,p_refund_date,p_period,p_reason,'DRAFT',journal_id,p_idempotency_key,p_request_hash,actor);
 response:=jsonb_build_object('business_adjustment_id',adjustment_id,'journal_entry_id',journal_id,'source_adjustment_id',p_source_adjustment,'status','DRAFT','revision',0,'idempotent',false);
 INSERT INTO audit_event(tenant_id,entity_id,event_type,object_type,object_id,action,actor_id,actor_type,permission_used,request_id,correlation_id,idempotency_key,after_hash,reason) VALUES(p_tenant,p_entity,'AR_REFUND_DRAFT_CREATED','BUSINESS_ADJUSTMENT',adjustment_id,'CREATE_AR_REFUND',actor,'USER','AR.REFUND.CREATE',p_idempotency_key,p_idempotency_key,p_idempotency_key,p_request_hash,p_reason);
 event_payload:=jsonb_build_object('business_adjustment_id',adjustment_id,'source_adjustment_id',p_source_adjustment,'journal_entry_id',journal_id,'status','DRAFT'); INSERT INTO outbox_event(tenant_id,entity_id,aggregate_type,aggregate_id,event_type,payload,payload_hash) VALUES(p_tenant,p_entity,'BUSINESS_ADJUSTMENT',adjustment_id,'AR_REFUND_DRAFT_CREATED',event_payload,refs_jsonb_hash(event_payload));
 UPDATE idempotency_receipt SET status='SUCCEEDED',response_status=201,response_body=response,completed_at=clock_timestamp() WHERE tenant_id=p_tenant AND operation_scope='AR_REFUND:'||p_entity AND idempotency_key=p_idempotency_key; RETURN response;
END; $$;

CREATE OR REPLACE FUNCTION refs_apply_ar_refund_posted() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE adj business_adjustment; source_adj business_adjustment; reserved numeric(20,4); allocated numeric(20,4); event_payload jsonb;
BEGIN
 IF TG_OP<>'UPDATE' OR NEW.status<>'POSTED' OR OLD.status='POSTED' THEN RETURN NEW; END IF;
 SELECT * INTO adj FROM business_adjustment WHERE tenant_id=NEW.tenant_id AND entity_id=NEW.entity_id AND draft_journal_entry_id=NEW.journal_entry_id FOR UPDATE;
 IF NOT FOUND OR adj.adjustment_kind<>'AR_REFUND' THEN RETURN NEW; END IF;
 IF adj.status IN ('POSTED','CANCELLED','REJECTED') THEN RAISE EXCEPTION 'AR refund cannot be posted from current state' USING ERRCODE='23514'; END IF;
 SELECT * INTO source_adj FROM business_adjustment WHERE tenant_id=NEW.tenant_id AND entity_id=NEW.entity_id AND business_adjustment_id=adj.source_adjustment_id FOR UPDATE;
 IF NOT FOUND OR source_adj.adjustment_kind<>'AR_CREDIT_MEMO' OR source_adj.status<>'POSTED' THEN RAISE EXCEPTION 'AR refund source credit must be posted' USING ERRCODE='23514'; END IF;
 PERFORM 1 FROM business_allocation WHERE tenant_id=NEW.tenant_id AND entity_id=NEW.entity_id AND business_adjustment_id=source_adj.business_adjustment_id AND status IN ('PENDING','ACTIVE') FOR UPDATE;
 SELECT COALESCE(sum(amount),0) INTO allocated FROM business_allocation WHERE tenant_id=NEW.tenant_id AND entity_id=NEW.entity_id AND business_adjustment_id=source_adj.business_adjustment_id AND status IN ('PENDING','ACTIVE');
 SELECT COALESCE(sum(amount),0) INTO reserved FROM business_adjustment WHERE tenant_id=NEW.tenant_id AND entity_id=NEW.entity_id AND adjustment_kind='AR_REFUND' AND source_adjustment_id=source_adj.business_adjustment_id AND status IN ('DRAFT','PENDING_REVIEW','PENDING_APPROVAL','APPROVED_PENDING_POST','POSTED');
 IF allocated+reserved>source_adj.amount THEN RAISE EXCEPTION 'AR refunds exceed available posted credit' USING ERRCODE='23514'; END IF;
 UPDATE business_adjustment SET status='POSTED',posted_journal_entry_id=NEW.journal_entry_id,version=version+1 WHERE tenant_id=NEW.tenant_id AND entity_id=NEW.entity_id AND business_adjustment_id=adj.business_adjustment_id;
 INSERT INTO audit_event(tenant_id,entity_id,event_type,object_type,object_id,action,actor_id,actor_type,permission_used,request_id,correlation_id,idempotency_key,after_hash,reason) VALUES(NEW.tenant_id,NEW.entity_id,'AR_REFUND_POSTED','BUSINESS_ADJUSTMENT',adj.business_adjustment_id,'POST_AR_REFUND',NEW.posted_by,'USER','GL.JE.POST',adj.idempotency_key,adj.idempotency_key,adj.idempotency_key,adj.request_hash,'Refund posted against available customer credit');
 event_payload:=jsonb_build_object('business_adjustment_id',adj.business_adjustment_id,'source_adjustment_id',source_adj.business_adjustment_id,'journal_entry_id',NEW.journal_entry_id,'status','POSTED'); INSERT INTO outbox_event(tenant_id,entity_id,aggregate_type,aggregate_id,event_type,payload,payload_hash) VALUES(NEW.tenant_id,NEW.entity_id,'BUSINESS_ADJUSTMENT',adj.business_adjustment_id,'AR_REFUND_POSTED',event_payload,refs_jsonb_hash(event_payload));
 RETURN NEW;
END; $$;

REVOKE EXECUTE ON FUNCTION refs_create_ar_refund(uuid,uuid,uuid,uuid,text,date,text,numeric,text,text,text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION refs_apply_ar_refund_posted() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION refs_create_ar_refund(uuid,uuid,uuid,uuid,text,date,text,numeric,text,text,text) TO refs_app;
COMMIT;
