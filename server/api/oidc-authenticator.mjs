import {createPublicKey,verify} from 'node:crypto';
import {AccountingApiError} from './accounting-http.mjs';

const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const decodeJson=part=>{try{return JSON.parse(Buffer.from(part,'base64url').toString('utf8'));}catch{throw new AccountingApiError(401,'INVALID_ACCESS_TOKEN','Access token is malformed');}};
const authHeader=headers=>{if(typeof headers?.get==='function')return headers.get('authorization');const key=Object.keys(headers||{}).find(value=>value.toLowerCase()==='authorization');return key?headers[key]:null;};
const deny=message=>{throw new AccountingApiError(401,'INVALID_ACCESS_TOKEN',message);};

export class RemoteJwksResolver{
  constructor({jwksUri,fetcher=globalThis.fetch,cacheTtlMs=300000,timeoutMs=5000,maxBytes=1024*1024}={}){
    let uri;try{uri=new URL(jwksUri);}catch{throw new Error('jwksUri must be a valid URL');}
    if(uri.protocol!=='https:')throw new Error('jwksUri must use HTTPS');
    if(typeof fetcher!=='function')throw new Error('JWKS fetch implementation is required');
    this.uri=uri;this.fetcher=fetcher;this.cacheTtlMs=cacheTtlMs;this.timeoutMs=timeoutMs;this.maxBytes=maxBytes;this.keys=new Map();this.expiresAt=0;
  }
  async refresh(){
    const controller=new AbortController();const timer=setTimeout(()=>controller.abort(),this.timeoutMs);
    try{
      const response=await this.fetcher(this.uri,{headers:{accept:'application/json'},signal:controller.signal,redirect:'error'});
      if(!response.ok)throw new Error(`JWKS endpoint returned ${response.status}`);
      const bytes=Buffer.from(await response.arrayBuffer());if(bytes.length>this.maxBytes)throw new Error('JWKS response exceeds limit');
      const body=JSON.parse(bytes.toString('utf8'));if(!Array.isArray(body.keys)||body.keys.length===0)throw new Error('JWKS has no keys');
      const keys=new Map();for(const jwk of body.keys){if(!jwk?.kid||jwk.use!=='sig'||jwk.kty!=='RSA'||jwk.alg!=='RS256')continue;if(keys.has(jwk.kid))throw new Error('JWKS contains duplicate kid');keys.set(jwk.kid,createPublicKey({key:jwk,format:'jwk'}));}
      if(keys.size===0)throw new Error('JWKS has no eligible signing keys');this.keys=keys;this.expiresAt=Date.now()+this.cacheTtlMs;
    }finally{clearTimeout(timer);}
  }
  async resolve(kid){if(Date.now()>=this.expiresAt||!this.keys.has(kid))await this.refresh();const key=this.keys.get(kid);if(!key)deny('Signing key is unknown');return key;}
}

export class OidcJwtAuthenticator{
  constructor({issuer,audience,keyResolver,tenantClaim='tenant_id',subjectClaim='sub',clock=()=>Date.now(),clockSkewSeconds=30,maxTokenLifetimeSeconds=3600}={}){
    if(typeof issuer!=='string'||!issuer.startsWith('https://'))throw new Error('OIDC issuer must use HTTPS');
    if(typeof audience!=='string'||!audience)throw new Error('OIDC audience is required');
    if(!keyResolver||typeof keyResolver.resolve!=='function')throw new Error('OIDC keyResolver is required');
    this.issuer=issuer.replace(/\/$/,'');this.audience=audience;this.keyResolver=keyResolver;this.tenantClaim=tenantClaim;this.subjectClaim=subjectClaim;this.clock=clock;this.clockSkewSeconds=clockSkewSeconds;this.maxTokenLifetimeSeconds=maxTokenLifetimeSeconds;
  }
  async authenticate({headers}={}){
    const authorization=authHeader(headers);if(typeof authorization!=='string'||!/^Bearer [^ ]+$/.test(authorization))throw new AccountingApiError(401,'AUTHENTICATION_REQUIRED','Bearer access token is required');
    const token=authorization.slice(7),parts=token.split('.');if(parts.length!==3)deny('Access token is malformed');
    const protectedHeader=decodeJson(parts[0]),claims=decodeJson(parts[1]);
    if(protectedHeader.alg!=='RS256'||typeof protectedHeader.kid!=='string'||!protectedHeader.kid||protectedHeader.crit!==undefined)deny('Access token header is not allowed');
    if(protectedHeader.typ!==undefined&&protectedHeader.typ!=='JWT'&&protectedHeader.typ!=='at+jwt')deny('Access token type is not allowed');
    let key;try{key=await this.keyResolver.resolve(protectedHeader.kid);}catch(error){if(error instanceof AccountingApiError)throw error;deny('Signing key is unavailable');}
    if(!verify('RSA-SHA256',Buffer.from(`${parts[0]}.${parts[1]}`),key,Buffer.from(parts[2],'base64url')))deny('Access token signature is invalid');
    const now=Math.floor(this.clock()/1000),skew=this.clockSkewSeconds;
    if(claims.iss?.replace(/\/$/,'')!==this.issuer)deny('Access token issuer is invalid');
    const audiences=Array.isArray(claims.aud)?claims.aud:[claims.aud];if(!audiences.includes(this.audience))deny('Access token audience is invalid');
    if(!Number.isInteger(claims.iat)||!Number.isInteger(claims.exp)||claims.iat>now+skew||claims.exp<=now-skew||claims.exp<=claims.iat||claims.exp-claims.iat>this.maxTokenLifetimeSeconds)deny('Access token lifetime is invalid');
    if(claims.nbf!==undefined&&(!Number.isInteger(claims.nbf)||claims.nbf>now+skew))deny('Access token is not active');
    const tenantId=claims[this.tenantClaim],actorId=claims[this.subjectClaim];if(!UUID.test(tenantId||'')||typeof actorId!=='string'||actorId.length<1||actorId.length>200)deny('Required identity claims are invalid');
    return {trusted:true,tenantId,actorId,tokenId:typeof claims.jti==='string'?claims.jti:null};
  }
}
