// Read-only Stage 4 production evidence verifier.
// It proves one immutable report-snapshot row can return to GL, JE and source.
import {readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {resolve} from 'node:path';

const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SHA=/^[0-9a-f]{40}$/i;
const MONEY4=/^-?[0-9]+\.[0-9]{4}$/;
const STATEMENT_MONEY_FIELDS=Object.freeze(['opening_debit','opening_credit','period_debit','period_credit','ending_debit','ending_credit','display_balance']);
const statementTypes=new Set(['TRIAL_BALANCE','BALANCE_SHEET','INCOME_STATEMENT','CASH_FLOW']);
const expect=(condition,message)=>{if(!condition)throw new Error(`stage4-authoritative-e2e: ${message}`);};
const contains=(value,expected)=>value===expected||Array.isArray(value)&&value.some(item=>contains(item,expected))||value&&typeof value==='object'&&Object.values(value).some(item=>contains(item,expected));
const sameRelease=(actual,expected)=>typeof actual==='string'&&/^[0-9a-f]{7,40}$/i.test(actual)&&expected.startsWith(actual.toLowerCase());
const origin=(value,name)=>{let url;try{url=new URL(String(value||''));}catch{throw new Error(`stage4-authoritative-e2e: ${name} must be an HTTPS origin`);}expect(url.protocol==='https:'&&url.origin===url.toString().replace(/\/$/,''),`${name} must be an HTTPS origin`);return url.origin;};
const accessToken=value=>{expect(typeof value==='string'&&value.trim().length>=16&&!/(replace|example|placeholder|changeme)/i.test(value),'REFS_STAGE4_E2E_READ_ACCESS_TOKEN is required');return value.trim();};

export function stage4AuthoritativeE2eConfig(environment=process.env,scenario){
  expect(scenario&&typeof scenario==='object'&&!Array.isArray(scenario),'scenario must be a JSON object');
  for(const key of ['entityId','periodId','financialStatementSnapshotId','statementType','accountCode','journalEntryId','journalLineId','ledgerLineId','sourceDocumentId'])expect(Object.hasOwn(scenario,key),`scenario.${key} is required`);
  for(const key of ['entityId','periodId','financialStatementSnapshotId','journalEntryId','journalLineId','ledgerLineId','sourceDocumentId'])expect(UUID.test(scenario[key]||''),`scenario.${key} must be a UUID`);
  expect(statementTypes.has(scenario.statementType),'scenario.statementType is invalid');expect(/^\d{6}$/.test(scenario.accountCode),'scenario.accountCode must be six digits');
  if(scenario.expectedAmount!==undefined)expect(typeof scenario.expectedAmount==='string'&&MONEY4.test(scenario.expectedAmount),'scenario.expectedAmount must be fixed four-decimal text');
  if(scenario.pairedTrialBalance!==undefined)expect(typeof scenario.pairedTrialBalance==='boolean','scenario.pairedTrialBalance must be boolean');
  if(scenario.pairedTrialBalance===true)expect(typeof scenario.expectedAmount==='string'&&MONEY4.test(scenario.expectedAmount),'paired Trial Balance verification requires scenario.expectedAmount as fixed four-decimal text');
  const releaseSha=String(environment.REFS_RELEASE_SHA||'').trim().toLowerCase();expect(SHA.test(releaseSha),'REFS_RELEASE_SHA must be a full 40-character Git SHA');
  return Object.freeze({apiBaseUrl:origin(environment.REFS_STAGING_API_BASE_URL,'REFS_STAGING_API_BASE_URL'),webOrigin:origin(environment.REFS_STAGING_WEB_ORIGIN,'REFS_STAGING_WEB_ORIGIN'),releaseSha,accessToken:accessToken(environment.REFS_STAGE4_E2E_READ_ACCESS_TOKEN),scenario:Object.freeze({...scenario})});
}

export async function readStage4Scenario(pathname=process.env.REFS_STAGE4_E2E_SCENARIO_PATH){expect(typeof pathname==='string'&&pathname.trim(),'REFS_STAGE4_E2E_SCENARIO_PATH is required');try{return JSON.parse(await readFile(pathname,'utf8'));}catch(error){throw new Error(`stage4-authoritative-e2e: scenario cannot be read: ${error.message}`);}}
async function getJson(fetcher,url,token,label){const response=await fetcher(url,{method:'GET',redirect:'error',cache:'no-store',headers:{accept:'application/json',authorization:`Bearer ${token}`}});expect(response.status===200,`${label} returned HTTP ${response.status}`);expect(String(response.headers.get('cache-control')||'').toLowerCase().includes('no-store'),`${label} must be no-store`);const body=await response.json();expect(body?.ok===true&&body.data!==undefined,`${label} returned an invalid authoritative response`);return body.data;}
async function release(config,fetcher){const read=async(url,label)=>{const response=await fetcher(url,{method:'GET',redirect:'error',cache:'no-store',headers:{accept:'application/json'}});expect(response.status===200,`${label} returned HTTP ${response.status}`);expect(String(response.headers.get('cache-control')||'').toLowerCase().includes('no-store'),`${label} must be no-store`);return response;};const [live,ready,build]=await Promise.all([read(`${config.apiBaseUrl}/health/live`,'API liveness'),read(`${config.apiBaseUrl}/health/ready`,'API readiness'),read(`${config.webOrigin}/refs-build.js`,'authoritative web build stamp')]);const [liveBody,readyBody,buildText]=await Promise.all([live.json(),ready.json(),build.text()]);expect(liveBody?.ok===true&&liveBody.status==='live'&&sameRelease(liveBody.release,config.releaseSha),'API liveness release does not match REFS_RELEASE_SHA');expect(readyBody?.ok===true&&readyBody.status==='ready'&&sameRelease(readyBody.release,config.releaseSha),'API readiness release does not match REFS_RELEASE_SHA');const match=buildText.match(/window\.__BUILD\s*=\s*(\{[^\n;]+\})/);expect(match,'authoritative web build stamp is missing metadata');const stamp=JSON.parse(match[1]);expect(stamp?.channel==='AUTHORITATIVE'&&stamp?.authoritative===true&&sameRelease(stamp.sha,config.releaseSha),'authoritative web build release does not match REFS_RELEASE_SHA');return Object.freeze({release:config.releaseSha,apiRelease:liveBody.release,webRelease:stamp.sha});}

export async function verifyStage4AuthoritativeE2e({config,fetcher=globalThis.fetch}={}){
  expect(config&&typeof fetcher==='function','config and fetcher are required');const {apiBaseUrl,releaseSha,accessToken:token,scenario}=config;const stamps=await release(config,fetcher);const base=`${apiBaseUrl}/api/v1/entities/${scenario.entityId}`;const query=`periodId=${encodeURIComponent(scenario.periodId)}`;
  const [snapshot,statements,ledger,journal,source]=await Promise.all([
    getJson(fetcher,`${base}/reports/financial-statement-snapshot?${query}`,token,'financial statement snapshot'),
    getJson(fetcher,`${base}/reports/financial-statements?${query}`,token,'financial statements'),
    getJson(fetcher,`${base}/general-ledger/entries?${query}&accountCode=${scenario.accountCode}&limit=200&offset=0`,token,'general ledger'),
    getJson(fetcher,`${base}/journal-entries/${scenario.journalEntryId}?${query}`,token,'journal detail'),
    getJson(fetcher,`${base}/source-documents/${scenario.sourceDocumentId}`,token,'source document'),
  ]);
  const rowMatches=(row,statementType=scenario.statementType)=>row?.statement_type===statementType&&row?.account_code===scenario.accountCode&&contains(row,scenario.journalEntryId)&&contains(row,scenario.journalLineId)&&contains(row,scenario.ledgerLineId)&&contains(row,scenario.sourceDocumentId);
  const snapshotMatches=(row,statementType)=>row?.financial_statement_snapshot_id===scenario.financialStatementSnapshotId&&rowMatches(row,statementType)&&/^sha256:[0-9a-f]{64}$/.test(String(row.snapshot_hash||''))&&/^sha256:[0-9a-f]{64}$/.test(String(row.ledger_evidence_hash||''))&&/^sha256:[0-9a-f]{64}$/.test(String(row.row_hash||''));
  expect(Array.isArray(snapshot)&&snapshot.some(row=>snapshotMatches(row,scenario.statementType)),'immutable statement snapshot does not retain the exact lineage row');
  expect(Array.isArray(statements)&&statements.some(row=>rowMatches(row,scenario.statementType)),'live financial statements do not retain the exact lineage row');
  if(scenario.pairedTrialBalance&&scenario.statementType!=='TRIAL_BALANCE'){
    const money4Row=row=>STATEMENT_MONEY_FIELDS.every(key=>typeof row?.[key]==='string'&&MONEY4.test(row[key]));
    const exactMoneyRow=row=>money4Row(row)&&STATEMENT_MONEY_FIELDS.some(key=>row[key]===scenario.expectedAmount);
    expect(snapshot.some(row=>snapshotMatches(row,scenario.statementType)&&exactMoneyRow(row))&&statements.some(row=>rowMatches(row,scenario.statementType)&&exactMoneyRow(row)),'target financial report row does not retain expectedAmount in its fixed MONEY4 fields');
    expect(snapshot.some(row=>snapshotMatches(row,'TRIAL_BALANCE')&&exactMoneyRow(row)),'immutable statement snapshot does not retain the paired Trial Balance lineage row with expectedAmount in its fixed MONEY4 fields');
    expect(statements.some(row=>rowMatches(row,'TRIAL_BALANCE')&&exactMoneyRow(row)),'live financial statements do not retain the paired Trial Balance lineage row with expectedAmount in its fixed MONEY4 fields');
  }
  expect(Array.isArray(ledger)&&ledger.some(row=>row?.ledger_line_id===scenario.ledgerLineId&&row?.journal_entry_id===scenario.journalEntryId&&contains(row,scenario.journalLineId)&&contains(row,scenario.sourceDocumentId)),'general ledger does not retain the exact report line');
  expect(journal?.journal_entry_id===scenario.journalEntryId&&contains(journal,'POSTED')&&contains(journal,scenario.journalLineId)&&contains(journal,scenario.sourceDocumentId),'journal detail does not retain the posted source evidence');
  expect(source?.source_document_id===scenario.sourceDocumentId||contains(source,scenario.sourceDocumentId),'source-document detail does not retain the exact source identity');
  if(scenario.expectedAmount!==undefined)expect([snapshot,statements,ledger,journal].some(value=>contains(value,scenario.expectedAmount)),`expected fixed-point amount ${scenario.expectedAmount} is absent from retained evidence`);
  return Object.freeze({ok:true,mode:'READ_ONLY_FINANCIAL_STATEMENT_SNAPSHOT_EVIDENCE',release:stamps,checks:['same-release-stamps','immutable-snapshot-row','live-statement-row',...(scenario.pairedTrialBalance&&scenario.statementType!=='TRIAL_BALANCE'?['paired-trial-balance-row']:[]),'general-ledger','posted-journal','source-document','cross-source-identifiers'],financialStatementSnapshotId:scenario.financialStatementSnapshotId});
}

if(process.argv[1]&&fileURLToPath(import.meta.url)===resolve(process.argv[1])){try{console.log(JSON.stringify(await verifyStage4AuthoritativeE2e({config:stage4AuthoritativeE2eConfig(process.env,await readStage4Scenario())})));}catch(error){console.error(error.message);process.exitCode=1;}}
