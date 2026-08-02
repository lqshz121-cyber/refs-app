BEGIN;

CREATE OR REPLACE FUNCTION refs_apply_ar_receipt_reversal_posted() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE adj business_adjustment; occ payment_occurrence; invoice business_document; active_amount numeric(20,4); event_payload jsonb;
BEGIN
  IF TG_OP<>'UPDATE' OR NEW.status<>'POSTED' OR OLD.status='POSTED' THEN RETURN NEW; END IF;
  SELECT * INTO adj FROM business_adjustment
    WHERE tenant_id=NEW.tenant_id AND entity_id=NEW.entity_id AND draft_journal_entry_id=NEW.journal_entry_id
    FOR UPDATE;
  IF NOT FOUND THEN RETURN NEW; END IF;
  IF adj.adjustment_kind<>'AR_RECEIPT_REVERSAL' OR adj.status<>'DRAFT' OR adj.posted_journal_entry_id IS NOT NULL THEN
    RAISE EXCEPTION 'AR receipt reversal cannot be posted from current state' USING ERRCODE='23514';
  END IF;
  SELECT * INTO occ FROM payment_occurrence
    WHERE tenant_id=NEW.tenant_id AND entity_id=NEW.entity_id AND payment_occurrence_id=adj.source_occurrence_id
    FOR UPDATE;
  IF NOT FOUND OR occ.occurrence_kind<>'AR_RECEIPT' OR occ.status<>'POSTED' OR occ.amount<>adj.amount OR occ.currency<>adj.currency THEN
    RAISE EXCEPTION 'AR receipt reversal source occurrence is not Posted or does not match' USING ERRCODE='23514';
  END IF;
  SELECT * INTO invoice FROM business_document
    WHERE tenant_id=NEW.tenant_id AND entity_id=NEW.entity_id AND business_document_id=occ.business_document_id
    FOR UPDATE;
  IF NOT FOUND OR invoice.document_kind<>'AR_INVOICE' OR invoice.currency<>occ.currency THEN
    RAISE EXCEPTION 'AR receipt reversal invoice is missing or mismatched' USING ERRCODE='23514';
  END IF;
  PERFORM 1 FROM business_allocation
    WHERE tenant_id=NEW.tenant_id AND entity_id=NEW.entity_id AND payment_occurrence_id=occ.payment_occurrence_id AND status='ACTIVE'
    ORDER BY business_allocation_id FOR UPDATE;
  SELECT COALESCE(sum(amount),0) INTO active_amount FROM business_allocation
    WHERE tenant_id=NEW.tenant_id AND entity_id=NEW.entity_id AND payment_occurrence_id=occ.payment_occurrence_id AND status='ACTIVE';
  IF active_amount<>occ.amount THEN RAISE EXCEPTION 'AR receipt reversal requires one fully active original allocation' USING ERRCODE='23514'; END IF;
  UPDATE business_allocation SET status='REVERSED',version=version+1
    WHERE tenant_id=NEW.tenant_id AND entity_id=NEW.entity_id AND payment_occurrence_id=occ.payment_occurrence_id AND status='ACTIVE';
  UPDATE business_document SET open_balance=invoice.open_balance+occ.amount,
    status=CASE WHEN invoice.open_balance+occ.amount>=invoice.gross_amount THEN 'OPEN' ELSE 'PARTIALLY_PAID' END,
    version=version+1,updated_at=clock_timestamp()
    WHERE tenant_id=NEW.tenant_id AND entity_id=NEW.entity_id AND business_document_id=invoice.business_document_id;
  UPDATE payment_occurrence SET status='REVERSED',version=version+1
    WHERE tenant_id=NEW.tenant_id AND entity_id=NEW.entity_id AND payment_occurrence_id=occ.payment_occurrence_id;
  UPDATE business_adjustment SET status='POSTED',posted_journal_entry_id=NEW.journal_entry_id,version=version+1
    WHERE tenant_id=NEW.tenant_id AND entity_id=NEW.entity_id AND business_adjustment_id=adj.business_adjustment_id;
  INSERT INTO audit_event(tenant_id,entity_id,event_type,object_type,object_id,action,actor_id,actor_type,permission_used,request_id,correlation_id,idempotency_key,after_hash,reason)
    VALUES(NEW.tenant_id,NEW.entity_id,'AR_RECEIPT_REVERSAL_POSTED','BUSINESS_ADJUSTMENT',adj.business_adjustment_id,'POST_AR_RECEIPT_REVERSAL',NEW.posted_by,'USER','GL.JE.POST',adj.idempotency_key,adj.idempotency_key,adj.idempotency_key,adj.request_hash,adj.reason);
  event_payload:=jsonb_build_object('business_adjustment_id',adj.business_adjustment_id,'source_occurrence_id',occ.payment_occurrence_id,'business_document_id',invoice.business_document_id,'journal_entry_id',NEW.journal_entry_id,'status','POSTED','open_balance',invoice.open_balance+occ.amount);
  INSERT INTO outbox_event(tenant_id,entity_id,aggregate_type,aggregate_id,event_type,payload,payload_hash)
    VALUES(NEW.tenant_id,NEW.entity_id,'BUSINESS_ADJUSTMENT',adj.business_adjustment_id,'AR_RECEIPT_REVERSAL_POSTED',event_payload,refs_jsonb_hash(event_payload));
  RETURN NEW;
END;
$$;

REVOKE EXECUTE ON FUNCTION refs_apply_ar_receipt_reversal_posted() FROM PUBLIC;
DROP TRIGGER IF EXISTS ar_receipt_reversal_posted_reducer ON journal_entry;
CREATE TRIGGER ar_receipt_reversal_posted_reducer AFTER UPDATE OF status ON journal_entry
  FOR EACH ROW EXECUTE FUNCTION refs_apply_ar_receipt_reversal_posted();

COMMIT;
