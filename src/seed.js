import { ENTITIES } from './data.js';
import { yearEndCloseLines } from './engine.js';
// Transactional seed: journal entries, staging rows, exceptions, close tasks.
let _id = 5000;
export const nextId = () => ++_id;
export const bumpId = (n)=>{ if(n>_id) _id=n; };

const L = (account_code, dr, cr, dim={}) => ({account_code, debit_amount:dr||0, credit_amount:cr||0, ...dim});

export const JOURNAL_ENTRIES = [
  { je_id: 1101, je_number:'20260701000002', entity_id:1, period_code:'2026-07', je_date:'2026-07-01',
    je_type:'AUTO', source_system:'AP', payee:'Wan Bridge Land LLC', description:'07/2026: Finance, Design & Dev outsourcing (WBS PAYABLE)', posting_status:'POSTED', created_by:'system', reviewer:'CathyGao', approver:'ricky',
    history:[{a:'WBS IMPORT · PAYABLE',by:'system',at:'2026-07-01'},{a:'REVIEW',by:'CathyGao',at:'2026-07-02'},{a:'POST',by:'ricky',at:'2026-07-02'}],
    lines:[{account_code:'705002',debit_amount:12800,credit_amount:0},{account_code:'291001',debit_amount:0,credit_amount:12800}] },
  { je_id: 1102, je_number:'20260701000010', entity_id:1, period_code:'2026-07', je_date:'2026-07-01',
    je_type:'AUTO', source_system:'AP', payee:'Wan Bridge Land LLC', description:'07/26 Research and Development service fee (WBS PAYABLE)', posting_status:'POSTED', created_by:'system', reviewer:'JudyZhang', approver:'ricky',
    history:[{a:'WBS IMPORT · PAYABLE',by:'system',at:'2026-07-01'},{a:'POST',by:'ricky',at:'2026-07-02'}],
    lines:[{account_code:'705001',debit_amount:9600,credit_amount:0},{account_code:'291001',debit_amount:0,credit_amount:9600}] },
  // Mirror side of 1101/1102. Wan Bridge Land LLC is a group entity, so its
  // Due from must exist for the same amount in the same period or the pair
  // cannot be eliminated on consolidation.
  { je_id: 1103, je_number:'20260701000102', entity_id:2, period_code:'2026-07', je_date:'2026-07-01',
    je_type:'AUTO', source_system:'AP', payee:'Wan Bridge Group LLC', description:'07/2026: Finance, Design & Dev outsourcing recharged to Wan Bridge Group LLC', posting_status:'POSTED', created_by:'system', rule_code:'R-IC-SVC-01',
    history:[{a:'WBS IMPORT · PAYABLE',by:'system',at:'2026-07-01'},{a:'POST',by:'ricky',at:'2026-07-02'}],
    lines:[{account_code:'125000',debit_amount:12800,credit_amount:0,member:'Wan Bridge Group LLC',description:'Due from_Wan Bridge Group LLC'},{account_code:'490600',debit_amount:0,credit_amount:12800}] },
  { je_id: 1104, je_number:'20260701000110', entity_id:2, period_code:'2026-07', je_date:'2026-07-01',
    je_type:'AUTO', source_system:'AP', payee:'Wan Bridge Group LLC', description:'07/26 Research and Development service fee recharged to Wan Bridge Group LLC', posting_status:'POSTED', created_by:'system', rule_code:'R-IC-SVC-01',
    history:[{a:'WBS IMPORT · PAYABLE',by:'system',at:'2026-07-01'},{a:'POST',by:'ricky',at:'2026-07-02'}],
    lines:[{account_code:'125000',debit_amount:9600,credit_amount:0,member:'Wan Bridge Group LLC',description:'Due from_Wan Bridge Group LLC'},{account_code:'490600',debit_amount:0,credit_amount:9600}] },
  { je_id: 1000, je_number:'20260701000001', entity_id:2, period_code:'2026-07', je_date:'2026-07-01',
    je_type:'AUTO', source_system:'BANK', description:'Capital contribution - Fund II equity funding', posting_status:'POSTED', created_by:'system',
    history:[{a:'AUTO POST',by:'system',at:'2026-07-01'}],
    lines:[{account_code:'111000',debit_amount:800000,credit_amount:0},{account_code:'380104',debit_amount:0,credit_amount:800000}] },
  {je_id:1001, je_number:'JE-2026-07-1001', entity_id:2, period_code:'2026-07', je_type:'AUTO', je_date:'2026-07-05',
   description:'Construction Loan Draw #7 - Cedar Ridge', source_system:'WBS_CL', posting_status:'POSTED',
   rule_code:'R-LOAN-01', lines:[L('164200',500000,0,{project_id:1,loan_id:1}), L('270100',0,500000,{loan_id:1})]},
  {je_id:1002, je_number:'JE-2026-07-1002', entity_id:2, period_code:'2026-07', je_type:'AUTO', je_date:'2026-07-31',
   description:'Capitalized interest accrual (Under Construction)', source_system:'WBS_CL', posting_status:'POSTED',
   rule_code:'R-LOAN-03', lines:[L('164500',29200,0,{loan_id:1,project_id:1}), L('220410',0,29200,{loan_id:1})]},
  {je_id:1003, je_number:'JE-2026-07-1003', entity_id:4, period_code:'2026-07', je_type:'AUTO', je_date:'2026-07-01',
   description:'Rent income accrual - Maple Court', source_system:'PM', posting_status:'POSTED',
   rule_code:'R-PM-11', lines:[L('120200',48000,0,{property_id:2}), L('421803',0,48000,{property_id:2})]},
  {je_id:1004, je_number:'JE-2026-07-1004', entity_id:4, period_code:'2026-07', je_type:'AUTO', je_date:'2026-07-06',
   description:'Rent receipt - Maple Court', source_system:'PM', posting_status:'POSTED',
   rule_code:'R-PM-12', lines:[L('111000',46000,0,{property_id:2}), L('120200',0,46000,{property_id:2})]},
  {je_id:1005, je_number:'JE-2026-07-1005', entity_id:4, period_code:'2026-07', je_type:'AUTO', je_date:'2026-07-10',
   description:'Utilities expense - Maple Court', source_system:'PM', posting_status:'POSTED',
   rule_code:'R-PM-18', lines:[L('641600',3200,0,{property_id:2}), L('220200',0,3200,{property_id:2,vendor_id:2})]},
  {je_id:1006, je_number:'JE-2026-07-1006', entity_id:4, period_code:'2026-07', je_type:'AUTO', je_date:'2026-07-31',
   description:'Property management fee (related party)', source_system:'PM', posting_status:'POSTED',
   rule_code:'R-PM-19', lines:[L('682000',2400,0,{property_id:2}), L('220300',0,2400,{vendor_id:3})]},
  {je_id:1007, je_number:'JE-2026-07-1007', entity_id:2, period_code:'2026-07', je_type:'CLOSING', je_date:'2026-07-15',
   description:'Property acquisition - Cedar Ridge parcel', source_system:'CLS', posting_status:'POSTED',
   rule_code:'R-CLS-21', lines:[L('161000',900000,0,{property_id:1}), L('163000',2100000,0,{property_id:1}),
     L('270100',0,2400000,{loan_id:1}), L('111000',0,600000)]},
  // Drafts / pending (work items)
  {je_id:2001, je_number:'JE-2026-07-2001', entity_id:4, period_code:'2026-07', je_type:'AUTO', je_date:'2026-07-31',
   description:'PM Pickup batch PM-202607-P0020 (late fee)', source_system:'PM', posting_status:'PENDING_REVIEW',
   rule_code:'R-PM-15', lines:[L('111000',350,0,{property_id:2}), L('482300',0,350,{property_id:2})]},
  {je_id:2002, je_number:'JE-2026-07-2002', entity_id:2, period_code:'2026-07', je_type:'RECLASS', je_date:'2026-07-28',
   description:'Reclass misposted R&M to CIP', source_system:'MAN', posting_status:'PENDING_APPROVAL',
   has_attachment:true, lines:[L('164200',5000,0,{project_id:1}), L('612900',0,5000)]},
  {je_id:2003, je_number:'JE-2026-07-2003', entity_id:2, period_code:'2026-07', je_type:'MANUAL', je_date:'2026-07-29',
   description:'Manual accrual - no support attached', source_system:'MAN', posting_status:'DRAFT',
   has_attachment:false, lines:[L('612900',1800,0,{property_id:1}), L('220300',0,1800)]},
];

export const EXCEPTIONS = [
  {exception_id:1, exception_type:'GL_MAPPING_MISSING', severity:'HIGH', object_type:'PM_PICKUP', object_ref:'PET_FEE / P0020',
   entity_id:4, occurred_date:'2026-07-31', aging_days:0, owner:'PROPERTY_ACCT', status:'OPEN',
   root_cause:'Charge code PET_FEE has no current mapping to Owner GL', resolution:''},
  {exception_id:2, exception_type:'BANK_UNMATCHED', severity:'MEDIUM', object_type:'BANK_TXN', object_ref:'BANKTXN-Z-4471',
   entity_id:4, occurred_date:'2026-07-30', aging_days:1, owner:'TREASURY', status:'IN_PROGRESS',
   root_cause:'ACH credit not matched to any receipt', resolution:''},
  {exception_id:3, exception_type:'LOAN_BALANCE_MISMATCH', severity:'HIGH', object_type:'LOAN', object_ref:'L-2025-014',
   entity_id:2, occurred_date:'2026-07-31', aging_days:0, owner:'PROJECT_ACCT', status:'OPEN',
   root_cause:'GL loan payable differs from lender statement by 12,500', resolution:''},
  {exception_id:4, exception_type:'IC_OUT_OF_BALANCE', severity:'HIGH', object_type:'IC', object_ref:'ICP-0007',
   entity_id:2, occurred_date:'2026-07-29', aging_days:2, owner:'CONTROLLER', status:'OPEN',
   root_cause:'Due from (E1001) 100,000 vs Due to (E1003) 90,000', resolution:''},
  {exception_id:5, exception_type:'SUSPENSE_BALANCE', severity:'MEDIUM', object_type:'GL', object_ref:'Acct 9000',
   entity_id:2, occurred_date:'2026-07-25', aging_days:6, owner:'SENIOR_ACCT', status:'OPEN',
   root_cause:'Suspense balance 3,400 pending identification', resolution:''},
  {exception_id:6, exception_type:'MANUAL_JE_NO_ATTACHMENT', severity:'LOW', object_type:'JE', object_ref:'JE-2026-07-2003',
   entity_id:2, occurred_date:'2026-07-29', aging_days:2, owner:'STAFF_ACCT', status:'OPEN',
   root_cause:'Manual JE submitted without supporting document', resolution:''},
  {exception_id:7, exception_type:'DUPLICATE_PICKUP', severity:'MEDIUM', object_type:'PM_PICKUP', object_ref:'YARDI-CHG-5501',
   entity_id:4, occurred_date:'2026-07-20', aging_days:11, owner:'PROPERTY_ACCT', status:'CLOSED',
   root_cause:'Duplicate external_id in re-submitted batch', resolution:'Idempotency key blocked; batch corrected'},
];

export const CLOSE_TASKS = [
  {close_task_id:1, task_code:'BANK_RECON', task_name:'Bank Reconciliation complete', is_auto:false, owner:'TREASURY', due_date:'2026-08-05', depends_on:[], status:'DONE', signed_off_by:'ricky'},
  {close_task_id:2, task_code:'LOAN_RECON', task_name:'Construction Loan reconciliation', is_auto:false, owner:'PROJECT_ACCT', due_date:'2026-08-05', depends_on:[], status:'IN_PROGRESS'},
  {close_task_id:3, task_code:'PM_PICKUP', task_name:'PM Operations Pickup complete', is_auto:false, owner:'PROPERTY_ACCT', due_date:'2026-08-04', depends_on:[], status:'IN_PROGRESS'},
  {close_task_id:4, task_code:'AP_CUTOFF', task_name:'AP cutoff', is_auto:false, owner:'AP', due_date:'2026-08-04', depends_on:[], status:'PENDING'},
  {close_task_id:5, task_code:'AR_CUTOFF', task_name:'AR cutoff', is_auto:false, owner:'AR', due_date:'2026-08-04', depends_on:[], status:'PENDING'},
  {close_task_id:6, task_code:'ACCRUAL', task_name:'Accruals (interest/tax/insurance)', is_auto:true, owner:'SENIOR_ACCT', due_date:'2026-08-06', depends_on:[4,5], status:'PENDING'},
  {close_task_id:7, task_code:'DEPRECIATION', task_name:'Depreciation run', is_auto:true, owner:'PROPERTY_ACCT', due_date:'2026-08-06', depends_on:[], status:'PENDING'},
  {close_task_id:8, task_code:'IC_MATCH', task_name:'Intercompany matching', is_auto:false, owner:'CONTROLLER', due_date:'2026-08-06', depends_on:[], status:'PENDING'},
  {close_task_id:9, task_code:'SUSPENSE_CLEAR', task_name:'Suspense cleared to zero', is_auto:false, owner:'SENIOR_ACCT', due_date:'2026-08-06', depends_on:[], status:'PENDING'},
  {close_task_id:10, task_code:'TB_REVIEW', task_name:'Trial Balance & BS reconciliation review', is_auto:false, owner:'CONTROLLER', due_date:'2026-08-07', depends_on:[1,2,3,6,7,8,9], status:'PENDING'},
];

// Staging rows for Integration Hub / module demos
export const LOAN_TXNS = [
  {loan_txn_id:1, loan_id:1, wbs_txn_id:'WBS-CLTXN-88231', txn_type:'DRAW', transaction_date:'2026-07-05', amount:500000, funded_flag:true, construction_status:'UNDER_CONSTRUCTION', generated_je:'JE-2026-07-1001', recon_status:'MATCHED'},
  {loan_txn_id:2, loan_id:1, wbs_txn_id:'WBS-CLTXN-88240', txn_type:'INTEREST_ACCRUAL', transaction_date:'2026-07-31', amount:29200, construction_status:'UNDER_CONSTRUCTION', generated_je:'JE-2026-07-1002', recon_status:'PENDING'},
  {loan_txn_id:3, loan_id:1, wbs_txn_id:'WBS-CLTXN-88255', txn_type:'DRAW', transaction_date:'2026-07-28', amount:275000, funded_flag:true, construction_status:'UNDER_CONSTRUCTION', generated_je:null, recon_status:'PENDING'},
  {loan_txn_id:4, loan_id:2, wbs_txn_id:'WBS-CLTXN-77010', txn_type:'INTEREST_PAYMENT', transaction_date:'2026-07-01', amount:29315, construction_status:'IN_SERVICE', generated_je:null, recon_status:'PENDING'},
];

export const PM_ROWS = [
  {external_id:'YARDI-5581', property_code:'P0020', unit:'A-203', charge_code:'RENT', posting_month:'2026-07', amount:48000, cash_accrual:'ACCRUAL'},
  {external_id:'YARDI-5582', property_code:'P0020', unit:'A-203', charge_code:'LATE_FEE', posting_month:'2026-07', amount:350, cash_accrual:'CASH'},
  {external_id:'YARDI-5583', property_code:'P0020', unit:'B-110', charge_code:'SEC_DEPOSIT', posting_month:'2026-07', amount:1500, cash_accrual:'CASH'},
  {external_id:'YARDI-5584', property_code:'P0020', unit:'B-110', charge_code:'UTILITIES', posting_month:'2026-07', amount:3200, cash_accrual:'ACCRUAL'},
  {external_id:'YARDI-5585', property_code:'P0020', unit:'C-050', charge_code:'PET_FEE', posting_month:'2026-07', amount:120, cash_accrual:'CASH'},
];

export const BANK_TXNS = [
  {bank_txn_id:1, bank_account_code:'BA-003', external_id:'BANKTXN-Z-4460', txn_date:'2026-07-06', amount:46000, direction:'CREDIT', reference:'ACH RENT P0020', match_status:'MATCHED', matched_je:'JE-2026-07-1004'},
  {bank_txn_id:2, bank_account_code:'BA-003', external_id:'BANKTXN-Z-4471', txn_date:'2026-07-30', amount:1250, direction:'CREDIT', reference:'ACH UNKNOWN', match_status:'UNMATCHED', matched_je:null},
  {bank_txn_id:3, bank_account_code:'BA-001', external_id:'BANKTXN-A-1002', txn_date:'2026-07-05', amount:500000, direction:'CREDIT', reference:'LOAN DRAW FNB', match_status:'MATCHED', matched_je:'JE-2026-07-1001'},
  {bank_txn_id:4, bank_account_code:'BA-001', external_id:'BANKTXN-A-1050', txn_date:'2026-07-31', amount:85, direction:'DEBIT', reference:'BANK SERVICE FEE', match_status:'UNMATCHED', matched_je:null},
];

export const CLOSINGS = [
  {closing_id:1, closing_code:'CLS-2026-014', closing_type:'ACQUISITION', entity_id:2, property_code:'P0012', closing_date:'2026-07-15',
   cash_to_close:600000, loan_payoff:0, balance_check_status:'BALANCED', generated_je:'JE-2026-07-1007',
   lines:[{label:'Land',account_code:'161000',debit:900000,credit:0},{label:'Building',account_code:'163000',debit:2100000,credit:0},
     {label:'Construction Loan',account_code:'270100',debit:0,credit:2400000},{label:'Cash to Close',account_code:'111000',debit:0,credit:600000}]},
];

export const IC_TXNS = [
  {ic_txn_id:1, ic_pair_id:'ICP-0007', ic_type:'FUNDING', initiator_entity:'E1001', counterparty_entity:'E1003', amount:100000, match_status:'UNMATCHED'},
  {ic_txn_id:2, ic_pair_id:'ICP-0006', ic_type:'FUNDING', initiator_entity:'E1000', counterparty_entity:'E1001', amount:250000, match_status:'MATCHED'},
];

// ===== FY2026 full-year ledger generator (real WBS entities, sanitized amounts) =====
const FY = [];
export const SOURCE_DOCS = {};
let _sd = 0;
const doc = (d)=>{ const id='SD-'+(++_sd); SOURCE_DOCS[id]={id, ...d}; return id; };
// One unit per build cycle. k=0 is the unit carried in as opening work in
// progress; k=1..3 are the FY2026 build cycles. (e*7+k)%7 === k%7, so the four
// keys are distinct for one entity and a unit is never built or sold twice.
const UNIT_OF = (e,k)=>`Lot ${100+((e*7+k)%7)+1} Block ${['A','B','C','D'][(e+k)%4]}`;
let _g = 5000;
// ---- Unit cost ledger -------------------------------------------------------
// Cost of sales is relieved from the accumulated cost of the unit that was
// actually sold. Nothing here is derived from the sale price, and no relief may
// exceed what the unit carries. Amounts are whole dollars so that no journal
// total is ever the result of binary floating-point addition.
const CYCLE_MONTHS = 3;
const cycleOf = (m)=>Math.ceil(m/CYCLE_MONTHS);
// Contract sale price of the unit built in cycle `cyc` by entity `e`.
const SALE_PRICE = (e,cyc)=>300000 + e*800 + cyc*12000 + ((e*37+cyc*11)%97)*220;
// Cost basis of that unit, 76.00%-86.99% of the contract price. A for-sale
// homebuilder's cost basis is that share of price; the ratio is deterministic
// per unit so the seed reproduces exactly.
const COST_RATIO_BP = (e,cyc)=>7600 + ((e*13+cyc*29)%1100);
const UNIT_TOTAL_COST = (e,cyc)=>Math.round(SALE_PRICE(e,cyc)*COST_RATIO_BP(e,cyc)/10000);
// Cost incurred in month i (0-based) of the cycle. Even thirds, remainder last,
// so the three monthly accruals add back to the total exactly.
const UNIT_MONTH_COST = (e,cyc,i)=>{ const tot=UNIT_TOTAL_COST(e,cyc), base=Math.floor(tot/3); return i===CYCLE_MONTHS-1 ? tot-base*(CYCLE_MONTHS-1) : base; };
const _unitCwip = {};   // (entity|unit) -> construction cost still in CWIP
const _unitInv  = {};   // (entity|unit) -> finished-inventory carrying value
const unitKey = (e,u)=>`${e}|${u}`;
const addUnitCwip = (e,u,amt)=>{ const k=unitKey(e,u); _unitCwip[k]=(_unitCwip[k]||0)+amt; };
// Move a completed unit out of CWIP and into finished inventory. Returns the
// amount transferred, which can never exceed what the unit accumulated.
const transferUnitToInventory = (e,u)=>{ const k=unitKey(e,u); const amt=_unitCwip[k]||0; _unitCwip[k]=0; _unitInv[k]=(_unitInv[k]||0)+amt; return amt; };
// Relieve cost of sales from finished inventory. Hard rail: a unit can never
// give up more cost than it carries.
const relieveUnitInventory = (e,u,requested)=>{ const k=unitKey(e,u); const carrying=_unitInv[k]||0;
  if (requested>carrying) throw new Error(`Seed integrity: COGS relief ${requested} exceeds inventory ${carrying} on unit ${k}.`);
  _unitInv[k]=carrying-requested; return requested; };
// ---- Intercompany --------------------------------------------------------
// Every intercompany balance is booked from one amount, in one period, as two
// mirrored lines: 125000 Due from Related Party on the creditor's books and
// 291000/291001 Due to/from on the debtor's books, each naming the other entity
// as its subsidiary member. A consolidation that nets 125000 + 291000 + 291001
// therefore reaches zero. Accounts 291000/291001 carry group counterparties
// only; a payable to a third party is trade payable 220300, not an affiliate
// balance.
const IC_DUE_FROM = '125000';
const IC_DUE_TO_FUNDING = '291000';
const IC_DUE_TO_SERVICE = '291001';
const FUNDER_ID = 3;    // Wan Bridge Development LLC funds the project companies
const SERVICE_HUB_ID = 2; // Wan Bridge Land LLC provides the outsourcing services
const _dueToFunder = {}; // entity -> outstanding advance owed to the funder
const TYPE = {}; ENTITIES.forEach(e=>TYPE[e.entity_id]=e.entity_type);
const NAMEOF = {}; ENTITIES.forEach(e=>NAMEOF[e.entity_id]=e.entity_name);
const SUBS={'111000':'Bank','220300':'Vendor','220200':'Vendor','291000':'Affiliate','291001':'Affiliate','125000':'Affiliate','120200':'Customer','123700':'Customer','270100':'Loan'};
const BANKOF=(e)=>`Operating Cash_${(NAMEOF[e]||'WB').split(' ').map(w=>w[0]).join('')}_WF_${9000+e}`;
const push=(e,mm,dd,src,payee,memo,lines)=>{
  lines.forEach(l=>{ if(!l.member && SUBS[l.account_code]){
    l.member = SUBS[l.account_code]==='Bank' ? BANKOF(e) : (payee || 'Wan Bridge Development LLC');
    if(!l.description) l.description = (l.account_code.startsWith('291')?'Due to/from_':'') + l.member; }}); _g++; FY.push({je_id:_g, je_number:`2026${mm}${dd}${String(_g).padStart(6,'0')}`, entity_id:e, period_code:`2026-${mm}`, je_date:`2026-${mm}-${dd}`, je_type:'AUTO', source_system:src, payee, description:memo, posting_status:'POSTED', created_by:'system', history:[{a:'WBS IMPORT · '+src,by:'system',at:`2026-${mm}-${dd}`}], lines}); };
// The funder advances cash to a group company and books Due from; the group
// company books the mirror Due to. One amount, one period, one counterparty
// pair, symmetric accounts.
const icAdvance=(mm,dd,e,amount,memo)=>{
  push(FUNDER_ID,mm,dd,'AUTOC',NAMEOF[e],`${mm}/2026 Advance to ${NAMEOF[e]} · ${memo}`,[
    {account_code:IC_DUE_FROM,debit_amount:amount,credit_amount:0,member:NAMEOF[e],description:'Due from_'+NAMEOF[e]},
    {account_code:'111000',debit_amount:0,credit_amount:amount,member:BANKOF(FUNDER_ID)}]);
  FY[FY.length-1].rule_code='R-IC-ADV-01';
};
// The group company repays; the funder collects. Mirrored the same way.
const icRepay=(mm,dd,e,amount,memo)=>{
  if(amount<=0) return 0;
  _dueToFunder[e]-=amount;
  push(e,mm,dd,'AUTOC',NAMEOF[FUNDER_ID],`${mm}/2026 Repay affiliate advance · ${memo}`,[
    {account_code:IC_DUE_TO_FUNDING,debit_amount:amount,credit_amount:0,member:NAMEOF[FUNDER_ID],description:'Due to/from_'+NAMEOF[FUNDER_ID]},
    {account_code:'111000',debit_amount:0,credit_amount:amount,member:BANKOF(e)}]);
  FY[FY.length-1].rule_code='R-IC-RPY-01';
  push(FUNDER_ID,mm,dd,'AUTOC',NAMEOF[e],`${mm}/2026 Advance repaid by ${NAMEOF[e]} · ${memo}`,[
    {account_code:'111000',debit_amount:amount,credit_amount:0,member:BANKOF(FUNDER_ID)},
    {account_code:IC_DUE_FROM,debit_amount:0,credit_amount:amount,member:NAMEOF[e],description:'Due from_'+NAMEOF[e]}]);
  FY[FY.length-1].rule_code='R-IC-RPY-02';
  return amount;
};
for (let m=1;m<=7;m++){
  const mm=String(m).padStart(2,'0');
  const cyc=cycleOf(m), monthInCycle=(m-1)%CYCLE_MONTHS, cycleEnds=(monthInCycle===CYCLE_MONTHS-1);
  ENTITIES.forEach(en=>{
    const e=en.entity_id, t=en.entity_type;
    const seed=(e*37+m*11)%97;
    if (e===15) return; // AIWB uses real scraped entries only
    if (t==='Vertical'||t==='ProjectCo'){
      // Cost is capitalised to the unit under construction in this build cycle.
      const unit = UNIT_OF(e,cyc);
      const cwip = UNIT_MONTH_COST(e,cyc,monthInCycle);
      const sdid = doc({type:'CONSTRUCTION_INVOICE', doc_no:`INV-${en.entity_code}-26${mm}`, po_no:`PO-${en.entity_code}-${String(m).padStart(3,'0')}`, contract:`GC-2026-${en.entity_code}`, vendor:'Summit General Contractors', unit, cost_code:'03-300 Vertical Construction', date:`2026-${mm}-15`, amount:cwip, source_system:'WBS · Faster PO'});
      push(e,mm,'15','PAYABLE','Summit General Contractors',`${mm}/2026 Construction cost accrual · ${unit}`,[
        {account_code:'164400',debit_amount:cwip,credit_amount:0,unit_code:unit},{account_code:'220300',debit_amount:0,credit_amount:cwip}]);
      FY[FY.length-1].source_doc_id=sdid; FY[FY.length-1].rule_code='R-WBS-INV-01';
      addUnitCwip(e,unit,cwip);
      // The funder settles the general contractor on the project company's
      // behalf; the project company owes the funder, not the contractor.
      if (e===FUNDER_ID){
        push(e,mm,'20','EXPA','Summit General Contractors',`${mm}/2026 Contractor payment · ${unit}`,[
          {account_code:'220300',debit_amount:cwip,credit_amount:0,member:'Summit General Contractors'},{account_code:'111000',debit_amount:0,credit_amount:cwip}]);
        FY[FY.length-1].rule_code='R-AP-PAY-01';
      } else {
        push(e,mm,'20','AUTOC',NAMEOF[FUNDER_ID],`${mm}/2026 Contractor paid by affiliate · ${unit}`,[
          {account_code:'220300',debit_amount:cwip,credit_amount:0,member:'Summit General Contractors'},
          {account_code:IC_DUE_TO_FUNDING,debit_amount:0,credit_amount:cwip,member:NAMEOF[FUNDER_ID],description:'Due to/from_'+NAMEOF[FUNDER_ID]}]);
        FY[FY.length-1].rule_code='R-IC-ADV-02';
        icAdvance(mm,'20',e,cwip,`construction draw ${unit}`);
        _dueToFunder[e]=(_dueToFunder[e]||0)+cwip;
      }
      if (cycleEnds){
        // Completion: CWIP becomes finished inventory before anything is sold.
        const carried = transferUnitToInventory(e,unit);
        push(e,mm,'27','CLOSING',null,`${mm}/2026 Completion transfer to finished inventory · ${unit}`,[
          {account_code:'165100',debit_amount:carried,credit_amount:0,unit_code:unit},
          {account_code:'164400',debit_amount:0,credit_amount:carried,unit_code:unit}]);
        FY[FY.length-1].rule_code='R-INV-XFER-01';
        const price = SALE_PRICE(e,cyc);
        const csd = doc({type:'CLOSING_STATEMENT', doc_no:`HUD-${en.entity_code}-26${mm}`, unit, buyer:'Retail Buyer', title_co:'Apex Title LLC', date:`2026-${mm}-28`, amount:price, source_system:'WBS · Closing'});
        push(e,mm,'28','CLOSING',null,`${mm}/2026 Home closing · ${unit}`,[
          {account_code:'111000',debit_amount:price,credit_amount:0,unit_code:unit},{account_code:'491800',debit_amount:0,credit_amount:price,unit_code:unit}]);
        FY[FY.length-1].source_doc_id=csd; FY[FY.length-1].rule_code='R-CLS-SALE-01';
        // Cost of sales is the carrying value of the unit sold. Never a share
        // of the price, never a pooled entity balance.
        const cogs = relieveUnitInventory(e,unit,carried);
        push(e,mm,'28','CLOSING',null,`${mm}/2026 COGS relief from finished inventory · ${unit}`,[
          {account_code:'510000',debit_amount:cogs,credit_amount:0,unit_code:unit},{account_code:'165100',debit_amount:0,credit_amount:cogs,unit_code:unit}]);
        FY[FY.length-1].source_doc_id=csd; FY[FY.length-1].rule_code='R-CLS-COGS-01';
        if (e!==FUNDER_ID) icRepay(mm,'29',e,Math.min(_dueToFunder[e]||0,price),`closing proceeds ${unit}`);
      }
    } else if (t==='LandCo'){
      const land=9000+e*90+m*310+seed*9;
      push(e,mm,'12','PAYABLE','Summit General Contractors',`${mm}/2026 Land development cost`,[
        {account_code:'164100',debit_amount:land,credit_amount:0},{account_code:'220300',debit_amount:0,credit_amount:land}]);
      push(e,mm,'22','AUTOC',NAMEOF[FUNDER_ID],`${mm}/2026 Contractor paid by affiliate (land development)`,[
        {account_code:'220300',debit_amount:land,credit_amount:0,member:'Summit General Contractors'},
        {account_code:IC_DUE_TO_FUNDING,debit_amount:0,credit_amount:land,member:NAMEOF[FUNDER_ID],description:'Due to/from_'+NAMEOF[FUNDER_ID]}]);
      FY[FY.length-1].rule_code='R-IC-ADV-02';
      icAdvance(mm,'22',e,land,'land development draw');
      _dueToFunder[e]=(_dueToFunder[e]||0)+land;
    } else if (t==='Fund'){
      const inc=4000+e*60+m*140+seed*7;
      // The fund earns interest on its advances to the developer; the developer
      // books the mirror payable and the interest cost.
      push(e,mm,'25','INTERNAL',NAMEOF[FUNDER_ID],`${mm}/2026 Interest income on affiliate advances`,[
        {account_code:IC_DUE_FROM,debit_amount:inc,credit_amount:0,member:NAMEOF[FUNDER_ID],description:'Due from_'+NAMEOF[FUNDER_ID]},
        {account_code:'449200',debit_amount:0,credit_amount:inc}]);
      FY[FY.length-1].rule_code='R-IC-INT-01';
      push(FUNDER_ID,mm,'25','INTERNAL',NAMEOF[e],`${mm}/2026 Interest on affiliate advances from ${NAMEOF[e]}`,[
        {account_code:'795000',debit_amount:inc,credit_amount:0},
        {account_code:IC_DUE_TO_SERVICE,debit_amount:0,credit_amount:inc,member:NAMEOF[e],description:'Due to/from_'+NAMEOF[e]}]);
      FY[FY.length-1].rule_code='R-IC-INT-02';
      const fee=Math.round(inc*0.15);
      // WB Asset Management LLC is not a group entity, so this is a trade
      // payable to a third-party manager, not an affiliate balance.
      push(e,mm,'28','PAYABLE','WB Asset Management LLC',`${mm}/2026 Asset management fee`,[
        {account_code:'792000',debit_amount:fee,credit_amount:0},{account_code:'220300',debit_amount:0,credit_amount:fee,member:'WB Asset Management LLC'}]);
    } else { // ServiceCo / Corporate / Holding / TitleCo / OpCo
      const svc=2600+e*45+m*120+seed*5;
      push(e,mm,'05','PAYABLE',NAMEOF[SERVICE_HUB_ID],`${mm}/2026 Outsourcing service fee`,[
        {account_code:'705002',debit_amount:svc,credit_amount:0},
        {account_code:IC_DUE_TO_SERVICE,debit_amount:0,credit_amount:svc,member:NAMEOF[SERVICE_HUB_ID],description:'Due to/from_'+NAMEOF[SERVICE_HUB_ID]}]);
      push(SERVICE_HUB_ID,mm,'05','INTERNAL',NAMEOF[e],`${mm}/2026 Outsourcing service income from ${NAMEOF[e]}`,[
        {account_code:IC_DUE_FROM,debit_amount:svc,credit_amount:0,member:NAMEOF[e],description:'Due from_'+NAMEOF[e]},
        {account_code:'490600',debit_amount:0,credit_amount:svc}]);
      FY[FY.length-1].rule_code='R-IC-SVC-01';
      push(e,mm,'18','EXPA',NAMEOF[SERVICE_HUB_ID],`${mm}/2026 ACH settlement of affiliate service fee`,[
        {account_code:IC_DUE_TO_SERVICE,debit_amount:svc,credit_amount:0,member:NAMEOF[SERVICE_HUB_ID],description:'Due to/from_'+NAMEOF[SERVICE_HUB_ID]},
        {account_code:'111000',debit_amount:0,credit_amount:svc}]);
      push(SERVICE_HUB_ID,mm,'18','EXPA',NAMEOF[e],`${mm}/2026 ACH receipt from ${NAMEOF[e]}`,[
        {account_code:'111000',debit_amount:svc,credit_amount:0,member:BANKOF(SERVICE_HUB_ID)},
        {account_code:IC_DUE_FROM,debit_amount:0,credit_amount:svc,member:NAMEOF[e],description:'Due from_'+NAMEOF[e]}]);
      FY[FY.length-1].rule_code='R-IC-SVC-02';
      const rev=Math.round(svc*1.6);
      push(e,mm,'26','INTERNAL','Third-party client',`${mm}/2026 Service income accrual`,[
        {account_code:'123700',debit_amount:rev,credit_amount:0},{account_code:'490600',debit_amount:0,credit_amount:rev}]);
      push(e,mm,'28','EXPA','Third-party client',`${mm}/2026 Client receipts (bank feed auto-match)`,[
        {account_code:'111000',debit_amount:rev,credit_amount:0},{account_code:'123700',debit_amount:0,credit_amount:rev}]);
    }
  });
}
// ===== Real AIWB INC entries (scraped from WBS companyAccount 2026-07) =====
const AIWB = [];
let _a = 9500;
const mk = (jn, date, src, payee, memo, lines, extra) => AIWB.push({ je_id:++_a, je_number:jn, entity_id:15, period_code:'2026-07', je_date:date,
  je_type: src==='PAYABLE'?'AUTO':'AUTO', source_system: src, payee, description: memo, posting_status:'POSTED', created_by:'system',
  reviewer: extra&&extra.rev||'', cost_code: extra&&extra.cc||'', class_dim:'AIWB INC-Admin', unit_dim:'AIWB INC-Overhead',
  history:[{a:'WBS IMPORT · '+src,by:'system',at:date},{a:'REVIEW',by:(extra&&extra.rev)||'auto',at:date}], lines });
mk('20260701000002','2026-07-01','PAYABLE','Wan Bridge Land LLC','07/2026: Finance, Design and Procurement Costs (Tingjun Wanjia)',
  [{account_code:'705002',debit_amount:25034,credit_amount:0},{account_code:'220300',debit_amount:0,credit_amount:25034,description:'Trade payable_Tingjun Wanjia (Beijing)'}],{rev:'Judy Zhang',cc:'24E341'});
mk('20260701000003','2026-07-01','PAYABLE','Wan Bridge Land LLC','07/2026: Finance, Design and Procurement Costs (BEIJING WANYANG)',
  [{account_code:'705002',debit_amount:37552,credit_amount:0},{account_code:'220300',debit_amount:0,credit_amount:37552,description:'Trade payable_BEIJING WANYANG'}],{rev:'Judy Zhang',cc:'24E341'});
mk('20260701000010','2026-07-01','PAYABLE','Wan Bridge Land LLC','07/26 Research and Development (R&D) Costs',
  [{account_code:'705001',debit_amount:2898,credit_amount:0},{account_code:'220300',debit_amount:0,credit_amount:2898,description:'Trade payable_Ting Qiao'}],{rev:'Judy Zhang',cc:'24E340'});
mk('20260701000020','2026-07-01','PAYABLE','Wan Bridge Land LLC','07/2026: R&D Costs (BEIJING LVSHIWANYANG) and 2% Services Fee',
  [{account_code:'705001',debit_amount:30000,credit_amount:0},{account_code:'220300',debit_amount:0,credit_amount:30000,description:'Trade payable_BEIJING LVSHIWANYANG'}],{rev:'Judy Zhang',cc:'24E340'});
mk('20260702000001','2026-07-02','PAYABLE','ADP, Inc.','6/21/2026 Payroll Service Expense',
  [{account_code:'700800',debit_amount:296.68,credit_amount:0},{account_code:'220300',debit_amount:0,credit_amount:296.68,description:'Trade payable_ADP, Inc.'}],{cc:'34E109'});
mk('20260702000002','2026-07-02','PAYABLE',"Lee's Limousine & Transportation",'5/16/2026 Airport Transfer - Seden',
  [{account_code:'700405',debit_amount:120,credit_amount:0},{account_code:'220300',debit_amount:0,credit_amount:120,description:"Trade payable_Lee's Limousine"}],{cc:'24E060'});
mk('20260703000010','2026-07-03','PAYABLE','ProScreening','AIWB 6/1-6/14/2026 Background Screenings',
  [{account_code:'704600',debit_amount:100.97,credit_amount:0},{account_code:'220300',debit_amount:0,credit_amount:100.97,description:'Trade payable_ProScreening'}],{rev:'Judy Zhang',cc:'34E110'});
mk('20260703000027','2026-07-03','EXPA','ADP, Inc.','ACH: ADP PAYROLL FEES · ENTRY CLASS CCD · auto-matched bank feed',
  [{account_code:'220300',debit_amount:296.68,credit_amount:0,description:'Trade payable_ADP, Inc. (clear)'},{account_code:'111000',debit_amount:0,credit_amount:296.68,description:'Operating Cash_WBAI_WF_9250'}],{});
mk('20260703000029','2026-07-03','PAYABLE','isolved, Inc.','AIWB 7/18-8/17/2026 ApplicantPro/iSolved Standard',
  [{account_code:'704600',debit_amount:132.18,credit_amount:0},{account_code:'220300',debit_amount:0,credit_amount:132.18,description:'Trade payable_isolved'}],{cc:'34E110'});
mk('20260703000035','2026-07-03','PAYABLE','Texas Mutual Insurance Company','Workers Comp Insurance - Policy 0002132541',
  [{account_code:'632015',debit_amount:3906,credit_amount:0},{account_code:'220300',debit_amount:0,credit_amount:3906,description:'Trade payable_Texas Mutual'}],{});
// ===== Real Wan Bridge Land LLC (WBLD) July DIVIDEND run + WBDE PAYABLE/AUTOC (scraped) =====
const REAL2 = [];
let _r = 9700;
const mk2=(eid,jn,date,src,payee,memo,lines)=>REAL2.push({je_id:++_r, je_number:jn, entity_id:eid, period_code:'2026-07', je_date:date, je_type:'AUTO',
  source_system:src, payee, description:memo, posting_status:'POSTED', created_by:'system', history:[{a:'WBS IMPORT · '+src,by:'system',at:date}], lines});
// WBLD (entity 2) — owner dividend distributions by lot, tax withholding, cash out
mk2(2,'20260701000001','2026-07-01','DIVIDEND','Rao Fu','Dividend: Lot 101/102 Block C1, The Barracks',
 [{account_code:'380110',debit_amount:4100.35,credit_amount:0,description:'Lot 102 Block C1'},{account_code:'380110',debit_amount:4300.39,credit_amount:0,description:'Lot 101 Block C1'},{account_code:'111000',debit_amount:0,credit_amount:8400.74,description:'Wan Bridge Land ACH'}]);
mk2(2,'20260701000002','2026-07-01','DIVIDEND','XILE WANG','Dividend: 603/604 Block A7 Phase 1, The Future — net of tax',
 [{account_code:'380110',debit_amount:3615,credit_amount:0,description:'604 Block A7'},{account_code:'380110',debit_amount:3415,credit_amount:0,description:'603 Block A7'},{account_code:'111000',debit_amount:0,credit_amount:6327,description:'ACH out'},{account_code:'220204',debit_amount:0,credit_amount:361.50,description:'Tax deduction'},{account_code:'220204',debit_amount:0,credit_amount:341.50,description:'Tax deduction'}]);
mk2(2,'20260701000003','2026-07-01','DIVIDEND','Ling Carman Chung','Dividend: 114 Lakeland Circle, Rosharon TX',
 [{account_code:'380110',debit_amount:3235,credit_amount:0},{account_code:'111000',debit_amount:0,credit_amount:3235}]);
mk2(2,'20260701000004','2026-07-01','DIVIDEND','Wei Fashu','Dividend: 19319/19323 Late Boneset Dr — net of tax',
 [{account_code:'380110',debit_amount:4500,credit_amount:0},{account_code:'380110',debit_amount:4500,credit_amount:0},{account_code:'111000',debit_amount:0,credit_amount:8100},{account_code:'220204',debit_amount:0,credit_amount:450},{account_code:'220204',debit_amount:0,credit_amount:450}]);
mk2(2,'20260701000005','2026-07-01','DIVIDEND','Quanchao Zhou','Dividend: 206 Block A8 Phase 1, The Future',
 [{account_code:'380110',debit_amount:3865,credit_amount:0},{account_code:'111000',debit_amount:0,credit_amount:3865}]);
mk2(2,'20260701000006','2026-07-01','DIVIDEND','Yong Huang','Dividend: 101 Block A6 Phase 1, The Future',
 [{account_code:'380110',debit_amount:3835,credit_amount:0},{account_code:'111000',debit_amount:0,credit_amount:3835}]);
// WBDE (entity 3) — software vendors two-step + Welltower contribution + WBG payroll
mk2(3,'20260701000001','2026-07-01','PAYABLE','OpenAI.com','OpenAI subscription',
 [{account_code:'705000',debit_amount:96.64,credit_amount:0},{account_code:'220300',debit_amount:0,credit_amount:96.64,description:'Trade payable_OpenAI'}]);
mk2(3,'20260701000002','2026-07-01','AUTOC','OpenAI.com','PURCHASE OPENAI +14158799686 — card auto-clear',
 [{account_code:'220300',debit_amount:96.64,credit_amount:0},{account_code:'111000',debit_amount:0,credit_amount:96.64}]);
mk2(3,'20260702000004','2026-07-02','PAYABLE','Google LLC','Google Cloud software',
 [{account_code:'705000',debit_amount:3425.06,credit_amount:0},{account_code:'220300',debit_amount:0,credit_amount:3425.06,description:'Trade payable_Google'}]);
mk2(3,'20260702000005','2026-07-02','AUTOC','Google LLC','PURCHASE GOOGLE *CLOUD g.co — card auto-clear',
 [{account_code:'220300',debit_amount:3425.06,credit_amount:0},{account_code:'111000',debit_amount:0,credit_amount:3425.06}]);
mk2(3,'20260702000006','2026-07-02','PAYABLE','Github, INC','GitHub enterprise',
 [{account_code:'705000',debit_amount:6893.10,credit_amount:0},{account_code:'220300',debit_amount:0,credit_amount:6893.10,description:'Trade payable_GitHub'}]);
mk2(3,'20260702000007','2026-07-02','AUTOC','Github, INC','PURCHASE GITHUB, INC. — card auto-clear',
 [{account_code:'220300',debit_amount:6893.10,credit_amount:0},{account_code:'111000',debit_amount:0,credit_amount:6893.10}]);
mk2(3,'20260702000008','2026-07-02','AUTOC','Welltower Inc.','WT Contribution 0702MMQFMPWD002003',
 [{account_code:'111000',debit_amount:1703376.86,credit_amount:0},{account_code:'380100',debit_amount:0,credit_amount:1703376.86,description:'WT Contribution'}]);
mk2(3,'20260703000001','2026-07-03','PAYABLE','Wan Bridge Group','4/2026 ADP Salaries',
 [{account_code:'700600',debit_amount:4121.94,credit_amount:0},{account_code:'220300',debit_amount:0,credit_amount:4121.94,description:'Trade payable_WBG'}]);
export const AIWB_JES = AIWB.concat(REAL2);
// ===== Opening balance sheet at 2025-12-31 and the prior-year close ==========
// Before this block the group started from nothing on 1 January 2026: no cash,
// no capital, no retained earnings, and a balance sheet that only tied because
// every account began at zero. Each entity now opens with a trial balance that
// balances on its own, and the FY2025 result is closed out of Current Year
// Surplus into Prior Years Retained Earnings by the same engine routine that
// would close FY2026.
const OPENING_PERIOD = '2025-12', OPENING_DATE = '2025-12-31';
const OPENING = [];
// Opening cash has to be at least large enough that no entity ever runs a
// negative bank balance during FY2026 - an overdrawn demo ledger is its own
// defect. The requirement is read off the generated ledger, not guessed, then
// rounded up to the next 100,000 and topped with a fixed operating cushion.
const cashLowWater = () => {
  const low = {};
  const running = {};
  [...FY, ...AIWB_JES].filter(j=>j.posting_status==='POSTED')
    .slice().sort((a,b)=>String(a.je_date).localeCompare(String(b.je_date)) || a.je_id-b.je_id)
    .forEach(j=>j.lines.forEach(l=>{
      if (l.account_code!=='111000') return;
      const e=j.entity_id;
      running[e]=(running[e]||0)+Math.round((l.debit_amount||0)*100)-Math.round((l.credit_amount||0)*100);
      if (running[e] < (low[e]||0)) low[e]=running[e];
    }));
  return low;
};
const _low = cashLowWater();
const openCash = (e)=>{
  const shortfallDollars = Math.ceil(Math.max(0, -(_low[e]||0))/100);   // low water is held in cents
  return 25000 + e*250 + Math.ceil(shortfallDollars/10000)*10000;
};
const openWip = (e)=>60000 + ((e*29)%40)*1500;
const openAP = (e)=>20000 + ((e*17)%25)*1200;
const openPriorEarnings = (e)=>20000 + ((e*23)%60)*800;
ENTITIES.forEach(en=>{
  const e=en.entity_id, t=en.entity_type;
  const cash=openCash(e);
  const wipAccount = (t==='Vertical'||t==='ProjectCo') ? '164400' : t==='LandCo' ? '164100' : null;
  const wip = wipAccount ? openWip(e) : 0;
  const ap = openAP(e);
  const prior = openPriorEarnings(e);
  const capital = cash + wip - ap - prior;   // whole dollars; the entry ties by construction
  const lines=[{account_code:'111000',debit_amount:cash,credit_amount:0,member:BANKOF(e),description:'Opening cash_'+BANKOF(e)}];
  if (wipAccount) lines.push({account_code:wipAccount,debit_amount:wip,credit_amount:0,unit_code:UNIT_OF(e,0),description:'Opening work in progress'});
  lines.push({account_code:'220300',debit_amount:0,credit_amount:ap,member:'Summit General Contractors',description:'Opening trade payable_Summit General Contractors'});
  lines.push({account_code:'380101',debit_amount:0,credit_amount:capital,description:'Opening paid in capital'});
  lines.push({account_code:'370300',debit_amount:0,credit_amount:prior,description:'FY2025 result, before close'});
  _g++;
  OPENING.push({je_id:_g, je_number:`20251231${String(_g).padStart(6,'0')}`, entity_id:e, period_code:OPENING_PERIOD, je_date:OPENING_DATE,
    je_type:'OPENING', source_system:'OPENING', payee:null, description:'Opening balance sheet at 2025-12-31',
    posting_status:'POSTED', created_by:'system', rule_code:'R-OPEN-TB-01',
    source_doc_id:doc({type:'OPENING_TRIAL_BALANCE', doc_no:`OTB-${en.entity_code}-2025`, vendor:'—', date:OPENING_DATE, amount:cash+wip, source_system:'REFS opening balance import'}),
    history:[{a:'OPENING BALANCE IMPORT',by:'system',at:OPENING_DATE}], lines});
  // Prior-year close: FY2025's result leaves Current Year Surplus and becomes
  // Prior Years Retained Earnings, so 2026 opens with nothing in current
  // earnings. Same routine, same accounts, for any later year end.
  const closeLines = yearEndCloseLines(prior);
  if (closeLines.length){
    _g++;
    OPENING.push({je_id:_g, je_number:`20251231${String(_g).padStart(6,'0')}`, entity_id:e, period_code:OPENING_PERIOD, je_date:OPENING_DATE,
      je_type:'CLOSING', source_system:'CLOSE', payee:null, description:'FY2025 year-end close: current year surplus to prior years retained earnings',
      posting_status:'POSTED', created_by:'system', rule_code:'R-CLOSE-YE-01',
      source_doc_id:doc({type:'YEAR_END_CLOSE', doc_no:`YEC-${en.entity_code}-2025`, vendor:'—', date:OPENING_DATE, amount:prior, source_system:'REFS close routine'}),
      history:[{a:'YEAR END CLOSE',by:'system',at:OPENING_DATE}],
      lines:closeLines.map(l=>({...l, description:'FY2025 close'}))});
  }
});
FY.unshift(...OPENING);
// ===== Normalization pass (AI Audit remediation): member + source doc completeness =====
const SUBS_ALL={'111000':'Bank','112000':'Bank','220300':'Vendor','220200':'Vendor','225000':'Vendor','291000':'Affiliate','291001':'Affiliate','125000':'Affiliate','120200':'Customer','123700':'Customer','270100':'Loan','260100':'Loan'};
const _ALL = FY.concat(AIWB_JES);
const _norm = j=>{
  j.lines.forEach(l=>{
    if (SUBS_ALL[l.account_code] && !l.member){
      const fromDesc = l.description && l.description.includes('_') ? l.description.split('_').slice(1).join('_').replace(/ \(clear\)$/,'') : null;
      l.member = fromDesc || j.payee || (SUBS_ALL[l.account_code]==='Bank' ? ('Operating Cash_E'+j.entity_id) : 'Wan Bridge Development LLC');
      if (!l.description) l.description = (l.account_code.startsWith('291')?'Due to/from_':'') + l.member;
    }
  });
  if (j.je_type==='AUTO' && ['PAYABLE','CLOSING'].includes(j.source_system) && !j.source_doc_id && !j.rule_code){
    j.source_doc_id = doc({type:'SERVICE_INVOICE', doc_no:'SVC-'+j.je_number, vendor:j.payee||'—', date:j.je_date, amount:j.lines.reduce((s,l)=>s+(l.debit_amount||0),0), source_system:'WBS · Contract & Invoice'});
    j.rule_code = j.rule_code || 'R-AP-STD-01';
  }
  if (j.je_type==='AUTO' && (!j.source_doc_id || !j.rule_code)){
    const source=String(j.source_system||'INTERNAL').replace(/[^A-Z0-9_]/gi,'_').toUpperCase();
    j.source_doc_id = j.source_doc_id || doc({type:'DEMO_SOURCE_SNAPSHOT',doc_no:`DEMO-${source}-${j.je_number||j.je_id}`,vendor:j.payee||'Demo counterparty',date:j.je_date,amount:j.lines.reduce((s,l)=>s+(l.debit_amount||0),0),source_system:'REFS demo fixture'});
    j.rule_code = j.rule_code || `R-DEMO-${source}`;
  }
};
_ALL.forEach(_norm);
JOURNAL_ENTRIES.forEach(_norm);
export const FY2026 = _ALL;
// Unit to owner-company relationship.
export const UNIT_OWNERS = { 'A-203':{entity_id:4, name:'WB Home LLC'}, 'B-110':{entity_id:2, name:'Wan Bridge Land LLC'}, 'C-050':{entity_id:11, name:'WB Pradera Oaks Land 1 LLC'} };
