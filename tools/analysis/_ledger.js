// Shared loader for close-review analysis. Re-exports the real posted ledger.
import { COA, ENTITIES, PERIODS, PROJECTS, PROPERTIES, LOANS, BANK_ACCOUNTS, MAPPINGS, COST_CODES, COST_CODE_MAP, DEVELOPMENT_PROJECT_OF } from '../../src/data.js';
import { WBS_COA_FULL, WBS_COA_MAP, SUBSIDIARY, subsidiaryOf, memberOf } from '../../src/coa-wbs.js';
import { JOURNAL_ENTRIES, FY2026, SOURCE_DOCS, LOAN_TXNS, PM_ROWS, BANK_TXNS, CLOSINGS, IC_TXNS, CLOSE_TASKS, EXCEPTIONS } from '../../src/seed.js';
export const ALL = [...JOURNAL_ENTRIES, ...FY2026];
export const POSTED = ALL.filter(j=>j.posting_status==='POSTED');
export { COA, ENTITIES, PERIODS, PROJECTS, PROPERTIES, LOANS, BANK_ACCOUNTS, MAPPINGS, COST_CODES, COST_CODE_MAP, DEVELOPMENT_PROJECT_OF,
  WBS_COA_FULL, WBS_COA_MAP, SUBSIDIARY, subsidiaryOf, memberOf,
  JOURNAL_ENTRIES, FY2026, SOURCE_DOCS, LOAN_TXNS, PM_ROWS, BANK_TXNS, CLOSINGS, IC_TXNS, CLOSE_TASKS, EXCEPTIONS };
export const ENT = Object.fromEntries(ENTITIES.map(e=>[e.entity_id,e]));
export const drOf = l => l.debit_amount||0;
export const crOf = l => l.credit_amount||0;
export const round2 = n => Math.round(n*100)/100;
export const fmt = n => (n<0?'(':'')+Math.abs(n).toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2})+(n<0?')':'');
