BEGIN;

-- A coverage record proves dates.  It does not, by itself, prove that the
-- accounting classifier concluded that the invoice is a prepaid item.  Bind
-- every new schedule to one exact, retained PREPAID_AMORTIZATION line before
-- the proposal can exist.  AI still has no Draft, review, approval, or posting
-- authority.
ALTER TABLE ai_amortization_schedule
  ADD COLUMN ai_invoice_accounting_classification_evidence_id uuid,
  ADD COLUMN source_document_line_id uuid,
  ADD COLUMN invoice_classification_hash text
    CHECK(invoice_classification_hash IS NULL OR invoice_classification_hash~'^sha256:[0-9a-f]{64}$'),
  ADD CONSTRAINT ai_amortization_schedule_classification_all_or_none CHECK(
    (ai_invoice_accounting_classification_evidence_id IS NULL
      AND source_document_line_id IS NULL
      AND invoice_classification_hash IS NULL)
    OR
    (ai_invoice_accounting_classification_evidence_id IS NOT NULL
      AND source_document_line_id IS NOT NULL
      AND invoice_classification_hash IS NOT NULL)
  ),
  ADD CONSTRAINT ai_amortization_schedule_classification_evidence_fk
    FOREIGN KEY(tenant_id,entity_id,ai_invoice_accounting_classification_evidence_id)
    REFERENCES ai_invoice_accounting_classification_evidence(tenant_id,entity_id,ai_invoice_accounting_classification_evidence_id),
  ADD CONSTRAINT ai_amortization_schedule_classification_line_fk
    FOREIGN KEY(tenant_id,entity_id,source_document_line_id)
    REFERENCES source_document_line(tenant_id,entity_id,source_document_line_id);

CREATE FUNCTION refs_bind_ai_amortization_invoice_classification() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE match_count integer; matched_id uuid; matched_line uuid; matched_hash text;
BEGIN
  SELECT count(*) INTO match_count
    FROM ai_invoice_accounting_classification_evidence e
    JOIN source_document_line l
      ON l.tenant_id=e.tenant_id AND l.entity_id=e.entity_id
     AND l.source_document_id=e.source_document_id AND l.source_document_line_id=e.source_document_line_id
   WHERE e.tenant_id=NEW.tenant_id AND e.entity_id=NEW.entity_id
     AND e.source_document_id=NEW.source_document_id
     AND e.source_payload_hash=NEW.source_payload_hash
     AND e.classifier_version='AI_INVOICE_ACCOUNTING_CLASSIFICATION_V2'
     AND e.classification='PREPAID_AMORTIZATION'
     AND e.status='REVIEW_REQUIRED';
  IF match_count<>1 THEN
    RAISE EXCEPTION 'AI amortization requires exactly one retained prepaid invoice classification for the exact source'
      USING ERRCODE='23514';
  END IF;
  SELECT e.ai_invoice_accounting_classification_evidence_id,e.source_document_line_id,e.classification_hash
    INTO matched_id,matched_line,matched_hash
    FROM ai_invoice_accounting_classification_evidence e
   WHERE e.tenant_id=NEW.tenant_id AND e.entity_id=NEW.entity_id
     AND e.source_document_id=NEW.source_document_id
     AND e.source_payload_hash=NEW.source_payload_hash
     AND e.classifier_version='AI_INVOICE_ACCOUNTING_CLASSIFICATION_V2'
     AND e.classification='PREPAID_AMORTIZATION'
     AND e.status='REVIEW_REQUIRED';
  IF NEW.ai_invoice_accounting_classification_evidence_id IS NOT NULL
     AND (NEW.ai_invoice_accounting_classification_evidence_id IS DISTINCT FROM matched_id
       OR NEW.source_document_line_id IS DISTINCT FROM matched_line
       OR NEW.invoice_classification_hash IS DISTINCT FROM matched_hash) THEN
    RAISE EXCEPTION 'Supplied amortization classification lineage does not match retained evidence'
      USING ERRCODE='23514';
  END IF;
  NEW.ai_invoice_accounting_classification_evidence_id:=matched_id;
  NEW.source_document_line_id:=matched_line;
  NEW.invoice_classification_hash:=matched_hash;
  RETURN NEW;
END;
$$;

CREATE TRIGGER ai_amortization_schedule_bind_invoice_classification
  BEFORE INSERT ON ai_amortization_schedule
  FOR EACH ROW EXECUTE FUNCTION refs_bind_ai_amortization_invoice_classification();

CREATE FUNCTION refs_audit_ai_amortization_invoice_classification() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE actor text:=COALESCE(refs_current_actor(),NEW.created_by); event_payload jsonb;
BEGIN
  IF actor IS NULL THEN
    RAISE EXCEPTION 'Authenticated amortization classification linker missing' USING ERRCODE='42501';
  END IF;
  event_payload:=jsonb_build_object(
    'schema_version','AI_AMORTIZATION_INVOICE_CLASSIFICATION_LINK_V1',
    'ai_amortization_schedule_id',NEW.ai_amortization_schedule_id,
    'classification_evidence_id',NEW.ai_invoice_accounting_classification_evidence_id,
    'classification_hash',NEW.invoice_classification_hash,
    'source_document_id',NEW.source_document_id,
    'source_document_line_id',NEW.source_document_line_id,
    'source_payload_hash',NEW.source_payload_hash,
    'classification','PREPAID_AMORTIZATION','status','PROPOSED',
    'can_create_draft',false,'can_review',false,'can_approve',false,'can_post',false
  );
  INSERT INTO audit_event(tenant_id,entity_id,event_type,object_type,object_id,action,actor_id,actor_type,permission_used,request_id,correlation_id,idempotency_key,after_hash,reason,metadata)
    VALUES(NEW.tenant_id,NEW.entity_id,'AI_AMORTIZATION_CLASSIFICATION_LINKED','AI_AMORTIZATION_SCHEDULE',NEW.ai_amortization_schedule_id,'LINK',actor,'USER','AI.AMORTIZATION.PROPOSE',NEW.proposal_hash,NEW.proposal_hash,NEW.proposal_hash,NEW.invoice_classification_hash,'Retained prepaid invoice classification linked to amortization proposal',event_payload);
  INSERT INTO outbox_event(tenant_id,entity_id,aggregate_type,aggregate_id,event_type,payload,payload_hash)
    VALUES(NEW.tenant_id,NEW.entity_id,'AI_AMORTIZATION_SCHEDULE',NEW.ai_amortization_schedule_id,'AI_AMORTIZATION_CLASSIFICATION_LINKED',event_payload,refs_jsonb_hash(event_payload));
  RETURN NEW;
END;
$$;

CREATE TRIGGER ai_amortization_schedule_audit_invoice_classification
  AFTER INSERT ON ai_amortization_schedule
  FOR EACH ROW EXECUTE FUNCTION refs_audit_ai_amortization_invoice_classification();

-- This trigger fires after the normal Draft function has built its journal but
-- before its transaction commits.  A legacy/unlinked schedule therefore rolls
-- the entire operation back, including the journal, evidence, audit and outbox.
CREATE FUNCTION refs_require_ai_amortization_classification_for_draft() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
BEGIN
  IF NOT EXISTS(
    SELECT 1
      FROM ai_amortization_schedule s
      JOIN ai_invoice_accounting_classification_evidence e
        ON e.tenant_id=s.tenant_id AND e.entity_id=s.entity_id
       AND e.ai_invoice_accounting_classification_evidence_id=s.ai_invoice_accounting_classification_evidence_id
       AND e.source_document_line_id=s.source_document_line_id
       AND e.classification_hash=s.invoice_classification_hash
     WHERE s.tenant_id=NEW.tenant_id AND s.entity_id=NEW.entity_id
       AND s.ai_amortization_schedule_id=NEW.ai_amortization_schedule_id
       AND e.source_document_id=s.source_document_id
       AND e.source_payload_hash=s.source_payload_hash
       AND e.classification='PREPAID_AMORTIZATION'
  ) THEN
    RAISE EXCEPTION 'AI amortization Draft requires retained prepaid invoice classification lineage'
      USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER ai_amortization_draft_require_invoice_classification
  BEFORE INSERT ON ai_amortization_draft_evidence
  FOR EACH ROW EXECUTE FUNCTION refs_require_ai_amortization_classification_for_draft();

REVOKE ALL ON FUNCTION refs_bind_ai_amortization_invoice_classification(),refs_audit_ai_amortization_invoice_classification(),refs_require_ai_amortization_classification_for_draft() FROM PUBLIC,refs_app;

COMMIT;
