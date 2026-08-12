#!/usr/bin/env node
import {readFileSync,mkdirSync,writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createWbsSignedDelivery,WbsSignedDeliveryAdmissionError,WBS_SIGNED_DELIVERY_MAX_TTL_MS} from '../runtime/wbs-signed-delivery-admission.mjs';
import {canonicalRequestBody} from '../runtime/request-hash.mjs';

const args=values=>Object.fromEntries(values.reduce((all,value,index)=>value.startsWith('--')?all.concat([[value.slice(2),values[index+1]]]):all,[]));
const write=(path,value)=>writeFileSync(path,value,{flag:'wx',mode:0o600});

export async function main(argv=process.argv.slice(2)){
  const options=args(argv),required=['snapshot','request-raw','response-raw','private-key','issuer','key-id','nonce','tenant-id','entity-id','company-code','output-dir','trust-output'];
  if(required.some(key=>!options[key]))throw new WbsSignedDeliveryAdmissionError('WBS_SIGNED_DELIVERY_ARGUMENT_REQUIRED',required.join(','));
  const signedAt=options['signed-at']||new Date().toISOString(),expiresAt=options['expires-at']||new Date(Date.parse(signedAt)+WBS_SIGNED_DELIVERY_MAX_TTL_MS).toISOString();
  const requestRaw=readFileSync(resolve(options['request-raw'])),responseRaw=readFileSync(resolve(options['response-raw']));
  const unsignedSnapshot=JSON.parse(readFileSync(resolve(options.snapshot),'utf8'));
  const created=await createWbsSignedDelivery({unsignedSnapshot,requestRaw,responseRaw,scope:{tenant_id:options['tenant-id'],entity_id:options['entity-id'],company_code:options['company-code']},issuer:options.issuer,keyId:options['key-id'],nonce:options.nonce,signedAt,expiresAt,privateKeyPem:readFileSync(resolve(options['private-key']),'utf8')});
  const output=resolve(options['output-dir']);mkdirSync(output,{recursive:false,mode:0o700});
  write(resolve(output,'request.raw'),requestRaw);write(resolve(output,'response.raw'),responseRaw);write(resolve(output,'package.json'),created.packageRaw);write(resolve(output,'receipt.json'),Buffer.from(canonicalRequestBody(created.receipt),'utf8'));
  write(resolve(options['trust-output']),Buffer.from(canonicalRequestBody(created.providerTrust),'utf8'));
  console.log('wbs-signed-delivery: CREATED provider signature bundle; REFS admission has not occurred');
  return 0;
}

if(process.argv[1]&&fileURLToPath(import.meta.url)===resolve(process.argv[1]))main().catch(error=>{console.error(error instanceof WbsSignedDeliveryAdmissionError?error.code:'WBS_SIGNED_DELIVERY_CREATE_FAILED');process.exitCode=2;});
