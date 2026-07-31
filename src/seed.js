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
  { je_id: 1000, je_number:'20260701000001', entity_id:2, period_code:'2026-07', je_date:'2026-07-01',
    je_type:'AUTO', source_system:'BANK', description:'Capital contribution - Fund II equity funding', posting_status:'POSTED', created_by:'system',
    history:[{a:'AUTO POST',by:'system',at:'2026-07-01'}],
    lines:[{account_code:'1000',debit_amount:800000,credit_amount:0},{account_code:'3000',debit_amount:0,credit_amount:800000}] },
  {je_id:1001, je_number:'JE-2026-07-1001', entity_id:2, period_code:'2026-07', je_type:'AUTO', je_date:'2026-07-05',
   description:'Construction Loan Draw #7 - Cedar Ridge', source_system:'WBS_CL', posting_status:'POSTED',
   rule_code:'R-LOAN-01', lines:[L('1400',500000,0,{project_id:1,loan_id:1}), L('2500',0,500000,{loan_id:1})]},
  {je_id:1002, je_number:'JE-2026-07-1002', entity_id:2, period_code:'2026-07', je_type:'AUTO', je_date:'2026-07-31',
   description:'Capitalized interest accrual (Under Construction)', source_system:'WBS_CL', posting_status:'POSTED',
   rule_code:'R-LOAN-03', lines:[L('1405',29200,0,{loan_id:1,project_id:1}), L('2100',0,29200,{loan_id:1})]},
  {je_id:1003, je_number:'JE-2026-07-1003', entity_id:4, period_code:'2026-07', je_type:'AUTO', je_date:'2026-07-01',
   description:'Rent income accrual - Maple Court', source_system:'PM', posting_status:'POSTED',
   rule_code:'R-PM-11', lines:[L('1200',48000,0,{property_id:2}), L('4000',0,48000,{property_id:2})]},
  {je_id:1004, je_number:'JE-2026-07-1004', entity_id:4, period_code:'2026-07', je_type:'AUTO', je_date:'2026-07-06',
   description:'Rent receipt - Maple Court', source_system:'PM', posting_status:'POSTED',
   rule_code:'R-PM-12', lines:[L('1000',46000,0,{property_id:2}), L('1200',0,46000,{property_id:2})]},
  {je_id:1005, je_number:'JE-2026-07-1005', entity_id:4, period_code:'2026-07', je_type:'AUTO', je_date:'2026-07-10',
   description:'Utilities expense - Maple Court', source_system:'PM', posting_status:'POSTED',
   rule_code:'R-PM-18', lines:[L('6020',3200,0,{property_id:2}), L('2000',0,3200,{property_id:2,vendor_id:2})]},
  {je_id:1006, je_number:'JE-2026-07-1006', entity_id:4, period_code:'2026-07', je_type:'AUTO', je_date:'2026-07-31',
   description:'Property management fee (related party)', source_system:'PM', posting_status:'POSTED',
   rule_code:'R-PM-19', lines:[L('6000',2400,0,{property_id:2}), L('2300',0,2400,{vendor_id:3})]},
  {je_id:1007, je_number:'JE-2026-07-1007', entity_id:2, period_code:'2026-07', je_type:'CLOSING', je_date:'2026-07-15',
   description:'Property acquisition - Cedar Ridge parcel', source_system:'CLS', posting_status:'POSTED',
   rule_code:'R-CLS-21', lines:[L('1500',900000,0,{property_id:1}), L('1510',2100000,0,{property_id:1}),
     L('2500',0,2400000,{loan_id:1}), L('1000',0,600000)]},
  // Drafts / pending (work items)
  {je_id:2001, je_number:'JE-2026-07-2001', entity_id:4, period_code:'2026-07', je_type:'AUTO', je_date:'2026-07-31',
   description:'PM Pickup batch PM-202607-P0020 (late fee)', source_system:'PM', posting_status:'PENDING_REVIEW',
   rule_code:'R-PM-15', lines:[L('1000',350,0,{property_id:2}), L('4050',0,350,{property_id:2})]},
  {je_id:2002, je_number:'JE-2026-07-2002', entity_id:2, period_code:'2026-07', je_type:'RECLASS', je_date:'2026-07-28',
   description:'Reclass misposted R&M to CIP', source_system:'MAN', posting_status:'PENDING_APPROVAL',
   has_attachment:true, lines:[L('1400',5000,0,{project_id:1}), L('6010',0,5000)]},
  {je_id:2003, je_number:'JE-2026-07-2003', entity_id:2, period_code:'2026-07', je_type:'MANUAL', je_date:'2026-07-29',
   description:'Manual accrual - no support attached', source_system:'MAN', posting_status:'DRAFT',
   has_attachment:false, lines:[L('6030',1800,0,{property_id:1}), L('2150',0,1800)]},
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
   lines:[{label:'Land',account_code:'1500',debit:900000,credit:0},{label:'Building',account_code:'1510',debit:2100000,credit:0},
     {label:'Construction Loan',account_code:'2500',debit:0,credit:2400000},{label:'Cash to Close',account_code:'1000',debit:0,credit:600000}]},
];

export const IC_TXNS = [
  {ic_txn_id:1, ic_pair_id:'ICP-0007', ic_type:'FUNDING', initiator_entity:'E1001', counterparty_entity:'E1003', amount:100000, match_status:'UNMATCHED'},
  {ic_txn_id:2, ic_pair_id:'ICP-0006', ic_type:'FUNDING', initiator_entity:'E1000', counterparty_entity:'E1001', amount:250000, match_status:'MATCHED'},
];
