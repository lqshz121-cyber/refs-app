BEGIN;
CREATE OR REPLACE FUNCTION refs_apply_ar_refund_posted() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE adj business_adjustment; source_adj business_adjustment; reserved numeric(20,4); event_payload jsonb;
BEGIN
 IF TG_OP<>'UPDATE' OR NEW.status<>'POSTED' OR OLD.status='POSTED' THEN RETURN NEW; END IF;
 SELECT * INTO adj FROM business_adjustment WHERE tenant_id=NEW.tenant_id AND entity_id=NEW.entity_id AND draft_journal_entry_id=NEW.journal_entry_id FOR UPDATE;
 IF NOT FOUND OR adj.adjustment_kind<>'AR_REFUND' THEN RETURN NEW; END IF;
 IF adj.status IN ('POSTED','CANCELLED','REJECTED') THEN RAISE EXCEPTION 'AR refund cannot be posted from current state' USING ERRCODE='23514'; END IF;
 SELECT * INTO source_adj FROM business_adjustment WHERE tenant_id=NEW.tenant_id AND entity_id=NEW.entity_id AND business_adjustment_id=adj.source_adjustment_id FOR UPDATE;
 IF NOT FOUND OR source_adj.adjustment_kind<>'AR_CREDIT_MEMO' OR source_adj.status<>'POSTED' THEN RAISE EXCEPTION 'AR refund source credit must be posted' USING ERRCODE='23514'; END IF;
 SELECT COALESCE(sum(amount),0) INTO reserved FROM business_adjustment WHERE tenant_id=NEW.tenant_id AND entity_id=NEW.entity_id AND adjustment_kind='AR_REFUND' AND source_adjustment_id=source_adj.business_adjustment_id AND status IN ('DRAFT','PENDING_REVIEW','PENDING_APPROVAL','APPROVED_PENDING_POST','POSTED');
 IF reserved>source_adj.amount THEN RAISE EXCEPTION 'AR refunds exceed available posted credit' USING ERRCODE='23514'; END IF;
 UPDATE business_adjustment SET status='POSTED',posted_journal_entry_id=NEW.journal_entry_id,version=version+1 WHERE tenant_id=NEW.tenant_id AND entity_id=NEW.entity_id AND business_adjustment_id=adj.business_adjustment_id;
 INSERT INTO audit_event(tenant_id,entity_id,event_type,object_type,object_id,action,actor_id,actor_type,permission_used,request_id,correlation_id,idempotency_key,after_hash,reason) VALUES(NEW.tenant_id,NEW.entity_id,'AR_REFUND_POSTED','BUSINESS_ADJUSTMENT',adj.business_adjustment_id,'POST_AR_REFUND',NEW.posted_by,'USER','GL.JE.POST',adj.idempotency_key,adj.idempotency_key,adj.idempotency_key,adj.request_hash,'Refund posted against available customer credit');
 event_payload:=jsonb_build_object('business_adjustment_id',adj.business_adjustment_id,'source_adjustment_id',source_adj.business_adjustment_id,'journal_entry_id',NEW.journal_entry_id,'status','POSTED'); INSERT INTO outbox_event(tenant_id,entity_id,aggregate_type,aggregate_id,event_type,payload,payload_hash) VALUES(NEW.tenant_id,NEW.entity_id,'BUSINESS_ADJUSTMENT',adj.business_adjustment_id,'AR_REFUND_POSTED',event_payload,refs_jsonb_hash(event_payload));
 RETURN NEW;
END; $$;
REVOKE EXECUTE ON FUNCTION refs_apply_ar_refund_posted() FROM PUBLIC;
DROP TRIGGER IF EXISTS ar_refund_posted_reducer ON journal_entry;
CREATE TRIGGER ar_refund_posted_reducer AFTER UPDATE OF status ON journal_entry FOR EACH ROW EXECUTE FUNCTION refs_apply_ar_refund_posted();
COMMIT;
