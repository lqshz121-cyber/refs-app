BEGIN;

-- A workflow grant is a current permission bundle, not evidence that the same
-- OIDC subject did not perform an earlier stage under a different bundle.
-- Preserve legacy reconciliation behavior, but make a signed/admitted WBS
-- statement retain subject-level separation across its complete lifecycle.
CREATE FUNCTION refs_signed_reconciliation_actor_conflict(
  p_tenant uuid,p_entity uuid,p_reconciliation uuid,p_actor text,p_target_status text
) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
  SELECT COALESCE(EXISTS(
    SELECT 1
    FROM reconciliation r
    WHERE r.tenant_id=p_tenant AND r.entity_id=p_entity
      AND r.reconciliation_id=p_reconciliation
      AND r.wbs_bank_statement_receipt_id IS NOT NULL
      AND (
        r.started_by=p_actor
        OR EXISTS(
          SELECT 1 FROM reconciliation_item i
          WHERE i.tenant_id=r.tenant_id AND i.entity_id=r.entity_id
            AND i.reconciliation_id=r.reconciliation_id
            AND p_actor IN (i.cleared_by,i.uncleared_by)
        )
        OR EXISTS(
          SELECT 1
          FROM wbs_bank_statement_transaction t
          JOIN bank_match m ON m.tenant_id=t.tenant_id AND m.entity_id=t.entity_id
            AND m.bank_source_id=t.bank_source_id
          WHERE t.tenant_id=r.tenant_id AND t.entity_id=r.entity_id
            AND t.wbs_bank_statement_receipt_id=r.wbs_bank_statement_receipt_id
            AND p_actor IN (m.matched_by,m.unmatched_by)
        )
        OR EXISTS(
          SELECT 1 FROM reconciliation_adjustment_draft d
          WHERE d.tenant_id=r.tenant_id AND d.entity_id=r.entity_id
            AND d.reconciliation_id=r.reconciliation_id AND d.created_by=p_actor
        )
        OR (p_target_status IN ('RECONCILED','REOPENED') AND r.reviewed_by=p_actor)
        OR (p_target_status='REOPENED' AND r.reconciled_by=p_actor)
      )
  ),false)
$$;

CREATE FUNCTION refs_guard_signed_reconciliation_lifecycle_sod() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE actor text:=refs_current_actor();
BEGIN
  IF NEW.wbs_bank_statement_receipt_id IS NULL OR NEW.status IS NOT DISTINCT FROM OLD.status
     OR NEW.status NOT IN ('IN_REVIEW','RECONCILED','REOPENED') THEN
    RETURN NEW;
  END IF;
  IF actor IS NULL THEN
    RAISE EXCEPTION 'Authenticated actor missing for signed statement lifecycle transition' USING ERRCODE='42501';
  END IF;
  IF refs_signed_reconciliation_actor_conflict(NEW.tenant_id,NEW.entity_id,NEW.reconciliation_id,actor,NEW.status::text) THEN
    RAISE EXCEPTION 'Signed statement lifecycle requires an actor independent from prior maker, match, clearance, review, and sign-off stages'
      USING ERRCODE='42501';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER signed_reconciliation_lifecycle_sod_guard
  BEFORE UPDATE OF status ON reconciliation
  FOR EACH ROW EXECUTE FUNCTION refs_guard_signed_reconciliation_lifecycle_sod();

REVOKE ALL ON FUNCTION refs_signed_reconciliation_actor_conflict(uuid,uuid,uuid,text,text) FROM PUBLIC;
REVOKE ALL ON FUNCTION refs_guard_signed_reconciliation_lifecycle_sod() FROM PUBLIC;

COMMIT;
