// Per-company Journal Code Configuration (mirror of WBS cashOrBankBookAccountSetting)
import { repo } from './repo.js';
export const DEFAULT_SETTING = (en) => ({
  entity_id: en.entity_id, year: 2026,
  account_setting: [ // Category / Type / Detail -> Account (+Project)
    {category:'Bank Transaction', type:'Bank', detail:String(2735229250+en.entity_id*7), account:'111000', desc:'Operating Cash', project:''},
    {category:'Bank Transaction', type:'Bank', detail:String(6208882958+en.entity_id*3), account:'111000', desc:'Operating Cash', project:''},
    {category:'Bank Transaction', type:'Contruction Loan', detail:'Closing Cost', account:'161200', desc:'Closing Costs', project:'PRJ-'+en.entity_code},
    {category:'Bank Transaction', type:'Contruction Loan', detail:'Draw', account:'270100', desc:'Construction Loan - LT', project:'PRJ-'+en.entity_code},
    {category:'Bank Transaction', type:'Contruction Loan', detail:'Insurance Escrow', account:'112003', desc:'Escrow - Insurance', project:''},
    {category:'Bank Transaction', type:'Contruction Loan', detail:'Interest payment', account:'291001', desc:'Due to/from', project:''},
    {category:'Bank Transaction', type:'Contruction Loan', detail:'Repayment', account:'291001', desc:'Due to/from', project:''},
    {category:'Bank Transaction', type:'Contruction Loan', detail:'Tax Escrow', account:'112002', desc:'Escrow - RE Tax', project:''},
  ],
  cost_setting: [ // Cost Code + construction status -> debit account
    {cost_code:'01-100 Land', status:'ANY', account:'164100', desc:'CWIP - Land'},
    {cost_code:'03-300 Vertical', status:'UNDER_CONSTRUCTION', account:'164400', desc:'CWIP - Land improvements'},
    {cost_code:'03-300 Vertical', status:'COMPLETED', account:'510000', desc:'COGS (完工后费用化)'},
    {cost_code:'04-400 Interest', status:'UNDER_CONSTRUCTION', account:'164500', desc:'CWIP - Capitalized interest'},
    {cost_code:'04-400 Interest', status:'COMPLETED', account:'795000', desc:'Interest Expense'},
  ],
  payable_setting: [ // payee type -> credit account, member source
    {payee_type:'Vendor', credit_account:'291001', member:'payee', desc:'Due to/from_按Payee'},
    {payee_type:'Affiliate', credit_account:'291000', member:'payee', desc:'Due to/from 关联方'},
    {payee_type:'Employee', credit_account:'291001', member:'payee', desc:'报销挂账'},
  ],
  batch_setting: {journal_prefix:'YYYYMMDD', review_required:true, auto_post_expa:true, dup_check:true},
});
export const loadSetting = (en) => repo.load('setting_'+en.entity_id, DEFAULT_SETTING(en));
export const saveSetting = (en, s) => repo.save('setting_'+en.entity_id, s);
// engine hook: resolve account for a bank txn detail / cost code by company setting
export const resolveBankDetail = (setting, detail) => (setting.account_setting.find(r=>r.detail===detail)||{}).account;
export const resolveCost = (setting, cost_code, status) => { const r = setting.cost_setting.find(r=>cost_code.startsWith(r.cost_code.split(' ')[0]) && (r.status==='ANY'||r.status===status)); return r&&r.account; };
