BEGIN;

INSERT INTO permission_catalog(permission_code,domain,risk_class,sod_class) VALUES
 ('GROUP.INTERCOMPANY_ELIMINATION.VIEW','CONSOLIDATION','LOW','READ'),
 ('GROUP.INTERCOMPANY_ELIMINATION.CREATE','CONSOLIDATION','HIGH','INTERCOMPANY_ELIMINATION_DRAFT'),
 ('GROUP.INTERCOMPANY_ELIMINATION.SUBMIT','CONSOLIDATION','HIGH','INTERCOMPANY_ELIMINATION_SUBMIT'),
 ('GROUP.INTERCOMPANY_ELIMINATION.REVIEW','CONSOLIDATION','HIGH','INTERCOMPANY_ELIMINATION_REVIEW'),
 ('GROUP.INTERCOMPANY_ELIMINATION.APPROVE','CONSOLIDATION','CRITICAL','INTERCOMPANY_ELIMINATION_APPROVE'),
 ('GROUP.INTERCOMPANY_ELIMINATION.CANCEL','CONSOLIDATION','HIGH','INTERCOMPANY_ELIMINATION_CANCEL'),
 ('GROUP.INTERCOMPANY_ELIMINATION.POST','CONSOLIDATION','CRITICAL','INTERCOMPANY_ELIMINATION_POST')
ON CONFLICT(permission_code) DO UPDATE SET active=true,domain=EXCLUDED.domain,risk_class=EXCLUDED.risk_class,
 sod_class=EXCLUDED.sod_class,version=permission_catalog.version+1,effective_to=NULL;

INSERT INTO runtime_human_permission_authority(permission_code,authority_class) VALUES
 ('GROUP.INTERCOMPANY_ELIMINATION.VIEW','READ'),
 ('GROUP.INTERCOMPANY_ELIMINATION.CREATE','DRAFT'),
 ('GROUP.INTERCOMPANY_ELIMINATION.SUBMIT','SUBMIT'),
 ('GROUP.INTERCOMPANY_ELIMINATION.REVIEW','REVIEW'),
 ('GROUP.INTERCOMPANY_ELIMINATION.APPROVE','APPROVE'),
 ('GROUP.INTERCOMPANY_ELIMINATION.CANCEL','REVIEW'),
 ('GROUP.INTERCOMPANY_ELIMINATION.POST','POST')
ON CONFLICT(permission_code) DO UPDATE SET authority_class=EXCLUDED.authority_class;

CREATE TABLE intercompany_elimination_batch(
 intercompany_elimination_batch_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 tenant_id uuid NOT NULL REFERENCES tenant(tenant_id),
 reporting_entity_id uuid NOT NULL,reporting_period_id uuid NOT NULL,reporting_period_ledger_code text NOT NULL,reporting_period_status period_status NOT NULL,reporting_period_version bigint NOT NULL CHECK(reporting_period_version>=0),
 period_start date NOT NULL,period_end date NOT NULL CHECK(period_start<=period_end),
 consolidation_snapshot_id uuid NOT NULL,consolidation_version bigint NOT NULL CHECK(consolidation_version>0),consolidation_snapshot_hash text NOT NULL CHECK(consolidation_snapshot_hash~'^sha256:[0-9a-f]{64}$'),consolidation_receipt_hash text NOT NULL CHECK(consolidation_receipt_hash~'^sha256:[0-9a-f]{64}$'),
 consolidation_member_population_hash text NOT NULL CHECK(consolidation_member_population_hash~'^sha256:[0-9a-f]{64}$'),consolidation_account_map_population_hash text NOT NULL CHECK(consolidation_account_map_population_hash~'^sha256:[0-9a-f]{64}$'),group_ref text NOT NULL CHECK(group_ref=btrim(group_ref) AND length(group_ref) BETWEEN 1 AND 160),
 source_entity_id uuid NOT NULL,source_period_id uuid NOT NULL,source_period_ledger_code text NOT NULL,source_period_status period_status NOT NULL,source_period_version bigint NOT NULL CHECK(source_period_version>=0),source_account_code text NOT NULL CHECK(source_account_code~'^[0-9A-Za-z._-]{1,64}$'),
 source_classification text NOT NULL CHECK(source_classification IN('DUE_FROM','DUE_TO')),
 source_closing_balance numeric(20,4) NOT NULL,source_mapping_snapshot_id uuid NOT NULL,source_mapping_snapshot_hash text NOT NULL CHECK(source_mapping_snapshot_hash~'^sha256:[0-9a-f]{64}$'),
 source_journal_entry_ids uuid[] NOT NULL,source_journal_line_ids uuid[] NOT NULL,source_ledger_line_ids uuid[] NOT NULL,source_document_ids uuid[] NOT NULL,
 counterparty_entity_id uuid NOT NULL,counterparty_period_id uuid NOT NULL,counterparty_period_ledger_code text NOT NULL,counterparty_period_status period_status NOT NULL,counterparty_period_version bigint NOT NULL CHECK(counterparty_period_version>=0),counterparty_account_code text NOT NULL CHECK(counterparty_account_code~'^[0-9A-Za-z._-]{1,64}$'),
 counterparty_classification text NOT NULL CHECK(counterparty_classification IN('DUE_FROM','DUE_TO')),
 counterparty_closing_balance numeric(20,4) NOT NULL,counterparty_mapping_snapshot_id uuid NOT NULL,counterparty_mapping_snapshot_hash text NOT NULL CHECK(counterparty_mapping_snapshot_hash~'^sha256:[0-9a-f]{64}$'),
 counterparty_journal_entry_ids uuid[] NOT NULL,counterparty_journal_line_ids uuid[] NOT NULL,counterparty_ledger_line_ids uuid[] NOT NULL,counterparty_source_document_ids uuid[] NOT NULL,
 currency char(3) NOT NULL CHECK(currency~'^[A-Z]{3}$'),matched_amount numeric(20,4) NOT NULL CHECK(matched_amount>0),raw_mismatch numeric(20,4) NOT NULL,
 canonical_source_scope_hash text NOT NULL CHECK(canonical_source_scope_hash~'^sha256:[0-9a-f]{64}$'),source_evidence_hash text NOT NULL CHECK(source_evidence_hash~'^sha256:[0-9a-f]{64}$'),
 status text NOT NULL DEFAULT 'DRAFT' CHECK(status IN('DRAFT','PENDING_REVIEW','REVIEWED','APPROVED','POSTED','CANCELLED')),
 revision bigint NOT NULL DEFAULT 0 CHECK(revision>=0),created_by text NOT NULL,created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 submitted_by text,submitted_at timestamptz,reviewed_by text,reviewed_at timestamptz,approved_by text,approved_at timestamptz,
 posted_by text,posted_at timestamptz,cancelled_by text,cancelled_at timestamptz,cancel_reason text,post_evidence_hash text CHECK(post_evidence_hash IS NULL OR post_evidence_hash~'^sha256:[0-9a-f]{64}$'),
 UNIQUE(tenant_id,intercompany_elimination_batch_id),
 FOREIGN KEY(tenant_id,reporting_entity_id,reporting_period_id) REFERENCES accounting_period(tenant_id,entity_id,period_id),
 FOREIGN KEY(consolidation_snapshot_id,tenant_id,reporting_entity_id,reporting_period_id) REFERENCES consolidation_snapshot(consolidation_snapshot_id,tenant_id,reporting_entity_id,reporting_period_id),
 FOREIGN KEY(tenant_id,source_entity_id,source_period_id) REFERENCES accounting_period(tenant_id,entity_id,period_id),
 FOREIGN KEY(tenant_id,counterparty_entity_id,counterparty_period_id) REFERENCES accounting_period(tenant_id,entity_id,period_id),
 FOREIGN KEY(tenant_id,source_mapping_snapshot_id) REFERENCES mapping_snapshot(tenant_id,mapping_snapshot_id),
 FOREIGN KEY(tenant_id,counterparty_mapping_snapshot_id) REFERENCES mapping_snapshot(tenant_id,mapping_snapshot_id),
 CHECK(source_entity_id<>counterparty_entity_id),
 CHECK(reporting_period_ledger_code='PRIMARY' AND source_period_ledger_code='PRIMARY' AND counterparty_period_ledger_code='PRIMARY'),
 CHECK((source_classification='DUE_FROM' AND source_closing_balance>0 AND counterparty_classification='DUE_TO' AND counterparty_closing_balance<0)
    OR (source_classification='DUE_TO' AND source_closing_balance<0 AND counterparty_classification='DUE_FROM' AND counterparty_closing_balance>0)),
 CHECK(matched_amount=LEAST(abs(source_closing_balance),abs(counterparty_closing_balance))),
 CHECK(raw_mismatch=source_closing_balance+counterparty_closing_balance),
 CHECK((submitted_by IS NULL)=(submitted_at IS NULL) AND(reviewed_by IS NULL)=(reviewed_at IS NULL) AND(approved_by IS NULL)=(approved_at IS NULL) AND(posted_by IS NULL)=(posted_at IS NULL) AND(cancelled_by IS NULL)=(cancelled_at IS NULL)),
 CHECK(reviewed_by IS NULL OR submitted_by IS NOT NULL),CHECK(approved_by IS NULL OR reviewed_by IS NOT NULL),CHECK(posted_by IS NULL OR approved_by IS NOT NULL),
 CHECK(reviewed_by IS NULL OR reviewed_by<>created_by),CHECK(approved_by IS NULL OR approved_by<>created_by AND approved_by<>reviewed_by),
 CHECK(posted_by IS NULL OR posted_by<>created_by AND posted_by<>reviewed_by AND posted_by<>approved_by),
 CHECK(cancelled_by IS NULL OR cancelled_by<>created_by AND cancelled_by IS DISTINCT FROM reviewed_by AND cancelled_by IS DISTINCT FROM approved_by),
 CHECK((status='DRAFT' AND submitted_by IS NULL AND reviewed_by IS NULL AND approved_by IS NULL)
    OR(status='PENDING_REVIEW' AND submitted_by IS NOT NULL AND reviewed_by IS NULL AND approved_by IS NULL)
    OR(status='REVIEWED' AND submitted_by IS NOT NULL AND reviewed_by IS NOT NULL AND approved_by IS NULL)
    OR(status IN('APPROVED','POSTED') AND submitted_by IS NOT NULL AND reviewed_by IS NOT NULL AND approved_by IS NOT NULL)
    OR status='CANCELLED'),
 CHECK((status='POSTED' AND posted_by IS NOT NULL AND posted_at IS NOT NULL AND post_evidence_hash IS NOT NULL AND cancelled_by IS NULL AND cancelled_at IS NULL AND cancel_reason IS NULL)
    OR (status='CANCELLED' AND posted_by IS NULL AND posted_at IS NULL AND post_evidence_hash IS NULL AND cancelled_by IS NOT NULL AND cancelled_at IS NOT NULL AND length(btrim(cancel_reason)) BETWEEN 8 AND 2000)
    OR (status NOT IN('POSTED','CANCELLED') AND posted_by IS NULL AND posted_at IS NULL AND post_evidence_hash IS NULL AND cancelled_by IS NULL AND cancelled_at IS NULL AND cancel_reason IS NULL))
);

CREATE UNIQUE INDEX intercompany_elimination_one_active_source_uq
 ON intercompany_elimination_batch(tenant_id,canonical_source_scope_hash) WHERE status<>'CANCELLED';
CREATE INDEX intercompany_elimination_register_idx
 ON intercompany_elimination_batch(tenant_id,reporting_entity_id,reporting_period_id,created_at DESC,intercompany_elimination_batch_id DESC);

CREATE TABLE intercompany_elimination_line(
 intercompany_elimination_batch_id uuid NOT NULL,tenant_id uuid NOT NULL,line_no smallint NOT NULL CHECK(line_no IN(1,2)),
 member_entity_id uuid NOT NULL,member_period_id uuid NOT NULL,source_account_code text NOT NULL CHECK(source_account_code~'^[0-9A-Za-z._-]{1,64}$'),
 source_classification text NOT NULL CHECK(source_classification IN('DUE_FROM','DUE_TO')),
 presentation_account_code text NOT NULL CHECK(presentation_account_code~'^[0-9A-Za-z._-]{1,64}$'),presentation_side text NOT NULL CHECK(presentation_side IN('DEBIT','CREDIT')),
 entry_side text NOT NULL CHECK(entry_side IN('DEBIT','CREDIT')),debit_amount numeric(20,4) NOT NULL DEFAULT 0 CHECK(debit_amount>=0),credit_amount numeric(20,4) NOT NULL DEFAULT 0 CHECK(credit_amount>=0),
 consolidation_mapping_hash text NOT NULL CHECK(consolidation_mapping_hash~'^sha256:[0-9a-f]{64}$'),line_evidence_hash text NOT NULL CHECK(line_evidence_hash~'^sha256:[0-9a-f]{64}$'),
 PRIMARY KEY(intercompany_elimination_batch_id,line_no),
 FOREIGN KEY(tenant_id,intercompany_elimination_batch_id) REFERENCES intercompany_elimination_batch(tenant_id,intercompany_elimination_batch_id),
 FOREIGN KEY(tenant_id,member_entity_id,member_period_id) REFERENCES accounting_period(tenant_id,entity_id,period_id),
 CHECK((entry_side='DEBIT' AND debit_amount>0 AND credit_amount=0) OR(entry_side='CREDIT' AND credit_amount>0 AND debit_amount=0)),
 CHECK((source_classification='DUE_FROM' AND presentation_side='DEBIT' AND entry_side='CREDIT') OR(source_classification='DUE_TO' AND presentation_side='CREDIT' AND entry_side='DEBIT'))
);

CREATE TABLE intercompany_elimination_history(
 intercompany_elimination_history_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),intercompany_elimination_batch_id uuid NOT NULL,tenant_id uuid NOT NULL,
 from_status text,to_status text NOT NULL CHECK(to_status IN('DRAFT','PENDING_REVIEW','REVIEWED','APPROVED','POSTED','CANCELLED')),
 revision bigint NOT NULL CHECK(revision>=0),actor_id text NOT NULL,reason text,event_hash text NOT NULL CHECK(event_hash~'^sha256:[0-9a-f]{64}$'),created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 UNIQUE(intercompany_elimination_batch_id,revision),
 FOREIGN KEY(tenant_id,intercompany_elimination_batch_id) REFERENCES intercompany_elimination_batch(tenant_id,intercompany_elimination_batch_id)
);

CREATE TABLE intercompany_elimination_internal_gate(
 backend_pid integer NOT NULL,transaction_id bigint NOT NULL,tenant_id uuid NOT NULL,intercompany_elimination_batch_id uuid NOT NULL,
 operation text NOT NULL CHECK(operation IN('PENDING_REVIEW','REVIEWED','APPROVED','POSTED','CANCELLED','PROJECT')),
 PRIMARY KEY(backend_pid,transaction_id,tenant_id,intercompany_elimination_batch_id,operation)
);

ALTER TABLE intercompany_elimination_batch ENABLE ROW LEVEL SECURITY;
ALTER TABLE intercompany_elimination_line ENABLE ROW LEVEL SECURITY;
ALTER TABLE intercompany_elimination_history ENABLE ROW LEVEL SECURITY;
CREATE POLICY intercompany_elimination_batch_scope ON intercompany_elimination_batch USING(
 tenant_id=refs_current_tenant() AND refs_entity_allowed(reporting_entity_id) AND refs_entity_allowed(source_entity_id) AND refs_entity_allowed(counterparty_entity_id));
CREATE POLICY intercompany_elimination_line_scope ON intercompany_elimination_line USING(EXISTS(
 SELECT 1 FROM intercompany_elimination_batch b WHERE b.intercompany_elimination_batch_id=intercompany_elimination_line.intercompany_elimination_batch_id
 AND b.tenant_id=refs_current_tenant() AND refs_entity_allowed(b.reporting_entity_id) AND refs_entity_allowed(b.source_entity_id) AND refs_entity_allowed(b.counterparty_entity_id)));
CREATE POLICY intercompany_elimination_history_scope ON intercompany_elimination_history USING(EXISTS(
 SELECT 1 FROM intercompany_elimination_batch b WHERE b.intercompany_elimination_batch_id=intercompany_elimination_history.intercompany_elimination_batch_id
 AND b.tenant_id=refs_current_tenant() AND refs_entity_allowed(b.reporting_entity_id) AND refs_entity_allowed(b.source_entity_id) AND refs_entity_allowed(b.counterparty_entity_id)));
REVOKE ALL ON intercompany_elimination_batch,intercompany_elimination_line,intercompany_elimination_history,intercompany_elimination_internal_gate FROM PUBLIC,refs_app;

CREATE FUNCTION refs_protect_intercompany_elimination_batch() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog,public,pg_temp AS $$
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Intercompany elimination batches are retained evidence' USING ERRCODE='55000';END IF;
 IF NOT EXISTS(SELECT 1 FROM intercompany_elimination_internal_gate g WHERE g.backend_pid=pg_backend_pid() AND g.transaction_id=txid_current()
   AND g.tenant_id=OLD.tenant_id AND g.intercompany_elimination_batch_id=OLD.intercompany_elimination_batch_id AND g.operation=NEW.status) THEN
  RAISE EXCEPTION 'Intercompany elimination batch transition must use the authoritative command' USING ERRCODE='42501';
 END IF;
 IF (to_jsonb(NEW)-ARRAY['status','revision','submitted_by','submitted_at','reviewed_by','reviewed_at','approved_by','approved_at','posted_by','posted_at','cancelled_by','cancelled_at','cancel_reason','post_evidence_hash']::text[])
    IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['status','revision','submitted_by','submitted_at','reviewed_by','reviewed_at','approved_by','approved_at','posted_by','posted_at','cancelled_by','cancelled_at','cancel_reason','post_evidence_hash']::text[])
    OR NEW.revision<>OLD.revision+1
    OR NOT ((OLD.status='DRAFT' AND NEW.status IN('PENDING_REVIEW','CANCELLED'))
      OR(OLD.status='PENDING_REVIEW' AND NEW.status IN('REVIEWED','CANCELLED'))
      OR(OLD.status='REVIEWED' AND NEW.status IN('APPROVED','CANCELLED'))
      OR(OLD.status='APPROVED' AND NEW.status IN('POSTED','CANCELLED'))) THEN
  RAISE EXCEPTION 'Invalid intercompany elimination batch mutation' USING ERRCODE='55000';
 END IF;
 RETURN NEW;
END;$$;
CREATE TRIGGER intercompany_elimination_batch_protect BEFORE UPDATE OR DELETE ON intercompany_elimination_batch FOR EACH ROW EXECUTE FUNCTION refs_protect_intercompany_elimination_batch();
CREATE TRIGGER intercompany_elimination_line_append_only BEFORE UPDATE OR DELETE ON intercompany_elimination_line FOR EACH ROW EXECUTE FUNCTION reject_mutation();
CREATE TRIGGER intercompany_elimination_history_append_only BEFORE UPDATE OR DELETE ON intercompany_elimination_history FOR EACH ROW EXECUTE FUNCTION reject_mutation();

CREATE FUNCTION refs_guard_intercompany_elimination_projection() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE batch_id uuid;
BEGIN
 IF NEW.elimination_ref LIKE 'INTERCOMPANY_ELIMINATION_BATCH:%' THEN
  BEGIN batch_id:=split_part(NEW.elimination_ref,':',2)::uuid;EXCEPTION WHEN others THEN RAISE EXCEPTION 'Invalid authoritative intercompany elimination reference' USING ERRCODE='23514';END;
  IF NOT EXISTS(SELECT 1 FROM intercompany_elimination_batch b JOIN intercompany_elimination_internal_gate g ON g.tenant_id=b.tenant_id AND g.intercompany_elimination_batch_id=b.intercompany_elimination_batch_id
    AND g.backend_pid=pg_backend_pid() AND g.transaction_id=txid_current() AND g.operation='PROJECT'
    WHERE b.intercompany_elimination_batch_id=batch_id AND b.consolidation_snapshot_id=NEW.consolidation_snapshot_id AND b.status='APPROVED') THEN
   RAISE EXCEPTION 'Authoritative intercompany elimination evidence requires one approved batch Post' USING ERRCODE='42501';
  END IF;
 END IF;
 RETURN NEW;
END;$$;
CREATE TRIGGER consolidation_intercompany_elimination_projection_guard BEFORE INSERT ON consolidation_elimination_evidence FOR EACH ROW EXECUTE FUNCTION refs_guard_intercompany_elimination_projection();

CREATE FUNCTION refs_intercompany_elimination_source_snapshot(
 p_tenant uuid,p_reporting_entity uuid,p_reporting_period uuid,p_consolidation_snapshot uuid,
 p_source_entity uuid,p_source_period uuid,p_counterparty_entity uuid,p_counterparty_period uuid,p_source_account text
) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE rec record;src_map mapping_snapshot;cp_map mapping_snapshot;snap consolidation_snapshot;report_period accounting_period;src_period accounting_period;cp_period accounting_period;
 src_member consolidation_member;cp_member consolidation_member;src_account_map consolidation_account_map;cp_account_map consolidation_account_map;
 src_class text;cp_class text;matched numeric(20,4);scope_hash text;evidence jsonb;existing_count integer;member record;member_population_hash text;account_map_population_hash text;
BEGIN
 PERFORM refs_assert_scope(p_tenant,p_reporting_entity,'GROUP.INTERCOMPANY_ELIMINATION.VIEW');
 PERFORM refs_assert_scope(p_tenant,p_source_entity,'GL.REPORT.VIEW');PERFORM refs_assert_scope(p_tenant,p_counterparty_entity,'GL.REPORT.VIEW');
 IF p_source_entity IS NULL OR p_counterparty_entity IS NULL OR p_source_entity=p_counterparty_entity OR p_source_account IS NULL OR p_source_account!~'^[0-9A-Za-z._-]{1,64}$' THEN RAISE EXCEPTION 'Invalid intercompany elimination source scope' USING ERRCODE='22023';END IF;
 SELECT * INTO snap FROM consolidation_snapshot s WHERE s.tenant_id=p_tenant AND s.reporting_entity_id=p_reporting_entity AND s.reporting_period_id=p_reporting_period AND s.consolidation_snapshot_id=p_consolidation_snapshot;
 SELECT * INTO report_period FROM accounting_period p WHERE p.tenant_id=p_tenant AND p.entity_id=p_reporting_entity AND p.period_id=p_reporting_period;
 SELECT * INTO src_period FROM accounting_period p WHERE p.tenant_id=p_tenant AND p.entity_id=p_source_entity AND p.period_id=p_source_period;
 SELECT * INTO cp_period FROM accounting_period p WHERE p.tenant_id=p_tenant AND p.entity_id=p_counterparty_entity AND p.period_id=p_counterparty_period;
 IF snap.consolidation_snapshot_id IS NULL OR report_period.period_id IS NULL OR src_period.period_id IS NULL OR cp_period.period_id IS NULL
  OR report_period.ledger_code<>'PRIMARY' OR src_period.ledger_code<>'PRIMARY' OR cp_period.ledger_code<>'PRIMARY'
  OR EXISTS(SELECT 1 FROM consolidation_snapshot newer WHERE newer.tenant_id=snap.tenant_id AND newer.reporting_entity_id=snap.reporting_entity_id AND newer.reporting_period_id=snap.reporting_period_id AND newer.group_ref=snap.group_ref AND(newer.version,newer.consolidation_snapshot_id)>(snap.version,snap.consolidation_snapshot_id)) THEN
  RAISE EXCEPTION 'Current PRIMARY-ledger consolidation periods and snapshot are required' USING ERRCODE='55000';
 END IF;
 FOR member IN SELECT * FROM consolidation_member m WHERE m.consolidation_snapshot_id=snap.consolidation_snapshot_id LOOP
  PERFORM refs_assert_scope(p_tenant,member.member_entity_id,'GL.REPORT.VIEW');
 END LOOP;
 SELECT refs_jsonb_hash(coalesce(jsonb_agg(to_jsonb(m) ORDER BY m.member_entity_id),'[]'::jsonb)) INTO member_population_hash FROM consolidation_member m WHERE m.consolidation_snapshot_id=snap.consolidation_snapshot_id;
 SELECT refs_jsonb_hash(coalesce(jsonb_agg(to_jsonb(a) ORDER BY a.member_entity_id,a.source_account_code),'[]'::jsonb)) INTO account_map_population_hash FROM consolidation_account_map a WHERE a.consolidation_snapshot_id=snap.consolidation_snapshot_id;
 SELECT * INTO src_member FROM consolidation_member m WHERE m.consolidation_snapshot_id=snap.consolidation_snapshot_id AND m.member_entity_id=p_source_entity AND m.member_period_id=p_source_period;
 SELECT * INTO cp_member FROM consolidation_member m WHERE m.consolidation_snapshot_id=snap.consolidation_snapshot_id AND m.member_entity_id=p_counterparty_entity AND m.member_period_id=p_counterparty_period;
 IF src_member.member_entity_id IS NULL OR cp_member.member_entity_id IS NULL THEN RAISE EXCEPTION 'Both companies must be exact consolidation members for the selected periods' USING ERRCODE='55000';END IF;
 IF src_period.starts_on<>cp_period.starts_on OR src_period.ends_on<>cp_period.ends_on OR src_period.starts_on<>report_period.starts_on OR src_period.ends_on<>report_period.ends_on
  OR NOT EXISTS(SELECT 1 FROM entity a JOIN entity b ON b.tenant_id=a.tenant_id JOIN entity r ON r.tenant_id=a.tenant_id WHERE a.tenant_id=p_tenant AND a.entity_id=p_source_entity AND b.entity_id=p_counterparty_entity AND r.entity_id=p_reporting_entity AND a.base_currency=b.base_currency AND a.base_currency=r.base_currency AND a.base_currency=snap.currency) THEN
  RAISE EXCEPTION 'Intercompany elimination requires aligned periods and one consolidation currency' USING ERRCODE='55000';
 END IF;
 SELECT r.* INTO rec FROM refs_get_intercompany_reconciliation(p_tenant,p_source_entity,p_source_period,p_counterparty_entity,p_counterparty_period) r WHERE r.account_code=p_source_account;
 IF rec.account_code IS NULL OR rec.mapping_status<>'MAPPED_INTERCOMPANY_PAIR' THEN RAISE EXCEPTION 'One exact mapped intercompany reconciliation row is required' USING ERRCODE='55000';END IF;
 SELECT * INTO src_map FROM mapping_snapshot WHERE tenant_id=p_tenant AND mapping_snapshot_id=rec.mapping_snapshot_id;
 SELECT * INTO cp_map FROM mapping_snapshot WHERE tenant_id=p_tenant AND mapping_snapshot_id=rec.counterparty_mapping_snapshot_id;
 src_class:=src_map.output_rules->>'classification';cp_class:=cp_map.output_rules->>'classification';
 IF src_map.snapshot_hash IS DISTINCT FROM rec.mapping_snapshot_hash OR cp_map.snapshot_hash IS DISTINCT FROM rec.counterparty_mapping_snapshot_hash
  OR src_map.output_rules->>'counterparty_classification' IS DISTINCT FROM cp_class OR cp_map.output_rules->>'counterparty_classification' IS DISTINCT FROM src_class
  OR src_map.output_rules->>'counterparty_account_code' IS DISTINCT FROM rec.counterparty_account_code OR cp_map.output_rules->>'counterparty_account_code' IS DISTINCT FROM rec.account_code
  OR NOT((src_class='DUE_FROM' AND cp_class='DUE_TO' AND rec.current_closing_balance>0 AND rec.counterparty_closing_balance<0)
       OR(src_class='DUE_TO' AND cp_class='DUE_FROM' AND rec.current_closing_balance<0 AND rec.counterparty_closing_balance>0)) THEN
  RAISE EXCEPTION 'Reciprocal DUE_FROM and DUE_TO mappings and normal-sign balances are required' USING ERRCODE='55000';
 END IF;
 SELECT * INTO src_account_map FROM consolidation_account_map a WHERE a.consolidation_snapshot_id=snap.consolidation_snapshot_id AND a.member_entity_id=p_source_entity AND a.source_account_code=rec.account_code;
 SELECT * INTO cp_account_map FROM consolidation_account_map a WHERE a.consolidation_snapshot_id=snap.consolidation_snapshot_id AND a.member_entity_id=p_counterparty_entity AND a.source_account_code=rec.counterparty_account_code;
 IF src_account_map.source_account_code IS NULL OR cp_account_map.source_account_code IS NULL
  OR(src_class='DUE_FROM' AND src_account_map.presentation_side<>'DEBIT') OR(src_class='DUE_TO' AND src_account_map.presentation_side<>'CREDIT')
  OR(cp_class='DUE_FROM' AND cp_account_map.presentation_side<>'DEBIT') OR(cp_class='DUE_TO' AND cp_account_map.presentation_side<>'CREDIT') THEN
  RAISE EXCEPTION 'Consolidation mappings must preserve DUE_FROM debit and DUE_TO credit presentation sides' USING ERRCODE='55000';
 END IF;
 SELECT count(*) INTO existing_count FROM consolidation_elimination_evidence e WHERE e.consolidation_snapshot_id=snap.consolidation_snapshot_id
  AND(e.presentation_account_code,e.presentation_side) IN((src_account_map.presentation_account_code,src_account_map.presentation_side),(cp_account_map.presentation_account_code,cp_account_map.presentation_side));
 IF existing_count<>0 THEN RAISE EXCEPTION 'Existing presentation elimination evidence makes source allocation ambiguous' USING ERRCODE='55000';END IF;
 matched:=LEAST(abs(rec.current_closing_balance),abs(rec.counterparty_closing_balance));
 IF matched<=0 THEN RAISE EXCEPTION 'A positive matched intercompany amount is required' USING ERRCODE='55000';END IF;
 scope_hash:=refs_jsonb_hash(CASE WHEN p_source_entity::text<p_counterparty_entity::text THEN jsonb_build_object(
  'consolidation_snapshot_id',snap.consolidation_snapshot_id,'currency',snap.currency,
  'first_entity_id',p_source_entity,'first_period_id',p_source_period,'first_account_code',rec.account_code,'first_mapping_snapshot_id',rec.mapping_snapshot_id,
  'second_entity_id',p_counterparty_entity,'second_period_id',p_counterparty_period,'second_account_code',rec.counterparty_account_code,'second_mapping_snapshot_id',rec.counterparty_mapping_snapshot_id)
 ELSE jsonb_build_object('consolidation_snapshot_id',snap.consolidation_snapshot_id,'currency',snap.currency,
  'first_entity_id',p_counterparty_entity,'first_period_id',p_counterparty_period,'first_account_code',rec.counterparty_account_code,'first_mapping_snapshot_id',rec.counterparty_mapping_snapshot_id,
  'second_entity_id',p_source_entity,'second_period_id',p_source_period,'second_account_code',rec.account_code,'second_mapping_snapshot_id',rec.mapping_snapshot_id) END);
 evidence:=jsonb_build_object('schema_version','INTERCOMPANY_ELIMINATION_SOURCE_V1','reporting_entity_id',p_reporting_entity,'reporting_period_id',p_reporting_period,
  'period_cutoff',report_period.ends_on,'reporting_period_start',report_period.starts_on,'reporting_period_end',report_period.ends_on,'reporting_period_ledger_code',report_period.ledger_code,'reporting_period_status',report_period.status,'reporting_period_version',report_period.version::text,'consolidation_snapshot_id',snap.consolidation_snapshot_id,'consolidation_version',snap.version::text,'consolidation_snapshot_hash',snap.snapshot_hash,'consolidation_receipt_hash',snap.receipt_hash,'consolidation_member_population_hash',member_population_hash,'consolidation_account_map_population_hash',account_map_population_hash,'group_ref',snap.group_ref,'currency',snap.currency,
  'source_entity_id',p_source_entity,'source_period_id',p_source_period,'source_period_start',src_period.starts_on,'source_period_end',src_period.ends_on,'source_period_ledger_code',src_period.ledger_code,'source_period_status',src_period.status,'source_period_version',src_period.version::text,'source_account_code',rec.account_code,'source_classification',src_class,'source_normal_sign',CASE src_class WHEN 'DUE_FROM' THEN 'DEBIT_POSITIVE' ELSE 'CREDIT_NEGATIVE' END,'source_closing_balance',rec.current_closing_balance::text,
  'source_mapping_snapshot_id',rec.mapping_snapshot_id,'source_mapping_version',rec.mapping_version,'source_mapping_snapshot_hash',rec.mapping_snapshot_hash,'source_journal_entry_ids',to_jsonb(rec.journal_entry_ids),'source_journal_line_ids',to_jsonb(rec.journal_line_ids),'source_ledger_line_ids',to_jsonb(rec.ledger_line_ids),'source_document_ids',to_jsonb(rec.source_document_ids),'source_member_snapshot_hash',src_member.member_snapshot_hash,'source_member_receipt_hash',src_member.member_receipt_hash,
  'counterparty_entity_id',p_counterparty_entity,'counterparty_period_id',p_counterparty_period,'counterparty_period_start',cp_period.starts_on,'counterparty_period_end',cp_period.ends_on,'counterparty_period_ledger_code',cp_period.ledger_code,'counterparty_period_status',cp_period.status,'counterparty_period_version',cp_period.version::text,'counterparty_account_code',rec.counterparty_account_code,'counterparty_classification',cp_class,'counterparty_normal_sign',CASE cp_class WHEN 'DUE_FROM' THEN 'DEBIT_POSITIVE' ELSE 'CREDIT_NEGATIVE' END,'counterparty_closing_balance',rec.counterparty_closing_balance::text,
  'counterparty_mapping_snapshot_id',rec.counterparty_mapping_snapshot_id,'counterparty_mapping_version',rec.counterparty_mapping_version,'counterparty_mapping_snapshot_hash',rec.counterparty_mapping_snapshot_hash,'counterparty_journal_entry_ids',to_jsonb(rec.counterparty_journal_entry_ids),'counterparty_journal_line_ids',to_jsonb(rec.counterparty_journal_line_ids),'counterparty_ledger_line_ids',to_jsonb(rec.counterparty_ledger_line_ids),'counterparty_source_document_ids',to_jsonb(rec.counterparty_source_document_ids),'counterparty_member_snapshot_hash',cp_member.member_snapshot_hash,'counterparty_member_receipt_hash',cp_member.member_receipt_hash,
  'source_presentation_account_code',src_account_map.presentation_account_code,'source_presentation_side',src_account_map.presentation_side,'source_consolidation_mapping_hash',src_account_map.mapping_hash,
  'counterparty_presentation_account_code',cp_account_map.presentation_account_code,'counterparty_presentation_side',cp_account_map.presentation_side,'counterparty_consolidation_mapping_hash',cp_account_map.mapping_hash,
  'matched_amount',matched::text,'raw_mismatch',(rec.current_closing_balance+rec.counterparty_closing_balance)::text,'canonical_source_scope_hash',scope_hash);
 RETURN evidence||jsonb_build_object('source_evidence_hash',refs_jsonb_hash(evidence));
END;$$;

CREATE FUNCTION refs_intercompany_elimination_posted_source_current(p_tenant uuid,p_batch uuid) RETURNS boolean
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE b intercompany_elimination_batch;rec record;src_map mapping_snapshot;cp_map mapping_snapshot;member_hash text;account_map_hash text;line_count integer;projection_count integer;
BEGIN
 SELECT * INTO b FROM intercompany_elimination_batch WHERE tenant_id=p_tenant AND intercompany_elimination_batch_id=p_batch AND status='POSTED';
 IF NOT FOUND THEN RETURN false;END IF;
 PERFORM refs_assert_scope(p_tenant,b.source_entity_id,'GL.REPORT.VIEW');PERFORM refs_assert_scope(p_tenant,b.counterparty_entity_id,'GL.REPORT.VIEW');
 IF NOT EXISTS(SELECT 1 FROM accounting_period r JOIN accounting_period s ON s.tenant_id=r.tenant_id JOIN accounting_period c ON c.tenant_id=r.tenant_id
   WHERE r.tenant_id=p_tenant AND r.entity_id=b.reporting_entity_id AND r.period_id=b.reporting_period_id AND r.ledger_code=b.reporting_period_ledger_code AND r.starts_on=b.period_start AND r.ends_on=b.period_end
   AND s.entity_id=b.source_entity_id AND s.period_id=b.source_period_id AND s.ledger_code=b.source_period_ledger_code AND s.starts_on=b.period_start AND s.ends_on=b.period_end
   AND c.entity_id=b.counterparty_entity_id AND c.period_id=b.counterparty_period_id AND c.ledger_code=b.counterparty_period_ledger_code AND c.starts_on=b.period_start AND c.ends_on=b.period_end) THEN RETURN false;END IF;
 IF NOT EXISTS(SELECT 1 FROM consolidation_snapshot s WHERE s.tenant_id=p_tenant AND s.consolidation_snapshot_id=b.consolidation_snapshot_id AND s.reporting_entity_id=b.reporting_entity_id AND s.reporting_period_id=b.reporting_period_id AND s.version=b.consolidation_version AND s.snapshot_hash=b.consolidation_snapshot_hash AND s.receipt_hash=b.consolidation_receipt_hash) THEN RETURN false;END IF;
 SELECT refs_jsonb_hash(coalesce(jsonb_agg(to_jsonb(m) ORDER BY m.member_entity_id),'[]'::jsonb)) INTO member_hash FROM consolidation_member m WHERE m.consolidation_snapshot_id=b.consolidation_snapshot_id;
 SELECT refs_jsonb_hash(coalesce(jsonb_agg(to_jsonb(a) ORDER BY a.member_entity_id,a.source_account_code),'[]'::jsonb)) INTO account_map_hash FROM consolidation_account_map a WHERE a.consolidation_snapshot_id=b.consolidation_snapshot_id;
 IF member_hash IS DISTINCT FROM b.consolidation_member_population_hash OR account_map_hash IS DISTINCT FROM b.consolidation_account_map_population_hash THEN RETURN false;END IF;
 SELECT r.* INTO rec FROM refs_get_intercompany_reconciliation(p_tenant,b.source_entity_id,b.source_period_id,b.counterparty_entity_id,b.counterparty_period_id) r WHERE r.account_code=b.source_account_code;
 IF rec.account_code IS NULL OR rec.mapping_status<>'MAPPED_INTERCOMPANY_PAIR' OR rec.current_closing_balance<>b.source_closing_balance OR rec.counterparty_closing_balance<>b.counterparty_closing_balance
  OR rec.counterparty_account_code<>b.counterparty_account_code OR rec.mapping_snapshot_id<>b.source_mapping_snapshot_id OR rec.mapping_snapshot_hash<>b.source_mapping_snapshot_hash
  OR rec.counterparty_mapping_snapshot_id<>b.counterparty_mapping_snapshot_id OR rec.counterparty_mapping_snapshot_hash<>b.counterparty_mapping_snapshot_hash
  OR rec.journal_entry_ids IS DISTINCT FROM b.source_journal_entry_ids OR rec.journal_line_ids IS DISTINCT FROM b.source_journal_line_ids OR rec.ledger_line_ids IS DISTINCT FROM b.source_ledger_line_ids OR rec.source_document_ids IS DISTINCT FROM b.source_document_ids
  OR rec.counterparty_journal_entry_ids IS DISTINCT FROM b.counterparty_journal_entry_ids OR rec.counterparty_journal_line_ids IS DISTINCT FROM b.counterparty_journal_line_ids OR rec.counterparty_ledger_line_ids IS DISTINCT FROM b.counterparty_ledger_line_ids OR rec.counterparty_source_document_ids IS DISTINCT FROM b.counterparty_source_document_ids THEN RETURN false;END IF;
 SELECT * INTO src_map FROM mapping_snapshot WHERE tenant_id=p_tenant AND mapping_snapshot_id=b.source_mapping_snapshot_id;
 SELECT * INTO cp_map FROM mapping_snapshot WHERE tenant_id=p_tenant AND mapping_snapshot_id=b.counterparty_mapping_snapshot_id;
 IF src_map.output_rules->>'classification' IS DISTINCT FROM b.source_classification OR cp_map.output_rules->>'classification' IS DISTINCT FROM b.counterparty_classification
  OR src_map.output_rules->>'counterparty_classification' IS DISTINCT FROM b.counterparty_classification OR cp_map.output_rules->>'counterparty_classification' IS DISTINCT FROM b.source_classification THEN RETURN false;END IF;
 SELECT count(*) INTO line_count FROM intercompany_elimination_line l JOIN consolidation_account_map a ON a.consolidation_snapshot_id=b.consolidation_snapshot_id AND a.member_entity_id=l.member_entity_id AND a.source_account_code=l.source_account_code AND a.presentation_account_code=l.presentation_account_code AND a.presentation_side=l.presentation_side AND a.mapping_hash=l.consolidation_mapping_hash WHERE l.tenant_id=p_tenant AND l.intercompany_elimination_batch_id=p_batch;
 SELECT count(*) INTO projection_count FROM consolidation_elimination_evidence e JOIN intercompany_elimination_line l ON l.intercompany_elimination_batch_id=p_batch AND e.consolidation_snapshot_id=b.consolidation_snapshot_id AND e.presentation_account_code=l.presentation_account_code AND e.presentation_side=l.presentation_side AND e.elimination_ref='INTERCOMPANY_ELIMINATION_BATCH:'||p_batch::text||':LINE:'||l.line_no AND e.elimination_amount=b.matched_amount AND e.evidence_hash=l.line_evidence_hash AND e.receipt_hash=b.post_evidence_hash;
 RETURN line_count=2 AND projection_count=2;
EXCEPTION WHEN others THEN RETURN false;
END;$$;

ALTER FUNCTION refs_get_consolidation(uuid,uuid,uuid,text) RENAME TO refs_get_consolidation_082;
CREATE FUNCTION refs_get_consolidation(p_tenant uuid,p_entity uuid,p_period uuid,p_group_ref text)
RETURNS TABLE(
 group_ref text,period_id uuid,period_code text,period_start text,period_end text,currency text,
 presentation_account_code text,presentation_side text,report_status text,classification_basis text,
 member_count integer,evidence_member_count integer,member_actual_amount numeric(20,4),elimination_amount numeric(20,4),consolidated_amount numeric(20,4),
 consolidation_snapshot_id uuid,consolidation_version text,consolidation_snapshot_hash text,consolidation_receipt_hash text,consolidation_source_ref text,consolidation_source_version text,
 member_entity_ids uuid[],journal_entry_ids uuid[],journal_line_ids uuid[],ledger_line_ids uuid[],source_document_ids uuid[],elimination_refs text[]
) LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
 WITH base AS MATERIALIZED(SELECT * FROM refs_get_consolidation_082(p_tenant,p_entity,p_period,p_group_ref)),marked AS(
  SELECT x.*,x.report_status='APPROVED_CONSOLIDATION_SNAPSHOT_AND_POSTED_LEDGER_EXACT' AND EXISTS(SELECT 1 FROM intercompany_elimination_batch b WHERE b.tenant_id=p_tenant AND b.consolidation_snapshot_id=x.consolidation_snapshot_id AND b.status='POSTED'
   AND EXISTS(SELECT 1 FROM intercompany_elimination_line l WHERE l.intercompany_elimination_batch_id=b.intercompany_elimination_batch_id AND l.presentation_account_code=x.presentation_account_code AND l.presentation_side=x.presentation_side)
   AND NOT refs_intercompany_elimination_posted_source_current(p_tenant,b.intercompany_elimination_batch_id)) stale
  FROM base x)
 SELECT m.group_ref,m.period_id,m.period_code,m.period_start,m.period_end,m.currency,m.presentation_account_code,m.presentation_side,
  CASE WHEN m.stale THEN 'BLOCKED_STALE_INTERCOMPANY_ELIMINATION_SOURCE' ELSE m.report_status END,
  CASE WHEN m.stale THEN 'POSTED_INTERCOMPANY_ELIMINATION_SOURCE_EVIDENCE_CHANGED_NEW_CONSOLIDATION_SNAPSHOT_REQUIRED' ELSE m.classification_basis END,
  m.member_count,m.evidence_member_count,
  CASE WHEN m.stale THEN NULL::numeric(20,4) ELSE m.member_actual_amount END,
  CASE WHEN m.stale THEN NULL::numeric(20,4) ELSE m.elimination_amount END,
  CASE WHEN m.stale THEN NULL::numeric(20,4) ELSE m.consolidated_amount END,
  m.consolidation_snapshot_id,m.consolidation_version,m.consolidation_snapshot_hash,m.consolidation_receipt_hash,m.consolidation_source_ref,m.consolidation_source_version,
  m.member_entity_ids,m.journal_entry_ids,m.journal_line_ids,m.ledger_line_ids,m.source_document_ids,m.elimination_refs
 FROM marked m ORDER BY m.presentation_account_code,m.presentation_side
$$;

REVOKE ALL ON FUNCTION refs_get_consolidation_082(uuid,uuid,uuid,text),refs_get_consolidation(uuid,uuid,uuid,text) FROM PUBLIC,refs_app;
GRANT EXECUTE ON FUNCTION refs_get_consolidation(uuid,uuid,uuid,text) TO refs_app;

CREATE FUNCTION refs_intercompany_elimination_create_hash(
 p_tenant uuid,p_reporting_entity uuid,p_reporting_period uuid,p_consolidation_snapshot uuid,p_source_entity uuid,p_source_period uuid,
 p_counterparty_entity uuid,p_counterparty_period uuid,p_source_account text,p_expected_source_hash text,p_reason text
) RETURNS text LANGUAGE sql IMMUTABLE SET search_path=pg_catalog,public,pg_temp AS $$
 SELECT refs_jsonb_hash(jsonb_build_object('schema_version','INTERCOMPANY_ELIMINATION_CREATE_COMMAND_V1','tenant_id',p_tenant,'reporting_entity_id',p_reporting_entity,
  'reporting_period_id',p_reporting_period,'consolidation_snapshot_id',p_consolidation_snapshot,'source_entity_id',p_source_entity,'source_period_id',p_source_period,
  'counterparty_entity_id',p_counterparty_entity,'counterparty_period_id',p_counterparty_period,'source_account_code',btrim(p_source_account),
  'expected_source_evidence_hash',p_expected_source_hash,'reason',btrim(p_reason)))
$$;

CREATE FUNCTION refs_intercompany_elimination_transition_hash(p_tenant uuid,p_reporting_entity uuid,p_batch uuid,p_action text,p_expected_revision bigint,p_reason text)
RETURNS text LANGUAGE sql IMMUTABLE SET search_path=pg_catalog,public,pg_temp AS $$
 SELECT refs_jsonb_hash(jsonb_build_object('schema_version','INTERCOMPANY_ELIMINATION_TRANSITION_COMMAND_V1','tenant_id',p_tenant,'reporting_entity_id',p_reporting_entity,
  'batch_id',p_batch,'action',upper(p_action),'expected_revision',p_expected_revision,'reason',btrim(p_reason)))
$$;
CREATE FUNCTION refs_intercompany_elimination_post_hash(p_tenant uuid,p_reporting_entity uuid,p_batch uuid,p_expected_revision bigint)
RETURNS text LANGUAGE sql IMMUTABLE SET search_path=pg_catalog,public,pg_temp AS $$
 SELECT refs_jsonb_hash(jsonb_build_object('schema_version','INTERCOMPANY_ELIMINATION_POST_COMMAND_V1','tenant_id',p_tenant,'reporting_entity_id',p_reporting_entity,'batch_id',p_batch,'expected_revision',p_expected_revision))
$$;

CREATE FUNCTION refs_intercompany_elimination_batch_payload(p_tenant uuid,p_reporting_entity uuid,p_batch uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE b intercompany_elimination_batch;lines jsonb;history jsonb;consolidation_rows jsonb:='[]'::jsonb;actor text:=refs_current_actor();source_current boolean:=false;
BEGIN
 SELECT * INTO b FROM intercompany_elimination_batch WHERE tenant_id=p_tenant AND reporting_entity_id=p_reporting_entity AND intercompany_elimination_batch_id=p_batch;
 IF NOT FOUND THEN RAISE EXCEPTION 'Intercompany elimination batch was not found' USING ERRCODE='P0002';END IF;
 SELECT coalesce(jsonb_agg(jsonb_build_object('line_no',l.line_no,'member_entity_id',l.member_entity_id,'member_period_id',l.member_period_id,'source_account_code',l.source_account_code,
  'source_classification',l.source_classification,'presentation_account_code',l.presentation_account_code,'presentation_side',l.presentation_side,'entry_side',l.entry_side,
  'debit_amount',l.debit_amount::text,'credit_amount',l.credit_amount::text,'consolidation_mapping_hash',l.consolidation_mapping_hash,'line_evidence_hash',l.line_evidence_hash) ORDER BY l.line_no),'[]'::jsonb) INTO lines
 FROM intercompany_elimination_line l WHERE l.tenant_id=p_tenant AND l.intercompany_elimination_batch_id=p_batch;
 SELECT coalesce(jsonb_agg(jsonb_build_object('from_status',h.from_status,'to_status',h.to_status,'revision',h.revision::text,'actor_id',h.actor_id,'reason',h.reason,'event_hash',h.event_hash,'created_at',h.created_at) ORDER BY h.revision),'[]'::jsonb) INTO history
 FROM intercompany_elimination_history h WHERE h.tenant_id=p_tenant AND h.intercompany_elimination_batch_id=p_batch;
 IF b.status='POSTED' THEN
  source_current:=refs_intercompany_elimination_posted_source_current(p_tenant,b.intercompany_elimination_batch_id);
 ELSIF b.status<>'CANCELLED' THEN
  BEGIN source_current:=(refs_intercompany_elimination_source_snapshot(p_tenant,b.reporting_entity_id,b.reporting_period_id,b.consolidation_snapshot_id,b.source_entity_id,b.source_period_id,b.counterparty_entity_id,b.counterparty_period_id,b.source_account_code)->>'source_evidence_hash')=b.source_evidence_hash;EXCEPTION WHEN others THEN source_current:=false;END;
 END IF;
 IF b.status='POSTED' THEN
  SELECT coalesce(jsonb_agg(jsonb_build_object('group_ref',x.group_ref,'period_id',x.period_id,'period_code',x.period_code,'period_start',x.period_start,'period_end',x.period_end,'currency',x.currency,
   'presentation_account_code',x.presentation_account_code,'presentation_side',x.presentation_side,'report_status',x.report_status,'classification_basis',x.classification_basis,
   'member_count',x.member_count,'evidence_member_count',x.evidence_member_count,'member_actual_amount',x.member_actual_amount::text,'elimination_amount',x.elimination_amount::text,'consolidated_amount',x.consolidated_amount::text,
   'consolidation_snapshot_id',x.consolidation_snapshot_id,'consolidation_version',x.consolidation_version,'consolidation_snapshot_hash',x.consolidation_snapshot_hash,'consolidation_receipt_hash',x.consolidation_receipt_hash,'consolidation_source_ref',x.consolidation_source_ref,'consolidation_source_version',x.consolidation_source_version,
   'member_entity_ids',to_jsonb(x.member_entity_ids),'journal_entry_ids',to_jsonb(x.journal_entry_ids),'journal_line_ids',to_jsonb(x.journal_line_ids),'ledger_line_ids',to_jsonb(x.ledger_line_ids),'source_document_ids',to_jsonb(x.source_document_ids),'elimination_refs',to_jsonb(x.elimination_refs)) ORDER BY x.presentation_account_code,x.presentation_side),'[]'::jsonb) INTO consolidation_rows
  FROM refs_get_consolidation(p_tenant,b.reporting_entity_id,b.reporting_period_id,b.group_ref) x
  WHERE EXISTS(SELECT 1 FROM intercompany_elimination_line l WHERE l.intercompany_elimination_batch_id=b.intercompany_elimination_batch_id AND l.presentation_account_code=x.presentation_account_code AND l.presentation_side=x.presentation_side);
 END IF;
 RETURN jsonb_build_object('schema_version','INTERCOMPANY_ELIMINATION_BATCH_V1','intercompany_elimination_batch_id',b.intercompany_elimination_batch_id,
  'reporting_entity_id',b.reporting_entity_id,'reporting_period_id',b.reporting_period_id,'reporting_period_ledger_code',b.reporting_period_ledger_code,'reporting_period_status',b.reporting_period_status,'reporting_period_version',b.reporting_period_version::text,'period_start',b.period_start,'period_end',b.period_end,'consolidation_snapshot_id',b.consolidation_snapshot_id,'consolidation_version',b.consolidation_version::text,'consolidation_snapshot_hash',b.consolidation_snapshot_hash,'consolidation_receipt_hash',b.consolidation_receipt_hash,'consolidation_member_population_hash',b.consolidation_member_population_hash,'consolidation_account_map_population_hash',b.consolidation_account_map_population_hash,'group_ref',b.group_ref,'currency',b.currency,
  'source_entity_id',b.source_entity_id,'source_period_id',b.source_period_id,'source_period_ledger_code',b.source_period_ledger_code,'source_period_status',b.source_period_status,'source_period_version',b.source_period_version::text,'source_account_code',b.source_account_code,'source_classification',b.source_classification,'source_normal_sign',CASE b.source_classification WHEN 'DUE_FROM' THEN 'DEBIT_POSITIVE' ELSE 'CREDIT_NEGATIVE' END,'source_closing_balance',b.source_closing_balance::text,
  'source_mapping_snapshot_id',b.source_mapping_snapshot_id,'source_mapping_snapshot_hash',b.source_mapping_snapshot_hash,'source_journal_entry_ids',to_jsonb(b.source_journal_entry_ids),'source_journal_line_ids',to_jsonb(b.source_journal_line_ids),'source_ledger_line_ids',to_jsonb(b.source_ledger_line_ids),'source_document_ids',to_jsonb(b.source_document_ids),
  'source_presentation_account_code',lines->0->>'presentation_account_code','source_presentation_side',lines->0->>'presentation_side','source_consolidation_mapping_hash',lines->0->>'consolidation_mapping_hash',
  'counterparty_entity_id',b.counterparty_entity_id,'counterparty_period_id',b.counterparty_period_id,'counterparty_period_ledger_code',b.counterparty_period_ledger_code,'counterparty_period_status',b.counterparty_period_status,'counterparty_period_version',b.counterparty_period_version::text,'counterparty_account_code',b.counterparty_account_code,'counterparty_classification',b.counterparty_classification,'counterparty_normal_sign',CASE b.counterparty_classification WHEN 'DUE_FROM' THEN 'DEBIT_POSITIVE' ELSE 'CREDIT_NEGATIVE' END,'counterparty_closing_balance',b.counterparty_closing_balance::text,
  'counterparty_mapping_snapshot_id',b.counterparty_mapping_snapshot_id,'counterparty_mapping_snapshot_hash',b.counterparty_mapping_snapshot_hash,'counterparty_journal_entry_ids',to_jsonb(b.counterparty_journal_entry_ids),'counterparty_journal_line_ids',to_jsonb(b.counterparty_journal_line_ids),'counterparty_ledger_line_ids',to_jsonb(b.counterparty_ledger_line_ids),'counterparty_source_document_ids',to_jsonb(b.counterparty_source_document_ids),
  'counterparty_presentation_account_code',lines->1->>'presentation_account_code','counterparty_presentation_side',lines->1->>'presentation_side','counterparty_consolidation_mapping_hash',lines->1->>'consolidation_mapping_hash',
  'matched_amount',b.matched_amount::text,'raw_mismatch',b.raw_mismatch::text,'canonical_source_scope_hash',b.canonical_source_scope_hash,'source_evidence_hash',b.source_evidence_hash,'source_current',source_current,
  'status',b.status,'revision',b.revision::text,'lines',lines,'history',history,'consolidation_results',consolidation_rows,
  'created_by',b.created_by,'created_at',b.created_at,'submitted_by',b.submitted_by,'submitted_at',b.submitted_at,'reviewed_by',b.reviewed_by,'reviewed_at',b.reviewed_at,'approved_by',b.approved_by,'approved_at',b.approved_at,'posted_by',b.posted_by,'posted_at',b.posted_at,'cancelled_by',b.cancelled_by,'cancelled_at',b.cancelled_at,'cancel_reason',b.cancel_reason,'post_evidence_hash',b.post_evidence_hash,
  'action_flags',jsonb_build_object('can_create_draft',false,
   'can_submit',b.status='DRAFT' AND source_current AND refs_entity_has_permission(b.reporting_entity_id,'GROUP.INTERCOMPANY_ELIMINATION.SUBMIT'),
   'can_review',b.status='PENDING_REVIEW' AND source_current AND actor IS DISTINCT FROM b.created_by AND refs_entity_has_permission(b.reporting_entity_id,'GROUP.INTERCOMPANY_ELIMINATION.REVIEW'),
   'can_approve',b.status='REVIEWED' AND source_current AND actor IS DISTINCT FROM b.created_by AND actor IS DISTINCT FROM b.reviewed_by AND refs_entity_has_permission(b.reporting_entity_id,'GROUP.INTERCOMPANY_ELIMINATION.APPROVE'),
   'can_cancel',b.status NOT IN('POSTED','CANCELLED') AND actor IS DISTINCT FROM b.created_by AND actor IS DISTINCT FROM b.reviewed_by AND actor IS DISTINCT FROM b.approved_by AND refs_entity_has_permission(b.reporting_entity_id,'GROUP.INTERCOMPANY_ELIMINATION.CANCEL'),
   'can_post',b.status='APPROVED' AND source_current AND actor IS DISTINCT FROM b.created_by AND actor IS DISTINCT FROM b.reviewed_by AND actor IS DISTINCT FROM b.approved_by AND refs_entity_has_permission(b.reporting_entity_id,'GROUP.INTERCOMPANY_ELIMINATION.POST')));
END;$$;

CREATE FUNCTION refs_read_intercompany_elimination_batch(p_tenant uuid,p_reporting_entity uuid,p_batch uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE b intercompany_elimination_batch;
BEGIN
 PERFORM refs_assert_scope(p_tenant,p_reporting_entity,'GROUP.INTERCOMPANY_ELIMINATION.VIEW');
 SELECT * INTO b FROM intercompany_elimination_batch WHERE tenant_id=p_tenant AND reporting_entity_id=p_reporting_entity AND intercompany_elimination_batch_id=p_batch;
 IF NOT FOUND THEN RAISE EXCEPTION 'Intercompany elimination batch was not found' USING ERRCODE='P0002';END IF;
 PERFORM refs_assert_scope(p_tenant,b.source_entity_id,'GL.REPORT.VIEW');PERFORM refs_assert_scope(p_tenant,b.counterparty_entity_id,'GL.REPORT.VIEW');
 RETURN refs_intercompany_elimination_batch_payload(p_tenant,p_reporting_entity,p_batch);
END;$$;

CREATE FUNCTION refs_read_intercompany_elimination_create_options(
 p_tenant uuid,p_reporting_entity uuid,p_reporting_period uuid,p_group_ref text,p_source_entity uuid,p_source_period uuid,p_counterparty_entity uuid,p_counterparty_period uuid
) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE snap consolidation_snapshot;rec record;option jsonb;options jsonb:='[]'::jsonb;
BEGIN
 PERFORM refs_assert_scope(p_tenant,p_reporting_entity,'GROUP.INTERCOMPANY_ELIMINATION.VIEW');
 PERFORM refs_assert_scope(p_tenant,p_source_entity,'GL.REPORT.VIEW');PERFORM refs_assert_scope(p_tenant,p_counterparty_entity,'GL.REPORT.VIEW');
 SELECT s.* INTO snap FROM consolidation_snapshot s JOIN accounting_period p ON p.tenant_id=s.tenant_id AND p.entity_id=s.reporting_entity_id AND p.period_id=s.reporting_period_id AND p.ledger_code='PRIMARY' AND p.status='OPEN' WHERE s.tenant_id=p_tenant AND s.reporting_entity_id=p_reporting_entity AND s.reporting_period_id=p_reporting_period AND s.group_ref=p_group_ref ORDER BY s.version DESC,s.consolidation_snapshot_id DESC LIMIT 1;
 IF NOT FOUND THEN RETURN jsonb_build_object('schema_version','INTERCOMPANY_ELIMINATION_CREATE_OPTIONS_V1','reporting_entity_id',p_reporting_entity,'reporting_period_id',p_reporting_period,'group_ref',p_group_ref,'source_entity_id',p_source_entity,'source_period_id',p_source_period,'counterparty_entity_id',p_counterparty_entity,'counterparty_period_id',p_counterparty_period,'consolidation_snapshot_id',NULL,'currency',NULL,'options','[]'::jsonb,'action_flags',jsonb_build_object('can_create_draft',false,'can_submit',false,'can_review',false,'can_approve',false,'can_cancel',false,'can_post',false));END IF;
 FOR rec IN SELECT * FROM refs_get_intercompany_reconciliation(p_tenant,p_source_entity,p_source_period,p_counterparty_entity,p_counterparty_period) ORDER BY account_code LOOP
  BEGIN
   option:=refs_intercompany_elimination_source_snapshot(p_tenant,p_reporting_entity,p_reporting_period,snap.consolidation_snapshot_id,p_source_entity,p_source_period,p_counterparty_entity,p_counterparty_period,rec.account_code);
   IF NOT EXISTS(SELECT 1 FROM intercompany_elimination_batch b WHERE b.tenant_id=p_tenant AND b.canonical_source_scope_hash=option->>'canonical_source_scope_hash' AND b.status<>'CANCELLED') THEN options:=options||jsonb_build_array(option);END IF;
  EXCEPTION WHEN others THEN NULL;
  END;
 END LOOP;
 RETURN jsonb_build_object('schema_version','INTERCOMPANY_ELIMINATION_CREATE_OPTIONS_V1','reporting_entity_id',p_reporting_entity,'reporting_period_id',p_reporting_period,'group_ref',snap.group_ref,'source_entity_id',p_source_entity,'source_period_id',p_source_period,'counterparty_entity_id',p_counterparty_entity,'counterparty_period_id',p_counterparty_period,'consolidation_snapshot_id',snap.consolidation_snapshot_id,'currency',snap.currency,'options',options,
  'action_flags',jsonb_build_object('can_create_draft',jsonb_array_length(options)>0,'can_submit',false,'can_review',false,'can_approve',false,'can_cancel',false,'can_post',false));
END;$$;

CREATE FUNCTION refs_create_intercompany_elimination(
 p_tenant uuid,p_reporting_entity uuid,p_reporting_period uuid,p_consolidation_snapshot uuid,p_source_entity uuid,p_source_period uuid,
 p_counterparty_entity uuid,p_counterparty_period uuid,p_source_account text,p_expected_source_hash text,p_reason text,p_idempotency_key text,p_request_hash text
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE actor text:=refs_current_actor();idem idempotency_receipt;s jsonb;s2 jsonb;batch_id uuid:=gen_random_uuid();result jsonb;payload jsonb;line1 jsonb;line2 jsonb;
BEGIN
 IF actor IS NULL OR length(btrim(coalesce(p_reason,''))) NOT BETWEEN 8 AND 2000 OR length(coalesce(p_idempotency_key,'')) NOT BETWEEN 8 AND 200 OR p_expected_source_hash IS NULL OR p_expected_source_hash!~'^sha256:[0-9a-f]{64}$'
  OR p_request_hash IS DISTINCT FROM refs_intercompany_elimination_create_hash(p_tenant,p_reporting_entity,p_reporting_period,p_consolidation_snapshot,p_source_entity,p_source_period,p_counterparty_entity,p_counterparty_period,p_source_account,p_expected_source_hash,p_reason) THEN RAISE EXCEPTION 'Invalid intercompany elimination create command' USING ERRCODE='22023';END IF;
 PERFORM refs_assert_scope(p_tenant,p_reporting_entity,'GROUP.INTERCOMPANY_ELIMINATION.CREATE');PERFORM refs_assert_scope(p_tenant,p_reporting_entity,'GROUP.INTERCOMPANY_ELIMINATION.VIEW');
 INSERT INTO idempotency_receipt(tenant_id,operation_scope,idempotency_key,request_hash,status,actor_id) VALUES(p_tenant,'INTERCOMPANY_ELIMINATION_CREATE:'||p_reporting_entity,p_idempotency_key,p_request_hash,'IN_PROGRESS',actor) ON CONFLICT DO NOTHING;
 SELECT * INTO idem FROM idempotency_receipt WHERE tenant_id=p_tenant AND operation_scope='INTERCOMPANY_ELIMINATION_CREATE:'||p_reporting_entity AND idempotency_key=p_idempotency_key FOR UPDATE;
 IF idem.actor_id IS DISTINCT FROM actor OR idem.request_hash IS DISTINCT FROM p_request_hash THEN RAISE EXCEPTION 'Intercompany elimination create idempotency conflict' USING ERRCODE='23505';END IF;IF idem.status='SUCCEEDED' THEN RETURN idem.response_body||jsonb_build_object('idempotent',true);END IF;
 PERFORM 1 FROM accounting_period p WHERE p.tenant_id=p_tenant AND(p.entity_id,p.period_id) IN((p_reporting_entity,p_reporting_period),(p_source_entity,p_source_period),(p_counterparty_entity,p_counterparty_period)) ORDER BY p.entity_id,p.period_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Intercompany elimination periods are unavailable' USING ERRCODE='P0002';END IF;
 IF NOT EXISTS(SELECT 1 FROM accounting_period p WHERE p.tenant_id=p_tenant AND p.entity_id=p_reporting_entity AND p.period_id=p_reporting_period AND p.ledger_code='PRIMARY' AND p.status='OPEN') THEN RAISE EXCEPTION 'Intercompany elimination Draft requires an open PRIMARY reporting period' USING ERRCODE='55000';END IF;
 LOCK TABLE mapping_snapshot,consolidation_snapshot,consolidation_member,consolidation_account_map IN SHARE MODE;
 PERFORM pg_advisory_xact_lock(hashtextextended('INTERCOMPANY_ELIMINATION_SNAPSHOT:'||p_consolidation_snapshot::text,0));
 s:=refs_intercompany_elimination_source_snapshot(p_tenant,p_reporting_entity,p_reporting_period,p_consolidation_snapshot,p_source_entity,p_source_period,p_counterparty_entity,p_counterparty_period,p_source_account);
 PERFORM pg_advisory_xact_lock(hashtextextended(s->>'canonical_source_scope_hash',0));
 s2:=refs_intercompany_elimination_source_snapshot(p_tenant,p_reporting_entity,p_reporting_period,p_consolidation_snapshot,p_source_entity,p_source_period,p_counterparty_entity,p_counterparty_period,p_source_account);
 IF s2->>'source_evidence_hash' IS DISTINCT FROM p_expected_source_hash OR s2 IS DISTINCT FROM s THEN RAISE EXCEPTION 'Intercompany elimination source evidence changed' USING ERRCODE='40001';END IF;
 INSERT INTO intercompany_elimination_batch(intercompany_elimination_batch_id,tenant_id,reporting_entity_id,reporting_period_id,reporting_period_ledger_code,reporting_period_status,reporting_period_version,period_start,period_end,consolidation_snapshot_id,consolidation_version,consolidation_snapshot_hash,consolidation_receipt_hash,consolidation_member_population_hash,consolidation_account_map_population_hash,group_ref,
  source_entity_id,source_period_id,source_period_ledger_code,source_period_status,source_period_version,source_account_code,source_classification,source_closing_balance,source_mapping_snapshot_id,source_mapping_snapshot_hash,source_journal_entry_ids,source_journal_line_ids,source_ledger_line_ids,source_document_ids,
  counterparty_entity_id,counterparty_period_id,counterparty_period_ledger_code,counterparty_period_status,counterparty_period_version,counterparty_account_code,counterparty_classification,counterparty_closing_balance,counterparty_mapping_snapshot_id,counterparty_mapping_snapshot_hash,counterparty_journal_entry_ids,counterparty_journal_line_ids,counterparty_ledger_line_ids,counterparty_source_document_ids,
  currency,matched_amount,raw_mismatch,canonical_source_scope_hash,source_evidence_hash,created_by)
 VALUES(batch_id,p_tenant,p_reporting_entity,p_reporting_period,s->>'reporting_period_ledger_code',(s->>'reporting_period_status')::period_status,(s->>'reporting_period_version')::bigint,(s->>'reporting_period_start')::date,(s->>'reporting_period_end')::date,p_consolidation_snapshot,(s->>'consolidation_version')::bigint,s->>'consolidation_snapshot_hash',s->>'consolidation_receipt_hash',s->>'consolidation_member_population_hash',s->>'consolidation_account_map_population_hash',s->>'group_ref',
  p_source_entity,p_source_period,s->>'source_period_ledger_code',(s->>'source_period_status')::period_status,(s->>'source_period_version')::bigint,s->>'source_account_code',s->>'source_classification',(s->>'source_closing_balance')::numeric,(s->>'source_mapping_snapshot_id')::uuid,s->>'source_mapping_snapshot_hash',ARRAY(SELECT value::uuid FROM jsonb_array_elements_text(s->'source_journal_entry_ids') value),ARRAY(SELECT value::uuid FROM jsonb_array_elements_text(s->'source_journal_line_ids') value),ARRAY(SELECT value::uuid FROM jsonb_array_elements_text(s->'source_ledger_line_ids') value),ARRAY(SELECT value::uuid FROM jsonb_array_elements_text(s->'source_document_ids') value),
  p_counterparty_entity,p_counterparty_period,s->>'counterparty_period_ledger_code',(s->>'counterparty_period_status')::period_status,(s->>'counterparty_period_version')::bigint,s->>'counterparty_account_code',s->>'counterparty_classification',(s->>'counterparty_closing_balance')::numeric,(s->>'counterparty_mapping_snapshot_id')::uuid,s->>'counterparty_mapping_snapshot_hash',ARRAY(SELECT value::uuid FROM jsonb_array_elements_text(s->'counterparty_journal_entry_ids') value),ARRAY(SELECT value::uuid FROM jsonb_array_elements_text(s->'counterparty_journal_line_ids') value),ARRAY(SELECT value::uuid FROM jsonb_array_elements_text(s->'counterparty_ledger_line_ids') value),ARRAY(SELECT value::uuid FROM jsonb_array_elements_text(s->'counterparty_source_document_ids') value),
  (s->>'currency')::char(3),(s->>'matched_amount')::numeric,(s->>'raw_mismatch')::numeric,s->>'canonical_source_scope_hash',s->>'source_evidence_hash',actor);
 line1:=jsonb_build_object('batch_id',batch_id,'line_no',1,'member_entity_id',p_source_entity,'member_period_id',p_source_period,'source_account_code',s->>'source_account_code','source_classification',s->>'source_classification','presentation_account_code',s->>'source_presentation_account_code','presentation_side',s->>'source_presentation_side','entry_side',CASE s->>'source_classification' WHEN 'DUE_FROM' THEN 'CREDIT' ELSE 'DEBIT' END,'amount',s->>'matched_amount','mapping_hash',s->>'source_consolidation_mapping_hash');
 line2:=jsonb_build_object('batch_id',batch_id,'line_no',2,'member_entity_id',p_counterparty_entity,'member_period_id',p_counterparty_period,'source_account_code',s->>'counterparty_account_code','source_classification',s->>'counterparty_classification','presentation_account_code',s->>'counterparty_presentation_account_code','presentation_side',s->>'counterparty_presentation_side','entry_side',CASE s->>'counterparty_classification' WHEN 'DUE_FROM' THEN 'CREDIT' ELSE 'DEBIT' END,'amount',s->>'matched_amount','mapping_hash',s->>'counterparty_consolidation_mapping_hash');
 INSERT INTO intercompany_elimination_line VALUES(batch_id,p_tenant,1,p_source_entity,p_source_period,s->>'source_account_code',s->>'source_classification',s->>'source_presentation_account_code',s->>'source_presentation_side',line1->>'entry_side',CASE WHEN line1->>'entry_side'='DEBIT' THEN(s->>'matched_amount')::numeric ELSE 0 END,CASE WHEN line1->>'entry_side'='CREDIT' THEN(s->>'matched_amount')::numeric ELSE 0 END,s->>'source_consolidation_mapping_hash',refs_jsonb_hash(line1));
 INSERT INTO intercompany_elimination_line VALUES(batch_id,p_tenant,2,p_counterparty_entity,p_counterparty_period,s->>'counterparty_account_code',s->>'counterparty_classification',s->>'counterparty_presentation_account_code',s->>'counterparty_presentation_side',line2->>'entry_side',CASE WHEN line2->>'entry_side'='DEBIT' THEN(s->>'matched_amount')::numeric ELSE 0 END,CASE WHEN line2->>'entry_side'='CREDIT' THEN(s->>'matched_amount')::numeric ELSE 0 END,s->>'counterparty_consolidation_mapping_hash',refs_jsonb_hash(line2));
 payload:=jsonb_build_object('batch_id',batch_id,'status','DRAFT','revision','0','source_evidence_hash',p_expected_source_hash,'matched_amount',s->>'matched_amount','raw_mismatch',s->>'raw_mismatch');
 INSERT INTO intercompany_elimination_history(intercompany_elimination_batch_id,tenant_id,from_status,to_status,revision,actor_id,reason,event_hash) VALUES(batch_id,p_tenant,NULL,'DRAFT',0,actor,btrim(p_reason),refs_jsonb_hash(payload));
 INSERT INTO audit_event(tenant_id,entity_id,event_type,object_type,object_id,action,actor_id,actor_type,permission_used,request_id,correlation_id,idempotency_key,after_hash,reason,metadata) VALUES(p_tenant,p_reporting_entity,'INTERCOMPANY_ELIMINATION_DRAFT_CREATED','INTERCOMPANY_ELIMINATION_BATCH',batch_id,'CREATE',actor,'USER','GROUP.INTERCOMPANY_ELIMINATION.CREATE',p_idempotency_key,p_idempotency_key,p_idempotency_key,refs_jsonb_hash(payload),btrim(p_reason),payload);
 INSERT INTO outbox_event(tenant_id,entity_id,aggregate_type,aggregate_id,event_type,payload,payload_hash) VALUES(p_tenant,p_reporting_entity,'INTERCOMPANY_ELIMINATION_BATCH',batch_id,'INTERCOMPANY_ELIMINATION_DRAFT_CREATED',payload,refs_jsonb_hash(payload));
 result:=refs_intercompany_elimination_batch_payload(p_tenant,p_reporting_entity,batch_id)||jsonb_build_object('idempotent',false);
 UPDATE idempotency_receipt SET status='SUCCEEDED',response_status=201,response_body=result,completed_at=clock_timestamp() WHERE idempotency_receipt_id=idem.idempotency_receipt_id;RETURN result;
END;$$;

CREATE FUNCTION refs_transition_intercompany_elimination(
 p_tenant uuid,p_reporting_entity uuid,p_batch uuid,p_action text,p_expected_revision bigint,p_reason text,p_idempotency_key text,p_request_hash text
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE actor text:=refs_current_actor();action text:=upper(p_action);b intercompany_elimination_batch;initial intercompany_elimination_batch;idem idempotency_receipt;next_status text;payload jsonb;result jsonb;s jsonb;
BEGIN
 IF actor IS NULL OR action IS NULL OR action NOT IN('SUBMIT','REVIEW','APPROVE') OR p_expected_revision IS NULL OR p_expected_revision<0 OR length(btrim(coalesce(p_reason,''))) NOT BETWEEN 8 AND 2000 OR length(coalesce(p_idempotency_key,'')) NOT BETWEEN 8 AND 200
  OR p_request_hash IS DISTINCT FROM refs_intercompany_elimination_transition_hash(p_tenant,p_reporting_entity,p_batch,action,p_expected_revision,p_reason) THEN RAISE EXCEPTION 'Invalid intercompany elimination transition' USING ERRCODE='22023';END IF;
 PERFORM refs_assert_scope(p_tenant,p_reporting_entity,'GROUP.INTERCOMPANY_ELIMINATION.'||action);
 INSERT INTO idempotency_receipt(tenant_id,operation_scope,idempotency_key,request_hash,status,actor_id) VALUES(p_tenant,'INTERCOMPANY_ELIMINATION_'||action||':'||p_reporting_entity,p_idempotency_key,p_request_hash,'IN_PROGRESS',actor) ON CONFLICT DO NOTHING;
 SELECT * INTO idem FROM idempotency_receipt WHERE tenant_id=p_tenant AND operation_scope='INTERCOMPANY_ELIMINATION_'||action||':'||p_reporting_entity AND idempotency_key=p_idempotency_key FOR UPDATE;
 IF idem.actor_id IS DISTINCT FROM actor OR idem.request_hash IS DISTINCT FROM p_request_hash THEN RAISE EXCEPTION 'Intercompany elimination transition idempotency conflict' USING ERRCODE='23505';END IF;IF idem.status='SUCCEEDED' THEN RETURN idem.response_body||jsonb_build_object('idempotent',true);END IF;
 SELECT * INTO initial FROM intercompany_elimination_batch WHERE tenant_id=p_tenant AND reporting_entity_id=p_reporting_entity AND intercompany_elimination_batch_id=p_batch;
 IF initial.intercompany_elimination_batch_id IS NULL THEN RAISE EXCEPTION 'Intercompany elimination batch was not found' USING ERRCODE='P0002';END IF;
 PERFORM 1 FROM accounting_period p WHERE p.tenant_id=p_tenant AND(p.entity_id,p.period_id) IN((initial.reporting_entity_id,initial.reporting_period_id),(initial.source_entity_id,initial.source_period_id),(initial.counterparty_entity_id,initial.counterparty_period_id)) ORDER BY p.entity_id,p.period_id FOR UPDATE;
 LOCK TABLE mapping_snapshot,consolidation_snapshot,consolidation_member,consolidation_account_map IN SHARE MODE;
 PERFORM pg_advisory_xact_lock(hashtextextended('INTERCOMPANY_ELIMINATION_SNAPSHOT:'||initial.consolidation_snapshot_id::text,0));
 SELECT * INTO b FROM intercompany_elimination_batch WHERE tenant_id=p_tenant AND reporting_entity_id=p_reporting_entity AND intercompany_elimination_batch_id=p_batch FOR UPDATE;
 PERFORM pg_advisory_xact_lock(hashtextextended(b.canonical_source_scope_hash,0));
 s:=refs_intercompany_elimination_source_snapshot(p_tenant,b.reporting_entity_id,b.reporting_period_id,b.consolidation_snapshot_id,b.source_entity_id,b.source_period_id,b.counterparty_entity_id,b.counterparty_period_id,b.source_account_code);
 IF s->>'source_evidence_hash' IS DISTINCT FROM b.source_evidence_hash OR s->>'canonical_source_scope_hash' IS DISTINCT FROM b.canonical_source_scope_hash THEN RAISE EXCEPTION 'Intercompany elimination source evidence changed before workflow transition' USING ERRCODE='40001';END IF;
 next_status:=CASE action WHEN 'SUBMIT' THEN 'PENDING_REVIEW' WHEN 'REVIEW' THEN 'REVIEWED' ELSE 'APPROVED' END;
 IF b.intercompany_elimination_batch_id IS NULL OR b.revision<>p_expected_revision OR(action='SUBMIT' AND b.status<>'DRAFT')OR(action='REVIEW' AND(b.status<>'PENDING_REVIEW' OR actor=b.created_by))OR(action='APPROVE' AND(b.status<>'REVIEWED' OR actor=ANY(ARRAY[b.created_by,b.reviewed_by]))) THEN RAISE EXCEPTION 'Intercompany elimination transition conflict or SoD violation' USING ERRCODE='40001';END IF;
 INSERT INTO intercompany_elimination_internal_gate VALUES(pg_backend_pid(),txid_current(),p_tenant,p_batch,next_status);
 UPDATE intercompany_elimination_batch SET status=next_status,revision=revision+1,
  submitted_by=CASE WHEN action='SUBMIT' THEN actor ELSE submitted_by END,submitted_at=CASE WHEN action='SUBMIT' THEN clock_timestamp() ELSE submitted_at END,
  reviewed_by=CASE WHEN action='REVIEW' THEN actor ELSE reviewed_by END,reviewed_at=CASE WHEN action='REVIEW' THEN clock_timestamp() ELSE reviewed_at END,
  approved_by=CASE WHEN action='APPROVE' THEN actor ELSE approved_by END,approved_at=CASE WHEN action='APPROVE' THEN clock_timestamp() ELSE approved_at END WHERE intercompany_elimination_batch_id=p_batch;
 DELETE FROM intercompany_elimination_internal_gate WHERE backend_pid=pg_backend_pid() AND transaction_id=txid_current() AND tenant_id=p_tenant AND intercompany_elimination_batch_id=p_batch AND operation=next_status;
 payload:=jsonb_build_object('batch_id',p_batch,'from_status',b.status,'status',next_status,'revision',(b.revision+1)::text,'actor_id',actor);
 INSERT INTO intercompany_elimination_history(intercompany_elimination_batch_id,tenant_id,from_status,to_status,revision,actor_id,reason,event_hash) VALUES(p_batch,p_tenant,b.status,next_status,b.revision+1,actor,btrim(p_reason),refs_jsonb_hash(payload));
 INSERT INTO audit_event(tenant_id,entity_id,event_type,object_type,object_id,action,actor_id,actor_type,permission_used,request_id,correlation_id,idempotency_key,after_hash,reason,metadata) VALUES(p_tenant,p_reporting_entity,'INTERCOMPANY_ELIMINATION_'||action,'INTERCOMPANY_ELIMINATION_BATCH',p_batch,action,actor,'USER','GROUP.INTERCOMPANY_ELIMINATION.'||action,p_idempotency_key,p_idempotency_key,p_idempotency_key,refs_jsonb_hash(payload),btrim(p_reason),payload);
 INSERT INTO outbox_event(tenant_id,entity_id,aggregate_type,aggregate_id,event_type,payload,payload_hash) VALUES(p_tenant,p_reporting_entity,'INTERCOMPANY_ELIMINATION_BATCH',p_batch,'INTERCOMPANY_ELIMINATION_'||action,payload,refs_jsonb_hash(payload));
 result:=refs_intercompany_elimination_batch_payload(p_tenant,p_reporting_entity,p_batch)||jsonb_build_object('idempotent',false);UPDATE idempotency_receipt SET status='SUCCEEDED',response_status=200,response_body=result,completed_at=clock_timestamp() WHERE idempotency_receipt_id=idem.idempotency_receipt_id;RETURN result;
END;$$;

CREATE FUNCTION refs_cancel_intercompany_elimination(
 p_tenant uuid,p_reporting_entity uuid,p_batch uuid,p_expected_revision bigint,p_reason text,p_idempotency_key text,p_request_hash text
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE actor text:=refs_current_actor();b intercompany_elimination_batch;idem idempotency_receipt;payload jsonb;result jsonb;
BEGIN
 IF actor IS NULL OR p_expected_revision IS NULL OR p_expected_revision<0 OR length(btrim(coalesce(p_reason,''))) NOT BETWEEN 8 AND 2000 OR length(coalesce(p_idempotency_key,'')) NOT BETWEEN 8 AND 200
  OR p_request_hash IS DISTINCT FROM refs_intercompany_elimination_transition_hash(p_tenant,p_reporting_entity,p_batch,'CANCEL',p_expected_revision,p_reason) THEN RAISE EXCEPTION 'Invalid intercompany elimination cancellation' USING ERRCODE='22023';END IF;
 PERFORM refs_assert_scope(p_tenant,p_reporting_entity,'GROUP.INTERCOMPANY_ELIMINATION.CANCEL');
 INSERT INTO idempotency_receipt(tenant_id,operation_scope,idempotency_key,request_hash,status,actor_id) VALUES(p_tenant,'INTERCOMPANY_ELIMINATION_CANCEL:'||p_reporting_entity,p_idempotency_key,p_request_hash,'IN_PROGRESS',actor) ON CONFLICT DO NOTHING;
 SELECT * INTO idem FROM idempotency_receipt WHERE tenant_id=p_tenant AND operation_scope='INTERCOMPANY_ELIMINATION_CANCEL:'||p_reporting_entity AND idempotency_key=p_idempotency_key FOR UPDATE;
 IF idem.actor_id IS DISTINCT FROM actor OR idem.request_hash IS DISTINCT FROM p_request_hash THEN RAISE EXCEPTION 'Intercompany elimination cancellation idempotency conflict' USING ERRCODE='23505';END IF;
 SELECT * INTO b FROM intercompany_elimination_batch WHERE tenant_id=p_tenant AND reporting_entity_id=p_reporting_entity AND intercompany_elimination_batch_id=p_batch FOR UPDATE;
 IF b.intercompany_elimination_batch_id IS NULL THEN RAISE EXCEPTION 'Intercompany elimination batch was not found' USING ERRCODE='P0002';END IF;
 PERFORM refs_assert_scope(p_tenant,b.source_entity_id,'GL.REPORT.VIEW');PERFORM refs_assert_scope(p_tenant,b.counterparty_entity_id,'GL.REPORT.VIEW');
 IF idem.status='SUCCEEDED' THEN RETURN idem.response_body||jsonb_build_object('idempotent',true);END IF;
 IF b.revision<>p_expected_revision OR b.status IN('POSTED','CANCELLED') OR actor=ANY(array_remove(ARRAY[b.created_by,b.reviewed_by,b.approved_by],NULL)) THEN RAISE EXCEPTION 'Intercompany elimination cancellation conflict or SoD violation' USING ERRCODE='40001';END IF;
 INSERT INTO intercompany_elimination_internal_gate VALUES(pg_backend_pid(),txid_current(),p_tenant,p_batch,'CANCELLED');
 UPDATE intercompany_elimination_batch SET status='CANCELLED',revision=revision+1,cancelled_by=actor,cancelled_at=clock_timestamp(),cancel_reason=btrim(p_reason) WHERE intercompany_elimination_batch_id=p_batch;
 DELETE FROM intercompany_elimination_internal_gate WHERE backend_pid=pg_backend_pid() AND transaction_id=txid_current() AND tenant_id=p_tenant AND intercompany_elimination_batch_id=p_batch AND operation='CANCELLED';
 payload:=jsonb_build_object('batch_id',p_batch,'from_status',b.status,'status','CANCELLED','revision',(b.revision+1)::text,'actor_id',actor);
 INSERT INTO intercompany_elimination_history(intercompany_elimination_batch_id,tenant_id,from_status,to_status,revision,actor_id,reason,event_hash) VALUES(p_batch,p_tenant,b.status,'CANCELLED',b.revision+1,actor,btrim(p_reason),refs_jsonb_hash(payload));
 INSERT INTO audit_event(tenant_id,entity_id,event_type,object_type,object_id,action,actor_id,actor_type,permission_used,request_id,correlation_id,idempotency_key,after_hash,reason,metadata) VALUES(p_tenant,p_reporting_entity,'INTERCOMPANY_ELIMINATION_CANCELLED','INTERCOMPANY_ELIMINATION_BATCH',p_batch,'CANCEL',actor,'USER','GROUP.INTERCOMPANY_ELIMINATION.CANCEL',p_idempotency_key,p_idempotency_key,p_idempotency_key,refs_jsonb_hash(payload),btrim(p_reason),payload);
 INSERT INTO outbox_event(tenant_id,entity_id,aggregate_type,aggregate_id,event_type,payload,payload_hash) VALUES(p_tenant,p_reporting_entity,'INTERCOMPANY_ELIMINATION_BATCH',p_batch,'INTERCOMPANY_ELIMINATION_CANCELLED',payload,refs_jsonb_hash(payload));
 result:=refs_intercompany_elimination_batch_payload(p_tenant,p_reporting_entity,p_batch)||jsonb_build_object('idempotent',false);UPDATE idempotency_receipt SET status='SUCCEEDED',response_status=200,response_body=result,completed_at=clock_timestamp() WHERE idempotency_receipt_id=idem.idempotency_receipt_id;RETURN result;
END;$$;

CREATE FUNCTION refs_post_intercompany_elimination(
 p_tenant uuid,p_reporting_entity uuid,p_batch uuid,p_expected_revision bigint,p_idempotency_key text,p_request_hash text
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE actor text:=refs_current_actor();b intercompany_elimination_batch;initial intercompany_elimination_batch;idem idempotency_receipt;s jsonb;projection_hash text;payload jsonb;result jsonb;balance record;
BEGIN
 IF actor IS NULL OR p_expected_revision IS NULL OR p_expected_revision<0 OR length(coalesce(p_idempotency_key,'')) NOT BETWEEN 8 AND 200 OR p_request_hash IS DISTINCT FROM refs_intercompany_elimination_post_hash(p_tenant,p_reporting_entity,p_batch,p_expected_revision) THEN RAISE EXCEPTION 'Invalid intercompany elimination Post command' USING ERRCODE='22023';END IF;
 PERFORM refs_assert_scope(p_tenant,p_reporting_entity,'GROUP.INTERCOMPANY_ELIMINATION.POST');
 INSERT INTO idempotency_receipt(tenant_id,operation_scope,idempotency_key,request_hash,status,actor_id) VALUES(p_tenant,'INTERCOMPANY_ELIMINATION_POST:'||p_reporting_entity,p_idempotency_key,p_request_hash,'IN_PROGRESS',actor) ON CONFLICT DO NOTHING;
 SELECT * INTO idem FROM idempotency_receipt WHERE tenant_id=p_tenant AND operation_scope='INTERCOMPANY_ELIMINATION_POST:'||p_reporting_entity AND idempotency_key=p_idempotency_key FOR UPDATE;
 IF idem.actor_id IS DISTINCT FROM actor OR idem.request_hash IS DISTINCT FROM p_request_hash THEN RAISE EXCEPTION 'Intercompany elimination Post idempotency conflict' USING ERRCODE='23505';END IF;IF idem.status='SUCCEEDED' THEN RETURN idem.response_body||jsonb_build_object('idempotent',true);END IF;
 SELECT * INTO initial FROM intercompany_elimination_batch WHERE tenant_id=p_tenant AND reporting_entity_id=p_reporting_entity AND intercompany_elimination_batch_id=p_batch;
 IF initial.intercompany_elimination_batch_id IS NULL THEN RAISE EXCEPTION 'Intercompany elimination batch was not found' USING ERRCODE='P0002';END IF;
 PERFORM 1 FROM accounting_period p WHERE p.tenant_id=p_tenant AND(p.entity_id,p.period_id) IN((initial.reporting_entity_id,initial.reporting_period_id),(initial.source_entity_id,initial.source_period_id),(initial.counterparty_entity_id,initial.counterparty_period_id)) ORDER BY p.entity_id,p.period_id FOR UPDATE;
 IF NOT EXISTS(SELECT 1 FROM accounting_period p WHERE p.tenant_id=p_tenant AND p.entity_id=initial.reporting_entity_id AND p.period_id=initial.reporting_period_id AND p.ledger_code='PRIMARY' AND p.status='OPEN') THEN RAISE EXCEPTION 'Intercompany elimination Post requires an open PRIMARY reporting period' USING ERRCODE='55000';END IF;
 LOCK TABLE mapping_snapshot,consolidation_snapshot,consolidation_member,consolidation_account_map IN SHARE MODE;
 PERFORM pg_advisory_xact_lock(hashtextextended('INTERCOMPANY_ELIMINATION_SNAPSHOT:'||initial.consolidation_snapshot_id::text,0));
 SELECT * INTO b FROM intercompany_elimination_batch WHERE tenant_id=p_tenant AND reporting_entity_id=p_reporting_entity AND intercompany_elimination_batch_id=p_batch FOR UPDATE;
 PERFORM pg_advisory_xact_lock(hashtextextended(b.canonical_source_scope_hash,0));
 IF b.revision<>p_expected_revision OR b.status<>'APPROVED' OR actor=ANY(ARRAY[b.created_by,b.reviewed_by,b.approved_by]) THEN RAISE EXCEPTION 'Intercompany elimination Post conflict or SoD violation' USING ERRCODE='40001';END IF;
 s:=refs_intercompany_elimination_source_snapshot(p_tenant,b.reporting_entity_id,b.reporting_period_id,b.consolidation_snapshot_id,b.source_entity_id,b.source_period_id,b.counterparty_entity_id,b.counterparty_period_id,b.source_account_code);
 IF s->>'source_evidence_hash' IS DISTINCT FROM b.source_evidence_hash OR s->>'canonical_source_scope_hash' IS DISTINCT FROM b.canonical_source_scope_hash OR(s->>'matched_amount')::numeric<>b.matched_amount OR(s->>'raw_mismatch')::numeric<>b.raw_mismatch THEN RAISE EXCEPTION 'Intercompany elimination source evidence changed before Post' USING ERRCODE='40001';END IF;
 SELECT count(*) line_count,sum(debit_amount)::numeric(20,4) debits,sum(credit_amount)::numeric(20,4) credits,min(debit_amount+credit_amount)::numeric(20,4) min_amount,max(debit_amount+credit_amount)::numeric(20,4) max_amount INTO balance FROM intercompany_elimination_line WHERE tenant_id=p_tenant AND intercompany_elimination_batch_id=p_batch;
 IF balance.line_count<>2 OR balance.debits<>balance.credits OR balance.debits<>b.matched_amount OR balance.min_amount<>balance.max_amount OR balance.min_amount<>b.matched_amount THEN RAISE EXCEPTION 'Intercompany elimination ledger is not a complete balanced two-line batch' USING ERRCODE='23514';END IF;
 projection_hash:=refs_jsonb_hash(jsonb_build_object('schema_version','INTERCOMPANY_ELIMINATION_POST_EVIDENCE_V1','batch_id',p_batch,'source_evidence_hash',b.source_evidence_hash,'revision',b.revision+1,'lines',(SELECT jsonb_agg(to_jsonb(l) ORDER BY l.line_no) FROM intercompany_elimination_line l WHERE l.intercompany_elimination_batch_id=p_batch)));
 INSERT INTO intercompany_elimination_internal_gate VALUES(pg_backend_pid(),txid_current(),p_tenant,p_batch,'PROJECT');
 INSERT INTO consolidation_elimination_evidence(consolidation_snapshot_id,presentation_account_code,presentation_side,elimination_ref,elimination_amount,evidence_hash,receipt_hash)
 SELECT b.consolidation_snapshot_id,l.presentation_account_code,l.presentation_side,'INTERCOMPANY_ELIMINATION_BATCH:'||p_batch::text||':LINE:'||l.line_no,b.matched_amount,l.line_evidence_hash,projection_hash FROM intercompany_elimination_line l WHERE l.tenant_id=p_tenant AND l.intercompany_elimination_batch_id=p_batch ORDER BY l.line_no;
 DELETE FROM intercompany_elimination_internal_gate WHERE backend_pid=pg_backend_pid() AND transaction_id=txid_current() AND tenant_id=p_tenant AND intercompany_elimination_batch_id=p_batch AND operation='PROJECT';
 INSERT INTO intercompany_elimination_internal_gate VALUES(pg_backend_pid(),txid_current(),p_tenant,p_batch,'POSTED');
 UPDATE intercompany_elimination_batch SET status='POSTED',revision=revision+1,posted_by=actor,posted_at=clock_timestamp(),post_evidence_hash=projection_hash WHERE intercompany_elimination_batch_id=p_batch;
 DELETE FROM intercompany_elimination_internal_gate WHERE backend_pid=pg_backend_pid() AND transaction_id=txid_current() AND tenant_id=p_tenant AND intercompany_elimination_batch_id=p_batch AND operation='POSTED';
 payload:=jsonb_build_object('batch_id',p_batch,'status','POSTED','revision',(b.revision+1)::text,'matched_amount',b.matched_amount::text,'raw_mismatch',b.raw_mismatch::text,'source_evidence_hash',b.source_evidence_hash,'post_evidence_hash',projection_hash);
 INSERT INTO intercompany_elimination_history(intercompany_elimination_batch_id,tenant_id,from_status,to_status,revision,actor_id,reason,event_hash) VALUES(p_batch,p_tenant,'APPROVED','POSTED',b.revision+1,actor,NULL,refs_jsonb_hash(payload));
 INSERT INTO audit_event(tenant_id,entity_id,event_type,object_type,object_id,action,actor_id,actor_type,permission_used,request_id,correlation_id,idempotency_key,after_hash,metadata) VALUES(p_tenant,p_reporting_entity,'INTERCOMPANY_ELIMINATION_POSTED','INTERCOMPANY_ELIMINATION_BATCH',p_batch,'POST',actor,'USER','GROUP.INTERCOMPANY_ELIMINATION.POST',p_idempotency_key,p_idempotency_key,p_idempotency_key,refs_jsonb_hash(payload),payload);
 INSERT INTO outbox_event(tenant_id,entity_id,aggregate_type,aggregate_id,event_type,payload,payload_hash) VALUES(p_tenant,p_reporting_entity,'INTERCOMPANY_ELIMINATION_BATCH',p_batch,'INTERCOMPANY_ELIMINATION_POSTED',payload,refs_jsonb_hash(payload));
 result:=refs_intercompany_elimination_batch_payload(p_tenant,p_reporting_entity,p_batch)||jsonb_build_object('idempotent',false);UPDATE idempotency_receipt SET status='SUCCEEDED',response_status=200,response_body=result,completed_at=clock_timestamp() WHERE idempotency_receipt_id=idem.idempotency_receipt_id;RETURN result;
END;$$;

CREATE FUNCTION refs_read_intercompany_elimination_register(p_tenant uuid,p_reporting_entity uuid,p_reporting_period uuid,p_limit integer DEFAULT 100)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE rows jsonb;
BEGIN
 PERFORM refs_assert_scope(p_tenant,p_reporting_entity,'GROUP.INTERCOMPANY_ELIMINATION.VIEW');IF p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 200 THEN RAISE EXCEPTION 'Invalid elimination register limit' USING ERRCODE='22023';END IF;
 SELECT coalesce(jsonb_agg(refs_read_intercompany_elimination_batch(p_tenant,p_reporting_entity,b.intercompany_elimination_batch_id) ORDER BY b.created_at DESC,b.intercompany_elimination_batch_id DESC),'[]'::jsonb) INTO rows FROM(SELECT * FROM intercompany_elimination_batch WHERE tenant_id=p_tenant AND reporting_entity_id=p_reporting_entity AND reporting_period_id=p_reporting_period ORDER BY created_at DESC,intercompany_elimination_batch_id DESC LIMIT p_limit)b;
 RETURN jsonb_build_object('schema_version','INTERCOMPANY_ELIMINATION_REGISTER_V1','reporting_entity_id',p_reporting_entity,'reporting_period_id',p_reporting_period,'rows',rows,'limit',p_limit,'action_flags',jsonb_build_object('can_create_draft',false,'can_submit',false,'can_review',false,'can_approve',false,'can_cancel',false,'can_post',false));
END;$$;

REVOKE ALL ON FUNCTION
 refs_intercompany_elimination_source_snapshot(uuid,uuid,uuid,uuid,uuid,uuid,uuid,uuid,text),
 refs_intercompany_elimination_posted_source_current(uuid,uuid),
 refs_intercompany_elimination_batch_payload(uuid,uuid,uuid),
 refs_intercompany_elimination_create_hash(uuid,uuid,uuid,uuid,uuid,uuid,uuid,uuid,text,text,text),
 refs_intercompany_elimination_transition_hash(uuid,uuid,uuid,text,bigint,text),refs_intercompany_elimination_post_hash(uuid,uuid,uuid,bigint),
 refs_read_intercompany_elimination_batch(uuid,uuid,uuid),refs_read_intercompany_elimination_create_options(uuid,uuid,uuid,text,uuid,uuid,uuid,uuid),
 refs_create_intercompany_elimination(uuid,uuid,uuid,uuid,uuid,uuid,uuid,uuid,text,text,text,text,text),
 refs_transition_intercompany_elimination(uuid,uuid,uuid,text,bigint,text,text,text),refs_cancel_intercompany_elimination(uuid,uuid,uuid,bigint,text,text,text),
 refs_post_intercompany_elimination(uuid,uuid,uuid,bigint,text,text),refs_read_intercompany_elimination_register(uuid,uuid,uuid,integer)
 FROM PUBLIC,refs_app;
GRANT EXECUTE ON FUNCTION
 refs_read_intercompany_elimination_batch(uuid,uuid,uuid),refs_read_intercompany_elimination_create_options(uuid,uuid,uuid,text,uuid,uuid,uuid,uuid),
 refs_create_intercompany_elimination(uuid,uuid,uuid,uuid,uuid,uuid,uuid,uuid,text,text,text,text,text),
 refs_transition_intercompany_elimination(uuid,uuid,uuid,text,bigint,text,text,text),refs_cancel_intercompany_elimination(uuid,uuid,uuid,bigint,text,text,text),
 refs_post_intercompany_elimination(uuid,uuid,uuid,bigint,text,text),refs_read_intercompany_elimination_register(uuid,uuid,uuid,integer)
 TO refs_app;

COMMIT;
