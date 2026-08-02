BEGIN;

CREATE OR REPLACE FUNCTION refs_apply_ap_payment_posted_occurrence() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE occ payment_occurrence; bill business_document; pending_total numeric(20,4); event_payload jsonb;
BEGIN
  IF TG_OP<>'UPDATE' OR NEW.status<>'POSTED' OR OLD.status='POSTED' THEN RETURN NEW; END IF;
  SELECT * INTO occ FROM payment_occurrence
    WHERE tenant_id=NEW.tenant_id AND entity_id=NEW.entity_id AND draft_journal_entry_id=NEW.journal_entry_id
    FOR UPDATE;
  IF NOT FOUND THEN RETURN NEW; END IF;
  IF occ.occurrence_kind<>'AP_PAYMENT' OR occ.status<>'DRAFT' OR occ.posted_journal_entry_id IS NOT NULL THEN
    RAISE EXCEPTION 'AP payment occurrence cannot be posted from current state' USING ERRCODE='23514';
  END IF;
  SELECT * INTO bill FROM business_document
    WHERE tenant_id=NEW.tenant_id AND entity_id=NEW.entity_id AND business_document_id=occ.business_document_id
    FOR UPDATE;
  IF NOT FOUND OR bill.document_kind<>'AP_BILL' OR bill.status NOT IN ('APPROVED','OPEN','PARTIALLY_PAID') OR bill.currency<>occ.currency OR bill.open_balance<=0 THEN
    RAISE EXCEPTION 'AP payment can only post against an open AP bill' USING ERRCODE='23514';
  END IF;
  PERFORM 1 FROM business_allocation
    WHERE tenant_id=NEW.tenant_id AND entity_id=NEW.entity_id AND payment_occurrence_id=occ.payment_occurrence_id
      AND status='PENDING'
    ORDER BY business_allocation_id FOR UPDATE;
  SELECT COALESCE(sum(amount),0) INTO pending_total FROM business_allocation
    WHERE tenant_id=NEW.tenant_id AND entity_id=NEW.entity_id AND payment_occurrence_id=occ.payment_occurrence_id
      AND status='PENDING';
  IF pending_total<>occ.amount OR pending_total>bill.open_balance THEN
    RAISE EXCEPTION 'AP payment pending allocation must equal occurrence amount and not exceed open balance' USING ERRCODE='23514';
  END IF;

  UPDATE business_document
    SET open_balance=bill.open_balance-occ.amount,
        status=CASE WHEN bill.open_balance-occ.amount=0 THEN 'PAID' ELSE 'PARTIALLY_PAID' END,
        version=version+1,
        updated_at=clock_timestamp()
    WHERE tenant_id=NEW.tenant_id AND entity_id=NEW.entity_id AND business_document_id=bill.business_document_id;
  UPDATE business_allocation
    SET status='ACTIVE',posted_journal_entry_id=NEW.journal_entry_id,version=version+1
    WHERE tenant_id=NEW.tenant_id AND entity_id=NEW.entity_id AND payment_occurrence_id=occ.payment_occurrence_id AND status='PENDING';
  UPDATE payment_occurrence
    SET status='POSTED',posted_journal_entry_id=NEW.journal_entry_id,version=version+1
    WHERE tenant_id=NEW.tenant_id AND entity_id=NEW.entity_id AND payment_occurrence_id=occ.payment_occurrence_id;
  INSERT INTO audit_event(tenant_id,entity_id,event_type,object_type,object_id,action,actor_id,actor_type,permission_used,request_id,correlation_id,idempotency_key,after_hash,reason)
    VALUES(NEW.tenant_id,NEW.entity_id,'AP_PAYMENT_POSTED','PAYMENT_OCCURRENCE',occ.payment_occurrence_id,'POST_AP_PAYMENT',NEW.posted_by,'USER','GL.JE.POST',occ.idempotency_key,occ.idempotency_key,occ.idempotency_key,occ.request_hash,'Activated AP payment allocation');
  event_payload:=jsonb_build_object('payment_occurrence_id',occ.payment_occurrence_id,'business_document_id',bill.business_document_id,'journal_entry_id',NEW.journal_entry_id,'status','POSTED','open_balance',bill.open_balance-occ.amount);
  INSERT INTO outbox_event(tenant_id,entity_id,aggregate_type,aggregate_id,event_type,payload,payload_hash)
    VALUES(NEW.tenant_id,NEW.entity_id,'PAYMENT_OCCURRENCE',occ.payment_occurrence_id,'AP_PAYMENT_POSTED',event_payload,refs_jsonb_hash(event_payload));
  RETURN NEW;
END;
$$;

REVOKE EXECUTE ON FUNCTION refs_apply_ap_payment_posted_occurrence() FROM PUBLIC;
DROP TRIGGER IF EXISTS payment_occurrence_posted_reducer ON journal_entry;
CREATE TRIGGER payment_occurrence_posted_reducer
  AFTER UPDATE OF status ON journal_entry
  FOR EACH ROW EXECUTE FUNCTION refs_apply_ap_payment_posted_occurrence();

COMMIT;
