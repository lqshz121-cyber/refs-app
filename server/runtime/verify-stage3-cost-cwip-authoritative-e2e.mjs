// Read-only Stage 3 Cost-to-CWIP production evidence verifier.
// It proves one retained WBS_COST_CWIP source through POSTED JE, GL and reports.
import {readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {resolve} from 'node:path';

const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SHA=/^[0-9a-f]{40}$/i;
const MONEY4=/^-?[0-9]+\.[0-9]{4}$/;
const expect=(condition,message)=>{if(!condition)throw new Error(`stage3-cost-cwip-authoritative-e2e: ${message}`);};
const contains=(value,expected)=>value===expected||Array.isArray(value)&&value.some(item=>contains(item,expected))||value&&typeof value==='object'&&Object.values(value).some(item=>contains(item,expected));
const sameRelease=(actual,expected)=>typeof actual==='string'&&SHA.test(actual)&&actual.toLowerCase()===expected;
const money4=value=>typeof value==='string'&&MONEY4.test(value);
const origin=(value,name)=>{let url;try{url=new URL(String(value||''));}catch{throw new Error(`stage3-cost-cwip-authoritative-e2e: ${name} must be an HTTPS origin`);}expect(url.protocol==='https:'&&url.origin===url.toString().replace(/\/$/,''),`${name} must be an HTTPS origin`);return url.origin;};
const accessToken=value=>{expect(typeof value==='string'&&value.trim().length>=16&&!/(replace|example|placeholder|changeme)/i.test(value),'REFS_STAGE3_COST_CWIP_E2E_READ_ACCESS_TOKEN is required');return value.trim();};

export function stage3CostCwipAuthoritativeE2eConfig(environment=process.env,scenario){
  expect(scenario&&typeof scenario==='object'&&!Array.isArray(scenario),'scenario must be a JSON object');
  for(const key of ['entityId','periodId','sourceDocumentId','journalEntryId','cwipJournalLineId','offsetJournalLineId','cwipLedgerLineId','offsetLedgerLineId','cwipAccountCode','offsetAccountCode','expectedAmount'])expect(Object.hasOwn(scenario,key),`scenario.${key} is required`);
  for(const key of ['entityId','periodId','sourceDocumentId','journalEntryId','cwipJournalLineId','offsetJournalLineId','cwipLedgerLineId','offsetLedgerLineId'])expect(UUID.test(scenario[key]||''),`scenario.${key} must be a UUID`);
  for(const key of ['cwipAccountCode','offsetAccountCode'])expect(/^[A-Za-z0-9._-]{1,64}$/.test(scenario[key]||''),`scenario.${key} is invalid`);
  expect(scenario.cwipAccountCode!==scenario.offsetAccountCode,'CWIP and offset account codes must be different');
  expect(money4(scenario.expectedAmount),'scenario.expectedAmount must be fixed four-decimal text');
  const releaseSha=String(environment.REFS_RELEASE_SHA||'').trim().toLowerCase();
  expect(SHA.test(releaseSha),'REFS_RELEASE_SHA must be a full 40-character Git SHA');
  return Object.freeze({
    apiBaseUrl:origin(environment.REFS_STAGING_API_BASE_URL,'REFS_STAGING_API_BASE_URL'),
    webOrigin:origin(environment.REFS_STAGING_WEB_ORIGIN,'REFS_STAGING_WEB_ORIGIN'),
    releaseSha,
    accessToken:accessToken(environment.REFS_STAGE3_COST_CWIP_E2E_READ_ACCESS_TOKEN),
    scenario:Object.freeze({...scenario}),
  });
}

export async function readStage3CostCwipScenario(pathname=process.env.REFS_STAGE3_COST_CWIP_E2E_SCENARIO_PATH){
  expect(typeof pathname==='string'&&pathname.trim(),'REFS_STAGE3_COST_CWIP_E2E_SCENARIO_PATH is required');
  try{return JSON.parse(await readFile(pathname,'utf8'));}catch(error){throw new Error(`stage3-cost-cwip-authoritative-e2e: scenario cannot be read: ${error.message}`);}
}

async function read(fetcher,url,options,label){const response=await fetcher(url,options);expect(response.status===200,`${label} returned HTTP ${response.status}`);expect(String(response.headers.get('cache-control')||'').toLowerCase().includes('no-store'),`${label} must be no-store`);return response;}
async function getJson(fetcher,url,token,label){const response=await read(fetcher,url,{method:'GET',redirect:'error',cache:'no-store',headers:{accept:'application/json',authorization:`Bearer ${token}`}},label);const body=await response.json();expect(body?.ok===true&&body.data!==undefined,`${label} returned an invalid authoritative response`);return body.data;}
async function release(config,fetcher){const options={method:'GET',redirect:'error',cache:'no-store',headers:{accept:'application/json'}};const [live,ready,build]=await Promise.all([read(fetcher,`${config.apiBaseUrl}/health/live`,options,'API liveness'),read(fetcher,`${config.apiBaseUrl}/health/ready`,options,'API readiness'),read(fetcher,`${config.webOrigin}/refs-build.js`,options,'authoritative web build stamp')]);const [liveBody,readyBody,buildText]=await Promise.all([live.json(),ready.json(),build.text()]);expect(liveBody?.ok===true&&liveBody.status==='live'&&sameRelease(liveBody.release,config.releaseSha),'API liveness release does not match REFS_RELEASE_SHA');expect(readyBody?.ok===true&&readyBody.status==='ready'&&sameRelease(readyBody.release,config.releaseSha),'API readiness release does not match REFS_RELEASE_SHA');const match=buildText.match(/window\.__BUILD\s*=\s*(\{[^\n;]+\})/);expect(match,'authoritative web build stamp is missing metadata');const stamp=JSON.parse(match[1]);expect(stamp?.channel==='AUTHORITATIVE'&&stamp?.authoritative===true&&sameRelease(stamp.sha,config.releaseSha),'authoritative web build release does not match REFS_RELEASE_SHA');return Object.freeze({release:config.releaseSha,apiRelease:liveBody.release,webRelease:stamp.sha});}

const exactSource=(data,id)=>Array.isArray(data)?data.find(row=>row?.source_document_id===id):data?.source_document_id===id?data:null;
const exactLine=(rows,{accountCode,journalEntryId,journalLineId,ledgerLineId,sourceDocumentId,debit,credit})=>Array.isArray(rows)&&rows.some(row=>row?.account_code===accountCode&&row?.journal_entry_id===journalEntryId&&row?.journal_line_id===journalLineId&&row?.ledger_line_id===ledgerLineId&&row?.debit_amount===debit&&row?.credit_amount===credit&&contains(row?.source_document_ids,sourceDocumentId)&&money4(row?.debit_amount)&&money4(row?.credit_amount));
const exactJournalLine=(rows,{accountCode,journalLineId,ledgerLineId,sourceDocumentId,debit,credit})=>Array.isArray(rows)&&rows.some(row=>row?.account_code===accountCode&&row?.journal_line_id===journalLineId&&row?.ledger_line_id===ledgerLineId&&row?.debit_amount===debit&&row?.credit_amount===credit&&contains(row?.source_document_ids,sourceDocumentId)&&money4(row?.debit_amount)&&money4(row?.credit_amount));
const exactStatement=(rows,{statementType,accountCode,journalEntryId,journalLineId,ledgerLineId,sourceDocumentId,debit,credit})=>Array.isArray(rows)&&rows.some(row=>row?.statement_type===statementType&&row?.account_code===accountCode&&row?.period_debit===debit&&row?.period_credit===credit&&contains(row?.journal_entry_ids,journalEntryId)&&contains(row?.journal_line_ids,journalLineId)&&contains(row?.ledger_line_ids,ledgerLineId)&&contains(row?.source_document_ids,sourceDocumentId)&&['opening_debit','opening_credit','period_debit','period_credit','ending_debit','ending_credit','display_balance'].every(key=>money4(row?.[key])));

export async function verifyStage3CostCwipAuthoritativeE2e({config,fetcher=globalThis.fetch}={}){
  expect(config&&typeof fetcher==='function','config and fetcher are required');
  const {apiBaseUrl,accessToken:token,scenario}=config,stamps=await release(config,fetcher),base=`${apiBaseUrl}/api/v1/entities/${scenario.entityId}`,period=`periodId=${encodeURIComponent(scenario.periodId)}`;
  const [source,journal,cwipGl,offsetGl,statements]=await Promise.all([
    getJson(fetcher,`${base}/source-documents/${scenario.sourceDocumentId}`,token,'Cost-to-CWIP source document'),
    getJson(fetcher,`${base}/journal-entries/${scenario.journalEntryId}?${period}`,token,'posted journal detail'),
    getJson(fetcher,`${base}/general-ledger/entries?${period}&accountCode=${encodeURIComponent(scenario.cwipAccountCode)}&limit=200&offset=0`,token,'CWIP general ledger leg'),
    getJson(fetcher,`${base}/general-ledger/entries?${period}&accountCode=${encodeURIComponent(scenario.offsetAccountCode)}&limit=200&offset=0`,token,'offset general ledger leg'),
    getJson(fetcher,`${base}/reports/financial-statements?${period}`,token,'trial balance and financial reports'),
  ]);
  const sourceRow=exactSource(source,scenario.sourceDocumentId);
  expect(sourceRow?.source_system==='WBS'&&sourceRow?.source_module==='cost_general_ledger'&&sourceRow?.document_type==='WBS_COST_CWIP','source document is not the exact retained WBS_COST_CWIP evidence');
  expect(sourceRow?.gross_amount===scenario.expectedAmount&&money4(sourceRow?.gross_amount),'source document amount is not the expected MONEY4 value');
  expect(contains(sourceRow?.posted_journal_entry_ids,scenario.journalEntryId),'source document is not linked to the posted journal');
  expect(journal?.journal_entry_id===scenario.journalEntryId&&journal?.period_id===scenario.periodId&&journal?.status==='POSTED','journal detail is not the exact POSTED journal in the scenario period');
  const cwip={accountCode:scenario.cwipAccountCode,journalEntryId:scenario.journalEntryId,journalLineId:scenario.cwipJournalLineId,ledgerLineId:scenario.cwipLedgerLineId,sourceDocumentId:scenario.sourceDocumentId,debit:scenario.expectedAmount,credit:'0.0000'};
  const offset={accountCode:scenario.offsetAccountCode,journalEntryId:scenario.journalEntryId,journalLineId:scenario.offsetJournalLineId,ledgerLineId:scenario.offsetLedgerLineId,sourceDocumentId:scenario.sourceDocumentId,debit:'0.0000',credit:scenario.expectedAmount};
  expect(exactJournalLine(journal?.lines,cwip),'POSTED journal is missing the exact debit CWIP leg');expect(exactJournalLine(journal?.lines,offset),'POSTED journal is missing the exact credit offset leg');
  expect(exactLine(cwipGl,cwip),'general ledger is missing the exact debit CWIP leg');expect(exactLine(offsetGl,offset),'general ledger is missing the exact credit offset leg');
  for(const [leg,account,line,ledger] of [['CWIP',scenario.cwipAccountCode,scenario.cwipJournalLineId,scenario.cwipLedgerLineId],['offset',scenario.offsetAccountCode,scenario.offsetJournalLineId,scenario.offsetLedgerLineId]]){
    const evidence={accountCode:account,journalEntryId:scenario.journalEntryId,journalLineId:line,ledgerLineId:ledger,sourceDocumentId:scenario.sourceDocumentId,debit:leg==='CWIP'?scenario.expectedAmount:'0.0000',credit:leg==='CWIP'?'0.0000':scenario.expectedAmount};
    expect(exactStatement(statements,{...evidence,statementType:'TRIAL_BALANCE'}),`trial balance is missing the exact ${leg} lineage`);
    expect(exactStatement(statements,{...evidence,statementType:leg==='CWIP'?'BALANCE_SHEET':'INCOME_STATEMENT'}),`financial report is missing the exact ${leg} lineage`);
  }
  return Object.freeze({ok:true,mode:'READ_ONLY_WBS_COST_CWIP_EVIDENCE',release:stamps,checks:['same-release-stamps','wbs-cost-cwip-source-document','posted-balanced-journal','cwip-gl-leg','offset-gl-leg','trial-balance-lineage','balance-sheet-lineage','income-statement-lineage','money4'],sourceDocumentId:scenario.sourceDocumentId,journalEntryId:scenario.journalEntryId});
}

if(process.argv[1]&&fileURLToPath(import.meta.url)===resolve(process.argv[1])){try{console.log(JSON.stringify(await verifyStage3CostCwipAuthoritativeE2e({config:stage3CostCwipAuthoritativeE2eConfig(process.env,await readStage3CostCwipScenario())})));}catch(error){console.error(error.message);process.exitCode=1;}}
