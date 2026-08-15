#!/usr/bin/env node
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {verifyWbsProviderFinal1Delivery} from '../runtime/wbs-provider-final1-delivery.mjs';
import {WbsSignedDeliveryAdmissionError} from '../runtime/wbs-signed-delivery-admission.mjs';

const parse=values=>Object.fromEntries(values.reduce((out,value,index)=>value.startsWith('--')?[...out,[value.slice(2),values[index+1]]]:out,[]));

export function main(argv=process.argv.slice(2)){
  const options=parse(argv),required=['provider-trust','receipt','request-raw','response-raw','package-raw','tenant-id','entity-id','company-code','expected-currency'];
  if(required.some(key=>!options[key]))throw new WbsSignedDeliveryAdmissionError('WBS_FINAL1_ARGUMENT_REQUIRED',required.join(','));
  const receipt=JSON.parse(readFileSync(resolve(options.receipt),'utf8'));
  const archiveOnly=options['archive-only']==='YES';
  const now=archiveOnly?Date.parse(receipt.signed_at)+1:Date.now();
  const result=verifyWbsProviderFinal1Delivery({
    providerTrust:JSON.parse(readFileSync(resolve(options['provider-trust']),'utf8')),receipt,
    requestRaw:readFileSync(resolve(options['request-raw'])),responseRaw:readFileSync(resolve(options['response-raw'])),packageRaw:readFileSync(resolve(options['package-raw'])),
    expectedScope:{tenant_id:options['tenant-id'],entity_id:options['entity-id'],company_code:options['company-code']},expectedCurrency:options['expected-currency'],now
  });
  console.log(JSON.stringify({status:archiveOnly?'VERIFIED_ARCHIVED_FINAL1_EVIDENCE_ONLY':result.status,signature_verified:result.signature_verified,snapshot_id:result.snapshot_id,company_code:result.company_code,date_from:result.date_from,date_to:result.date_to,row_count:result.row_count,raw_contains_credentials:result.raw_contains_credentials,currency_signed:result.currency_signed,accounting_currency:result.accounting_currency,currency_authority:result.currency_authority,admission_blockers:result.admission_blockers,can_admit:false,can_create_draft:false,can_approve:false,can_post:false}));
  return result.admission_blockers.length===0&&!archiveOnly?0:3;
}

if(process.argv[1]&&fileURLToPath(import.meta.url)===resolve(process.argv[1])){
  try{process.exitCode=main();}catch(error){console.error(error instanceof WbsSignedDeliveryAdmissionError?error.code:'WBS_FINAL1_VERIFY_FAILED');process.exitCode=2;}
}
