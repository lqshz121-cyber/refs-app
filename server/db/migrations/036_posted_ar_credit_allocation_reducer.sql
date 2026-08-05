BEGIN;
CREATE OR REPLACE FUNCTION refs_activate_posted_ar_credit_allocation() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE adj business_adjustment; doc business_document; actor text;
BEGIN
 IF TG_OP<>'INSERT' OR NEW.status<>'PENDING' THEN RETURN NEW; END IF;
 SELECT * INTO adj FROM business_adjustment WHERE tenant_id=NEW.tenant_id AND entity_id=NEW.entity_id AND business_adjustment_id=NEW.business_adjustment_id FOR UPDATE;
 IF NOT FOUND OR adj.adjustment_kind<>'AR_CREDIT_MEMO' OR adj.status<>'POSTED' OR adj.posted_journal_entry_id IS NULL THEN RETURN NEW; END IF;
 SELECT * INTO doc FROM business_document WHERE tenant_id=NEW.tenant_id AND entity_id=NEW.entity_id AND business_document_id=NEW.business_document_id FOR UPDATE;
 IF NOT FOUND OR doc.document_kind<>'AR_INVOICE' OR doc.currency<>adj.currency OR doc.status NOT IN ('APPROVED','OPEN','PARTIALLY_PAID') OR NEW.amount<=0 OR NEW.amount>doc.open_balance THEN
   RAISE EXCEPTION 'AR credit memo allocation cannot be activated for target invoice' USING ERRCODE='23514';
 END IF;
 actor:=refs_current_actor();
 UPDATE business_document SET posted_credit_adjustments=posted_credit_adjustments+NEW.amount,open_balance=open_balance-NEW.amount,status=CASE WHEN open_balance-NEW.amount=0 THEN 'PAID' ELSE 'PARTIALLY_PAID' END,version=version+1,updated_at=clock_timestamp()
  WHERE tenant_id=NEW.tenant_id AND entity_id=NEW.entity_id AND business_document_id=NEW.business_document_id;
 UPDATE business_allocation SET status='ACTIVE',posted_journal_entry_id=adj.posted_journal_entry_id,version=version+1 WHERE tenant_id=NEW.tenant_id AND entity_id=NEW.entity_id AND business_allocation_id=NEW.business_allocation_id AND status='PENDING';
 INSERT INTO audit_event(tenant_id,entity_id,event_type,object_type,object_id,action,actor_id,actor_type,permission_used,request_id,correlation_id,idempotency_key,after_hash,reason)
  VALUES(NEW.tenant_id,NEW.entity_id,'AR_CREDIT_MEMO_ALLOCATION_ACTIVATED','BUSINESS_ALLOCATION',NEW.business_allocation_id,'APPLY_AR_CREDIT_MEMO',actor,'USER','AR.CREDIT_MEMO.APPLY',adj.idempotency_key,adj.idempotency_key,adj.idempotency_key,refs_jsonb_hash(to_jsonb(NEW)),'Applied after credit posting');
 RETURN NEW;
END; $$;
REVOKE EXECUTE ON FUNCTION refs_activate_posted_ar_credit_allocation() FROM PUBLIC;
DROP TRIGGER IF EXISTS posted_ar_credit_allocation_reducer ON business_allocation;
CREATE TRIGGER posted_ar_credit_allocation_reducer AFTER INSERT ON business_allocation FOR EACH ROW EXECUTE FUNCTION refs_activate_posted_ar_credit_allocation();
COMMIT;
