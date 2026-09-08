// Read-only Stage 1 production evidence verifier. It accepts only one exact,
// retained, posted WBS Payable chain and never executes accounting commands.

import {readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {resolve} from 'node:path';

const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SHA256=/^[0-9a-f]{64}$/;
const PREFIXED_SHA256=/^sha256:[0-9a-f]{64}$/;
const GIT_SHA=/^[0-9a-f]{40}$/i;
const requiredScenario=['tenantId','entityId','periodId','wbsInboundRowId','reviewEvidenceId','providerSignedAdmissionId','sourceRecordId','sourceVersion','receiptHash','providerReceiptHash','evidenceHash','signedPackageHash','signedReceiptHash','attachmentId','attachmentObjectVersionId','attachmentSha256','journalEntryId','asOf'];
const expect=(condition,message)=>{if(!condition)throw new Error(`stage1-authoritative-e2e: ${message}`);};
const uuid=(value,key)=>expect(typeof value==='string'&&UUID.test(value),`${key} must be a UUID`);
const exactMoney=(value,key)=>{expect(typeof value==='string'&&/^-?(?:0|[1-9]\d*)\.\d{4}$/.test(value),`${key} must be a MONEY4 string`);return value;};
const carries=(values,expected)=>Array.isArray(values)&&values.includes(expected);

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

export function stage1AuthoritativeE2eConfig(environment=process.env,scenario){
  expect(scenario&&typeof scenario==='object'&&!Array.isArray(scenario),'scenario must be a JSON object');
  for(const key of requiredScenario)expect(Object.hasOwn(scenario,key),`scenario.${key} is required`);
  for(const key of ['tenantId','entityId','periodId','wbsInboundRowId','reviewEvidenceId','providerSignedAdmissionId','attachmentId','journalEntryId'])uuid(scenario[key],`scenario.${key}`);
  for(const key of ['sourceRecordId','sourceVersion'])expect(typeof scenario[key]==='string'&&scenario[key].length>=1&&scenario[key].length<=128&&!/[\u0000-\u001f\u007f]/.test(scenario[key]),`scenario.${key} must be a non-control string of 1-128 characters`);
  for(const key of ['receiptHash','providerReceiptHash','evidenceHash','signedPackageHash','signedReceiptHash'])expect(typeof scenario[key]==='string'&&PREFIXED_SHA256.test(scenario[key]),`scenario.${key} must be a lowercase sha256: value`);
  expect(typeof scenario.attachmentObjectVersionId==='string'&&scenario.attachmentObjectVersionId.trim()===scenario.attachmentObjectVersionId&&scenario.attachmentObjectVersionId.length>=1&&scenario.attachmentObjectVersionId.length<=512&&!scenario.attachmentObjectVersionId.startsWith('pending:'),'scenario.attachmentObjectVersionId must be an immutable object version');
  expect(typeof scenario.attachmentSha256==='string'&&SHA256.test(scenario.attachmentSha256),'scenario.attachmentSha256 must be a lowercase SHA-256 hex value');
  expect(/^\d{4}-\d{2}-\d{2}$/.test(String(scenario.asOf)),'scenario.asOf must be YYYY-MM-DD');
  expect(scenario.expected&&typeof scenario.expected==='object'&&!Array.isArray(scenario.expected),'scenario.expected must be an object');
  for(const key of ['debitAccountCode','creditAccountCode'])expect(/^[A-Za-z0-9._-]{1,64}$/.test(String(scenario.expected[key]||'')),`scenario.expected.${key} must be an account code`);
  expect(scenario.expected.debitAccountCode!==scenario.expected.creditAccountCode,'scenario expected debit and credit accounts must differ');
  const releaseSha=String(environment.REFS_RELEASE_SHA||'').trim().toLowerCase();
  expect(GIT_SHA.test(releaseSha),'REFS_RELEASE_SHA must be a full 40-character Git SHA');
  return Object.freeze({apiBaseUrl:httpsOrigin(environment.REFS_STAGING_API_BASE_URL,'REFS_STAGING_API_BASE_URL'),webOrigin:httpsOrigin(environment.REFS_STAGING_WEB_ORIGIN,'REFS_STAGING_WEB_ORIGIN'),releaseSha,accessToken:bearer(environment.REFS_STAGE1_E2E_READ_ACCESS_TOKEN,'REFS_STAGE1_E2E_READ_ACCESS_TOKEN'),scenario:Object.freeze({...scenario,expected:Object.freeze({...scenario.expected})})});
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

async function getEnvelope(fetcher,url,token,label){
  const response=await fetcher(url,{method:'GET',redirect:'error',cache:'no-store',headers:{accept:'application/json',authorization:`Bearer ${token}`}});
  expect(response.status===200,`${label} returned HTTP ${response.status}`);
  expect(String(response.headers.get('cache-control')||'').toLowerCase().includes('no-store'),`${label} must be no-store`);
  const body=await response.json();expect(body?.ok===true&&Array.isArray(body.data)&&body.scope&&typeof body.scope==='object',`${label} returned an invalid authoritative envelope`);
  return body;
}

const sameRelease=(value,expected)=>typeof value==='string'&&/^[0-9a-f]{40}$/i.test(value)&&value.toLowerCase()===expected;

// Parse the two statements emitted by build.mjs and runtime-config-lib.mjs.
// Never execute JavaScript received from a deployment to inspect its metadata.
export function parseStage1BuildStamp(buildText){
  const matched=buildText.match(/^\s*window\.__BUILD\s*=\s*(\{[^\n;]+\})\s*;([\s\S]*)$/);
  expect(matched,'authoritative web build stamp is missing window.__BUILD');
  let metadata;try{metadata=JSON.parse(matched[1]);}catch{throw new Error('stage1-authoritative-e2e: authoritative web build stamp is invalid JSON');}
  const suffix=matched[2].replace(/^\s*\/\/[^\r\n]*(?:\r?\n|$)/gm,'').trim();
  if(suffix){
    const channel=suffix.match(/^window\.__BUILD=Object\.assign\(window\.__BUILD\|\|\{\},\{channel:("(?:AUTHORITATIVE|PUBLIC_DEMONSTRATION)"),authoritative:(true|false)\}\);$/);
    expect(channel,'authoritative web build stamp has unsupported trailing content');
    metadata={...metadata,channel:JSON.parse(channel[1]),authoritative:channel[2]==='true'};
  }
  return Object.freeze(metadata);
}

async function verifyReleaseStamp({apiBaseUrl,webOrigin,releaseSha,fetcher}){
  const get=async(url,label)=>{
    const response=await fetcher(url,{method:'GET',redirect:'error',cache:'no-store',headers:{accept:'application/json'}});
    expect(response.status===200,`${label} returned HTTP ${response.status}`);
    expect(String(response.headers.get('cache-control')||'').toLowerCase().includes('no-store'),`${label} must be no-store`);
    return response;
  };
  const [live,ready,build]=await Promise.all([get(`${apiBaseUrl}/health/live`,'API liveness'),get(`${apiBaseUrl}/health/ready`,'API readiness'),get(`${webOrigin}/refs-build.js`,'authoritative web build stamp')]);
  const [liveBody,readyBody,buildText]=await Promise.all([live.json(),ready.json(),build.text()]);
  expect(liveBody?.ok===true&&liveBody.status==='live'&&sameRelease(liveBody.release,releaseSha),'API liveness release does not match REFS_RELEASE_SHA');
  expect(readyBody?.ok===true&&readyBody.status==='ready'&&sameRelease(readyBody.release,releaseSha),'API readiness release does not match REFS_RELEASE_SHA');
  const buildMetadata=parseStage1BuildStamp(buildText);
  expect(buildMetadata?.channel==='AUTHORITATIVE'&&buildMetadata?.authoritative===true,'authoritative web build stamp is not AUTHORITATIVE');
  expect(sameRelease(buildMetadata?.sha,releaseSha),'authoritative web build release does not match REFS_RELEASE_SHA');
  return Object.freeze({release:releaseSha,apiRelease:liveBody.release,webRelease:buildMetadata.sha});
}

async function readCompleteLedgerSnapshot({fetcher,base,token,periodId}){
  const rows=[],seenLedgerLineIds=new Set();let offset=0,snapshotToken=null,totalCount=null;
  do{
    const query=new URLSearchParams({periodId,limit:'200',offset:String(offset)});if(snapshotToken)query.set('snapshotToken',snapshotToken);
    const page=await getJson(fetcher,`${base}/general-ledger/snapshot-entries?${query}`,token,'General Ledger snapshot');
    expect(page?.schema_version==='GENERAL_LEDGER_SNAPSHOT_PAGE_V1'&&page.scope?.period_id===periodId,'General Ledger snapshot scope is invalid');
    expect(Array.isArray(page.rows)&&page.limit===200&&page.read_count===page.rows.length&&page.rows.length<=page.limit&&Number.isSafeInteger(page.total_count)&&page.total_count>=0&&page.total_count<=100000,'General Ledger snapshot population is invalid');
    if(snapshotToken===null){snapshotToken=page.snapshot_token;totalCount=page.total_count;expect(PREFIXED_SHA256.test(snapshotToken||''),'General Ledger snapshot token is invalid');}
    expect(page.snapshot_token===snapshotToken&&page.population_hash===snapshotToken&&page.total_count===totalCount&&page.offset===offset,'General Ledger snapshot changed between pages');
    for(const row of page.rows){
      expect(UUID.test(row?.ledger_line_id||''),'General Ledger snapshot row identity is invalid');
      expect(!seenLedgerLineIds.has(row.ledger_line_id),'General Ledger snapshot repeated a ledger line across pages');
      seenLedgerLineIds.add(row.ledger_line_id);
    }
    rows.push(...page.rows);expect(rows.length<=totalCount,'General Ledger snapshot returned excess rows');
    if(page.population_complete){expect(rows.length===totalCount,'General Ledger snapshot ended before the complete population');break;}
    expect(page.rows.length>0,'General Ledger snapshot made no paging progress');offset+=page.rows.length;
  }while(true);
  return rows;
}

async function readCompleteAgingDetail({fetcher,base,token,scenario,business}){
  const rows=[],seenBusinessDocumentIds=new Set();let offset=0,snapshotHash=null,totalCount=null;
  do{
    const query=new URLSearchParams({periodId:scenario.periodId,asOf:scenario.asOf,counterpartyRef:business.counterparty_ref,counterpartyName:business.counterparty_name,currency:business.currency,limit:'200',offset:String(offset)});
    const page=await getEnvelope(fetcher,`${base}/ap/aging-detail?${query}`,token,'AP aging detail'),scope=page.scope;
    expect(scope.entity_id===scenario.entityId&&scope.period_id===scenario.periodId&&scope.document_kind==='AP_BILL'&&scope.as_of_date===scenario.asOf,'AP Aging snapshot scope does not match the scenario');
    expect(scope.counterparty_ref===business.counterparty_ref&&scope.counterparty_name===business.counterparty_name&&scope.currency===business.currency&&scope.snapshot_version===1,'AP Aging counterparty scope does not match the Bill');
    expect(PREFIXED_SHA256.test(scope.snapshot_hash||'')&&scope.limit===200&&page.data.length<=scope.limit&&Number.isSafeInteger(scope.total_count)&&scope.total_count>=0&&scope.total_count<=1000000&&scope.offset===offset,'AP Aging snapshot metadata is invalid');
    if(snapshotHash===null){snapshotHash=scope.snapshot_hash;totalCount=scope.total_count;}
    expect(scope.snapshot_hash===snapshotHash&&scope.total_count===totalCount,'AP Aging snapshot changed between pages');
    for(const row of page.data){
      expect(UUID.test(row?.business_document_id||''),'AP Aging row identity is invalid');
      expect(!seenBusinessDocumentIds.has(row.business_document_id),'AP Aging repeated a business document across pages');
      seenBusinessDocumentIds.add(row.business_document_id);
    }
    rows.push(...page.data);expect(rows.length<=totalCount,'AP Aging returned excess rows');
    if(rows.length===totalCount)break;
    expect(page.data.length>0,'AP Aging made no paging progress');offset+=page.data.length;
  }while(true);
  return rows;
}

function verifyEvidence(evidence,scenario){
  expect(evidence?.schema_version==='WBS_PAYABLE_ACCEPTANCE_EVIDENCE_V1','acceptance evidence schema is invalid');
  expect(evidence.scope?.tenant_id===scenario.tenantId&&evidence.scope?.entity_id===scenario.entityId&&evidence.scope?.period_id===scenario.periodId,'acceptance evidence scope does not match the scenario');
  const source=evidence.source||{};
  for(const [key,expected] of [['wbs_inbound_row_id',scenario.wbsInboundRowId],['source_record_id',scenario.sourceRecordId],['source_version',scenario.sourceVersion],['receipt_hash',scenario.receiptHash],['provider_receipt_hash',scenario.providerReceiptHash],['evidence_hash',scenario.evidenceHash]])expect(source[key]===expected,`acceptance source ${key} does not match the scenario`);
  expect(source.environment==='PRODUCTION'&&source.source_module==='BGDATA.payable'&&source.ingestion_kind==='TRANSACTION_CANDIDATE','acceptance source is not a signed production WBS Payable');
  expect(source.provider_signed_payable_admission_id===scenario.providerSignedAdmissionId&&source.signature_algorithm==='Ed25519'&&source.signed_package_hash===scenario.signedPackageHash&&source.signed_receipt_hash===scenario.signedReceiptHash&&source.signed_at,'acceptance source is not linked to the exact retained Ed25519 admission');
  expect(evidence.review?.review_evidence_id===scenario.reviewEvidenceId,'acceptance review does not match the scenario');
  expect(Array.isArray(evidence.attachments)&&evidence.attachments.length===1,'acceptance evidence must contain exactly one bound attachment');
  const attachment=evidence.attachments[0];
  expect(attachment?.attachment_id===scenario.attachmentId&&attachment.content_hash===`sha256:${scenario.attachmentSha256}`&&attachment.storage_version===scenario.attachmentObjectVersionId,'acceptance attachment version or hash does not match the scenario');
  expect(attachment.finalization_status==='VERIFIED_CLEAN'&&attachment.scan_status==='CLEAN'&&attachment.verified_at&&attachment.bound_by,'acceptance attachment is not retained verified-clean evidence');
  expect(carries(evidence.review?.attachment_ids,scenario.attachmentId),'acceptance review does not carry the bound attachment');
  expect(evidence.draft?.journal_entry_id===scenario.journalEntryId&&evidence.business_document?.business_document_id===evidence.draft?.business_document_id,'acceptance Draft does not bind one business document and journal');
  expect(evidence.business_document?.source_document_id===source.source_document_id&&evidence.business_document?.posted_journal_entry_id===scenario.journalEntryId,'acceptance business document lineage is incomplete');
  expect(evidence.business_document?.document_kind==='AP_BILL','acceptance business document is not an AP Bill');
  const journal=evidence.journal||{};
  expect(journal.journal_entry_id===scenario.journalEntryId&&journal.status==='POSTED','acceptance journal is not the scenario POSTED journal');
  expect(evidence.draft?.created_by===journal.created_by,'Draft maker does not match the journal maker');
  const actors=[journal.created_by,journal.reviewed_by,journal.approved_by,journal.posted_by];
  expect(actors.every(value=>typeof value==='string'&&value.length>0)&&new Set(actors).size===4,'Maker, Reviewer, Approver and Poster must be four distinct retained actors');
  expect(evidence.review?.reviewed_by!==journal.created_by,'WBS reviewer and Draft maker must be different actors');
  return {sourceDocumentId:source.source_document_id,business:evidence.business_document,gross:exactMoney(evidence.business_document?.gross_amount,'acceptance gross_amount')};
}

export async function verifyStage1AuthoritativeE2e({config,fetcher=globalThis.fetch}={}){
  expect(config&&typeof config==='object','config is required');expect(typeof fetcher==='function','a fetch implementation is required');
  const {apiBaseUrl,webOrigin,releaseSha,accessToken,scenario}=config;
  const release=await verifyReleaseStamp({apiBaseUrl,webOrigin,releaseSha,fetcher});
  const base=`${apiBaseUrl}/api/v1/entities/${scenario.entityId}`;
  const evidence=await getJson(fetcher,`${base}/wbs/inbound/payables/reviews/${scenario.reviewEvidenceId}/acceptance-evidence`,accessToken,'WBS Payable acceptance evidence');
  const {sourceDocumentId,business,gross}=verifyEvidence(evidence,scenario);
  const [journal,ledger,aging,statements]=await Promise.all([
    getJson(fetcher,`${base}/journal-entries/${scenario.journalEntryId}?periodId=${encodeURIComponent(scenario.periodId)}`,accessToken,'journal detail'),
    readCompleteLedgerSnapshot({fetcher,base,token:accessToken,periodId:scenario.periodId}),
    readCompleteAgingDetail({fetcher,base,token:accessToken,scenario,business}),
    getJson(fetcher,`${base}/reports/financial-statements?periodId=${encodeURIComponent(scenario.periodId)}`,accessToken,'financial statements'),
  ]);
  expect(journal?.journal_entry_id===scenario.journalEntryId&&journal?.status==='POSTED','journal detail does not match the scenario POSTED journal');
  const journalLines=journal?.lines||[],ledgerLines=(ledger||[]).filter(row=>row.journal_entry_id===scenario.journalEntryId);
  for(const [side,account] of [['debit',scenario.expected.debitAccountCode],['credit',scenario.expected.creditAccountCode]]){
    const debit=side==='debit'?gross:'0.0000',credit=side==='credit'?gross:'0.0000';
    expect(journalLines.some(row=>row.account_code===account&&row.debit_amount===debit&&row.credit_amount===credit&&carries(row.source_document_ids,sourceDocumentId)),`posted journal lacks the exact ${side} line and source lineage`);
    expect(ledgerLines.some(row=>row.account_code===account&&row.debit_amount===debit&&row.credit_amount===credit&&carries(row.source_document_ids,sourceDocumentId)),`General Ledger lacks the exact ${side} line and source lineage`);
    expect((statements||[]).some(row=>row.statement_type==='TRIAL_BALANCE'&&row.account_code===account&&carries(row.journal_entry_ids,scenario.journalEntryId)&&carries(row.source_document_ids,sourceDocumentId)),`Trial Balance lacks the exact ${side} account, journal and source lineage`);
  }
  expect(Array.isArray(aging)&&aging.some(row=>row.business_document_id===business.business_document_id&&row.source_document_id===sourceDocumentId&&row.source_payload_hash===scenario.receiptHash&&row.posted_journal_entry_id===scenario.journalEntryId&&row.gross_amount===gross&&row.open_balance===gross),'AP Aging lacks the exact open Bill, source hash, amount and posted journal');
  return Object.freeze({ok:true,mode:'READ_ONLY_RETAINED_EVIDENCE',release,checks:['same-release-stamps','signed-wbs-payable-binding','four-role-sod','posted-journal','immutable-general-ledger','exact-ap-aging-detail','trial-balance-lineage'],journalEntryId:scenario.journalEntryId});
}

if(process.argv[1]&&fileURLToPath(import.meta.url)===resolve(process.argv[1])){
  try{const scenario=await readStage1Scenario();const result=await verifyStage1AuthoritativeE2e({config:stage1AuthoritativeE2eConfig(process.env,scenario)});console.log(JSON.stringify(result));}
  catch(error){console.error(error.message);process.exitCode=1;}
}
