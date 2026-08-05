import { readFileSync } from 'node:fs';

const source = readFileSync('src/app.jsx', 'utf8');
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
if (/IA_HIDDEN_ROUTES[^\n]+(?:intercompany|assets)/.test(source)) {
  fail('Intercompany and Fixed Assets are accounting workspaces and must not be hidden with WBS operations.');
}

console.log('PASS: navigation exposes accounting workspaces and hides WBS operational modules');
