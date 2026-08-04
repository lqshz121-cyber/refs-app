BEGIN;
CREATE OR REPLACE FUNCTION refs_apply_ar_credit_memo_posted() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE adj business_adjustment; pending_total numeric(20,4); impacted bigint; event_payload jsonb;
BEGIN
 IF TG_OP<>'UPDATE' OR NEW.status<>'POSTED' OR OLD.status='POSTED' THEN RETURN NEW; END IF;
 SELECT * INTO adj FROM business_adjustment WHERE tenant_id=NEW.tenant_id AND entity_id=NEW.entity_id AND draft_journal_entry_id=NEW.journal_entry_id FOR UPDATE;
 IF NOT FOUND OR adj.adjustment_kind<>'AR_CREDIT_MEMO' THEN RETURN NEW; END IF;
 IF adj.status IN ('POSTED','CANCELLED','REJECTED') THEN RAISE EXCEPTION 'AR credit memo cannot be posted from current state' USING ERRCODE='23514'; END IF;
 PERFORM 1 FROM business_allocation WHERE tenant_id=NEW.tenant_id AND entity_id=NEW.entity_id AND business_adjustment_id=adj.business_adjustment_id AND status='PENDING' ORDER BY business_document_id,business_allocation_id FOR UPDATE;
 SELECT COALESCE(sum(amount),0) INTO pending_total FROM business_allocation WHERE tenant_id=NEW.tenant_id AND entity_id=NEW.entity_id AND business_adjustment_id=adj.business_adjustment_id AND status IN ('PENDING','ACTIVE');
 IF pending_total>adj.amount THEN RAISE EXCEPTION 'AR credit memo allocations exceed credit amount' USING ERRCODE='23514'; END IF;
 IF EXISTS (SELECT 1 FROM (SELECT business_document_id,sum(amount) amount FROM business_allocation WHERE tenant_id=NEW.tenant_id AND entity_id=NEW.entity_id AND business_adjustment_id=adj.business_adjustment_id AND status='PENDING' GROUP BY business_document_id) p JOIN business_document d ON d.tenant_id=NEW.tenant_id AND d.entity_id=NEW.entity_id AND d.business_document_id=p.business_document_id WHERE d.document_kind<>'AR_INVOICE' OR d.currency<>adj.currency OR p.amount>d.open_balance OR d.status NOT IN ('APPROVED','OPEN','PARTIALLY_PAID')) THEN RAISE EXCEPTION 'AR credit memo allocation cannot be activated for target invoice' USING ERRCODE='23514'; END IF;
 WITH pending AS (SELECT business_document_id,sum(amount) amount FROM business_allocation WHERE tenant_id=NEW.tenant_id AND entity_id=NEW.entity_id AND business_adjustment_id=adj.business_adjustment_id AND status='PENDING' GROUP BY business_document_id)
 UPDATE business_document d SET posted_credit_adjustments=d.posted_credit_adjustments+p.amount,open_balance=d.open_balance-p.amount,status=CASE WHEN d.open_balance-p.amount=0 THEN 'PAID' ELSE 'PARTIALLY_PAID' END,version=d.version+1,updated_at=clock_timestamp() FROM pending p WHERE d.tenant_id=NEW.tenant_id AND d.entity_id=NEW.entity_id AND d.business_document_id=p.business_document_id;
 GET DIAGNOSTICS impacted=ROW_COUNT;
 UPDATE business_allocation SET status='ACTIVE',posted_journal_entry_id=NEW.journal_entry_id,version=version+1 WHERE tenant_id=NEW.tenant_id AND entity_id=NEW.entity_id AND business_adjustment_id=adj.business_adjustment_id AND status='PENDING';
 UPDATE business_adjustment SET status='POSTED',posted_journal_entry_id=NEW.journal_entry_id,version=version+1 WHERE tenant_id=NEW.tenant_id AND entity_id=NEW.entity_id AND business_adjustment_id=adj.business_adjustment_id;
 INSERT INTO audit_event(tenant_id,entity_id,event_type,object_type,object_id,action,actor_id,actor_type,permission_used,request_id,correlation_id,idempotency_key,after_hash,reason) VALUES(NEW.tenant_id,NEW.entity_id,'AR_CREDIT_MEMO_POSTED','BUSINESS_ADJUSTMENT',adj.business_adjustment_id,'POST_AR_CREDIT_MEMO',NEW.posted_by,'USER','GL.JE.POST',adj.idempotency_key,adj.idempotency_key,adj.idempotency_key,adj.request_hash,'Activated pending invoice allocations: '||impacted);
 event_payload:=jsonb_build_object('business_adjustment_id',adj.business_adjustment_id,'journal_entry_id',NEW.journal_entry_id,'activated_document_count',impacted,'status','POSTED'); INSERT INTO outbox_event(tenant_id,entity_id,aggregate_type,aggregate_id,event_type,payload,payload_hash) VALUES(NEW.tenant_id,NEW.entity_id,'BUSINESS_ADJUSTMENT',adj.business_adjustment_id,'AR_CREDIT_MEMO_POSTED',event_payload,refs_jsonb_hash(event_payload));
 RETURN NEW;
END; $$;
REVOKE EXECUTE ON FUNCTION refs_apply_ar_credit_memo_posted() FROM PUBLIC;
DROP TRIGGER IF EXISTS ar_credit_memo_posted_reducer ON journal_entry;
CREATE TRIGGER ar_credit_memo_posted_reducer AFTER UPDATE OF status ON journal_entry FOR EACH ROW EXECUTE FUNCTION refs_apply_ar_credit_memo_posted();
COMMIT;
