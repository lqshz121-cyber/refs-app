import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const read=path=>readFileSync(path,'utf8');
const index=read('dist/index.html');
const assets=['refs-build.js','refs-runtime-lock.js','refs-runtime-config.js','bundle.js'];
let previous=-1;
for(const asset of assets){
  const position=index.indexOf(`./${asset}`);
  assert.ok(position>previous,`dist/index.html must load ${asset} in the safe runtime order`);
  previous=position;
  read(`dist/${asset}`);
}

const build=read('dist/refs-build.js'),lock=read('dist/refs-runtime-lock.js'),config=read('dist/refs-runtime-config.js');
assert.match(build,/window\.__BUILD=/,'build metadata asset is missing');
assert.match(lock,/REQUIRES_AUTHORITATIVE_API/,'runtime lock must require the authoritative API');
assert.doesNotMatch(lock,/LOCAL_DEMO/,'deployment lock must not enable local demo mode');
assert.match(config,/window\.__REFS_OIDC__=/,'runtime config must explicitly configure or clear OIDC');
assert.match(config,/window\.__REFS_ACCOUNTING_API__=/,'runtime config must explicitly configure or clear the accounting API');
if(process.env.REFS_PUBLIC_RUNTIME_MODE==='LOCAL_MOCK'){
  assert.match(config,/window\.__REFS_RUNTIME_MODE__='LOCAL_MOCK'/,'the Pages demonstration must be explicitly marked LOCAL_MOCK');
  assert.match(config,/window\.__REFS_OIDC__=null/,'the Pages demonstration must not carry an OIDC provider');
  assert.match(config,/window\.__REFS_ACCOUNTING_API__=null/,'the Pages demonstration must not carry an authoritative API');
}else{
  assert.match(config,/REQUIRES_AUTHORITATIVE_API/,'an unconfigured or authoritative deployment must remain fail closed');
}
assert.doesNotMatch(config,/REFS_PUBLIC_|DATABASE_URL|ACCESS_KEY|SECRET_ACCESS|BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY/i,'runtime config must not contain environment placeholders or secrets');
console.log(`PASS runtime deployment assets: complete, ordered, and ${process.env.REFS_PUBLIC_RUNTIME_MODE==='LOCAL_MOCK'?'explicitly local-mock':'fail closed'}`);
