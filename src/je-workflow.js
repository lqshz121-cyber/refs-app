import { JE_FLOW, validateJE } from './engine.js';

export function validateJETransition({je,next,user,period,can=()=>true}){
  if(!je) return {ok:false,code:'JE_NOT_FOUND',message:'Journal entry no longer exists.'};
  if(['POSTED','REVERSED'].includes(je.posting_status)) return {ok:false,code:'JE_IMMUTABLE',message:'Posted entries can only be reversed or reclassified.'};
  const flow=JE_FLOW[je.posting_status];
  if(!flow||flow.next!==next) return {ok:false,code:'JE_ILLEGAL_TRANSITION',message:`${je.posting_status} cannot move directly to ${next}.`};
  if(!can(flow.perm)) return {ok:false,code:'JE_PERMISSION_DENIED',message:`Missing permission ${flow.perm}.`};
  if(['APPROVED','POSTED'].includes(next)&&je.created_by===user?.user_id) return {ok:false,code:'JE_SOD_MAKER',message:'Maker cannot approve or post the same journal entry.'};
  if(next==='POSTED'&&je.approver===user?.user_id) return {ok:false,code:'JE_SOD_APPROVER_POSTER',message:'Approver cannot post the same journal entry.'};
  const errors=validateJE(je,period);
  if(errors.length) return {ok:false,code:errors[0].code,message:errors[0].msg,errors};
  if(je.je_type==='AUTO'&&(!je.source_doc_id||!je.rule_code)) return {ok:false,code:'JE_AUTO_TRACE_MISSING',message:'Automatic JE requires source_doc_id and rule_code.'};
  return {ok:true,flow};
}

export function transitionJE({je,next,user,period,can=()=>true,label,at='2026-07-31'}){
  const validation=validateJETransition({je,next,user,period,can});
  if(!validation.ok)return validation;
  const roleField=next==='PENDING_APPROVAL'?'reviewer':next==='APPROVED'?'approver':next==='POSTED'?'posted_by':null;
  const updated={...structuredClone(je),posting_status:next,dirty:false,updated_at:at,history:[...(je.history||[]),{a:label||validation.flow.action,by:user.user_id,at}]};
  if(roleField)updated[roleField]=user.user_id;
  return {ok:true,je:updated};
}

export function rejectJETransition({je,user,can=()=>true,at='2026-07-31'}){
  if(!je||!['PENDING_REVIEW','PENDING_APPROVAL'].includes(je.posting_status))return {ok:false,code:'JE_REJECT_STATE',message:'Only review or approval work can be rejected.'};
  if(!can('GL.JE.REVIEW'))return {ok:false,code:'JE_PERMISSION_DENIED',message:'Missing review permission.'};
  return {ok:true,je:{...structuredClone(je),posting_status:'DRAFT',reviewer:null,approver:null,dirty:false,updated_at:at,history:[...(je.history||[]),{a:'REJECT TO DRAFT',by:user.user_id,at}]}};
}

export function saveJEDraft({current,draft,user,at='2026-07-31'}){
  if(!current||current.je_id!==draft?.je_id)return {ok:false,code:'JE_NOT_FOUND',message:'Journal entry no longer exists.'};
  if(current.posting_status!=='DRAFT'||draft.posting_status!=='DRAFT')return {ok:false,code:'JE_IMMUTABLE',message:'Only Draft journal entries can be edited.'};
  const saved={...structuredClone(draft),created_by:current.created_by,je_id:current.je_id,je_number:current.je_number,entity_id:current.entity_id,period_code:current.period_code,
    je_type:current.je_type,source_system:current.source_system,source_doc_id:current.source_doc_id,rule_code:current.rule_code,setting_used:current.setting_used,mapping_used:current.mapping_used,
    posting_status:'DRAFT',dirty:false,
    revision:(current.revision||0)+1,updated_at:at,history:[...(current.history||[]),{a:'SAVE',by:user.user_id,at}]};
  return {ok:true,je:saved};
}

export function copyJEAsDraft({source,newId,newNumber,user,at='2026-07-31'}){
  if(!source)return {ok:false,code:'JE_NOT_FOUND'};
  const je={
    je_id:newId,je_number:newNumber,entity_id:source.entity_id,period_code:source.period_code,je_date:source.je_date,currency:source.currency||'USD',
    je_type:'MANUAL',source_system:'MAN',description:`Copy of ${source.je_number} · ${source.description||''}`,payee:source.payee||'',posting_status:'DRAFT',
    created_by:user.user_id,has_attachment:false,revision:0,lines:structuredClone(source.lines||[]),
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
    description:`Reclass ${source.je_number} · ${source.description||''}`,posting_status:'DRAFT',created_by:user.user_id,has_attachment:false,reclass_of:source.je_id,
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
