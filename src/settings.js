// Company-specific Journal Code Configuration — REAL WBS schema (scraped 2026-08-01, WBAI)
import { repo } from './repo.js';
export const SRC_CATEGORIES = ['Bank Transaction','Cost General Ledger','Payable','Batch'];
export const BANK_TYPES = ['Bank','Contruction Loan','Cost','Cost_Consulting','Cost_Direct','Cost_EXP','Cost_GC','Cost_GC2','Cost_HOA','Cost_Income','Cost_ROE','Cost_TBD','Dividend','HOA','Internal Transfer','Reversal','Sales income','Sales_Cancellation(Credit)','Sales_Cancellation(Debit)','Sales_Third-Party Payments(Credit)','Sales_Third-Party Payments(Debit)','Yardi','YardiSL'];
export const DEFAULT_SETTING = (en) => ({
  entity_id: en.entity_id, year: 2026,
  account_setting: [
    {category:'Bank Transaction', type:'Bank', detail:String(2735229250+en.entity_id*7), account:'111000', desc:'Operating Cash', project:'', status:'LIVE'},
    {category:'Bank Transaction', type:'Bank', detail:String(6208882958+en.entity_id*3), account:'111000', desc:'Operating Cash', project:'', status:'LIVE'},
    {category:'Bank Transaction', type:'Contruction Loan', detail:'Closing Cost', account:'161200', desc:'Closing Costs', project:'Select', status:'LIVE'},
    {category:'Bank Transaction', type:'Contruction Loan', detail:'Draw', account:'270100', desc:'Loan Payable', project:'Select', status:'LIVE'},
    {category:'Bank Transaction', type:'Contruction Loan', detail:'Insurance Escrow', account:'112003', desc:'Escrow-Insurance', project:'Select', status:'LIVE'},
    {category:'Bank Transaction', type:'Contruction Loan', detail:'Interest payment', account:'291001', desc:'Due to/from', project:'', status:'LIVE'},
    {category:'Bank Transaction', type:'Contruction Loan', detail:'Repayment', account:'291001', desc:'Due to/from', project:'', status:'LIVE'},
    {category:'Bank Transaction', type:'Contruction Loan', detail:'Tax Escrow', account:'112002', desc:'Escrow-RE Tax', project:'Select', status:'LIVE'},
    {category:'Bank Transaction', type:'Contruction Loan', detail:'Transaction Fee', account:'651000', desc:'Bank Fees', project:'Select', status:'LIVE'},
    {category:'Bank Transaction', type:'Cost', detail:'0LD* (Land Dev codes)', account:'164100', desc:'CWIP-Land', project:'Select', status:'LIVE'},
    {category:'Bank Transaction', type:'Cost', detail:'2HD* (Hard cost codes)', account:'164400', desc:'CWIP-Improvements', project:'Select', status:'LIVE'},
    {category:'Bank Transaction', type:'Cost', detail:'24E*/21E* (Corp expense codes)', account:'705002', desc:'Outsourcing/Corp', project:'', status:'LIVE'},
    {category:'Bank Transaction', type:'Cost', detail:'9AM* (Asset mgmt)', account:'792000', desc:'Asset Mgmt Fees', project:'', status:'LIVE'},
    {category:'Bank Transaction', type:'Dividend', detail:'Actual dividend amount', account:'291000', desc:'Due to/from owner', project:'Select', status:'LIVE'},
    {category:'Bank Transaction', type:'Dividend', detail:'Deduction amount', account:'220204', desc:'Tax Payable', project:'', status:'LIVE'},
    {category:'Bank Transaction', type:'Internal Transfer', detail:'Normal', account:'111000', desc:'Counterparty bank account', project:'', status:'LIVE'},
    {category:'Bank Transaction', type:'Sales income', detail:'Confirmed amount', account:'491800', desc:'Sales of Product', project:'Select', status:'LIVE'},
    {category:'Bank Transaction', type:'Sales income', detail:'Title Withholding', account:'220205', desc:'Title Closing fee Payable', project:'', status:'LIVE'},
    {category:'Bank Transaction', type:'Yardi', detail:'PM feed', account:'421803', desc:'Rental Income', project:'', status:'LIVE'},
  ],
  cost_setting: [
    {category:'Cost General Ledger', type:'Income(Credit)', detail:'1SF1xx / 3GNxxx codes', account:'490600', desc:'Service income by code', status:'LIVE'},
    {category:'Cost General Ledger', type:'Direct(Debit)', detail:'per cost code', account:'164400', desc:'CWIP (in progress)', status:'LIVE'},
    {category:'Cost General Ledger', type:'Direct(Debit)·COMPLETED', detail:'per cost code', account:'510000', desc:'COGS (completed)', status:'LIVE'},
    {category:'Cost General Ledger', type:'EXP(Debit)', detail:'per cost code', account:'688000', desc:'Misc expense', status:'LIVE'},
    {category:'Cost General Ledger', type:'Consulting(Debit)', detail:'per cost code', account:'700150', desc:'Consulting Fees', status:'LIVE'},
  ],
  payable_setting: [
    {category:'Payable', type:'Credit', detail:'(all)', account:'291001', desc:'Due to/from by payee', entity:'', status:'LIVE'},
    {category:'Payable', type:'Debit', detail:'24E0xx', account:'705002', desc:'Outsourcing', entity:en.entity_name, status:'LIVE'},
    {category:'Payable', type:'Debit', detail:'21E0xx', account:'705001', desc:'R&D', entity:en.entity_name, status:'LIVE'},
    {category:'Payable', type:'Debit', detail:'2HD/0LD', account:'164400', desc:'CWIP', entity:en.entity_name, status:'LIVE'},
  ],
  batch_setting: [
    {memo:'Monthly interest accrual', dr:'164500', cr:'220410', sequential:true, reverse_next_month:false, status:'LIVE'},
    {memo:'Month-end expense accrual', dr:'688000', cr:'220300', sequential:true, reverse_next_month:true, status:'LIVE'},
  ],
});
export const loadSetting = (en) => repo.load('setting_'+en.entity_id, DEFAULT_SETTING(en));
export const saveSetting = (en, s) => repo.save('setting_'+en.entity_id, s);
export const copySetting = (fromEn, toEn) => { const s=loadSetting(fromEn); const t={...structuredClone(s), entity_id:toEn.entity_id}; saveSetting(toEn,t); return t; };
