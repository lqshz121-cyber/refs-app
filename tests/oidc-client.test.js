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

// ===========================================================================
// Silent renewal.
//
// EVERYTHING BELOW RUNS AGAINST FAKES. There is no identity provider, no
// browser, no iframe, no third-party cookie and no network in this suite. The
// "provider" is a function that decides what a hidden frame would have posted
// back; the "frame" is an object literal. What is proved here is what this
// client does with each answer a provider could give it - including the answers
// it gives when it is being attacked or when it cannot answer at all. Nothing
// here proves that any real provider supports prompt=none, permits framing, or
// is reachable at all from a browser that blocks third-party cookies.
//
// The failure paths are the point. The happy path is one case out of eleven.
// ===========================================================================
import {RENEWAL_LEAD_MS,RENEWAL_MESSAGE,respondFromRenewalFrame,silentRenewalSchedule} from '../src/oidc-client.js';

const APP_ORIGIN='https://app.example';
const PROVIDER='https://issuer.example';
const SESSION_KEY='refs_oidc_pkce_v1';
const tokenResponse=(claims,expires_in=600)=>({ok:true,json:async()=>({access_token:token(claims),token_type:'Bearer',expires_in})});

// A top-level document with a hidden-frame host. `respond` is the provider: it
// is handed the frame that was just attached and decides what, if anything,
// comes back. Returning without delivering is a provider that refuses to be
// framed - indistinguishable, from the browser, from a blocked frame.
const renewalEnvironment=respond=>{
  const handlers=new Set();
  const env={
    __REFS_OIDC__:{...base.__REFS_OIDC__},crypto,sessionStorage:storage(),
    location:{search:'',assign(url){env.location.assigned=url;}},history:{replaceState(){}},
    addEventListener:(type,handler)=>{if(type==='message')handlers.add(handler);},
    removeEventListener:(type,handler)=>{if(type==='message')handlers.delete(handler);},
    setTimeout:(fn,ms)=>setTimeout(fn,ms),clearTimeout:id=>clearTimeout(id),frames:[],
  };
  env.parent=env;
  env.listenerCount=()=>handlers.size;
  env.deliver=(search,{origin=APP_ORIGIN,source='frame'}={})=>{
    const frame=env.frames[env.frames.length-1];
    for(const handler of [...handlers])handler({origin,source:source==='frame'?frame?.contentWindow:source,data:{type:RENEWAL_MESSAGE,search}});
  };
  env.document={
    createElement:()=>({attributes:{},style:{},contentWindow:{},removed:false,setAttribute(key,value){this.attributes[key]=value;},remove(){this.removed=true;}}),
    body:{appendChild:frame=>{env.frames.push(frame);setTimeout(()=>respond(frame,env),0);}},
  };
  return env;
};
const frameState=frame=>new URL(frame.src).searchParams.get('state');

// Seed a real session through the real interactive path, so the renewal cases
// are never testing against a hand-written storage record the code would not
// itself have produced.
const seedSession=async(env,{sub='subject-1',exp=1600,expires_in=600,now=1_000_000}={})=>{
  const client=new BrowserOidcClient({environment:env,now:()=>now,fetcher:async()=>tokenResponse({iss:PROVIDER,aud:'refs-accounting',...(sub?{sub}:{}),exp},expires_in)});
  await client.startLogin();
  env.location.search=`?code=seed&state=${JSON.parse(env.sessionStorage.getItem(SESSION_KEY)).state}`;
  assert.deepEqual(await client.completeRedirect(),{ok:true},'the interactive sign-in must succeed before a renewal case can mean anything');
  env.location.search='';
  return env.sessionStorage.getItem(SESSION_KEY);
};
const renewalClient=(env,fetcher)=>new BrowserOidcClient({environment:env,now:()=>1_500_000,fetcher});
const refuseFetch=label=>async()=>{throw new Error(label);};

// A renewal that neither resolves nor times out leaves node with an empty event
// loop and a pending promise, and node exits 0 without running the rest of this
// file. Measured: with the renewal timeout removed, this suite printed the
// interactive summary line and exited 0. Nothing below would have caught it, so
// the completion of the suite is itself asserted.
let renewalSuiteFinished=false;
process.on('exit',()=>{
  if(renewalSuiteFinished)return;
  console.log('FAIL the silent renewal suite never finished: a renewal neither resolved nor timed out, so every assertion after it was skipped');
  process.exitCode=1;
});

(async()=>{
  // Ordered after the interactive suite above so the summary line is last.
  await new Promise(resolve=>setTimeout(resolve,25));
  const observed=[];
  const record=result=>{observed.push(result.code);return result;};

  // -- 1. The schedule, with no browser involved at all. -------------------
  assert.equal(RENEWAL_LEAD_MS,120_000);
  assert.deepEqual(silentRenewalSchedule(1_000_000,500_000),{renewAt:880_000,delay:380_000,due:false,expired:false});
  assert.deepEqual(silentRenewalSchedule(1_000_000,900_000),{renewAt:880_000,delay:0,due:true,expired:false});
  assert.deepEqual(silentRenewalSchedule(1_000_000,1_000_000),{renewAt:880_000,delay:0,due:true,expired:true});
  assert.equal(silentRenewalSchedule(Number.NaN,1),null,'an unusable expiry must produce no schedule rather than a guessed one');
  assert.equal(silentRenewalSchedule(1.5,1),null);

  // -- 2. The happy path: a provider that answers. -------------------------
  {
    const env=renewalEnvironment((frame,e)=>e.deliver(`?code=renewed&state=${frameState(frame)}`));
    const seeded=JSON.parse(await seedSession(env));
    assert.equal(seeded.subject,'subject-1','the interactive sign-in must record the token subject, or no renewal can ever be matched against it');
    const client=renewalClient(env,async()=>tokenResponse({iss:PROVIDER,aud:'refs-accounting',sub:'subject-1',exp:2200}));
    assert.deepEqual(record(await client.renewSilently({timeoutMs:200})),{ok:true,expiresAt:2_100_000},'a provider that answers prompt=none with a valid, subject-matched, longer-lived token must renew the session silently');
    const authorize=new URL(env.frames[0].src);
    assert.equal(authorize.searchParams.get('prompt'),'none','a renewal must not be able to prompt the reader inside a hidden frame');
    assert.equal(authorize.searchParams.get('code_challenge_method'),'S256','a renewal is a fresh PKCE authorization, not a credential replay');
    assert.equal(authorize.searchParams.get('redirect_uri'),'https://app.example/callback');
    assert.equal(authorize.searchParams.get('state'),frameState(env.frames[0]));
    assert.equal(env.frames[0].attributes['aria-hidden'],'true');
    assert.equal(env.frames[0].removed,true,'the hidden renewal frame must be torn down');
    assert.equal(env.listenerCount(),0,'the renewal message listener must be torn down');
    const renewed=JSON.parse(env.sessionStorage.getItem(SESSION_KEY));
    assert.equal(renewed.expiresAt,2_100_000);
    assert.equal(renewed.subject,'subject-1');
    assert.equal(Object.keys(renewed).sort().join(','),'accessToken,expiresAt,kind,subject','silent renewal must not add a refresh token, or any other credential, to browser storage');
    assert.equal(env.sessionStorage.getItem('refs_oidc_renewal_v1'),null,'silent renewal must persist nothing of its own');
    assert.equal(await client.getAccessToken(),token({iss:PROVIDER,aud:'refs-accounting',sub:'subject-1',exp:2200}));
  }

  // -- 3. Renewal refused: the third-party-cookie case. --------------------
  {
    const env=renewalEnvironment((frame,e)=>e.deliver(`?error=login_required&state=${frameState(frame)}`));
    const before=await seedSession(env);
    const client=renewalClient(env,refuseFetch('a refused renewal must never reach the token endpoint'));
    const result=record(await client.renewSilently({timeoutMs:200}));
    assert.equal(result.ok,false);
    assert.equal(result.code,'OIDC_RENEWAL_REFUSED','a provider that answers prompt=none with an error must be reported as a refused renewal');
    assert.match(result.message,/login_required/);
    assert.equal(env.sessionStorage.getItem(SESSION_KEY),before,'a refused renewal must leave the existing session byte-for-byte as it was');
    assert.equal(env.frames[0].removed,true);
    // Fail closed: the unrenewed session still dies on schedule, and it dies
    // 30s early rather than being sent at the last moment.
    assert.equal(await renewalClient(env,refuseFetch('unused')).getAccessToken(),JSON.parse(before).accessToken);
    await assert.rejects(new BrowserOidcClient({environment:env,now:()=>1_580_000}).getAccessToken(),/unavailable or expired/,'a token inside 30s of expiry must still be refused after a failed renewal');
    await assert.rejects(new BrowserOidcClient({environment:env,now:()=>1_700_000}).getAccessToken(),/unavailable or expired/,'an expired token must still be refused after a failed renewal');
  }

  // -- 4. A provider that blocks the frame: nothing ever answers. ----------
  {
    const env=renewalEnvironment(()=>{});
    const before=await seedSession(env);
    let fetched=0;
    const client=renewalClient(env,async()=>{fetched++;return tokenResponse({iss:PROVIDER,aud:'refs-accounting',sub:'subject-1',exp:2200});});
    const started=Date.now();
    const result=record(await client.renewSilently({timeoutMs:40}));
    assert.equal(result.code,'OIDC_RENEWAL_BLOCKED','a renewal frame that never answers must fail as blocked rather than hang');
    assert.ok(Date.now()-started>=35,'a blocked renewal must actually wait for its timeout, not resolve immediately');
    assert.equal(fetched,0,'a renewal that was never answered must not have exchanged anything');
    assert.equal(env.sessionStorage.getItem(SESSION_KEY),before,'a blocked renewal must leave the existing session as it was');
    assert.equal(env.frames[0].removed,true,'a blocked renewal must still tear its frame down');
    assert.equal(env.listenerCount(),0,'a blocked renewal must still tear its listener down');
  }

  // -- 5. Hostile postMessage: wrong origin, wrong window, wrong state. ----
  //    None of the three may be believed, and none may force any outcome
  //    other than the timeout that would have happened anyway.
  {
    const env=renewalEnvironment((frame,e)=>{
      const state=frameState(frame);
      e.deliver(`?code=forged&state=${state}`,{origin:'https://evil.example'});
      e.deliver(`?code=forged&state=${state}`,{source:{}});
      e.deliver('?code=forged&state=not-the-state-this-call-generated');
      e.deliver(`?code=forged&state=${state}`,{origin:'https://app.example.evil.test'});
    });
    const before=await seedSession(env);
    let fetched=0;
    const client=renewalClient(env,async()=>{fetched++;return tokenResponse({iss:PROVIDER,aud:'refs-accounting',sub:'subject-1',exp:2200});});
    assert.equal(record(await client.renewSilently({timeoutMs:60})).code,'OIDC_RENEWAL_BLOCKED','a hostile postMessage must not be able to force any renewal outcome; the attempt must still only time out');
    assert.equal(fetched,0,'a renewal answer from the wrong origin, the wrong window or with the wrong state must never be exchanged');
    assert.equal(env.sessionStorage.getItem(SESSION_KEY),before);
  }

  // -- 6. A valid token for a different subject. --------------------------
  {
    const env=renewalEnvironment((frame,e)=>e.deliver(`?code=renewed&state=${frameState(frame)}`));
    const before=await seedSession(env);
    const client=renewalClient(env,async()=>tokenResponse({iss:PROVIDER,aud:'refs-accounting',sub:'subject-2',exp:2200}));
    const result=record(await client.renewSilently({timeoutMs:200}));
    assert.equal(result.code,'OIDC_RENEWAL_SUBJECT_MISMATCH','a renewed token naming a different subject must be refused, not accepted onto the session on screen');
    assert.equal(env.sessionStorage.getItem(SESSION_KEY),before,'a token naming another subject must never replace the session on screen');
    assert.equal(await renewalClient(env,refuseFetch('unused')).getAccessToken(),JSON.parse(before).accessToken);
  }

  // -- 7. A session with no subject to match against is never renewed. ----
  {
    const env=renewalEnvironment((frame,e)=>e.deliver(`?code=renewed&state=${frameState(frame)}`));
    const before=await seedSession(env,{sub:null});
    assert.equal(JSON.parse(before).subject,null);
    const client=renewalClient(env,refuseFetch('an unmatched session must never be renewed'));
    assert.equal(record(await client.renewSilently({timeoutMs:200})).code,'OIDC_RENEWAL_UNAVAILABLE','a session with no subject to match a renewal against must refuse to renew rather than accept whatever comes back');
    assert.equal(env.frames.length,0,'a renewal that cannot be matched must never open a frame at all');
    assert.equal(env.sessionStorage.getItem(SESSION_KEY),before);
  }

  // -- 8. The token endpoint produces no response. -------------------------
  {
    const env=renewalEnvironment((frame,e)=>e.deliver(`?code=renewed&state=${frameState(frame)}`));
    const before=await seedSession(env);
    const client=renewalClient(env,refuseFetch('network down'));
    assert.equal(record(await client.renewSilently({timeoutMs:200})).code,'OIDC_RENEWAL_UNREACHABLE','a renewal token request that produced no response must say so rather than be folded into another failure');
    assert.equal(env.sessionStorage.getItem(SESSION_KEY),before);
  }

  // -- 9. A renewed token that fails the same checks the sign-in applies. --
  {
    for(const [name,claims,expires_in] of [
      ['a different issuer',{iss:'https://evil.example',aud:'refs-accounting',sub:'subject-1',exp:2200},600],
      ['a different audience',{iss:PROVIDER,aud:'some-other-api',sub:'subject-1',exp:2200},600],
      ['an already-expired token',{iss:PROVIDER,aud:'refs-accounting',sub:'subject-1',exp:1400},600],
      ['a token that renews nothing',{iss:PROVIDER,aud:'refs-accounting',sub:'subject-1',exp:1560},30],
    ]){
      const env=renewalEnvironment((frame,e)=>e.deliver(`?code=renewed&state=${frameState(frame)}`));
      const before=await seedSession(env);
      const client=renewalClient(env,async()=>tokenResponse(claims,expires_in));
      assert.equal(record(await client.renewSilently({timeoutMs:200})).code,'OIDC_RENEWAL_INVALID',`a renewal offering ${name} must be discarded`);
      assert.equal(env.sessionStorage.getItem(SESSION_KEY),before,`a renewal offering ${name} must leave the session as it was`);
    }
  }

  // -- 10. A framed REFS hands the callback up and refuses to run. ---------
  {
    const env=renewalEnvironment(()=>{});
    const before=await seedSession(env);
    const posted=[];
    env.parent={postMessage:(data,origin)=>posted.push([data,origin])};
    env.location.search='?code=silent-callback&state=whatever-the-starter-generated';
    const client=renewalClient(env,refuseFetch('a framed instance must never reach the token endpoint'));
    assert.deepEqual(await client.completeRedirect(),{ok:false,code:'OIDC_FRAMED_CONTEXT'},'a framed REFS must refuse to complete a redirect at all; completing one would reach the shared session record the top-level tab holds');
    assert.equal(posted.length,1,'a framed instance must hand its callback query to the tab that opened it');
    assert.equal(posted[0][0].type,RENEWAL_MESSAGE);
    assert.equal(posted[0][0].search,'?code=silent-callback&state=whatever-the-starter-generated');
    assert.equal(posted[0][1],APP_ORIGIN,'the callback must be posted only to this application own origin');
    assert.equal(env.sessionStorage.getItem(SESSION_KEY),before,'a framed instance must not touch the session record the top-level tab holds');
    assert.equal(record(await client.renewSilently({timeoutMs:40})).code,'OIDC_RENEWAL_UNAVAILABLE','a framed instance must not start a renewal of its own');
    assert.equal(env.frames.length,0);
    // The same document, unframed, is not a renewal frame and posts nothing.
    env.parent=env;
    assert.equal(respondFromRenewalFrame(env),false);
    assert.equal(posted.length,1);
  }

  // -- 11. Every renewal outcome is its own code, and none of them is an
  //        authorization outcome. A renewal failure that arrived at
  //        AUTHORIZATION_DENIED would tell the reader that signing in again
  //        cannot help, which is the exact opposite of the truth.
  const failures=[...new Set(observed.filter(code=>typeof code==='string'))].sort();
  assert.equal(observed.filter(code=>code===undefined).length,1,'exactly one renewal in this suite is meant to succeed');
  assert.deepEqual(failures,[
    'OIDC_RENEWAL_BLOCKED','OIDC_RENEWAL_INVALID','OIDC_RENEWAL_REFUSED',
    'OIDC_RENEWAL_SUBJECT_MISMATCH','OIDC_RENEWAL_UNAVAILABLE','OIDC_RENEWAL_UNREACHABLE',
  ],'each silent renewal failure must arrive under its own code; a shared one would hide which failure actually happened');
  for(const code of failures){
    assert.notEqual(code,'AUTHORIZATION_DENIED','a renewal failure must never be reported as an authorization refusal');
    assert.notEqual(code,'AUTHENTICATION_REQUIRED','a renewal failure must not be dressed up as an accounting API status');
  }

  renewalSuiteFinished=true;
  console.log(`oidc-client silent renewal: all assertions passed against fakes (${observed.length} renewal outcomes, ${failures.length} distinct failure codes; no identity provider was contacted)`);
})().catch(error=>{console.error(error);process.exitCode=1;});
