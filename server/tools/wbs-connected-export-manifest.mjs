#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { createReadStream, readdirSync, statSync, writeFileSync } from 'node:fs';
import { basename, resolve } from 'node:path';

const root=resolve(process.argv[2]||'server/outputs/wbs-h1-2026');
const files=[];
for(const name of readdirSync(root).filter(value=>value.endsWith('.ndjson')).sort()){
  const path=resolve(root,name),hash=createHash('sha256');let rows=0,last=10;
  for await(const chunk of createReadStream(path)){hash.update(chunk);for(const byte of chunk)if(byte===10)rows++;last=chunk.at(-1);}
  if(statSync(path).size>0&&last!==10)throw new Error(`${name} does not end at a row boundary`);
  const [domain,company_code,period]=basename(name,'.ndjson').split('__');
  files.push({domain,company_code:company_code==='all'?null:company_code,period:period==='all'?null:period,path,rows,bytes:statSync(path).size,sha256:hash.digest('hex')});
}
const manifest={schema_version:'WBS_H1_2026_LOCAL_SNAPSHOT_V1',date_from:'2026-01-01',date_to:'2026-06-30',generated_at:new Date().toISOString(),files,total_rows:files.reduce((sum,file)=>sum+file.rows,0),total_bytes:files.reduce((sum,file)=>sum+file.bytes,0)};
const target=resolve(root,'manifest.json');
writeFileSync(target,`${JSON.stringify(manifest,null,2)}\n`,{encoding:'utf8',flag:'wx',mode:0o600});
process.stdout.write(`${JSON.stringify({status:'COMPLETE',manifest:target,total_rows:manifest.total_rows,total_bytes:manifest.total_bytes,file_count:files.length})}\n`);
