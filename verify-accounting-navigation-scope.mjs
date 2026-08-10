import { readFileSync } from 'node:fs';

const source = readFileSync('src/legacy-demo-app.jsx', 'utf8');
const dashboard = readFileSync('src/modules-core.jsx', 'utf8');
const fail = message => {
  console.error(message);
  process.exit(1);
};

if (!source.includes("const IA_HIDDEN_ROUTES = new Set(['cost','unitcost','unittransfer','loan','loanreg','pmpickup'])")) {
  fail('WBS operational routes must be hidden from the REFS accounting navigation.');
}
if (!source.includes("group:'Payables & Receivables'")) {
  fail('AP and AR must have a first-class accounting navigation group.');
}
if (!source.includes("group:'Accounting Operations'")) {
  fail('Accounting-only operational evidence must have an explicit accounting label.');
}
for (const accountingCenter of ['amortization', 'accruals']) {
  if (!new RegExp(`\\['${accountingCenter}'\\s*,\\s*'`).test(source)) fail(`Controller accounting operations must expose ${accountingCenter}.`);
}
if (/IA_HIDDEN_ROUTES[^\n]+(?:intercompany|assets)/.test(source)) {
  fail('Intercompany and Fixed Assets are accounting workspaces and must not be hidden with WBS operations.');
}
for (const forbidden of ["['Projects','cost']", "['Run PM Pickup','pmpickup']", "['Import Loan Txns','loan']"]) {
  if (dashboard.includes(forbidden)) fail(`Dashboard must not bypass hidden WBS operations: ${forbidden}`);
}

console.log('PASS: navigation exposes accounting workspaces and blocks Dashboard WBS bypasses');
