import assert from 'node:assert/strict';
import {mkdtempSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {AUTHORITATIVE_PAGES,verifyAuthoritativeRuntimeEvidence} from './verify-authoritative-runtime-evidence.mjs';

const root=mkdtempSync(join(tmpdir(),'refs-authoritative-e2e-'));
const frozen='a'.repeat(40),web='https://app.staging.example',api='https://api.staging.example',entity='11111111-1111-4111-8111-111111111111';
const pages={};
for(const [page,paths] of Object.entries(AUTHORITATIVE_PAGES)){
  const screenshot=join(root,`${page}.png`),visible=join(root,`${page}.txt`),network=join(root,`${page}.network.json`);
  writeFileSync(screenshot,'png');writeFileSync(visible,`${page}\nAuthoritative accounting records\n`);
  writeFileSync(network,JSON.stringify(paths.map(path=>({method:'GET',status:200,url:`${api}/api/v1/entities/${entity}${path.replace('*','22222222-2222-4222-8222-222222222222')}`,authenticated:true}))));
  pages[page]={authenticated:true,web_origin:web,api_origin:api,screenshot,visible_text:visible,network_log:network};
}
const manifest={schema:'refs.authoritative-runtime-evidence/v1',frozen_sha:frozen,worktree_clean:true,web_origin:web,api_origin:api,build_stamp:{sha:frozen.slice(0,7),channel:'AUTHORITATIVE',authoritative:true},runtime_mode:'REQUIRES_AUTHORITATIVE_API',demo_fallback_possible:false,api_release:{status:200,release:frozen},authenticated:true,oidc:{issuer:'https://issuer.staging.example',audience:'refs-accounting',subject:'user-1',renewal:{verified:true,mode:'prompt_none_pkce',subject_before:'user-1',subject_after:'user-1',token_hash_before:'sha256:one',token_hash_after:'sha256:two',expires_at_before:1000,expires_at_after:2000}},api_smoke:{base_url:api,authenticated_status:200,anonymous_status:401,cross_entity_status:403,cross_tenant_status:404},refresh:{performed:true,subject_before:'user-1',subject_after:'user-1',route_before:'Bank',route_after:'Bank',api_gets_after:1},pages};
const path=join(root,'manifest.json');
const verify=value=>{writeFileSync(path,JSON.stringify(value));process.exitCode=0;const ok=verifyAuthoritativeRuntimeEvidence({REFS_AUTHORITATIVE_E2E_MANIFEST:path,REFS_RELEASE_SHA:frozen});process.exitCode=0;return ok;};

assert.equal(verify(manifest),true);
assert.equal(verify({...manifest,worktree_clean:false}),false);
assert.equal(verify({...manifest,runtime_mode:'LOCAL_MOCK'}),false);
assert.equal(verify({...manifest,api_release:{status:200,release:'b'.repeat(40)}}),false);
assert.equal(verify({...manifest,oidc:{...manifest.oidc,renewal:{...manifest.oidc.renewal,token_hash_after:'sha256:one'}}}),false);
assert.equal(verify({...manifest,api_smoke:{...manifest.api_smoke,anonymous_status:200}}),false);
assert.equal(verify({...manifest,refresh:{...manifest.refresh,route_after:'Reports'}}),false);
assert.equal(verify({...manifest,pages:{...pages,Bank:{...pages.Bank,network_log:pages.JE.network_log}}}),false);
writeFileSync(pages.AP.visible_text,'Observed QBO demo');
assert.equal(verify(manifest),false);
console.log('authoritative runtime evidence gate: positive and fail-closed assertions passed');
