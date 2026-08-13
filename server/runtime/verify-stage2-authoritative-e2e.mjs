// Read-only Stage 2 production evidence verifier.
// It never creates a match, clearance, reconciliation, journal, or snapshot.
// The supplied scenario must identify one already signed-off reconciliation.
import {readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {resolve} from 'node:path';

const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SHA=/^[0-9a-f]{40}$/i;
const DATE=/^\d{4}-\d{2}-\d{2}$/;
const MONEY4=/^-?[0-9]+\.[0-9]{4}$/;
const required=['entityId','periodId','bankAccountRef','statementEndingDate','reconciliationId','bankSourceId','bankMatchId','journalEntryId','journalLineId','ledgerLineId','sourceDocumentId','cashAccountCode'];
const expect=(condition,message)=>{if(!condition)throw new Error(`stage2-authoritative-e2e: ${message}`);};
const contains=(value,expected)=>value===expected||Array.isArray(value)&&value.some(item=>contains(item,expected))||value&&typeof value==='object'&&Object.values(value).some(item=>contains(item,expected));
const httpsOrigin=(value,name)=>{let url;try{url=new URL(String(value||''));}catch{throw new Error(`stage2-authoritative-e2e: ${name} must be an HTTPS origin`);}expect(url.protocol==='https:'&&!url.username&&!url.password&&url.pathname==='/'&&!url.search&&!url.hash,`${name} must be an HTTPS origin`);return url.origin;};
const token=value=>{expect(typeof value==='string'&&value.trim().length>=16,'REFS_STAGE2_E2E_READ_ACCESS_TOKEN is required');expect(!/(replace|example|placeholder|changeme)/i.test(value),'REFS_STAGE2_E2E_READ_ACCESS_TOKEN must not be a placeholder');return value.trim();};
const sameRelease=(actual,expected)=>typeof actual==='string'&&/^[0-9a-f]{7,40}$/i.test(actual)&&expected.startsWith(actual.toLowerCase());

export function stage2AuthoritativeE2eConfig(environment=process.env,scenario){
  expect(scenario&&typeof scenario==='object'&&!Array.isArray(scenario),'scenario must be a JSON object');
  for(const key of required)expect(Object.hasOwn(scenario,key),`scenario.${key} is required`);
  for(const key of ['entityId','periodId','reconciliationId','bankSourceId','bankMatchId','journalEntryId','journalLineId','ledgerLineId','sourceDocumentId'])expect(UUID.test(scenario[key]||''),`scenario.${key} must be a UUID`);
  expect(typeof scenario.bankAccountRef==='string'&&scenario.bankAccountRef.trim()&&scenario.bankAccountRef===scenario.bankAccountRef.trim(),'scenario.bankAccountRef is required');
  expect(DATE.test(scenario.statementEndingDate),'scenario.statementEndingDate must be YYYY-MM-DD');
  expect(/^\d{6}$/.test(scenario.cashAccountCode),'scenario.cashAccountCode must be a six-digit account');
  if(scenario.expectedAmount!==undefined)expect(MONEY4.test(String(scenario.expectedAmount)),'scenario.expectedAmount must be fixed four-decimal text');
  const releaseSha=String(environment.REFS_RELEASE_SHA||'').trim().toLowerCase();expect(SHA.test(releaseSha),'REFS_RELEASE_SHA must be a full 40-character Git SHA');
  return Object.freeze({apiBaseUrl:httpsOrigin(environment.REFS_STAGING_API_BASE_URL,'REFS_STAGING_API_BASE_URL'),webOrigin:httpsOrigin(environment.REFS_STAGING_WEB_ORIGIN,'REFS_STAGING_WEB_ORIGIN'),releaseSha,accessToken:token(environment.REFS_STAGE2_E2E_READ_ACCESS_TOKEN),scenario:Object.freeze({...scenario})});
}

export async function readStage2Scenario(pathname=process.env.REFS_STAGE2_E2E_SCENARIO_PATH){expect(typeof pathname==='string'&&pathname.trim(),'REFS_STAGE2_E2E_SCENARIO_PATH is required');try{return JSON.parse(await readFile(pathname,'utf8'));}catch(error){throw new Error(`stage2-authoritative-e2e: scenario cannot be read: ${error.message}`);}}

async function getJson(fetcher,url,accessToken,label){const response=await fetcher(url,{method:'GET',redirect:'error',cache:'no-store',headers:{accept:'application/json',authorization:`Bearer ${accessToken}`}});expect(response.status===200,`${label} returned HTTP ${response.status}`);expect(String(response.headers.get('cache-control')||'').toLowerCase().includes('no-store'),`${label} must be no-store`);const body=await response.json();expect(body?.ok===true&&body.data!==undefined,`${label} returned an invalid authoritative response`);return body.data;}
async function release({apiBaseUrl,webOrigin,releaseSha,fetcher}){const read=async(url,label)=>{const response=await fetcher(url,{method:'GET',redirect:'error',cache:'no-store',headers:{accept:'application/json'}});expect(response.status===200,`${label} returned HTTP ${response.status}`);expect(String(response.headers.get('cache-control')||'').toLowerCase().includes('no-store'),`${label} must be no-store`);return response;};const [live,ready,build]=await Promise.all([read(`${apiBaseUrl}/health/live`,'API liveness'),read(`${apiBaseUrl}/health/ready`,'API readiness'),read(`${webOrigin}/refs-build.js`,'authoritative web build stamp')]);const [liveBody,readyBody,buildText]=await Promise.all([live.json(),ready.json(),build.text()]);expect(liveBody?.ok===true&&liveBody.status==='live'&&sameRelease(liveBody.release,releaseSha),'API liveness release does not match REFS_RELEASE_SHA');expect(readyBody?.ok===true&&readyBody.status==='ready'&&sameRelease(readyBody.release,releaseSha),'API readiness release does not match REFS_RELEASE_SHA');const match=buildText.match(/window\.__BUILD\s*=\s*(\{[^\n;]+\})/);expect(match,'authoritative web build stamp is missing metadata');let metadata;try{metadata=JSON.parse(match[1]);}catch{throw new Error('stage2-authoritative-e2e: authoritative web build stamp is invalid JSON');}expect(metadata?.channel==='AUTHORITATIVE'&&metadata?.authoritative===true&&sameRelease(metadata?.sha,releaseSha),'authoritative web build release does not match REFS_RELEASE_SHA');return Object.freeze({release:releaseSha,apiRelease:liveBody.release,webRelease:metadata.sha});}

export async function verifyStage2AuthoritativeE2e({config,fetcher=globalThis.fetch}={}){
  expect(config&&typeof fetcher==='function','config and fetcher are required');const {apiBaseUrl,webOrigin,releaseSha,accessToken,scenario}=config;const stamps=await release({apiBaseUrl,webOrigin,releaseSha,fetcher});const base=`${apiBaseUrl}/api/v1/entities/${scenario.entityId}`;const query=new URLSearchParams({bankAccountRef:scenario.bankAccountRef,from:scenario.statementEndingDate.slice(0,8)+'01',through:scenario.statementEndingDate,limit:'200',offset:'0'});
  const [bank,reconciliation,worksheet,journal,ledger,statements]=await Promise.all([
    getJson(fetcher,`${base}/bank/transactions?${query}`,accessToken,'bank transactions'),
    getJson(fetcher,`${base}/bank/reconciliation?${new URLSearchParams({bankAccountRef:scenario.bankAccountRef,statementEndingDate:scenario.statementEndingDate})}`,accessToken,'reconciliation summary'),
    getJson(fetcher,`${base}/bank/reconciliations/${scenario.reconciliationId}/worksheet`,accessToken,'reconciliation worksheet'),
    getJson(fetcher,`${base}/journal-entries/${scenario.journalEntryId}?periodId=${encodeURIComponent(scenario.periodId)}`,accessToken,'journal detail'),
    getJson(fetcher,`${base}/general-ledger/entries?${new URLSearchParams({periodId:scenario.periodId,accountCode:scenario.cashAccountCode,limit:'200',offset:'0'})}`,accessToken,'general ledger'),
    getJson(fetcher,`${base}/reports/financial-statements?periodId=${encodeURIComponent(scenario.periodId)}`,accessToken,'financial statements'),
  ]);
  const proof={bank,reconciliation,worksheet,journal,ledger,statements};
  for(const [label,value] of [['reconciliation',scenario.reconciliationId],['bank source',scenario.bankSourceId],['bank match',scenario.bankMatchId],['journal',scenario.journalEntryId],['journal line',scenario.journalLineId],['ledger line',scenario.ledgerLineId],['source document',scenario.sourceDocumentId],['period',scenario.periodId]])expect(contains(proof,value),`${label} is absent from retained Stage 2 evidence`);
  expect(contains(reconciliation,'RECONCILED'),'reconciliation is not signed off');expect(contains(worksheet,'CLEARED'),'worksheet does not retain cleared evidence');expect(contains(journal,'POSTED'),'journal detail is not POSTED');
  if(scenario.expectedAmount!==undefined)expect(contains(proof,scenario.expectedAmount),`expected fixed-point amount ${scenario.expectedAmount} is absent from retained evidence`);
  for(const type of ['TRIAL_BALANCE','BALANCE_SHEET','CASH_FLOW'])expect(Array.isArray(statements)&&statements.some(row=>row?.statement_type===type&&row?.account_code===scenario.cashAccountCode&&contains(row,scenario.ledgerLineId)&&contains(row,scenario.sourceDocumentId)),`${type} is missing the reconciled cash evidence`);
  return Object.freeze({ok:true,mode:'READ_ONLY_RECONCILIATION_EVIDENCE',release:stamps,checks:['same-release-stamps','bank-source','match','worksheet','signed-off-reconciliation','posted-journal','ledger','trial-balance','balance-sheet','cash-flow','cross-source-identifiers'],reconciliationId:scenario.reconciliationId});
}

if(process.argv[1]&&fileURLToPath(import.meta.url)===resolve(process.argv[1])){try{const scenario=await readStage2Scenario();console.log(JSON.stringify(await verifyStage2AuthoritativeE2e({config:stage2AuthoritativeE2eConfig(process.env,scenario)})));}catch(error){console.error(error.message);process.exitCode=1;}}
