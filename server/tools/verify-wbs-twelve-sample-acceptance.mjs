#!/usr/bin/env node
import {existsSync,readFileSync} from 'node:fs';
import {pathToFileURL} from 'node:url';
import {verifyWbsTwelveSampleAcceptance} from '../runtime/wbs-twelve-sample-acceptance.mjs';

const fail=code=>{const error=new Error(code);error.code=code;throw error;};

export function verifyWbsTwelveSampleAcceptanceFile(argv=process.argv.slice(2)){
  if(argv.length!==2||argv[0]!=='--manifest'||!argv[1])fail('WBS_TWELVE_SAMPLE_ARGUMENT_INVALID');
  if(!existsSync(argv[1]))fail('WBS_TWELVE_SAMPLE_MANIFEST_MISSING');
  let manifest;try{manifest=JSON.parse(readFileSync(argv[1],'utf8'));}catch{fail('WBS_TWELVE_SAMPLE_MANIFEST_INVALID');}
  return verifyWbsTwelveSampleAcceptance(manifest);
}

export function main(argv=process.argv.slice(2)){
  try{const result=verifyWbsTwelveSampleAcceptanceFile(argv);console.log(`wbs-twelve-sample-acceptance: PASS samples=${result.sample_count} release=${result.release_sha} manifest_hash=${result.manifest_hash}`);return 0;}
  catch(error){console.error(`${error?.code||'WBS_TWELVE_SAMPLE_ACCEPTANCE_FAILED'}: evidence verification failed`);return 1;}
}

if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)process.exitCode=main();
