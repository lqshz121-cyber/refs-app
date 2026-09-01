BEGIN;

-- Migration 297 deliberately rejected a second statutory identity.  Revision
-- 298 replaces that single-version constraint with an immutable, signed chain.
DROP INDEX wbs_final1_payable_tax_statement_identity_uniq;
CREATE INDEX wbs_final1_payable_tax_statement_identity_idx ON wbs_final1_payable_document_evidence(
  tenant_id,entity_id,taxing_jurisdiction,tax_statement_identifier,controlled_property_ref,parcel_identifier,tax_coverage_period_start,tax_coverage_period_end
) WHERE document_kind='TAX_STATEMENT';

CREATE TABLE wbs_final1_payable_document_revision (
  wbs_final1_payable_document_revision_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant(tenant_id),
  entity_id uuid NOT NULL,
  wbs_final1_payable_document_evidence_id uuid NOT NULL REFERENCES wbs_final1_payable_document_evidence(wbs_final1_payable_document_evidence_id),
  wbs_final1_retained_source_row_id uuid NOT NULL,
  source_document_id uuid NOT NULL,
  source_document_line_id uuid NOT NULL,
  accounting_period_id uuid NOT NULL,
  source_record_id text NOT NULL CHECK(length(btrim(source_record_id)) BETWEEN 1 AND 512),
  source_version text NOT NULL CHECK(length(btrim(source_version)) BETWEEN 1 AND 512),
  source_line_hash text NOT NULL CHECK(source_line_hash~'^sha256:[0-9a-f]{64}$'),
  currency char(3) NOT NULL CHECK(currency~'^[A-Z]{3}$'),
  revision_schema_version text NOT NULL CHECK(revision_schema_version='WBS_FINAL1_PAYABLE_DOCUMENT_REVISION_V1'),
  revision_kind text NOT NULL CHECK(revision_kind IN('ORIGINAL','CORRECTION')),
  document_revision integer NOT NULL CHECK(document_revision>=1),
  statutory_identity_hash text NOT NULL CHECK(statutory_identity_hash~'^sha256:[0-9a-f]{64}$'),
  document_evidence_hash text NOT NULL CHECK(document_evidence_hash~'^sha256:[0-9a-f]{64}$'),
  predecessor_document_revision_id uuid,
  predecessor_document_evidence_hash text CHECK(predecessor_document_evidence_hash IS NULL OR predecessor_document_evidence_hash~'^sha256:[0-9a-f]{64}$'),
  predecessor_document_revision_hash text CHECK(predecessor_document_revision_hash IS NULL OR predecessor_document_revision_hash~'^sha256:[0-9a-f]{64}$'),
  predecessor_document_revision integer CHECK(predecessor_document_revision IS NULL OR predecessor_document_revision>=1),
  predecessor_source_record_id text CHECK(predecessor_source_record_id IS NULL OR length(btrim(predecessor_source_record_id)) BETWEEN 1 AND 512),
  revision_hash text NOT NULL UNIQUE CHECK(revision_hash~'^sha256:[0-9a-f]{64}$'),
  retention_origin text NOT NULL CHECK(retention_origin IN('BACKFILL_297','SIGNED_FINAL1_298')),
  created_by text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE(tenant_id,entity_id,wbs_final1_payable_document_revision_id),
  UNIQUE(tenant_id,entity_id,wbs_final1_payable_document_evidence_id),
  UNIQUE(tenant_id,entity_id,statutory_identity_hash,document_revision),
  FOREIGN KEY(tenant_id,entity_id) REFERENCES entity(tenant_id,entity_id),
  FOREIGN KEY(tenant_id,entity_id,wbs_final1_retained_source_row_id) REFERENCES wbs_final1_retained_source_row(tenant_id,entity_id,wbs_final1_retained_source_row_id),
  FOREIGN KEY(tenant_id,entity_id,source_document_id) REFERENCES source_document(tenant_id,entity_id,source_document_id),
  FOREIGN KEY(tenant_id,entity_id,source_document_line_id) REFERENCES source_document_line(tenant_id,entity_id,source_document_line_id),
  FOREIGN KEY(tenant_id,entity_id,accounting_period_id) REFERENCES accounting_period(tenant_id,entity_id,period_id),
  FOREIGN KEY(tenant_id,entity_id,predecessor_document_revision_id) REFERENCES wbs_final1_payable_document_revision(tenant_id,entity_id,wbs_final1_payable_document_revision_id),
  CHECK((revision_kind='ORIGINAL' AND document_revision=1 AND predecessor_document_revision_id IS NULL
      AND predecessor_document_evidence_hash IS NULL AND predecessor_document_revision_hash IS NULL
      AND predecessor_document_revision IS NULL AND predecessor_source_record_id IS NULL)
    OR (revision_kind='CORRECTION' AND document_revision>1 AND predecessor_document_revision_id IS NOT NULL
      AND predecessor_document_evidence_hash IS NOT NULL AND predecessor_document_revision_hash IS NOT NULL
      AND predecessor_document_revision=document_revision-1 AND predecessor_source_record_id IS NOT NULL))
);
CREATE UNIQUE INDEX wbs_final1_payable_document_revision_successor_uniq
  ON wbs_final1_payable_document_revision(tenant_id,entity_id,predecessor_document_revision_id)
  WHERE predecessor_document_revision_id IS NOT NULL;
ALTER TABLE wbs_final1_payable_document_revision ENABLE ROW LEVEL SECURITY;
CREATE POLICY wbs_final1_payable_document_revision_scope ON wbs_final1_payable_document_revision
  USING(tenant_id=refs_current_tenant() AND refs_entity_allowed(entity_id))
  WITH CHECK(tenant_id=refs_current_tenant() AND refs_entity_allowed(entity_id));
CREATE TRIGGER wbs_final1_payable_document_revision_append_only BEFORE UPDATE OR DELETE ON wbs_final1_payable_document_revision FOR EACH ROW EXECUTE FUNCTION reject_mutation();

CREATE FUNCTION refs_wbs_final1_payable_document_identity_hash(
  p_tenant uuid,p_entity uuid,p_currency text,p_jurisdiction text,p_statement text,
  p_coverage_start date,p_coverage_end date,p_property text,p_parcel text
) RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT refs_jsonb_hash(jsonb_build_object('schema_version','WBS_FINAL1_PAYABLE_DOCUMENT_IDENTITY_V1',
    'tenant_id',p_tenant,'entity_id',p_entity,'currency',p_currency,'taxing_jurisdiction',p_jurisdiction,
    'tax_statement_identifier',p_statement,'tax_coverage_period_start',p_coverage_start,
    'tax_coverage_period_end',p_coverage_end,'controlled_property_ref',p_property,'parcel_identifier',p_parcel))
$$;

CREATE FUNCTION refs_wbs_final1_payable_document_revision_hash(
  p_tenant uuid,p_entity uuid,p_evidence uuid,p_retained_row uuid,p_source_document uuid,p_source_line uuid,
  p_period uuid,p_source_record text,p_source_version text,p_source_line_hash text,p_currency text,
  p_identity_hash text,p_evidence_hash text,p_kind text,p_revision integer,p_predecessor_id uuid,
  p_predecessor_evidence_hash text,p_predecessor_revision_hash text,p_predecessor_revision integer,p_predecessor_source_record text
) RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT refs_jsonb_hash(jsonb_build_object('schema_version','WBS_FINAL1_PAYABLE_DOCUMENT_REVISION_V1',
    'tenant_id',p_tenant,'entity_id',p_entity,'document_evidence_id',p_evidence,'retained_source_row_id',p_retained_row,
    'source_document_id',p_source_document,'source_document_line_id',p_source_line,'accounting_period_id',p_period,
    'source_record_id',p_source_record,'source_version',p_source_version,'source_line_hash',p_source_line_hash,
    'currency',p_currency,'statutory_identity_hash',p_identity_hash,'document_evidence_hash',p_evidence_hash,
    'revision_kind',p_kind,'document_revision',p_revision,'predecessor_document_revision_id',p_predecessor_id,
    'predecessor_document_evidence_hash',p_predecessor_evidence_hash,'predecessor_document_revision_hash',p_predecessor_revision_hash,
    'predecessor_document_revision',p_predecessor_revision,'predecessor_source_record_id',p_predecessor_source_record))
$$;

-- Every 297 TAX_STATEMENT is the immutable first revision of its chain.
INSERT INTO wbs_final1_payable_document_revision(
  tenant_id,entity_id,wbs_final1_payable_document_evidence_id,wbs_final1_retained_source_row_id,
  source_document_id,source_document_line_id,accounting_period_id,source_record_id,source_version,source_line_hash,
  currency,revision_schema_version,revision_kind,document_revision,statutory_identity_hash,document_evidence_hash,
  revision_hash,retention_origin,created_by,created_at
)
SELECT e.tenant_id,e.entity_id,e.wbs_final1_payable_document_evidence_id,e.wbs_final1_retained_source_row_id,
  e.source_document_id,e.source_document_line_id,r.accounting_period_id,r.source_record_id,r.source_version,e.source_line_hash,
  d.currency,'WBS_FINAL1_PAYABLE_DOCUMENT_REVISION_V1','ORIGINAL',1,
  refs_wbs_final1_payable_document_identity_hash(e.tenant_id,e.entity_id,d.currency::text,e.taxing_jurisdiction,e.tax_statement_identifier,e.tax_coverage_period_start,e.tax_coverage_period_end,e.controlled_property_ref,e.parcel_identifier),
  e.evidence_hash,
  refs_wbs_final1_payable_document_revision_hash(e.tenant_id,e.entity_id,e.wbs_final1_payable_document_evidence_id,e.wbs_final1_retained_source_row_id,e.source_document_id,e.source_document_line_id,r.accounting_period_id,r.source_record_id,r.source_version,e.source_line_hash,d.currency::text,
    refs_wbs_final1_payable_document_identity_hash(e.tenant_id,e.entity_id,d.currency::text,e.taxing_jurisdiction,e.tax_statement_identifier,e.tax_coverage_period_start,e.tax_coverage_period_end,e.controlled_property_ref,e.parcel_identifier),e.evidence_hash,'ORIGINAL',1,NULL,NULL,NULL,NULL,NULL),
  'BACKFILL_297',e.created_by,e.created_at
FROM wbs_final1_payable_document_evidence e
JOIN wbs_final1_retained_source_row r ON r.tenant_id=e.tenant_id AND r.entity_id=e.entity_id AND r.wbs_final1_retained_source_row_id=e.wbs_final1_retained_source_row_id
JOIN source_document d ON d.tenant_id=e.tenant_id AND d.entity_id=e.entity_id AND d.source_document_id=e.source_document_id
WHERE e.document_kind='TAX_STATEMENT';

CREATE VIEW wbs_final1_payable_document_revision_current WITH (security_barrier=true,security_invoker=true) AS
SELECT r.*,'CURRENT'::text AS lifecycle_status
FROM wbs_final1_payable_document_revision r
WHERE NOT EXISTS(SELECT 1 FROM wbs_final1_payable_document_revision successor
  WHERE successor.tenant_id=r.tenant_id AND successor.entity_id=r.entity_id
    AND successor.predecessor_document_revision_id=r.wbs_final1_payable_document_revision_id);

ALTER FUNCTION refs_retain_wbs_final1_source_evidence_with_signed_controls(uuid,uuid,jsonb,jsonb,jsonb,text,text)
  RENAME TO refs_retain_wbs_final1_source_evidence_with_signed_controls_v297;
REVOKE ALL ON FUNCTION refs_retain_wbs_final1_source_evidence_with_signed_controls_v297(uuid,uuid,jsonb,jsonb,jsonb,text,text) FROM PUBLIC,refs_app;

CREATE FUNCTION refs_retain_wbs_final1_source_evidence_with_signed_controls(
  p_tenant uuid,p_entity uuid,p_delivery jsonb,p_artifacts jsonb,p_plan jsonb,p_idempotency_key text,p_request_hash text
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE
  v_result jsonb; v_row jsonb; v_raw jsonb; v_actor text:=refs_current_actor();
  v_retained wbs_final1_retained_source_row; v_evidence wbs_final1_payable_document_evidence;
  v_predecessor wbs_final1_payable_document_revision; v_existing wbs_final1_payable_document_revision;
  v_kind text; v_revision integer; v_predecessor_revision integer; v_predecessor_evidence_hash text;
  v_predecessor_revision_hash text; v_predecessor_source_record text; v_identity_hash text; v_revision_hash text;
  v_revision_id uuid; v_currency text; v_payload jsonb;
  v_revision_keys text[]:=ARRAY['document_revision_schema_version','document_revision_kind','document_revision','predecessor_document_evidence_hash','predecessor_document_revision_hash','predecessor_document_revision','predecessor_source_record_id'];
BEGIN
  IF p_delivery->>'domain'='PAYABLES' THEN
    IF jsonb_typeof(p_plan->'staging_rows') IS DISTINCT FROM 'array' THEN RAISE EXCEPTION 'Document revision retention requires the exact Payables population' USING ERRCODE='22023'; END IF;
    FOR v_row IN SELECT value FROM jsonb_array_elements(p_plan->'staging_rows') LOOP
      v_raw:=v_row->'raw_row';
      IF jsonb_typeof(v_raw) IS DISTINCT FROM 'object' THEN RAISE EXCEPTION 'Signed payable raw_row must be a closed JSON object' USING ERRCODE='23514'; END IF;
      IF v_raw->>'document_kind'='TAX_STATEMENT' THEN
        IF NOT (v_raw ?& v_revision_keys) OR v_raw->>'document_revision_schema_version' IS DISTINCT FROM 'WBS_FINAL1_PAYABLE_DOCUMENT_REVISION_V1'
          OR v_raw->>'document_revision_kind' IS NULL OR v_raw->>'document_revision_kind' NOT IN('ORIGINAL','CORRECTION','WITHDRAWN')
          OR COALESCE(v_raw->>'document_revision','')!~'^[1-9][0-9]{0,8}$' THEN
          RAISE EXCEPTION 'Signed tax-statement revision evidence is incomplete, unversioned, or unknown' USING ERRCODE='23514';
        END IF;
        IF v_raw->>'document_revision_kind'='WITHDRAWN' THEN RAISE EXCEPTION 'WITHDRAWN tax statements are not accepted as accounting evidence' USING ERRCODE='23514'; END IF;
        v_kind:=v_raw->>'document_revision_kind';v_revision:=(v_raw->>'document_revision')::integer;
        IF v_kind='ORIGINAL' AND (v_revision<>1 OR EXISTS(SELECT 1 FROM unnest(v_revision_keys[4:7]) key WHERE v_raw->key<>'null'::jsonb)) THEN
          RAISE EXCEPTION 'An ORIGINAL tax statement must be revision 1 with explicit null predecessor evidence' USING ERRCODE='23514';
        END IF;
        IF v_kind='CORRECTION' AND (v_revision<2 OR COALESCE(v_raw->>'predecessor_document_evidence_hash','')!~'^sha256:[0-9a-f]{64}$'
          OR COALESCE(v_raw->>'predecessor_document_revision_hash','')!~'^sha256:[0-9a-f]{64}$' OR COALESCE(v_raw->>'predecessor_document_revision','')!~'^[1-9][0-9]{0,8}$'
          OR (v_raw->>'predecessor_document_revision')::integer<>v_revision-1 OR length(btrim(COALESCE(v_raw->>'predecessor_source_record_id',''))) NOT BETWEEN 1 AND 512) THEN
          RAISE EXCEPTION 'A CORRECTION requires the exact immediately preceding signed revision' USING ERRCODE='23514';
        END IF;
      ELSIF v_raw ?| v_revision_keys THEN
        RAISE EXCEPTION 'Document revision evidence is allowed only for a signed TAX_STATEMENT' USING ERRCODE='23514';
      END IF;
    END LOOP;
  END IF;

  v_result:=refs_retain_wbs_final1_source_evidence_with_signed_controls_v297(p_tenant,p_entity,p_delivery,p_artifacts,p_plan,p_idempotency_key,p_request_hash);
  IF p_delivery->>'domain'<>'PAYABLES' THEN RETURN v_result; END IF;

  FOR v_row IN SELECT value FROM jsonb_array_elements(p_plan->'staging_rows') LOOP
    v_raw:=v_row->'raw_row';
    IF v_raw->>'document_kind'<>'TAX_STATEMENT' THEN CONTINUE; END IF;
    SELECT * INTO STRICT v_retained FROM wbs_final1_retained_source_row r
      WHERE r.tenant_id=p_tenant AND r.entity_id=p_entity AND r.wbs_final1_retained_evidence_admission_id=(v_result->>'admission_id')::uuid
        AND r.domain='PAYABLES' AND r.source_row_ordinal=(v_row->>'source_row_ordinal')::integer
        AND r.source_record_id=v_row->>'source_record_id' AND r.raw_row_hash=v_row->>'raw_row_hash';
    SELECT * INTO STRICT v_evidence FROM wbs_final1_payable_document_evidence e
      WHERE e.tenant_id=p_tenant AND e.entity_id=p_entity AND e.wbs_final1_retained_source_row_id=v_retained.wbs_final1_retained_source_row_id
        AND e.document_kind='TAX_STATEMENT';
    SELECT d.currency::text INTO STRICT v_currency FROM source_document d
      WHERE d.tenant_id=p_tenant AND d.entity_id=p_entity AND d.source_document_id=v_retained.source_document_id;
    IF NOT EXISTS(SELECT 1 FROM raw_event e WHERE e.tenant_id=p_tenant AND e.entity_id=p_entity AND e.raw_event_id=v_retained.raw_event_id
      AND e.source_record_id=v_retained.source_record_id AND e.source_version=v_retained.source_version AND e.is_current) THEN
      RAISE EXCEPTION 'New tax-statement source record is not the exact current retained event' USING ERRCODE='40001';
    END IF;

    v_kind:=v_raw->>'document_revision_kind';v_revision:=(v_raw->>'document_revision')::integer;
    v_predecessor_evidence_hash:=NULLIF(v_raw->>'predecessor_document_evidence_hash','');
    v_predecessor_revision_hash:=NULLIF(v_raw->>'predecessor_document_revision_hash','');
    v_predecessor_revision:=NULLIF(v_raw->>'predecessor_document_revision','')::integer;
    v_predecessor_source_record:=NULLIF(btrim(v_raw->>'predecessor_source_record_id'),'');
    v_identity_hash:=refs_wbs_final1_payable_document_identity_hash(p_tenant,p_entity,v_currency,v_evidence.taxing_jurisdiction,v_evidence.tax_statement_identifier,v_evidence.tax_coverage_period_start,v_evidence.tax_coverage_period_end,v_evidence.controlled_property_ref,v_evidence.parcel_identifier);
    PERFORM pg_advisory_xact_lock(hashtextextended(v_identity_hash,0));

    v_predecessor.wbs_final1_payable_document_revision_id:=NULL;
    IF v_kind='ORIGINAL' THEN
      IF EXISTS(SELECT 1 FROM wbs_final1_payable_document_revision r WHERE r.tenant_id=p_tenant AND r.entity_id=p_entity AND r.statutory_identity_hash=v_identity_hash) THEN
        SELECT * INTO v_existing FROM wbs_final1_payable_document_revision r WHERE r.tenant_id=p_tenant AND r.entity_id=p_entity AND r.wbs_final1_payable_document_evidence_id=v_evidence.wbs_final1_payable_document_evidence_id;
        IF NOT FOUND THEN RAISE EXCEPTION 'A current ORIGINAL already exists for this statutory identity' USING ERRCODE='23505'; END IF;
      END IF;
    ELSE
      SELECT * INTO v_predecessor FROM wbs_final1_payable_document_revision r WHERE r.revision_hash=v_predecessor_revision_hash FOR SHARE;
      IF NOT FOUND OR v_predecessor.tenant_id<>p_tenant OR v_predecessor.entity_id<>p_entity OR v_predecessor.accounting_period_id<>v_retained.accounting_period_id OR v_predecessor.statutory_identity_hash<>v_identity_hash
        OR v_predecessor.document_revision<>v_predecessor_revision OR v_predecessor.document_evidence_hash<>v_predecessor_evidence_hash
        OR v_predecessor.source_record_id<>v_predecessor_source_record OR v_predecessor.source_record_id=v_retained.source_record_id THEN
        RAISE EXCEPTION 'Correction predecessor is missing, cross-scope, stale, or identity-mismatched' USING ERRCODE='23514';
      END IF;
      IF EXISTS(SELECT 1 FROM wbs_final1_payable_document_revision successor WHERE successor.tenant_id=p_tenant AND successor.entity_id=p_entity AND successor.predecessor_document_revision_id=v_predecessor.wbs_final1_payable_document_revision_id) THEN
        RAISE EXCEPTION 'Correction predecessor is no longer the current revision' USING ERRCODE='40001';
      END IF;
      IF NOT EXISTS(SELECT 1 FROM wbs_final1_retained_source_row rr JOIN raw_event re ON re.tenant_id=rr.tenant_id AND re.entity_id=rr.entity_id AND re.raw_event_id=rr.raw_event_id
        WHERE rr.tenant_id=p_tenant AND rr.entity_id=p_entity AND rr.wbs_final1_retained_source_row_id=v_predecessor.wbs_final1_retained_source_row_id
          AND rr.source_record_id=v_predecessor.source_record_id AND rr.source_version=v_predecessor.source_version AND re.is_current) THEN
        RAISE EXCEPTION 'Correction predecessor source record is no longer current' USING ERRCODE='40001';
      END IF;
      IF EXISTS(SELECT 1 FROM business_document b WHERE b.tenant_id=p_tenant AND b.entity_id=p_entity AND b.source_document_id=v_predecessor.source_document_id)
        OR EXISTS(SELECT 1 FROM source_link sl WHERE sl.tenant_id=p_tenant AND sl.entity_id=p_entity AND sl.source_document_id=v_predecessor.source_document_id AND sl.journal_entry_id IS NOT NULL) THEN
        RAISE EXCEPTION 'A booked tax statement cannot be superseded by source retention' USING ERRCODE='40001';
      END IF;
    END IF;

    v_revision_hash:=refs_wbs_final1_payable_document_revision_hash(p_tenant,p_entity,v_evidence.wbs_final1_payable_document_evidence_id,v_retained.wbs_final1_retained_source_row_id,v_retained.source_document_id,v_retained.source_document_line_id,v_retained.accounting_period_id,v_retained.source_record_id,v_retained.source_version,v_retained.raw_row_hash,v_currency,v_identity_hash,v_evidence.evidence_hash,v_kind,v_revision,v_predecessor.wbs_final1_payable_document_revision_id,v_predecessor_evidence_hash,v_predecessor_revision_hash,v_predecessor_revision,v_predecessor_source_record);
    SELECT * INTO v_existing FROM wbs_final1_payable_document_revision r WHERE r.tenant_id=p_tenant AND r.entity_id=p_entity AND r.wbs_final1_payable_document_evidence_id=v_evidence.wbs_final1_payable_document_evidence_id;
    IF FOUND THEN
      IF v_existing.revision_hash<>v_revision_hash THEN RAISE EXCEPTION 'Signed document revision replay drifted' USING ERRCODE='23505'; END IF;
      CONTINUE;
    END IF;
    INSERT INTO wbs_final1_payable_document_revision(tenant_id,entity_id,wbs_final1_payable_document_evidence_id,wbs_final1_retained_source_row_id,source_document_id,source_document_line_id,accounting_period_id,source_record_id,source_version,source_line_hash,currency,revision_schema_version,revision_kind,document_revision,statutory_identity_hash,document_evidence_hash,predecessor_document_revision_id,predecessor_document_evidence_hash,predecessor_document_revision_hash,predecessor_document_revision,predecessor_source_record_id,revision_hash,retention_origin,created_by)
      VALUES(p_tenant,p_entity,v_evidence.wbs_final1_payable_document_evidence_id,v_retained.wbs_final1_retained_source_row_id,v_retained.source_document_id,v_retained.source_document_line_id,v_retained.accounting_period_id,v_retained.source_record_id,v_retained.source_version,v_retained.raw_row_hash,v_currency,'WBS_FINAL1_PAYABLE_DOCUMENT_REVISION_V1',v_kind,v_revision,v_identity_hash,v_evidence.evidence_hash,v_predecessor.wbs_final1_payable_document_revision_id,v_predecessor_evidence_hash,v_predecessor_revision_hash,v_predecessor_revision,v_predecessor_source_record,v_revision_hash,'SIGNED_FINAL1_298',v_actor)
      RETURNING wbs_final1_payable_document_revision_id INTO v_revision_id;
    v_payload:=jsonb_build_object('schema_version','WBS_FINAL1_PAYABLE_DOCUMENT_REVISION_V1','document_revision_id',v_revision_id,'document_evidence_id',v_evidence.wbs_final1_payable_document_evidence_id,'statutory_identity_hash',v_identity_hash,'revision_kind',v_kind,'document_revision',v_revision,'revision_hash',v_revision_hash,'predecessor_document_revision_id',v_predecessor.wbs_final1_payable_document_revision_id,'lifecycle_status','CURRENT','can_create_draft',false,'can_review',false,'can_approve',false,'can_post',false);
    INSERT INTO audit_event(tenant_id,entity_id,event_type,object_type,object_id,action,actor_id,actor_type,permission_used,request_id,correlation_id,idempotency_key,after_hash,reason,metadata)
      VALUES(p_tenant,p_entity,'WBS_FINAL1_PAYABLE_DOCUMENT_REVISION_RETAINED','WBS_FINAL1_PAYABLE_DOCUMENT_REVISION',v_revision_id,'RETAIN',v_actor,'SERVICE_ACCOUNT','WBS.SNAPSHOT.IMPORT',p_idempotency_key,p_idempotency_key,p_idempotency_key,v_revision_hash,'Provider-signed tax-statement revision retained without accounting action',v_payload);
    INSERT INTO outbox_event(tenant_id,entity_id,aggregate_type,aggregate_id,event_type,payload,payload_hash)
      VALUES(p_tenant,p_entity,'WBS_FINAL1_PAYABLE_DOCUMENT_REVISION',v_revision_id,'WBS_FINAL1_PAYABLE_DOCUMENT_REVISION_RETAINED',v_payload,refs_jsonb_hash(v_payload));
  END LOOP;
  RETURN v_result;
END $$;

CREATE FUNCTION refs_read_wbs_final1_payable_document_revisions(p_tenant uuid,p_entity uuid,p_identity_hash text DEFAULT NULL,p_limit integer DEFAULT 100)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE result jsonb;
BEGIN
  PERFORM refs_assert_scope(p_tenant,p_entity,'WBS.PAYABLE.REVIEW');
  IF p_identity_hash IS NOT NULL AND p_identity_hash!~'^sha256:[0-9a-f]{64}$' OR p_limit IS NULL OR p_limit<1 OR p_limit>500 THEN RAISE EXCEPTION 'Document revision read scope is invalid' USING ERRCODE='22023'; END IF;
  SELECT jsonb_build_object('schema_version','WBS_FINAL1_PAYABLE_DOCUMENT_REVISION_PAGE_V1','tenant_id',p_tenant,'entity_id',p_entity,'read_count',count(*),
    'rows',COALESCE(jsonb_agg(row_document ORDER BY document_revision DESC,document_revision_id DESC),'[]'::jsonb),
    'action_flags',jsonb_build_object('can_create_draft',false,'can_review',false,'can_approve',false,'can_post',false)) INTO result
  FROM (SELECT r.document_revision AS document_revision,r.wbs_final1_payable_document_revision_id AS document_revision_id,
      jsonb_build_object('document_revision_id',r.wbs_final1_payable_document_revision_id,'document_evidence_id',r.wbs_final1_payable_document_evidence_id,
        'source_document_id',r.source_document_id,'source_document_line_id',r.source_document_line_id,'accounting_period_id',r.accounting_period_id,
        'source_record_id',r.source_record_id,'source_version',r.source_version,'source_line_hash',r.source_line_hash,'currency',r.currency,
        'statutory_identity_hash',r.statutory_identity_hash,'revision_kind',r.revision_kind,'document_revision',r.document_revision,
        'document_evidence_hash',r.document_evidence_hash,'revision_hash',r.revision_hash,'predecessor_document_revision_id',r.predecessor_document_revision_id,
        'predecessor_document_evidence_hash',r.predecessor_document_evidence_hash,'predecessor_document_revision_hash',r.predecessor_document_revision_hash,
        'predecessor_document_revision',r.predecessor_document_revision,'predecessor_source_record_id',r.predecessor_source_record_id,
        'lifecycle_status',CASE WHEN successor.wbs_final1_payable_document_revision_id IS NULL THEN 'CURRENT' ELSE 'SUPERSEDED' END,
        'taxing_jurisdiction',e.taxing_jurisdiction,'tax_statement_identifier',e.tax_statement_identifier,
        'tax_coverage_period_start',e.tax_coverage_period_start,'tax_coverage_period_end',e.tax_coverage_period_end,
        'tax_obligation_basis',e.tax_obligation_basis,'controlled_property_ref',e.controlled_property_ref,'parcel_identifier',e.parcel_identifier,
        'created_at',r.created_at,'can_create_draft',false,'can_review',false,'can_approve',false,'can_post',false) row_document
    FROM wbs_final1_payable_document_revision r
    JOIN wbs_final1_payable_document_evidence e ON e.tenant_id=r.tenant_id AND e.entity_id=r.entity_id AND e.wbs_final1_payable_document_evidence_id=r.wbs_final1_payable_document_evidence_id
    LEFT JOIN wbs_final1_payable_document_revision successor ON successor.tenant_id=r.tenant_id AND successor.entity_id=r.entity_id AND successor.predecessor_document_revision_id=r.wbs_final1_payable_document_revision_id
    WHERE r.tenant_id=p_tenant AND r.entity_id=p_entity AND (p_identity_hash IS NULL OR r.statutory_identity_hash=p_identity_hash)
    ORDER BY r.document_revision DESC,r.wbs_final1_payable_document_revision_id DESC LIMIT p_limit) rows;
  RETURN result;
END $$;

-- Classification V4 is a complete current-only population.  It deliberately
-- does not call V3 because V3's bound counts superseded source rows.
CREATE FUNCTION refs_read_ai_invoice_classification_source_v4(p_tenant uuid,p_entity uuid,p_period uuid,p_limit integer DEFAULT 100)
RETURNS TABLE(source_document_id uuid,source_document_line_id uuid,source_payload_hash text,source_line_hash text,entity_id uuid,accounting_period_id uuid,accounting_date date,vendor_ref text,vendor_member_ref text,invoice_no text,invoice_date date,currency text,amount text,service_period_start date,service_period_end date,description text,project_ref text,property_ref text,member_ref text,charge_code text,contract_id text,service_frequency text,source_attachment_count integer,source_attachment_ids uuid[],source_attachment_evidence jsonb,accounting_status text,posted_debit_account_classes text[],document_evidence_status text,document_evidence_schema_version text,document_evidence_hash text,document_kind text,taxing_jurisdiction text,tax_statement_identifier text,tax_coverage_period_start date,tax_coverage_period_end date,tax_obligation_basis text,controlled_property_ref text,parcel_identifier text,document_revision_schema_version text,document_revision_kind text,document_revision integer,predecessor_document_evidence_hash text,predecessor_document_revision_hash text,predecessor_document_revision integer,predecessor_source_record_id text,document_revision_hash text,document_lifecycle_status text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
BEGIN
  PERFORM refs_assert_scope(p_tenant,p_entity,'AI.ANALYSIS.EXPLAIN');
  IF p_limit IS NULL OR p_limit<1 OR p_limit>500 THEN RAISE EXCEPTION 'AI invoice classification source limit must be between 1 and 500' USING ERRCODE='22023'; END IF;
  IF NOT EXISTS(SELECT 1 FROM accounting_period p WHERE p.tenant_id=p_tenant AND p.entity_id=p_entity AND p.period_id=p_period AND p.ledger_code='PRIMARY') THEN RAISE EXCEPTION 'Authoritative primary accounting period is unavailable' USING ERRCODE='22023'; END IF;
  IF (SELECT count(*) FROM wbs_final1_retained_source_row r JOIN raw_event re ON re.tenant_id=r.tenant_id AND re.entity_id=r.entity_id AND re.raw_event_id=r.raw_event_id AND re.is_current LEFT JOIN wbs_final1_payable_document_evidence e ON e.tenant_id=r.tenant_id AND e.entity_id=r.entity_id AND e.wbs_final1_retained_source_row_id=r.wbs_final1_retained_source_row_id LEFT JOIN wbs_final1_payable_document_revision_current c ON c.tenant_id=r.tenant_id AND c.entity_id=r.entity_id AND c.wbs_final1_payable_document_evidence_id=e.wbs_final1_payable_document_evidence_id WHERE r.tenant_id=p_tenant AND r.entity_id=p_entity AND r.accounting_period_id=p_period AND r.domain='PAYABLES' AND (e.document_kind IS DISTINCT FROM 'TAX_STATEMENT' OR c.wbs_final1_payable_document_revision_id IS NOT NULL))>p_limit THEN RAISE EXCEPTION 'Complete current invoice population exceeds the bounded classification limit' USING ERRCODE='54000'; END IF;
  RETURN QUERY SELECT d.source_document_id,l.source_document_line_id,d.payload_hash,r.raw_row_hash,p_entity,p_period,d.accounting_date,l.party_ref,
    CASE WHEN EXISTS(SELECT 1 FROM member_master mm WHERE mm.tenant_id=p_tenant AND mm.entity_id=p_entity AND mm.member_ref=l.party_ref AND mm.member_type='VENDOR' AND mm.active) THEN l.party_ref ELSE NULL END,
    d.document_no,(l.external_dimension_refs->>'signed_invoice_date')::date,d.currency::text,abs(l.amount)::text,NULLIF(l.external_dimension_refs->>'signed_service_period_start','')::date,NULLIF(l.external_dimension_refs->>'signed_service_period_end','')::date,
    NULLIF(l.external_dimension_refs->>'signed_invoice_description',''),l.project_ref,l.property_ref,NULL::text,NULLIF(l.external_dimension_refs->>'signed_charge_code',''),NULLIF(l.external_dimension_refs->>'signed_contract_id',''),NULLIF(l.external_dimension_refs->>'signed_service_frequency',''),
    (SELECT count(*)::integer FROM source_link sal JOIN attachment a ON a.tenant_id=sal.tenant_id AND a.entity_id=sal.entity_id AND a.attachment_id=sal.attachment_id WHERE sal.tenant_id=p_tenant AND sal.entity_id=p_entity AND sal.source_document_id=d.source_document_id AND sal.link_type='SOURCE_ATTACHMENT'),
    ARRAY(SELECT a.attachment_id FROM source_link sal JOIN attachment a ON a.tenant_id=sal.tenant_id AND a.entity_id=sal.entity_id AND a.attachment_id=sal.attachment_id WHERE sal.tenant_id=p_tenant AND sal.entity_id=p_entity AND sal.source_document_id=d.source_document_id AND sal.link_type='SOURCE_ATTACHMENT' ORDER BY a.attachment_id),
    COALESCE((SELECT jsonb_agg(jsonb_build_object('attachment_id',a.attachment_id,'content_hash',a.content_hash,'finalization_status',a.finalization_status,'scan_status',a.scan_status,'storage_version',a.storage_version) ORDER BY a.attachment_id) FROM source_link sal JOIN attachment a ON a.tenant_id=sal.tenant_id AND a.entity_id=sal.entity_id AND a.attachment_id=sal.attachment_id WHERE sal.tenant_id=p_tenant AND sal.entity_id=p_entity AND sal.source_document_id=d.source_document_id AND sal.link_type='SOURCE_ATTACHMENT'),'[]'::jsonb),
    CASE WHEN EXISTS(SELECT 1 FROM source_link sl JOIN journal_entry j ON j.tenant_id=sl.tenant_id AND j.entity_id=sl.entity_id AND j.journal_entry_id=sl.journal_entry_id WHERE sl.tenant_id=p_tenant AND sl.entity_id=p_entity AND sl.source_document_id=d.source_document_id AND j.status='POSTED') THEN 'POSTED' WHEN EXISTS(SELECT 1 FROM source_link sl JOIN journal_entry j ON j.tenant_id=sl.tenant_id AND j.entity_id=sl.entity_id AND j.journal_entry_id=sl.journal_entry_id WHERE sl.tenant_id=p_tenant AND sl.entity_id=p_entity AND sl.source_document_id=d.source_document_id) THEN 'DRAFT' ELSE 'NOT_RECORDED' END,
    ARRAY(SELECT DISTINCT CASE WHEN jl.account_code LIKE '1%' THEN 'ASSET' WHEN jl.account_code LIKE '2%' THEN 'LIABILITY' WHEN jl.account_code LIKE '3%' THEN 'EQUITY' WHEN jl.account_code LIKE '4%' THEN 'REVENUE' WHEN jl.account_code~'^[5-9]' THEN 'EXPENSE' ELSE 'UNCLASSIFIED' END FROM source_link sl JOIN journal_entry j ON j.tenant_id=sl.tenant_id AND j.entity_id=sl.entity_id AND j.journal_entry_id=sl.journal_entry_id JOIN journal_line jl ON jl.tenant_id=j.tenant_id AND jl.entity_id=j.entity_id AND jl.journal_entry_id=sl.journal_entry_id AND (sl.journal_line_id IS NULL OR sl.journal_line_id=jl.journal_line_id) WHERE sl.tenant_id=p_tenant AND sl.entity_id=p_entity AND sl.source_document_id=d.source_document_id AND j.status='POSTED' AND jl.debit_amount>0 ORDER BY 1),
    COALESCE(e.evidence_status,'MISSING'),e.schema_version,e.evidence_hash,e.document_kind,e.taxing_jurisdiction,e.tax_statement_identifier,e.tax_coverage_period_start,e.tax_coverage_period_end,e.tax_obligation_basis,e.controlled_property_ref,e.parcel_identifier,
    c.revision_schema_version,c.revision_kind,c.document_revision,c.predecessor_document_evidence_hash,c.predecessor_document_revision_hash,c.predecessor_document_revision,c.predecessor_source_record_id,c.revision_hash,CASE WHEN e.document_kind='TAX_STATEMENT' THEN c.lifecycle_status ELSE 'NOT_APPLICABLE' END
  FROM wbs_final1_retained_source_row r JOIN raw_event re ON re.tenant_id=r.tenant_id AND re.entity_id=r.entity_id AND re.raw_event_id=r.raw_event_id AND re.source_record_id=r.source_record_id AND re.source_version=r.source_version AND re.is_current
  JOIN source_document d ON d.tenant_id=r.tenant_id AND d.entity_id=r.entity_id AND d.source_document_id=r.source_document_id AND d.raw_event_id=re.raw_event_id
  JOIN source_document_line l ON l.tenant_id=r.tenant_id AND l.entity_id=r.entity_id AND l.source_document_line_id=r.source_document_line_id AND l.source_document_id=r.source_document_id
  LEFT JOIN wbs_final1_payable_document_evidence e ON e.tenant_id=r.tenant_id AND e.entity_id=r.entity_id AND e.wbs_final1_retained_source_row_id=r.wbs_final1_retained_source_row_id
  LEFT JOIN wbs_final1_payable_document_revision_current c ON c.tenant_id=r.tenant_id AND c.entity_id=r.entity_id AND c.wbs_final1_payable_document_evidence_id=e.wbs_final1_payable_document_evidence_id
  WHERE r.tenant_id=p_tenant AND r.entity_id=p_entity AND r.accounting_period_id=p_period AND r.domain='PAYABLES' AND (e.document_kind IS DISTINCT FROM 'TAX_STATEMENT' OR c.wbs_final1_payable_document_revision_id IS NOT NULL)
  ORDER BY d.accounting_date,d.source_document_id,l.line_no,l.source_document_line_id LIMIT p_limit;
END $$;

ALTER FUNCTION refs_read_ai_invoice_decision_population_page(uuid,uuid,uuid,date,uuid,integer,uuid,integer) RENAME TO refs_read_ai_invoice_decision_population_page_v297;
REVOKE ALL ON FUNCTION refs_read_ai_invoice_decision_population_page_v297(uuid,uuid,uuid,date,uuid,integer,uuid,integer) FROM PUBLIC,refs_app;
CREATE FUNCTION refs_read_ai_invoice_decision_population_page(p_tenant uuid,p_entity uuid,p_period uuid,p_after_date date DEFAULT NULL,p_after_document uuid DEFAULT NULL,p_after_line_no integer DEFAULT NULL,p_after_line uuid DEFAULT NULL,p_page_size integer DEFAULT 250)
RETURNS TABLE(line_no integer,source_document_id uuid,source_document_line_id uuid,source_payload_hash text,source_line_hash text,tenant_id uuid,entity_id uuid,accounting_period_id uuid,accounting_date date,vendor_ref text,vendor_member_ref text,invoice_no text,invoice_date date,currency text,amount text,service_period_start date,service_period_end date,description text,project_ref text,property_ref text,member_ref text,charge_code text,contract_id text,service_frequency text,source_attachment_count integer,source_attachment_ids uuid[],source_attachment_evidence jsonb,accounting_status text,posted_debit_account_classes text[],duplicate_status text,retained_outcome text,retained_exception_codes jsonb,source_status text,document_evidence_status text,document_evidence_schema_version text,document_evidence_hash text,document_kind text,taxing_jurisdiction text,tax_statement_identifier text,tax_coverage_period_start date,tax_coverage_period_end date,tax_obligation_basis text,controlled_property_ref text,parcel_identifier text,document_revision_schema_version text,document_revision_kind text,document_revision integer,predecessor_document_evidence_hash text,predecessor_document_revision_hash text,predecessor_document_revision integer,predecessor_source_record_id text,document_revision_hash text,document_lifecycle_status text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
BEGIN
  PERFORM refs_assert_scope(p_tenant,p_entity,'AI.ANALYSIS.EXPLAIN');
  IF p_page_size IS NULL OR p_page_size<1 OR p_page_size>500 THEN RAISE EXCEPTION 'AI decision invoice page size must be 1-500' USING ERRCODE='22023'; END IF;
  IF (p_after_date IS NULL)::integer+(p_after_document IS NULL)::integer+(p_after_line_no IS NULL)::integer+(p_after_line IS NULL)::integer NOT IN(0,4) THEN RAISE EXCEPTION 'AI decision invoice cursor must be wholly present or absent' USING ERRCODE='22023'; END IF;
  IF NOT EXISTS(SELECT 1 FROM accounting_period p WHERE p.tenant_id=p_tenant AND p.entity_id=p_entity AND p.period_id=p_period AND p.ledger_code='PRIMARY') THEN RAISE EXCEPTION 'Authoritative primary accounting period is unavailable' USING ERRCODE='22023'; END IF;
  RETURN QUERY SELECT l.line_no,d.source_document_id,l.source_document_line_id,d.payload_hash,r.raw_row_hash,p_tenant,p_entity,p_period,d.accounting_date,l.party_ref,
    CASE WHEN EXISTS(SELECT 1 FROM member_master mm WHERE mm.tenant_id=p_tenant AND mm.entity_id=p_entity AND mm.member_ref=l.party_ref AND mm.member_type='VENDOR' AND mm.active) THEN l.party_ref ELSE NULL END,
    d.document_no,(l.external_dimension_refs->>'signed_invoice_date')::date,d.currency::text,to_char(round(abs(l.amount),4),'FM999999999999999999990.0000'),NULLIF(l.external_dimension_refs->>'signed_service_period_start','')::date,NULLIF(l.external_dimension_refs->>'signed_service_period_end','')::date,
    NULLIF(l.external_dimension_refs->>'signed_invoice_description',''),l.project_ref,l.property_ref,NULL::text,NULLIF(l.external_dimension_refs->>'signed_charge_code',''),NULLIF(l.external_dimension_refs->>'signed_contract_id',''),NULLIF(l.external_dimension_refs->>'signed_service_frequency',''),
    (SELECT count(*)::integer FROM source_link sal JOIN attachment a ON a.tenant_id=sal.tenant_id AND a.entity_id=sal.entity_id AND a.attachment_id=sal.attachment_id WHERE sal.tenant_id=p_tenant AND sal.entity_id=p_entity AND sal.source_document_id=d.source_document_id AND sal.link_type='SOURCE_ATTACHMENT'),
    ARRAY(SELECT a.attachment_id FROM source_link sal JOIN attachment a ON a.tenant_id=sal.tenant_id AND a.entity_id=sal.entity_id AND a.attachment_id=sal.attachment_id WHERE sal.tenant_id=p_tenant AND sal.entity_id=p_entity AND sal.source_document_id=d.source_document_id AND sal.link_type='SOURCE_ATTACHMENT' ORDER BY a.attachment_id),
    COALESCE((SELECT jsonb_agg(jsonb_build_object('attachment_id',a.attachment_id,'content_hash',a.content_hash,'finalization_status',a.finalization_status,'scan_status',a.scan_status,'storage_version',a.storage_version) ORDER BY a.attachment_id) FROM source_link sal JOIN attachment a ON a.tenant_id=sal.tenant_id AND a.entity_id=sal.entity_id AND a.attachment_id=sal.attachment_id WHERE sal.tenant_id=p_tenant AND sal.entity_id=p_entity AND sal.source_document_id=d.source_document_id AND sal.link_type='SOURCE_ATTACHMENT'),'[]'::jsonb),
    CASE WHEN EXISTS(SELECT 1 FROM source_link sl JOIN journal_entry j ON j.tenant_id=sl.tenant_id AND j.entity_id=sl.entity_id AND j.journal_entry_id=sl.journal_entry_id WHERE sl.tenant_id=p_tenant AND sl.entity_id=p_entity AND sl.source_document_id=d.source_document_id AND j.status='POSTED') THEN 'POSTED' WHEN EXISTS(SELECT 1 FROM source_link sl JOIN journal_entry j ON j.tenant_id=sl.tenant_id AND j.entity_id=sl.entity_id AND j.journal_entry_id=sl.journal_entry_id WHERE sl.tenant_id=p_tenant AND sl.entity_id=p_entity AND sl.source_document_id=d.source_document_id) THEN 'DRAFT' ELSE 'NOT_RECORDED' END,
    ARRAY(SELECT DISTINCT CASE WHEN jl.account_code LIKE '1%' THEN 'ASSET' WHEN jl.account_code LIKE '2%' THEN 'LIABILITY' WHEN jl.account_code LIKE '3%' THEN 'EQUITY' WHEN jl.account_code LIKE '4%' THEN 'REVENUE' WHEN jl.account_code~'^[5-9]' THEN 'EXPENSE' ELSE 'UNCLASSIFIED' END FROM source_link sl JOIN journal_entry j ON j.tenant_id=sl.tenant_id AND j.entity_id=sl.entity_id AND j.journal_entry_id=sl.journal_entry_id JOIN journal_line jl ON jl.tenant_id=j.tenant_id AND jl.entity_id=j.entity_id AND jl.journal_entry_id=sl.journal_entry_id AND (sl.journal_line_id IS NULL OR sl.journal_line_id=jl.journal_line_id) WHERE sl.tenant_id=p_tenant AND sl.entity_id=p_entity AND sl.source_document_id=d.source_document_id AND j.status='POSTED' AND jl.debit_amount>0 ORDER BY 1),
    CASE WHEN EXISTS(SELECT 1 FROM ai_duplicate_payable_finding f WHERE f.tenant_id=p_tenant AND f.entity_id=p_entity AND f.status='OPEN' AND d.source_document_id IN(f.source_document_id,f.candidate_source_document_id)) THEN 'POSSIBLE' ELSE 'NONE' END,r.outcome,r.exception_codes,d.status::text,
    COALESCE(e.evidence_status,'MISSING'),e.schema_version,e.evidence_hash,e.document_kind,e.taxing_jurisdiction,e.tax_statement_identifier,e.tax_coverage_period_start,e.tax_coverage_period_end,e.tax_obligation_basis,e.controlled_property_ref,e.parcel_identifier,
    c.revision_schema_version,c.revision_kind,c.document_revision,c.predecessor_document_evidence_hash,c.predecessor_document_revision_hash,c.predecessor_document_revision,c.predecessor_source_record_id,c.revision_hash,CASE WHEN e.document_kind='TAX_STATEMENT' THEN c.lifecycle_status ELSE 'NOT_APPLICABLE' END
  FROM wbs_final1_retained_source_row r JOIN raw_event re ON re.tenant_id=r.tenant_id AND re.entity_id=r.entity_id AND re.raw_event_id=r.raw_event_id AND re.source_record_id=r.source_record_id AND re.source_version=r.source_version AND re.is_current
  JOIN source_document d ON d.tenant_id=r.tenant_id AND d.entity_id=r.entity_id AND d.source_document_id=r.source_document_id AND d.raw_event_id=re.raw_event_id
  JOIN source_document_line l ON l.tenant_id=r.tenant_id AND l.entity_id=r.entity_id AND l.source_document_line_id=r.source_document_line_id AND l.source_document_id=r.source_document_id
  LEFT JOIN wbs_final1_payable_document_evidence e ON e.tenant_id=r.tenant_id AND e.entity_id=r.entity_id AND e.wbs_final1_retained_source_row_id=r.wbs_final1_retained_source_row_id
  LEFT JOIN wbs_final1_payable_document_revision_current c ON c.tenant_id=r.tenant_id AND c.entity_id=r.entity_id AND c.wbs_final1_payable_document_evidence_id=e.wbs_final1_payable_document_evidence_id
  WHERE r.tenant_id=p_tenant AND r.entity_id=p_entity AND r.accounting_period_id=p_period AND r.domain='PAYABLES'
    AND (e.document_kind IS DISTINCT FROM 'TAX_STATEMENT' OR c.wbs_final1_payable_document_revision_id IS NOT NULL)
    AND (p_after_date IS NULL OR (d.accounting_date,d.source_document_id,l.line_no,l.source_document_line_id)>(p_after_date,p_after_document,p_after_line_no,p_after_line))
  ORDER BY d.accounting_date,d.source_document_id,l.line_no,l.source_document_line_id LIMIT p_page_size;
END $$;

ALTER FUNCTION refs_retain_ai_accounting_decision_batch(uuid,uuid,uuid,jsonb,integer,text,text,text) RENAME TO refs_retain_ai_accounting_decision_batch_v297;
REVOKE ALL ON FUNCTION refs_retain_ai_accounting_decision_batch_v297(uuid,uuid,uuid,jsonb,integer,text,text,text) FROM PUBLIC,refs_app;

CREATE FUNCTION refs_retain_ai_accounting_decision_batch(p_tenant uuid,p_entity uuid,p_period uuid,p_packets jsonb,p_population_count integer,p_population_hash text,p_idempotency_key text,p_request_hash text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE actor text:=refs_current_actor(); receipt idempotency_receipt; packet jsonb; item jsonb; receipts jsonb:='[]'::jsonb; response jsonb; expected_hash text; actual_population_hash text; actual_population_count integer; index_no integer:=0; row_count integer;
BEGIN
  PERFORM refs_assert_scope(p_tenant,p_entity,'AI.ANALYSIS.EXPLAIN');
  IF actor IS NULL THEN RAISE EXCEPTION 'Authenticated AI analysis actor missing' USING ERRCODE='42501'; END IF;
  IF jsonb_typeof(p_packets)<>'array' THEN RAISE EXCEPTION 'Decision batch packets must be an array' USING ERRCODE='22023'; END IF;
  row_count:=jsonb_array_length(p_packets);
  IF row_count>10000 THEN RAISE EXCEPTION 'Decision population exceeds 10000 packets' USING ERRCODE='22023'; END IF;
  IF NOT EXISTS(SELECT 1 FROM accounting_period WHERE tenant_id=p_tenant AND entity_id=p_entity AND period_id=p_period) THEN RAISE EXCEPTION 'Decision batch period is unavailable' USING ERRCODE='22023'; END IF;
  IF EXISTS(SELECT 1 FROM jsonb_array_elements(p_packets) x WHERE x->>'tenant_id' IS DISTINCT FROM p_tenant::text OR x->>'entity_id' IS DISTINCT FROM p_entity::text OR x->>'accounting_period_id' IS DISTINCT FROM p_period::text OR x#>>'{source,tenant_id}' IS DISTINCT FROM p_tenant::text OR x#>>'{source,entity_id}' IS DISTINCT FROM p_entity::text OR x#>>'{source,accounting_period_id}' IS DISTINCT FROM p_period::text OR x->>'accounting_date' IS DISTINCT FROM x#>>'{source,accounting_date}' OR x#>>'{action_flags,can_create_draft}' IS DISTINCT FROM 'false' OR x#>>'{action_flags,can_review}' IS DISTINCT FROM 'false' OR x#>>'{action_flags,can_approve}' IS DISTINCT FROM 'false' OR x#>>'{action_flags,can_post}' IS DISTINCT FROM 'false') THEN RAISE EXCEPTION 'Decision population scope or action contract drifted' USING ERRCODE='23514'; END IF;
  IF EXISTS(SELECT 1 FROM jsonb_array_elements(p_packets) x GROUP BY refs_jsonb_hash(x) HAVING count(*)>1) THEN RAISE EXCEPTION 'Decision population contains a duplicate canonical packet' USING ERRCODE='23514'; END IF;
  IF EXISTS(SELECT 1 FROM jsonb_array_elements(p_packets) x GROUP BY x#>>'{source,source_document_id}' HAVING count(*)>1) THEN RAISE EXCEPTION 'Decision population contains more than one decision for a retained source' USING ERRCODE='23514'; END IF;
  IF EXISTS(SELECT 1 FROM jsonb_array_elements(p_packets) x WHERE
    (x#>>'{source,source_type}'='INVOICE' AND NOT EXISTS(
      SELECT 1 FROM wbs_final1_retained_source_row r JOIN raw_event re ON re.tenant_id=r.tenant_id AND re.entity_id=r.entity_id AND re.raw_event_id=r.raw_event_id AND re.source_record_id=r.source_record_id AND re.source_version=r.source_version AND re.is_current
      JOIN source_document d ON d.tenant_id=r.tenant_id AND d.entity_id=r.entity_id AND d.source_document_id=r.source_document_id AND d.raw_event_id=re.raw_event_id
      JOIN wbs_final1_payable_document_evidence e ON e.tenant_id=r.tenant_id AND e.entity_id=r.entity_id AND e.wbs_final1_retained_source_row_id=r.wbs_final1_retained_source_row_id
      LEFT JOIN wbs_final1_payable_document_revision_current c ON c.tenant_id=e.tenant_id AND c.entity_id=e.entity_id AND c.wbs_final1_payable_document_evidence_id=e.wbs_final1_payable_document_evidence_id
      WHERE r.tenant_id=p_tenant AND r.entity_id=p_entity AND r.accounting_period_id=p_period AND r.domain='PAYABLES'
        AND r.source_document_id=(x#>>'{source,source_document_id}')::uuid AND r.source_document_line_id=(x#>>'{source,source_document_line_id}')::uuid
        AND d.payload_hash=x#>>'{source,source_payload_hash}' AND r.raw_row_hash=x#>>'{source,source_line_hash}' AND to_char(d.accounting_date,'YYYY-MM-DD')=x->>'accounting_date'
        AND (e.document_kind IS DISTINCT FROM 'TAX_STATEMENT' OR c.wbs_final1_payable_document_revision_id IS NOT NULL)))
    OR (x#>>'{source,source_type}'='LOAN_TRANSACTION' AND NOT EXISTS(SELECT 1 FROM source_document d JOIN raw_event re ON re.tenant_id=d.tenant_id AND re.entity_id=d.entity_id AND re.raw_event_id=d.raw_event_id AND re.source_record_id=d.source_record_id AND re.source_version=d.source_version AND re.is_current JOIN source_document_line l ON l.tenant_id=d.tenant_id AND l.entity_id=d.entity_id AND l.source_document_id=d.source_document_id JOIN accounting_period ap ON ap.tenant_id=d.tenant_id AND ap.entity_id=d.entity_id AND ap.period_id=p_period AND ap.ledger_code='PRIMARY' WHERE d.tenant_id=p_tenant AND d.entity_id=p_entity AND d.source_module='loan' AND d.document_type='CONSTRUCTION_LOAN_TRANSACTION' AND d.accounting_date BETWEEN ap.starts_on AND ap.ends_on AND COALESCE(l.external_dimension_refs->>'statement_balance_kind','')<>'CLOSING_PRINCIPAL_BALANCE' AND d.source_document_id=(x#>>'{source,source_document_id}')::uuid AND l.source_document_line_id=(x#>>'{source,source_document_line_id}')::uuid AND d.payload_hash=x#>>'{source,source_payload_hash}' AND refs_jsonb_hash(jsonb_build_object('schema_version','AI_CONSTRUCTION_LOAN_DECISION_SOURCE_LINE_V1','source_document_line_id',l.source_document_line_id,'source_line_id',l.source_line_id,'line_no',l.line_no,'business_date',d.business_date,'accounting_date',d.accounting_date,'currency',d.currency,'amount',l.amount,'direction',l.direction,'description',l.description,'lender_ref',l.party_ref,'loan_ref',l.loan_ref,'transaction_kind',l.external_dimension_refs->>'transaction_kind','bank_account_ref',l.bank_account_ref,'project_ref',l.project_ref,'property_ref',l.property_ref,'member_ref',NULLIF(l.external_dimension_refs->>'member_ref',''),'cost_code_ref',l.cost_code_ref,'raw_event_id',d.raw_event_id,'source_record_id',d.source_record_id,'source_version',d.source_version))=x#>>'{source,source_line_hash}' AND to_char(d.accounting_date,'YYYY-MM-DD')=x->>'accounting_date'))
    OR x#>>'{source,source_type}' NOT IN('INVOICE','LOAN_TRANSACTION')) THEN RAISE EXCEPTION 'Decision packet is not an exact current population member' USING ERRCODE='40001'; END IF;
  WITH population AS (
    SELECT 0 AS kind_order,p_tenant AS tenant_id,p_entity AS entity_id,p_period AS accounting_period_id,'INVOICE'::text AS source_kind,d.accounting_date,d.source_document_id,l.line_no,l.source_document_line_id,d.payload_hash AS source_payload_hash,r.raw_row_hash AS source_line_hash,r.outcome AS retained_outcome,r.exception_codes AS retained_exception_codes,d.status::text AS source_status
    FROM wbs_final1_retained_source_row r JOIN raw_event re ON re.tenant_id=r.tenant_id AND re.entity_id=r.entity_id AND re.raw_event_id=r.raw_event_id AND re.source_record_id=r.source_record_id AND re.source_version=r.source_version AND re.is_current
    JOIN source_document d ON d.tenant_id=r.tenant_id AND d.entity_id=r.entity_id AND d.source_document_id=r.source_document_id AND d.raw_event_id=re.raw_event_id
    JOIN source_document_line l ON l.tenant_id=r.tenant_id AND l.entity_id=r.entity_id AND l.source_document_line_id=r.source_document_line_id AND l.source_document_id=r.source_document_id
    LEFT JOIN wbs_final1_payable_document_evidence e ON e.tenant_id=r.tenant_id AND e.entity_id=r.entity_id AND e.wbs_final1_retained_source_row_id=r.wbs_final1_retained_source_row_id
    LEFT JOIN wbs_final1_payable_document_revision_current c ON c.tenant_id=e.tenant_id AND c.entity_id=e.entity_id AND c.wbs_final1_payable_document_evidence_id=e.wbs_final1_payable_document_evidence_id
    WHERE r.tenant_id=p_tenant AND r.entity_id=p_entity AND r.accounting_period_id=p_period AND r.domain='PAYABLES' AND (e.document_kind IS DISTINCT FROM 'TAX_STATEMENT' OR c.wbs_final1_payable_document_revision_id IS NOT NULL)
    UNION ALL
    SELECT 1,p_tenant,p_entity,p_period,'LOAN_TRANSACTION',d.accounting_date,d.source_document_id,l.line_no,l.source_document_line_id,d.payload_hash,
      refs_jsonb_hash(jsonb_build_object('schema_version','AI_CONSTRUCTION_LOAN_DECISION_SOURCE_LINE_V1','source_document_line_id',l.source_document_line_id,'source_line_id',l.source_line_id,'line_no',l.line_no,'business_date',d.business_date,'accounting_date',d.accounting_date,'currency',d.currency,'amount',l.amount,'direction',l.direction,'description',l.description,'lender_ref',l.party_ref,'loan_ref',l.loan_ref,'transaction_kind',l.external_dimension_refs->>'transaction_kind','bank_account_ref',l.bank_account_ref,'project_ref',l.project_ref,'property_ref',l.property_ref,'member_ref',NULLIF(l.external_dimension_refs->>'member_ref',''),'cost_code_ref',l.cost_code_ref,'raw_event_id',d.raw_event_id,'source_record_id',d.source_record_id,'source_version',d.source_version)),NULL::text,'[]'::jsonb,d.status::text
    FROM source_document d JOIN raw_event re ON re.tenant_id=d.tenant_id AND re.entity_id=d.entity_id AND re.raw_event_id=d.raw_event_id AND re.source_record_id=d.source_record_id AND re.source_version=d.source_version AND re.is_current JOIN source_document_line l ON l.tenant_id=d.tenant_id AND l.entity_id=d.entity_id AND l.source_document_id=d.source_document_id JOIN accounting_period ap ON ap.tenant_id=d.tenant_id AND ap.entity_id=d.entity_id AND ap.period_id=p_period AND ap.ledger_code='PRIMARY'
    WHERE d.tenant_id=p_tenant AND d.entity_id=p_entity AND d.source_module='loan' AND d.document_type='CONSTRUCTION_LOAN_TRANSACTION' AND d.accounting_date BETWEEN ap.starts_on AND ap.ends_on AND COALESCE(l.external_dimension_refs->>'statement_balance_kind','')<>'CLOSING_PRINCIPAL_BALANCE'
  ),attestation AS (
    SELECT count(*)::integer total_count,refs_jsonb_hash(COALESCE(jsonb_agg(jsonb_build_object('tenant_id',tenant_id,'entity_id',entity_id,'accounting_period_id',accounting_period_id,'source_kind',source_kind,'accounting_date',to_char(accounting_date,'YYYY-MM-DD'),'source_document_id',source_document_id,'line_no',line_no,'source_document_line_id',source_document_line_id,'source_payload_hash',source_payload_hash,'source_line_hash',source_line_hash,'retained_outcome',retained_outcome,'retained_exception_codes',retained_exception_codes,'source_status',source_status) ORDER BY kind_order,accounting_date,source_document_id,line_no,source_document_line_id),'[]'::jsonb)) population_hash FROM population
  ) SELECT total_count,population_hash INTO actual_population_count,actual_population_hash FROM attestation;
  IF p_population_count IS DISTINCT FROM row_count OR p_population_count IS DISTINCT FROM actual_population_count OR p_population_hash IS DISTINCT FROM actual_population_hash THEN RAISE EXCEPTION 'Decision population attestation drifted before retention' USING ERRCODE='40001'; END IF;
  expected_hash:=refs_jsonb_hash(jsonb_build_object('tenant_id',p_tenant,'entity_id',p_entity,'period_id',p_period,'packets',p_packets));
  IF p_request_hash<>expected_hash THEN RAISE EXCEPTION 'Decision batch retention hash is not canonical' USING ERRCODE='22023'; END IF;
  INSERT INTO idempotency_receipt(tenant_id,operation_scope,idempotency_key,request_hash,status,actor_id) VALUES(p_tenant,'AI_ACCOUNTING_DECISION_BATCH_RETAIN:'||p_entity,p_idempotency_key,p_request_hash,'IN_PROGRESS',actor) ON CONFLICT DO NOTHING;
  SELECT * INTO receipt FROM idempotency_receipt WHERE tenant_id=p_tenant AND operation_scope='AI_ACCOUNTING_DECISION_BATCH_RETAIN:'||p_entity AND idempotency_key=p_idempotency_key FOR UPDATE;
  IF receipt.request_hash<>p_request_hash OR receipt.actor_id<>actor THEN RAISE EXCEPTION 'Idempotency key reused with different batch or actor' USING ERRCODE='23505'; END IF;
  IF receipt.status='SUCCEEDED' THEN RETURN receipt.response_body||jsonb_build_object('idempotent',true); END IF;
  FOR packet IN SELECT value FROM jsonb_array_elements(p_packets) LOOP
    item:=refs_retain_ai_accounting_decision(p_tenant,p_entity,packet,refs_jsonb_hash(jsonb_build_object('parent_idempotency_key',p_idempotency_key,'packet_index',index_no)),refs_jsonb_hash(jsonb_build_object('tenant_id',p_tenant,'entity_id',p_entity,'packet',packet)));
    IF NOT (item ?& ARRAY['schema_version','ai_accounting_decision_id','decision_hash','packet_status','source_document_id','can_create_draft','can_review','can_approve','can_post','idempotent']) OR item-ARRAY['schema_version','ai_accounting_decision_id','decision_hash','packet_status','source_document_id','can_create_draft','can_review','can_approve','can_post','idempotent']<>'{}'::jsonb OR item->>'schema_version'<>'AI_ACCOUNTING_DECISION_RETAINED_V1' OR item->>'packet_status' NOT IN('READY_FOR_HUMAN_REVIEW','EXCEPTION') OR item->>'can_create_draft'<>'false' OR item->>'can_review'<>'false' OR item->>'can_approve'<>'false' OR item->>'can_post'<>'false' THEN RAISE EXCEPTION 'Decision batch item returned unsafe evidence' USING ERRCODE='23514'; END IF;
    receipts:=receipts||jsonb_build_array(item);index_no:=index_no+1;
  END LOOP;
  response:=jsonb_build_object('schema_version','AI_ACCOUNTING_DECISION_RUN_RECEIPT_V1','accounting_period_id',p_period,'population',jsonb_build_object('total_count',actual_population_count,'population_hash',actual_population_hash,'population_complete',true),'row_count',row_count,'receipts',receipts,'can_create_draft',false,'can_review',false,'can_approve',false,'can_post',false,'idempotent',false);
  UPDATE idempotency_receipt SET status='SUCCEEDED',response_status=201,response_body=response,completed_at=clock_timestamp() WHERE tenant_id=p_tenant AND operation_scope='AI_ACCOUNTING_DECISION_BATCH_RETAIN:'||p_entity AND idempotency_key=p_idempotency_key;
  RETURN response;
END $$;

REVOKE ALL ON wbs_final1_payable_document_revision FROM PUBLIC,refs_app;
REVOKE ALL ON wbs_final1_payable_document_revision_current FROM PUBLIC,refs_app;
REVOKE ALL ON FUNCTION refs_wbs_final1_payable_document_identity_hash(uuid,uuid,text,text,text,date,date,text,text),refs_wbs_final1_payable_document_revision_hash(uuid,uuid,uuid,uuid,uuid,uuid,uuid,text,text,text,text,text,text,text,integer,uuid,text,text,integer,text),refs_retain_wbs_final1_source_evidence_with_signed_controls(uuid,uuid,jsonb,jsonb,jsonb,text,text),refs_read_wbs_final1_payable_document_revisions(uuid,uuid,text,integer),refs_read_ai_invoice_classification_source_v4(uuid,uuid,uuid,integer),refs_read_ai_invoice_decision_population_page(uuid,uuid,uuid,date,uuid,integer,uuid,integer),refs_retain_ai_accounting_decision_batch(uuid,uuid,uuid,jsonb,integer,text,text,text) FROM PUBLIC;
REVOKE ALL ON FUNCTION refs_wbs_final1_payable_document_identity_hash(uuid,uuid,text,text,text,date,date,text,text),refs_wbs_final1_payable_document_revision_hash(uuid,uuid,uuid,uuid,uuid,uuid,uuid,text,text,text,text,text,text,text,integer,uuid,text,text,integer,text) FROM refs_app;
GRANT EXECUTE ON FUNCTION refs_retain_wbs_final1_source_evidence_with_signed_controls(uuid,uuid,jsonb,jsonb,jsonb,text,text),refs_read_wbs_final1_payable_document_revisions(uuid,uuid,text,integer),refs_read_ai_invoice_classification_source_v4(uuid,uuid,uuid,integer),refs_read_ai_invoice_decision_population_page(uuid,uuid,uuid,date,uuid,integer,uuid,integer),refs_retain_ai_accounting_decision_batch(uuid,uuid,uuid,jsonb,integer,text,text,text) TO refs_app;

COMMIT;
