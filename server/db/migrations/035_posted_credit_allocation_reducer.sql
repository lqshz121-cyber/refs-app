BEGIN;

-- Applying a vendor credit is intentionally allowed after its JE is POSTED.
-- Activate that allocation atomically; the journal-post trigger cannot see a
-- row that did not exist yet.
CREATE OR REPLACE FUNCTION refs_activate_posted_credit_allocation() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE adj business_adjustment; bill business_document; actor uuid;
BEGIN
  IF TG_OP<>'INSERT' OR NEW.status<>'PENDING' THEN RETURN NEW; END IF;
  SELECT * INTO adj FROM business_adjustment
   WHERE tenant_id=NEW.tenant_id AND entity_id=NEW.entity_id
     AND business_adjustment_id=NEW.business_adjustment_id FOR UPDATE;
  IF NOT FOUND OR adj.adjustment_kind<>'AP_VENDOR_CREDIT' OR adj.status<>'POSTED'
     OR adj.posted_journal_entry_id IS NULL THEN RETURN NEW; END IF;
  SELECT * INTO bill FROM business_document
   WHERE tenant_id=NEW.tenant_id AND entity_id=NEW.entity_id
     AND business_document_id=NEW.business_document_id FOR UPDATE;
  IF NOT FOUND OR bill.document_kind<>'AP_BILL'
     OR bill.currency<>adj.currency OR bill.status NOT IN ('APPROVED','OPEN','PARTIALLY_PAID')
     OR NEW.amount<=0 OR NEW.amount>bill.open_balance THEN
    RAISE EXCEPTION 'AP vendor credit allocation cannot be activated for target bill' USING ERRCODE='23514';
  END IF;
  actor:=refs_current_actor();
  UPDATE business_document SET posted_credit_adjustments=posted_credit_adjustments+NEW.amount,
    open_balance=open_balance-NEW.amount,
    status=CASE WHEN open_balance-NEW.amount=0 THEN 'PAID' ELSE 'PARTIALLY_PAID' END,
    version=version+1,updated_at=clock_timestamp()
   WHERE tenant_id=NEW.tenant_id AND entity_id=NEW.entity_id AND business_document_id=NEW.business_document_id;
  UPDATE business_allocation SET status='ACTIVE',posted_journal_entry_id=adj.posted_journal_entry_id,
    version=version+1 WHERE tenant_id=NEW.tenant_id AND entity_id=NEW.entity_id
    AND business_allocation_id=NEW.business_allocation_id AND status='PENDING';
  INSERT INTO audit_event(tenant_id,entity_id,event_type,object_type,object_id,action,actor_id,actor_type,permission_used,request_id,correlation_id,idempotency_key,after_hash,reason)
    VALUES(NEW.tenant_id,NEW.entity_id,'AP_VENDOR_CREDIT_ALLOCATION_ACTIVATED','BUSINESS_ALLOCATION',NEW.business_allocation_id,'APPLY_AP_VENDOR_CREDIT',actor,'USER','AP.VENDOR_CREDIT.APPLY',adj.idempotency_key,adj.idempotency_key,adj.idempotency_key,refs_jsonb_hash(to_jsonb(NEW)),'Applied after credit posting');
  RETURN NEW;
END;
$$;
REVOKE EXECUTE ON FUNCTION refs_activate_posted_credit_allocation() FROM PUBLIC;
DROP TRIGGER IF EXISTS posted_credit_allocation_reducer ON business_allocation;
CREATE TRIGGER posted_credit_allocation_reducer AFTER INSERT ON business_allocation
FOR EACH ROW EXECUTE FUNCTION refs_activate_posted_credit_allocation();
COMMIT;
