import { buildDecisionEvidence, proposeDraftJE } from './ai-accounting.js';

const MONEY=value=>Math.round(Number(value||0)*100)/100;
const RENT_REVENUE_ACCOUNT='411000';
const AR_CONTROL_ACCOUNT='120200';
const requiredScope=row=>['entity_id','project_id','property_id','accounting_period','source_document_id'].every(key=>row?.[key]);
const sameScope=(left,right)=>['entity_id','project_id','property_id','accounting_period'].every(key=>String(left?.[key]||'')===String(right?.[key]||''));
const debit=line=>Number(line.debit_amount||0);
const credit=line=>Number(line.credit_amount||0);

function scopeException(source,code,reason) {
  return Object.freeze({exception_id:`AI-RENT-ROLL:${code}:${source?.id||'UNKNOWN'}`,source_id:source?.id||null,source_document_id:source?.source_document_id||null,code,reason,state:'REVIEW_REQUIRED',can_create_draft:false,can_dispatch:false,can_post:false});
}

function buildCase({source,postedRevenue,reviewTrace=[]}) {
  const scheduled=MONEY(source.scheduled_rent??source.amount);
  const difference=MONEY(scheduled-postedRevenue);
  if(Math.abs(difference)<0.005) return Object.freeze({case_id:`AI-RENT-ROLL:${source.id}`,source_id:source.id,source_document_id:source.source_document_id,scheduled_rent:scheduled,posted_revenue:postedRevenue,difference:0,state:'TIED',suggested_draft:null,draft_request:null,report_impact:{state:'TIED',ar_delta:0,revenue_delta:0,net_income_delta:0},audit_trail:[{action:'RENT_ROLL_TIED_TO_POSTED_REVENUE',actor:'AI_ACCOUNTING_BRAIN',at:source.updated_at}],controls:{read_only:true,can_dispatch:false,can_post:false}});
  const dimensions={entity_id:source.entity_id,project_id:source.project_id,property_id:source.property_id,period_code:source.accounting_period};
  const finding={id:`AI:PROPERTY_REVENUE:REVENUE_MISMATCH:${source.id}`,skill:'PROPERTY_REVENUE',rule:'REVENUE_MISMATCH',risk:'HIGH',object_type:'RENT_ROLL',object:source.id,review_owner:'CONTROLLER',confidence:0.96,source_refs:[source.source_document_id,source.id],dimensions};
  const evidence=buildDecisionEvidence({skill:finding.skill,rule:finding.rule,inputRefs:[source.source_document_id,`rent_roll:${source.id}`,`posted_revenue:${postedRevenue}`],observations:[`Scheduled rent ${scheduled}`,`Same-scope posted rent revenue ${postedRevenue}`,`Difference ${difference}`],alternatives:['Retain as review-only until source and tenant activity tie out'],policyGates:['DRAFT_ONLY','HUMAN_REVIEW_REQUIRED','NO_AUTOMATIC_POSTING'],confidence:finding.confidence,reasoning:'Difference-only rent roll reconciliation using same-entity, property, project, period and source-document POSTED revenue evidence.'});
  const increase=difference>0;
  const amount=Math.abs(difference);
  const proposed=proposeDraftJE({finding,evidence,jeSpec:{je_id:`AI-RENT-DRAFT:${source.id}:${source.accounting_period}`,entity_id:source.entity_id,project_id:source.project_id,property_id:source.property_id,member_trace:{entity_id:source.entity_id,project_id:source.project_id,property_id:source.property_id},accounting_period:source.accounting_period,je_date:`${source.accounting_period}-28`,je_type:'AUTO',source_system:'AI_RENT_ROLL_REVIEW',source_document_id:source.source_document_id,posting_status:'DRAFT',description:`Rent roll revenue difference review: ${source.id}`,idempotency_key:`AI-RENT-DRAFT:${source.source_document_id}:${source.accounting_period}:${difference}`,lines:increase?[{account_code:AR_CONTROL_ACCOUNT,debit_amount:amount,credit_amount:0},{account_code:RENT_REVENUE_ACCOUNT,debit_amount:0,credit_amount:amount}]:[{account_code:RENT_REVENUE_ACCOUNT,debit_amount:amount,credit_amount:0},{account_code:AR_CONTROL_ACCOUNT,debit_amount:0,credit_amount:amount}]}});
  const approval=reviewTrace.find(row=>row.proposal_id===proposed.draft.ai_proposal_id&&row.decision==='APPROVE'&&row.evidence_state==='COMPLETE'&&row.posting_status==='DRAFT');
  const auditTrail=[
    {action:'RENT_ROLL_SOURCE_RETAINED',actor:'AI_ACCOUNTING_BRAIN',at:source.updated_at},
    {action:'SAME_SCOPE_POSTED_REVENUE_MEASURED',actor:'AI_ACCOUNTING_BRAIN',at:source.updated_at},
    {action:'DIFFERENCE_ONLY_DRAFT_PROPOSED',actor:'AI_ACCOUNTING_BRAIN',at:proposed.draft.history.at(-1)?.at||source.updated_at},
    ...(approval?[{action:'HUMAN_REVIEW_OUTCOME_RETAINED',actor:approval.actor,at:approval.committed_at,revision:approval.revision,event_id:approval.event_id}]:[]),
  ];
  const draftRequest=approval?Object.freeze({request_id:`STANDARD-JE-DRAFT:${proposed.draft.ai_proposal_id}:R${approval.revision}`,request_type:'STANDARD_JE_DRAFT_REQUEST',state:'READY_FOR_APPLICATION_COMMAND',proposal_id:proposed.draft.ai_proposal_id,review_outcome_id:approval.idempotency_key,review_revision:approval.revision,payload:proposed.draft,dispatch_required_by:'STANDARD_JE_APPLICATION_BOUNDARY',can_dispatch:false,can_approve:false,can_post:false}):null;
  if(draftRequest) auditTrail.push({action:'STANDARD_JE_DRAFT_REQUEST_PREPARED',actor:'AI_ACCOUNTING_BRAIN',at:approval.committed_at,request_id:draftRequest.request_id});
  return Object.freeze({case_id:`AI-RENT-ROLL:${source.id}`,source_id:source.id,source_document_id:source.source_document_id,scheduled_rent:scheduled,posted_revenue:postedRevenue,difference,state:approval?'HUMAN_REVIEW_RETAINED':'HUMAN_REVIEW_REQUIRED',finding,evidence,suggested_draft:proposed.draft,review_task:proposed.review_task,draft_request:draftRequest,report_impact:{state:'DRAFT_PREVIEW_ONLY',ar_delta:difference,revenue_delta:difference,net_income_delta:difference,source_document_id:source.source_document_id},audit_trail:auditTrail,controls:{read_only:true,difference_only:true,source_scoped:true,can_dispatch:false,can_approve:false,can_post:false}});
}

// AI-only projection over an injected mock/adapter snapshot. It never calls WBS,
// mutates source data, dispatches a JE command, approves, or posts.
export function buildRentRollRevenueReview({snapshot={},periodCode='2026-07',reviewTrace=[]}={}) {
  const rentRows=(snapshot.rentRoll||[]).filter(row=>row.accounting_period===periodCode);
  const sourceDocuments=new Map((snapshot.sourceDocuments||[]).map(row=>[row.id,row]));
  const cases=[],exceptions=[];
  for(const source of rentRows) {
    if(!requiredScope(source)||!(Number(source.scheduled_rent??source.amount)>0)) { exceptions.push(scopeException(source,'SOURCE_INCOMPLETE','Rent roll entity, project, property, period, source document and positive scheduled rent are required.')); continue; }
    if(!sourceDocuments.has(source.source_document_id)) { exceptions.push(scopeException(source,'SOURCE_DOCUMENT_NOT_RETAINED','Rent roll source document is not retained in the injected snapshot.')); continue; }
    if(rentRows.filter(row=>row.source_document_id===source.source_document_id).length!==1) { exceptions.push(scopeException(source,'SOURCE_AMBIGUOUS','More than one rent roll row claims the same source document.')); continue; }
    const sourceJEs=(snapshot.journalEntries||[]).filter(je=>je.posting_status==='POSTED'&&je.source_document_id===source.source_document_id);
    if(sourceJEs.some(je=>!sameScope(source,je))) { exceptions.push(scopeException(source,'POSTED_SCOPE_CONFLICT','Posted revenue evidence conflicts with rent roll entity, property, project, or period.')); continue; }
    const postedRevenue=MONEY(sourceJEs.filter(je=>sameScope(source,je)).flatMap(je=>je.lines||[]).filter(line=>String(line.account_code)===RENT_REVENUE_ACCOUNT).reduce((total,line)=>total+credit(line)-debit(line),0));
    cases.push(buildCase({source,postedRevenue,reviewTrace}));
  }
  return Object.freeze({mode:'AI_RENT_ROLL_REVIEW_MOCK',period_code:periodCode,cases,exceptions,summary:{sources:rentRows.length,mismatches:cases.filter(row=>Math.abs(row.difference)>0.005).length,tied:cases.filter(row=>row.state==='TIED').length,human_review_required:cases.filter(row=>row.state==='HUMAN_REVIEW_REQUIRED').length,draft_requests:cases.filter(row=>row.draft_request).length,exceptions:exceptions.length},boundaries:['Injected mock/adapter snapshot only','Difference-only suggested Draft JE','Human review outcome required','Standard JE Draft request is non-dispatching','No WBS call or source mutation','No automatic approval or posting']});
}
