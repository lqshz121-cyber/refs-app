#!/usr/bin/env node
import {pathToFileURL} from 'node:url';
import {createPool} from '../runtime/db.mjs';
import {PostgresAccountingKernel} from '../runtime/kernel-repository.mjs';
import {PostgresContextIssuer} from '../runtime/context-issuer.mjs';

const COMPANY=/^[A-Z0-9_-]{2,32}$/;
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const H1_PERIODS=Object.freeze(['2026-01','2026-02','2026-03','2026-04','2026-05','2026-06']);

function money4(value){
  const match=String(value??'0').match(/^(-?)(\d+)(?:\.(\d{1,4}))?$/);
  if(!match)throw new Error('Authoritative report returned an invalid MONEY4 value');
  return BigInt(`${match[1]}${match[2]}${(match[3]||'').padEnd(4,'0')}`);
}

function formatMoney4(value){
  const sign=value<0n?'-':'',absolute=value<0n?-value:value;
  return `${sign}${absolute/10000n}.${String(absolute%10000n).padStart(4,'0')}`;
}

export function summarizeCompanyPeriod({periodCode,documents,journals,ledger,statements}){
  const trialBalance=statements.filter(row=>row.statement_type==='TRIAL_BALANCE');
  const debit=trialBalance.reduce((total,row)=>total+money4(row.ending_debit),0n);
  const credit=trialBalance.reduce((total,row)=>total+money4(row.ending_credit),0n);
  const statementTypes=[...new Set(statements.map(row=>row.statement_type))].sort();
  return Object.freeze({
    period_code:periodCode,
    ap_bill_count:Number(documents.scope.total_count),
    journal_count:Number(journals.scope.total_count),
    posted_ledger_line_count:ledger.length===0?0:Number(ledger[0].total_count),
    report_row_count:statements.length,
    report_types:statementTypes,
    trial_balance_balanced:debit===credit,
    trial_balance_difference:formatMoney4(debit-credit)
  });
}

export async function verifyWbsH1CompanyAccounting({adminPool,runtimePool,issuerPool,tenantId,companyCode,actorId='wbs-h1-reader'}){
  if(!UUID.test(tenantId||'')||!COMPANY.test(companyCode||''))throw new Error('Exact tenant and company scope are required');
  const entities=(await adminPool.query(`SELECT entity_id,entity_code,name FROM entity
    WHERE tenant_id=$1 AND (entity_code=$2 OR source_entity_id=$2) AND source_system='WBS' ORDER BY entity_id`,[tenantId,companyCode])).rows;
  if(entities.length!==1)throw new Error(`Expected exactly one WBS entity for ${companyCode}; found ${entities.length}`);
  const entity=entities[0];
  const periods=(await adminPool.query(`SELECT period_id,period_code,status::text FROM accounting_period
    WHERE tenant_id=$1 AND entity_id=$2 AND period_code=ANY($3::text[]) ORDER BY period_code`,[tenantId,entity.entity_id,H1_PERIODS])).rows;
  if(periods.length!==H1_PERIODS.length||periods.some((row,index)=>row.period_code!==H1_PERIODS[index]))throw new Error(`Complete 2026 H1 periods are unavailable for ${companyCode}`);
  for(const permission of ['AP.VIEW','GL.JE.VIEW','GL.REPORT.VIEW'])await adminPool.query(`INSERT INTO runtime_actor_grant(tenant_id,actor_id,entity_id,permission)
    VALUES($1,$2,$3,$4) ON CONFLICT DO NOTHING`,[tenantId,actorId,entity.entity_id,permission]);
  const issuer=new PostgresContextIssuer(issuerPool,{principalProvider:async()=>({trusted:true,tenantId,actorId})});
  const reader=new PostgresAccountingKernel(runtimePool,{sessionProvider:()=>issuer.issue({tenantId})});
  const results=[];
  for(const period of periods){
    const [documents,journals,ledger,statements]=await Promise.all([
      reader.listBusinessDocuments({tenantId,entityId:entity.entity_id,documentKind:'AP_BILL',periodId:period.period_id,limit:1,offset:0}),
      reader.listJournalEntries({tenantId,entityId:entity.entity_id,periodId:period.period_id,limit:1,offset:0}),
      reader.listGeneralLedger({tenantId,entityId:entity.entity_id,periodId:period.period_id,accountCode:null,query:null,limit:1,offset:0}),
      reader.getFinancialStatements({tenantId,entityId:entity.entity_id,periodId:period.period_id})
    ]);
    results.push({...summarizeCompanyPeriod({periodCode:period.period_code,documents,journals,ledger,statements}),period_status:period.status});
  }
  return Object.freeze({status:'WBS_H1_COMPANY_ACCOUNTING_VERIFIED',company_code:companyCode,entity_ready:true,period_count:periods.length,periods:results});
}

async function main(){
  const companyCode=(process.env.REFS_WBS_H1_VERIFY_COMPANY||process.argv[2]||'').trim().toUpperCase();
  const tenantId=process.env.REFS_WBS_TEST_IMPORT_TENANT_ID;
  if(!process.env.MIGRATION_DATABASE_URL||!process.env.DATABASE_URL||!process.env.CONTEXT_ISSUER_DATABASE_URL)throw new Error('Database and context issuer URLs are required');
  const adminPool=await createPool({databaseUrl:process.env.MIGRATION_DATABASE_URL,applicationName:'refs-wbs-h1-company-verifier-admin',max:1});
  const runtimePool=await createPool({databaseUrl:process.env.DATABASE_URL,applicationName:'refs-wbs-h1-company-verifier-runtime',max:2});
  const issuerPool=await createPool({databaseUrl:process.env.CONTEXT_ISSUER_DATABASE_URL,applicationName:'refs-wbs-h1-company-verifier-issuer',max:1});
  try{process.stdout.write(`${JSON.stringify(await verifyWbsH1CompanyAccounting({adminPool,runtimePool,issuerPool,tenantId,companyCode}))}\n`);}
  finally{await Promise.allSettled([adminPool.end(),runtimePool.end(),issuerPool.end()]);}
}

if(import.meta.url===pathToFileURL(process.argv[1]).href)main().catch(error=>{process.stderr.write(`${JSON.stringify({status:'WBS_H1_COMPANY_ACCOUNTING_VERIFY_FAILED',message:error.message})}\n`);process.exitCode=1;});
