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

export class BrowserOidcClient {
  constructor({environment=globalThis,fetcher=globalThis.fetch,now=()=>Date.now()}={}){this.environment=environment;this.fetcher=fetcher;this.now=now;this.config=oidcRuntimeConfig(environment);}
  configured(){return !!this.config&&typeof this.fetcher==='function'&&!!this.environment.crypto?.subtle&&!!this.environment.sessionStorage;}
  session(){const value=load(this.environment);return value?.kind==='token'&&typeof value.accessToken==='string'?value:null;}
  async getAccessToken(){const session=this.session();if(!session||!Number.isSafeInteger(session.expiresAt)||session.expiresAt<=this.now()+30000)throw new Error('OIDC access token is unavailable or expired');return session.accessToken;}
  async startLogin(){
    if(!this.configured())throw new Error('OIDC browser configuration is unavailable');
    const state=random(this.environment),verifier=random(this.environment),challenge=await digest(this.environment,verifier);
    save(this.environment,{kind:'pending',state,verifier,createdAt:this.now()});
    const query=new URLSearchParams({response_type:'code',client_id:this.config.clientId,redirect_uri:this.config.redirectUri,scope:this.config.scope,state,code_challenge:challenge,code_challenge_method:'S256'});if(this.config.audience)query.set('audience',this.config.audience);
    this.environment.location.assign(`${this.config.authorizationEndpoint}${this.config.authorizationEndpoint.includes('?')?'&':'?'}${query}`);
  }
  async completeRedirect(){
    if(!this.configured())return {ok:false,code:'OIDC_CONFIGURATION_REQUIRED'};
    const params=new URLSearchParams(this.environment.location.search||'');const code=params.get('code'),state=params.get('state'),error=params.get('error');
    if(error){clear(this.environment);return {ok:false,code:'OIDC_LOGIN_REJECTED'};}
    if(!code)return this.session()?{ok:true}: {ok:false,code:'OIDC_LOGIN_REQUIRED'};
    const pending=load(this.environment);if(!pending||pending.kind!=='pending'||pending.state!==state||!Number.isSafeInteger(pending.createdAt)||pending.createdAt+600000<this.now()){clear(this.environment);return {ok:false,code:'OIDC_STATE_INVALID'};}
    let response,body;try{response=await this.fetcher(this.config.tokenEndpoint,{method:'POST',headers:{accept:'application/json','content-type':'application/x-www-form-urlencoded'},body:new URLSearchParams({grant_type:'authorization_code',code,redirect_uri:this.config.redirectUri,client_id:this.config.clientId,code_verifier:pending.verifier}).toString(),cache:'no-store',redirect:'error'});body=await response.json();}catch{clear(this.environment);return {ok:false,code:'OIDC_TOKEN_UNAVAILABLE'};}
    if(!response.ok||typeof body?.access_token!=='string'||!body.access_token||body.token_type?.toLowerCase()!=='bearer'||!Number.isSafeInteger(body.expires_in)||body.expires_in<30||body.expires_in>3600){clear(this.environment);return {ok:false,code:'OIDC_TOKEN_INVALID'};}
    const claims=tokenClaims(body.access_token),audiences=Array.isArray(claims?.aud)?claims.aud:[claims?.aud];if(claims?.iss?.replace(/\/$/,'')!==this.config.issuer||!Number.isInteger(claims?.exp)||claims.exp*1000<=this.now()+30000||(this.config.audience&&!audiences.includes(this.config.audience))){clear(this.environment);return {ok:false,code:'OIDC_TOKEN_INVALID'};}
    save(this.environment,{kind:'token',accessToken:body.access_token,expiresAt:Math.min(this.now()+body.expires_in*1000,claims.exp*1000)});this.environment.history?.replaceState?.({},'',this.config.redirectUri);return {ok:true};
  }
  logout(){clear(this.environment);}
}

export const bootstrapRuntimeOidc=(environment=globalThis)=>{const client=new BrowserOidcClient({environment});if(client.configured())environment.refsOidcClient=client;return client;};
