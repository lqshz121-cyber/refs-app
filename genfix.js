import { loanRule, pmRule } from './src/engine.js';
import { aiJudge } from './src/ai.js';
import { ENTITIES } from './src/data.js';
const en5 = ENTITIES.find(e=>e.entity_id===5);
const fx = {
  frozen_at: '2026-08-01', source: 'src/engine.js + src/ai.js (live engine output, not hand-written)',
  loan_draw: loanRule({txn_type:'DRAW', amount:250000, loan_id:1, construction_status:'UNDER_CONSTRUCTION'}),
  interest_under_construction: loanRule({txn_type:'INTEREST_ACCRUAL', amount:12000, loan_id:1, construction_status:'UNDER_CONSTRUCTION'}),
  interest_completed: loanRule({txn_type:'INTEREST_ACCRUAL', amount:12000, loan_id:1, construction_status:'COMPLETED'}),
  repayment: loanRule({txn_type:'REPAYMENT', amount:100000, loan_id:1, construction_status:'COMPLETED'}),
  pm_rent_accrual: pmRule({charge_code:'RENT', amount:48000, cash_accrual:'ACCRUAL', property_code:'P0020'}),
  pm_security_deposit: pmRule({charge_code:'SEC_DEPOSIT', amount:1500, cash_accrual:'CASH', property_code:'P0020'}),
  pm_unmapped: pmRule({charge_code:'PET_FEE', amount:120, cash_accrual:'CASH', property_code:'P0020'}),
  ai_hardcost_uc: aiJudge({category:'FAST Cost', type:'Cost', cost_code:'2HD220', status:'UNDER_CONSTRUCTION', amount:18400, payee:'Summit', description:'Framing'}, en5),
  ai_hardcost_done: aiJudge({category:'FAST Cost', type:'Cost', cost_code:'2HD850', status:'COMPLETED', amount:6200, payee:'Summit', description:'Punch-out'}, en5),
  ai_draw: aiJudge({category:'Construction Loan', type:'Contruction Loan', detail:'Draw', amount:250000, description:'Draw #8'}, en5),
  ai_unknown_to_suspense: aiJudge({category:'Bank Transaction', type:'Bank', detail:'???', direction:'CREDIT', amount:1250, description:'ACH UNKNOWN'}, en5),
};
console.log(JSON.stringify(fx, null, 1));
