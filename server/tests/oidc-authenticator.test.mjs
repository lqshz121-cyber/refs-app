import test from 'node:test';import assert from 'node:assert/strict';import {generateKeyPairSync,randomUUID,sign} from 'node:crypto';
import {OidcJwtAuthenticator,REFS_TENANT_CLAIM,RemoteJwksResolver} from '../api/oidc-authenticator.mjs';
import {createProductionAccountingServer} from '../runtime/accounting-server.mjs';

const {privateKey,publicKey}=generateKeyPairSync('rsa',{modulusLength:2048});const jwk=publicKey.export({format:'jwk'});Object.assign(jwk,{kid:'key-1',use:'sig',alg:'RS256'});
const now=2_000_000_000,tenantId=randomUUID();
const token=(claims={},header={})=>{const h=Buffer.from(JSON.stringify({alg:'RS256',kid:'key-1',typ:'at+jwt',...header})).toString('base64url');const p=Buffer.from(JSON.stringify({iss:'https://iam.example.com',aud:'refs-accounting',sub:'user-1',[REFS_TENANT_CLAIM]:tenantId,iat:now-10,exp:now+300,...claims})).toString('base64url');return `${h}.${p}.${sign('RSA-SHA256',Buffer.from(`${h}.${p}`),privateKey).toString('base64url')}`;};
const resolver={resolve:async kid=>{if(kid!=='key-1')throw new Error('unknown');return publicKey;}};
const authenticator=new OidcJwtAuthenticator({issuer:'https://iam.example.com',audience:'refs-accounting',keyResolver:resolver,clock:()=>now*1000});
const authenticate=value=>authenticator.authenticate({headers:{authorization:`Bearer ${value}`}});

test('OIDC authenticator verifies signature and derives tenant and actor only from signed claims',async()=>{
  assert.deepEqual(await authenticate(token()),{trusted:true,tenantId,actorId:'user-1',tokenId:null});
});

test('OIDC authenticator rejects issuer, audience, lifetime, algorithm, key and signature attacks',async()=>{
  for(const candidate of [token({iss:'https://evil.example'}),token({aud:'other'}),token({exp:now-100}),token({iat:now+100}),token({exp:now+4000}),token({}, {alg:'none'}),token({}, {kid:'unknown'}),token().slice(0,-2)+'aa'])await assert.rejects(authenticate(candidate),error=>error.status===401);
});

test('OIDC authenticator rejects missing or invalid identity claims and malformed bearer syntax',async()=>{
  await assert.rejects(authenticate(token({[REFS_TENANT_CLAIM]:'not-uuid'})),error=>error.code==='INVALID_ACCESS_TOKEN'&&error.message==='Tenant identity claim is invalid');
  await assert.rejects(authenticate(token({sub:''})),error=>error.code==='INVALID_ACCESS_TOKEN'&&error.message==='Subject identity claim is invalid');
  await assert.rejects(authenticator.authenticate({headers:{authorization:'Basic abc'}}),error=>error.code==='AUTHENTICATION_REQUIRED');
});

test('remote JWKS requires HTTPS, filters non-signing keys, caches and rejects duplicate kid',async()=>{
  assert.throws(()=>new RemoteJwksResolver({jwksUri:'http://iam.example/jwks'}),/HTTPS/);
  let calls=0;const fetcher=async()=>{calls++;return new Response(JSON.stringify({keys:[jwk,{...jwk,kid:'ignored',use:'enc'}]}),{status:200});};
  const remote=new RemoteJwksResolver({jwksUri:'https://iam.example/jwks',fetcher});await remote.resolve('key-1');await remote.resolve('key-1');assert.equal(calls,1);
  const duplicate=new RemoteJwksResolver({jwksUri:'https://iam.example/jwks',fetcher:async()=>new Response(JSON.stringify({keys:[jwk,jwk]}),{status:200})});await assert.rejects(duplicate.resolve('key-1'),/duplicate kid/);
});

test('production server composition fails closed without isolated pools or authenticator',()=>{
  assert.throws(()=>createProductionAccountingServer({}),/requires runtime pool/);
});
