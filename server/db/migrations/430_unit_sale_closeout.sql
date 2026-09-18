BEGIN;

-- P06 / ADR-P06: unit sale close-out — revenue, released cost (COGS) and the
-- remaining capitalised unit cost, tied per unit; plus one controlled Draft
-- command that releases a specific-identification unit's cost to COGS.
--
-- Nothing here posts.  The release produces an ordinary MANUAL Draft journal
-- through refs_create_manual_journal, so the unchanged Submit → Review →
-- Approve → Post chain (four eyes, period control 55000, audit) still governs
-- whether the entry ever reaches the ledger.  The read model is derived from
-- POSTED ledger lines only, so reversing a released journal automatically
-- restores the unit to NOT_RELEASED without any compensating master update.
--
-- Account classification is never inferred from names, prefixes or account
-- roles.  CWIP keeps using the 077 family; REVENUE and COGS come from the new
-- UNIT_SALE_ACCOUNT_CLASSIFICATION family, approved per exact account, exactly
-- as 077 does.

INSERT INTO permission_catalog(permission_code,domain,risk_class,sod_class) VALUES
  ('UNIT.COGS.RELEASE.DRAFT','PROJECT','HIGH','UNIT_COGS_RELEASE_MAKER')
ON CONFLICT(permission_code) DO UPDATE SET active=true,version=permission_catalog.version+1,effective_to=NULL;
INSERT INTO runtime_human_permission_authority(permission_code,authority_class) VALUES
  ('UNIT.COGS.RELEASE.DRAFT','DRAFT') ON CONFLICT(permission_code) DO NOTHING;

CREATE INDEX mapping_snapshot_unit_sale_account_read_idx
  ON mapping_snapshot(tenant_id,entity_id,family,status,effective_from,effective_to,priority)
  WHERE family='UNIT_SALE_ACCOUNT_CLASSIFICATION';

-- Evidence binding for every release Draft: which unit, which accounts, which
-- amount, which journal.  Append-only; the journal's own lifecycle carries the
-- rest of the story.
CREATE TABLE unit_cogs_release_binding(
  unit_cogs_release_binding_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant(tenant_id),
  entity_id uuid NOT NULL,
  unit_id uuid NOT NULL REFERENCES project_unit(unit_id),
  project_ref text NOT NULL,
  unit_ref text NOT NULL,
  period_id uuid NOT NULL,
  journal_entry_id uuid NOT NULL,
  cwip_account_code text NOT NULL,
  cogs_account_code text NOT NULL,
  amount numeric(20,4) NOT NULL CHECK(amount>0),
  cwip_mapping_snapshot_id uuid NOT NULL,
  cogs_mapping_snapshot_id uuid NOT NULL,
  revenue_evidence jsonb NOT NULL CHECK(jsonb_typeof(revenue_evidence)='object'),
  created_by text NOT NULL,
  reason text NOT NULL CHECK(length(btrim(reason)) BETWEEN 8 AND 2000),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE(tenant_id,journal_entry_id)
);
CREATE INDEX unit_cogs_release_binding_unit_idx ON unit_cogs_release_binding(tenant_id,entity_id,unit_id);
CREATE TRIGGER unit_cogs_release_binding_append_only BEFORE UPDATE OR DELETE ON unit_cogs_release_binding FOR EACH ROW EXECUTE FUNCTION reject_mutation();

-- One approved classification for one exact account as of a date; more than
-- one equal-priority candidate is an unresolved mapping, not a guess.
CREATE FUNCTION refs_unit_sale_account_class(p_tenant uuid,p_entity uuid,p_account text,p_as_of date)
RETURNS TABLE(classification text,mapping_snapshot_id uuid,candidate_count integer)
LANGUAGE sql STABLE SET search_path=pg_catalog,public,pg_temp AS $$
  WITH eligible AS (
    SELECT ms.mapping_snapshot_id,ms.priority,ms.output_rules->>'classification' AS classification
    FROM mapping_snapshot ms
    WHERE ms.tenant_id=p_tenant AND ms.entity_id=p_entity AND ms.family='UNIT_SALE_ACCOUNT_CLASSIFICATION'
      AND ms.status='APPROVED' AND ms.input_keys=jsonb_build_object('account_code',p_account)
      AND ms.effective_from::date<=p_as_of AND (ms.effective_to IS NULL OR ms.effective_to::date>p_as_of)
  ), highest AS (SELECT * FROM eligible WHERE priority=(SELECT max(priority) FROM eligible))
  SELECT (array_agg(h.classification ORDER BY h.mapping_snapshot_id))[1],
         (array_agg(h.mapping_snapshot_id ORDER BY h.mapping_snapshot_id))[1],
         count(*)::integer
  FROM highest h
$$;

CREATE FUNCTION refs_cwip_account_class(p_tenant uuid,p_entity uuid,p_account text,p_as_of date)
RETURNS TABLE(classification text,mapping_snapshot_id uuid,candidate_count integer)
LANGUAGE sql STABLE SET search_path=pg_catalog,public,pg_temp AS $$
  WITH eligible AS (
    SELECT ms.mapping_snapshot_id,ms.priority,ms.output_rules->>'classification' AS classification
    FROM mapping_snapshot ms
    WHERE ms.tenant_id=p_tenant AND ms.entity_id=p_entity AND ms.family='CWIP_ACCOUNT_CLASSIFICATION'
      AND ms.status='APPROVED' AND ms.input_keys=jsonb_build_object('account_code',p_account)
      AND ms.effective_from::date<=p_as_of AND (ms.effective_to IS NULL OR ms.effective_to::date>p_as_of)
  ), highest AS (SELECT * FROM eligible WHERE priority=(SELECT max(priority) FROM eligible))
  SELECT (array_agg(h.classification ORDER BY h.mapping_snapshot_id))[1],
         (array_agg(h.mapping_snapshot_id ORDER BY h.mapping_snapshot_id))[1],
         count(*)::integer
  FROM highest h
$$;

-- Per-unit close-out.  Every figure is a POSTED ledger aggregate bounded by the
-- period end; no master field ever supplies an amount.
--   capitalized_cost = net debit on CWIP-classified accounts carrying the unit
--   cogs_released    = net debit on COGS-classified accounts carrying the unit
--   revenue_recognized = net credit on REVENUE-classified accounts carrying the unit
-- state:
--   UNSOLD                  no revenue, no COGS
--   REVENUE_WITHOUT_COGS    revenue posted, nothing released (close-out incomplete)
--   COGS_WITHOUT_REVENUE    cost released with no revenue (matching violated)
--   CLOSED_OUT              revenue and COGS posted, no capitalised cost left
--   PARTIALLY_RELEASED      revenue and COGS posted, capitalised cost remains
CREATE FUNCTION refs_read_unit_sale_closeout(p_tenant uuid,p_entity uuid,p_project_ref text,p_period uuid)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE v_period_end date; v_period_code text; proj project_master; rows_json jsonb; totals jsonb;
BEGIN
  PERFORM refs_assert_scope(p_tenant,p_entity,'GL.REPORT.VIEW');
  IF p_project_ref IS NULL OR p_project_ref<>btrim(p_project_ref) OR length(p_project_ref) NOT BETWEEN 1 AND 64 THEN RAISE EXCEPTION 'project_ref is required' USING ERRCODE='22023'; END IF;
  IF p_period IS NOT NULL THEN
    SELECT ends_on,period_code INTO v_period_end,v_period_code FROM accounting_period WHERE tenant_id=p_tenant AND entity_id=p_entity AND period_id=p_period;
    IF v_period_end IS NULL THEN RAISE EXCEPTION 'A valid entity-scoped accounting period is required' USING ERRCODE='22023'; END IF;
  END IF;
  SELECT * INTO proj FROM project_master WHERE tenant_id=p_tenant AND entity_id=p_entity AND project_ref=p_project_ref;

  WITH bound AS (SELECT COALESCE(v_period_end,CURRENT_DATE) AS as_of),
  posted AS (
    SELECT NULLIF(btrim(l.dimensions->>'unit_ref'),'') AS unit_ref,l.account_code,l.debit_amount,l.credit_amount,j.journal_date,l.journal_entry_id
    FROM ledger_line l JOIN journal_entry j ON j.tenant_id=l.tenant_id AND j.entity_id=l.entity_id AND j.journal_entry_id=l.journal_entry_id
    WHERE l.tenant_id=p_tenant AND l.entity_id=p_entity AND j.status='POSTED' AND l.dimensions->>'project_ref'=p_project_ref
      AND (v_period_end IS NULL OR j.journal_date<=v_period_end)
  ), classified AS (
    SELECT p.*,
      COALESCE((SELECT c.classification FROM refs_cwip_account_class(p_tenant,p_entity,p.account_code,(SELECT as_of FROM bound)) c WHERE c.candidate_count=1),
               (SELECT s.classification FROM refs_unit_sale_account_class(p_tenant,p_entity,p.account_code,(SELECT as_of FROM bound)) s WHERE s.candidate_count=1)) AS account_class
    FROM posted p
  ), per_unit AS (
    SELECT c.unit_ref,
      COALESCE(sum(c.debit_amount-c.credit_amount) FILTER(WHERE c.account_class='CWIP'),0)::numeric(20,4) AS capitalized_cost,
      COALESCE(sum(c.debit_amount-c.credit_amount) FILTER(WHERE c.account_class='COGS'),0)::numeric(20,4) AS cogs_released,
      COALESCE(sum(c.credit_amount-c.debit_amount) FILTER(WHERE c.account_class='REVENUE'),0)::numeric(20,4) AS revenue_recognized,
      count(*) FILTER(WHERE c.account_class IS NULL)::integer AS unclassified_line_count,
      count(DISTINCT c.journal_entry_id)::integer AS journal_entry_count,max(c.journal_date) AS last_journal_date
    FROM classified c WHERE c.unit_ref IS NOT NULL GROUP BY c.unit_ref
  ), joined AS (
    SELECT u.unit_ref,u.capitalized_cost,u.cogs_released,u.revenue_recognized,u.unclassified_line_count,u.journal_entry_count,u.last_journal_date,
      m.unit_id,m.status AS unit_status,m.allocation_basis,
      (u.revenue_recognized-u.cogs_released)::numeric(20,4) AS gross_margin,
      CASE WHEN u.revenue_recognized=0 AND u.cogs_released=0 THEN 'UNSOLD'
           WHEN u.revenue_recognized<>0 AND u.cogs_released=0 THEN 'REVENUE_WITHOUT_COGS'
           WHEN u.revenue_recognized=0 AND u.cogs_released<>0 THEN 'COGS_WITHOUT_REVENUE'
           WHEN u.capitalized_cost<>0 THEN 'PARTIALLY_RELEASED'
           ELSE 'CLOSED_OUT' END AS state
    FROM per_unit u
    LEFT JOIN project_unit m ON proj.project_id IS NOT NULL AND m.project_id=proj.project_id AND m.unit_ref=u.unit_ref
  ), final AS (
    SELECT j.*,
      CASE WHEN j.unit_id IS NULL THEN 'UNIT_NOT_REGISTERED'
           WHEN j.unit_status IS DISTINCT FROM 'APPROVED' THEN 'UNIT_NOT_APPROVED'
           WHEN j.unclassified_line_count>0 THEN 'ACCOUNT_CLASSIFICATION_MISSING'
           WHEN j.state='COGS_WITHOUT_REVENUE' THEN 'COGS_WITHOUT_REVENUE'
           WHEN j.state='REVENUE_WITHOUT_COGS' THEN 'COGS_NOT_RELEASED'
           WHEN j.state='PARTIALLY_RELEASED' THEN 'CAPITALIZED_COST_REMAINING'
           ELSE NULL END AS exception_code
    FROM joined j
  )
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'unit_ref',unit_ref,'unit_id',unit_id,'unit_status',unit_status,'allocation_basis',allocation_basis,
      'capitalized_cost',capitalized_cost,'cogs_released',cogs_released,'revenue_recognized',revenue_recognized,'gross_margin',gross_margin,
      'state',state,'exception_code',exception_code,'unclassified_line_count',unclassified_line_count,
      'journal_entry_count',journal_entry_count,'last_journal_date',last_journal_date
    ) ORDER BY (exception_code IS NULL),unit_ref),'[]'::jsonb),
    jsonb_build_object('unit_count',count(*),'exception_count',count(*) FILTER(WHERE exception_code IS NOT NULL),
      'capitalized_cost',COALESCE(sum(capitalized_cost),0)::numeric(20,4),'cogs_released',COALESCE(sum(cogs_released),0)::numeric(20,4),
      'revenue_recognized',COALESCE(sum(revenue_recognized),0)::numeric(20,4),'gross_margin',COALESCE(sum(gross_margin),0)::numeric(20,4),
      'closed_out_count',count(*) FILTER(WHERE state='CLOSED_OUT'))
  INTO rows_json,totals FROM final;

  RETURN jsonb_build_object(
    'schema_version','UNIT_SALE_CLOSEOUT_V1','accounting_authority','NONE','can_release',false,'can_post',false,
    'project_ref',p_project_ref,'project_id',proj.project_id,'project_status',proj.status,
    'period_id',p_period,'period_code',v_period_code,'as_of',v_period_end,
    'units',rows_json,'totals',totals);
END;$$;

CREATE FUNCTION refs_create_unit_cogs_release_draft_hash(
  p_tenant uuid,p_entity uuid,p_unit uuid,p_period uuid,p_number text,p_date date,
  p_cwip_account text,p_cogs_account text,p_amount numeric,p_reason text,p_attachments uuid[]
) RETURNS text LANGUAGE sql IMMUTABLE SET search_path=pg_catalog,public,pg_temp AS $$
  SELECT refs_jsonb_hash(jsonb_build_object('op','UNIT_COGS_RELEASE_DRAFT','tenant_id',p_tenant,'entity_id',p_entity,'unit_id',p_unit,'period_id',p_period,
    'journal_number',btrim(p_number),'journal_date',p_date,'cwip_account_code',btrim(p_cwip_account),'cogs_account_code',btrim(p_cogs_account),
    'amount',to_char(p_amount,'FM999999999999999990.0000'),'reason',btrim(p_reason),
    'attachment_ids',to_jsonb(ARRAY(SELECT id FROM unnest(p_attachments) id ORDER BY id))))
$$;

-- Release a specific-identification unit's capitalised cost to COGS as a Draft
-- journal.  Refuses when:
--   * the unit is not an APPROVED master under an APPROVED project (23514)
--   * the allocation basis is AREA or EQUAL — the allocation semantics are not
--     defined anywhere in the business rules (23514, D-P06-1); no guess is made
--   * either account lacks exactly one approved classification (23514)
--   * no revenue has been POSTED for the unit (23514) — cost never precedes revenue
--   * the amount exceeds the unit's remaining capitalised cost net of releases
--     already drafted but not yet posted (23514)
CREATE FUNCTION refs_create_unit_cogs_release_draft(
  p_tenant uuid,p_entity uuid,p_unit uuid,p_period uuid,p_number text,p_date date,
  p_cwip_account text,p_cogs_account text,p_amount numeric,p_reason text,p_attachments uuid[],
  p_key text,p_hash text
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE actor text:=refs_current_actor(); idem idempotency_receipt; scope text:='UNIT_COGS_RELEASE:'||p_entity;
  unit project_unit; proj project_master; period_row accounting_period;
  cwip_class text; cwip_map uuid; cwip_n integer; cogs_class text; cogs_map uuid; cogs_n integer;
  posted_cost numeric(20,4); reserved numeric(20,4); available numeric(20,4);
  revenue numeric(20,4); revenue_journals integer; dims jsonb; lines jsonb; inner_hash text;
  journal jsonb; journal_id uuid; binding uuid:=gen_random_uuid(); payload jsonb; v_currency char(3);
BEGIN
  PERFORM refs_assert_scope(p_tenant,p_entity,'UNIT.COGS.RELEASE.DRAFT');
  PERFORM refs_assert_scope(p_tenant,p_entity,'GL.JE.CREATE');
  IF actor IS NULL THEN RAISE EXCEPTION 'Authenticated unit cost release maker missing' USING ERRCODE='42501'; END IF;
  IF p_hash IS DISTINCT FROM refs_create_unit_cogs_release_draft_hash(p_tenant,p_entity,p_unit,p_period,p_number,p_date,p_cwip_account,p_cogs_account,p_amount,p_reason,p_attachments)
     OR p_amount IS NULL OR p_amount<=0 OR p_amount<>round(p_amount,4) OR p_date IS NULL
     OR length(btrim(coalesce(p_reason,''))) NOT BETWEEN 8 AND 2000 OR length(coalesce(p_key,'')) NOT BETWEEN 8 AND 200
     OR COALESCE(cardinality(p_attachments),0)<1
  THEN RAISE EXCEPTION 'Invalid unit cost release command' USING ERRCODE='22023'; END IF;

  INSERT INTO idempotency_receipt(tenant_id,operation_scope,idempotency_key,request_hash,status,actor_id)
  VALUES(p_tenant,scope,p_key,p_hash,'IN_PROGRESS',actor) ON CONFLICT(tenant_id,operation_scope,idempotency_key) DO NOTHING;
  SELECT * INTO idem FROM idempotency_receipt WHERE tenant_id=p_tenant AND operation_scope=scope AND idempotency_key=p_key FOR UPDATE;
  IF idem.actor_id IS DISTINCT FROM actor OR idem.request_hash IS DISTINCT FROM p_hash THEN RAISE EXCEPTION 'Unit cost release idempotency conflict' USING ERRCODE='23505'; END IF;
  IF idem.status='SUCCEEDED' THEN RETURN idem.response_body||jsonb_build_object('idempotent',true); END IF;

  SELECT * INTO unit FROM project_unit WHERE tenant_id=p_tenant AND entity_id=p_entity AND unit_id=p_unit FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Scoped project unit missing' USING ERRCODE='P0002'; END IF;
  SELECT * INTO proj FROM project_master WHERE project_id=unit.project_id FOR SHARE;
  IF unit.status<>'APPROVED' OR proj.status<>'APPROVED' THEN RAISE EXCEPTION 'Unit cost release requires an APPROVED unit under an APPROVED project' USING ERRCODE='23514'; END IF;
  IF unit.allocation_basis<>'SPECIFIC_IDENTIFICATION' THEN
    RAISE EXCEPTION 'Unit cost release is only defined for SPECIFIC_IDENTIFICATION units; % allocation has no approved basis',unit.allocation_basis USING ERRCODE='23514';
  END IF;
  SELECT * INTO period_row FROM accounting_period WHERE tenant_id=p_tenant AND entity_id=p_entity AND period_id=p_period;
  IF NOT FOUND THEN RAISE EXCEPTION 'A valid entity-scoped accounting period is required' USING ERRCODE='22023'; END IF;

  SELECT c.classification,c.mapping_snapshot_id,c.candidate_count INTO cwip_class,cwip_map,cwip_n FROM refs_cwip_account_class(p_tenant,p_entity,btrim(p_cwip_account),p_date) c;
  IF cwip_n IS DISTINCT FROM 1 OR cwip_class IS DISTINCT FROM 'CWIP' THEN RAISE EXCEPTION 'The source account has no single approved CWIP classification' USING ERRCODE='23514'; END IF;
  SELECT s.classification,s.mapping_snapshot_id,s.candidate_count INTO cogs_class,cogs_map,cogs_n FROM refs_unit_sale_account_class(p_tenant,p_entity,btrim(p_cogs_account),p_date) s;
  IF cogs_n IS DISTINCT FROM 1 OR cogs_class IS DISTINCT FROM 'COGS' THEN RAISE EXCEPTION 'The target account has no single approved COGS classification' USING ERRCODE='23514'; END IF;

  SELECT COALESCE(sum(l.credit_amount-l.debit_amount),0)::numeric(20,4),count(DISTINCT l.journal_entry_id)::integer
    INTO revenue,revenue_journals
  FROM ledger_line l JOIN journal_entry j ON j.tenant_id=l.tenant_id AND j.entity_id=l.entity_id AND j.journal_entry_id=l.journal_entry_id
  WHERE l.tenant_id=p_tenant AND l.entity_id=p_entity AND j.status='POSTED'
    AND l.dimensions->>'project_ref'=proj.project_ref AND l.dimensions->>'unit_ref'=unit.unit_ref
    AND (SELECT s.classification FROM refs_unit_sale_account_class(p_tenant,p_entity,l.account_code,p_date) s WHERE s.candidate_count=1)='REVENUE';
  IF revenue<=0 THEN RAISE EXCEPTION 'Unit cost release requires POSTED revenue for the unit' USING ERRCODE='23514'; END IF;

  SELECT COALESCE(sum(l.debit_amount-l.credit_amount),0)::numeric(20,4) INTO posted_cost
  FROM ledger_line l JOIN journal_entry j ON j.tenant_id=l.tenant_id AND j.entity_id=l.entity_id AND j.journal_entry_id=l.journal_entry_id
  WHERE l.tenant_id=p_tenant AND l.entity_id=p_entity AND j.status='POSTED'
    AND l.dimensions->>'project_ref'=proj.project_ref AND l.dimensions->>'unit_ref'=unit.unit_ref AND l.account_code=btrim(p_cwip_account);
  SELECT COALESCE(sum(b.amount),0)::numeric(20,4) INTO reserved
  FROM unit_cogs_release_binding b JOIN journal_entry j ON j.tenant_id=b.tenant_id AND j.entity_id=b.entity_id AND j.journal_entry_id=b.journal_entry_id
  WHERE b.tenant_id=p_tenant AND b.entity_id=p_entity AND b.unit_id=p_unit AND b.cwip_account_code=btrim(p_cwip_account) AND j.status<>'POSTED';
  available:=posted_cost-reserved;
  IF p_amount>available THEN
    RAISE EXCEPTION 'Unit cost release exceeds the remaining capitalised cost (available %, requested %)',to_char(available,'FM999999999999999990.0000'),to_char(p_amount,'FM999999999999999990.0000') USING ERRCODE='23514';
  END IF;

  SELECT base_currency INTO v_currency FROM entity WHERE tenant_id=p_tenant AND entity_id=p_entity;
  dims:=jsonb_build_object('project_ref',proj.project_ref,'unit_ref',unit.unit_ref);
  lines:=jsonb_build_array(
    jsonb_build_object('line_no',1,'account_code',btrim(p_cogs_account),'debit_amount',p_amount,'credit_amount',0,'member_ref',NULL,'dimensions',dims),
    jsonb_build_object('line_no',2,'account_code',btrim(p_cwip_account),'debit_amount',0,'credit_amount',p_amount,'member_ref',NULL,'dimensions',dims));
  inner_hash:=refs_create_manual_journal_hash(p_tenant,p_entity,p_period,btrim(p_number),p_date,v_currency,btrim(p_reason),lines,p_attachments);
  journal:=refs_create_manual_journal(p_tenant,p_entity,p_period,btrim(p_number),p_date,v_currency,btrim(p_reason),lines,p_attachments,'unit-cogs-release:'||binding,inner_hash);
  journal_id:=(journal->>'journal_entry_id')::uuid;

  INSERT INTO unit_cogs_release_binding(unit_cogs_release_binding_id,tenant_id,entity_id,unit_id,project_ref,unit_ref,period_id,journal_entry_id,
    cwip_account_code,cogs_account_code,amount,cwip_mapping_snapshot_id,cogs_mapping_snapshot_id,revenue_evidence,created_by,reason)
  VALUES(binding,p_tenant,p_entity,p_unit,proj.project_ref,unit.unit_ref,p_period,journal_id,btrim(p_cwip_account),btrim(p_cogs_account),p_amount,cwip_map,cogs_map,
    jsonb_build_object('revenue_recognized',to_char(revenue,'FM999999999999999990.0000'),'revenue_journal_count',revenue_journals,'capitalized_cost_posted',to_char(posted_cost,'FM999999999999999990.0000'),'reserved_by_open_drafts',to_char(reserved,'FM999999999999999990.0000')),
    actor,btrim(p_reason));

  payload:=journal||jsonb_build_object('schema_version','UNIT_COGS_RELEASE_DRAFT_V1','unit_cogs_release_binding_id',binding,'unit_id',p_unit,
    'project_ref',proj.project_ref,'unit_ref',unit.unit_ref,'cwip_account_code',btrim(p_cwip_account),'cogs_account_code',btrim(p_cogs_account),
    'amount',to_char(p_amount,'FM999999999999999990.0000'),'available_before',to_char(available,'FM999999999999999990.0000'));
  INSERT INTO audit_event(tenant_id,entity_id,event_type,object_type,object_id,action,actor_id,actor_type,permission_used,request_id,correlation_id,idempotency_key,after_hash,reason,metadata)
  VALUES(p_tenant,p_entity,'UNIT_COGS_RELEASE_DRAFT_CREATED','JOURNAL_ENTRY',journal_id,'CREATE',actor,'USER','UNIT.COGS.RELEASE.DRAFT',p_key,p_key,p_key,refs_jsonb_hash(payload),btrim(p_reason),payload);
  INSERT INTO outbox_event(tenant_id,entity_id,aggregate_type,aggregate_id,event_type,payload,payload_hash)
  VALUES(p_tenant,p_entity,'JOURNAL_ENTRY',journal_id,'UNIT_COGS_RELEASE_DRAFT_CREATED',payload,refs_jsonb_hash(payload));
  UPDATE idempotency_receipt SET status='SUCCEEDED',response_status=201,response_body=payload,completed_at=clock_timestamp() WHERE idempotency_receipt_id=idem.idempotency_receipt_id;
  RETURN payload||jsonb_build_object('idempotent',false);
END;$$;

COMMIT;
