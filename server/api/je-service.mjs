import {activeSourceExists,idempotencyExists} from '../db/memory-je-db.mjs';
import {fail,ok,validateAccounting,validateDocuments,validateTrace,canonicalHash} from '../db/je-schema.mjs';
import {authorize,resolveOpenPeriod,TRANSITIONS,validateTransition} from './je-policy.mjs';

const clone=v=>structuredClone(v);

export class JEService{
  constructor(db,{now=()=>new Date().toISOString(),isValidAccount=()=>true,requiresMember=()=>false,storageAdapter=null}={}){this.db=db;this.now=now;this.accounting={isValidAccount,requiresMember};this.storageAdapter=storageAdapter;}
  guard(state,je,actor,action,{documents=false}={}){
    const auth=authorize(actor,action);if(!auth.ok)return auth;
    const period=resolveOpenPeriod(state,je);if(!period.ok)return period;
    const accounting=validateAccounting(je,this.accounting);if(!accounting.ok)return accounting;
    const trace=validateTrace(je);if(!trace.ok)return trace;
    if(documents){const docs=validateDocuments(je,{actorId:je.created_by,storageAdapter:this.storageAdapter});if(!docs.ok)return docs;}
    return ok({period:period.data});
  }
  create({actor,je,idempotencyKey}){
    return this.db.transaction(state=>{
      const auth=authorize(actor,'create');if(!auth.ok)return auth;
      const draft={...clone(je),posting_status:'DRAFT',created_by:actor.user_id,revision:0,idempotency_key:idempotencyKey||je.idempotency_key,history:[{action:'CREATE',by:actor.user_id,at:this.now()}]};
      const period=resolveOpenPeriod(state,draft);if(!period.ok)return period;
      const accounting=validateAccounting(draft,this.accounting);if(!accounting.ok)return accounting;
      const trace=validateTrace(draft);if(!trace.ok)return trace;
      if(state.jes.has(draft.je_id))return fail('JE_ID_EXISTS','Journal id already exists.');
      if(activeSourceExists(state,draft))return fail('JE_DUPLICATE_SOURCE','Active source journal already exists.');
      if(draft.idempotency_key&&idempotencyExists(state,draft.idempotency_key))return fail('JE_DUPLICATE_SOURCE','Idempotency key already exists.');
      state.jes.set(draft.je_id,draft);return ok({je:clone(draft)});
    });
  }
  save({actor,id,draft,expectedRevision}){
    return this.db.transaction(state=>{const current=state.jes.get(id);if(!current)return fail('JE_NOT_FOUND','Journal not found.');
      if(current.posting_status!=='DRAFT')return fail('JE_IMMUTABLE','Only Draft journals can be saved.');
      if(current.created_by!==actor.user_id)return fail('JE_PERMISSION_DENIED','Only the maker may save this Draft.');
      if(current.revision!==expectedRevision)return fail('JE_REVISION_CONFLICT','Journal revision changed.');
      const candidate={...clone(draft),je_id:current.je_id,created_by:current.created_by,entity_id:current.entity_id,period_code:current.period_code,je_type:current.je_type,posting_status:'DRAFT',revision:current.revision+1,
        source_system:current.source_system,source_doc_id:current.source_doc_id,rule_code:current.rule_code,setting_used:current.setting_used,mapping_used:current.mapping_used,idempotency_key:current.idempotency_key,
        history:[...(current.history||[]),{action:'SAVE',by:actor.user_id,at:this.now()}]};
      const guard=this.guard(state,candidate,actor,'save');if(!guard.ok)return guard;state.jes.set(id,candidate);return ok({je:clone(candidate)});});
  }
  copy({actor,id,newId,idempotencyKey}){
    return this.db.transaction(state=>{const source=state.jes.get(id);if(!source)return fail('JE_NOT_FOUND','Journal not found.');const auth=authorize(actor,'copy');if(!auth.ok)return auth;
      if(state.jes.has(newId))return fail('JE_ID_EXISTS','Journal id already exists.');if(idempotencyExists(state,idempotencyKey))return fail('JE_DUPLICATE_SOURCE','Copy idempotency key already exists.');
      const draft={je_id:newId,je_number:`JE-COPY-${newId}`,entity_id:source.entity_id,period_code:source.period_code,je_date:source.je_date,je_type:'MANUAL',source_system:'MAN',idempotency_key:idempotencyKey,
        description:`Copy of ${source.je_number}`,posting_status:'DRAFT',created_by:actor.user_id,revision:0,copy_of:id,attachments:[],lines:clone(source.lines),history:[{action:'COPY',by:actor.user_id,at:this.now(),source_je_id:id}]};
      const period=resolveOpenPeriod(state,draft);if(!period.ok)return period;const accounting=validateAccounting(draft,this.accounting);if(!accounting.ok)return accounting;state.jes.set(newId,draft);return ok({je:clone(draft)});});
  }
  recurring({actor,id,templateId,schedule='MONTHLY',idempotencyKey}){
    return this.db.transaction(state=>{const source=state.jes.get(id);if(!source)return fail('JE_NOT_FOUND','Journal not found.');const auth=authorize(actor,'recurring');if(!auth.ok)return auth;
      const period=resolveOpenPeriod(state,source);if(!period.ok)return period;if(state.recurring.has(templateId))return fail('RECURRING_ID_EXISTS','Recurring template id already exists.');
      const duplicate=[...state.recurring.values()].find(t=>t.idempotency_key===idempotencyKey||t.source_je_id===id&&t.schedule===schedule&&t.status==='ACTIVE');if(duplicate)return fail('JE_DUPLICATE_SOURCE','Recurring template already exists.');
      const template={template_id:templateId,source_je_id:id,entity_id:source.entity_id,schedule,status:'ACTIVE',idempotency_key:idempotencyKey,created_by:actor.user_id,created_at:this.now(),
        payload:{je_type:'MANUAL',source_system:'MAN',description:source.description,lines:clone(source.lines)},history:[{action:'CREATE_RECURRING',by:actor.user_id,at:this.now()}]};state.recurring.set(templateId,template);return ok({template:clone(template)});});
  }
  transition({actor,id,action,idempotencyKey}){
    return this.db.transaction(state=>{const receiptKey=`${id}|${action}|${idempotencyKey||''}`;if(idempotencyKey&&state.receipts.has(receiptKey))return {...state.receipts.get(receiptKey),idempotent:true};
      const je=state.jes.get(id);if(!je)return fail('JE_NOT_FOUND','Journal not found.');if(['POSTED','REVERSED'].includes(je.posting_status))return fail('JE_IMMUTABLE','Posted journals are immutable.');
      const guard=this.guard(state,je,actor,action,{documents:action==='submit'||action==='post'});if(!guard.ok)return guard;
      const edge=validateTransition(je,action,actor);if(!edge.ok)return edge;const next={...clone(je),posting_status:edge.data.to,revision:(je.revision||0)+1,history:[...(je.history||[]),{action:action.toUpperCase(),by:actor.user_id,at:this.now()}]};
      if(action==='review')next.reviewer=actor.user_id;if(action==='approve')next.approver=actor.user_id;if(action==='post')next.posted_by=actor.user_id;
      if(action.endsWith('reject')){next.reviewer=null;next.approver=null;}
      state.jes.set(id,next);const result=ok({je:clone(next)});if(idempotencyKey)state.receipts.set(receiptKey,result);return result;});
  }
  reverse({actor,id,newId,period_code,idempotencyKey}){
    return this.db.transaction(state=>{const source=state.jes.get(id);if(!source)return fail('JE_NOT_FOUND','Journal not found.');if(source.posting_status!=='POSTED')return fail('JE_REVERSE_SOURCE','Reverse requires POSTED source.');
      const auth=authorize(actor,'reverse');if(!auth.ok)return auth;if(state.jes.has(newId))return fail('JE_ID_EXISTS','Journal id already exists.');const reversedAt=this.now();const target={...clone(source),je_id:newId,je_number:`JE-REV-${newId}`,period_code:period_code||source.period_code,posting_status:'POSTED',je_type:'REVERSAL',source_system:'REVERSAL',
        source_doc_id:`${source.source_doc_id||source.je_number}:REVERSAL`,rule_code:`REV-${source.rule_code||'MAN'}`,setting_used:source.setting_used||{source:'REVERSAL'},mapping_used:source.mapping_used||{source:'REVERSAL'},idempotency_key:idempotencyKey,
        created_by:actor.user_id,posted_by:actor.user_id,reversal_of:id,revision:0,lines:source.lines.map(l=>({...clone(l),debit_amount:l.credit_amount,credit_amount:l.debit_amount})),history:[{action:'CREATE_REVERSAL',by:actor.user_id,at:reversedAt,source_je_id:id}]};
      const period=resolveOpenPeriod(state,target);if(!period.ok)return period;if(activeSourceExists(state,target)||idempotencyExists(state,idempotencyKey))return fail('JE_DUPLICATE_SOURCE','Reversal already exists.');
      const accounting=validateAccounting(target,this.accounting);if(!accounting.ok)return accounting;state.jes.set(newId,target);state.jes.set(id,{...source,posting_status:'REVERSED',reversed_je_id:newId,reversed_by:actor.user_id,reversed_at:reversedAt,revision:(source.revision||0)+1,history:[...(source.history||[]),{action:'REVERSED',by:actor.user_id,at:reversedAt,reversal_je_id:newId}]});return ok({source:clone(state.jes.get(id)),je:clone(target)});});
  }
  reclass({actor,id,newId,period_code,idempotencyKey}){
    return this.db.transaction(state=>{const source=state.jes.get(id);if(!source)return fail('JE_NOT_FOUND','Journal not found.');if(source.posting_status!=='POSTED')return fail('JE_RECLASS_SOURCE','Reclass requires POSTED source.');
      const auth=authorize(actor,'reclass');if(!auth.ok)return auth;if(state.jes.has(newId))return fail('JE_ID_EXISTS','Journal id already exists.');const draft={je_id:newId,je_number:`JE-RCL-${newId}`,entity_id:source.entity_id,period_code:period_code||source.period_code,je_date:source.je_date,je_type:'RECLASS',source_system:'MAN',
        source_doc_id:`${source.source_doc_id||source.je_number}:RECLASS`,rule_code:'RECLASS',setting_used:{source_je_id:id},mapping_used:{copied_from:id},idempotency_key:idempotencyKey,description:`Reclass ${source.je_number}`,posting_status:'DRAFT',created_by:actor.user_id,revision:0,reclass_of:id,attachments:[],lines:clone(source.lines),history:[{action:'RECLASS_DRAFT',by:actor.user_id,at:this.now()}]};
      const period=resolveOpenPeriod(state,draft);if(!period.ok)return period;if(activeSourceExists(state,draft)||idempotencyExists(state,idempotencyKey))return fail('JE_DUPLICATE_SOURCE','Reclass already exists.');const accounting=validateAccounting(draft,this.accounting);if(!accounting.ok)return accounting;state.jes.set(newId,draft);return ok({je:clone(draft)});});
  }
  runBatch({actor,entity_id,period_code,run_id,templates,existingRunKey=''}){
    return this.db.transaction(state=>{const auth=authorize(actor,'batch');if(!auth.ok)return auth;const probe={entity_id,period_code};const period=resolveOpenPeriod(state,probe);if(!period.ok)return period;if(!Array.isArray(templates)||templates.length===0)return fail('BATCH_EMPTY','At least one batch template is required.');
      const drafts=[],reserved=new Set(),reservedIds=new Set();for(const t of templates){if(t.status!=='LIVE'||!t.template_id||!Number.isInteger(t.template_version)||!t.dr||!t.cr||t.dr===t.cr||!(t.amount>0))return fail('BATCH_TEMPLATE_INVALID','Batch template is invalid.');
        const kind='PRIMARY',source_doc_id=`BATCH:${entity_id}:${t.template_id}:${period_code}:${kind}`,key=`batch/${entity_id}/${t.template_id}/${period_code}/${kind}`;
        if(reserved.has(source_doc_id)||activeSourceExists(state,{source_system:'INTERNAL_BATCH',source_doc_id})||idempotencyExists(state,key))return fail('JE_DUPLICATE_SOURCE','Batch occurrence already exists.');reserved.add(source_doc_id);
        const setting_used={setting_scope:'COMPANY',entity_id,setting_key:'batch_setting',setting_version:t.setting_version,template_id:t.template_id,template_version:t.template_version,snapshot_hash:canonicalHash(t)};
        const mapping_used={mapping_type:'BATCH_TEMPLATE',mapping_version:t.template_version,debit_account:t.dr,credit_account:t.cr,amount_rule:`FIXED:${t.currency||'USD'}:${t.amount}`,reverse_next_month:!!t.reverse_next_month};
        const primaryId=`${run_id}:${t.template_id}:P`;if(state.jes.has(primaryId)||reservedIds.has(primaryId))return fail('JE_ID_EXISTS','Journal id already exists.');reservedIds.add(primaryId);
        const primary={je_id:primaryId,je_number:`BATCH-${run_id}-${t.template_id}`,entity_id,period_code,je_date:`${period_code}-28`,je_type:'AUTO',source_system:'INTERNAL_BATCH',source_doc_id,rule_code:`R-${t.template_id}`,setting_used,mapping_used,template_version:t.template_version,run_id,idempotency_key:key,description:t.memo,posting_status:'DRAFT',created_by:actor.user_id,revision:0,lines:[{account_code:t.dr,debit_amount:t.amount,credit_amount:0},{account_code:t.cr,debit_amount:0,credit_amount:t.amount}]};const primaryAccounting=validateAccounting(primary,this.accounting);if(!primaryAccounting.ok)return primaryAccounting;drafts.push(primary);
        if(t.reverse_next_month){const [year,month]=period_code.split('-').map(Number),date=new Date(Date.UTC(year,month,1)),nextPeriod=`${date.getUTCFullYear()}-${String(date.getUTCMonth()+1).padStart(2,'0')}`;
          const nextOpen=resolveOpenPeriod(state,{entity_id,period_code:nextPeriod});if(!nextOpen.ok)return nextOpen;
          const revSource=`BATCH:${entity_id}:${t.template_id}:${nextPeriod}:REVERSAL-OF-${period_code}`,revKey=`batch/${entity_id}/${t.template_id}/${nextPeriod}/REVERSAL-OF-${period_code}`;
          if(reserved.has(revSource)||activeSourceExists(state,{source_system:'INTERNAL_BATCH',source_doc_id:revSource})||idempotencyExists(state,revKey))return fail('JE_DUPLICATE_SOURCE','Batch reversal occurrence already exists.');reserved.add(revSource);
          const reversalId=`${run_id}:${t.template_id}:R`;if(state.jes.has(reversalId)||reservedIds.has(reversalId))return fail('JE_ID_EXISTS','Journal id already exists.');reservedIds.add(reversalId);const reversal={je_id:reversalId,je_number:`BATCH-REV-${run_id}-${t.template_id}`,entity_id,period_code:nextPeriod,je_date:`${nextPeriod}-01`,je_type:'AUTO',source_system:'INTERNAL_BATCH',source_doc_id:revSource,reversal_of_source_doc_id:source_doc_id,rule_code:`R-${t.template_id}-REV`,setting_used,mapping_used:{...mapping_used,reversal:true},template_version:t.template_version,run_id,idempotency_key:revKey,description:`Reversal · ${t.memo}`,posting_status:'DRAFT',created_by:actor.user_id,revision:0,lines:[{account_code:t.cr,debit_amount:t.amount,credit_amount:0},{account_code:t.dr,debit_amount:0,credit_amount:t.amount}]};const reversalAccounting=validateAccounting(reversal,this.accounting);if(!reversalAccounting.ok)return reversalAccounting;drafts.push(reversal);
        }}
      for(const draft of drafts)state.jes.set(draft.je_id,draft);return ok({batch:{run_id,drafts:clone(drafts),existingRunKey}});});
  }
}
