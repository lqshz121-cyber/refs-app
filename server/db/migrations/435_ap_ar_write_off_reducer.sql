BEGIN;

-- X02 (2/2): teach the posted-adjustment reducer to activate a write-off.
--
-- This is a CREATE OR REPLACE of the whole trigger function from 010 with one added branch; the
-- AP_BILL_VOID and AP_VENDOR_CREDIT branches are carried over byte-for-byte so this migration
-- cannot silently change their behaviour.
--
-- The write-off branch is deliberately stricter than the vendor-credit branch in one way: a
-- vendor credit may be partially allocated, so it checks `pending_total > adj.amount`, whereas a
-- write-off is a single allocation against a single document and must match exactly, so it checks
-- `pending_total <> adj.amount`. That closes the gap where a Draft could post while allocating
-- less than the amount debited to the control account -- which is precisely the ledger/subledger
-- divergence this feature exists to prevent.

CREATE OR REPLACE FUNCTION refs_apply_ap_ar_posted_adjustment() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE adj business_adjustment; bill business_document; pending_total numeric(20,4); impacted bigint; event_payload jsonb;
BEGIN
  IF TG_OP<>'UPDATE' OR NEW.status<>'POSTED' OR OLD.status='POSTED' THEN RETURN NEW; END IF;
  SELECT * INTO adj FROM business_adjustment
    WHERE tenant_id=NEW.tenant_id AND entity_id=NEW.entity_id AND draft_journal_entry_id=NEW.journal_entry_id
    FOR UPDATE;
  IF NOT FOUND THEN RETURN NEW; END IF;
  IF adj.status IN ('POSTED','CANCELLED','REJECTED') THEN
    RAISE EXCEPTION 'Business adjustment cannot be posted from current state' USING ERRCODE='23514';
  END IF;

  IF adj.adjustment_kind='AP_BILL_VOID' THEN
    SELECT * INTO bill FROM business_document
      WHERE tenant_id=NEW.tenant_id AND entity_id=NEW.entity_id AND business_document_id=adj.business_document_id
      FOR UPDATE;
    IF NOT FOUND OR bill.document_kind<>'AP_BILL' OR bill.status<>'APPROVED' OR bill.open_balance<>bill.gross_amount OR bill.currency<>adj.currency THEN
      RAISE EXCEPTION 'AP bill void can only post against a fully-open AP bill' USING ERRCODE='23514';
    END IF;
    IF EXISTS (
      SELECT 1 FROM business_allocation
      WHERE tenant_id=NEW.tenant_id AND entity_id=NEW.entity_id AND business_document_id=bill.business_document_id
        AND status IN ('PENDING','ACTIVE')
      FOR UPDATE
    ) THEN RAISE EXCEPTION 'AP bill void is blocked by allocations' USING ERRCODE='23514'; END IF;
    UPDATE business_document
      SET posted_credit_adjustments=posted_credit_adjustments+bill.open_balance,
          open_balance=0,
          status='VOID',
          version=version+1,
          updated_at=clock_timestamp()
      WHERE tenant_id=NEW.tenant_id AND entity_id=NEW.entity_id AND business_document_id=bill.business_document_id;
    UPDATE business_adjustment
      SET status='POSTED',posted_journal_entry_id=NEW.journal_entry_id,version=version+1
      WHERE tenant_id=NEW.tenant_id AND entity_id=NEW.entity_id AND business_adjustment_id=adj.business_adjustment_id;
    INSERT INTO audit_event(tenant_id,entity_id,event_type,object_type,object_id,action,actor_id,actor_type,permission_used,request_id,correlation_id,idempotency_key,after_hash,reason)
      VALUES(NEW.tenant_id,NEW.entity_id,'AP_BILL_VOID_POSTED','BUSINESS_ADJUSTMENT',adj.business_adjustment_id,'POST_AP_BILL_VOID',NEW.posted_by,'USER','GL.JE.POST',adj.idempotency_key,adj.idempotency_key,adj.idempotency_key,adj.request_hash,'Bill void posted');
    event_payload:=jsonb_build_object('business_adjustment_id',adj.business_adjustment_id,'business_document_id',bill.business_document_id,'journal_entry_id',NEW.journal_entry_id,'status','VOID','open_balance',0);
    INSERT INTO outbox_event(tenant_id,entity_id,aggregate_type,aggregate_id,event_type,payload,payload_hash)
      VALUES(NEW.tenant_id,NEW.entity_id,'BUSINESS_ADJUSTMENT',adj.business_adjustment_id,'AP_BILL_VOID_POSTED',event_payload,refs_jsonb_hash(event_payload));
  ELSIF adj.adjustment_kind='AP_VENDOR_CREDIT' THEN
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

  ELSIF adj.adjustment_kind IN ('AP_BILL_WRITE_OFF','AR_INVOICE_WRITE_OFF') THEN
    -- Same activation shape as AP_VENDOR_CREDIT: the pending allocation is what carries the
    -- subledger down by exactly the amount the journal moved on the control account, so
    -- refs_ap_ar_control_reconciliation stays in balance without a compensating update.
    PERFORM 1 FROM business_allocation
      WHERE tenant_id=NEW.tenant_id AND entity_id=NEW.entity_id AND business_adjustment_id=adj.business_adjustment_id
        AND status='PENDING'
      ORDER BY business_document_id,business_allocation_id FOR UPDATE;
    SELECT COALESCE(sum(amount),0) INTO pending_total FROM business_allocation
      WHERE tenant_id=NEW.tenant_id AND entity_id=NEW.entity_id AND business_adjustment_id=adj.business_adjustment_id
        AND status IN ('PENDING','ACTIVE');
    IF pending_total<>adj.amount THEN
      RAISE EXCEPTION 'Write-off allocation must equal the adjustment amount' USING ERRCODE='23514';
    END IF;

    SELECT * INTO bill FROM business_document
      WHERE tenant_id=NEW.tenant_id AND entity_id=NEW.entity_id AND business_document_id=adj.business_document_id
      FOR UPDATE;
    -- Re-derived at Post, not trusted from Draft time: the balance may have moved while the
    -- Draft sat in the approval chain.
    IF NOT FOUND
       OR bill.currency<>adj.currency
       OR bill.status NOT IN ('APPROVED','OPEN','PARTIALLY_PAID')
       OR adj.amount>bill.open_balance
       OR (adj.adjustment_kind='AP_BILL_WRITE_OFF' AND bill.document_kind<>'AP_BILL')
       OR (adj.adjustment_kind='AR_INVOICE_WRITE_OFF' AND bill.document_kind<>'AR_INVOICE') THEN
      RAISE EXCEPTION 'Write-off cannot be activated for the target document' USING ERRCODE='23514';
    END IF;

    UPDATE business_document
      SET posted_credit_adjustments=posted_credit_adjustments+adj.amount,
          open_balance=open_balance-adj.amount,
          status=CASE WHEN open_balance-adj.amount=0 THEN 'PAID' ELSE 'PARTIALLY_PAID' END,
          version=version+1,
          updated_at=clock_timestamp()
      WHERE tenant_id=NEW.tenant_id AND entity_id=NEW.entity_id AND business_document_id=adj.business_document_id;
    GET DIAGNOSTICS impacted = ROW_COUNT;

    UPDATE business_allocation
      SET status='ACTIVE',posted_journal_entry_id=NEW.journal_entry_id,version=version+1
      WHERE tenant_id=NEW.tenant_id AND entity_id=NEW.entity_id AND business_adjustment_id=adj.business_adjustment_id AND status='PENDING';
    UPDATE business_adjustment
      SET status='POSTED',posted_journal_entry_id=NEW.journal_entry_id,version=version+1
      WHERE tenant_id=NEW.tenant_id AND entity_id=NEW.entity_id AND business_adjustment_id=adj.business_adjustment_id;
    INSERT INTO audit_event(tenant_id,entity_id,event_type,object_type,object_id,action,actor_id,actor_type,permission_used,request_id,correlation_id,idempotency_key,after_hash,reason)
      VALUES(NEW.tenant_id,NEW.entity_id,adj.adjustment_kind||'_POSTED','BUSINESS_ADJUSTMENT',adj.business_adjustment_id,'POST_WRITE_OFF',NEW.posted_by,'USER','GL.JE.POST',adj.idempotency_key,adj.idempotency_key,adj.idempotency_key,adj.request_hash,'Write-off applied to documents: '||impacted);
    event_payload:=jsonb_build_object('business_adjustment_id',adj.business_adjustment_id,'journal_entry_id',NEW.journal_entry_id,'posted_journal_entry_id',NEW.journal_entry_id,'activated_document_count',impacted,'status','POSTED');
    INSERT INTO outbox_event(tenant_id,entity_id,aggregate_type,aggregate_id,event_type,payload,payload_hash)
      VALUES(NEW.tenant_id,NEW.entity_id,'BUSINESS_ADJUSTMENT',adj.business_adjustment_id,adj.adjustment_kind||'_POSTED',event_payload,refs_jsonb_hash(event_payload));
  END IF;
  RETURN NEW;
END;
$$;

REVOKE EXECUTE ON FUNCTION refs_apply_ap_ar_posted_adjustment() FROM PUBLIC;

COMMIT;
