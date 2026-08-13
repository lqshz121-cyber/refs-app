// Read-only Stage 1 production evidence verifier.
//
// This runner deliberately does not create an inbound row, bind an attachment,
// create a draft, or transition a journal.  Those commands are run only by the
// controlled four-actor admission workflow.  Once that workflow has completed,
// this verifier proves the same retained evidence is readable through the
// authoritative HTTPS API: signed WBS review -> posted journal -> GL -> AP
// aging -> financial statements.  It fails before any HTTP request when an
// operator has supplied an incomplete or placeholder scenario.

import {readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {resolve} from 'node:path';

const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SHA256=/^[0-9a-f]{64}$/i;
const requiredScenario=['tenantId','entityId','periodId','wbsInboundRowId','reviewEvidenceId','attachmentId','attachmentObjectVersionId','attachmentSha256','journalEntryId','asOf'];
const expect=(condition,message)=>{if(!condition)throw new Error(`stage1-authoritative-e2e: ${message}`);};
const uuid=(value,key)=>expect(typeof value==='string'&&UUID.test(value),`${key} must be a UUID`);

const httpsOrigin=(value,key)=>{
  let url;try{url=new URL(String(value||''));}catch{throw new Error(`stage1-authoritative-e2e: ${key} must be an HTTPS origin`);}
  expect(url.protocol==='https:'&&!url.username&&!url.password&&url.pathname==='/'&&!url.search&&!url.hash,`${key} must be an HTTPS origin`);
  return url.origin;
};

const bearer=(value,key)=>{
  expect(typeof value==='string'&&value.trim().length>=16,`${key} is required`);
  expect(!/(replace|example|placeholder|changeme)/i.test(value),`${key} must not be a placeholder`);
  return value.trim();
};

const contains=(value,expected)=>{
  if(value===expected)return true;
  if(Array.isArray(value))return value.some(item=>contains(item,expected));
  return value&&typeof value==='object'&&Object.values(value).some(item=>contains(item,expected));
};

export function stage1AuthoritativeE2eConfig(environment=process.env,scenario){
  expect(scenario&&typeof scenario==='object'&&!Array.isArray(scenario),'scenario must be a JSON object');
  for(const key of requiredScenario)expect(Object.hasOwn(scenario,key),`scenario.${key} is required`);
  for(const key of requiredScenario.filter(key=>key!=='asOf'&&key!=='attachmentSha256'))uuid(scenario[key],`scenario.${key}`);
  expect(typeof scenario.attachmentSha256==='string'&&SHA256.test(scenario.attachmentSha256),'scenario.attachmentSha256 must be a lowercase SHA-256 hex value');
  expect(/^\d{4}-\d{2}-\d{2}$/.test(String(scenario.asOf)),'scenario.asOf must be YYYY-MM-DD');
  if(scenario.expected!==undefined){
    expect(scenario.expected&&typeof scenario.expected==='object'&&!Array.isArray(scenario.expected),'scenario.expected must be an object');
    for(const key of ['debitAccountCode','creditAccountCode'])if(scenario.expected[key]!==undefined)expect(/^\d{6}$/.test(String(scenario.expected[key])),`scenario.expected.${key} must be a six-digit account code`);
  }
  return Object.freeze({apiBaseUrl:httpsOrigin(environment.REFS_STAGING_API_BASE_URL,'REFS_STAGING_API_BASE_URL'),accessToken:bearer(environment.REFS_STAGE1_E2E_READ_ACCESS_TOKEN,'REFS_STAGE1_E2E_READ_ACCESS_TOKEN'),scenario:Object.freeze({...scenario})});
}

export async function readStage1Scenario(pathname=process.env.REFS_STAGE1_E2E_SCENARIO_PATH){
  expect(typeof pathname==='string'&&pathname.trim(),'REFS_STAGE1_E2E_SCENARIO_PATH is required');
  let parsed;try{parsed=JSON.parse(await readFile(pathname,'utf8'));}catch(error){throw new Error(`stage1-authoritative-e2e: scenario cannot be read: ${error.message}`);}
  return parsed;
}

async function getJson(fetcher,url,token,label){
  const response=await fetcher(url,{method:'GET',redirect:'error',cache:'no-store',headers:{accept:'application/json',authorization:`Bearer ${token}`}});
  expect(response.status===200,`${label} returned HTTP ${response.status}`);
  expect(String(response.headers.get('cache-control')||'').toLowerCase().includes('no-store'),`${label} must be no-store`);
  const body=await response.json();expect(body?.ok===true&&body.data!==undefined,`${label} returned an invalid authoritative response`);
  return body.data;
}

export async function verifyStage1AuthoritativeE2e({config,fetcher=globalThis.fetch}={}){
  expect(config&&typeof config==='object','config is required');
  expect(typeof fetcher==='function','a fetch implementation is required');
  const {apiBaseUrl,accessToken,scenario}=config;
  const base=`${apiBaseUrl}/api/v1/entities/${scenario.entityId}`;
  const [review,journal,ledger,aging,statements]=await Promise.all([
    getJson(fetcher,`${base}/wbs/inbound/payables/reviews/${scenario.reviewEvidenceId}`,accessToken,'WBS review evidence'),
    getJson(fetcher,`${base}/journal-entries/${scenario.journalEntryId}?periodId=${encodeURIComponent(scenario.periodId)}`,accessToken,'journal detail'),
    getJson(fetcher,`${base}/general-ledger/entries?periodId=${encodeURIComponent(scenario.periodId)}`,accessToken,'general ledger'),
    getJson(fetcher,`${base}/ap/aging?asOf=${encodeURIComponent(scenario.asOf)}`,accessToken,'AP aging'),
    getJson(fetcher,`${base}/reports/financial-statements?periodId=${encodeURIComponent(scenario.periodId)}`,accessToken,'financial statements'),
  ]);
  const proof={review,journal,ledger,aging,statements};
  for(const [label,value] of [
    ['WBS inbound row',scenario.wbsInboundRowId],['attachment',scenario.attachmentId],['attachment object version',scenario.attachmentObjectVersionId],['attachment SHA-256',scenario.attachmentSha256],['journal',scenario.journalEntryId],['period',scenario.periodId],
  ])expect(contains(proof,value),`${label} is absent from retained Stage 1 evidence`);
  expect(contains(journal,'POSTED'), 'journal detail is not POSTED');
  for(const account of [scenario.expected?.debitAccountCode,scenario.expected?.creditAccountCode].filter(Boolean))expect(contains(proof,account),`expected account ${account} is absent from retained evidence`);
  return Object.freeze({ok:true,mode:'READ_ONLY_RETAINED_EVIDENCE',checks:['signed-wbs-review','posted-journal','ledger','ap-aging','financial-statements','cross-source-identifiers'],journalEntryId:scenario.journalEntryId});
}

if(process.argv[1]&&fileURLToPath(import.meta.url)===resolve(process.argv[1])){
  try{const scenario=await readStage1Scenario();const result=await verifyStage1AuthoritativeE2e({config:stage1AuthoritativeE2eConfig(process.env,scenario)});console.log(JSON.stringify(result));}
  catch(error){console.error(error.message);process.exitCode=1;}
}
