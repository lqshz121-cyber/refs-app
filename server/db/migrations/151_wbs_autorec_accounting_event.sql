BEGIN;

INSERT INTO permission_catalog(permission_code,domain,risk_class,sod_class)
VALUES('BANK.AUTOREC.G11.DRAFT','BANK','CRITICAL','WBS_AUTOREC_G11_DRAFT_MAKER')
ON CONFLICT(permission_code) DO UPDATE SET active=true,domain=EXCLUDED.domain,risk_class=EXCLUDED.risk_class,sod_class=EXCLUDED.sod_class,version=permission_catalog.version+1,effective_to=NULL;

CREATE TABLE accounting_event (
  accounting_event_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL, entity_id uuid NOT NULL,
  wbs_autorec_match_review_id uuid NOT NULL,
  review_candidate_id text NOT NULL CHECK(review_candidate_id ~ '^sha256:[0-9a-f]{64}$'),
  event_type text NOT NULL CHECK(event_type IN ('PAYABLE_INCUR','AUTOC')),
  source_document_id uuid NOT NULL, staging_item_id uuid NOT NULL,
  mapping_snapshot_id uuid NOT NULL, mapping_snapshot_hash text NOT NULL CHECK(mapping_snapshot_hash ~ '^sha256:[0-9a-f]{64}$'),
  amount numeric(20,4) NOT NULL CHECK(amount>0), currency char(3) NOT NULL CHECK(currency ~ '^[A-Z]{3}$'),
  bank_account_ref text NOT NULL CHECK(bank_account_ref=btrim(bank_account_ref) AND length(bank_account_ref) BETWEEN 1 AND 128),
  clearing_member_ref text NOT NULL CHECK(clearing_member_ref=btrim(clearing_member_ref) AND length(clearing_member_ref) BETWEEN 1 AND 160),
  evidence_hash text NOT NULL CHECK(evidence_hash ~ '^sha256:[0-9a-f]{64}$'),
  created_by text NOT NULL, created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE(tenant_id,entity_id,wbs_autorec_match_review_id,event_type),
  UNIQUE(tenant_id,entity_id,accounting_event_id),
  FOREIGN KEY(tenant_id,entity_id) REFERENCES entity(tenant_id,entity_id),
  FOREIGN KEY(tenant_id,entity_id,wbs_autorec_match_review_id) REFERENCES wbs_autorec_match_review(tenant_id,entity_id,wbs_autorec_match_review_id),
  FOREIGN KEY(tenant_id,entity_id,source_document_id) REFERENCES source_document(tenant_id,entity_id,source_document_id),
  FOREIGN KEY(tenant_id,entity_id,staging_item_id) REFERENCES staging_item(tenant_id,entity_id,staging_item_id),
  FOREIGN KEY(tenant_id,mapping_snapshot_id) REFERENCES mapping_snapshot(tenant_id,mapping_snapshot_id)
);
CREATE TABLE journal_accounting_event (
  journal_accounting_event_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL, entity_id uuid NOT NULL,
  accounting_event_id uuid NOT NULL, journal_entry_id uuid NOT NULL,
  bound_by text NOT NULL, bound_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE(tenant_id,entity_id,accounting_event_id),
  UNIQUE(tenant_id,entity_id,journal_entry_id),
  FOREIGN KEY(tenant_id,entity_id) REFERENCES entity(tenant_id,entity_id),
  FOREIGN KEY(tenant_id,entity_id,accounting_event_id) REFERENCES accounting_event(tenant_id,entity_id,accounting_event_id),
  FOREIGN KEY(tenant_id,entity_id,journal_entry_id) REFERENCES journal_entry(tenant_id,entity_id,journal_entry_id)
);
ALTER TABLE accounting_event ENABLE ROW LEVEL SECURITY;
ALTER TABLE journal_accounting_event ENABLE ROW LEVEL SECURITY;
CREATE POLICY accounting_event_scope ON accounting_event USING(tenant_id=refs_current_tenant() AND refs_entity_allowed(entity_id)) WITH CHECK(tenant_id=refs_current_tenant() AND refs_entity_allowed(entity_id));
CREATE POLICY journal_accounting_event_scope ON journal_accounting_event USING(tenant_id=refs_current_tenant() AND refs_entity_allowed(entity_id)) WITH CHECK(tenant_id=refs_current_tenant() AND refs_entity_allowed(entity_id));
CREATE TRIGGER accounting_event_append_only BEFORE UPDATE OR DELETE ON accounting_event FOR EACH ROW EXECUTE FUNCTION reject_mutation();
CREATE TRIGGER journal_accounting_event_append_only BEFORE UPDATE OR DELETE ON journal_accounting_event FOR EACH ROW EXECUTE FUNCTION reject_mutation();

CREATE FUNCTION refs_wbs_autorec_event_draft_hash(p_tenant uuid,p_entity uuid,p_review uuid,p_period uuid,p_expected_evidence_hash text,p_reason text)
RETURNS text LANGUAGE sql IMMUTABLE SET search_path=pg_catalog,public,pg_temp AS $$
 SELECT refs_jsonb_hash(jsonb_build_object('tenant_id',p_tenant,'entity_id',p_entity,'review_id',p_review,'period_id',p_period,'expected_evidence_hash',p_expected_evidence_hash,'reason',btrim(p_reason)))
$$;

-- Private seam.  The accounting mapping needed to derive accounts, members and
-- both balanced legs does not yet exist in PostgreSQL.  Fail closed before an
-- idempotency receipt, event, journal or link can be written.
CREATE FUNCTION refs_create_wbs_autorec_event_draft_private(p_event_type text,p_tenant uuid,p_entity uuid,p_review uuid,p_period uuid,p_expected_evidence_hash text,p_reason text,p_idempotency text,p_request_hash text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE actor text:=refs_current_actor(); review_row wbs_autorec_match_review;
BEGIN
  PERFORM refs_assert_scope(p_tenant,p_entity,'BANK.AUTOREC.G11.DRAFT');
  IF actor IS NULL OR p_event_type NOT IN ('PAYABLE_INCUR','AUTOC') OR p_request_hash<>refs_wbs_autorec_event_draft_hash(p_tenant,p_entity,p_review,p_period,p_expected_evidence_hash,p_reason) OR coalesce(length(btrim(p_reason)),0) NOT BETWEEN 8 AND 2000 THEN RAISE EXCEPTION 'AutoRec accounting-event Draft request is invalid' USING ERRCODE='22023'; END IF;
  SELECT * INTO review_row FROM wbs_autorec_match_review WHERE tenant_id=p_tenant AND entity_id=p_entity AND wbs_autorec_match_review_id=p_review AND decision='ACCEPTED' FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'An exact ACCEPTED AutoRec review is required' USING ERRCODE='P0002'; END IF;
  IF review_row.evidence_hash<>p_expected_evidence_hash THEN RAISE EXCEPTION 'AutoRec review evidence hash changed' USING ERRCODE='40001'; END IF;
  IF actor IN (review_row.reviewed_by,review_row.matched_by,review_row.candidate_prepared_by) THEN RAISE EXCEPTION 'AutoRec accounting-event Draft maker SoD violation' USING ERRCODE='42501'; END IF;
  PERFORM 1 FROM accounting_period WHERE tenant_id=p_tenant AND entity_id=p_entity AND period_id=p_period AND status='OPEN' FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'AutoRec accounting-event Draft requires an OPEN period' USING ERRCODE='55000'; END IF;
  RAISE EXCEPTION 'Server-derived G11 event mapping is not implemented; no accounting event or Draft was written' USING ERRCODE='23514';
END $$;
CREATE FUNCTION refs_create_wbs_autorec_payable_incur_draft(p_tenant uuid,p_entity uuid,p_review uuid,p_period uuid,p_expected_evidence_hash text,p_reason text,p_idempotency text,p_request_hash text)
RETURNS jsonb LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$ SELECT refs_create_wbs_autorec_event_draft_private('PAYABLE_INCUR',p_tenant,p_entity,p_review,p_period,p_expected_evidence_hash,p_reason,p_idempotency,p_request_hash) $$;
CREATE FUNCTION refs_create_wbs_autorec_autoc_draft(p_tenant uuid,p_entity uuid,p_review uuid,p_period uuid,p_expected_evidence_hash text,p_reason text,p_idempotency text,p_request_hash text)
RETURNS jsonb LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$ SELECT refs_create_wbs_autorec_event_draft_private('AUTOC',p_tenant,p_entity,p_review,p_period,p_expected_evidence_hash,p_reason,p_idempotency,p_request_hash) $$;

REVOKE ALL ON accounting_event,journal_accounting_event FROM PUBLIC,refs_app;
GRANT SELECT ON accounting_event,journal_accounting_event TO refs_app;
REVOKE ALL ON FUNCTION refs_create_wbs_autorec_event_draft_private(text,uuid,uuid,uuid,uuid,text,text,text,text) FROM PUBLIC,refs_app;
REVOKE ALL ON FUNCTION refs_wbs_autorec_event_draft_hash(uuid,uuid,uuid,uuid,text,text) FROM PUBLIC;
REVOKE ALL ON FUNCTION refs_create_wbs_autorec_payable_incur_draft(uuid,uuid,uuid,uuid,text,text,text,text) FROM PUBLIC;
REVOKE ALL ON FUNCTION refs_create_wbs_autorec_autoc_draft(uuid,uuid,uuid,uuid,text,text,text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION refs_wbs_autorec_event_draft_hash(uuid,uuid,uuid,uuid,text,text) TO refs_app;
GRANT EXECUTE ON FUNCTION refs_create_wbs_autorec_payable_incur_draft(uuid,uuid,uuid,uuid,text,text,text,text) TO refs_app;
GRANT EXECUTE ON FUNCTION refs_create_wbs_autorec_autoc_draft(uuid,uuid,uuid,uuid,text,text,text,text) TO refs_app;
COMMIT;
