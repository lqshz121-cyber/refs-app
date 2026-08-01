import { jeTotals, validateJE, sum } from './engine.js';

export const BANK_CATEGORY_OPTIONS=['651000','449200','421803','142000','641600','682000'];
const TERMINAL_JE_STATUSES=new Set(['REVERSED','VOID']);

export function bankSuggestion(txn){
  if(txn.suggest==='FEE') return {mode:'Categorize',account_code:'651000',label:'651000 Bank Fees',confidence:.92,rule_code:'SET-BANK-FEE'};
  if(txn.suggest==='INTEREST') return {mode:'Categorize',account_code:'449200',label:'449200 Interest Income',confidence:.96,rule_code:'SET-BANK-INTEREST'};
  if(txn.reference?.includes('RENT')||txn.suggest==='MATCH') return {mode:'Match',account_code:'',label:'Search posted transactions',confidence:.88,rule_code:'MATCH-EXISTING-JE'};
  return {mode:'Categorize',account_code:'',label:'Mapping required',confidence:.40,rule_code:null};
}

export function splitDifference(amount,rows){
  return +(Number(amount||0)-sum(rows||[],r=>Number(r.amount||0))).toFixed(2);
}

export function buildBankDraft(txn,bankAccountCode,rows){
  const categories=(rows||[]).filter(r=>Number(r.amount)>0);
  if(!categories.length||categories.some(r=>!r.account_code)) return {unmapped:true};
  const difference=splitDifference(txn.amount,categories);
  if(Math.abs(difference)>=.005) return {difference};
  const cash={account_code:'111000',debit_amount:0,credit_amount:0,member:`Operating Cash_${bankAccountCode}`,description:txn.reference};
  const categoryLines=categories.map(r=>({
    account_code:r.account_code,
    debit_amount:txn.direction==='DEBIT'?Number(r.amount):0,
    credit_amount:txn.direction==='CREDIT'?Number(r.amount):0,
    description:r.memo||txn.reference,
  }));
  if(txn.direction==='CREDIT') cash.debit_amount=Number(txn.amount); else cash.credit_amount=Number(txn.amount);
  const suggested=bankSuggestion(txn);
  const mappedBySuggestion=categories.length===1&&categories[0].account_code===suggested.account_code;
  return {
    entity_id:txn.entity_id,je_type:'AUTO',source_system:'BANK',source_doc_id:txn.external_id,
    rule_code:categories.length>1?'SET-BANK-SPLIT':(mappedBySuggestion?suggested.rule_code:'SET-BANK-MANUAL'),
    description:`Bank feed · ${txn.reference}`,payee:txn.reference,has_attachment:true,
    lines:txn.direction==='CREDIT'?[cash,...categoryLines]:[...categoryLines,cash],
  };
}

export function validateBankDraft({txn,spec,jes=[]}){
  if(!txn) return {ok:false,code:'BANK_SOURCE_NOT_FOUND',message:'Bank source no longer exists.'};
  if(!spec||spec.unmapped) return {ok:false,code:'BANK_MAPPING_MISSING',message:'Select an approved account mapping.'};
  if(spec.difference!=null&&Math.abs(spec.difference)>=.005) return {ok:false,code:'BANK_SPLIT_OUT_OF_BALANCE',difference:spec.difference,message:'Split difference must be $0.00.'};
  if(txn.match_status==='MATCHED'||txn.draft_je_id) return {ok:false,code:'BANK_SOURCE_ALREADY_PROCESSED',message:'This bank source is already processed.'};
  if(spec.source_system!=='BANK'||spec.source_doc_id!==txn.external_id||!spec.rule_code) return {ok:false,code:'BANK_TRACE_MISSING',message:'Bank Draft requires exact source and rule trace.'};
  if(jes.some(j=>j.source_system==='BANK'&&j.source_doc_id===txn.external_id&&!TERMINAL_JE_STATUSES.has(j.posting_status))) return {ok:false,code:'BANK_DUPLICATE_SOURCE',message:'An active JE already exists for this bank source.'};
  const cash=spec.lines?.find(l=>l.account_code==='111000');
  if(!cash?.member) return {ok:false,code:'BANK_CASH_MEMBER_MISSING',message:'Cash line requires a bank subsidiary member.'};
  const probe={...spec,posting_status:'DRAFT'};
  const accountingErrors=validateJE(probe).filter(e=>['4006','4020','VAL-001','VAL-002','VAL-003','VAL-004'].includes(e.code));
  if(accountingErrors.length){const totals=jeTotals(probe);return {ok:false,code:'BANK_DRAFT_INVALID',message:accountingErrors.map(e=>e.code).join(', '),totals};}
  return {ok:true};
}

export function findBankMatchCandidates({txn,jes=[],bank,acctCode,entityId}){
  const member=`Operating Cash_${acctCode}`;
  const occupied=new Set((bank.matches||[]).map(m=>m.je_id));
  return jes.filter(je=>{
    if(je.posting_status!=='POSTED'||je.entity_id!==entityId||occupied.has(je.je_id)) return false;
    if((je.currency||'USD')!==(txn.currency||'USD')) return false;
    const cash=je.lines?.find(l=>l.account_code==='111000'&&l.member===member);
    if(!cash) return false;
    const amount=txn.direction==='CREDIT'?(cash.debit_amount||0):(cash.credit_amount||0);
    return Math.abs(amount-Number(txn.amount))<.005;
  }).map(je=>{
    const cashLine=je.lines.findIndex(l=>l.account_code==='111000'&&l.member===member);
    return {je_id:je.je_id,je_number:je.je_number,description:je.description,je_date:je.je_date,entity_id:je.entity_id,currency:je.currency||'USD',cash_line_index:cashLine,amount:Number(txn.amount)};
  });
}

export function validateBankMatch({txn,candidate,bank,acctCode,entityId,jes=[]}){
  if(!txn) return {ok:false,code:'BANK_SOURCE_NOT_FOUND',message:'Bank source no longer exists.'};
  if(txn.match_status==='MATCHED'||txn.draft_je_id) return {ok:false,code:'BANK_SOURCE_ALREADY_PROCESSED',message:'This bank source is already processed.'};
  if(!candidate) return {ok:false,code:'BANK_MATCH_NOT_FOUND',message:'Select a real posted candidate.'};
  const je=jes.find(j=>j.je_id===candidate.je_id);
  if(!je) return {ok:false,code:'BANK_MATCH_NOT_FOUND',message:'Candidate JE no longer exists.'};
  if(je.posting_status!=='POSTED') return {ok:false,code:'BANK_MATCH_NOT_POSTED',message:'Only Posted transactions can be matched.'};
  if(je.entity_id!==entityId) return {ok:false,code:'BANK_MATCH_ENTITY',message:'Candidate belongs to another entity.'};
  if((je.currency||'USD')!==(txn.currency||'USD')) return {ok:false,code:'BANK_MATCH_CURRENCY',message:'Currency does not match.'};
  if((bank.matches||[]).some(m=>m.je_id===je.je_id||m.source_doc_id===txn.external_id)) return {ok:false,code:'BANK_MATCH_OCCUPIED',message:'Source or candidate is already matched.'};
  const member=`Operating Cash_${acctCode}`;
  const cash=je.lines?.find((l,i)=>i===candidate.cash_line_index&&l.account_code==='111000'&&l.member===member);
  if(!cash) return {ok:false,code:'BANK_MATCH_ACCOUNT',message:'Candidate cash line does not belong to this bank account.'};
  const amount=txn.direction==='CREDIT'?(cash.debit_amount||0):(cash.credit_amount||0);
  if(Math.abs(amount-Number(txn.amount))>=.005) return {ok:false,code:'BANK_MATCH_AMOUNT',message:'Candidate amount does not match.'};
  return {ok:true,je,cash};
}

export function createBankDraftTransition({bank,jes,acctCode,txnId,spec,je}){
  const txn=bank.accounts[acctCode].txns.find(t=>t.bank_txn_id===txnId);
  const validation=validateBankDraft({txn,spec,jes});
  if(!validation.ok) return validation;
  const nextBank=structuredClone(bank);
  const nextTxn=nextBank.accounts[acctCode].txns.find(t=>t.bank_txn_id===txnId);
  nextTxn.ui_status='Categorized';nextTxn.match_status='UNMATCHED';nextTxn.processing_type='DRAFT_JE';
  nextTxn.draft_je_id=je.je_id;nextTxn.draft_je_number=je.je_number;
  nextBank.draft_links=[...(nextBank.draft_links||[]),{source_doc_id:txn.external_id,je_id:je.je_id,bank_account_code:acctCode}];
  return {ok:true,bank:nextBank,jes:[je,...jes]};
}

export function excludeBankTransition({bank,jes,acctCode,txnId}){
  const txn=bank.accounts[acctCode].txns.find(t=>t.bank_txn_id===txnId);
  if(!txn) return {ok:false,code:'BANK_SOURCE_NOT_FOUND',message:'Bank source no longer exists.'};
  if(txn.match_status==='MATCHED'||txn.draft_je_id) return {ok:false,code:'BANK_SOURCE_ALREADY_PROCESSED',message:'Undo the current workflow before excluding this source.'};
  const nextBank=structuredClone(bank);
  nextBank.accounts[acctCode].txns.find(t=>t.bank_txn_id===txnId).ui_status='Excluded';
  return {ok:true,kind:'EXCLUDE',bank:nextBank,jes};
}

export function matchBankTransition({bank,jes,acctCode,txnId,candidate,entityId,userId}){
  const txn=bank.accounts[acctCode].txns.find(t=>t.bank_txn_id===txnId);
  const validation=validateBankMatch({txn,candidate,bank,acctCode,entityId,jes});
  if(!validation.ok) return validation;
  const nextBank=structuredClone(bank);
  const nextTxn=nextBank.accounts[acctCode].txns.find(t=>t.bank_txn_id===txnId);
  nextTxn.ui_status='Categorized';nextTxn.match_status='MATCHED';nextTxn.processing_type='MATCH';
  nextTxn.matched_je_id=candidate.je_id;nextTxn.matched_je=validation.je.je_number;nextTxn.matched_cash_line=candidate.cash_line_index;
  nextBank.matches=[...(nextBank.matches||[]),{source_doc_id:txn.external_id,je_id:candidate.je_id,cash_line_index:candidate.cash_line_index,bank_account_code:acctCode,by:userId,at:'2026-07-31'}];
  return {ok:true,bank:nextBank,jes};
}

export function undoBankTransition({bank,jes,acctCode,txnId}){
  const txn=bank.accounts[acctCode].txns.find(t=>t.bank_txn_id===txnId);
  if(!txn) return {ok:false,code:'BANK_SOURCE_NOT_FOUND'};
  const nextBank=structuredClone(bank);
  const nextTxn=nextBank.accounts[acctCode].txns.find(t=>t.bank_txn_id===txnId);
  if(txn.ui_status==='Excluded'){
    nextTxn.ui_status=null;
    return {ok:true,kind:'RESTORE',bank:nextBank,jes};
  }
  if(txn.processing_type==='MATCH'){
    const link=(bank.matches||[]).find(m=>m.source_doc_id===txn.external_id&&m.je_id===txn.matched_je_id);
    if(!link) return {ok:false,code:'BANK_MATCH_LINK_MISSING',message:'Match linkage is incomplete; manual review required.'};
    nextBank.matches=(nextBank.matches||[]).filter(m=>m!==link&&!(m.source_doc_id===link.source_doc_id&&m.je_id===link.je_id));
    Object.assign(nextTxn,{ui_status:null,match_status:'UNMATCHED',processing_type:null,matched_je_id:null,matched_je:null,matched_cash_line:null});
    return {ok:true,kind:'UNMATCH',bank:nextBank,jes};
  }
  if(txn.processing_type==='DRAFT_JE'||txn.draft_je_id){
    const linked=jes.find(j=>j.je_id===txn.draft_je_id);
    if(!linked) return {ok:false,code:'BANK_DRAFT_LINK_MISSING',message:'Linked JE is missing; source remains locked.'};
    if(linked.posting_status!=='DRAFT') return {ok:false,code:'BANK_UNDO_NON_DRAFT',message:`Linked JE is ${linked.posting_status}; withdraw approval or reverse/reclass it.`};
    Object.assign(nextTxn,{ui_status:null,match_status:'UNMATCHED',processing_type:null,draft_je_id:null,draft_je_number:null});
    nextBank.draft_links=(nextBank.draft_links||[]).filter(l=>!(l.source_doc_id===txn.external_id&&l.je_id===linked.je_id));
    return {ok:true,kind:'DELETE_DRAFT',bank:nextBank,jes:jes.filter(j=>j.je_id!==linked.je_id)};
  }
  return {ok:false,code:'BANK_UNDO_NOT_ALLOWED',message:'This transaction has no reversible bank workflow state.'};
}
