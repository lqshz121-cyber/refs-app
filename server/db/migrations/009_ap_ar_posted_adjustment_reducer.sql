BEGIN;

CREATE OR REPLACE FUNCTION refs_apply_ap_ar_posted_adjustment() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE adj business_adjustment; pending_total numeric(20,4); impacted bigint; event_payload jsonb;
BEGIN
  IF TG_OP<>'UPDATE' OR NEW.status<>'POSTED' OR OLD.status='POSTED' THEN RETURN NEW; END IF;
  SELECT * INTO adj FROM business_adjustment
    WHERE tenant_id=NEW.tenant_id AND entity_id=NEW.entity_id AND draft_journal_entry_id=NEW.journal_entry_id
    FOR UPDATE;
  IF NOT FOUND THEN RETURN NEW; END IF;
  IF adj.status IN ('POSTED','CANCELLED','REJECTED') THEN
    RAISE EXCEPTION 'Business adjustment cannot be posted from current state' USING ERRCODE='23514';
  END IF;

  IF adj.adjustment_kind='AP_VENDOR_CREDIT' THEN
    PERFORM 1 FROM business_allocation
      WHERE tenant_id=NEW.tenant_id AND entity_id=NEW.entity_id AND business_adjustment_id=adj.business_adjustment_id
        AND status='PENDING'
      ORDER BY business_document_id,business_allocation_id FOR UPDATE;
    SELECT COALESCE(sum(amount),0) INTO pending_total FROM business_allocation
      WHERE tenant_id=NEW.tenant_id AND entity_id=NEW.entity_id AND business_adjustment_id=adj.business_adjustment_id
        AND status IN ('PENDING','ACTIVE');
    IF pending_total>adj.amount THEN RAISE EXCEPTION 'AP vendor credit allocations exceed credit amount' USING ERRCODE='23514'; END IF;
    IF EXISTS (
      SELECT 1
      FROM (
        SELECT business_document_id,sum(amount) AS amount
        FROM business_allocation
        WHERE tenant_id=NEW.tenant_id AND entity_id=NEW.entity_id AND business_adjustment_id=adj.business_adjustment_id AND status='PENDING'
        GROUP BY business_document_id
      ) pending
      JOIN business_document bd ON bd.tenant_id=NEW.tenant_id AND bd.entity_id=NEW.entity_id AND bd.business_document_id=pending.business_document_id
      WHERE bd.document_kind<>'AP_BILL' OR bd.currency<>adj.currency OR pending.amount>bd.open_balance OR bd.status NOT IN ('APPROVED','OPEN','PARTIALLY_PAID')
    ) THEN RAISE EXCEPTION 'AP vendor credit allocation cannot be activated for target bill' USING ERRCODE='23514'; END IF;

    WITH pending AS (
      SELECT business_document_id,sum(amount) AS amount
      FROM business_allocation
      WHERE tenant_id=NEW.tenant_id AND entity_id=NEW.entity_id AND business_adjustment_id=adj.business_adjustment_id AND status='PENDING'
      GROUP BY business_document_id
    )
    UPDATE business_document bd
      SET posted_credit_adjustments=bd.posted_credit_adjustments+pending.amount,
          open_balance=bd.open_balance-pending.amount,
          status=CASE WHEN bd.open_balance-pending.amount=0 THEN 'PAID' ELSE 'PARTIALLY_PAID' END,
          version=bd.version+1,
          updated_at=clock_timestamp()
    FROM pending
    WHERE bd.tenant_id=NEW.tenant_id AND bd.entity_id=NEW.entity_id AND bd.business_document_id=pending.business_document_id;
    GET DIAGNOSTICS impacted = ROW_COUNT;

    UPDATE business_allocation
      SET status='ACTIVE',posted_journal_entry_id=NEW.journal_entry_id,version=version+1
      WHERE tenant_id=NEW.tenant_id AND entity_id=NEW.entity_id AND business_adjustment_id=adj.business_adjustment_id AND status='PENDING';
    UPDATE business_adjustment
      SET status='POSTED',posted_journal_entry_id=NEW.journal_entry_id,version=version+1
      WHERE tenant_id=NEW.tenant_id AND entity_id=NEW.entity_id AND business_adjustment_id=adj.business_adjustment_id;
    INSERT INTO audit_event(tenant_id,entity_id,event_type,object_type,object_id,action,actor_id,actor_type,permission_used,request_id,correlation_id,idempotency_key,after_hash,reason)
      VALUES(NEW.tenant_id,NEW.entity_id,'AP_VENDOR_CREDIT_POSTED','BUSINESS_ADJUSTMENT',adj.business_adjustment_id,'POST_AP_VENDOR_CREDIT',NEW.posted_by,'USER','GL.JE.POST',adj.idempotency_key,adj.idempotency_key,adj.idempotency_key,adj.request_hash,'Activated pending allocations: '||impacted);
    event_payload:=jsonb_build_object('business_adjustment_id',adj.business_adjustment_id,'journal_entry_id',NEW.journal_entry_id,'posted_journal_entry_id',NEW.journal_entry_id,'activated_document_count',impacted,'status','POSTED');
    INSERT INTO outbox_event(tenant_id,entity_id,aggregate_type,aggregate_id,event_type,payload,payload_hash)
      VALUES(NEW.tenant_id,NEW.entity_id,'BUSINESS_ADJUSTMENT',adj.business_adjustment_id,'AP_VENDOR_CREDIT_POSTED',event_payload,refs_jsonb_hash(event_payload));
  END IF;
  RETURN NEW;
END;
$$;

REVOKE EXECUTE ON FUNCTION refs_apply_ap_ar_posted_adjustment() FROM PUBLIC;
DROP TRIGGER IF EXISTS business_adjustment_posted_reducer ON journal_entry;
CREATE TRIGGER business_adjustment_posted_reducer
  AFTER UPDATE OF status ON journal_entry
  FOR EACH ROW EXECUTE FUNCTION refs_apply_ap_ar_posted_adjustment();

COMMIT;
