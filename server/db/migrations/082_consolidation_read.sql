BEGIN;

-- Consolidation is a read over an independently approved, immutable scope.
-- It never derives membership, account equivalence, currency translation, or
-- elimination entries from entity names, common account codes, or amounts.
CREATE TABLE consolidation_snapshot (
  consolidation_snapshot_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant(tenant_id),
  reporting_entity_id uuid NOT NULL,
  reporting_period_id uuid NOT NULL,
  group_ref text NOT NULL CHECK(length(btrim(group_ref)) BETWEEN 1 AND 160),
  version bigint NOT NULL CHECK(version>0),
  currency text NOT NULL CHECK(currency~'^[A-Z]{3}$'),
  source_ref text NOT NULL CHECK(length(btrim(source_ref)) BETWEEN 1 AND 500),
  source_version text NOT NULL CHECK(length(btrim(source_version)) BETWEEN 1 AND 160),
  receipt_hash text NOT NULL CHECK(receipt_hash~'^sha256:[0-9a-f]{64}$'),
  snapshot_hash text NOT NULL CHECK(snapshot_hash~'^sha256:[0-9a-f]{64}$'),
  prepared_by text NOT NULL CHECK(length(btrim(prepared_by))>0),
  approved_by text NOT NULL CHECK(length(btrim(approved_by))>0 AND approved_by<>prepared_by),
  approved_at timestamptz NOT NULL,
  captured_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  FOREIGN KEY(tenant_id,reporting_entity_id) REFERENCES entity(tenant_id,entity_id),
  FOREIGN KEY(tenant_id,reporting_entity_id,reporting_period_id) REFERENCES accounting_period(tenant_id,entity_id,period_id),
  UNIQUE(tenant_id,reporting_entity_id,reporting_period_id,group_ref,version),
  UNIQUE(consolidation_snapshot_id,tenant_id,reporting_entity_id,reporting_period_id)
);

CREATE TABLE consolidation_member (
  consolidation_snapshot_id uuid NOT NULL,
  tenant_id uuid NOT NULL,
  reporting_entity_id uuid NOT NULL,
  reporting_period_id uuid NOT NULL,
  member_entity_id uuid NOT NULL,
  member_period_id uuid NOT NULL,
  member_ref text NOT NULL CHECK(length(btrim(member_ref)) BETWEEN 1 AND 160),
  member_source_ref text NOT NULL CHECK(length(btrim(member_source_ref)) BETWEEN 1 AND 500),
  member_source_version text NOT NULL CHECK(length(btrim(member_source_version)) BETWEEN 1 AND 160),
  member_receipt_hash text NOT NULL CHECK(member_receipt_hash~'^sha256:[0-9a-f]{64}$'),
  member_snapshot_hash text NOT NULL CHECK(member_snapshot_hash~'^sha256:[0-9a-f]{64}$'),
  PRIMARY KEY(consolidation_snapshot_id,member_entity_id),
  FOREIGN KEY(consolidation_snapshot_id,tenant_id,reporting_entity_id,reporting_period_id) REFERENCES consolidation_snapshot(consolidation_snapshot_id,tenant_id,reporting_entity_id,reporting_period_id),
  FOREIGN KEY(tenant_id,member_entity_id) REFERENCES entity(tenant_id,entity_id),
  FOREIGN KEY(tenant_id,member_entity_id,member_period_id) REFERENCES accounting_period(tenant_id,entity_id,period_id)
);

CREATE TABLE consolidation_account_map (
  consolidation_snapshot_id uuid NOT NULL,
  member_entity_id uuid NOT NULL,
  source_account_code text NOT NULL CHECK(source_account_code~'^[0-9A-Za-z._-]{1,64}$'),
  presentation_account_code text NOT NULL CHECK(presentation_account_code~'^[0-9A-Za-z._-]{1,64}$'),
  presentation_side text NOT NULL CHECK(presentation_side IN ('DEBIT','CREDIT')),
  mapping_hash text NOT NULL CHECK(mapping_hash~'^sha256:[0-9a-f]{64}$'),
  PRIMARY KEY(consolidation_snapshot_id,member_entity_id,source_account_code),
  FOREIGN KEY(consolidation_snapshot_id,member_entity_id) REFERENCES consolidation_member(consolidation_snapshot_id,member_entity_id)
);

CREATE TABLE consolidation_elimination_evidence (
  consolidation_snapshot_id uuid NOT NULL,
  presentation_account_code text NOT NULL CHECK(presentation_account_code~'^[0-9A-Za-z._-]{1,64}$'),
  presentation_side text NOT NULL CHECK(presentation_side IN ('DEBIT','CREDIT')),
  elimination_ref text NOT NULL CHECK(length(btrim(elimination_ref)) BETWEEN 1 AND 500),
  elimination_amount numeric(20,4) NOT NULL CHECK(elimination_amount>=0),
  evidence_hash text NOT NULL CHECK(evidence_hash~'^sha256:[0-9a-f]{64}$'),
  receipt_hash text NOT NULL CHECK(receipt_hash~'^sha256:[0-9a-f]{64}$'),
  PRIMARY KEY(consolidation_snapshot_id,presentation_account_code,presentation_side,elimination_ref),
  FOREIGN KEY(consolidation_snapshot_id) REFERENCES consolidation_snapshot(consolidation_snapshot_id)
);

CREATE INDEX consolidation_snapshot_read_idx ON consolidation_snapshot(tenant_id,reporting_entity_id,reporting_period_id,group_ref,version DESC);
CREATE INDEX consolidation_member_read_idx ON consolidation_member(consolidation_snapshot_id,member_entity_id,member_period_id);
CREATE INDEX consolidation_account_map_read_idx ON consolidation_account_map(consolidation_snapshot_id,presentation_account_code,presentation_side);
CREATE INDEX consolidation_elimination_read_idx ON consolidation_elimination_evidence(consolidation_snapshot_id,presentation_account_code,presentation_side);

ALTER TABLE consolidation_snapshot ENABLE ROW LEVEL SECURITY;
ALTER TABLE consolidation_member ENABLE ROW LEVEL SECURITY;
ALTER TABLE consolidation_account_map ENABLE ROW LEVEL SECURITY;
ALTER TABLE consolidation_elimination_evidence ENABLE ROW LEVEL SECURITY;
CREATE POLICY consolidation_snapshot_scope_policy ON consolidation_snapshot USING(tenant_id=refs_current_tenant() AND refs_entity_allowed(reporting_entity_id)) WITH CHECK(tenant_id=refs_current_tenant() AND refs_entity_allowed(reporting_entity_id));
CREATE POLICY consolidation_member_scope_policy ON consolidation_member USING(tenant_id=refs_current_tenant() AND refs_entity_allowed(reporting_entity_id)) WITH CHECK(tenant_id=refs_current_tenant() AND refs_entity_allowed(reporting_entity_id));
CREATE POLICY consolidation_account_map_scope_policy ON consolidation_account_map USING(EXISTS(SELECT 1 FROM consolidation_snapshot s WHERE s.consolidation_snapshot_id=consolidation_account_map.consolidation_snapshot_id AND s.tenant_id=refs_current_tenant() AND refs_entity_allowed(s.reporting_entity_id))) WITH CHECK(false);
CREATE POLICY consolidation_elimination_scope_policy ON consolidation_elimination_evidence USING(EXISTS(SELECT 1 FROM consolidation_snapshot s WHERE s.consolidation_snapshot_id=consolidation_elimination_evidence.consolidation_snapshot_id AND s.tenant_id=refs_current_tenant() AND refs_entity_allowed(s.reporting_entity_id))) WITH CHECK(false);
CREATE TRIGGER consolidation_snapshot_append_only BEFORE UPDATE OR DELETE ON consolidation_snapshot FOR EACH ROW EXECUTE FUNCTION reject_mutation();
CREATE TRIGGER consolidation_member_append_only BEFORE UPDATE OR DELETE ON consolidation_member FOR EACH ROW EXECUTE FUNCTION reject_mutation();
CREATE TRIGGER consolidation_account_map_append_only BEFORE UPDATE OR DELETE ON consolidation_account_map FOR EACH ROW EXECUTE FUNCTION reject_mutation();
CREATE TRIGGER consolidation_elimination_append_only BEFORE UPDATE OR DELETE ON consolidation_elimination_evidence FOR EACH ROW EXECUTE FUNCTION reject_mutation();

CREATE FUNCTION refs_get_consolidation(
  p_tenant uuid,p_entity uuid,p_period uuid,p_group_ref text
) RETURNS TABLE(
  group_ref text,period_id uuid,period_code text,period_start text,period_end text,currency text,
  presentation_account_code text,presentation_side text,report_status text,classification_basis text,
  member_count integer,evidence_member_count integer,member_actual_amount numeric(20,4),
  elimination_amount numeric(20,4),consolidated_amount numeric(20,4),
  consolidation_snapshot_id uuid,consolidation_version text,consolidation_snapshot_hash text,
  consolidation_receipt_hash text,consolidation_source_ref text,consolidation_source_version text,
  member_entity_ids uuid[],journal_entry_ids uuid[],journal_line_ids uuid[],ledger_line_ids uuid[],source_document_ids uuid[],elimination_refs text[]
) LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE v_snapshot record; v_period record; v_member record; v_authorized boolean:=true; v_scope_valid boolean:=true;
BEGIN
  IF p_group_ref IS NULL OR length(btrim(p_group_ref))=0 OR length(p_group_ref)>160 THEN RAISE EXCEPTION 'A canonical consolidation group is required' USING ERRCODE='22023'; END IF;
  PERFORM public.refs_assert_scope(p_tenant,p_entity,'GL.REPORT.VIEW');
  SELECT ap.period_id,ap.period_code,ap.starts_on,ap.ends_on,e.base_currency INTO v_period FROM public.accounting_period ap JOIN public.entity e ON e.tenant_id=ap.tenant_id AND e.entity_id=ap.entity_id WHERE ap.tenant_id=p_tenant AND ap.entity_id=p_entity AND ap.period_id=p_period;
  IF NOT FOUND OR v_period.period_id IS NULL THEN RAISE EXCEPTION 'A valid reporting entity period is required' USING ERRCODE='22023'; END IF;
  SELECT s.* INTO v_snapshot FROM public.consolidation_snapshot s WHERE s.tenant_id=p_tenant AND s.reporting_entity_id=p_entity AND s.reporting_period_id=p_period AND s.group_ref=p_group_ref ORDER BY s.version DESC,s.consolidation_snapshot_id DESC LIMIT 1;
  IF NOT FOUND THEN RETURN; END IF;
  FOR v_member IN SELECT m.*,ap.starts_on,ap.ends_on,e.base_currency FROM public.consolidation_member m JOIN public.accounting_period ap ON ap.tenant_id=m.tenant_id AND ap.entity_id=m.member_entity_id AND ap.period_id=m.member_period_id JOIN public.entity e ON e.tenant_id=m.tenant_id AND e.entity_id=m.member_entity_id WHERE m.consolidation_snapshot_id=v_snapshot.consolidation_snapshot_id LOOP
    BEGIN PERFORM public.refs_assert_scope(p_tenant,v_member.member_entity_id,'GL.REPORT.VIEW'); EXCEPTION WHEN others THEN v_authorized:=false; END;
    IF v_member.starts_on<>v_period.starts_on OR v_member.ends_on<>v_period.ends_on OR v_member.base_currency<>v_snapshot.currency OR v_snapshot.currency<>v_period.base_currency THEN v_scope_valid:=false; END IF;
  END LOOP;
  RETURN QUERY
  WITH maps AS (
    SELECT m.member_entity_id,m.member_period_id,m.member_ref,m.member_snapshot_hash,m.member_receipt_hash,a.source_account_code,a.presentation_account_code,a.presentation_side,a.mapping_hash
    FROM public.consolidation_member m JOIN public.consolidation_account_map a ON a.consolidation_snapshot_id=m.consolidation_snapshot_id AND a.member_entity_id=m.member_entity_id
    WHERE m.consolidation_snapshot_id=v_snapshot.consolidation_snapshot_id
  ), posted AS (
    SELECT m.member_entity_id,m.presentation_account_code,m.presentation_side,l.ledger_line_id,l.journal_entry_id,l.journal_line_id,
      CASE m.presentation_side WHEN 'DEBIT' THEN l.debit_amount-l.credit_amount ELSE l.credit_amount-l.debit_amount END AS amount
    FROM maps m JOIN public.ledger_line l ON l.tenant_id=p_tenant AND l.entity_id=m.member_entity_id AND l.period_id=m.member_period_id AND l.account_code=m.source_account_code
    JOIN public.journal_entry j ON j.tenant_id=l.tenant_id AND j.entity_id=l.entity_id AND j.journal_entry_id=l.journal_entry_id AND j.status='POSTED' AND j.currency=v_snapshot.currency
  ), actual AS (
    SELECT m.presentation_account_code,m.presentation_side,count(DISTINCT m.member_entity_id)::integer member_count,count(DISTINCT p.member_entity_id)::integer evidence_member_count,
      COALESCE(sum(p.amount),0)::numeric(20,4) member_actual_amount,
      array_agg(DISTINCT m.member_entity_id ORDER BY m.member_entity_id) member_entity_ids,
      array_agg(DISTINCT p.journal_entry_id ORDER BY p.journal_entry_id) FILTER(WHERE p.ledger_line_id IS NOT NULL) journal_entry_ids,
      array_agg(DISTINCT p.journal_line_id ORDER BY p.journal_line_id) FILTER(WHERE p.ledger_line_id IS NOT NULL) journal_line_ids,
      array_agg(DISTINCT p.ledger_line_id ORDER BY p.ledger_line_id) FILTER(WHERE p.ledger_line_id IS NOT NULL) ledger_line_ids
    FROM maps m LEFT JOIN posted p ON p.member_entity_id=m.member_entity_id AND p.presentation_account_code=m.presentation_account_code AND p.presentation_side=m.presentation_side
    GROUP BY m.presentation_account_code,m.presentation_side
  ), eliminations AS (
    SELECT e.presentation_account_code,e.presentation_side,count(*)::integer elimination_count,COALESCE(sum(e.elimination_amount),0)::numeric(20,4) elimination_amount,array_agg(e.elimination_ref ORDER BY e.elimination_ref) elimination_refs
    FROM public.consolidation_elimination_evidence e WHERE e.consolidation_snapshot_id=v_snapshot.consolidation_snapshot_id GROUP BY e.presentation_account_code,e.presentation_side
  ), retained AS (
    SELECT a.*,ARRAY(SELECT DISTINCT sl.source_document_id FROM public.source_link sl WHERE sl.tenant_id=p_tenant AND sl.entity_id=ANY(a.member_entity_ids) AND sl.source_document_id IS NOT NULL AND sl.journal_entry_id=ANY(COALESCE(a.journal_entry_ids,ARRAY[]::uuid[])) ORDER BY sl.source_document_id)::uuid[] source_document_ids
    FROM actual a
  )
  SELECT v_snapshot.group_ref,v_period.period_id,v_period.period_code,to_char(v_period.starts_on,'YYYY-MM-DD'),to_char(v_period.ends_on,'YYYY-MM-DD'),v_snapshot.currency,
    r.presentation_account_code,r.presentation_side,
    CASE WHEN NOT v_authorized THEN 'BLOCKED_MEMBER_SCOPE_REQUIRED'
      WHEN NOT v_scope_valid THEN 'BLOCKED_MEMBER_PERIOD_OR_CURRENCY_REQUIRED'
      WHEN r.member_count=0 OR r.evidence_member_count<>r.member_count THEN 'BLOCKED_MEMBER_POSTED_EVIDENCE_REQUIRED'
      WHEN COALESCE(e.elimination_count,0)=0 THEN 'BLOCKED_ELIMINATION_EVIDENCE_REQUIRED'
      ELSE 'APPROVED_CONSOLIDATION_SNAPSHOT_AND_POSTED_LEDGER_EXACT' END,
    CASE WHEN v_authorized AND v_scope_valid AND r.member_count>0 AND r.evidence_member_count=r.member_count AND COALESCE(e.elimination_count,0)>0 THEN 'APPROVED_IMMUTABLE_GROUP_MEMBER_MAPPING_ELIMINATION_AND_POSTED_LEDGER_EXACT' ELSE 'IMMUTABLE_GROUP_MEMBER_MAPPING_ELIMINATION_AND_POSTED_LEDGER_EVIDENCE_REQUIRED' END,
    r.member_count,r.evidence_member_count,
    CASE WHEN v_authorized AND v_scope_valid AND r.member_count>0 AND r.evidence_member_count=r.member_count AND COALESCE(e.elimination_count,0)>0 THEN r.member_actual_amount ELSE NULL END,
    CASE WHEN v_authorized AND v_scope_valid AND r.member_count>0 AND r.evidence_member_count=r.member_count AND COALESCE(e.elimination_count,0)>0 THEN e.elimination_amount ELSE NULL END,
    CASE WHEN v_authorized AND v_scope_valid AND r.member_count>0 AND r.evidence_member_count=r.member_count AND COALESCE(e.elimination_count,0)>0 THEN r.member_actual_amount-e.elimination_amount ELSE NULL END,
    v_snapshot.consolidation_snapshot_id,v_snapshot.version::text,v_snapshot.snapshot_hash,v_snapshot.receipt_hash,v_snapshot.source_ref,v_snapshot.source_version,
    r.member_entity_ids,r.journal_entry_ids,r.journal_line_ids,r.ledger_line_ids,r.source_document_ids,COALESCE(e.elimination_refs,ARRAY[]::text[])
  FROM retained r LEFT JOIN eliminations e ON e.presentation_account_code=r.presentation_account_code AND e.presentation_side=r.presentation_side
  ORDER BY r.presentation_account_code,r.presentation_side;
END;$$;

REVOKE ALL ON consolidation_snapshot,consolidation_member,consolidation_account_map,consolidation_elimination_evidence FROM PUBLIC,refs_app;
REVOKE ALL ON FUNCTION refs_get_consolidation(uuid,uuid,uuid,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION refs_get_consolidation(uuid,uuid,uuid,text) TO refs_app;
COMMIT;
