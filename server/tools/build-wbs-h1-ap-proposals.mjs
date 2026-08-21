#!/usr/bin/env node
import pg from 'pg';

const url=process.env.MIGRATION_DATABASE_URL;
if(!url)throw new Error('MIGRATION_DATABASE_URL is required');
const company=(process.argv[2]||'WBPA').trim().toUpperCase();
if(company!=='ALL'&&!/^[A-Z0-9_-]{2,32}$/.test(company))throw new Error('Company code is invalid');
const pool=new pg.Pool({connectionString:url,max:2,application_name:'refs-wbs-h1-ap-proposals'});

try{
  await pool.query(`CREATE TABLE IF NOT EXISTS wbs_h1_import.ap_proposal(
    company_code text NOT NULL,wbs_uuid text NOT NULL,source_record_hash text NOT NULL,source_date date,
    source_amount numeric(20,4),currency char(3) NOT NULL DEFAULT 'USD',vendor_ref text,project_ref text,cost_code_ref text,
    business_status text,pay_status text,review_status text,proposal_status text NOT NULL,exception_codes text[] NOT NULL,
    wbs_setting_key text,wbs_setting_id text,wbs_setting_hash text,mapped_account_code text,mapped_account_name text,
    proposed_lines jsonb NOT NULL,report_impact jsonb NOT NULL,action_flags jsonb NOT NULL,
    proposal_hash text NOT NULL,generated_at timestamptz NOT NULL DEFAULT now(),PRIMARY KEY(company_code,wbs_uuid))`);

  const result=await pool.query(`WITH source AS(
    SELECT a.*,left(COALESCE(NULLIF(a.posting_date,''),NULLIF(a.invoice_date,''),NULLIF(a.incurred_date,'')),10) date_text
    FROM wbs_h1_import.ap_business a WHERE ($1='ALL' OR a.company_code=$1)
  ), normalized AS(
    SELECT s.*,
      CASE WHEN date_text ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' AND to_char(to_date(date_text,'YYYY-MM-DD'),'YYYY-MM-DD')=date_text THEN date_text::date END source_date,
      CASE WHEN amount ~ '^-?[0-9]+(\\.[0-9]+)?$' THEN amount::numeric(20,4) END source_amount
    FROM source s
  ), scoped AS(
    SELECT * FROM normalized WHERE source_date BETWEEN '2026-01-01' AND '2026-06-30'
  ), candidates AS(
    SELECT a.company_code,a.wbs_uuid,count(s.*)::int candidate_count,
      min(s.stable_key) setting_key,min(s.payload->>'id') setting_id,min(s.payload->>'journal_code') account_code,
      min(s.payload->>'account') account_name,min(refs_jsonb_hash(s.payload)) setting_hash
    FROM scoped a LEFT JOIN wbs_h1_import.reference_row s ON s.domain='accounting_setting' AND s.company_code=a.company_code
      AND s.payload->>'business_type'='4' AND s.payload->>'category'='Payable' AND s.payload->>'type'='Debit'
      AND s.payload->>'detail'=a.cost_code
      AND (COALESCE(s.payload->>'pj_code','')='' OR a.project_code=ANY(regexp_split_to_array(s.payload->>'pj_code','\\s*,\\s*')))
      AND a.source_date BETWEEN (s.payload->>'start_date')::date AND (s.payload->>'end_date')::date
    GROUP BY a.company_code,a.wbs_uuid
  ), classified AS(
    SELECT a.*,c.candidate_count,c.setting_key,c.setting_id,c.account_code,c.account_name,c.setting_hash,
      ARRAY_REMOVE(ARRAY[
        CASE WHEN a.source_date IS NULL THEN 'SOURCE_DATE_INVALID' END,
        CASE WHEN a.source_amount IS NULL OR a.source_amount=0 THEN 'SOURCE_AMOUNT_INVALID' END,
        CASE WHEN COALESCE(btrim(a.vendor_no),'')='' THEN 'VENDOR_IDENTITY_MISSING' END,
        CASE WHEN COALESCE(btrim(a.project_code),'')='' THEN 'PROJECT_IDENTITY_MISSING' END,
        CASE WHEN COALESCE(btrim(a.cost_code),'')='' THEN 'COST_CODE_MISSING' END,
        CASE WHEN c.candidate_count=0 THEN 'WBS_PAYABLE_MAPPING_MISSING' END,
        CASE WHEN c.candidate_count>1 THEN 'WBS_PAYABLE_MAPPING_AMBIGUOUS' END,
        CASE WHEN c.candidate_count=1 AND (COALESCE(btrim(c.account_code),'')='' OR c.account_code!~'^[A-Za-z0-9][A-Za-z0-9._-]{1,31}$') THEN 'WBS_ACCOUNT_INVALID' END
      ],NULL)::text[] exceptions
    FROM scoped a JOIN candidates c USING(company_code,wbs_uuid)
  ), shaped AS(
    SELECT x.*,
      refs_jsonb_hash(jsonb_build_object('company_code',company_code,'wbs_uuid',wbs_uuid,'business_id',business_id,'long_id',long_id,
        'accounting_date',source_date,'amount',source_amount,'vendor_ref',vendor_no,'project_ref',project_code,'cost_code_ref',cost_code,
        'business_status',business_status,'pay_status',pay_status,'review_status',review_status)) source_hash,
      CASE WHEN cardinality(exceptions)=0 THEN
        CASE WHEN source_amount>0 THEN jsonb_build_array(
          jsonb_build_object('line_number',1,'side','DEBIT','account_code',account_code,'amount',to_char(source_amount,'FM999999999999990.0000'),'member_ref',NULL,'project_ref',project_code,'cost_code_ref',cost_code),
          jsonb_build_object('line_number',2,'side','CREDIT','account_code','291001','amount',to_char(source_amount,'FM999999999999990.0000'),'member_ref',vendor_no,'project_ref',NULL,'cost_code_ref',NULL))
        ELSE jsonb_build_array(
          jsonb_build_object('line_number',1,'side','DEBIT','account_code','291001','amount',to_char(abs(source_amount),'FM999999999999990.0000'),'member_ref',vendor_no,'project_ref',NULL,'cost_code_ref',NULL),
          jsonb_build_object('line_number',2,'side','CREDIT','account_code',account_code,'amount',to_char(abs(source_amount),'FM999999999999990.0000'),'member_ref',NULL,'project_ref',project_code,'cost_code_ref',cost_code)) END
      ELSE '[]'::jsonb END lines
    FROM classified x
  ), final AS(
    SELECT *,CASE WHEN cardinality(exceptions)=0 THEN 'READY_FOR_HUMAN_REVIEW' ELSE 'EXCEPTION' END status,
      CASE WHEN cardinality(exceptions)=0 THEN jsonb_build_object('trial_balance',true,
        'income_statement',left(account_code,1) IN('4','5','6','7','8','9'),'balance_sheet',left(account_code,1) IN('1','2','3'),
        'cash_flow','CLASSIFICATION_REQUIRED') ELSE '{}'::jsonb END impact
    FROM shaped
  )
  INSERT INTO wbs_h1_import.ap_proposal(company_code,wbs_uuid,source_record_hash,source_date,source_amount,currency,vendor_ref,
    project_ref,cost_code_ref,business_status,pay_status,review_status,proposal_status,exception_codes,wbs_setting_key,wbs_setting_id,
    wbs_setting_hash,mapped_account_code,mapped_account_name,proposed_lines,report_impact,action_flags,proposal_hash)
  SELECT company_code,wbs_uuid,source_hash,source_date,source_amount,'USD',vendor_no,project_code,cost_code,business_status,pay_status,
    review_status,status,exceptions,setting_key,setting_id,setting_hash,account_code,account_name,lines,impact,
    '{"can_create_draft":false,"can_review":false,"can_approve":false,"can_post":false}'::jsonb,
    refs_jsonb_hash(jsonb_build_object('source_record_hash',source_hash,'status',status,'exceptions',exceptions,'setting_hash',setting_hash,
      'lines',lines,'report_impact',impact,'action_flags','{"can_create_draft":false,"can_review":false,"can_approve":false,"can_post":false}'::jsonb))
  FROM final
  ON CONFLICT(company_code,wbs_uuid) DO UPDATE SET source_record_hash=EXCLUDED.source_record_hash,source_date=EXCLUDED.source_date,
    source_amount=EXCLUDED.source_amount,vendor_ref=EXCLUDED.vendor_ref,project_ref=EXCLUDED.project_ref,cost_code_ref=EXCLUDED.cost_code_ref,
    business_status=EXCLUDED.business_status,pay_status=EXCLUDED.pay_status,review_status=EXCLUDED.review_status,
    proposal_status=EXCLUDED.proposal_status,exception_codes=EXCLUDED.exception_codes,wbs_setting_key=EXCLUDED.wbs_setting_key,
    wbs_setting_id=EXCLUDED.wbs_setting_id,wbs_setting_hash=EXCLUDED.wbs_setting_hash,mapped_account_code=EXCLUDED.mapped_account_code,
    mapped_account_name=EXCLUDED.mapped_account_name,proposed_lines=EXCLUDED.proposed_lines,report_impact=EXCLUDED.report_impact,
    action_flags=EXCLUDED.action_flags,proposal_hash=EXCLUDED.proposal_hash,generated_at=now()
  RETURNING proposal_status,source_amount,proposed_lines,exception_codes`,[company]);

  let ready=0,exceptions=0,readyAmount=0,balanced=0;
  const reasons=new Map();
  for(const row of result.rows){
    if(row.proposal_status==='READY_FOR_HUMAN_REVIEW'){
      ready++;readyAmount+=Math.abs(Number(row.source_amount));
      const debit=row.proposed_lines.filter(line=>line.side==='DEBIT').reduce((n,line)=>n+Number(line.amount),0);
      const credit=row.proposed_lines.filter(line=>line.side==='CREDIT').reduce((n,line)=>n+Number(line.amount),0);
      if(Math.abs(debit-credit)<0.0001)balanced++;
    }else{
      exceptions++;
      for(const reason of row.exception_codes)reasons.set(reason,(reasons.get(reason)||0)+1);
    }
  }
  if(ready!==balanced)throw new Error(`Balanced proposal control failed: ${balanced}/${ready}`);
  const persisted=(await pool.query(`SELECT count(*)::int population,count(*) FILTER(WHERE proposal_status='READY_FOR_HUMAN_REVIEW')::int ready,
    count(*) FILTER(WHERE proposal_status='EXCEPTION')::int exceptions,
    count(*) FILTER(WHERE proposed_lines<>'[]'::jsonb AND action_flags<>'{"can_create_draft":false,"can_review":false,"can_approve":false,"can_post":false}'::jsonb)::int unsafe
    FROM wbs_h1_import.ap_proposal WHERE ($1='ALL' OR company_code=$1)`,[company])).rows[0];
  if(persisted.population!==result.rowCount||persisted.ready!==ready||persisted.exceptions!==exceptions||persisted.unsafe!==0)throw new Error('Persisted proposal controls do not reconcile');
  console.log(JSON.stringify({status:'COMPLETE',company_scope:company,population:result.rowCount,ready_for_human_review:ready,
    exception_count:exceptions,balanced_ready_count:balanced,ready_absolute_amount:readyAmount.toFixed(4),
    exception_reasons:Object.fromEntries([...reasons].sort((a,b)=>b[1]-a[1])),action_authority:'NONE'},null,2));
}finally{await pool.end();}
