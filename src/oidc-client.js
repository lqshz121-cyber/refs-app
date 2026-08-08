const STORAGE_KEY='refs_oidc_pkce_v1';
const text=value=>typeof value==='string'&&value.trim()?value.trim():null;
const httpsUrl=value=>{try{const url=new URL(value);return url.protocol==='https:'&&!url.username&&!url.password&&url.origin===url.origin?url.toString():null;}catch{return null;}};
const base64url=bytes=>btoa(String.fromCharCode(...bytes)).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
const json=value=>{try{return JSON.parse(value);}catch{return null;}};

export const oidcRuntimeConfig=(environment=globalThis)=>{
  const raw=environment?.__REFS_OIDC__;
  if(!raw||typeof raw!=='object'||Array.isArray(raw))return null;
  const issuer=httpsUrl(raw.issuer),authorizationEndpoint=httpsUrl(raw.authorizationEndpoint),tokenEndpoint=httpsUrl(raw.tokenEndpoint),redirectUri=httpsUrl(raw.redirectUri),clientId=text(raw.clientId),audience=text(raw.audience),scope=text(raw.scope)||'openid profile';
  if(!issuer||!authorizationEndpoint||!tokenEndpoint||!redirectUri||!clientId||clientId.length>256||!scope.split(/\s+/).includes('openid'))return null;
  return {issuer:issuer.replace(/\/$/,''),authorizationEndpoint,tokenEndpoint,redirectUri,clientId,audience,scope};
};

const random=environment=>{const bytes=new Uint8Array(32);environment.crypto?.getRandomValues?.(bytes);if(!bytes.some(Boolean))throw new Error('OIDC browser cryptography is unavailable');return base64url(bytes);};
const digest=async(environment,value)=>base64url(new Uint8Array(await environment.crypto.subtle.digest('SHA-256',new TextEncoder().encode(value))));
const save=(environment,value)=>environment.sessionStorage?.setItem(STORAGE_KEY,JSON.stringify(value));
const load=environment=>json(environment.sessionStorage?.getItem(STORAGE_KEY)||'');
const clear=environment=>environment.sessionStorage?.removeItem(STORAGE_KEY);
const tokenClaims=token=>{const part=token?.split('.')?.[1];if(!part)return null;try{const base64=part.replace(/-/g,'+').replace(/_/g,'/');return json(atob(base64.padEnd(base64.length+(4-base64.length%4)%4,'=')));}catch{return null;}};

// ---------------------------------------------------------------------------
// Token acceptance.
//
// One implementation, shared by the interactive redirect and by silent renewal,
// so the two can never drift into accepting different things. It returns the
// session record to store, or null. It never stores anything itself: the caller
// decides whether a validated token is allowed to replace the one already held.
// ---------------------------------------------------------------------------
const acceptToken=(body,config,now)=>{
  if(typeof body?.access_token!=='string'||!body.access_token||body.token_type?.toLowerCase()!=='bearer'||!Number.isSafeInteger(body.expires_in)||body.expires_in<30||body.expires_in>3600)return null;
  const claims=tokenClaims(body.access_token),audiences=Array.isArray(claims?.aud)?claims.aud:[claims?.aud];
  if(claims?.iss?.replace(/\/$/,'')!==config.issuer||!Number.isInteger(claims?.exp)||claims.exp*1000<=now+30000||(config.audience&&!audiences.includes(config.audience)))return null;
  return {kind:'token',accessToken:body.access_token,expiresAt:Math.min(now+body.expires_in*1000,claims.exp*1000),subject:text(claims.sub)};
};

// ---------------------------------------------------------------------------
// Silent renewal.
//
// WHAT THIS IS NOT: there is no refresh token here. This is a public PKCE
// client with no client secret; a refresh token would be a long-lived bearer
// credential sitting in browser storage inside the reach of any XSS on this
// origin, and nothing in this repository can confirm that the deployed provider
// rotates refresh tokens or would even issue one to a public client. An access
// token this client accepts lives at most an hour (`expires_in>3600` is
// refused), which bounds what a stolen one is worth. A refresh token has no
// such bound. That trade is not worth making to remove a sign-in prompt, so no
// credential store was added.
//
// WHAT THIS IS: a fresh PKCE authorization request carrying `prompt=none`,
// loaded in a hidden same-tab iframe. It persists nothing new - the state and
// the code verifier live in one closure for the few seconds the attempt lasts.
// It succeeds only if the provider still holds a usable session cookie for this
// browser *in a third-party context*. A browser that blocks that cookie
// (Safari today, Chrome increasingly) makes the provider answer
// `error=login_required`; a provider that refuses to be framed makes the frame
// answer nothing at all. Both are named failures below, not silent ones, and
// neither one is treated as an authorization refusal.
//
// FAIL CLOSED: every outcome except {ok:true} leaves the stored session exactly
// as it was found. Renewal never lengthens, shortens, or clears it, and never
// writes a token it could not validate against the same issuer, audience, type
// and expiry rules the interactive sign-in applies, against the same subject,
// and against the requirement that the new token actually outlive the old one.
// getAccessToken() remains the only thing that decides whether a token may be
// sent, and it still refuses one within 30s of expiry. A failed renewal
// therefore cannot let an expired token reach the accounting API.
// ---------------------------------------------------------------------------
export const RENEWAL_MESSAGE='refs.oidc.silent-renewal.callback';
export const RENEWAL_LEAD_MS=120000;
export const RENEWAL_TIMEOUT_MS=8000;
export const RENEWAL_MIN_INTERVAL_MS=30000;

const renewalFail=(code,message)=>({ok:false,code,message});

// When the renewal should be attempted, and whether the session is already
// gone. Pure, so the schedule can be asserted without a browser or a timer.
export const silentRenewalSchedule=(expiresAt,now,lead=RENEWAL_LEAD_MS)=>{
  if(!Number.isSafeInteger(expiresAt)||!Number.isSafeInteger(now)||!Number.isSafeInteger(lead)||lead<0)return null;
  const renewAt=expiresAt-lead;
  return {renewAt,delay:Math.max(0,renewAt-now),due:renewAt<=now,expired:expiresAt<=now};
};

// A document whose parent is not itself is inside someone's frame. Under Node
// there is no `parent` at all, which is not a frame.
const framed=environment=>{try{const parent=environment?.parent;return !!parent&&parent!==environment;}catch{return true;}};

// The renewal callback lands on the ordinary redirect URI, so the application
// itself loads inside the hidden frame. That framed instance must do exactly
// two things: hand the callback query up to the tab that started the renewal,
// and then refuse to run. It must never reach the shared sessionStorage - the
// live session record is one key away and a framed instance completing its own
// redirect would clear it. Returning true here is also the reason a top-level
// REFS page can no longer be silently framed by a third party at all.
export const respondFromRenewalFrame=(environment=globalThis)=>{
  if(!framed(environment))return false;
  const config=oidcRuntimeConfig(environment);
  const search=String(environment?.location?.search||'');
  try{
    if(config&&typeof environment.parent?.postMessage==='function')
      environment.parent.postMessage({type:RENEWAL_MESSAGE,search},new URL(config.redirectUri).origin);
  }catch{/* a parent that cannot be posted to simply lets the starter time out */}
  return true;
};

export class BrowserOidcClient {
  constructor({environment=globalThis,fetcher=globalThis.fetch,now=()=>Date.now()}={}){this.environment=environment;this.fetcher=fetcher;this.now=now;this.config=oidcRuntimeConfig(environment);this.renewing=false;}
  configured(){return !!this.config&&typeof this.fetcher==='function'&&!!this.environment.crypto?.subtle&&!!this.environment.sessionStorage;}
  session(){const value=load(this.environment);return value?.kind==='token'&&typeof value.accessToken==='string'?value:null;}
  sessionExpiresAt(){const session=this.session();return session&&Number.isSafeInteger(session.expiresAt)?session.expiresAt:null;}
  sessionSubject(){return text(this.session()?.subject);}
  async getAccessToken(){const session=this.session();if(!session||!Number.isSafeInteger(session.expiresAt)||session.expiresAt<=this.now()+30000)throw new Error('OIDC access token is unavailable or expired');return session.accessToken;}
  async startLogin(){
    if(!this.configured())throw new Error('OIDC browser configuration is unavailable');
    const state=random(this.environment),verifier=random(this.environment),challenge=await digest(this.environment,verifier);
    save(this.environment,{kind:'pending',state,verifier,createdAt:this.now()});
    const query=new URLSearchParams({response_type:'code',client_id:this.config.clientId,redirect_uri:this.config.redirectUri,scope:this.config.scope,state,code_challenge:challenge,code_challenge_method:'S256'});if(this.config.audience)query.set('audience',this.config.audience);
    this.environment.location.assign(`${this.config.authorizationEndpoint}${this.config.authorizationEndpoint.includes('?')?'&':'?'}${query}`);
  }
  async completeRedirect(){
    if(respondFromRenewalFrame(this.environment))return {ok:false,code:'OIDC_FRAMED_CONTEXT'};
    if(!this.configured())return {ok:false,code:'OIDC_CONFIGURATION_REQUIRED'};
    const params=new URLSearchParams(this.environment.location.search||'');const code=params.get('code'),state=params.get('state'),error=params.get('error');
    if(error){clear(this.environment);return {ok:false,code:'OIDC_LOGIN_REJECTED'};}
    if(!code)return this.session()?{ok:true}: {ok:false,code:'OIDC_LOGIN_REQUIRED'};
    const pending=load(this.environment);if(!pending||pending.kind!=='pending'||pending.state!==state||!Number.isSafeInteger(pending.createdAt)||pending.createdAt+600000<this.now()){clear(this.environment);return {ok:false,code:'OIDC_STATE_INVALID'};}
    let response,body;try{response=await this.fetcher(this.config.tokenEndpoint,{method:'POST',headers:{accept:'application/json','content-type':'application/x-www-form-urlencoded'},body:new URLSearchParams({grant_type:'authorization_code',code,redirect_uri:this.config.redirectUri,client_id:this.config.clientId,code_verifier:pending.verifier}).toString(),cache:'no-store',redirect:'error'});body=await response.json();}catch{clear(this.environment);return {ok:false,code:'OIDC_TOKEN_UNAVAILABLE'};}
    const accepted=response?.ok?acceptToken(body,this.config,this.now()):null;
    if(!accepted){clear(this.environment);return {ok:false,code:'OIDC_TOKEN_INVALID'};}
    save(this.environment,accepted);this.environment.history?.replaceState?.({},'',this.config.redirectUri);return {ok:true};
  }

  // Attempt one prompt=none renewal. Resolves to {ok:true,expiresAt} or to a
  // named failure. Never throws, never navigates, never touches the stored
  // session unless a fully validated, subject-matched, strictly longer-lived
  // token arrived.
  async renewSilently({timeoutMs=RENEWAL_TIMEOUT_MS}={}){
    if(!this.configured())return renewalFail('OIDC_RENEWAL_UNAVAILABLE','This deployment has no usable OIDC configuration, so no renewal was attempted.');
    if(this.renewing)return renewalFail('OIDC_RENEWAL_UNAVAILABLE','A silent renewal is already in flight in this tab.');
    const session=this.session(),subject=text(session?.subject);
    if(!session||!Number.isSafeInteger(session.expiresAt))return renewalFail('OIDC_RENEWAL_UNAVAILABLE','No verified OIDC session is held in this tab, so there is nothing to renew.');
    if(!subject)return renewalFail('OIDC_RENEWAL_UNAVAILABLE','The access token this session holds carries no subject claim, so a renewed token could not be proven to name the same person. Renewal is refused rather than guessed.');
    const environment=this.environment,document=environment.document;
    if(!document?.createElement||!document.body?.appendChild||typeof environment.addEventListener!=='function'||typeof environment.setTimeout!=='function')
      return renewalFail('OIDC_RENEWAL_UNAVAILABLE','This runtime cannot open the hidden frame a prompt=none renewal requires.');
    if(framed(environment))return renewalFail('OIDC_RENEWAL_UNAVAILABLE','This document is itself framed and must not start a renewal.');

    this.renewing=true;
    let state,verifier,challenge;
    try{state=random(environment);verifier=random(environment);challenge=await digest(environment,verifier);}
    catch{this.renewing=false;return renewalFail('OIDC_RENEWAL_UNAVAILABLE','Browser cryptography for a PKCE renewal is unavailable.');}

    const query=new URLSearchParams({response_type:'code',client_id:this.config.clientId,redirect_uri:this.config.redirectUri,scope:this.config.scope,state,code_challenge:challenge,code_challenge_method:'S256',prompt:'none'});
    if(this.config.audience)query.set('audience',this.config.audience);
    const origin=new URL(this.config.redirectUri).origin;
    const frame=document.createElement('iframe');
    frame.setAttribute?.('title','OIDC silent renewal');frame.setAttribute?.('aria-hidden','true');frame.setAttribute?.('tabindex','-1');
    if(frame.style)frame.style.cssText='position:absolute;width:0;height:0;border:0;visibility:hidden';
    frame.src=`${this.config.authorizationEndpoint}${this.config.authorizationEndpoint.includes('?')?'&':'?'}${query}`;

    return new Promise(resolve=>{
      let answered=false,settled=false,timer=null;
      const finish=result=>{
        if(settled)return;settled=true;
        try{environment.clearTimeout?.(timer);}catch{/* non-fatal */}
        try{environment.removeEventListener('message',onMessage);}catch{/* non-fatal */}
        try{if(typeof frame.remove==='function')frame.remove();else frame.parentNode?.removeChild?.(frame);}catch{/* non-fatal */}
        this.renewing=false;resolve(result);
      };
      // Three independent checks before a message is believed: it came from this
      // application's own origin, it came from the frame this call created, and
      // it carries the state this call generated. Anything else is discarded
      // without a word, so a hostile postMessage cannot force an outcome - it
      // can only let the attempt time out, which is already a named failure.
      const onMessage=event=>{
        if(answered||settled)return;
        if(event?.origin!==origin)return;
        const source=event.source;
        if(source&&frame.contentWindow&&source!==frame.contentWindow)return;
        const data=event.data;
        if(!data||data.type!==RENEWAL_MESSAGE||typeof data.search!=='string')return;
        let carried=null;try{carried=new URLSearchParams(data.search).get('state');}catch{return;}
        if(carried!==state)return;
        answered=true;
        try{environment.clearTimeout?.(timer);}catch{/* non-fatal */}
        this.completeRenewal(data.search,verifier,subject).then(finish,()=>finish(renewalFail('OIDC_RENEWAL_INVALID','The renewal response could not be completed.')));
      };
      environment.addEventListener('message',onMessage);
      timer=environment.setTimeout(()=>{if(!answered)finish(renewalFail('OIDC_RENEWAL_BLOCKED',`No renewal answer arrived within ${timeoutMs}ms. The identity provider did not load in a hidden frame, or it refuses to be framed at all.`));},timeoutMs);
      try{document.body.appendChild(frame);}
      catch{finish(renewalFail('OIDC_RENEWAL_UNAVAILABLE','The hidden renewal frame could not be attached to this document.'));}
    });
  }

  async completeRenewal(search,verifier,subject){
    let params;try{params=new URLSearchParams(search||'');}catch{return renewalFail('OIDC_RENEWAL_INVALID','The renewal answer was not a readable callback query.');}
    const error=text(params.get('error'));
    if(error)return renewalFail('OIDC_RENEWAL_REFUSED',`The identity provider refused a prompt=none renewal with "${error}". The provider session is not usable from a hidden frame on this page, which is also what a browser blocking third-party cookies produces.`);
    const code=text(params.get('code'));
    if(!code)return renewalFail('OIDC_RENEWAL_INVALID','The renewal answer carried neither an authorization code nor an error.');
    let response,body;
    try{response=await this.fetcher(this.config.tokenEndpoint,{method:'POST',headers:{accept:'application/json','content-type':'application/x-www-form-urlencoded'},body:new URLSearchParams({grant_type:'authorization_code',code,redirect_uri:this.config.redirectUri,client_id:this.config.clientId,code_verifier:verifier}).toString(),cache:'no-store',redirect:'error'});body=await response.json();}
    catch{return renewalFail('OIDC_RENEWAL_UNREACHABLE','The renewal token request produced no usable response at all.');}
    const accepted=response?.ok?acceptToken(body,this.config,this.now()):null;
    if(!accepted)return renewalFail('OIDC_RENEWAL_INVALID','The renewed token failed the same issuer, audience, token-type and expiry checks the interactive sign-in applies. It was discarded.');
    if(accepted.subject!==subject)return renewalFail('OIDC_RENEWAL_SUBJECT_MISMATCH','The renewed token names a different subject than the session it would have replaced. It was discarded and the existing session was left exactly as it was.');
    // Re-read rather than trusting the record captured before the round trip: a
    // sign-out, or another tab, may have replaced it while the frame was open.
    const current=this.session();
    if(!current||!Number.isSafeInteger(current.expiresAt)||text(current.subject)!==subject)return renewalFail('OIDC_RENEWAL_SUBJECT_MISMATCH','The session changed while the renewal was in flight, so the renewed token was discarded rather than written over whatever replaced it.');
    if(accepted.expiresAt<=current.expiresAt)return renewalFail('OIDC_RENEWAL_INVALID','The renewed token expires no later than the one it would replace, so it renews nothing. It was discarded.');
    save(this.environment,accepted);
    return {ok:true,expiresAt:accepted.expiresAt};
  }

  logout(){clear(this.environment);}
}

export const bootstrapRuntimeOidc=(environment=globalThis)=>{const client=new BrowserOidcClient({environment});if(client.configured())environment.refsOidcClient=client;return client;};
