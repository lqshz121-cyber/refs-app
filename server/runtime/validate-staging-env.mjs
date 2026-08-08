import {fileURLToPath} from 'node:url';
import {resolve} from 'node:path';
import {renderRuntimeConfig} from '../../scripts/runtime-config-lib.mjs';
import {stagingSmokeConfig} from './test-staging-smoke.mjs';

const backendRequired=[
  'DATABASE_URL','MIGRATION_DATABASE_URL','CONTEXT_ISSUER_DATABASE_URL','GRANT_SYNC_DATABASE_URL',
  'OIDC_ISSUER','OIDC_AUDIENCE','OIDC_JWKS_URI','REFS_HTTP_ALLOWED_ORIGINS',
  'S3_ENDPOINT','S3_BUCKET','S3_REGION','S3_ACCESS_KEY_ID','S3_SECRET_ACCESS_KEY',
  'VIRUS_SCANNER_ENDPOINT','VIRUS_SCANNER_TOKEN','VIRUS_SCANNER_CA_FILE','VIRUS_SCANNER_SERVER_NAME',
  'ATTACHMENT_SCANNER_ACTOR_ID','ATTACHMENT_CLEANUP_ACTOR_ID','ATTACHMENT_CLEANUP_SCOPES',
  'WBS_SNAPSHOT_ED25519_PUBLIC_KEYS','REFS_STAGING_API_BASE_URL','REFS_STAGING_WEB_ORIGIN'
];
const publicKeys=[
  'REFS_PUBLIC_ACCOUNTING_API_BASE_URL','REFS_PUBLIC_ENTITY_ID','REFS_PUBLIC_PERIOD_ID','REFS_PUBLIC_CASH_ACCOUNT_CODE',
  'REFS_PUBLIC_OIDC_ISSUER','REFS_PUBLIC_OIDC_AUTHORIZATION_ENDPOINT','REFS_PUBLIC_OIDC_TOKEN_ENDPOINT',
  'REFS_PUBLIC_OIDC_REDIRECT_URI','REFS_PUBLIC_OIDC_CLIENT_ID','REFS_PUBLIC_OIDC_AUDIENCE','REFS_PUBLIC_OIDC_SCOPE'
];
const present=value=>typeof value==='string'&&value.trim().length>0;
const httpsUrl=(value,name)=>{
  let url;try{url=new URL(value);}catch{throw new Error(`staging-env: ${name} must be HTTPS`);}
  if(url.protocol!=='https:'||url.username||url.password)throw new Error(`staging-env: ${name} must be HTTPS`);
  return url;
};
const exactOrigins=value=>String(value||'').split(',').map(item=>item.trim()).filter(Boolean).map(item=>{
  const url=httpsUrl(item,'REFS_HTTP_ALLOWED_ORIGINS');
  if(url.pathname!=='/'||url.search||url.hash)throw new Error('staging-env: REFS_HTTP_ALLOWED_ORIGINS must contain HTTPS origins only');
  return url.origin;
});
const validateWbsKeyring=value=>{
  let keyring;try{keyring=JSON.parse(value);}catch{throw new Error('staging-env: WBS_SNAPSHOT_ED25519_PUBLIC_KEYS must be JSON');}
  if(!keyring||typeof keyring!=='object'||Array.isArray(keyring)||!Object.keys(keyring).length)throw new Error('staging-env: WBS_SNAPSHOT_ED25519_PUBLIC_KEYS must be a non-empty keyring');
  for(const [keyId,key] of Object.entries(keyring)){
    if(!/^[A-Za-z0-9._-]{1,128}$/.test(keyId)||typeof key!=='string'||key.trim().length<32)throw new Error('staging-env: WBS_SNAPSHOT_ED25519_PUBLIC_KEYS contains an invalid public key entry');
  }
};

export function validateStagingEnvironment(environment=process.env){
  const missing=backendRequired.filter(key=>!present(environment[key]));
  if(missing.length)throw new Error(`staging-env: missing ${missing.join(', ')}`);
  const {apiBaseUrl,webOrigin}=stagingSmokeConfig(environment);
  const allowedOrigins=exactOrigins(environment.REFS_HTTP_ALLOWED_ORIGINS);
  if(!allowedOrigins.includes(webOrigin))throw new Error('staging-env: REFS_HTTP_ALLOWED_ORIGINS must include REFS_STAGING_WEB_ORIGIN exactly');
  for(const key of ['OIDC_ISSUER','OIDC_JWKS_URI','S3_ENDPOINT','VIRUS_SCANNER_ENDPOINT'])httpsUrl(environment[key],key);
  validateWbsKeyring(environment.WBS_SNAPSHOT_ED25519_PUBLIC_KEYS);
  const suppliedPublic=publicKeys.filter(key=>present(environment[key]));
  if(suppliedPublic.length){
    if(suppliedPublic.length!==publicKeys.length)throw new Error(`staging-env: public runtime configuration is incomplete (${publicKeys.filter(key=>!present(environment[key])).join(', ')})`);
    let adapter;try{adapter=renderRuntimeConfig(environment);}catch(error){throw new Error(`staging-env: public runtime configuration is invalid: ${error.message}`);}
    if(!adapter)throw new Error('staging-env: public runtime configuration is incomplete');
    const api=httpsUrl(environment.REFS_PUBLIC_ACCOUNTING_API_BASE_URL,'REFS_PUBLIC_ACCOUNTING_API_BASE_URL');
    const redirect=httpsUrl(environment.REFS_PUBLIC_OIDC_REDIRECT_URI,'REFS_PUBLIC_OIDC_REDIRECT_URI');
    if(api.origin!==apiBaseUrl)throw new Error('staging-env: public API origin must equal REFS_STAGING_API_BASE_URL');
    if(redirect.origin!==webOrigin)throw new Error('staging-env: public OIDC redirect URI must use REFS_STAGING_WEB_ORIGIN');
  }
  return {ok:true,apiBaseUrl,webOrigin,allowedOrigins,publicRuntimeConfigured:suppliedPublic.length===publicKeys.length};
}

if(process.argv[1]&&fileURLToPath(import.meta.url)===resolve(process.argv[1])){
  try{
    const result=validateStagingEnvironment();
    console.log(`staging-env: ${backendRequired.length}/${backendRequired.length} backend variables valid; public runtime configured=${result.publicRuntimeConfigured}`);
  }catch(error){console.error(error.message);process.exitCode=1;}
}
