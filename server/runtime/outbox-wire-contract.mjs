import { createHash } from 'node:crypto';
import { containsAiSecret, safeAiEvidenceTree } from './ai-secret-safety.mjs';

const SECRET_KEY=/(authorization|credential|password|secret|token|cookie|api[_-]?key|private[_-]?key|database[_-]?url|raw[_-]?(payload|request|response|package|prompt))/i;
const OAUTH_JWT=/(?:\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b|\bya29\.[A-Za-z0-9_-]{8,}\b|\b(?:oauth|access[_ -]?token|refresh[_ -]?token|cookie|set-cookie|database[_-]?url)\b["']?\s*[:=]\s*[^\s,;]+)/i;
const KEYS=['aggregate_id','aggregate_type','attempt_count','created_at','entity_id','event_type','outbox_event_id','payload','payload_hash','schema_version','tenant_id'];
const texts=new WeakMap();
const fail=code=>{throw Object.assign(new Error(code),{code,retryable:false});};
export const payloadHash=text=>'sha256:'+createHash('sha256').update(text,'utf8').digest('hex');
export const containsOutboxSecretText=value=>typeof value==='string'&&(containsAiSecret(value)||OAUTH_JWT.test(value));
export function safeOutboxPayload(value,depth=0){
  if(depth>32)return false;
  if(typeof value==='string')return !containsOutboxSecretText(value);
  if(value&&typeof value==='object')return Object.entries(value).every(([key,nested])=>!SECRET_KEY.test(key)&&!['__proto__','constructor','prototype'].includes(key)&&safeOutboxPayload(nested,depth+1));
  return true;
}
export function sealOutboxPayload(event,canonicalPayloadText){
  if(!event||JSON.stringify(Object.keys(event).sort())!==JSON.stringify(KEYS)||event.schema_version!=='REFS_OUTBOX_EVENT_V1'||typeof canonicalPayloadText!=='string'||Buffer.byteLength(canonicalPayloadText)>1000000)fail('OUTBOX_EVENT_CONTRACT_INVALID');
  let parsed;try{parsed=JSON.parse(canonicalPayloadText);}catch{fail('OUTBOX_EVENT_CONTRACT_INVALID');}
  if(!parsed||typeof parsed!=='object'||Array.isArray(parsed))fail('OUTBOX_EVENT_CONTRACT_INVALID');
  // Parsed numbers are used only for traversal, never for hashing/serialization.
  if(!safeAiEvidenceTree(parsed)||!safeOutboxPayload({...event,payload:parsed}))fail('OUTBOX_EVENT_SECRET_DENIED');
  if(payloadHash(canonicalPayloadText)!==event.payload_hash)fail('OUTBOX_EVENT_PAYLOAD_HASH_INVALID');
  const sealed=Object.freeze({...event,payload:parsed});texts.set(sealed,canonicalPayloadText);return sealed;
}
export function serializeOutboxEvent(event){
  const canonical=texts.get(event);
  if(canonical===undefined)fail('OUTBOX_EVENT_CANONICAL_PAYLOAD_REQUIRED');
  const fields=Object.entries(event).filter(([key])=>key!=='payload').map(([key,value])=>`${JSON.stringify(key)}:${JSON.stringify(value)}`);
  return `{${fields.join(',')},"payload":${canonical}}`;
}
