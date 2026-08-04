import assert from 'node:assert/strict';
import {BrowserOidcClient,oidcRuntimeConfig} from '../src/oidc-client.js';

const b64=value=>Buffer.from(JSON.stringify(value)).toString('base64url');
const token=claims=>`${b64({alg:'RS256'})}.${b64(claims)}.signature`;
const storage=()=>{const values=new Map();return {getItem:key=>values.get(key)||null,setItem:(key,value)=>values.set(key,String(value)),removeItem:key=>values.delete(key)};};
const crypto={getRandomValues:bytes=>{bytes.fill(7);return bytes;},subtle:{digest:async()=>new Uint8Array(32).fill(9).buffer}};
const base={__REFS_OIDC__:{issuer:'https://issuer.example',authorizationEndpoint:'https://issuer.example/authorize',tokenEndpoint:'https://issuer.example/token',redirectUri:'https://app.example/callback',clientId:'refs-browser',audience:'refs-accounting',scope:'openid profile'},crypto,sessionStorage:storage(),location:{search:'',assign:url=>{base.location.assigned=url;}},history:{replaceState:(_a,_b,url)=>{base.location.replaced=url;}}};

assert.equal(oidcRuntimeConfig({__REFS_OIDC__:{...base.__REFS_OIDC__,issuer:'http://issuer.example'}}),null);
assert.equal(oidcRuntimeConfig({__REFS_OIDC__:{...base.__REFS_OIDC__,scope:'profile'}}),null);
(async()=>{
  const client=new BrowserOidcClient({environment:base,now:()=>1_000_000,fetcher:async()=>({ok:true,json:async()=>({access_token:token({iss:'https://issuer.example',aud:'refs-accounting',exp:2000}),token_type:'Bearer',expires_in:600})})});
  await client.startLogin();assert.match(base.location.assigned,/code_challenge_method=S256/);const pending=JSON.parse(base.sessionStorage.getItem('refs_oidc_pkce_v1'));base.location.search=`?code=code-123&state=${pending.state}`;
  assert.deepEqual(await client.completeRedirect(),{ok:true});assert.equal(await client.getAccessToken(),token({iss:'https://issuer.example',aud:'refs-accounting',exp:2000}));assert.equal(base.location.replaced,'https://app.example/callback');
  const rejected=new BrowserOidcClient({environment:{...base,sessionStorage:storage(),location:{search:'?code=x&state=wrong'},history:{replaceState(){}}},now:()=>1_000_000,fetcher:async()=>{throw new Error('must not call');}});assert.equal((await rejected.completeRedirect()).code,'OIDC_STATE_INVALID');
  console.log('oidc-client: all assertions passed');
})().catch(error=>{console.error(error);process.exitCode=1;});
