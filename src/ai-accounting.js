// REFS AI Accounting Brain: deterministic skills and review contracts.
// This module proposes accounting actions; it never posts or mutates source data.

export const AI_SKILLS = Object.freeze([
  {id:'REAL_ESTATE_CONTROLLER', name:'Real Estate Controller', domain:'policy', review:'CONTROLLER', rules:['ENTITY_MISMATCH','SOURCE_ENTITY_MISMATCH','PERIOD_LOCK','CWIP_CAPITALIZATION','INTERCOMPANY_BALANCE','INTERCOMPANY_IMBALANCE','SOURCE_COMPLETENESS']},
  {id:'CONSTRUCTION_COST', name:'Construction Cost Accounting', domain:'cost', review:'CONTROLLER', rules:['COST_DIMENSION_MISSING','CWIP_CAPITALIZATION','CWIP_POST_COMPLETION','DUPLICATE_INVOICE']},
  {id:'CONSTRUCTION_LOAN', name:'Construction Loan Accounting', domain:'loan', review:'CONTROLLER', rules:['LOAN_DRAW_CLASSIFICATION','LOAN_DRAW_COST_MISMATCH','LOAN_BALANCE_MISMATCH','INTEREST_CAPITALIZATION','INTEREST_CAPITALIZATION_REQUIRED']},
  {id:'AP_ACCOUNTING', name:'AP / Payable Accounting', domain:'payable', review:'SENIOR_ACCT', rules:['DUPLICATE_INVOICE','PAYMENT_WITHOUT_BILL','ENTITY_MISMATCH','MISSING_SOURCE','PAYABLE_GL_MISSING','STALE_PAYABLE']},
  {id:'BANK_RECONCILIATION', name:'Bank Reconciliation', domain:'bank', review:'TREASURY', rules:['UNMATCHED_BANK','DUPLICATE_PAYMENT','AMOUNT_TOLERANCE','SUSPENSE_BALANCE','BANK_GL_CASH_MISMATCH','ENTITY_MISMATCH']},
  {id:'PREPAID_AMORTIZATION', name:'Prepaid / Amortization', domain:'prepaid', review:'CONTROLLER', rules:['PREPAID_COVERAGE_MISSING','PREPAID_SCHEDULE_REQUIRED','AMORTIZATION_DUE']},
  {id:'ACCRUAL_ACCOUNTING', name:'Accrual Accounting', domain:'accrual', review:'CONTROLLER', rules:['MISSING_ACCRUAL','ACCRUAL_REVERSAL_DUE','CUTOFF_MISMATCH']},
  {id:'PROPERTY_REVENUE', name:'Revenue / Property Management', domain:'revenue', review:'SENIOR_ACCT', rules:['REVENUE_MISMATCH','DEPOSIT_LIABILITY']},
  {id:'FINANCIAL_REPORTING', name:'Financial Reporting', domain:'reporting', review:'CONTROLLER', rules:['TB_OUT_OF_BALANCE','REPORT_VARIANCE','SOURCE_TRACE_MISSING']},
  {id:'AUDIT_REVIEW', name:'Audit Review', domain:'audit', review:'CONTROLLER', rules:['MANUAL_JE_RISK','ROUND_DOLLAR_RISK','WEEKEND_PAYMENT_RISK','MISSING_ATTACHMENT','DUPLICATE_SOURCE','DUPLICATE_JE','NEGATIVE_BALANCE']},
]);

export const AI_REVIEW_BANDS = Object.freeze([
  {min:0.95, status:'AUTO_PREPARED', owner:'CONTROLLER', canPost:false},
  {min:0.80, status:'CONTROLLER_REVIEW', owner:'CONTROLLER', canPost:false},
  {min:0.60, status:'SENIOR_ACCOUNTANT_REVIEW', owner:'SENIOR_ACCT', canPost:false},
  {min:0, status:'EXCEPTION_QUEUE', owner:'ACCOUNTING_OPS', canPost:false},
]);

export function reviewBand(confidence=0) {
  const normalized=Math.max(0,Math.min(1,Number(confidence)||0));
  return AI_REVIEW_BANDS.find(b=>normalized>=b.min) || AI_REVIEW_BANDS.at(-1);
}

export function validateAISkillRegistry({skills=AI_SKILLS,findings=[]}={}) {
  const ids=skills.map(skill=>skill.id);
  const duplicate_skill_ids=ids.filter((id,index)=>ids.indexOf(id)!==index);
  const unknown_findings=findings.filter(finding=>!skills.some(skill=>skill.id===finding.skill&&(skill.rules||[]).includes(finding.rule))).map(finding=>({skill:finding.skill,rule:finding.rule,id:finding.id}));
  return {valid:duplicate_skill_ids.length===0&&unknown_findings.length===0,duplicate_skill_ids,unknown_findings};
}

// Pure transition policy so the client state machine and future API can enforce
// identical Draft-only review gates without relying on a rendered UI branch.
export function validateAIJETransition({je,next,actorId}={}) {
  if(!je?.ai_proposed) return {ok:true};
  if(next==='PENDING_APPROVAL' && je.created_by===actorId) return {ok:false,code:'AI_REVIEWER_SEPARATION',reason:'AI Draft review requires a reviewer other than the preparer.'};
  if(next==='APPROVED' && (!je.ai_reviewed_by || je.ai_reviewed_by===actorId)) return {ok:false,code:'AI_APPROVAL_REVIEW_REQUIRED',reason:'AI Draft approval requires a recorded, separate human review.'};
  if(next==='POSTED' && !je.ai_approved_by) return {ok:false,code:'AI_POSTING_APPROVAL_REQUIRED',reason:'AI Draft posting requires recorded human approval.'};
  return {ok:true};
}

export const AI_REVIEW_OWNERS=Object.freeze(['CONTROLLER','SENIOR_ACCT','TREASURY','ACCOUNTING_OPS']);
export function validateAIReviewWorkflowPatch({current={},patch={}}={}) {
  if(!patch || typeof patch!=='object') return {ok:false,code:'AI_REVIEW_PATCH_INVALID',reason:'AI review workflow patch is required.'};
  if(patch.status!==undefined && !['OPEN','RESOLVED'].includes(patch.status)) return {ok:false,code:'AI_REVIEW_STATUS_INVALID',reason:'AI review workflow status must be OPEN or RESOLVED.'};
  if(patch.owner!==undefined && !AI_REVIEW_OWNERS.includes(patch.owner)) return {ok:false,code:'AI_REVIEW_OWNER_INVALID',reason:'AI review workflow owner is not an allowed accounting queue.'};
  if(patch.due_date!==undefined && patch.due_date!=='' && !isValidISODate(patch.due_date)) return {ok:false,code:'AI_REVIEW_DUE_INVALID',reason:'AI review workflow due date must be a calendar ISO date.'};
  if(patch.status==='RESOLVED' && current.status==='RESOLVED') return {ok:false,code:'AI_REVIEW_ALREADY_RESOLVED',reason:'AI review finding is already resolved.'};
  if(patch.status==='OPEN' && current.status==='OPEN') return {ok:false,code:'AI_REVIEW_ALREADY_OPEN',reason:'AI review finding is already open.'};
  return {ok:true};
}

// Creates a separate manual amendment specification. It deliberately removes
// every AI decision field and every JE identity so original evidence remains immutable.
export function createAIAmendmentSpec(source={}) {
  if(!source?.ai_proposed || !source.ai_proposal_id) throw new Error('AI amendment requires an AI Draft proposal');
  const copied=structuredClone(source);
  ['je_id','je_number','history','posting_status','ai_proposed','ai_proposal_id','ai_finding_id','ai_rule_id','ai_confidence','ai_evidence','ai_source_refs','ai_review_task_id','ai_reviewed_by','ai_reviewed_at','ai_approved_by','ai_approved_at'].forEach(key=>delete copied[key]);
  return {...copied,posting_status:'DRAFT',je_type:'MANUAL',source_system:'AI_AMENDMENT',description:`AI amendment: ${source.description||''}`,ai_amendment_of:source.ai_proposal_id,amendment_source_je:source.je_number||null};
}

// Pure read-model controls used by AI review and reports; no source mutation.
export function calculateOpenBalances({bills=[], invoices=[]}={}) {
  const ap=bills.map(b=>({...b,open_balance:Math.max(0,Number(b.amount||0)-Number(b.paid_amount||0))}));
  const ar=invoices.map(i=>({...i,open_balance:Math.max(0,Number(i.amount||0)-Number(i.received_amount||0))}));
  return {ap,ar,ap_total:ap.reduce((s,r)=>s+r.open_balance,0),ar_total:ar.reduce((s,r)=>s+r.open_balance,0)};
}

export function controlTotals({postedJEs=[],bills=[],invoices=[],bankTransactions=[]}={}) {
  const debit=postedJEs.reduce((s,j)=>s+j.lines.reduce((x,l)=>x+Number(l.debit_amount||0),0),0);
  const credit=postedJEs.reduce((s,j)=>s+j.lines.reduce((x,l)=>x+Number(l.credit_amount||0),0),0);
  const open=calculateOpenBalances({bills,invoices});
  const unmatched=bankTransactions.filter(t=>t.match_status==='UNMATCHED').reduce((s,t)=>s+Number(t.amount||0),0);
  return {ledger_debit:debit,ledger_credit:credit,ledger_difference:+(debit-credit).toFixed(2),ap_open:open.ap_total,ar_open:open.ar_total,unmatched_bank:unmatched,balanced:Math.abs(debit-credit)<0.005};
}

// Builds read-only month-over-month account observations from the existing GL.
// It is deliberately a report input, not a journal-entry or balance mutation.
export function deriveMonthlyAccountVariances({jes=[],periodCode,entityId=null,materiality=5000,percentageThreshold=0.3}={}) {
  const match=String(periodCode||'').match(/^(\d{4})-(\d{2})$/);
  if(!match) return [];
  const year=Number(match[1]), month=Number(match[2]);
  const priorPeriod=`${month===1?year-1:year}-${String(month===1?12:month-1).padStart(2,'0')}`;
  const buckets=new Map();
  jes.filter(je=>je.posting_status==='POSTED'&&(!entityId||String(je.entity_id)===String(entityId))&&[periodCode,priorPeriod].includes(je.period_code)).forEach(je=>{
    (je.lines||[]).forEach(line=>{
      const accountCode=String(line.account_code||'UNMAPPED');
      const bucket=buckets.get(accountCode)||{current_amount:0,prior_amount:0,source_refs:[]};
      const amount=Number(line.debit_amount||0)-Number(line.credit_amount||0);
      if(je.period_code===periodCode) bucket.current_amount+=amount; else bucket.prior_amount+=amount;
      bucket.source_refs.push(je.source_doc_id||je.je_number);
      buckets.set(accountCode,bucket);
    });
  });
  return [...buckets.entries()].map(([accountCode,bucket])=>({id:`ACCOUNT_VARIANCE:${periodCode}:${accountCode}`,line_id:accountCode,line_name:`Account ${accountCode}`,report_code:'GL_MONTH_OVER_MONTH',current_amount:+bucket.current_amount.toFixed(2),prior_amount:+bucket.prior_amount.toFixed(2),variance_threshold:Math.max(Number(materiality)||0,Math.max(Math.abs(bucket.current_amount),Math.abs(bucket.prior_amount))*Math.max(0,Number(percentageThreshold)||0)),entity_id:entityId,period_code:periodCode,source_refs:[...new Set(bucket.source_refs)]}));
}

// Ingestion is deliberately lossless: source metadata stays attached to the
// normalized read model so later rules and reviewers can drill back to it.
export const AI_SOURCE_TYPES=Object.freeze(['BANK_TRANSACTION','PAYABLE_INVOICE','VENDOR_INVOICE','LOAN_STATEMENT','LOAN_DRAW','INTEREST_STATEMENT','GL_TRANSACTION','TRIAL_BALANCE','RENT_ROLL','PROPERTY_REPORT','WORK_ORDER','PURCHASE_ORDER','CLOSING_STATEMENT','TAX_STATEMENT','INSURANCE_DOCUMENT']);
const SOURCE_TYPE_ALIASES=Object.freeze({BANK:'BANK_TRANSACTION',BANK_FEED:'BANK_TRANSACTION',INVOICE:'VENDOR_INVOICE',PAYABLE:'PAYABLE_INVOICE',CONSTRUCTION_INVOICE:'VENDOR_INVOICE',SERVICE_INVOICE:'VENDOR_INVOICE',LOAN:'LOAN_STATEMENT',INTEREST:'INTEREST_STATEMENT',PROPERTY_TAX:'TAX_STATEMENT',INSURANCE:'INSURANCE_DOCUMENT'});
const sourceIdOf=source=>source?.source_id||source?.source_doc_id||source?.doc_id||source?.id;
const isValidISODate=value=>{ const match=String(value||'').match(/^(\d{4})-(\d{2})-(\d{2})$/); if(!match) return false; const year=Number(match[1]),month=Number(match[2]),day=Number(match[3]); const parsed=new Date(Date.UTC(year,month-1,day)); return parsed.getUTCFullYear()===year&&parsed.getUTCMonth()===month-1&&parsed.getUTCDate()===day; };
const isValidPeriodCode=value=>/^\d{4}-(0[1-9]|1[0-2])$/.test(String(value||''));
export function normalizeAccountingSource(source={}) {
  const sourceId=sourceIdOf(source);
  const rawSourceType=String(source.source_type||source.type||'').toUpperCase();
  const sourceType=SOURCE_TYPE_ALIASES[rawSourceType]||rawSourceType;
  const rawAmount=source.amount??source.total_amount;
  const amount=Number(rawAmount??0);
  const date=source.date||source.txn_date||source.invoice_date||null;
  const periodCode=source.period_code||(date||'').slice(0,7)||null;
  const required={source_id:sourceId,source_type:sourceType,entity_id:source.entity_id,date:isValidISODate(date)?date:null,period_code:isValidPeriodCode(periodCode)?periodCode:null,amount:rawAmount!==undefined&&rawAmount!==null&&rawAmount!==''&&Number.isFinite(amount)?amount:null};
  const missing=Object.entries(required).filter(([,value])=>value===undefined||value===null||value==='').map(([field])=>field);
  return redactSecrets({...source,source_id:sourceId,source_type:sourceType,amount:Number.isFinite(amount)?Math.round(amount*100)/100:0,date,period_code:periodCode,matched_status:source.matched_status||source.match_status||'UNMATCHED',accounting_treatment_status:source.accounting_treatment_status||'UNCLASSIFIED',ingestion_status:missing.length?'INCOMPLETE':'READY',missing_fields:missing});
}

// Classification is a transparent rule result, not an instruction to post.
export function classifyAccountingEvent(source={}) {
  const normalized=normalizeAccountingSource(source), text=textOf(normalized);
  const eventType=normalized.event_type||(
    /deposit|security deposit/.test(text)?'DEPOSIT':
    /repay/.test(text)?'REPAYMENT':
    /interest/.test(text)?'INTEREST':
    /loan fee|origination fee|commitment fee|lender fee/.test(text)?'LOAN_FEE':
    /escrow|reserve/.test(text)?'LOAN_ESCROW_RESERVE':
    /loan|draw|lender/.test(text)?'LOAN_DRAW':
    isInsurance(normalized)||/property tax|subscription|license|warranty/.test(text)?'PREPAID':
    /invoice|bill/.test(text)||['PAYABLE_INVOICE','VENDOR_INVOICE'].includes(normalized.source_type)?'INVOICE':
    normalized.source_type==='BANK_TRANSACTION'?'PAYMENT':'UNCLASSIFIED');
  const ruleConfidence=normalized.ingestion_status==='READY'?(eventType==='UNCLASSIFIED'?0.45:0.9):0.4;
  const sourceConfidence=Number(normalized.confidence_score);
  const confidence=Number.isFinite(sourceConfidence)?Math.min(ruleConfidence,Math.max(0,Math.min(1,sourceConfidence))):ruleConfidence;
  const band=reviewBand(confidence);
  return {source:normalized,event_type:eventType,rule_id:`CLASSIFY_${eventType}`,confidence,review_status:band.status,review_owner:band.owner,can_post:false,requires_human_review:true,reason:`Deterministic source-type and memo classification: ${eventType}`};
}

// Returns recommendations only. A match never changes a bank or payable record.
export function matchBankTransactions({bankTransactions=[],bills=[],amountTolerance=0.01,nearAmountTolerance=5}={}) {
  return bankTransactions.map(txn=>{
    const amount=Math.abs(Number(txn.amount||0));
    const exactCandidates=bills.filter(b=>Math.abs(Math.abs(Number(b.amount||0))-amount)<=amountTolerance);
    const nearCandidates=exactCandidates.length?[]:bills.filter(b=>{ const difference=Math.abs(Math.abs(Number(b.amount||0))-amount); return difference>amountTolerance&&difference<=nearAmountTolerance; });
    const candidates=exactCandidates.length?exactCandidates:nearCandidates;
    const sameEntity=candidates.filter(b=>!txn.entity_id||!b.entity_id||String(b.entity_id)===String(txn.entity_id));
    const memo=textOf(txn);
    const vendorMatches=sameEntity.filter(b=>{const vendor=String(b.vendor_name||b.vendor_id||'').toLowerCase(); return vendor&&memo.includes(vendor);});
    const selected=vendorMatches[0]||sameEntity[0]||null;
    const entityConflict=candidates.length>0&&sameEntity.length===0;
    const amountDifference=selected?+(amount-Math.abs(Number(selected.amount||0))).toFixed(2):null;
    const nearOnly=selected&&nearCandidates.length>0;
    return {bank_txn_id:txn.bank_txn_id||txn.external_id||txn.id,status:entityConflict?'SUSPICIOUS':selected?(nearOnly?'PARTIALLY_MATCHED':vendorMatches.length?'MATCHED':'PARTIALLY_MATCHED'):'UNMATCHED',bill_id:selected?.bill_id||null,amount_difference:amountDifference,confidence:entityConflict?0.98:selected?(nearOnly?0.74:vendorMatches.length?0.96:0.72):0.99,reason:entityConflict?'Amount matches a payable in a different entity':selected?(nearOnly?`Amount differs from payable by ${amountDifference}; human confirmation required`:vendorMatches.length?'Amount, entity and vendor memo match':'Amount and entity match; vendor confirmation required'):'No payable amount match',source_refs:[txn.bank_txn_id||txn.external_id||txn.id,...(selected?[selected.bill_id]:[])]};
  });
}

const coverageMonth = value => {
  const match=String(value||'').match(/^(\d{4})-(\d{2})(?:-\d{2})?$/);
  if(!match || Number(match[2])<1 || Number(match[2])>12) return null;
  return {year:Number(match[1]),month:Number(match[2])};
};
const monthCode = ({year,month}) => `${year}-${String(month).padStart(2,'0')}`;
const nextCoverageMonth = ({year,month}) => month===12?{year:year+1,month:1}:{year,month:month+1};

// Deterministically allocates a prepaid bill across its inclusive coverage months.
// It creates a review artifact only; recognition and posting stay in the JE workflow.
export function createAmortizationSchedule({bill,coverageStart,coverageEnd}={}) {
  if(!bill?.bill_id) throw new Error('Amortization schedule requires a bill ID');
  const start=coverageMonth(coverageStart||bill.coverage_start);
  const end=coverageMonth(coverageEnd||bill.coverage_end);
  if(!start || !end) throw new Error('Amortization schedule requires valid coverage dates');
  if(end.year<start.year || (end.year===start.year && end.month<start.month)) throw new Error('Coverage end cannot precede coverage start');
  const cents=Math.round(Number(bill.amount||0)*100);
  if(!Number.isFinite(cents) || cents<=0) throw new Error('Amortization schedule requires a positive bill amount');
  const months=[]; let cursor=start;
  while(cursor.year<end.year || (cursor.year===end.year && cursor.month<=end.month)) { months.push(monthCode(cursor)); cursor=nextCoverageMonth(cursor); }
  const base=Math.floor(cents/months.length), remainder=cents-base*months.length;
  const lines=months.map((period_code,index)=>({schedule_line_id:`AM-${bill.bill_id}-${period_code}`,period_code,amount:(base+(index===months.length-1?remainder:0))/100,status:'PENDING'}));
  return {schedule_id:`AM-${bill.bill_id}`,bill_id:bill.bill_id,source:String(bill.bill_no||bill.invoice_no||bill.bill_id),coverage_start:coverageStart||bill.coverage_start,coverage_end:coverageEnd||bill.coverage_end,start:coverageStart||bill.coverage_start,end:coverageEnd||bill.coverage_end,months:lines.length,monthly:lines[0].amount,total_amount:cents/100,recognized_amount:0,remaining_amount:cents/100,recognized:0,remaining:cents/100,status:'DRAFT',lines};
}

// AI safety primitives. These contracts deliberately stop at a proposed Draft JE.
const SECRET_KEYS=/password|passwd|token|secret|api[_-]?key|authorization|cookie|ssn|bank[_-]?account|routing/i;
export function redactSecrets(value, seen=new WeakSet()) {
  if (!value || typeof value!=='object') return value;
  // Evidence can be assembled from browser/import objects.  A circular value
  // must never crash event/WAL persistence or retain a live reference that
  // bypasses redaction during later serialization.
  if(seen.has(value)) return '[REDACTED_CIRCULAR_REFERENCE]';
  if(value instanceof Date) return value.toISOString();
  seen.add(value);
  if (Array.isArray(value)) return value.map(item=>redactSecrets(item,seen));
  return Object.fromEntries(Object.entries(value).map(([k,v])=>[k,SECRET_KEYS.test(k)?'[REDACTED]':redactSecrets(v,seen)]));
}

export function buildDecisionEvidence({skill,rule,inputRefs=[],observations=[],alternatives=[],policyGates=[],confidence=0,reasoning=''}={}) {
  return redactSecrets({schema:'AI_DECISION_EVIDENCE_V1',skill,rule,input_refs:inputRefs,observations,alternatives,policy_gates:policyGates,confidence,reasoning,created_by:'AI_ACCOUNTING_BRAIN',created_at:new Date().toISOString()});
}

export function createAIEvent({eventType,actor='AI_ACCOUNTING_BRAIN',correlationId,objectType,objectId,payload={}}={}) {
  return {event_id:`AI-${Date.now()}-${Math.random().toString(36).slice(2,8)}`,event_type:eventType,actor,correlation_id:correlationId||`AI-${Date.now()}`,object_type:objectType,object_id:objectId,payload:redactSecrets(payload),occurred_at:new Date().toISOString()};
}

// Returns an immutable proposal envelope. Callers must pass it through the normal JE workflow.
export function proposeDraftJE({finding,evidence,jeSpec}={}) {
  if (!finding || !evidence || !jeSpec) throw new Error('AI proposal requires finding, evidence and JE spec');
  if (jeSpec.posting_status && jeSpec.posting_status!=='DRAFT') throw new Error('AI proposal cannot be POSTED');
  const confidence=Number(finding.confidence);
  if(!Number.isFinite(confidence)||confidence<0.6) throw new Error('AI proposal confidence below 0.60 must remain in the exception queue');
  ['entity_id','project_id','property_id'].forEach(key=>{ if(finding.dimensions?.[key]!==undefined&&finding.dimensions?.[key]!==null&&String(jeSpec[key])!==String(finding.dimensions[key])) throw new Error(`AI proposal ${key} must match the finding dimension`); });
  if(evidence.schema!=='AI_DECISION_EVIDENCE_V1' || !Array.isArray(evidence.input_refs) || evidence.input_refs.length===0) throw new Error('AI proposal evidence requires a valid schema and source references');
  const gates=evidence.policy_gates||[];
  if(!['DRAFT_ONLY','HUMAN_REVIEW_REQUIRED','NO_AUTOMATIC_POSTING'].every(gate=>gates.includes(gate))) throw new Error('AI proposal evidence requires Draft, human-review and no-posting gates');
  const lines=jeSpec.lines||[];
  const debit=lines.reduce((total,line)=>total+Number(line.debit_amount??line.debit??0),0);
  const credit=lines.reduce((total,line)=>total+Number(line.credit_amount??line.credit??0),0);
  if(lines.length<2 || !(debit>0) || Math.abs(debit-credit)>=0.005) throw new Error('AI proposal Draft JE must be balanced');
  const routedFinding=finding.id&&finding.review_owner?finding:{...finding,id:finding.id||`${finding.skill||'AI'}:${finding.rule||'PROPOSAL'}:${jeSpec.je_id||jeSpec.je_number||'DRAFT'}`,risk:finding.risk||'MEDIUM',object_type:finding.object_type||'JE',object:finding.object||jeSpec.je_id||jeSpec.je_number||'DRAFT',review_owner:reviewBand(finding.confidence).owner};
  const reviewTask=createAIReviewTask({finding:routedFinding,evidence});
  const proposalId=jeSpec.ai_proposal_id||`AI-PROP:${routedFinding.id}:${jeSpec.period_code||jeSpec.je_date||'DRAFT'}`;
  const draft={...redactSecrets(jeSpec),posting_status:'DRAFT',ai_proposed:true,ai_proposal_id:proposalId,ai_finding_id:routedFinding.id,ai_rule_id:finding.rule,ai_confidence:finding.confidence,ai_evidence:evidence,ai_source_refs:[...(finding.source_refs||evidence.input_refs||[])],ai_review_task_id:reviewTask.task_id,history:[...(jeSpec.history||[]),{a:'AI_PROPOSE_DRAFT',by:'AI_ACCOUNTING_BRAIN',at:new Date().toISOString()}]};
  return {draft,review_task:reviewTask,events:[createAIEvent({eventType:'AI_DRAFT_PROPOSED',objectType:'JE',objectId:draft.je_number||draft.je_id,payload:{finding_id:routedFinding.id,rule:finding.rule,confidence:finding.confidence,evidence:evidence.schema,review_task_id:reviewTask.task_id}})]};
}

// Produces one monthly amortization proposal. It intentionally returns a DRAFT envelope,
// leaving review, approval and posting to the existing journal-entry state machine.
export function prepareAmortizationDraftJE({schedule,periodCode,entityId,expenseAccount='632000',prepaidAccount='140100'}={}) {
  if(!schedule?.schedule_id || !periodCode || !entityId) throw new Error('Amortization Draft JE requires schedule, period and entity');
  const line=(schedule.lines||[]).find(item=>item.period_code===periodCode);
  if(!line || line.status!=='PENDING' || !(Number(line.amount)>0)) throw new Error('Amortization period is not available for Draft JE preparation');
  const finding=makeFinding({skill:'PREPAID_AMORTIZATION',rule:'AMORTIZATION_DUE',risk:'LOW',objectType:'AMORTIZATION_SCHEDULE',objectRef:schedule.schedule_id,reason:`Scheduled amortization for ${periodCode}`,action:'Prepare Draft JE for review',confidence:0.99,sourceRefs:[schedule.bill_id],dimensions:{entity_id:entityId,period_code:periodCode}});
  const evidence=buildDecisionEvidence({skill:finding.skill,rule:finding.rule,inputRefs:[`bill:${schedule.bill_id}`,`schedule:${schedule.schedule_id}`],observations:[`Coverage ${schedule.coverage_start} through ${schedule.coverage_end}`,`Scheduled amount ${line.amount} for ${periodCode}`],alternatives:['Defer until coverage or source evidence is corrected'],policyGates:['DRAFT_ONLY','HUMAN_REVIEW_REQUIRED','NO_AUTOMATIC_POSTING'],confidence:finding.confidence,reasoning:'Deterministic monthly allocation from the approved coverage period'});
  return proposeDraftJE({finding,evidence,jeSpec:{entity_id:entityId,je_type:'AUTO',source_system:'AMORTIZATION',posting_status:'DRAFT',je_date:`${periodCode}-01`,period_code:periodCode,description:`Amortization ${schedule.source} - ${periodCode}`,rule_code:'R-PREPAID-AMORT',source_doc_id:schedule.bill_id,lines:[{account_code:expenseAccount,debit_amount:line.amount,credit_amount:0},{account_code:prepaidAccount,debit_amount:0,credit_amount:line.amount}]}});
}

// A close-period accrual is a proposal schedule, never a balance mutation.
export function createAccrualSchedule({sourceRef,description,entityId,periodCode,accrualDate,reversalDate,amount,expenseAccount,liabilityAccount}={}) {
  if(!sourceRef || !entityId || !periodCode || !accrualDate || !reversalDate) throw new Error('Accrual schedule requires source, entity, period and dates');
  if(!/^\d{4}-\d{2}$/.test(periodCode) || !/^\d{4}-\d{2}-\d{2}$/.test(accrualDate) || !/^\d{4}-\d{2}-\d{2}$/.test(reversalDate)) throw new Error('Accrual schedule requires ISO period and dates');
  if(reversalDate<=accrualDate) throw new Error('Accrual reversal date must be after accrual date');
  const normalizedAmount=Math.round(Number(amount)*100)/100;
  if(!(normalizedAmount>0) || !expenseAccount || !liabilityAccount) throw new Error('Accrual schedule requires amount and account mapping');
  return {schedule_id:`AC-${entityId}-${periodCode}-${String(sourceRef).replace(/[^A-Za-z0-9]/g,'').slice(-16)}`,source_ref:String(sourceRef),description:description||`Accrual for ${sourceRef}`,entity_id:entityId,period_code:periodCode,accrual_date:accrualDate,reversal_date:reversalDate,amount:normalizedAmount,expense_account:expenseAccount,liability_account:liabilityAccount,status:'DRAFT',reversal_status:'NOT_PREPARED'};
}

export function prepareAccrualDraftJE({schedule}={}) {
  if(!schedule?.schedule_id || schedule.status!=='DRAFT') throw new Error('Accrual schedule must be in Draft status');
  const finding=makeFinding({skill:'ACCRUAL_ACCOUNTING',rule:'MISSING_ACCRUAL',risk:'MEDIUM',objectType:'ACCRUAL_SCHEDULE',objectRef:schedule.schedule_id,reason:`Accrual is due for ${schedule.period_code}`,action:'Prepare Draft accrual JE for controller review',confidence:0.9,sourceRefs:[schedule.source_ref],dimensions:{entity_id:schedule.entity_id,period_code:schedule.period_code}});
  const evidence=buildDecisionEvidence({skill:finding.skill,rule:finding.rule,inputRefs:[schedule.source_ref,`schedule:${schedule.schedule_id}`],observations:[schedule.description,`Accrual ${schedule.amount} on ${schedule.accrual_date}`,`Reverse on ${schedule.reversal_date}`],alternatives:['Do not accrue until source support is available'],policyGates:['DRAFT_ONLY','HUMAN_REVIEW_REQUIRED','NO_AUTOMATIC_POSTING'],confidence:finding.confidence,reasoning:'Deterministic close-period accrual based on supplied source support and account mapping'});
  return proposeDraftJE({finding,evidence,jeSpec:{entity_id:schedule.entity_id,je_type:'AUTO',source_system:'ACCRUAL',posting_status:'DRAFT',je_date:schedule.accrual_date,period_code:schedule.period_code,description:schedule.description,rule_code:'R-ACCRUAL',source_doc_id:schedule.source_ref,accrual_schedule_id:schedule.schedule_id,lines:[{account_code:schedule.expense_account,debit_amount:schedule.amount,credit_amount:0},{account_code:schedule.liability_account,debit_amount:0,credit_amount:schedule.amount}]}});
}

export function prepareAccrualReversalDraftJE({schedule,accrualDraft}={}) {
  if(!schedule?.schedule_id || !accrualDraft?.ai_proposed || accrualDraft.posting_status!=='DRAFT') throw new Error('Accrual reversal requires its AI Draft accrual JE');
  const finding=makeFinding({skill:'ACCRUAL_ACCOUNTING',rule:'ACCRUAL_REVERSAL_DUE',risk:'LOW',objectType:'ACCRUAL_SCHEDULE',objectRef:schedule.schedule_id,reason:`Reverse accrual on ${schedule.reversal_date}`,action:'Prepare Draft reversal JE for review',confidence:0.99,sourceRefs:[schedule.source_ref,accrualDraft.je_id||accrualDraft.je_number||schedule.schedule_id],dimensions:{entity_id:schedule.entity_id}});
  const evidence=buildDecisionEvidence({skill:finding.skill,rule:finding.rule,inputRefs:[schedule.source_ref,`accrual_draft:${accrualDraft.je_id||accrualDraft.je_number||schedule.schedule_id}`],observations:[`Reverse ${schedule.amount} on ${schedule.reversal_date}`],alternatives:['Keep accrual open pending human review'],policyGates:['DRAFT_ONLY','HUMAN_REVIEW_REQUIRED','NO_AUTOMATIC_POSTING'],confidence:finding.confidence,reasoning:'Reversal mirrors the related AI accrual Draft and must follow the same approval workflow'});
  return proposeDraftJE({finding,evidence,jeSpec:{entity_id:schedule.entity_id,je_type:'AUTO',source_system:'ACCRUAL_REVERSAL',posting_status:'DRAFT',je_date:schedule.reversal_date,period_code:schedule.reversal_date.slice(0,7),description:`Reversal: ${schedule.description}`,rule_code:'R-ACCRUAL-REVERSAL',source_doc_id:schedule.source_ref,accrual_schedule_id:schedule.schedule_id,reverses_ai_draft:accrualDraft.je_id||accrualDraft.je_number||null,lines:[{account_code:schedule.liability_account,debit_amount:schedule.amount,credit_amount:0},{account_code:schedule.expense_account,debit_amount:0,credit_amount:schedule.amount}]}});
}

export function createAIWALRecord({proposalId, finding, evidence, draft}={}) {
  if(!proposalId || !finding || !evidence || !draft) throw new Error('WAL requires proposalId, finding, evidence and draft');
  if(draft.posting_status!=='DRAFT') throw new Error('WAL cannot persist a non-Draft proposal');
  const objectId=draft.je_number||draft.je_id;
  const idempotencyKey=`AI-DRAFT:${proposalId}`;
  return {wal_id:`AI-WAL-${proposalId}`,proposal_id:proposalId,state:'PREPARED',idempotency_key:idempotencyKey,finding_id:finding.id,evidence:redactSecrets(evidence),draft:redactSecrets(draft),events:[
    createAIEvent({eventType:'AI_DRAFT_ACCEPTED_FOR_REVIEW',correlationId:proposalId,objectType:'JE',objectId,payload:{finding_id:finding.id,rule:finding.rule,confidence:draft.ai_confidence??finding.confidence,review_task_id:draft.ai_review_task_id||null,posting_status:'DRAFT'}}),
    createAIEvent({eventType:'AI_WAL_PREPARED',correlationId:proposalId,objectType:'JE',objectId,payload:{idempotency_key:idempotencyKey}})
  ],created_at:new Date().toISOString()};
}

export function recoverAIWAL(wal, existingDrafts=[]) {
  if(!wal || !wal.draft || !['PREPARED','COMMITTED'].includes(wal.state)) return {status:'NO_RECOVERY',draft:null,events:[]};
  const existing=existingDrafts.find(j=>j.ai_proposal_id===wal.proposal_id || j.je_number===wal.draft.je_number);
  if(existing) return {status:'IDEMPOTENT_REUSE',draft:existing,events:[createAIEvent({eventType:'AI_WAL_REUSED',correlationId:wal.proposal_id,objectType:'JE',objectId:existing.je_number,payload:{idempotency_key:wal.idempotency_key}})]};
  const draft={...wal.draft,posting_status:'DRAFT',ai_proposal_id:wal.proposal_id,history:[...(wal.draft.history||[]),{a:'AI_WAL_RECOVERED',by:'AI_ACCOUNTING_BRAIN',at:new Date().toISOString()}]};
  const eventType=wal.state==='COMMITTED'?'AI_WAL_COMMITTED_DRAFT_RECOVERED':'AI_WAL_RECOVERED';
  return {status:'RECOVERED_DRAFT',recovery_from:wal.state,draft,events:[createAIEvent({eventType,correlationId:wal.proposal_id,objectType:'JE',objectId:draft.je_number||draft.je_id,payload:{idempotency_key:wal.idempotency_key,posting_status:'DRAFT'}})]};
}

// Storage adapter boundary for browser today and a server transaction store later.
// Committing here means the Draft was durably accepted by the caller; it never means POSTED.
export function createAIWALRepository(storage,{walKey='ai_accounting_wal',eventKey='ai_accounting_events'}={}) {
  if(!storage?.load || !storage?.save) throw new Error('AI WAL repository requires load/save storage adapter');
  const wals=()=>storage.load(walKey,[]);
  // The browser repository historically swallows quota/storage exceptions. Read
  // back every WAL/event write so a failed persistence call can never be
  // mistaken for an accepted AI Draft transaction.
  const saveWals=rows=>{
    storage.save(walKey,rows);
    const persisted=storage.load(walKey,[]);
    const confirmed=Array.isArray(persisted)&&rows.every(row=>persisted.some(saved=>saved?.wal_id===row.wal_id&&saved?.state===row.state&&saved?.idempotency_key===row.idempotency_key));
    if(!confirmed) throw new Error('AI WAL persistence was not confirmed');
  };
  const appendEvents=events=>{
    if(!events?.length) return;
    storage.save(eventKey,[...storage.load(eventKey,[]),...events.map(event=>redactSecrets(event))].slice(-500));
    const persisted=storage.load(eventKey,[]);
    const ids=new Set(Array.isArray(persisted)?persisted.map(event=>event?.event_id):[]);
    if(!events.every(event=>ids.has(event.event_id))) throw new Error('AI event persistence was not confirmed');
  };
  return {
    list:()=>wals(),
    events:()=>storage.load(eventKey,[]),
    prepare(args){
      const key=`AI-DRAFT:${args?.proposalId||''}`;
      const existing=wals().find(record=>record.idempotency_key===key);
      if(existing) return {status:'IDEMPOTENT_REUSE',wal:existing,events:[]};
      const wal=createAIWALRecord(args);
      saveWals([...wals(),wal]); appendEvents(wal.events);
      return {status:'PREPARED',wal,events:wal.events};
    },
    recover(existingDrafts=[]){
      const results=wals().filter(wal=>['PREPARED','COMMITTED'].includes(wal.state)).map(wal=>recoverAIWAL(wal,existingDrafts));
      // Reusing an already-present Draft is an idempotency check, not an
      // accounting event. Persist only a real recovery so opening another tab
      // does not flood the audit trail with duplicate reuse records.
      appendEvents(results.filter(result=>result.status==='RECOVERED_DRAFT').flatMap(result=>result.events));
      return results;
    },
    commitDraft(proposalId,draft){
      if(!proposalId || draft?.posting_status!=='DRAFT') throw new Error('AI WAL can only commit a Draft proposal');
      let committed=null, newlyCommitted=false;
      const rows=wals().map(wal=>{
        if(wal.proposal_id!==proposalId) return wal;
        if(wal.state==='COMMITTED') { committed=wal; return wal; }
        committed={...wal,state:'COMMITTED',committed_at:new Date().toISOString()}; newlyCommitted=true;
        return committed;
      });
      if(!committed) throw new Error('AI WAL proposal was not found');
      saveWals(rows);
      const events=newlyCommitted?[createAIEvent({eventType:'AI_WAL_COMMITTED',correlationId:proposalId,objectType:'JE',objectId:draft.je_number||draft.je_id,payload:{idempotency_key:committed.idempotency_key,posting_status:'DRAFT'}})]:[];
      appendEvents(events);
      return {wal:committed,events};
    }
  };
}

export function createAIReviewTask({finding,evidence}={}) {
  if(!finding?.id || !finding.review_owner) throw new Error('AI review task requires a routed finding');
  const createdAt=new Date();
  const dueAt=new Date(createdAt);
  dueAt.setUTCDate(dueAt.getUTCDate()+(finding.risk==='HIGH'?0:5));
  return {task_id:`AI-REVIEW:${finding.id}`,task_type:'AI_ACCOUNTING_REVIEW',status:'OPEN',priority:finding.risk,owner:finding.review_owner,finding_id:finding.id,object_type:finding.object_type,object_ref:finding.object,due_policy:finding.risk==='HIGH'?'IMMEDIATE':'STANDARD_REVIEW',due_at:dueAt.toISOString(),evidence_schema:evidence?.schema||'AI_DECISION_EVIDENCE_V1',can_post:false,created_at:createdAt.toISOString()};
}

// Read-model summary for controller reports; it never changes task or JE state.
const effectiveReviewState=(finding,workflow={})=>{
  const override=workflow?.[finding?.id]||{};
  return {status:override.status||finding?.review_task?.status||'OPEN',owner:override.owner||finding?.review_task?.owner||finding?.review_owner||'ACCOUNTING_OPS'};
};
export function summarizeAIReviewQueue(findings=[],workflow={}) {
  const open=findings.filter(f=>effectiveReviewState(f,workflow).status==='OPEN');
  const byOwner=Object.fromEntries(open.reduce((groups,f)=>{ const owner=effectiveReviewState(f,workflow).owner; groups.set(owner,(groups.get(owner)||0)+1); return groups; },new Map()));
  return {total:findings.length,open:open.length,high:open.filter(f=>f.risk==='HIGH').length,unpostable:findings.filter(f=>f.can_post===false).length,source_references:findings.reduce((count,f)=>count+(f.source_refs||[]).length,0),by_owner:byOwner};
}

// Export-safe, deterministic Controller memo. It contains recommendations and
// routing only; it neither approves a finding nor changes a journal state.
export function createControllerReviewMemo({findings=[],periodCode=null,entityId=null,workflow={}}={}) {
  const queue=summarizeAIReviewQueue(findings,workflow);
  const actions=findings.filter(f=>effectiveReviewState(f,workflow).status!=='RESOLVED').map(f=>({finding_id:f.id,risk:f.risk,skill:f.skill,rule:f.rule,reason:f.reason,suggested_action:f.action,owner:effectiveReviewState(f,workflow).owner,review_task_id:f.review_task?.task_id||null,due_at:workflow?.[f.id]?.due_date||f.review_task?.due_at||null,source_refs:f.source_refs||[],confidence:f.confidence,can_post:false}));
  const bySkill=Object.fromEntries(actions.reduce((groups,action)=>{groups.set(action.skill,(groups.get(action.skill)||0)+1);return groups;},new Map()));
  return {schema:'AI_CONTROLLER_REVIEW_MEMO_V1',period_code:periodCode,entity_id:entityId,generated_by:'AI_ACCOUNTING_BRAIN',generated_at:new Date().toISOString(),summary:{...queue,by_skill:bySkill},controller_actions:actions,control_boundary:'Recommendations only. No finding, JE, payment, posting or period state was changed.'};
}

export function makeFinding({skill, rule, risk='MEDIUM', objectType, objectRef, reason, action, confidence=0.5, sourceRefs=[], dimensions={}, proposedJE=null}) {
  const normalizedConfidence=Math.max(0,Math.min(1,Number(confidence)||0));
  const normalizedSourceRefs=[...new Set((sourceRefs||[]).filter(Boolean).map(String))];
  if(!normalizedSourceRefs.length && objectType && objectRef) normalizedSourceRefs.push(`${objectType}:${objectRef}`);
  const band=reviewBand(normalizedConfidence);
  // Workflow overlays are keyed by finding ID. Include the accounting scope so
  // identical document numbers from separate entities or periods never share
  // assignment, due-date or resolution state.
  const identityPart=value=>encodeURIComponent(String(value??'_'));
  const findingId=[skill,rule,dimensions.entity_id,dimensions.period_code,dimensions.project_id,dimensions.property_id,objectRef].map(identityPart).join(':');
  const finding={id:findingId, skill, rule, risk, object_type:objectType, object:objectRef, reason, action, confidence:normalizedConfidence, review_status:band.status, review_owner:band.owner, can_post:band.canPost, source_refs:normalizedSourceRefs, dimensions, proposed_je:proposedJE, audit:{created_by:'AI_ACCOUNTING_BRAIN', rule_id:rule, at:new Date().toISOString()}};
  const evidence=buildDecisionEvidence({skill,rule,inputRefs:normalizedSourceRefs,observations:[reason],alternatives:[action],policyGates:['HUMAN_REVIEW_REQUIRED','NO_AUTOMATIC_POSTING'],confidence:normalizedConfidence,reasoning:'Deterministic accounting rule result; route to the assigned review owner'});
  return {...finding,evidence,review_task:createAIReviewTask({finding,evidence})};
}

const textOf = x => `${x?.description||''} ${x?.memo||''} ${x?.reference||''} ${x?.vendor_name||''} ${x?.payee||''}`.toLowerCase();
const isInsurance = x => /insurance|premium|coverage|\u4fdd[\u9669\u96aa]/i.test(textOf(x));
const isPrepaidLike = x => isInsurance(x)||/property tax|subscription|license|warranty|maintenance contract|\u7269\u4e1a\u7a0e|\u8ba2\u9605|\u8bb8\u53ef\u8bc1|\u4fdd\u4fee/.test(textOf(x));
const isLoan = x => /loan|draw|lender|interest|repay|\u501f\u6b3e|\u8d37\u6b3e|\u5229\u606f/i.test(textOf(x));

export function runAccountingBrain({jes=[], bills=[], bankTransactions=[], bankReconciliations=[], sourceDocs=[], accrualCandidates=[], reports=[], trialBalances=[], revenueRecords=[], loanRecords=[], constructionProjects=[], intercompanyBalances=[], period, entity, asOfDate}={}) {
  const findings=[];
  const posted=jes.filter(j=>j.posting_status==='POSTED' && (!entity||j.entity_id===entity));
  const postedPayableRefs=new Set(posted.flatMap(j=>[j.source_doc_id,j.source_ref,j.bill_id,j.bill_no,j.ap_bill_id,j.je_number].filter(value=>value!==undefined&&value!==null&&value!=='').map(String)));
  const sourceById=new Map(sourceDocs.map(d=>[d.source_doc_id||d.doc_id||d.source_id||d.id,d]).filter(([id])=>id));
  const push=f=>findings.push(makeFinding(f));

  posted.forEach(j=>{
    const sourceId=j.source_doc_id;
    const source=sourceId&&sourceById.get(sourceId);
    if(source?.entity_id&&j.entity_id&&String(source.entity_id)!==String(j.entity_id)) push({skill:'REAL_ESTATE_CONTROLLER',rule:'SOURCE_ENTITY_MISMATCH',risk:'HIGH',objectType:'JE',objectRef:j.je_number,reason:`Source ${sourceId} belongs to entity ${source.entity_id} but JE belongs to entity ${j.entity_id}`,action:'Hold review and reconcile entity ownership before approval or posting',confidence:0.99,sourceRefs:[sourceId,j.je_number],dimensions:{entity_id:j.entity_id,project_id:j.project_id,property_id:j.property_id,period_code:j.period_code}});
  });
  const postedJESignatures=new Map();
  posted.forEach(j=>{
    // A duplicate requires a shared retained source and an identical complete
    // line signature.  Similar recurring entries with different sources are
    // intentionally not treated as duplicates.
    if(!j.source_doc_id) return;
    const lines=(j.lines||[]).map(line=>[line.account_code||'',Number(line.debit_amount||0).toFixed(2),Number(line.credit_amount||0).toFixed(2),line.project_id||'',line.property_id||''].join('|')).sort().join('~');
    if(!lines) return;
    const key=[j.entity_id||'',j.period_code||'',j.source_doc_id,lines].join('::');
    const prior=postedJESignatures.get(key);
    if(prior) push({skill:'AUDIT_REVIEW',rule:'DUPLICATE_JE',risk:'HIGH',objectType:'JE',objectRef:j.je_number,reason:`Posted JE has the same source, entity, period and complete line pattern as ${prior.je_number}`,action:'Hold downstream reporting and investigate duplicate posting before any correction',confidence:0.99,sourceRefs:[j.source_doc_id,prior.je_number,j.je_number],dimensions:{entity_id:j.entity_id,project_id:j.project_id,property_id:j.property_id,period_code:j.period_code}});
    else postedJESignatures.set(key,j);
  });

  const normalizedSources=sourceDocs.map(normalizeAccountingSource);
  normalizedSources.filter(source=>source.ingestion_status==='INCOMPLETE').forEach(source=>push({skill:'REAL_ESTATE_CONTROLLER',rule:'SOURCE_COMPLETENESS',risk:'HIGH',objectType:'SOURCE_DOCUMENT',objectRef:source.source_id||'UNIDENTIFIED',reason:`Source is missing required fields: ${source.missing_fields.join(', ')}`,action:'Complete source metadata before accounting treatment or Draft JE preparation',confidence:0.99,sourceRefs:[source.source_id||'UNIDENTIFIED'],dimensions:{entity_id:source.entity_id,project_id:source.project_id,property_id:source.property_id}}));
  const sourceKeys=new Map();
  normalizedSources.filter(source=>source.ingestion_status==='READY').forEach(source=>{
    const externalRef=String(source.external_id||source.doc_no||source.invoice_no||source.reference||'').trim().toLowerCase();
    if(!externalRef) return;
    const key=[source.source_type,source.entity_id,externalRef,source.date,Number(source.amount).toFixed(2)].join('|');
    const prior=sourceKeys.get(key);
    if(prior) push({skill:'AUDIT_REVIEW',rule:'DUPLICATE_SOURCE',risk:'HIGH',objectType:'SOURCE_DOCUMENT',objectRef:source.source_id,reason:`Same source type, entity, external reference, date and amount as ${prior.source_id}`,action:'Hold accounting treatment and compare the retained source files before review or Draft JE preparation',confidence:0.99,sourceRefs:[prior.source_id,source.source_id],dimensions:{entity_id:source.entity_id,project_id:source.project_id,property_id:source.property_id}});
    else sourceKeys.set(key,source);
  });

  // Do not infer normal account direction from a number alone. The caller must
  // explicitly identify a debit-normal or otherwise unexpected negative balance.
  trialBalances.forEach(row=>{
    const balance=Number(row.ending_balance??row.balance??0);
    const normalBalance=String(row.normal_balance||'').toUpperCase();
    const unexpected=row.unexpected_negative===true||normalBalance==='DEBIT';
    if(unexpected && Number.isFinite(balance) && balance< -Math.abs(Number(row.tolerance??0.01))){
      const accountRef=String(row.account_code||row.account_id||row.id||'UNMAPPED_ACCOUNT');
      push({skill:'AUDIT_REVIEW',rule:'NEGATIVE_BALANCE',risk:Math.abs(balance)>=Number(row.materiality||5000)?'HIGH':'MEDIUM',objectType:'GL_ACCOUNT',objectRef:accountRef,reason:`Unexpected negative balance ${balance} for a ${normalBalance||'designated'} normal-balance account`,action:'Reconcile account activity, account mapping and supporting JEs before report sign-off',confidence:0.98,sourceRefs:row.source_refs||[row.source_ref||`trial_balance:${accountRef}`],dimensions:{entity_id:row.entity_id,project_id:row.project_id,property_id:row.property_id,period_code:row.period_code}});
    }
  });

  const invoiceKeys=new Map();
  bills.forEach(b=>{
    const key=`${b.vendor_id||b.vendor_name}|${String(b.invoice_no||'').trim().toLowerCase()}|${Number(b.amount||0).toFixed(2)}`;
    if(!b.invoice_no || !b.vendor_id) push({skill:'AP_ACCOUNTING',rule:'MISSING_SOURCE',risk:'HIGH',objectType:'PAYABLE',objectRef:b.bill_no||String(b.bill_id),reason:'Payable lacks vendor or invoice identifier',action:'Route to exception queue and complete source fields',confidence:0.99,sourceRefs:[b.bill_id],dimensions:{entity_id:b.entity_id,project_id:b.project_id}});
    if(invoiceKeys.has(key)) push({skill:'AP_ACCOUNTING',rule:'DUPLICATE_INVOICE',risk:'HIGH',objectType:'PAYABLE',objectRef:b.bill_no||String(b.bill_id),reason:`Same vendor, invoice number and amount as ${invoiceKeys.get(key)}`,action:'Hold payment and compare source document',confidence:0.98,sourceRefs:[invoiceKeys.get(key),b.bill_id]});
    invoiceKeys.set(key,b.bill_no||String(b.bill_id));
    const payableRefs=[b.bill_id,b.bill_no,b.je_number].filter(value=>value!==undefined&&value!==null&&value!=='').map(String);
    const requiresAccrual=b.requires_accrual===true||b.received_service===true;
    if(requiresAccrual && payableRefs.length && !payableRefs.some(ref=>postedPayableRefs.has(ref))) push({skill:'AP_ACCOUNTING',rule:'PAYABLE_GL_MISSING',risk:Number(b.amount||0)>=Number(b.materiality||5000)?'HIGH':'MEDIUM',objectType:'PAYABLE',objectRef:b.bill_no||String(b.bill_id),reason:'Payable is marked as incurred/required for accrual but has no linked posted GL entry',action:'Validate invoice support and prepare a Draft accrual JE for human review',confidence:0.94,sourceRefs:[b.bill_id],dimensions:{entity_id:b.entity_id,project_id:b.project_id,property_id:b.property_id,period_code:b.period_code}});
    const serviceDate=b.service_date||b.invoice_date||b.bill_date;
    const accountingPeriod=b.period_code||period?.period_code;
    if(isValidISODate(serviceDate)&&isValidPeriodCode(accountingPeriod)&&serviceDate.slice(0,7)!==accountingPeriod) push({skill:'ACCRUAL_ACCOUNTING',rule:'CUTOFF_MISMATCH',risk:period?.status==='CLOSED'?'HIGH':'MEDIUM',objectType:'PAYABLE',objectRef:b.bill_no||String(b.bill_id),reason:`Payable business date ${serviceDate} does not match accounting period ${accountingPeriod}`,action:'Confirm cutoff, then prepare a Draft accrual or reversing entry for human review',confidence:0.95,sourceRefs:[b.bill_id],dimensions:{entity_id:b.entity_id,project_id:b.project_id,property_id:b.property_id,period_code:accountingPeriod}});
    if(isPrepaidLike(b) && !b.coverage_start && !b.coverage_end) push({skill:'PREPAID_AMORTIZATION',rule:'PREPAID_COVERAGE_MISSING',risk:'MEDIUM',objectType:'PAYABLE',objectRef:b.bill_no||String(b.bill_id),reason:'Prepaid-like payable has no coverage period',action:'Request coverage dates before creating amortization schedule',confidence:0.91,sourceRefs:[b.bill_id],dimensions:{entity_id:b.entity_id,property_id:b.property_id}});
    const coverageStart=coverageMonth(b.coverage_start), coverageEnd=coverageMonth(b.coverage_end);
    if(isPrepaidLike(b) && coverageStart && coverageEnd && (coverageEnd.year>coverageStart.year || coverageEnd.month>coverageStart.month)) push({skill:'PREPAID_AMORTIZATION',rule:'PREPAID_SCHEDULE_REQUIRED',risk:'MEDIUM',objectType:'PAYABLE',objectRef:b.bill_no||String(b.bill_id),reason:`Prepaid-like payable covers ${b.coverage_start} through ${b.coverage_end} and requires monthly allocation`,action:'Create an amortization schedule and prepare monthly Draft JEs for review',confidence:0.95,sourceRefs:[b.bill_id],dimensions:{entity_id:b.entity_id,project_id:b.project_id,property_id:b.property_id,period_code:b.period_code}});
    if(/cwip|construction|development|build/i.test(textOf(b)) && (!b.project_id || !b.property_id || !b.cost_code)) push({skill:'CONSTRUCTION_COST',rule:'COST_DIMENSION_MISSING',risk:'HIGH',objectType:'PAYABLE',objectRef:b.bill_no||String(b.bill_id),reason:'Construction-like payable lacks project, property or cost-code attribution',action:'Complete cost dimensions before capitalization or Draft JE preparation',confidence:0.96,sourceRefs:[b.bill_id],dimensions:{entity_id:b.entity_id,project_id:b.project_id,property_id:b.property_id}});
    const dueDate=String(b.due_date||b.bill_date||''); const dueMs=Date.parse(dueDate); const asOfMs=Date.parse(asOfDate||'');
    const openAmount=Math.max(0,Number(b.amount||0)-Number(b.paid_amount||0));
    if(Number.isFinite(dueMs) && Number.isFinite(asOfMs) && openAmount>0 && Math.floor((asOfMs-dueMs)/86400000)>90) push({skill:'AP_ACCOUNTING',rule:'STALE_PAYABLE',risk:openAmount>=Number(b.materiality||5000)?'HIGH':'MEDIUM',objectType:'PAYABLE',objectRef:b.bill_no||String(b.bill_id),reason:`Open payable ${openAmount} is ${Math.floor((asOfMs-dueMs)/86400000)} days past due`,action:'Confirm vendor balance, payment status and required accrual/reclass before close',confidence:0.93,sourceRefs:[b.bill_id],dimensions:{entity_id:b.entity_id,project_id:b.project_id,property_id:b.property_id}});
  });

  bankReconciliations.forEach(item=>{
    const statement=Number(item.statement_balance||0), ledger=Number(item.ledger_balance||0), difference=+(statement-ledger).toFixed(2), tolerance=Number(item.tolerance??0.01);
    if(Math.abs(difference)>tolerance) push({skill:'BANK_RECONCILIATION',rule:'BANK_GL_CASH_MISMATCH',risk:Math.abs(difference)>=Number(item.materiality||5000)?'HIGH':'MEDIUM',objectType:'BANK_ACCOUNT',objectRef:item.bank_account_code||item.account_id||String(item.id),reason:`Bank statement ${statement} differs from GL cash ${ledger} by ${difference}`,action:'Reconcile outstanding transactions and retain source evidence before bank sign-off',confidence:0.98,sourceRefs:item.source_refs||[item.statement_id||item.id],dimensions:{entity_id:item.entity_id,period_code:item.period_code,bank_account_code:item.bank_account_code}});
  });

  constructionProjects.forEach(project=>{
    const amount=Number(project.post_completion_capitalized_amount||0);
    if(project.completion_date && amount>0.005) push({skill:'CONSTRUCTION_COST',rule:'CWIP_POST_COMPLETION',risk:amount>=Number(project.materiality||5000)?'HIGH':'MEDIUM',objectType:'PROJECT',objectRef:project.project_id||project.project_code||String(project.id),reason:`Capitalized cost ${amount} exists after project completion ${project.completion_date}`,action:'Confirm punch-list capitalization policy and prepare a Draft reclass only after controller review',confidence:0.95,sourceRefs:project.source_refs||[project.id],dimensions:{entity_id:project.entity_id,project_id:project.project_id,property_id:project.property_id,period_code:project.period_code}});
  });

  intercompanyBalances.forEach(item=>{
    const dueFrom=Number(item.due_from_balance||0), dueTo=Number(item.due_to_balance||0), difference=+(dueFrom+dueTo).toFixed(2), tolerance=Number(item.tolerance??0.01);
    if(Math.abs(difference)>tolerance) push({skill:'REAL_ESTATE_CONTROLLER',rule:'INTERCOMPANY_IMBALANCE',risk:Math.abs(difference)>=Number(item.materiality||5000)?'HIGH':'MEDIUM',objectType:'INTERCOMPANY_PAIR',objectRef:item.pair_id||`${item.from_entity_id||'?'}:${item.to_entity_id||'?'}`,reason:`Intercompany due-from ${dueFrom} and due-to ${dueTo} do not eliminate; difference ${difference}`,action:'Reconcile both entity ledgers and prepare a Draft reclass only after controller review',confidence:0.97,sourceRefs:item.source_refs||[item.id].filter(Boolean),dimensions:{entity_id:item.from_entity_id,counterparty_entity_id:item.to_entity_id,period_code:item.period_code}});
  });

  accrualCandidates.forEach(item=>{
    const expected=Number(item.expected_amount||0), accrued=Number(item.accrued_amount||0), gap=+(expected-accrued).toFixed(2);
    if(item.status!=='EXCLUDED' && gap>0.005) push({skill:'ACCRUAL_ACCOUNTING',rule:'MISSING_ACCRUAL',risk:gap>=Number(item.materiality||5000)?'HIGH':'MEDIUM',objectType:'ACCRUAL_SOURCE',objectRef:item.source_ref||String(item.id),reason:`Expected accrual ${expected} exceeds recorded accrual ${accrued} by ${gap}`,action:'Validate source support and prepare a Draft accrual JE for review',confidence:item.confidence??0.85,sourceRefs:[item.source_ref||item.id],dimensions:{entity_id:item.entity_id,period_code:item.period_code,project_id:item.project_id}});
  });

  reports.forEach(report=>{
    const current=Number(report.current_amount||0), prior=Number(report.prior_amount||0), variance=+(current-prior).toFixed(2), threshold=Number(report.variance_threshold??0);
    if(threshold>0 && Math.abs(variance)>=threshold) push({skill:'FINANCIAL_REPORTING',rule:'REPORT_VARIANCE',risk:Math.abs(variance)>=threshold*2?'HIGH':'MEDIUM',objectType:'REPORT_LINE',objectRef:report.line_id||report.line_name||String(report.id),reason:`Report variance ${variance} exceeds threshold ${threshold}`,action:'Explain variance with source drill-down before reporting sign-off',confidence:0.92,sourceRefs:report.source_refs||[report.id],dimensions:{entity_id:report.entity_id,period_code:report.period_code,report_code:report.report_code}});
  });

  revenueRecords.forEach(record=>{
    const expected=Number(record.expected_amount||0), recognized=Number(record.recognized_amount||0), difference=+(expected-recognized).toFixed(2);
    if(record.status!=='EXCLUDED' && Math.abs(difference)>0.005) push({skill:'PROPERTY_REVENUE',rule:'REVENUE_MISMATCH',risk:Math.abs(difference)>=Number(record.materiality||5000)?'HIGH':'MEDIUM',objectType:'REVENUE_RECORD',objectRef:record.revenue_id||record.lease_id||String(record.id),reason:`Expected revenue ${expected} differs from recognized revenue ${recognized} by ${difference}`,action:'Reconcile lease, billing and GL source before revenue sign-off',confidence:record.confidence??0.9,sourceRefs:record.source_refs||[record.id],dimensions:{entity_id:record.entity_id,period_code:record.period_code,property_id:record.property_id}});
    if(record.is_deposit===true && recognized>0) push({skill:'PROPERTY_REVENUE',rule:'DEPOSIT_LIABILITY',risk:'HIGH',objectType:'REVENUE_RECORD',objectRef:record.revenue_id||record.lease_id||String(record.id),reason:'Tenant deposit is recognized as revenue instead of being held as a liability',action:'Prepare Draft reclassification for controller review',confidence:0.98,sourceRefs:record.source_refs||[record.id],dimensions:{entity_id:record.entity_id,period_code:record.period_code,property_id:record.property_id}});
  });

  loanRecords.forEach(loan=>{
    const expected=Number(loan.expected_balance||0), ledger=Number(loan.ledger_balance||0), difference=+(expected-ledger).toFixed(2), tolerance=Number(loan.tolerance??0.01);
    if(Math.abs(difference)>tolerance) push({skill:'CONSTRUCTION_LOAN',rule:'LOAN_BALANCE_MISMATCH',risk:Math.abs(difference)>=Number(loan.materiality||5000)?'HIGH':'MEDIUM',objectType:'LOAN',objectRef:loan.loan_id||loan.loan_number||String(loan.id),reason:`Lender balance ${expected} differs from ledger balance ${ledger} by ${difference}`,action:'Reconcile lender statement and GL before loan close',confidence:0.95,sourceRefs:loan.source_refs||[loan.id],dimensions:{entity_id:loan.entity_id,period_code:loan.period_code,project_id:loan.project_id}});
    const hasDraw=loan.draw_amount!==undefined&&loan.draw_amount!==null, hasCost=loan.matched_project_cost!==undefined&&loan.matched_project_cost!==null;
    const draw=Number(loan.draw_amount), projectCost=Number(loan.matched_project_cost), drawDifference=+(draw-projectCost).toFixed(2);
    if(hasDraw&&hasCost&&Number.isFinite(draw)&&Number.isFinite(projectCost)&&Math.abs(drawDifference)>tolerance) push({skill:'CONSTRUCTION_LOAN',rule:'LOAN_DRAW_COST_MISMATCH',risk:Math.abs(drawDifference)>=Number(loan.materiality||5000)?'HIGH':'MEDIUM',objectType:'LOAN_DRAW',objectRef:loan.draw_id||loan.loan_id||loan.loan_number||String(loan.id),reason:`Loan draw ${draw} differs from matched project cost ${projectCost} by ${drawDifference}`,action:'Reconcile draw schedule, bank receipt and project-cost support before preparing any Draft reclass',confidence:0.96,sourceRefs:loan.source_refs||[loan.draw_id||loan.id],dimensions:{entity_id:loan.entity_id,period_code:loan.period_code,project_id:loan.project_id,property_id:loan.property_id}});
    const eligible=Number(loan.eligible_interest||0), capitalized=Number(loan.capitalized_interest||0);
    if(capitalized>eligible+0.005) push({skill:'CONSTRUCTION_LOAN',rule:'INTEREST_CAPITALIZATION',risk:'HIGH',objectType:'LOAN',objectRef:loan.loan_id||loan.loan_number||String(loan.id),reason:`Capitalized interest ${capitalized} exceeds eligible interest ${eligible}`,action:'Prepare a Draft reclassification only after controller review',confidence:0.97,sourceRefs:loan.source_refs||[loan.id],dimensions:{entity_id:loan.entity_id,period_code:loan.period_code,project_id:loan.project_id}});
    if(loan.requires_capitalization===true && eligible>capitalized+0.005) push({skill:'CONSTRUCTION_LOAN',rule:'INTEREST_CAPITALIZATION_REQUIRED',risk:(eligible-capitalized)>=Number(loan.materiality||5000)?'HIGH':'MEDIUM',objectType:'LOAN',objectRef:loan.loan_id||loan.loan_number||String(loan.id),reason:`Policy-marked eligible interest ${eligible} exceeds capitalized interest ${capitalized} by ${+(eligible-capitalized).toFixed(2)}`,action:'Validate construction status and prepare a Draft interest reclassification for controller review',confidence:0.94,sourceRefs:loan.source_refs||[loan.id],dimensions:{entity_id:loan.entity_id,period_code:loan.period_code,project_id:loan.project_id}});
  });

  const bankByMatch=new Map();
  const bankRecommendations=matchBankTransactions({bankTransactions,bills});
  bankRecommendations.filter(match=>match.status==='SUSPICIOUS').forEach(match=>push({skill:'BANK_RECONCILIATION',rule:'ENTITY_MISMATCH',risk:'HIGH',objectType:'BANK_TXN',objectRef:match.bank_txn_id,reason:match.reason,action:'Hold matching and resolve intercompany or wrong-entity risk',confidence:match.confidence,sourceRefs:match.source_refs}));
  bankRecommendations.filter(match=>match.status==='PARTIALLY_MATCHED'&&Math.abs(Number(match.amount_difference||0))>0.01).forEach(match=>push({skill:'BANK_RECONCILIATION',rule:'AMOUNT_TOLERANCE',risk:'MEDIUM',objectType:'BANK_TXN',objectRef:match.bank_txn_id,reason:match.reason,action:'Compare bank fee, discount or partial-payment support before confirming any match',confidence:match.confidence,sourceRefs:match.source_refs}));
  bankTransactions.forEach(t=>{
    // Duplicate payment risk is meaningful only within the same accounting
    // entity and cash account.  Similar activity in another entity is a
    // separate transaction, not a duplicate payment.
    const duplicateMemo=String(t.reference||t.memo||'').trim().toLowerCase().replace(/\s+/g,' ');
    const key=`${t.entity_id??'UNSCOPED'}|${t.bank_account_code||t.account_code||'UNSCOPED'}|${t.amount}|${t.txn_date||t.date}|${duplicateMemo}`;
    const recommendation=bankRecommendations.find(match=>String(match.bank_txn_id)===String(t.bank_txn_id||t.external_id||t.id));
    if(t.match_status==='UNMATCHED') push({skill:'BANK_RECONCILIATION',rule:'UNMATCHED_BANK',risk:'MEDIUM',objectType:'BANK_TXN',objectRef:t.bank_txn_id||t.external_id,reason:'Bank transaction has no confirmed accounting match',action:'Route to matching or exception queue',confidence:0.99,sourceRefs:[t.bank_txn_id||t.external_id],dimensions:{entity_id:t.entity_id,bank_account_code:t.bank_account_code}});
    if(t.direction==='DEBIT' && recommendation?.status==='UNMATCHED' && /ach|check|payment|vendor|invoice|wire/i.test(textOf(t))) push({skill:'AP_ACCOUNTING',rule:'PAYMENT_WITHOUT_BILL',risk:'HIGH',objectType:'BANK_TXN',objectRef:t.bank_txn_id||t.external_id,reason:'Outgoing payment has no payable amount match',action:'Hold settlement and obtain invoice, vendor, entity and project support',confidence:0.96,sourceRefs:recommendation.source_refs,dimensions:{entity_id:t.entity_id,bank_account_code:t.bank_account_code}});
    if(bankByMatch.has(key)) push({skill:'BANK_RECONCILIATION',rule:'DUPLICATE_PAYMENT',risk:'HIGH',objectType:'BANK_TXN',objectRef:t.bank_txn_id||t.external_id,reason:`Same date, amount and memo as ${bankByMatch.get(key)}`,action:'Hold and review duplicate payment risk',confidence:0.93,sourceRefs:[bankByMatch.get(key),t.bank_txn_id||t.external_id]});
    bankByMatch.set(key,t.bank_txn_id||t.external_id);
  });

  posted.forEach(j=>{
    const debit=j.lines.reduce((s,l)=>s+(l.debit_amount||0),0), credit=j.lines.reduce((s,l)=>s+(l.credit_amount||0),0);
    if(Math.abs(debit-credit)>0.005) push({skill:'FINANCIAL_REPORTING',rule:'TB_OUT_OF_BALANCE',risk:'HIGH',objectType:'JE',objectRef:j.je_number,reason:`Posted JE is out of balance: debit ${debit}, credit ${credit}`,action:'Block downstream reporting and return for correction',confidence:0.999,sourceRefs:[j.source_doc_id||j.je_number],dimensions:{entity_id:j.entity_id,period_code:j.period_code},proposedJE:null});
    if(period?.status==='CLOSED' && j.period_code===period.period_code) push({skill:'REAL_ESTATE_CONTROLLER',rule:'PERIOD_LOCK',risk:'HIGH',objectType:'JE',objectRef:j.je_number,reason:`Entry belongs to closed period ${j.period_code}`,action:'Create proposed adjustment for controller review; do not post',confidence:0.99,sourceRefs:[j.je_number],dimensions:{entity_id:j.entity_id,period_code:j.period_code}});
    if(j.source_system==='WBS_CL' && isLoan(j) && j.lines.some(l=>String(l.account_code).startsWith('164')&&l.debit_amount>0)) push({skill:'CONSTRUCTION_LOAN',rule:'LOAN_DRAW_CLASSIFICATION',risk:'HIGH',objectType:'JE',objectRef:j.je_number,reason:'Loan-like draw appears posted to CWIP instead of cash/loan payable pattern',action:'Review loan rule and reclassify only after controller approval',confidence:0.94,sourceRefs:[j.source_doc_id||j.je_number],dimensions:{entity_id:j.entity_id,project_id:j.project_id}});
    if(!j.source_doc_id || (sourceDocs.length>0 && !sourceById.has(j.source_doc_id))) push({skill:'FINANCIAL_REPORTING',rule:'SOURCE_TRACE_MISSING',risk:'MEDIUM',objectType:'JE',objectRef:j.je_number,reason:'Posted JE has no verifiable source-document lineage',action:'Attach or reconcile the source document before report sign-off',confidence:0.97,sourceRefs:[j.je_number],dimensions:{entity_id:j.entity_id,period_code:j.period_code}});
    if(j.je_type==='MANUAL' && j.has_attachment===false) { const materiality=Number(j.materiality||10000); const highRisk=debit>=materiality; push({skill:'AUDIT_REVIEW',rule:'MISSING_ATTACHMENT',risk:highRisk?'HIGH':'LOW',objectType:'JE',objectRef:j.je_number,reason:`Manual journal entry has no supporting attachment${highRisk?` and exceeds materiality ${materiality}`:''}`,action:highRisk?'Require Controller review and attach source support before approval or posting':'Attach source support before posting or document exception',confidence:0.98,sourceRefs:[j.je_number],dimensions:{entity_id:j.entity_id,period_code:j.period_code}}); }
    if(j.je_type==='MANUAL' && debit>=10000 && j.lines.every(l=>Number(l.debit_amount||l.credit_amount||0)%1===0)) push({skill:'AUDIT_REVIEW',rule:'ROUND_DOLLAR_RISK',risk:'MEDIUM',objectType:'JE',objectRef:j.je_number,reason:'Large manual JE is composed entirely of round-dollar amounts',action:'Require controller explanation and source comparison',confidence:0.76,sourceRefs:[j.source_doc_id||j.je_number],dimensions:{entity_id:j.entity_id,period_code:j.period_code}});
    const day=j.je_date?new Date(`${j.je_date}T12:00:00`).getDay():null;
    if(j.je_type==='MANUAL' && (day===0 || day===6)) push({skill:'AUDIT_REVIEW',rule:'WEEKEND_PAYMENT_RISK',risk:'LOW',objectType:'JE',objectRef:j.je_number,reason:'Manual JE is dated on a weekend',action:'Confirm timing, authorization and source support',confidence:0.7,sourceRefs:[j.source_doc_id||j.je_number],dimensions:{entity_id:j.entity_id,period_code:j.period_code}});
  });
  return findings.sort((a,b)=>(({HIGH:0,MEDIUM:1,LOW:2}[a.risk]||0)-({HIGH:0,MEDIUM:1,LOW:2}[b.risk]||0)) || b.confidence-a.confidence);
}
