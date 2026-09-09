BEGIN;

INSERT INTO permission_catalog(permission_code,domain,risk_class,sod_class)
VALUES('FIXED_ASSET.DEPRECIATION.POLICY.REVIEW','FIXED_ASSET','HIGH','REVIEWER')
ON CONFLICT(permission_code) DO UPDATE SET active=true,version=permission_catalog.version+1,effective_to=NULL;
INSERT INTO runtime_human_permission_authority(permission_code,authority_class)
VALUES('FIXED_ASSET.DEPRECIATION.POLICY.REVIEW','REVIEWER') ON CONFLICT(permission_code) DO NOTHING;

CREATE TABLE fixed_asset_post_impairment_depreciation_policy (
  policy_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  entity_id uuid NOT NULL,
  fixed_asset_register_evidence_id uuid NOT NULL REFERENCES fixed_asset_register_evidence,
  impairment_assessment_evidence_id uuid NOT NULL REFERENCES fixed_asset_impairment_assessment_evidence,
  impairment_assessment_hash text NOT NULL CHECK(impairment_assessment_hash~'^sha256:[a-f0-9]{64}$'),
  impairment_journal_entry_id uuid NOT NULL,
  impairment_posting_snapshot jsonb NOT NULL,
  impairment_posting_snapshot_hash text NOT NULL CHECK(impairment_posting_snapshot_hash~'^sha256:[a-f0-9]{64}$'),
  effective_period_id uuid NOT NULL,
  effective_from date NOT NULL,
  convention text NOT NULL CHECK(convention='NEXT_PERIOD_FULL_MONTH'),
  remaining_useful_life_months integer NOT NULL CHECK(remaining_useful_life_months BETWEEN 1 AND 600),
  posted_cost_balance numeric(20,4) NOT NULL CHECK(posted_cost_balance>=0),
  prior_accumulated_depreciation numeric(20,4) NOT NULL CHECK(prior_accumulated_depreciation>=0),
  posted_accumulated_impairment numeric(20,4) NOT NULL CHECK(posted_accumulated_impairment>=0),
  revised_carrying_value numeric(20,4) NOT NULL CHECK(revised_carrying_value>=0),
  salvage_value numeric(20,4) NOT NULL CHECK(salvage_value>=0),
  revised_depreciable_basis numeric(20,4) NOT NULL CHECK(revised_depreciable_basis>0),
  regular_period_amount numeric(20,4) NOT NULL CHECK(regular_period_amount>0),
  final_period_amount numeric(20,4) NOT NULL CHECK(final_period_amount>0),
  reviewed_by text NOT NULL,
  review_reason text NOT NULL CHECK(length(btrim(review_reason)) BETWEEN 8 AND 2000),
  policy_evidence_hash text NOT NULL CHECK(policy_evidence_hash~'^sha256:[a-f0-9]{64}$'),
  reviewed_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  status text NOT NULL CHECK(status='INDEPENDENTLY_REVIEWED'),
  UNIQUE(tenant_id,entity_id,fixed_asset_register_evidence_id,impairment_assessment_evidence_id),
  UNIQUE(tenant_id,entity_id,policy_evidence_hash),
  FOREIGN KEY(tenant_id,entity_id) REFERENCES entity(tenant_id,entity_id),
  FOREIGN KEY(tenant_id,entity_id,effective_period_id) REFERENCES accounting_period(tenant_id,entity_id,period_id),
  FOREIGN KEY(tenant_id,entity_id,impairment_journal_entry_id) REFERENCES journal_entry(tenant_id,entity_id,journal_entry_id),
  CHECK(revised_carrying_value=posted_cost_balance-prior_accumulated_depreciation-posted_accumulated_impairment),
  CHECK(revised_depreciable_basis=revised_carrying_value-salvage_value),
  CHECK(final_period_amount=revised_depreciable_basis-regular_period_amount*(remaining_useful_life_months-1))
);
ALTER TABLE fixed_asset_post_impairment_depreciation_policy ENABLE ROW LEVEL SECURITY;
CREATE POLICY fixed_asset_post_impairment_depreciation_policy_scope ON fixed_asset_post_impairment_depreciation_policy
USING(tenant_id=refs_current_tenant() AND refs_entity_allowed(entity_id));
CREATE TRIGGER fixed_asset_post_impairment_depreciation_policy_immutable BEFORE UPDATE OR DELETE ON fixed_asset_post_impairment_depreciation_policy FOR EACH ROW EXECUTE FUNCTION reject_mutation();
REVOKE ALL ON fixed_asset_post_impairment_depreciation_policy FROM PUBLIC,refs_app;

CREATE FUNCTION refs_review_fixed_asset_post_impairment_policy_hash(p_tenant uuid,p_entity uuid,p_asset uuid,p_assessment uuid,p_effective_period uuid,p_remaining_months integer,p_convention text,p_reason text)
RETURNS text LANGUAGE sql IMMUTABLE SET search_path=pg_catalog,public,pg_temp AS $$
 SELECT refs_jsonb_hash(jsonb_build_object('schema_version','FIXED_ASSET_POST_IMPAIRMENT_POLICY_REVIEW_V1','tenant_id',p_tenant,'entity_id',p_entity,'fixed_asset_register_evidence_id',p_asset,'impairment_assessment_evidence_id',p_assessment,'effective_period_id',p_effective_period,'remaining_useful_life_months',p_remaining_months,'convention',btrim(p_convention),'reason',btrim(p_reason)))
$$;

CREATE FUNCTION refs_review_fixed_asset_post_impairment_policy(p_tenant uuid,p_entity uuid,p_asset uuid,p_assessment uuid,p_effective_period uuid,p_remaining_months integer,p_convention text,p_reason text,p_key text,p_hash text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE actor text:=refs_current_actor();asset fixed_asset_register_evidence;assessment fixed_asset_impairment_assessment_evidence;assessment_period accounting_period;effective accounting_period;source source_document;idem idempotency_receipt;posting record;
 cost_balance numeric(20,4):=0;prior_depreciation numeric(20,4):=0;accumulated_impairment numeric(20,4):=0;carrying numeric(20,4);basis numeric(20,4);regular numeric(20,4);final_amount numeric(20,4);posting_snapshot jsonb;posting_hash text;evidence_hash text;policy uuid:=gen_random_uuid();payload jsonb;
BEGIN
 PERFORM refs_assert_scope(p_tenant,p_entity,'FIXED_ASSET.DEPRECIATION.POLICY.REVIEW');
 IF actor IS NULL OR p_remaining_months IS NULL OR p_remaining_months NOT BETWEEN 1 AND 600 OR btrim(coalesce(p_convention,''))<>'NEXT_PERIOD_FULL_MONTH' OR length(btrim(coalesce(p_reason,''))) NOT BETWEEN 8 AND 2000
  OR p_hash IS DISTINCT FROM refs_review_fixed_asset_post_impairment_policy_hash(p_tenant,p_entity,p_asset,p_assessment,p_effective_period,p_remaining_months,p_convention,p_reason) THEN RAISE EXCEPTION 'Invalid post-impairment depreciation policy review' USING ERRCODE='22023';END IF;
 INSERT INTO idempotency_receipt(tenant_id,operation_scope,idempotency_key,request_hash,status,actor_id) VALUES(p_tenant,'FIXED_ASSET_POST_IMPAIRMENT_POLICY_REVIEW:'||p_entity,p_key,p_hash,'IN_PROGRESS',actor) ON CONFLICT(tenant_id,operation_scope,idempotency_key) DO NOTHING;
 SELECT * INTO idem FROM idempotency_receipt WHERE tenant_id=p_tenant AND operation_scope='FIXED_ASSET_POST_IMPAIRMENT_POLICY_REVIEW:'||p_entity AND idempotency_key=p_key FOR UPDATE;
 IF idem.actor_id IS DISTINCT FROM actor OR idem.request_hash IS DISTINCT FROM p_hash THEN RAISE EXCEPTION 'Post-impairment policy review idempotency conflict' USING ERRCODE='23505';END IF;
 IF idem.status='SUCCEEDED' THEN RETURN idem.response_body||jsonb_build_object('idempotent',true);END IF;
 SELECT * INTO asset FROM fixed_asset_register_evidence WHERE tenant_id=p_tenant AND entity_id=p_entity AND fixed_asset_register_evidence_id=p_asset FOR SHARE;
 IF NOT FOUND OR asset.status<>'ACTIVE' OR asset.reviewed_by=actor OR p_remaining_months>asset.useful_life_months THEN RAISE EXCEPTION 'Active independently reviewed asset and valid remaining life are required' USING ERRCODE='23514';END IF;
 SELECT * INTO assessment FROM fixed_asset_impairment_assessment_evidence WHERE tenant_id=p_tenant AND entity_id=p_entity AND fixed_asset_register_evidence_id=p_asset AND fixed_asset_impairment_assessment_evidence_id=p_assessment AND status='INDEPENDENTLY_REVIEWED' FOR SHARE;
 IF NOT FOUND OR assessment.reviewed_by=actor OR assessment.impairment_loss<=0 OR assessment.currency<>asset.currency THEN RAISE EXCEPTION 'Independent non-zero impairment assessment is required' USING ERRCODE='23514';END IF;
 SELECT * INTO source FROM source_document WHERE tenant_id=p_tenant AND entity_id=p_entity AND source_document_id=assessment.valuation_source_document_id FOR SHARE;
 IF NOT FOUND OR source.payload_hash<>assessment.valuation_source_payload_hash THEN RAISE EXCEPTION 'Impairment valuation source changed' USING ERRCODE='40001';END IF;
 SELECT * INTO assessment_period FROM accounting_period WHERE tenant_id=p_tenant AND entity_id=p_entity AND period_id=assessment.accounting_period_id AND ledger_code='PRIMARY' FOR SHARE;
 SELECT * INTO effective FROM accounting_period WHERE tenant_id=p_tenant AND entity_id=p_entity AND period_id=p_effective_period AND ledger_code='PRIMARY' FOR SHARE;
 IF assessment_period.period_id IS NULL OR effective.period_id IS NULL OR effective.starts_on<>assessment_period.ends_on+1 THEN RAISE EXCEPTION 'Revised policy must start in the immediately following primary period' USING ERRCODE='23514';END IF;
 IF EXISTS(SELECT 1 FROM fixed_asset_impairment_assessment_evidence later WHERE later.tenant_id=p_tenant AND later.entity_id=p_entity AND later.fixed_asset_register_evidence_id=p_asset AND later.assessment_date>assessment.assessment_date AND later.assessment_date<effective.starts_on) THEN RAISE EXCEPTION 'A later impairment assessment supersedes this policy basis' USING ERRCODE='23514';END IF;
 IF EXISTS(SELECT 1 FROM fixed_asset_disposal_evidence d WHERE d.tenant_id=p_tenant AND d.entity_id=p_entity AND d.fixed_asset_register_evidence_id=p_asset AND d.disposal_date<effective.starts_on)
  OR EXISTS(SELECT 1 FROM fixed_asset_disposal_posting d JOIN journal_entry j ON j.tenant_id=d.tenant_id AND j.entity_id=d.entity_id AND j.journal_entry_id=d.journal_entry_id WHERE d.tenant_id=p_tenant AND d.entity_id=p_entity AND d.fixed_asset_register_evidence_id=p_asset AND j.journal_date<effective.starts_on) THEN RAISE EXCEPTION 'Disposed asset cannot receive a revised depreciation policy' USING ERRCODE='23514';END IF;
 SELECT candidate.*,count(*) OVER() candidate_count INTO posting FROM (
  SELECT j.journal_entry_id,j.journal_date,j.posted_at,j.posted_by,array_agg(l.journal_line_id ORDER BY l.journal_line_id) journal_line_ids,array_agg(l.ledger_line_id ORDER BY l.ledger_line_id) ledger_line_ids,
   sum(CASE WHEN l.account_code=assessment.impairment_expense_account_code THEN l.debit_amount-l.credit_amount ELSE 0 END)::numeric(20,4) expense_amount,
   sum(CASE WHEN l.account_code=assessment.accumulated_impairment_account_code THEN l.credit_amount-l.debit_amount ELSE 0 END)::numeric(20,4) accumulated_amount
  FROM journal_entry j JOIN ledger_line l ON l.tenant_id=j.tenant_id AND l.entity_id=j.entity_id AND l.journal_entry_id=j.journal_entry_id
  WHERE j.tenant_id=p_tenant AND j.entity_id=p_entity AND j.status='POSTED' AND j.journal_date BETWEEN assessment.assessment_date AND assessment_period.ends_on
   AND l.dimensions->>'fixed_asset_register_evidence_id'=p_asset::text AND l.dimensions->>'fixed_asset_impairment_assessment_evidence_id'=p_assessment::text
  GROUP BY j.journal_entry_id,j.journal_date,j.posted_at,j.posted_by
  HAVING count(*)=2 AND count(*) FILTER(WHERE l.account_code=assessment.impairment_expense_account_code)=1 AND count(*) FILTER(WHERE l.account_code=assessment.accumulated_impairment_account_code)=1
   AND sum(CASE WHEN l.account_code=assessment.impairment_expense_account_code THEN l.debit_amount-l.credit_amount ELSE 0 END)=assessment.impairment_loss
   AND sum(CASE WHEN l.account_code=assessment.accumulated_impairment_account_code THEN l.credit_amount-l.debit_amount ELSE 0 END)=assessment.impairment_loss
 ) candidate ORDER BY candidate.journal_entry_id LIMIT 1;
 IF posting.journal_entry_id IS NULL OR posting.candidate_count<>1 THEN RAISE EXCEPTION 'Exactly one assessment-bound Posted impairment journal is required' USING ERRCODE='23514';END IF;
 SELECT coalesce(sum(CASE WHEN l.account_code=asset.asset_account_code THEN l.debit_amount-l.credit_amount ELSE 0 END),0),
  coalesce(sum(CASE WHEN l.account_code=asset.accumulated_depreciation_account_code THEN l.credit_amount-l.debit_amount ELSE 0 END),0),
  coalesce(sum(CASE WHEN l.account_code IN(SELECT DISTINCT e.accumulated_impairment_account_code FROM fixed_asset_impairment_assessment_evidence e WHERE e.tenant_id=p_tenant AND e.entity_id=p_entity AND e.fixed_asset_register_evidence_id=p_asset) THEN l.credit_amount-l.debit_amount ELSE 0 END),0)
 INTO cost_balance,prior_depreciation,accumulated_impairment
 FROM ledger_line l JOIN journal_entry j ON j.tenant_id=l.tenant_id AND j.entity_id=l.entity_id AND j.journal_entry_id=l.journal_entry_id AND j.status='POSTED'
 WHERE l.tenant_id=p_tenant AND l.entity_id=p_entity AND l.dimensions->>'fixed_asset_register_evidence_id'=p_asset::text AND j.journal_date<effective.starts_on;
 carrying:=cost_balance-prior_depreciation-accumulated_impairment;
 IF cost_balance<>asset.cost_basis OR carrying<>assessment.recoverable_amount OR carrying<=asset.salvage_value THEN RAISE EXCEPTION 'Posted post-impairment carrying value does not reconcile to retained evidence' USING ERRCODE='23514';END IF;
 basis:=carrying-asset.salvage_value;regular:=round(basis/p_remaining_months,4);final_amount:=basis-regular*(p_remaining_months-1);
 IF regular<=0 OR final_amount<=0 THEN RAISE EXCEPTION 'Remaining basis cannot be distributed with four-decimal positive charges' USING ERRCODE='23514';END IF;
 posting_snapshot:=jsonb_build_object('schema_version','FIXED_ASSET_IMPAIRMENT_POSTING_SNAPSHOT_V1','tenant_id',p_tenant,'entity_id',p_entity,'fixed_asset_register_evidence_id',p_asset,'impairment_assessment_evidence_id',p_assessment,'impairment_assessment_hash',assessment.impairment_assessment_hash,'journal_entry_id',posting.journal_entry_id,'journal_date',posting.journal_date,'posted_at',posting.posted_at,'posted_by',posting.posted_by,'journal_line_ids',posting.journal_line_ids,'ledger_line_ids',posting.ledger_line_ids,'expense_amount',to_char(posting.expense_amount,'FM999999999999990.0000'),'accumulated_amount',to_char(posting.accumulated_amount,'FM999999999999990.0000'));
 posting_hash:=refs_jsonb_hash(posting_snapshot);
 evidence_hash:=refs_jsonb_hash(jsonb_build_object('schema_version','FIXED_ASSET_POST_IMPAIRMENT_DEPRECIATION_POLICY_V1','tenant_id',p_tenant,'entity_id',p_entity,'policy_id',policy,'fixed_asset_register_evidence_id',p_asset,'impairment_assessment_evidence_id',p_assessment,'impairment_assessment_hash',assessment.impairment_assessment_hash,'impairment_posting_snapshot_hash',posting_hash,'effective_period_id',p_effective_period,'effective_from',effective.starts_on,'convention','NEXT_PERIOD_FULL_MONTH','remaining_useful_life_months',p_remaining_months,'posted_cost_balance',to_char(cost_balance,'FM999999999999990.0000'),'prior_accumulated_depreciation',to_char(prior_depreciation,'FM999999999999990.0000'),'posted_accumulated_impairment',to_char(accumulated_impairment,'FM999999999999990.0000'),'revised_carrying_value',to_char(carrying,'FM999999999999990.0000'),'salvage_value',to_char(asset.salvage_value,'FM999999999999990.0000'),'revised_depreciable_basis',to_char(basis,'FM999999999999990.0000'),'regular_period_amount',to_char(regular,'FM999999999999990.0000'),'final_period_amount',to_char(final_amount,'FM999999999999990.0000'),'reviewed_by',actor,'review_reason',btrim(p_reason),'status','INDEPENDENTLY_REVIEWED'));
 INSERT INTO fixed_asset_post_impairment_depreciation_policy(policy_id,tenant_id,entity_id,fixed_asset_register_evidence_id,impairment_assessment_evidence_id,impairment_assessment_hash,impairment_journal_entry_id,impairment_posting_snapshot,impairment_posting_snapshot_hash,effective_period_id,effective_from,convention,remaining_useful_life_months,posted_cost_balance,prior_accumulated_depreciation,posted_accumulated_impairment,revised_carrying_value,salvage_value,revised_depreciable_basis,regular_period_amount,final_period_amount,reviewed_by,review_reason,policy_evidence_hash,status)
 VALUES(policy,p_tenant,p_entity,p_asset,p_assessment,assessment.impairment_assessment_hash,posting.journal_entry_id,posting_snapshot,posting_hash,p_effective_period,effective.starts_on,'NEXT_PERIOD_FULL_MONTH',p_remaining_months,cost_balance,prior_depreciation,accumulated_impairment,carrying,asset.salvage_value,basis,regular,final_amount,actor,btrim(p_reason),evidence_hash,'INDEPENDENTLY_REVIEWED');
 payload:=jsonb_build_object('schema_version','FIXED_ASSET_POST_IMPAIRMENT_DEPRECIATION_POLICY_V1','policy_id',policy,'fixed_asset_register_evidence_id',p_asset,'impairment_assessment_evidence_id',p_assessment,'impairment_assessment_hash',assessment.impairment_assessment_hash,'impairment_journal_entry_id',posting.journal_entry_id,'impairment_posting_snapshot_hash',posting_hash,'effective_period_id',p_effective_period,'effective_from',effective.starts_on,'convention','NEXT_PERIOD_FULL_MONTH','remaining_useful_life_months',p_remaining_months,'posted_cost_balance',to_char(cost_balance,'FM999999999999990.0000'),'prior_accumulated_depreciation',to_char(prior_depreciation,'FM999999999999990.0000'),'posted_accumulated_impairment',to_char(accumulated_impairment,'FM999999999999990.0000'),'revised_carrying_value',to_char(carrying,'FM999999999999990.0000'),'salvage_value',to_char(asset.salvage_value,'FM999999999999990.0000'),'revised_depreciable_basis',to_char(basis,'FM999999999999990.0000'),'regular_period_amount',to_char(regular,'FM999999999999990.0000'),'final_period_amount',to_char(final_amount,'FM999999999999990.0000'),'policy_evidence_hash',evidence_hash,'status','INDEPENDENTLY_REVIEWED','can_create_draft',false,'can_review',false,'can_approve',false,'can_post',false,'idempotent',false);
 INSERT INTO audit_event(tenant_id,entity_id,event_type,object_type,object_id,action,actor_id,actor_type,permission_used,request_id,correlation_id,idempotency_key,after_hash,reason,metadata) VALUES(p_tenant,p_entity,'FIXED_ASSET_POST_IMPAIRMENT_DEPRECIATION_POLICY_REVIEWED','FIXED_ASSET_POST_IMPAIRMENT_DEPRECIATION_POLICY',policy,'REVIEW',actor,'USER','FIXED_ASSET.DEPRECIATION.POLICY.REVIEW',p_key,p_key,p_key,evidence_hash,btrim(p_reason),payload);
 INSERT INTO outbox_event(tenant_id,entity_id,aggregate_type,aggregate_id,event_type,payload,payload_hash) VALUES(p_tenant,p_entity,'FIXED_ASSET_POST_IMPAIRMENT_DEPRECIATION_POLICY',policy,'FIXED_ASSET_POST_IMPAIRMENT_DEPRECIATION_POLICY_REVIEWED',payload,refs_jsonb_hash(payload));
 UPDATE idempotency_receipt SET status='SUCCEEDED',response_status=201,response_body=payload,completed_at=clock_timestamp() WHERE idempotency_receipt_id=idem.idempotency_receipt_id;
 RETURN payload;
END;$$;

REVOKE ALL ON FUNCTION refs_review_fixed_asset_post_impairment_policy_hash(uuid,uuid,uuid,uuid,uuid,integer,text,text),refs_review_fixed_asset_post_impairment_policy(uuid,uuid,uuid,uuid,uuid,integer,text,text,text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION refs_review_fixed_asset_post_impairment_policy_hash(uuid,uuid,uuid,uuid,uuid,integer,text,text),refs_review_fixed_asset_post_impairment_policy(uuid,uuid,uuid,uuid,uuid,integer,text,text,text,text) TO refs_app;

COMMIT;
