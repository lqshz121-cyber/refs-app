#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { createWriteStream, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { createInterface } from 'node:readline';
import { inflateSync } from 'node:zlib';

const root=resolve(process.argv[2]||'server/outputs/wbs-h1-2026');
mkdirSync(root,{recursive:true,mode:0o700});
const streams=new Map(), stats=new Map();
const safe=value=>String(value??'unknown').replace(/[^A-Za-z0-9_.-]/g,'_').slice(0,128);
const canonical=value=>JSON.stringify(value,Object.keys(value).sort());

function target(message){
  const key=[safe(message.domain),safe(message.company_code||'all'),safe(message.period||'all')].join('__');
  if(!streams.has(key)){
    const path=resolve(root,`${key}.ndjson`);
    streams.set(key,createWriteStream(path,{encoding:'utf8',flags:'wx',mode:0o600}));
    stats.set(key,{domain:message.domain,company_code:message.company_code||null,period:message.period||null,path,rows:0,sha256:createHash('sha256')});
  }
  return [streams.get(key),stats.get(key)];
}

const input=createInterface({input:process.stdin,crlfDelay:Infinity});
for await (const line of input){
  if(!line.trim())continue;
  const message=JSON.parse(line);
  if(message.type==='page'||message.type==='compressed_page'){
    const rows=message.type==='page'
      ?message.rows
      :JSON.parse(inflateSync(Buffer.from(message.payload,'base64').subarray(4)).toString('utf8'));
    if(!Array.isArray(rows))throw new Error('page rows must be an array');
    const [stream,stat]=target(message);
    for(const row of rows){
      const encoded=`${JSON.stringify(row)}\n`;
      if(!stream.write(encoded))await new Promise(resolveDrain=>stream.once('drain',resolveDrain));
      stat.sha256.update(encoded);stat.rows++;
    }
  }
}
await Promise.all([...streams.values()].map(stream=>new Promise((done,fail)=>stream.end(error=>error?fail(error):done()))));
const files=[...stats.values()].map(value=>Object.freeze({...value,sha256:value.sha256.digest('hex')})).sort((a,b)=>a.path.localeCompare(b.path));
const manifest={schema_version:'WBS_H1_2026_LOCAL_SNAPSHOT_V1',date_from:'2026-01-01',date_to:'2026-06-30',generated_at:new Date().toISOString(),files,total_rows:files.reduce((sum,file)=>sum+file.rows,0)};
const manifestPath=resolve(root,'manifest.json');
writeFileSync(manifestPath,`${JSON.stringify(manifest,null,2)}\n`,{encoding:'utf8',flag:'wx',mode:0o600});
process.stdout.write(`${JSON.stringify({status:'COMPLETE',manifest:manifestPath,total_rows:manifest.total_rows,file_count:files.length})}\n`);
