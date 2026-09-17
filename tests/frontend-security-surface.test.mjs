// N37: the static client must not carry anything its CSP would block, must not
// load scripts from origins the CSP does not allow, must pin every remote
// script with SRI, and every static Render service must ship the same
// security headers. A page that violates its own CSP renders blank with a
// console error — the exact white-screen class T14 chased — so pin it here.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const root=new URL('../',import.meta.url);
const html=readFileSync(new URL('index.html',root),'utf8');
const render=readFileSync(new URL('render.yaml',root),'utf8');

const staticServices=[...render.matchAll(/- type: web\n\s+name: (\S+)\n\s+runtime: static([\s\S]*?)(?=\n  - type: |\s*$)/g)].map(m=>({name:m[1],body:m[2]}));
const cspOf=body=>{const m=body.match(/name: Content-Security-Policy\n\s+value: "([^"]+)"/);return m?m[1]:null;};
const directive=(csp,name)=>{const part=csp.split(';').map(s=>s.trim()).find(s=>s.startsWith(name+' '));return part?part.slice(name.length).trim().split(/\s+/):null;};

test('index.html has no inline script, inline handlers or javascript: URLs (script-src has no unsafe-inline)',()=>{
  assert.equal((html.match(/<script(?![^>]*\bsrc=)[^>]*>/g)||[]).length,0,'inline <script> blocks');
  assert.equal((html.match(/<[a-z][^>]*\son[a-z]+=/gi)||[]).length,0,'inline on* handlers');
  assert.equal((html.match(/javascript:/gi)||[]).length,0);
});

test('every remote script origin is allowed by the static CSP and carries SRI + crossorigin',()=>{
  const scripts=[...html.matchAll(/<script\b[^>]*>/g)].map(m=>m[0]);
  const remote=scripts.filter(tag=>/\bsrc="https?:\/\//.test(tag));
  assert.ok(remote.length>=1,'expected the Chart.js CDN script');
  for(const {name,body} of staticServices){
    const csp=cspOf(body);assert.ok(csp,`${name} must set Content-Security-Policy`);
    const allowed=directive(csp,'script-src');assert.ok(allowed&&!allowed.includes("'unsafe-inline'")&&!allowed.includes("'unsafe-eval'"),`${name} script-src must not allow inline/eval`);
    for(const tag of remote){
      const origin=new URL(tag.match(/\bsrc="([^"]+)"/)[1]).origin;
      assert.ok(allowed.includes(origin),`${name}: ${origin} not in script-src`);
      assert.match(tag,/\bintegrity="sha(256|384|512)-/,`${origin} script needs SRI`);
      assert.match(tag,/\bcrossorigin="anonymous"/);
    }
    assert.deepEqual(directive(csp,'object-src'),["'none'"]);assert.deepEqual(directive(csp,'base-uri'),["'self'"]);
  }
});

test('all static Render services carry identical security headers and never cache the runtime adapter',()=>{
  assert.ok(staticServices.length>=2,'expected refs-app and refs-internal-test');
  const headersOf=body=>[...body.matchAll(/- path: (\S+)\n\s+name: ([\w-]+)\n\s+value: "?([^"\n]+)"?/g)].map(m=>`${m[1]} ${m[2]}=${m[3]}`).sort();
  const [first,...rest]=staticServices;
  for(const svc of rest)assert.deepEqual(headersOf(svc.body),headersOf(first.body),`${svc.name} headers differ from ${first.name}`);
  for(const path of ['/refs-runtime-lock.js','/refs-runtime-config.js','/refs-build.js','/refs-boot-guard.js','/index.html','/'])assert.ok(headersOf(first.body).includes(`${path} Cache-Control=no-store`),path);
  for(const h of ['X-Frame-Options=SAMEORIGIN','X-Content-Type-Options=nosniff','Referrer-Policy=strict-origin-when-cross-origin'])assert.ok(headersOf(first.body).some(x=>x.endsWith(h)),h);
});

test('no database credential, private key or connection string is committed outside the local docker fixtures',async()=>{
  const {execFileSync}=await import('node:child_process');
  let files;try{files=execFileSync('git',['ls-files','-z'],{cwd:root,encoding:'utf8'}).split('\0').filter(Boolean);}catch{files=null;}
  if(!files)return; // archive checkout without .git: covered in CI where git exists
  const allow=new Set(['server/compose.yaml','server/compose.attachments.yaml','server/runtime/docker-init.sql','server/runtime/config.mjs','server/runtime/test-postgres-fresh.mjs','server/runtime/test-backup-restore-drill.mjs','server/runtime/test-attachment-containers.mjs','server/tests/postgres-config.test.mjs','.github/workflows/outbox-consumer-ci.yml' /* disposable-ci-only local password */]);
  const bad=/refs_(migrator|runtime|issuer|grant_sync|context_issuer|supervisor)_test_[A-Za-z0-9]{8,}|BEGIN (RSA|EC|OPENSSH) PRIVATE KEY|postgres(ql)?:\/\/[^\s'"`:]+:(?!(\.\.\.|secret|password|PASSWORD|\$\{|<|%7B)[^\s'"`@]*@)[^\s'"`@]{8,}@|AKIA[0-9A-Z]{16}|ghp_[A-Za-z0-9]{36}/;
  const hits=[];
  for(const f of files){if(allow.has(f)||f.startsWith('outputs/')||f.startsWith('server/tests/')||f.startsWith('server/db/'))continue;if(!/\.(mjs|js|jsx|json|ya?ml|md|html|sql|env|txt)$/.test(f))continue;const text=readFileSync(new URL(f,root),'utf8');if(bad.test(text))hits.push(f);}
  assert.deepEqual(hits,[]);
});
