// REFS seed data (demo). All figures are illustrative prototype data, not actuals.

export const COA = [
  ['1000','Cash - Operating','ASSET','DEBIT'],
  ['1010','Restricted Cash - Escrow','ASSET','DEBIT'],
  ['1015','Restricted Cash - Reserve','ASSET','DEBIT'],
  ['1200','AR - Tenant','ASSET','DEBIT'],
  ['1210','AR - Owner','ASSET','DEBIT'],
  ['1220','Due from Affiliate','ASSET','DEBIT'],
  ['1300','Prepaid Property Tax','ASSET','DEBIT'],
  ['1310','Prepaid Insurance','ASSET','DEBIT'],
  ['1400','Construction in Progress (CIP)','ASSET','DEBIT'],
  ['1405','Capitalized Interest','ASSET','DEBIT'],
  ['1500','Land','ASSET','DEBIT'],
  ['1510','Building','ASSET','DEBIT'],
  ['1520','Land Improvement','ASSET','DEBIT'],
  ['1590','Accumulated Depreciation','ASSET','CREDIT'],
  ['1700','Deferred Financing Cost','ASSET','DEBIT'],
  ['2000','Accounts Payable','LIABILITY','CREDIT'],
  ['2050','Retainage Payable','LIABILITY','CREDIT'],
  ['2100','Interest Payable','LIABILITY','CREDIT'],
  ['2150','Property Tax Payable','LIABILITY','CREDIT'],
  ['2200','Security Deposit Liability','LIABILITY','CREDIT'],
  ['2300','Due to Affiliate','LIABILITY','CREDIT'],
  ['2500','Construction Loan Payable','LIABILITY','CREDIT'],
  ['2510','Mortgage Loan Payable','LIABILITY','CREDIT'],
  ['3000','Members Equity - Contribution','EQUITY','CREDIT'],
  ['3010','Members Equity - Distribution','EQUITY','DEBIT'],
  ['3900','Retained Earnings','EQUITY','CREDIT'],
  ['4000','Rental Income - Base Rent','REVENUE','CREDIT'],
  ['4050','Other Income','REVENUE','CREDIT'],
  ['4090','Vacancy/Concession (contra)','REVENUE','DEBIT'],
  ['4900','Gain on Sale','REVENUE','CREDIT'],
  ['4910','Loss on Sale','EXPENSE','DEBIT'],
  ['5000','Interest Expense','EXPENSE','DEBIT'],
  ['5010','Amortization of DFC','EXPENSE','DEBIT'],
  ['6000','Property Management Fee','EXPENSE','DEBIT'],
  ['6010','Repair & Maintenance','EXPENSE','DEBIT'],
  ['6020','Utilities','EXPENSE','DEBIT'],
  ['6030','Property Tax Expense','EXPENSE','DEBIT'],
  ['6040','Insurance Expense','EXPENSE','DEBIT'],
  ['6050','Depreciation Expense','EXPENSE','DEBIT'],
  ['6060','Bad Debt Expense','EXPENSE','DEBIT'],
  ['6900','Selling Cost','EXPENSE','DEBIT'],
  ['9000','Suspense','ASSET','DEBIT'],
].map(([code,name,type,nb])=>({account_code:code,account_name:name,account_type:type,normal_balance:nb}));

export const ENTITIES = [
  {entity_id:1, entity_code:'E1000', entity_name:'WanBridge Holding LLC', entity_type:'Holding'},
  {entity_id:2, entity_code:'E1001', entity_name:'WanBridge Project I LLC', entity_type:'ProjectCo'},
  {entity_id:3, entity_code:'E1002', entity_name:'WanBridge Title Co LLC', entity_type:'TitleCo'},
  {entity_id:4, entity_code:'E1003', entity_name:'WanBridge OpCo LLC', entity_type:'OpCo'},
];

export const PERIODS = [
  {period_id:1, entity_id:2, period_code:'2026-06', status:'CLOSED'},
  {period_id:2, entity_id:2, period_code:'2026-07', status:'OPEN'},
  {period_id:3, entity_id:4, period_code:'2026-07', status:'OPEN'},
];

export const PROJECTS = [
  {project_id:1, project_code:'PRJ-001', project_name:'Cedar Ridge Phase I', entity_id:2, project_status:'ACTIVE', construction_status:'UNDER_CONSTRUCTION'},
  {project_id:2, project_code:'PRJ-002', project_name:'Maple Court', entity_id:4, project_status:'ACTIVE', construction_status:'IN_SERVICE'},
];

export const PROPERTIES = [
  {property_id:1, property_code:'P0012', property_name:'Cedar Ridge Bldg A', entity_id:2, project_id:1, property_status:'UNDER_DEVELOPMENT', operation_status:null},
  {property_id:2, property_code:'P0020', property_name:'Maple Court', entity_id:4, project_id:2, property_status:'IN_SERVICE', operation_status:'STABILIZED'},
];

export const LOANS = [
  {loan_id:1, loan_code:'L-2025-014', loan_type:'CONSTRUCTION', entity_id:2, project_id:1, lender_name:'First National Bank',
   commitment_amount:12000000, original_principal:12000000, current_principal:4250000,
   interest_rate:0.0825, maturity_date:'2027-12-31', borrowing_base:8500000},
  {loan_id:2, loan_code:'M-2024-003', loan_type:'MORTGAGE', entity_id:4, project_id:2, lender_name:'Pacific Mortgage',
   commitment_amount:6000000, original_principal:6000000, current_principal:5720000,
   interest_rate:0.0615, maturity_date:'2034-05-01', borrowing_base:6000000},
];

export const BANK_ACCOUNTS = [
  {bank_account_id:1, bank_account_code:'BA-001', entity_id:2, bank_name:'First National Bank', account_type:'OPERATING'},
  {bank_account_id:2, bank_account_code:'BA-003', entity_id:4, bank_name:'Pacific Bank', account_type:'OPERATING'},
  {bank_account_id:3, bank_account_code:'BA-ESC', entity_id:2, bank_name:'First National Bank', account_type:'ESCROW'},
];

export const VENDORS = [
  {vendor_id:1, vendor_code:'V-100', vendor_name:'Summit General Contractors', is_1099:false, is_related_party:false},
  {vendor_id:2, vendor_code:'V-101', vendor_name:'BluePeak Utilities', is_1099:false, is_related_party:false},
  {vendor_id:3, vendor_code:'V-102', vendor_name:'WanBridge Property Mgmt (RP)', is_1099:false, is_related_party:true},
];

export const CUSTOMERS = [
  {customer_id:1, customer_code:'C-200', customer_name:'Tenant - Unit A-203', customer_type:'TENANT', is_related_party:false},
  {customer_id:2, customer_code:'C-201', customer_name:'WanBridge OpCo (Owner)', customer_type:'OWNER', is_related_party:true},
];

// PM Charge Code -> Owner GL mapping (versioned)
export const MAPPINGS = [
  {mapping_id:1, mapping_type:'PM', source_code:'RENT', owner_gl_account_code:'4000', rev_exp_flag:'REVENUE', cash_accrual_flag:'ACCRUAL', is_current:true},
  {mapping_id:2, mapping_type:'PM', source_code:'LATE_FEE', owner_gl_account_code:'4050', rev_exp_flag:'REVENUE', cash_accrual_flag:'CASH', is_current:true},
  {mapping_id:3, mapping_type:'PM', source_code:'SEC_DEPOSIT', owner_gl_account_code:'2200', rev_exp_flag:'LIABILITY', cash_accrual_flag:'CASH', is_current:true},
  {mapping_id:4, mapping_type:'PM', source_code:'UTILITIES', owner_gl_account_code:'6020', rev_exp_flag:'EXPENSE', cash_accrual_flag:'ACCRUAL', is_current:true},
  {mapping_id:5, mapping_type:'PM', source_code:'MGMT_FEE', owner_gl_account_code:'6000', rev_exp_flag:'EXPENSE', cash_accrual_flag:'ACCRUAL', is_current:true},
  // NOTE: 'PET_FEE' intentionally UNMAPPED to demonstrate GL_MAPPING_MISSING exception
];

export const USERS = [
  {user_id:'ricky', name:'Ricky (Controller)', role_code:'CONTROLLER'},
  {user_id:'sam', name:'Sam (Staff Accountant)', role_code:'STAFF_ACCT'},
  {user_id:'pat', name:'Pat (Project Accountant)', role_code:'PROJECT_ACCT'},
  {user_id:'lee', name:'Lee (Auditor)', role_code:'AUDITOR'},
];
