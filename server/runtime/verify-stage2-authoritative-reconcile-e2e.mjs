// A no-write release gate for a completed Stage 2 reconciliation.
import {readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {resolve} from 'node:path';
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const GIT_SHA=/^[0-9a-f]{40}$/i;
const fields=['tenantId','entityId','periodId','statementReceiptId','reconciliationId','snapshotId','bankSourceId','journalEntryId','bankAccountRef','statementEndingDate'];
const fail=message=>{throw new Error(`stage2-authoritative-e2e: ${message}`);};
const expect=(ok,message)=>{if(!ok)fail(message);};
const contains=(value,expected)=>value===expected||(Array.isArray(value)?value.some(item=>contains(item,expected)):value&&typeof value==='object'&&Object.values(value).some(item=>contains(item,expected)));
export function stage2Config(env=process.env,scenario){
  expect(scenario&&typeof scenario==='object'&&!Array.isArray(scenario),'scenario must be a JSON object');for(const key of fields)expect(Object.hasOwn(scenario,key),`scenario.${key} is required`);
  for(const key of fields.slice(0,8))expect(UUID.test(String(scenario[key])),`scenario.${key} must be a UUID`);
  expect(/^[A-Za-z0-9._:-]{1,128}$/.test(String(scenario.bankAccountRef)),'scenario.bankAccountRef is invalid');expect(/^\d{4}-\d{2}-\d{2}$/.test(String(scenario.statementEndingDate)),'scenario.statementEndingDate must be YYYY-MM-DD');
  const token=String(env.REFS_STAGE2_E2E_READ_ACCESS_TOKEN||'').trim();expect(token.length>=16&&!/(replace|example|placeholder|changeme)/i.test(token),'REFS_STAGE2_E2E_READ_ACCESS_TOKEN is required and must not be a placeholder');
  let url;try{url=new URL(String(env.REFS_STAGING_API_BASE_URL||''));}catch{fail('REFS_STAGING_API_BASE_URL must be an HTTPS origin');}expect(url.protocol==='https:'&&!url.username&&!url.password&&url.pathname==='/'&&!url.search&&!url.hash,'REFS_STAGING_API_BASE_URL must be an HTTPS origin');
  let web;try{web=new URL(String(env.REFS_STAGING_WEB_ORIGIN||''));}catch{fail('REFS_STAGING_WEB_ORIGIN must be an HTTPS origin');}expect(web.protocol==='https:'&&!web.username&&!web.password&&web.pathname==='/'&&!web.search&&!web.hash,'REFS_STAGING_WEB_ORIGIN must be an HTTPS origin');
  const releaseSha=String(env.REFS_RELEASE_SHA||'').trim().toLowerCase();expect(GIT_SHA.test(releaseSha),'REFS_RELEASE_SHA must be a full 40-character Git SHA');
  return Object.freeze({apiBaseUrl:url.origin,webOrigin:web.origin,releaseSha,accessToken:token,scenario:Object.freeze({...scenario})});
}
export async function readStage2Scenario(pathname=process.env.REFS_STAGE2_E2E_SCENARIO_PATH){expect(pathname,'REFS_STAGE2_E2E_SCENARIO_PATH is required');try{return JSON.parse(await readFile(pathname,'utf8'));}catch(error){fail(`scenario cannot be read: ${error.message}`);}}
async function get(fetcher,url,token,label){const response=await fetcher(url,{method:'GET',redirect:'error',cache:'no-store',headers:{accept:'application/json',authorization:`Bearer ${token}`}});expect(response.status===200,`${label} returned HTTP ${response.status}`);expect(String(response.headers.get('cache-control')||'').toLowerCase().includes('no-store'),`${label} must be no-store`);const body=await response.json();expect(body?.ok===true&&body.data!==undefined,`${label} returned an invalid response`);return body.data;}
const sameRelease=(value,expected)=>typeof value==='string'&&/^[0-9a-f]{7,40}$/i.test(value)&&expected.startsWith(value.toLowerCase());
async function verifyReleaseStamp({apiBaseUrl,webOrigin,releaseSha,fetcher}){const stamp=async(url,label)=>{const response=await fetcher(url,{method:'GET',redirect:'error',cache:'no-store',headers:{accept:'application/json'}});expect(response.status===200,`${label} returned HTTP ${response.status}`);expect(String(response.headers.get('cache-control')||'').toLowerCase().includes('no-store'),`${label} must be no-store`);return response;};const [live,ready,build]=await Promise.all([stamp(`${apiBaseUrl}/health/live`,'API liveness'),stamp(`${apiBaseUrl}/health/ready`,'API readiness'),stamp(`${webOrigin}/refs-build.js`,'authoritative web build stamp')]);const [liveBody,readyBody,buildText]=await Promise.all([live.json(),ready.json(),build.text()]);expect(liveBody?.ok===true&&liveBody.status==='live'&&sameRelease(liveBody.release,releaseSha),'API liveness release does not match REFS_RELEASE_SHA');expect(readyBody?.ok===true&&readyBody.status==='ready'&&sameRelease(readyBody.release,releaseSha),'API readiness release does not match REFS_RELEASE_SHA');const matched=buildText.match(/window\.__BUILD\s*=\s*(\{[^\n;]+\})/);expect(matched,'authoritative web build stamp is missing window.__BUILD');let metadata;try{metadata=JSON.parse(matched[1]);}catch{fail('authoritative web build stamp is invalid JSON');}expect(metadata?.channel==='AUTHORITATIVE'&&metadata?.authoritative===true,'authoritative web build stamp is not AUTHORITATIVE');expect(sameRelease(metadata?.sha,releaseSha),'authoritative web build release does not match REFS_RELEASE_SHA');return Object.freeze({release:releaseSha,apiRelease:liveBody.release,webRelease:metadata.sha});}
export async function verifyStage2AuthoritativeE2e({config,fetcher=globalThis.fetch}={}){
  expect(config&&typeof config==='object','config is required');expect(typeof fetcher==='function','a fetch implementation is required');const {apiBaseUrl,webOrigin,releaseSha,accessToken,scenario:s}=config,base=`${apiBaseUrl}/api/v1/entities/${s.entityId}`;const release=await verifyReleaseStamp({apiBaseUrl,webOrigin,releaseSha,fetcher});
  const [receipt,snapshot,lineage,journal,ledger,statements]=await Promise.all([
    get(fetcher,`${base}/bank/reconciliations/admitted-statements/${s.statementReceiptId}`,accessToken,'admitted bank statement'),
    get(fetcher,`${base}/bank/reconciliations/${s.reconciliationId}/snapshot`,accessToken,'reconciled snapshot'),
    get(fetcher,`${base}/bank/reconciliations/${s.reconciliationId}/posted-lineage?bankSourceId=${encodeURIComponent(s.bankSourceId)}&journalEntryId=${encodeURIComponent(s.journalEntryId)}`,accessToken,'posted reconciliation lineage'),
    get(fetcher,`${base}/journal-entries/${s.journalEntryId}?periodId=${encodeURIComponent(s.periodId)}`,accessToken,'adjustment journal'),
    get(fetcher,`${base}/general-ledger/entries?periodId=${encodeURIComponent(s.periodId)}&limit=100&offset=0`,accessToken,'general ledger'),
    get(fetcher,`${base}/reports/financial-statements?periodId=${encodeURIComponent(s.periodId)}`,accessToken,'financial statements')
  ]),proof={receipt,snapshot,lineage,journal,ledger,statements};
  // Do not accept six unrelated records that merely contain the required IDs in
  // aggregate.  Every edge must be observable from the retained resource that
  // owns it, so a scenario cannot accidentally cross reconciliation chains.
  for(const [label,value,owner] of [
    ['statement receipt',s.statementReceiptId,receipt],
    ['reconciliation',s.reconciliationId,snapshot],
    ['immutable snapshot',s.snapshotId,snapshot],
    ['bank source',s.bankSourceId,snapshot],
    ['journal',s.journalEntryId,journal],
    ['period',s.periodId,journal]
  ])expect(contains(owner,value),`${label} is absent from its retained Stage 2 evidence`);
  expect(contains(ledger,s.journalEntryId),`journal is absent from posted general-ledger evidence`);
  expect(contains(statements,s.periodId),`period is absent from financial-statement evidence`);
  // The dedicated source-link read is the bridge from the posted JE back to
  // the exact bank item preserved in the signed reconciliation snapshot.
  expect(contains(lineage,s.bankSourceId),`bank source is absent from posted journal lineage`);
  expect(contains(lineage,s.reconciliationId),`reconciliation is absent from posted journal lineage`);
  expect(contains(lineage,s.journalEntryId),`journal is absent from posted reconciliation lineage`);
  expect(contains(receipt,'ADMITTED'),'bank statement receipt is not ADMITTED');expect(contains(snapshot,s.snapshotId),'reconciliation snapshot is not immutable');expect(contains(journal,'POSTED'),'adjustment journal is not POSTED');return Object.freeze({ok:true,mode:'READ_ONLY_RETAINED_EVIDENCE',release,reconciliationId:s.reconciliationId});
}
if(process.argv[1]&&fileURLToPath(import.meta.url)===resolve(process.argv[1])){try{console.log(JSON.stringify(await verifyStage2AuthoritativeE2e({config:stage2Config(process.env,await readStage2Scenario())})));}catch(error){console.error(error.message);process.exitCode=1;}}
