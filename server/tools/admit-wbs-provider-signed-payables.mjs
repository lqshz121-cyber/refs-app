#!/usr/bin/env node
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {admitWbsProviderSignedPayableDelivery,WbsProviderSignedAdmissionClientError} from '../runtime/wbs-provider-signed-admission-client.mjs';

const args=values=>Object.fromEntries(values.reduce((all,value,index)=>value.startsWith('--')?all.concat([[value.slice(2),values[index+1]]]):all,[]));
export async function main(argv=process.argv.slice(2),env=process.env){
  const options=args(argv),required=['api-base-url','provider-trust','receipt','request-raw','response-raw','package-raw','tenant-id','entity-id','company-code'];
  if(required.some(key=>!options[key]))throw new WbsProviderSignedAdmissionClientError('WBS_PROVIDER_ARGUMENT_REQUIRED',required.join(','));
  const result=await admitWbsProviderSignedPayableDelivery({apiBaseUrl:options['api-base-url'],admissionAccessToken:env.REFS_PROVIDER_M2M_ACCESS_TOKEN,reviewAccessToken:env.REFS_PAYABLE_REVIEW_ACCESS_TOKEN||null,providerTrust:JSON.parse(readFileSync(resolve(options['provider-trust']),'utf8')),receipt:JSON.parse(readFileSync(resolve(options.receipt),'utf8')),requestRaw:readFileSync(resolve(options['request-raw'])),responseRaw:readFileSync(resolve(options['response-raw'])),packageRaw:readFileSync(resolve(options['package-raw'])),tenantId:options['tenant-id'],entityId:options['entity-id'],companyCode:options['company-code'],idempotencyKey:options['idempotency-key']||null,timeoutMs:options['timeout-ms']?Number(options['timeout-ms']):30000});
  console.log(JSON.stringify(result,null,2));
  return 0;
}
if(process.argv[1]&&fileURLToPath(import.meta.url)===resolve(process.argv[1]))main().catch(error=>{const code=typeof error?.code==='string'&&error.code.startsWith('WBS_')?error.code:'WBS_PROVIDER_SIGNED_ADMISSION_FAILED';console.error(`${code}${error instanceof WbsProviderSignedAdmissionClientError&&error.status?` HTTP_${error.status}`:''}`);process.exitCode=2;});
