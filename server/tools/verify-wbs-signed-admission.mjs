#!/usr/bin/env node
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {captureWbsSignedDelivery,WbsSignedDeliveryAdmissionError} from '../runtime/wbs-signed-delivery-admission.mjs';

const args=values=>Object.fromEntries(values.reduce((all,value,index)=>value.startsWith('--')?all.concat([[value.slice(2),values[index+1]]]):all,[]));
export async function main(argv=process.argv.slice(2)){
  const options=args(argv),required=['provider-trust','receipt','request-raw','response-raw','package-raw','tenant-id','entity-id','company-code','capture-dir'];
  if(required.some(key=>!options[key]))throw new WbsSignedDeliveryAdmissionError('WBS_SIGNED_DELIVERY_ARGUMENT_REQUIRED',required.join(','));
  const result=await captureWbsSignedDelivery({providerTrust:JSON.parse(readFileSync(resolve(options['provider-trust']),'utf8')),receipt:JSON.parse(readFileSync(resolve(options.receipt),'utf8')),requestRaw:readFileSync(resolve(options['request-raw'])),responseRaw:readFileSync(resolve(options['response-raw'])),packageRaw:readFileSync(resolve(options['package-raw'])),expectedScope:{tenant_id:options['tenant-id'],entity_id:options['entity-id'],company_code:options['company-code']},captureDirectory:resolve(options['capture-dir'])});
  console.log(`wbs-signed-admission: ${result.status} admission_id=${result.admission_id}`);
  return 0;
}
if(process.argv[1]&&fileURLToPath(import.meta.url)===resolve(process.argv[1]))main().catch(error=>{console.error(error instanceof WbsSignedDeliveryAdmissionError?error.code:'WBS_SIGNED_DELIVERY_VERIFY_FAILED');process.exitCode=2;});
