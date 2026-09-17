// L03 / L13: read back the release stamps of every staging surface and report
// drift. Read-only HTTPS GETs; no credentials. Exit 0 when all surfaces agree,
// 2 when any surface is unreachable, 3 on SHA drift. Usage:
//   node tools/staging-release-readback.mjs [--json] [--expect <sha>]
//   REFS_READBACK_SURFACES='[{"name":"api","url":"https://.../health/ready","kind":"health"},{"name":"web","url":"https://.../refs-build.js","kind":"build"}]'
const DEFAULT=[
  {name:'refs-accounting-api-staging',url:'https://refs-accounting-api-staging.onrender.com/health/ready',kind:'health'},
  {name:'refs-internal-test-api',url:'https://refs-internal-test-api.onrender.com/health/ready',kind:'health'},
  {name:'refs-app',url:'https://refs-app.onrender.com/refs-build.js',kind:'build'},
  {name:'refs-internal-test',url:'https://refs-internal-test.onrender.com/refs-build.js',kind:'build'}
];
export function parseStamp(kind,text){
  if(kind==='health'){const j=JSON.parse(text);return {sha:j.release,ready:j.ok===true&&j.status==='ready'};}
  const m=text.match(/"sha":"([0-9a-f]{40}|dev)"/);return {sha:m?m[1]:null,ready:!!m};
}
export async function readback({surfaces=DEFAULT,fetcher=globalThis.fetch,expect=null}={}){
  const results=[];
  for(const s of surfaces){try{const r=await fetcher(s.url,{cache:'no-store'});const text=await r.text();const st=r.status===200?parseStamp(s.kind,text):{sha:null,ready:false};results.push({...s,status:r.status,...st});}catch(e){results.push({...s,status:0,sha:null,ready:false,error:e?.code||'FETCH_FAILED'});}}
  const shas=[...new Set(results.map(r=>r.sha).filter(Boolean))];
  const unreachable=results.filter(r=>!r.ready);
  const drift=shas.length>1||(expect&&shas.some(s=>s!==expect));
  return {checked_at:new Date().toISOString(),expect,results,shas,unreachable:unreachable.map(r=>r.name),decision:unreachable.length?'UNREACHABLE':drift?'DRIFT':'CONSISTENT',exit:unreachable.length?2:drift?3:0};
}
if(process.argv[1]&&import.meta.url===new URL(`file://${process.argv[1].replace(/\\/g,'/')}`).href||process.argv[1]?.endsWith('staging-release-readback.mjs')){
  const args=process.argv.slice(2);const expect=args.includes('--expect')?args[args.indexOf('--expect')+1]:null;
  const surfaces=process.env.REFS_READBACK_SURFACES?JSON.parse(process.env.REFS_READBACK_SURFACES):DEFAULT;
  const r=await readback({surfaces,expect});
  if(args.includes('--json'))console.log(JSON.stringify(r,null,2));else{console.log(`release read-back: ${r.decision}`);for(const x of r.results)console.log(`${x.ready?'ok  ':'FAIL'} ${x.name.padEnd(28)} ${x.status} ${x.sha||'-'}`);}
  process.exitCode=r.exit;
}
