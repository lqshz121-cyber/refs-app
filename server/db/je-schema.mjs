import {createHash} from 'node:crypto';

export const ok = data => ({ok:true,code:null,data});
export const fail = (code,message,details) => ({ok:false,code,message,...(details?{details}:{}),data:null});

export function canonicalHash(value) {
  const canonical = v => Array.isArray(v)?v.map(canonical):v&&typeof v==='object'?Object.fromEntries(Object.keys(v).sort().map(k=>[k,canonical(v[k])])):v;
  return `sha256:${createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex')}`;
}

export function validateAttachment(a,{actorId,maxSize=25*1024*1024,storageAdapter}={}) {
  if(!a||typeof a!=='object')return fail('ATTACHMENT_INVALID','Attachment record is required.');
  if(!/^ATT-[A-Za-z0-9_-]{6,60}$/.test(a.id||''))return fail('ATTACHMENT_ID_INVALID','Attachment id is invalid.');
  if(typeof a.name!=='string'||a.name.trim()!==a.name||a.name.length<1||a.name.length>255||/[\\/\0-\x1f]/.test(a.name)||a.name==='.'||a.name==='..')return fail('ATTACHMENT_NAME_INVALID','Attachment name must be a safe basename.');
  const allowed=new Set(['application/pdf','image/png','image/jpeg','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet','application/vnd.openxmlformats-officedocument.wordprocessingml.document']);
  if(!allowed.has(a.type))return fail('ATTACHMENT_TYPE_INVALID','Attachment MIME type is not allowed.');
  if(!Number.isSafeInteger(a.size)||a.size<1||a.size>maxSize)return fail('ATTACHMENT_SIZE_INVALID','Attachment size is invalid.');
  if(!/^sha256:[0-9a-f]{64}$/.test(a.hash||''))return fail('ATTACHMENT_HASH_INVALID','Attachment hash must be SHA-256.');
  if(typeof a.storage_ref!=='string'||a.storage_ref.length<1||a.storage_ref.length>512||/^(data|javascript):/i.test(a.storage_ref))return fail('ATTACHMENT_STORAGE_INVALID','Attachment storage_ref is invalid.');
  if(actorId&&a.uploaded_by!==actorId)return fail('ATTACHMENT_ACTOR_INVALID','uploaded_by must match the authenticated actor.');
  if(typeof a.uploaded_at!=='string'||!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(a.uploaded_at)||Number.isNaN(Date.parse(a.uploaded_at)))return fail('ATTACHMENT_TIME_INVALID','uploaded_at must be UTC RFC3339.');
  if(!storageAdapter?.inspect)return fail('ATTACHMENT_STORAGE_UNVERIFIED','A storage adapter is required.');
  const stored=storageAdapter.inspect(a.storage_ref);
  if(!stored)return fail('ATTACHMENT_STORAGE_MISSING','Stored attachment object does not exist.');
  if(stored.size!==a.size||stored.type!==a.type||stored.hash!==a.hash)return fail('ATTACHMENT_STORAGE_MISMATCH','Stored object metadata does not match the document record.');
  return ok(a);
}

export function validateTrace(je) {
  if(je.je_type!=='AUTO')return ok(je);
  const missing=['source_system','source_doc_id','rule_code','setting_used','mapping_used','idempotency_key'].filter(k=>!je[k]);
  return missing.length?fail('JE_AUTO_TRACE_MISSING','AUTO journal requires complete trace.',missing):ok(je);
}

export function validateAccounting(je,{isValidAccount=()=>true,requiresMember=()=>false}={}) {
  if(!Array.isArray(je.lines)||!je.lines.length)return fail('JE_LINES_REQUIRED','Journal lines are required.');
  let dr=0,cr=0;
  for(const [index,line] of je.lines.entries()){
    if(!line.account_code)return fail('JE_ACCOUNT_REQUIRED',`Line ${index+1} requires an account.`);
    if(!isValidAccount(line.account_code))return fail('JE_ACCOUNT_INVALID',`Line ${index+1} uses an unknown account.`);
    if(requiresMember(line.account_code,line)&&!line.member)return fail('4020',`Line ${index+1} requires a subsidiary member.`);
    const d=+line.debit_amount||0,c=+line.credit_amount||0;
    if(d<0||c<0||(d>0&&c>0)||(d===0&&c===0))return fail('JE_LINE_AMOUNT_INVALID',`Line ${index+1} has invalid debit/credit.`);
    dr+=d;cr+=c;
  }
  if(dr<=0||Math.abs(dr-cr)>=0.005)return fail('4006','Journal entry is not balanced.');
  return ok({debit:dr,credit:cr});
}

export function validateDocuments(je,{actorId,storageAdapter}={}) {
  const docs=je.attachments||[];
  if(['MANUAL','RECLASS'].includes(je.je_type)&&docs.length===0)return fail('4010','Supporting attachment is required.');
  const ids=new Set(),hashes=new Set();
  for(const doc of docs){
    const result=validateAttachment(doc,{actorId,storageAdapter});if(!result.ok)return result;
    if(ids.has(doc.id)||hashes.has(doc.hash))return fail('ATTACHMENT_DUPLICATE','Duplicate attachment metadata.');
    ids.add(doc.id);hashes.add(doc.hash);
  }
  return ok(docs);
}
