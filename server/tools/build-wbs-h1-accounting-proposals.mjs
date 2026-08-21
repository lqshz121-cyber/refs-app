#!/usr/bin/env node
import pg from 'pg';

const url=process.env.MIGRATION_DATABASE_URL;
if(!url)throw new Error('MIGRATION_DATABASE_URL is required');
const company=(process.argv[2]||'ALL').trim().toUpperCase();
if(company!=='ALL'&&!/^[A-Z0-9_-]{2,32}$/.test(company))throw new Error('Company code is invalid');
const pool=new pg.Pool({connectionString:url,max:2,application_name:'refs-wbs-h1-accounting-proposals'});

try{
  await pool.query(`CREATE TABLE IF NOT EXISTS wbs_h1_import.accounting_proposal(
    company_code text NOT NULL,event_key text NOT NULL,source_type text,accounting_date date,currency char(3) NOT NULL DEFAULT 'USD',
    source_record_hash text NOT NULL,proposal_status text NOT NULL,exception_codes text[] NOT NULL,line_count integer NOT NULL,
    debit_total numeric(20,4) NOT NULL,credit_total numeric(20,4) NOT NULL,proposed_lines jsonb NOT NULL,
    action_flags jsonb NOT NULL,proposal_hash text NOT NULL,generated_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY(company_code,event_key))`);

  const result=await pool.query(`WITH source AS(
    SELECT l.*,
      CASE WHEN left(l.set_date,10)~'^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
        AND to_char(to_date(left(l.set_date,10),'YYYY-MM-DD'),'YYYY-MM-DD')=left(l.set_date,10)
        THEN left(l.set_date,10)::date END accounting_date,
      CASE WHEN l.amount~'^-?[0-9]+(\\.[0-9]+)?$' THEN l.amount::numeric(20,4) END numeric_amount,
      CASE WHEN l.detail_type ILIKE '%Debit%' THEN 'DEBIT' WHEN l.detail_type ILIKE '%Credit%' THEN 'CREDIT' END declared_side
    FROM wbs_h1_import.accounting_line l
    WHERE nullif(l.cb_id,'') IS NOT NULL AND ($1='ALL' OR l.company_code=$1)
  ), normalized AS(
    SELECT *,CASE
      WHEN declared_side='DEBIT' AND numeric_amount>=0 THEN 'DEBIT'
      WHEN declared_side='DEBIT' AND numeric_amount<0 THEN 'CREDIT'
      WHEN declared_side='CREDIT' AND numeric_amount>=0 THEN 'CREDIT'
      WHEN declared_side='CREDIT' AND numeric_amount<0 THEN 'DEBIT' END side,
      abs(numeric_amount) line_amount
    FROM source
  ), event AS(
    SELECT company_code,cb_id event_key,min(source) source_type,min(accounting_date) accounting_date,
      count(*)::int line_count,count(*) FILTER(WHERE declared_side IS NULL)::int unsupported_lines,
      count(*) FILTER(WHERE accounting_date IS NULL)::int invalid_dates,
      count(DISTINCT accounting_date) FILTER(WHERE accounting_date IS NOT NULL)::int date_count,
      count(*) FILTER(WHERE numeric_amount IS NULL OR numeric_amount=0)::int invalid_amounts,
      count(*) FILTER(WHERE coalesce(btrim(account),'')!~'^[A-Za-z0-9][A-Za-z0-9._-]{1,31}$')::int invalid_accounts,
      coalesce(sum(line_amount) FILTER(WHERE side='DEBIT'),0)::numeric(20,4) debit_total,
      coalesce(sum(line_amount) FILTER(WHERE side='CREDIT'),0)::numeric(20,4) credit_total,
      refs_jsonb_hash(jsonb_agg(jsonb_build_object('wbs_id',wbs_id,'business_guid',business_guid,'sys_id',sys_id,
        'accounting_date',accounting_date,'source',source,'detail_type',detail_type,'account',account,'amount',numeric_amount,
        'project_code',project_code,'cost_code',cost_code,'accounting_type',accounting_type,'accounting_code',accounting_code,
        'payee_no',payee_no,'bill_no',bill_no) ORDER BY wbs_id)) source_hash,
      jsonb_agg(jsonb_build_object('line_number',row_number,'side',side,'account_code',account,
        'amount',to_char(line_amount,'FM999999999999990.0000'),'description',coalesce(nullif(description,''),'WBS accounting line'),
        'member_ref',CASE WHEN accounting_type ILIKE '%Vendor%' THEN nullif(accounting_code,'') END,
        'project_ref',nullif(project_code,''),'cost_code_ref',nullif(cost_code,''),'source_line_id',wbs_id)
        ORDER BY row_number) FILTER(WHERE declared_side IS NOT NULL AND numeric_amount IS NOT NULL AND numeric_amount<>0
          AND coalesce(btrim(account),'')~'^[A-Za-z0-9][A-Za-z0-9._-]{1,31}$') lines
    FROM (SELECT n.*,row_number() OVER(PARTITION BY company_code,cb_id ORDER BY
      CASE WHEN sort_no~'^[0-9]+$' THEN sort_no::int ELSE 2147483647 END,wbs_id)::int row_number FROM normalized n) ranked
    GROUP BY company_code,cb_id
  ), classified AS(
    SELECT *,ARRAY_REMOVE(ARRAY[
      CASE WHEN unsupported_lines>0 THEN 'WBS_RULE_EVALUATION_REQUIRED' END,
      CASE WHEN invalid_dates>0 OR date_count<>1 THEN 'ACCOUNTING_DATE_INVALID_OR_MIXED' END,
      CASE WHEN invalid_amounts>0 THEN 'AMOUNT_INVALID' END,
      CASE WHEN invalid_accounts>0 THEN 'ACCOUNT_INVALID' END,
      CASE WHEN debit_total=0 OR credit_total=0 THEN 'DEBIT_OR_CREDIT_MISSING' END,
      CASE WHEN abs(debit_total-credit_total)>=0.005 THEN 'JOURNAL_OUT_OF_BALANCE' END
    ],NULL)::text[] exceptions FROM event
  ), final AS(
    SELECT *,CASE WHEN cardinality(exceptions)=0 THEN 'READY_FOR_HUMAN_REVIEW' ELSE 'EXCEPTION' END status,
      CASE WHEN cardinality(exceptions)=0 THEN coalesce(lines,'[]'::jsonb) ELSE '[]'::jsonb END safe_lines
    FROM classified
  )
  INSERT INTO wbs_h1_import.accounting_proposal(company_code,event_key,source_type,accounting_date,currency,source_record_hash,
    proposal_status,exception_codes,line_count,debit_total,credit_total,proposed_lines,action_flags,proposal_hash)
  SELECT company_code,event_key,source_type,accounting_date,'USD',source_hash,status,exceptions,line_count,debit_total,credit_total,safe_lines,
    '{"can_create_draft":false,"can_review":false,"can_approve":false,"can_post":false}'::jsonb,
    refs_jsonb_hash(jsonb_build_object('source_record_hash',source_hash,'status',status,'exceptions',exceptions,'lines',safe_lines,
      'action_flags','{"can_create_draft":false,"can_review":false,"can_approve":false,"can_post":false}'::jsonb))
  FROM final
  ON CONFLICT(company_code,event_key) DO UPDATE SET source_type=EXCLUDED.source_type,accounting_date=EXCLUDED.accounting_date,
    source_record_hash=EXCLUDED.source_record_hash,proposal_status=EXCLUDED.proposal_status,exception_codes=EXCLUDED.exception_codes,
    line_count=EXCLUDED.line_count,debit_total=EXCLUDED.debit_total,credit_total=EXCLUDED.credit_total,
    proposed_lines=EXCLUDED.proposed_lines,action_flags=EXCLUDED.action_flags,proposal_hash=EXCLUDED.proposal_hash,generated_at=now()
  RETURNING proposal_status`,[company]);

  const summary=(await pool.query(`SELECT count(*)::int population,
    count(*) FILTER(WHERE proposal_status='READY_FOR_HUMAN_REVIEW')::int ready,
    count(*) FILTER(WHERE proposal_status='EXCEPTION')::int exceptions,
    count(*) FILTER(WHERE proposal_status='READY_FOR_HUMAN_REVIEW' AND abs(debit_total-credit_total)<0.005)::int balanced,
    count(*) FILTER(WHERE action_flags<>'{"can_create_draft":false,"can_review":false,"can_approve":false,"can_post":false}'::jsonb)::int unsafe,
    coalesce(sum(debit_total) FILTER(WHERE proposal_status='READY_FOR_HUMAN_REVIEW'),0)::text ready_debit
    FROM wbs_h1_import.accounting_proposal WHERE ($1='ALL' OR company_code=$1)`,[company])).rows[0];
  if(summary.population!==result.rowCount||summary.ready!==summary.balanced||summary.unsafe!==0)throw new Error('Accounting proposal controls do not reconcile');
  const reasons=(await pool.query(`SELECT reason,count(*)::int count FROM wbs_h1_import.accounting_proposal,
    unnest(exception_codes) reason WHERE ($1='ALL' OR company_code=$1) GROUP BY reason ORDER BY count DESC,reason`,[company])).rows;
  console.log(JSON.stringify({status:'COMPLETE',company_scope:company,...summary,
    exception_reasons:Object.fromEntries(reasons.map(row=>[row.reason,row.count])),action_authority:'NONE'},null,2));
}finally{await pool.end();}
