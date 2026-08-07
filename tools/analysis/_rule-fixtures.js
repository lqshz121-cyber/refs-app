// Source rows the rule engine is exercised against. Kept separate from
// _ledger.js so the H-1 measurement never loads the generated ledger - the
// defect it measures is in the live rule path, not in the seed.
export { LOANS, PROJECTS, PROPERTIES } from '../../src/data.js';
export { PM_ROWS as PM_ROWS_SOURCE, LOAN_TXNS as LOAN_TXNS_SOURCE } from '../../src/seed.js';
