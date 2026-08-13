#!/usr/bin/env node
// Read-only verifier for the Stage 1 production Payable accounting chain.
// It verifies supplied evidence only; it never calls WBS, REFS, or PostgreSQL.
import {existsSync,readFileSync} from 'node:fs';
import {pathToFileURL} from 'node:url';
import {normalizePinnedProviderTrust,verifySignedReceipt} from './verify-wbs-live-acceptance.mjs';

const HASH=/^sha256:[0-9a-f]{64}$/;
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MONEY=/^-?(?:0|[1-9]\d*)(?:\.\d{1,4})?$/;
const text=value=>typeof value==='string'?value.trim():'';
const fail=code=>{const error=new Error(code);error.code=code;throw error;};
const readJson=(path,label)=>{if(!text(path)||!existsSync(path))fail(`STAGE1_PAYABLE_${label}_MISSING`);try{return JSON.parse(readFileSync(path,'utf8'));}catch{fail(`STAGE1_PAYABLE_${label}_INVALID`);}};
const readRaw=(path,label)=>{if(!text(path)||!existsSync(path))fail(`STAGE1_PAYABLE_${label}_MISSING`);return readFileSync(path);};
const amount=(value,code)=>{if(typeof value!=='string'||!MONEY.test(value))fail(code);const negative=value.startsWith('-'),[whole,fraction='']=value.replace(/^-/, '').split('.'),scaled=BigInt(whole)*10000n+BigInt(fraction.padEnd(4,'0'));return negative?-scaled:scaled;};
const scopeMatch=(value,scope,code)=>{if(!value||value.tenant_id!==scope.tenant_id||value.entity_id!==scope.entity_id||value.company_code!==scope.company_code||value.package_hash!==scope.package_hash)fail(code);};
const exactRow=(rows,account,side,expected)=>{const row=Array.isArray(rows)?rows.find(item=>item?.account_code===account):null;if(!row||amount(String(row[side]??''),'STAGE1_PAYABLE_TB_INVALID')!==expected)fail('STAGE1_PAYABLE_TB_INVALID');};

export function verifyStage1PayableLiveAcceptance({providerTrust,receipt,raw,chain,now=Date.now()}={}){
  const scope=verifySignedReceipt({receipt,providerTrust:normalizePinnedProviderTrust(providerTrust),raw,now});
  scopeMatch(chain?.scope,scope,'STAGE1_PAYABLE_SCOPE_MISMATCH');
  const payable=chain.payable,attachment=chain.attachment,review=chain.review,draft=chain.draft;
  if(!payable||!UUID.test(text(payable.wbs_inbound_row_id))||!text(payable.source_record_id)||!text(payable.source_version)||!HASH.test(text(payable.receipt_hash))||!HASH.test(text(payable.evidence_hash)))fail('STAGE1_PAYABLE_SOURCE_INVALID');
  if(!attachment||attachment.wbs_inbound_row_id!==payable.wbs_inbound_row_id||attachment.source_version!==payable.source_version||attachment.receipt_hash!==payable.receipt_hash||attachment.status!=='VERIFIED_CLEAN'||!text(attachment.object_version)||!HASH.test(text(attachment.content_hash)))fail('STAGE1_PAYABLE_ATTACHMENT_INVALID');
  if(!review||review.wbs_inbound_row_id!==payable.wbs_inbound_row_id||review.expected_evidence_hash!==payable.evidence_hash||review.attachment_id!==attachment.attachment_id||review.status!=='READY_FOR_DRAFT'||!text(review.reviewer_actor_id))fail('STAGE1_PAYABLE_REVIEW_INVALID');
  if(!draft||draft.wbs_inbound_row_id!==payable.wbs_inbound_row_id||draft.review_evidence_id!==review.review_evidence_id||draft.attachment_id!==attachment.attachment_id||draft.status!=='DRAFT'||!UUID.test(text(draft.journal_entry_id))||!text(draft.maker_actor_id))fail('STAGE1_PAYABLE_DRAFT_INVALID');
  const actors=[draft.maker_actor_id,review.reviewer_actor_id];if(new Set(actors).size!==actors.length)fail('STAGE1_PAYABLE_SOD_INVALID');
  const expected=[['SUBMIT','PENDING_REVIEW','submitter_actor_id'],['REVIEW','PENDING_APPROVAL','journal_reviewer_actor_id'],['APPROVE','APPROVED','approver_actor_id'],['POST','POSTED','poster_actor_id']];
  if(!Array.isArray(chain.workflow)||chain.workflow.length!==expected.length)fail('STAGE1_PAYABLE_WORKFLOW_INVALID');
  for(let index=0;index<expected.length;index+=1){const [action,status,actorKey]=expected[index],row=chain.workflow[index];if(!row||row.journal_entry_id!==draft.journal_entry_id||row.action!==action||row.status!==status||!text(row[actorKey]))fail('STAGE1_PAYABLE_WORKFLOW_INVALID');actors.push(row[actorKey]);}
  if(new Set(actors).size!==actors.length)fail('STAGE1_PAYABLE_SOD_INVALID');
  const posted=chain.posted,expectedAmount=amount(String(draft.gross_amount??''),'STAGE1_PAYABLE_AMOUNT_INVALID');
  if(!posted||posted.journal_entry_id!==draft.journal_entry_id||posted.status!=='POSTED'||posted.source_document_id!==draft.source_document_id)fail('STAGE1_PAYABLE_POST_INVALID');
  const gl=chain.gl;if(!gl||gl.journal_entry_id!==draft.journal_entry_id||gl.source_document_id!==draft.source_document_id||amount(String(gl.debit_amount??''),'STAGE1_PAYABLE_GL_INVALID')!==expectedAmount||amount(String(gl.credit_amount??''),'STAGE1_PAYABLE_GL_INVALID')!==0n)fail('STAGE1_PAYABLE_GL_INVALID');
  exactRow(chain.trial_balance,'610000','period_debit',expectedAmount);exactRow(chain.trial_balance,'291001','period_credit',expectedAmount);
  const aging=chain.ap_aging;if(!aging||aging.currency!==draft.currency||amount(String(aging.total_open_balance??''),'STAGE1_PAYABLE_AGING_INVALID')!==expectedAmount)fail('STAGE1_PAYABLE_AGING_INVALID');
  return Object.freeze({ok:true,status:'STAGE1_PAYABLE_LIVE_ACCEPTANCE_VERIFIED',journal_entry_id:draft.journal_entry_id,currency:draft.currency,amount:draft.gross_amount});
}

function parse(argv){const names=new Set(['provider-trust','receipt','request-raw','response-raw','package-raw','chain']);const out={};for(let i=0;i<argv.length;i+=2){const key=argv[i]?.replace(/^--/,'');if(!names.has(key)||!argv[i+1]||out[key])fail('STAGE1_PAYABLE_ARGUMENT_INVALID');out[key]=argv[i+1];}if(Object.keys(out).length!==names.size)fail('STAGE1_PAYABLE_ARGUMENT_INVALID');return out;}
export function main(argv=process.argv.slice(2)){try{const args=parse(argv),result=verifyStage1PayableLiveAcceptance({providerTrust:readJson(args['provider-trust'],'PROVIDER_TRUST'),receipt:readJson(args.receipt,'RECEIPT'),raw:{request:readRaw(args['request-raw'],'REQUEST_RAW'),response:readRaw(args['response-raw'],'RESPONSE_RAW'),package:readRaw(args['package-raw'],'PACKAGE_RAW')},chain:readJson(args.chain,'CHAIN')});console.log(`stage1-payable-live-acceptance: PASS journal=${result.journal_entry_id}`);return 0;}catch(error){console.error(`${error?.code||'STAGE1_PAYABLE_VERIFY_FAILED'}: evidence verification failed`);return 1;}}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)process.exitCode=main();
