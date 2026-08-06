// Deployment adapter renderer.
//
// One build step renders two coupled artefacts: the deployment adapter
// (dist/refs-runtime-config.js) and the release-channel stamp appended to the
// build metadata (dist/refs-build.js). The browser honours the demonstration
// data set only when both agree, so a published site cannot serve demo data
// under an authoritative build stamp, or claim authority while carrying a mock
// adapter. See src/runtime-mode.mjs for the browser side of the same contract.
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ACCOUNT=/^[A-Za-z0-9._-]{1,64}$/;
const keys=['REFS_PUBLIC_ACCOUNTING_API_BASE_URL','REFS_PUBLIC_ENTITY_ID','REFS_PUBLIC_PERIOD_ID','REFS_PUBLIC_CASH_ACCOUNT_CODE','REFS_PUBLIC_OIDC_ISSUER','REFS_PUBLIC_OIDC_AUTHORIZATION_ENDPOINT','REFS_PUBLIC_OIDC_TOKEN_ENDPOINT','REFS_PUBLIC_OIDC_REDIRECT_URI','REFS_PUBLIC_OIDC_CLIENT_ID','REFS_PUBLIC_OIDC_AUDIENCE'];
const https=value=>{try{const url=new URL(value);return url.protocol==='https:'&&!url.username&&!url.password?url.toString():null;}catch{return null;}};

export const AUTHORITATIVE_CHANNEL='AUTHORITATIVE';
export const DEMONSTRATION_CHANNEL='PUBLIC_DEMONSTRATION';
export const DEMONSTRATION_MODE='LOCAL_MOCK';

const coordinatesPresent=environment=>keys.filter(key=>typeof environment[key]==='string'&&environment[key].trim());

export const requestedRuntimeMode=(environment={})=>(environment.REFS_PUBLIC_RUNTIME_MODE||'').trim();

// The channel is derived from the same environment that renders the adapter, so
// the two artefacts cannot disagree unless one of them is edited after the build.
export const resolveRuntimeChannel=(environment={})=>
  requestedRuntimeMode(environment)===DEMONSTRATION_MODE?DEMONSTRATION_CHANNEL:AUTHORITATIVE_CHANNEL;

export const renderBuildChannelStamp=(environment={})=>{
  const channel=resolveRuntimeChannel(environment);
  return `// Release channel stamped by the same build step that rendered the deployment adapter.\nwindow.__BUILD=Object.assign(window.__BUILD||{},{channel:${JSON.stringify(channel)},authoritative:${channel===AUTHORITATIVE_CHANNEL}});\n`;
};

export const renderFailClosedRuntimeConfig=()=>`// Generated fail-closed deployment configuration. No provider coordinates were supplied.\nwindow.__REFS_OIDC__=null;\nwindow.__REFS_ACCOUNTING_API__=null;\nwindow.__REFS_RUNTIME_MODE__='REQUIRES_AUTHORITATIVE_API';\n`;

export const renderLocalMockRuntimeConfig=()=>`// Generated explicit public demonstration configuration. Never treat this as provider or production evidence.\nwindow.__REFS_OIDC__=null;\nwindow.__REFS_ACCOUNTING_API__=null;\nwindow.__REFS_RUNTIME_MODE__='LOCAL_MOCK';\n`;

export const renderRuntimeConfig=(environment={})=>{
  const present=coordinatesPresent(environment);
  if(present.length===0)return null;
  if(present.length!==keys.length)throw new Error(`Runtime public configuration is incomplete: missing ${keys.filter(key=>!present.includes(key)).join(', ')}`);
  const baseUrl=https(environment.REFS_PUBLIC_ACCOUNTING_API_BASE_URL),issuer=https(environment.REFS_PUBLIC_OIDC_ISSUER),authorizationEndpoint=https(environment.REFS_PUBLIC_OIDC_AUTHORIZATION_ENDPOINT),tokenEndpoint=https(environment.REFS_PUBLIC_OIDC_TOKEN_ENDPOINT),redirectUri=https(environment.REFS_PUBLIC_OIDC_REDIRECT_URI),entityId=environment.REFS_PUBLIC_ENTITY_ID.trim(),periodId=environment.REFS_PUBLIC_PERIOD_ID.trim(),cashAccountCode=environment.REFS_PUBLIC_CASH_ACCOUNT_CODE.trim(),clientId=environment.REFS_PUBLIC_OIDC_CLIENT_ID.trim(),audience=environment.REFS_PUBLIC_OIDC_AUDIENCE.trim(),scope=(environment.REFS_PUBLIC_OIDC_SCOPE||'openid profile').trim();
  if(!baseUrl||!issuer||!authorizationEndpoint||!tokenEndpoint||!redirectUri||!UUID.test(entityId)||!UUID.test(periodId)||!ACCOUNT.test(cashAccountCode)||!clientId||clientId.length>256||!audience||audience.length>256||!scope.split(/\s+/).includes('openid'))throw new Error('Runtime public configuration contains an invalid HTTPS URL, OIDC value, UUID, or account code');
  return `// Generated at deployment. Contains public endpoints only; never put tokens or secrets here.\nwindow.__REFS_OIDC__=${JSON.stringify({issuer:issuer.replace(/\/$/,''),authorizationEndpoint,tokenEndpoint,redirectUri,clientId,audience,scope})};\nwindow.__REFS_ACCOUNTING_API__={baseUrl:${JSON.stringify(baseUrl.replace(/\/$/,''))},entityId:${JSON.stringify(entityId)},periodId:${JSON.stringify(periodId)},cashAccountCode:${JSON.stringify(cashAccountCode)},getAccessToken:async()=>window.refsOidcClient?.getAccessToken()};\nwindow.__REFS_RUNTIME_MODE__='REQUIRES_AUTHORITATIVE_API';\n`;
};

export const renderRuntimeConfigOrLock=(environment={})=>{
  const requestedMode=requestedRuntimeMode(environment);
  if(requestedMode===DEMONSTRATION_MODE){
    // A demonstration build must not also be pointed at a real accounting API.
    // Publishing both is how a demo silently becomes "the live site".
    const configured=coordinatesPresent(environment);
    if(configured.length)throw new Error(`A public demonstration build must not carry authoritative deployment coordinates: ${configured.join(', ')}`);
    return renderLocalMockRuntimeConfig();
  }
  if(requestedMode)throw new Error(`Unsupported public runtime mode: ${requestedMode}`);
  return renderRuntimeConfig(environment)??renderFailClosedRuntimeConfig();
};
