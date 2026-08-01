import { JE_FLOW, validateJE } from './engine.js';

export function authorizeJECommand({can=()=>false,perm='GL.JE.CREATE'}){
  return can(perm)?{ok:true}:{ok:false,code:'JE_PERMISSION_DENIED',message:`Missing permission ${perm}.`};
}

export function resolveJEPeriod(periods,je){
  const period=(periods||[]).find(p=>p.entity_id===je?.entity_id&&p.period_code===je?.period_code);
  return period?{ok:true,period}:{ok:false,code:'JE_PERIOD_NOT_CONFIGURED',message:`No period control exists for entity ${je?.entity_id} / ${je?.period_code}.`};
}

export function validateNewJESpec({spec,existingJEs=[],can=()=>false}){
  const auth=authorizeJECommand({can});if(!auth.ok)return auth;
  if(!spec)return {ok:false,code:'JE_SPEC_REQUIRED',message:'Journal entry specification is required.'};
  if(!spec.source_doc_id||!spec.rule_code||(spec.je_type==='AUTO'&&(!spec.setting_used||!spec.mapping_used)))return {ok:false,code:'JE_AUTO_TRACE_MISSING',message:'Rule-generated JE requires source and rule trace; automatic JE also requires setting and mapping trace.'};
  if(spec.source_doc_id&&existingJEs.some(j=>j.source_system===spec.source_system&&j.source_doc_id===spec.source_doc_id&&!['REVERSED','VOID'].includes(j.posting_status)))return {ok:false,code:'JE_DUPLICATE_SOURCE',message:'This source already has an active journal entry.'};
  return {ok:true};
}

export function validateNewJEBatch({specs,existingJEs=[],periods=[],can=()=>false}){
  if(!Array.isArray(specs)||!specs.length)return {ok:false,code:'JE_BATCH_EMPTY',message:'Batch has no journal entries.'};
  const keys=new Set();
  for(const spec of specs){const valid=validateNewJESpec({spec,existingJEs,can});if(!valid.ok)return valid;const key=`${spec.source_system}:${spec.source_doc_id}`;if(keys.has(key))return {ok:false,code:'JE_DUPLICATE_SOURCE',message:'Batch contains a duplicate source.'};keys.add(key);const owned=resolveJEPeriod(periods,{entity_id:spec.entity_id,period_code:spec.period_code});if(!owned.ok)return owned;if(owned.period.status!=='OPEN')return {ok:false,code:'4005',message:`Period ${owned.period.period_code} is ${owned.period.status}.`};}
  return {ok:true};
}

export function reserveJESources(reservations,specs){
  const keys=[...(specs||[])].map(s=>`SOURCE:${s.source_system}:${s.source_doc_id}`);
  if(new Set(keys).size!==keys.length||keys.some(key=>reservations.has(key)))return {ok:false,code:'JE_DUPLICATE_ACTION',message:'One or more batch sources are already processing.'};
  keys.forEach(key=>reservations.add(key));return {ok:true,keys};
}

export function validateAttachmentReferences(je,documents=[]){
  if(!['MANUAL','RECLASS'].includes(je?.je_type))return {ok:true};
  const ids=je.attachment_ids||[];
  if(!ids.length)return {ok:false,code:'4010',message:'Manual and reclass entries require a supporting document.'};
  const missing=ids.find(id=>!documents.some(d=>d.document_id===id&&/^sha256:[0-9a-f]{64}$/.test(d.hash||'')&&String(d.storage_ref||'').startsWith('indexeddb://refs-attachments/')&&d.storage_state==='STORED'));
  return missing?{ok:false,code:'JE_ATTACHMENT_REFERENCE',message:`Attachment ${missing} cannot be resolved.`}:{ok:true};
}

export async function verifyAttachmentContent({je,documents=[],loadBlob,hashBlob}){
  const refs=validateAttachmentReferences(je,documents);if(!refs.ok)return refs;if(!['MANUAL','RECLASS'].includes(je?.je_type))return {ok:true};
  try{for(const id of je.attachment_ids||[]){const meta=documents.find(d=>d.document_id===id);const blob=await loadBlob(id);if(!blob||blob.size!==meta.size||blob.type!==meta.type)return {ok:false,code:'JE_ATTACHMENT_BLOB',message:`Attachment ${id} content does not match metadata.`};let hash;if(hashBlob)hash=await hashBlob(blob);else{const digest=await crypto.subtle.digest('SHA-256',await blob.arrayBuffer());hash='sha256:'+[...new Uint8Array(digest)].map(b=>b.toString(16).padStart(2,'0')).join('');}if(hash!==meta.hash)return {ok:false,code:'JE_ATTACHMENT_HASH',message:`Attachment ${id} hash verification failed.`};}}
  catch{return {ok:false,code:'JE_ATTACHMENT_STORAGE',message:'Attachment storage could not be verified. Try again before continuing.'};}
  return {ok:true};
}

export function validateJETransition({je,next,user,period,documents=[],can=()=>true}){
  if(!je) return {ok:false,code:'JE_NOT_FOUND',message:'Journal entry no longer exists.'};
  if(['POSTED','REVERSED'].includes(je.posting_status)) return {ok:false,code:'JE_IMMUTABLE',message:'Posted entries can only be reversed or reclassified.'};
  const flow=JE_FLOW[je.posting_status];
  if(!flow||flow.next!==next) return {ok:false,code:'JE_ILLEGAL_TRANSITION',message:`${je.posting_status} cannot move directly to ${next}.`};
  if(!can(flow.perm)) return {ok:false,code:'JE_PERMISSION_DENIED',message:`Missing permission ${flow.perm}.`};
  if(['APPROVED','POSTED'].includes(next)&&je.created_by===user?.user_id) return {ok:false,code:'JE_SOD_MAKER',message:'Maker cannot approve or post the same journal entry.'};
  if(next==='POSTED'&&je.approver===user?.user_id) return {ok:false,code:'JE_SOD_APPROVER_POSTER',message:'Approver cannot post the same journal entry.'};
  const errors=validateJE(je,period);
  if(errors.length) return {ok:false,code:errors[0].code,message:errors[0].msg,errors};
  const attachment=validateAttachmentReferences(je,documents);if(!attachment.ok)return attachment;
  if(je.je_type==='AUTO'&&(!je.source_doc_id||!je.rule_code||!je.setting_used||!je.mapping_used)) return {ok:false,code:'JE_AUTO_TRACE_MISSING',message:'Automatic JE requires source, setting, mapping and rule trace.'};
  return {ok:true,flow};
}

export function transitionJE({je,next,user,period,documents=[],can=()=>true,label,at='2026-07-31'}){
  const validation=validateJETransition({je,next,user,period,documents,can});
  if(!validation.ok)return validation;
  const roleField=next==='PENDING_APPROVAL'?'reviewer':next==='APPROVED'?'approver':next==='POSTED'?'posted_by':null;
  const updated={...structuredClone(je),posting_status:next,dirty:false,updated_at:at,history:[...(je.history||[]),{a:label||validation.flow.action,by:user.user_id,at}]};
  if(roleField)updated[roleField]=user.user_id;
  return {ok:true,je:updated};
}

export function rejectJETransition({je,user,reason,can=()=>true,at='2026-07-31'}){
  if(!je||!['PENDING_REVIEW','PENDING_APPROVAL'].includes(je.posting_status))return {ok:false,code:'JE_REJECT_STATE',message:'Only review or approval work can be rejected.'};
  const perm=je.posting_status==='PENDING_APPROVAL'?'GL.JE.APPROVE':'GL.JE.REVIEW';
  if(!can(perm))return {ok:false,code:'JE_PERMISSION_DENIED',message:`Missing permission ${perm}.`};
  if(!reason?.trim())return {ok:false,code:'JE_REJECTION_REASON',message:'A rejection reason is required.'};
  return {ok:true,je:{...structuredClone(je),posting_status:'DRAFT',reviewer:null,approver:null,dirty:false,updated_at:at,rejection_reason:reason.trim(),history:[...(je.history||[]),{a:'REJECT TO DRAFT',by:user.user_id,at,reason:reason.trim()}]}};
}

export function saveJEDraft({current,draft,user,at='2026-07-31'}){
  if(!current||current.je_id!==draft?.je_id)return {ok:false,code:'JE_NOT_FOUND',message:'Journal entry no longer exists.'};
  if(current.posting_status!=='DRAFT'||draft.posting_status!=='DRAFT')return {ok:false,code:'JE_IMMUTABLE',message:'Only Draft journal entries can be edited.'};
  const autoOverride=current.je_type==='AUTO'&&JSON.stringify(current.lines||[])!==JSON.stringify(draft.lines||[])?{actor:user.user_id,at,reason:draft.override_reason||'Human review adjustment',before:structuredClone(current.lines||[]),after:structuredClone(draft.lines||[])}:null;
  const saved={...structuredClone(draft),created_by:current.created_by,je_id:current.je_id,je_number:current.je_number,entity_id:current.entity_id,period_code:current.period_code,
    je_type:current.je_type,source_system:current.source_system,source_doc_id:current.source_doc_id,source_object_type:current.source_object_type,source_object_id:current.source_object_id,rule_code:current.rule_code,setting_used:current.setting_used,mapping_used:current.mapping_used,
    posting_status:'DRAFT',dirty:false,
    revision:(current.revision||0)+1,updated_at:at,human_overrides:autoOverride?[...(current.human_overrides||[]),autoOverride]:(current.human_overrides||[]),history:[...(current.history||[]),{a:autoOverride?'SAVE WITH HUMAN OVERRIDE':'SAVE',by:user.user_id,at,override:autoOverride}]};
  return {ok:true,je:saved};
}

export function copyJEAsDraft({source,newId,newNumber,user,at='2026-07-31'}){
  if(!source)return {ok:false,code:'JE_NOT_FOUND'};
  const je={
    je_id:newId,je_number:newNumber,entity_id:source.entity_id,period_code:source.period_code,je_date:source.je_date,currency:source.currency||'USD',
    je_type:'MANUAL',source_system:'MAN',description:`Copy of ${source.je_number} · ${source.description||''}`,payee:source.payee||'',posting_status:'DRAFT',
    created_by:user.user_id,has_attachment:false,revision:0,lines:structuredClone(source.lines||[]),
    attachment_ids:[],
    history:[{a:`COPY FROM ${source.je_number}`,by:user.user_id,at}],
  };
  return {ok:true,je};
}

export function createRecurringTemplate({source,templateId,user,schedule='MONTHLY',at='2026-07-31'}){
  if(!source)return {ok:false,code:'JE_NOT_FOUND'};
  return {ok:true,template:{template_id:templateId,source_je_id:source.je_id,name:`Recurring · ${source.description||source.je_number}`,schedule,next_run:'2026-08-01',status:'ACTIVE',
    entity_id:source.entity_id,created_by:user.user_id,created_at:at,payload:{je_type:'MANUAL',source_system:'MAN',description:source.description,payee:source.payee||'',lines:structuredClone(source.lines||[])}}};
}

export function createReclassDraft({source,newId,newNumber,user,at='2026-07-31'}){
  if(!source||source.posting_status!=='POSTED')return {ok:false,code:'JE_RECLASS_SOURCE',message:'Reclass requires a Posted source JE.'};
  return {ok:true,je:{je_id:newId,je_number:newNumber,entity_id:source.entity_id,period_code:source.period_code,je_date:source.je_date,je_type:'RECLASS',source_system:'MAN',
    description:`Reclass ${source.je_number} · ${source.description||''}`,posting_status:'DRAFT',created_by:user.user_id,has_attachment:false,attachment_ids:[],reclass_of:source.je_id,
    lines:structuredClone(source.lines||[]),history:[{a:`RECLASS FROM ${source.je_number}`,by:user.user_id,at}]}};
}

export function createReversal({source,newId,user,period,can=()=>true,at='2026-07-31'}){
  if(!source||source.posting_status!=='POSTED')return {ok:false,code:'JE_REVERSE_SOURCE',message:'Only Posted JEs can be reversed.'};
  if(!can('GL.JE.REVERSE'))return {ok:false,code:'JE_PERMISSION_DENIED',message:'Missing reverse permission.'};
  const ref=source.source_doc_id||source.je_number;
  const reversal={...structuredClone(source),je_id:newId,je_number:`JE-REV-${newId}`,posting_status:'POSTED',je_type:'REVERSAL',source_system:'REVERSAL',
    source_doc_id:`${ref}-REV-${newId}`,rule_code:`REV-${source.rule_code||'MAN'}`,description:`Reversal of ${source.je_number} · ${source.description||''}`,
    created_by:user.user_id,posted_by:user.user_id,reversal_of:source.je_id,history:[{a:`REVERSAL OF ${source.je_number}`,by:user.user_id,at}],
    lines:(source.lines||[]).map(line=>({...line,debit_amount:line.credit_amount,credit_amount:line.debit_amount}))};
  const errors=validateJE(reversal,period);
  if(errors.length)return {ok:false,code:errors[0].code,message:errors[0].msg,errors};
  return {ok:true,reversal,source:{...structuredClone(source),posting_status:'REVERSED',reversed_by:user.user_id,reversed_je_id:newId,
    history:[...(source.history||[]),{a:`REVERSED BY ${reversal.je_number}`,by:user.user_id,at}]}};
}
