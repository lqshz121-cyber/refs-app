#!/usr/bin/env node
import {pathToFileURL} from 'node:url';

const SHA=/^[0-9a-f]{40}$/;
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const COMPANY=/^[A-Z0-9][A-Z0-9_:-]{0,63}$/;
const MONEY4=/^-?(?:0|[1-9][0-9]{0,19})\.[0-9]{4}$/;
const H1=Object.freeze(Array.from({length:6},(_,index)=>`2026-${String(index+1).padStart(2,'0')}`));

const fail=(code,message)=>{const error=new Error(message);error.code=code;throw error;};
const minor=value=>{
  if(!MONEY4.test(String(value??'')))fail('WBS_H1_API_MONEY_INVALID','A report row returned invalid four-decimal money.');
  const [whole,fraction]=String(value).split('.'),negative=whole.startsWith('-'),digits=negative?whole.slice(1):whole;
  const amount=BigInt(digits)*10000n+BigInt(fraction);return negative?-amount:amount;
};
const money=value=>`${value<0n?'-':''}${(value<0n?-value:value)/10000n}.${String((value<0n?-value:value)%10000n).padStart(4,'0')}`;
const expectedCodes=value=>{
  if(value===undefined||value===null||String(value).trim()==='')return [];
  const codes=String(value).split(',').map(item=>item.trim().toUpperCase());
  if(codes.some(code=>!COMPANY.test(code))||new Set(codes).size!==codes.length)fail('WBS_H1_EXPECTED_COMPANIES_INVALID','Expected WBS company codes must be unique canonical codes.');
  return codes.sort();
};

async function getJson({apiBaseUrl,accessToken,path,fetchImpl}){
  const response=await fetchImpl(`${apiBaseUrl}${path}`,{method:'GET',cache:'no-store',headers:{accept:'application/json',authorization:`Bearer ${accessToken}`}});
  let body=null;try{body=await response.json();}catch{}
  if(!response.ok||body?.ok===false)fail(body?.code||`HTTP_${response.status}`,body?.message||`Authoritative GET ${path} failed.`);
  return body;
}

function summarizeStatements(rows){
  if(!Array.isArray(rows))fail('WBS_H1_REPORT_PROTOCOL_INVALID','Financial statements must be an array.');
  const trial=rows.filter(row=>row?.statement_type==='TRIAL_BALANCE'),types=[...new Set(rows.map(row=>row?.statement_type))].filter(Boolean).sort();
  const debit=trial.reduce((sum,row)=>sum+minor(row.ending_debit),0n),credit=trial.reduce((sum,row)=>sum+minor(row.ending_credit),0n);
  return Object.freeze({row_count:rows.length,report_types:types,trial_balance_balanced:trial.length>0&&debit===credit,trial_balance_difference:money(debit-credit)});
}

export async function verifyWbsH1AuthoritativeApi({apiBaseUrl,accessToken,releaseSha,expectedCompanyCodes=[],fetchImpl=globalThis.fetch}={}){
  const base=String(apiBaseUrl||'').replace(/\/$/,'');
  if(!/^https:\/\//.test(base)||typeof accessToken!=='string'||accessToken.length<16||!SHA.test(releaseSha||'')||typeof fetchImpl!=='function')fail('WBS_H1_API_VERIFY_CONFIG_INVALID','HTTPS API, bearer token and exact release SHA are required.');
  const expected=expectedCodes(expectedCompanyCodes),ready=await getJson({apiBaseUrl:base,accessToken,path:'/health/ready',fetchImpl});
  if(ready?.status!=='ready'||ready?.release!==releaseSha)fail('WBS_H1_API_RELEASE_MISMATCH','The accounting API is not serving the exact accepted release.');
  const catalog=await getJson({apiBaseUrl:base,accessToken,path:'/api/v1/accounting-scopes',fetchImpl}),scopes=Array.isArray(catalog?.data)?catalog.data:null;
  if(!scopes)fail('WBS_H1_SCOPE_CATALOG_INVALID','The authenticated company-period catalog is invalid.');
  const companies=new Map();
  for(const row of scopes){
    if(!UUID.test(row?.entity_id||'')||!UUID.test(row?.period_id||'')||!COMPANY.test(row?.entity_code||'')||!H1.includes(row?.period_code))continue;
    const current=companies.get(row.entity_id)||{entity_id:row.entity_id,company_code:row.entity_code,company_name:row.entity_name,periods:new Map()};
    if(current.company_code!==row.entity_code||current.periods.has(row.period_code))fail('WBS_H1_SCOPE_CATALOG_INVALID','The authenticated H1 company catalog contains conflicting or duplicate scopes.');
    current.periods.set(row.period_code,row.period_id);companies.set(row.entity_id,current);
  }
  const rows=[...companies.values()].sort((left,right)=>left.company_code.localeCompare(right.company_code));
  if(rows.length===0)fail('WBS_H1_COMPANY_POPULATION_EMPTY','No authorized WBS H1 company scopes were returned.');
  const actualCodes=rows.map(row=>row.company_code).sort(),missing=expected.filter(code=>!actualCodes.includes(code)),unexpected=expected.length?actualCodes.filter(code=>!expected.includes(code)):[];
  const results=[];
  for(const company of rows){
    const periodCodes=[...company.periods.keys()].sort(),periodsComplete=H1.every(code=>company.periods.has(code));
    const inventoryEnvelope=await getJson({apiBaseUrl:base,accessToken,path:`/api/v1/entities/${company.entity_id}/wbs/h1-import-inventory?limit=1&offset=0`,fetchImpl}),inventory=inventoryEnvelope?.data;
    if(inventory?.schema_version!=='WBS_H1_IMPORT_INVENTORY_V1'||inventory?.company_code!==company.company_code||!Array.isArray(inventory.months)||inventory.months.length!==6)fail('WBS_H1_INVENTORY_PROTOCOL_INVALID',`H1 inventory for ${company.company_code} is invalid.`);
    const reportPeriods=[];
    for(const month of inventory.months){
      if(!H1.includes(month.period_code)||!Number.isSafeInteger(month.formal_mapping_posted_count))fail('WBS_H1_INVENTORY_PROTOCOL_INVALID',`H1 month for ${company.company_code} is invalid.`);
      if(month.formal_mapping_posted_count===0)continue;
      const periodId=company.periods.get(month.period_code);if(!periodId)continue;
      const statements=await getJson({apiBaseUrl:base,accessToken,path:`/api/v1/entities/${company.entity_id}/reports/financial-statements?periodId=${encodeURIComponent(periodId)}`,fetchImpl});
      reportPeriods.push(Object.freeze({period_code:month.period_code,...summarizeStatements(statements?.data)}));
    }
    const totals=inventory.totals,formalComplete=totals.source_record_count===totals.formal_mapping_posted_count;
    const reportsPass=reportPeriods.every(period=>period.trial_balance_balanced&&['BALANCE_SHEET','INCOME_STATEMENT','TRIAL_BALANCE'].every(type=>period.report_types.includes(type)));
    results.push(Object.freeze({company_code:company.company_code,company_name:company.company_name,entity_id:company.entity_id,period_codes:periodCodes,h1_periods_complete:periodsComplete,source_record_count:totals.source_record_count,mapping_ready_count:totals.mapping_ready_count,mapping_exception_count:totals.mapping_missing_count+totals.mapping_ambiguous_count,formal_mapping_posted_count:totals.formal_mapping_posted_count,formal_population_complete:formalComplete,posted_report_periods:reportPeriods,reports_balanced:reportsPass}));
  }
  const pass=missing.length===0&&unexpected.length===0&&results.every(row=>row.h1_periods_complete&&row.formal_population_complete&&row.reports_balanced);
  return Object.freeze({status:pass?'WBS_H1_AUTHORITATIVE_API_VERIFIED':'WBS_H1_AUTHORITATIVE_API_INCOMPLETE',release_sha:releaseSha,authorized_company_count:results.length,expected_company_codes:expected,missing_company_codes:missing,unexpected_company_codes:unexpected,companies:Object.freeze(results),pass});
}

async function main(){
  const result=await verifyWbsH1AuthoritativeApi({apiBaseUrl:process.env.REFS_STAGING_API_BASE_URL,accessToken:process.env.REFS_WBS_H1_E2E_READ_ACCESS_TOKEN,releaseSha:String(process.env.REFS_RELEASE_SHA||'').toLowerCase(),expectedCompanyCodes:process.env.REFS_EXPECTED_WBS_COMPANY_CODES});
  process.stdout.write(`${JSON.stringify(result)}\n`);if(!result.pass)process.exitCode=1;
}

if(import.meta.url===pathToFileURL(process.argv[1]).href)main().catch(error=>{process.stderr.write(`${JSON.stringify({status:'WBS_H1_AUTHORITATIVE_API_VERIFY_FAILED',code:error.code||'UNEXPECTED',message:error.message})}\n`);process.exitCode=1;});
