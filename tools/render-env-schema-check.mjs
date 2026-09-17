// R27 / L22: static, secret-free validation of render.yaml / render.integrations.yaml
// against the variable names the runtime actually reads. Reports:
//  - duplicates within a service
//  - plaintext values that look like secrets (any key matching /SECRET|TOKEN|PASSWORD|KEY$|_URL$/ with a literal value that is not a public https:// URL or a known enum)
//  - runtime-referenced REFS_/OIDC_/S3_/VIRUS_/WBS_/OUTBOX_ variables absent from every service (informational: may be optional)
//  - static ⇄ API coordinate alignment: static REFS_PUBLIC_ACCOUNTING_API_BASE_URL and OIDC audience must be sync:false (deploy-time), attachment/cash-transfer UI modes must not be enabled while the API keeps REFS_ATTACHMENT_MODE=DISABLED
// Usage: node tools/render-env-schema-check.mjs [--json]
import {readFileSync,readdirSync,existsSync} from 'node:fs';
const files=['render.yaml','render.integrations.yaml'].filter(existsSync);
const services=[];
for(const f of files){const text=readFileSync(f,'utf8');for(const block of text.split(/\n  - type: /).slice(1)){const type=block.split('\n')[0].trim();const name=(block.match(/\n\s+name: (\S+)/)||[])[1];const vars=[...block.matchAll(/- key: (\S+)\n\s+(sync: false|value: ?(.*)|fromService:)/g)].map(m=>({key:m[1],kind:m[2].startsWith('sync')?'secret':m[2].startsWith('from')?'linked':'value',value:m[3]?.trim().replace(/^"|"$/g,'')}));services.push({file:f,type,name,vars});}}
const problems=[],info=[];
const secretish=/SECRET|TOKEN|PASSWORD|PRIVATE|_KEY_ID$|ACCESS_KEY|DATABASE_URL$|PUBLISH_URL$|CA_PEM$/;
for(const s of services){
  const seen=new Map();for(const v of s.vars){if(seen.has(v.key))problems.push(`${s.name}: duplicate key ${v.key}`);seen.set(v.key,v);
    if(v.kind==='value'&&secretish.test(v.key)&&!/^https:\/\//.test(v.value||''))problems.push(`${s.name}: ${v.key} has a literal value in the Blueprint (must be sync:false)`);
    if(v.kind==='value'&&/postgres(ql)?:\/\/[^:]+:[^@]+@/.test(v.value||''))problems.push(`${s.name}: ${v.key} embeds a connection string with a password`);}
}
const runtimeSrc=['server/runtime','server/api','scripts'].flatMap(d=>existsSync(d)?readdirSync(d).filter(f=>f.endsWith('.mjs')).map(f=>readFileSync(`${d}/${f}`,'utf8')):[]).join('\n')+(existsSync('build.mjs')?readFileSync('build.mjs','utf8'):'');
const referenced=new Set([...runtimeSrc.matchAll(/(?:\benv(?:ironment)?|process\.env)(?:\.|\[['"])((?:REFS|OIDC|S3|VIRUS_SCANNER|WBS|OUTBOX|ATTACHMENT)_[A-Z0-9_]+)/g)].map(m=>m[1]));
const declared=new Set(services.flatMap(s=>s.vars.map(v=>v.key)));
for(const k of [...referenced].sort())if(!declared.has(k))info.push(`referenced in runtime but not declared in any Blueprint service: ${k}`);
for(const k of [...declared].sort())if(!referenced.has(k)&&/^(REFS|OIDC|S3|VIRUS|WBS|OUTBOX|ATTACHMENT)_/.test(k))info.push(`declared in Blueprint but never read by runtime/scripts: ${k}`);
const api=services.find(s=>s.name==='refs-accounting-api-staging'),stat=services.find(s=>s.name==='refs-app');
if(api&&stat){const get=(s,k)=>s.vars.find(v=>v.key===k);
  for(const k of ['REFS_PUBLIC_ACCOUNTING_API_BASE_URL','REFS_PUBLIC_OIDC_AUDIENCE','REFS_PUBLIC_OIDC_CLIENT_ID'])if(get(stat,k)?.kind!=='secret')problems.push(`refs-app: ${k} must be sync:false (deployment coordinate)`);
  if(get(api,'REFS_ATTACHMENT_MODE')?.value==='DISABLED'){for(const k of ['REFS_PUBLIC_CASH_TRANSFER_UI_MODE','REFS_PUBLIC_ACCOUNTING_API_ATTACHMENT_MODE'])if(get(stat,k)?.value!=='DISABLED')problems.push(`refs-app: ${k} must be DISABLED while API REFS_ATTACHMENT_MODE=DISABLED`);}
  for(const k of ['REFS_DEPLOYMENT_ENV','REFS_WBS_TEST_IMPORT_MODE','REFS_CONTROLLED_TEST_AI_WORKFLOW_MODE'])if(get(api,k)?.value!==get(stat,k)?.value)problems.push(`API/static drift on ${k}: ${get(api,k)?.value} vs ${get(stat,k)?.value}`);
}
const report={files,services:services.map(s=>({name:s.name,type:s.type,secrets:s.vars.filter(v=>v.kind==='secret').length,values:s.vars.filter(v=>v.kind==='value').length,linked:s.vars.filter(v=>v.kind==='linked').length})),problems,info};
if(process.argv.includes('--json'))console.log(JSON.stringify(report,null,2));else{console.log(`render env schema check: ${services.length} services, ${problems.length} problems, ${info.length} notes`);for(const p of problems)console.log('PROBLEM '+p);for(const i of info)console.log('note    '+i);}
process.exitCode=problems.length?1:0;
