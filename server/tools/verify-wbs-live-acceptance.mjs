#!/usr/bin/env node
// Read-only acceptance verifier for evidence supplied after a real WBS run.
// It never opens a network connection and never connects to an accounting DB.
//
// node tools/verify-wbs-live-acceptance.mjs --provider-trust <json> --receipt <json> \
//   --request-raw <bytes> --response-raw <bytes> --package-raw <bytes> \
//   --ingress <json> --g11 <json> --gl-report <json>
//
// Provider trust is a separately managed pinned configuration, not evidence
// supplied by the run. A PASS verifies that the supplied evidence is bound to
// that pin; it never creates, approves, or posts anything.

import {existsSync,readFileSync} from 'node:fs';
import {createHash,createPublicKey,verify} from 'node:crypto';
import {pathToFileURL} from 'node:url';
import {validateWbsAutoRecG11PostedTrace} from '../runtime/wbs-inbound-data-adapter.mjs';
import {canonicalWbsLiveReceiptSigningPayload} from '../runtime/wbs-live-receipt-signing.mjs';

const HASH=/^sha256:[0-9a-f]{64}$/;
const KEY_ID=/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const MONEY4=/^-?(?:0|[1-9]\d*)(?:\.\d{1,4})?$/;
const text=value=>value==null?'':String(value).trim();
const fail=code=>{const error=new Error(code);error.code=code;throw error;};
const required=(value,fields,code)=>{if(!value||typeof value!=='object'||Array.isArray(value)||fields.some(field=>!text(value[field])))fail(code);};

function money4(value,code){
  if(typeof value!=='string'||!MONEY4.test(value))fail(code);
  const negative=value.startsWith('-');
  const [whole,fraction='']=value.replace(/^-/, '').split('.');
  const scaled=BigInt(whole)*10000n+BigInt(fraction.padEnd(4,'0'));
  return negative?-scaled:scaled;
}

function readJson(path,label){
  if(!text(path))fail(`WBS_LIVE_ACCEPTANCE_${label}_PATH_REQUIRED`);
  if(!existsSync(path))fail(`WBS_LIVE_ACCEPTANCE_${label}_MISSING`);
  try{return JSON.parse(readFileSync(path,'utf8'));}catch{fail(`WBS_LIVE_ACCEPTANCE_${label}_INVALID`);}
}

function readRaw(path,label){
  if(!text(path))fail(`WBS_LIVE_ACCEPTANCE_${label}_PATH_REQUIRED`);
  if(!existsSync(path))fail(`WBS_LIVE_ACCEPTANCE_${label}_MISSING`);
  try{return readFileSync(path);}catch{fail(`WBS_LIVE_ACCEPTANCE_${label}_INVALID`);}
}

export function normalizePinnedProviderTrust(value){
  required(value,['issuer','key_id','public_key'],'WBS_LIVE_ACCEPTANCE_PROVIDER_TRUST_INVALID');
  if(!KEY_ID.test(text(value.key_id))||typeof value.public_key!=='string'||value.public_key.trim().length<64)fail('WBS_LIVE_ACCEPTANCE_PROVIDER_TRUST_INVALID');
  let publicKey;
  try{publicKey=createPublicKey(value.public_key.replace(/\\n/g,'\n'));}catch{fail('WBS_LIVE_ACCEPTANCE_PROVIDER_TRUST_INVALID');}
  if(publicKey.asymmetricKeyType!=='ed25519')fail('WBS_LIVE_ACCEPTANCE_PROVIDER_TRUST_INVALID');
  return Object.freeze({issuer:text(value.issuer),key_id:text(value.key_id),publicKey});
}

const sha256=value=>`sha256:${createHash('sha256').update(value).digest('hex')}`;

export function verifySignedReceipt({receipt,providerTrust,raw}){
  required(receipt,['issuer','kid','algorithm','response_sha256','request_sha256','package_hash','nonce','signed_at','expires_at','tenant_id','entity_id','company_code','immutable_version'],'WBS_LIVE_ACCEPTANCE_RECEIPT_INCOMPLETE');
  if(receipt.nonempty!==true||receipt.algorithm!=='Ed25519'||!HASH.test(text(receipt.package_hash))||!HASH.test(text(receipt.request_sha256))||!HASH.test(text(receipt.response_sha256)))fail('WBS_LIVE_ACCEPTANCE_RECEIPT_INCOMPLETE');
  if(!raw||!Buffer.isBuffer(raw.request)||!Buffer.isBuffer(raw.response)||!Buffer.isBuffer(raw.package))fail('WBS_LIVE_ACCEPTANCE_RAW_EVIDENCE_REQUIRED');
  if(sha256(raw.request)!==text(receipt.request_sha256)||sha256(raw.response)!==text(receipt.response_sha256)||sha256(raw.package)!==text(receipt.package_hash))fail('WBS_LIVE_ACCEPTANCE_RAW_HASH_MISMATCH');
  if(text(receipt.issuer)!==providerTrust.issuer)fail('WBS_LIVE_ACCEPTANCE_RECEIPT_ISSUER_MISMATCH');
  if(text(receipt.kid)!==providerTrust.key_id)fail('WBS_LIVE_ACCEPTANCE_RECEIPT_KEY_ID_MISMATCH');
  const signature=receipt.detached_signature;
  if(!signature||text(signature.key_id)!==text(receipt.kid)||signature.algorithm!=='Ed25519'||typeof signature.value!=='string'||!signature.value.trim())fail('WBS_LIVE_ACCEPTANCE_RECEIPT_SIGNATURE_MISSING');
  try{if(!verify(null,Buffer.from(canonicalWbsLiveReceiptSigningPayload(receipt),'utf8'),providerTrust.publicKey,Buffer.from(signature.value,'base64')))fail('WBS_LIVE_ACCEPTANCE_RECEIPT_SIGNATURE_INVALID');}
  catch(error){if(error?.code)throw error;fail('WBS_LIVE_ACCEPTANCE_RECEIPT_SIGNATURE_INVALID');}
  return Object.freeze({tenant_id:text(receipt.tenant_id),entity_id:text(receipt.entity_id),company_code:text(receipt.company_code),package_hash:text(receipt.package_hash)});
}

function sameScope(value,scope,code){
  required(value,['tenant_id','entity_id','company_code','package_hash'],code);
  if(text(value.tenant_id)!==scope.tenant_id||text(value.entity_id)!==scope.entity_id||text(value.company_code)!==scope.company_code||text(value.package_hash)!==scope.package_hash)fail(code);
}

export function verifyIngressEvidence({ingress,scope}){
  sameScope(ingress,scope,'WBS_LIVE_ACCEPTANCE_INGRESS_SCOPE_MISMATCH');
  if(ingress.status!=='PERSISTED_STAGING_REVIEW_REQUIRED'||ingress.can_dispatch_draft!==false||ingress.can_dispatch_autorec!==false||ingress.can_post!==false)fail('WBS_LIVE_ACCEPTANCE_INGRESS_STATUS_INVALID');
  const trace=ingress.trace;
  if(!trace||!text(trace.import_batch_id)||!Array.isArray(trace.trace_rows)||trace.trace_rows.length===0)fail('WBS_LIVE_ACCEPTANCE_INGRESS_TRACE_REQUIRED');
  for(const row of trace.trace_rows){
    required(row,['receipt_id','raw_event_id','source_document_id','staging_item_id','source_record_id','source_version','receipt_hash'],'WBS_LIVE_ACCEPTANCE_INGRESS_TRACE_REQUIRED');
    if(!HASH.test(text(row.receipt_hash)))fail('WBS_LIVE_ACCEPTANCE_INGRESS_TRACE_REQUIRED');
  }
  const reviews=ingress.staging_reviews;
  if(!Array.isArray(reviews)||reviews.length===0||reviews.length!==trace.trace_rows.length)fail('WBS_LIVE_ACCEPTANCE_STAGING_REVIEW_REQUIRED');
  const stagingIds=new Set(trace.trace_rows.map(row=>text(row.staging_item_id)));
  const reviewed=new Set();
  for(const review of reviews){
    required(review,['staging_item_id','review_event_id','reviewed_by','reviewed_at'],'WBS_LIVE_ACCEPTANCE_STAGING_REVIEW_REQUIRED');
    if(review.status!=='REVIEWED'||!stagingIds.has(text(review.staging_item_id))||reviewed.has(text(review.staging_item_id)))fail('WBS_LIVE_ACCEPTANCE_STAGING_REVIEW_REQUIRED');
    reviewed.add(text(review.staging_item_id));
  }
  if(reviewed.size!==stagingIds.size)fail('WBS_LIVE_ACCEPTANCE_STAGING_REVIEW_REQUIRED');
  return Object.freeze({import_batch_id:text(trace.import_batch_id),row_count:trace.trace_rows.length});
}

export function verifyG11Evidence({g11,scope}){
  sameScope(g11,scope,'WBS_LIVE_ACCEPTANCE_G11_SCOPE_MISMATCH');
  if(!g11||typeof g11!=='object'||!g11.review_request||!Array.isArray(g11.posted_journals))fail('WBS_LIVE_ACCEPTANCE_G11_EVIDENCE_REQUIRED');
  let result;try{result=validateWbsAutoRecG11PostedTrace({reviewRequest:g11.review_request,postedJournals:g11.posted_journals});}catch{fail('WBS_LIVE_ACCEPTANCE_G11_INVALID');}
  if(result.status!=='POSTED_TRACE_VERIFIED'||text(g11.review_request.trace?.company_key)!==scope.company_code)fail('WBS_LIVE_ACCEPTANCE_G11_INVALID');
  return Object.freeze({journal_ids:new Set(g11.posted_journals.map(row=>text(row.journal_entry_id))),ledger_line_count:g11.posted_journals.reduce((sum,row)=>sum+row.ledger_lines.length,0)});
}

export function verifyGlReportEvidence({glReport,scope,g11}){
  sameScope(glReport,scope,'WBS_LIVE_ACCEPTANCE_GL_REPORT_SCOPE_MISMATCH');
  const gl=glReport.gl,report=glReport.report;
  required(gl,['status','currency'],'WBS_LIVE_ACCEPTANCE_GL_REPORT_REQUIRED');
  required(report,['status','report_id','currency'],'WBS_LIVE_ACCEPTANCE_GL_REPORT_REQUIRED');
  if(gl.status!=='POSTED'||report.status!=='FINAL'||text(gl.currency)!==text(report.currency)||!Array.isArray(gl.journal_entry_ids)||gl.journal_entry_ids.length!==2||!Array.isArray(report.journal_entry_ids)||report.journal_entry_ids.length!==2)fail('WBS_LIVE_ACCEPTANCE_GL_REPORT_REQUIRED');
  const glIds=new Set(gl.journal_entry_ids.map(text)),reportIds=new Set(report.journal_entry_ids.map(text));
  if(glIds.size!==2||reportIds.size!==2||[...g11.journal_ids].some(id=>!glIds.has(id)||!reportIds.has(id)))fail('WBS_LIVE_ACCEPTANCE_GL_REPORT_TIE_FAILED');
  const totals=glReport.tie;
  required(totals,['gl_debits','gl_credits','report_debits','report_credits','ap_291001_net'],'WBS_LIVE_ACCEPTANCE_GL_REPORT_TIE_FAILED');
  const amounts=Object.fromEntries(Object.entries(totals).map(([key,value])=>[key,money4(value,'WBS_LIVE_ACCEPTANCE_GL_REPORT_TIE_FAILED')]));
  if(amounts.gl_debits!==amounts.gl_credits||amounts.report_debits!==amounts.report_credits||amounts.gl_debits!==amounts.report_debits||amounts.gl_credits!==amounts.report_credits||amounts.ap_291001_net!==0n)fail('WBS_LIVE_ACCEPTANCE_GL_REPORT_TIE_FAILED');
  return Object.freeze({report_id:text(report.report_id),currency:text(gl.currency)});
}

export function verifyWbsLiveAcceptance({providerTrust,receipt,raw,ingress,g11,glReport}){
  const scope=verifySignedReceipt({receipt,providerTrust:normalizePinnedProviderTrust(providerTrust),raw});
  const ingressResult=verifyIngressEvidence({ingress,scope});
  const g11Result=verifyG11Evidence({g11,scope});
  const reportResult=verifyGlReportEvidence({glReport,scope,g11:g11Result});
  return Object.freeze({ok:true,status:'WBS_LIVE_ACCEPTANCE_EVIDENCE_VERIFIED',import_batch_id:ingressResult.import_batch_id,ingress_rows:ingressResult.row_count,posted_journal_count:g11Result.journal_ids.size,report_id:reportResult.report_id,currency:reportResult.currency});
}

function argumentsFrom(argv){
  const names=new Set(['provider-trust','receipt','request-raw','response-raw','package-raw','ingress','g11','gl-report']);const out={};
  for(let index=0;index<argv.length;index+=2){const flag=argv[index]?.replace(/^--/,'');if(!names.has(flag)||!argv[index+1]||out[flag])fail('WBS_LIVE_ACCEPTANCE_ARGUMENT_INVALID');out[flag]=argv[index+1];}
  if(Object.keys(out).length!==names.size)fail('WBS_LIVE_ACCEPTANCE_ARGUMENT_INVALID');
  return out;
}

export function main(argv=process.argv.slice(2)){
  try{const args=argumentsFrom(argv);const raw={request:readRaw(args['request-raw'],'REQUEST_RAW'),response:readRaw(args['response-raw'],'RESPONSE_RAW'),package:readRaw(args['package-raw'],'PACKAGE_RAW')};const result=verifyWbsLiveAcceptance({providerTrust:readJson(args['provider-trust'],'PROVIDER_TRUST'),receipt:readJson(args.receipt,'RECEIPT'),raw,ingress:readJson(args.ingress,'INGRESS'),g11:readJson(args.g11,'G11'),glReport:readJson(args['gl-report'],'GL_REPORT')});console.log(`wbs-live-acceptance: PASS ingress_rows=${result.ingress_rows} posted_journals=${result.posted_journal_count}`);return 0;}
  catch(error){console.error(`${error?.code||'WBS_LIVE_ACCEPTANCE_FAILED'}: evidence verification failed`);return 1;}
}

if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)process.exitCode=main();
