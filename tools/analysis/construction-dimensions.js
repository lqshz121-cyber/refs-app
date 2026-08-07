// H-4 measurement - do construction cost lines carry the four dimensions a
// construction invoice is required to carry: Project, Unit/WBS, Cost Code and
// Vendor?
//
// Run:
//   ./node_modules/.bin/esbuild tools/analysis/construction-dimensions.js --bundle \
//     --platform=node --format=cjs --outfile=/tmp/x.cjs && node /tmp/x.cjs
//
// The dimensions are tested on the JOURNAL LINE, not on the source document. A
// dimension that lives only on the source doc cannot be grouped, filtered or
// summed by any report built on the ledger, which is where every job-cost
// report is built.
//
// Two populations, because they are held to different rules:
//   every CWIP debit          must name a Project and a Cost Code.
//   construction invoice cost must additionally name a Unit/WBS and a Vendor.
//   land development invoice  is a parcel cost and carries no unit.
import { POSTED, SOURCE_DOCS, PROJECTS, COST_CODES, drOf, fmt } from './_ledger.js';

const c = (n) => Math.round((Number(n) || 0) * 100);
const VERTICAL_CWIP = ['164200', '164300', '164400', '164500', '164600', '164700', '164900'];
const LAND_CWIP = ['164100'];
const ALL_CWIP = [...VERTICAL_CWIP, ...LAND_CWIP];
const PROJECT_IDS = new Set(PROJECTS.map((p) => p.project_id));
const COST_CODE_SET = new Set(COST_CODES.map((x) => x.cost_code));

const out = []; const P = (s) => out.push(s);
const failures = [];

const vendorOf = (je, l) => l.vendor || l.member || je.payee || null;
const docOf = (je) => (je.source_doc_id ? SOURCE_DOCS[je.source_doc_id] : null);

const collect = (predicate) => {
  const rows = [];
  POSTED.forEach((je) => (je.lines || []).forEach((l) => { if (predicate(je, l)) rows.push({je, l}); }));
  return rows;
};

const report = (label, rows, need) => {
  const n = rows.length;
  const pct = (k) => (n ? ((k / n) * 100).toFixed(1) : '0.0');
  const has = {
    Project: rows.filter((x) => x.l.project_id != null && PROJECT_IDS.has(x.l.project_id)).length,
    'Unit/WBS': rows.filter((x) => !!x.l.unit_code).length,
    'Cost Code': rows.filter((x) => !!x.l.cost_code && COST_CODE_SET.has(x.l.cost_code)).length,
    Vendor: rows.filter((x) => !!vendorOf(x.je, x.l)).length,
  };
  const amount = rows.reduce((s, x) => s + c(drOf(x.l)), 0);
  P('');
  P(`== ${label} ==`);
  P(`  debit lines: ${n}   total ${fmt(amount / 100)}`);
  need.forEach((k) => {
    P(`    carrying ${k.padEnd(10)} on the line: ${String(has[k]).padStart(4)} (${pct(has[k])}%)`);
    if (has[k] !== n) failures.push(`${label}: ${n - has[k]} line(s) carry no ${k}`);
  });
  return rows;
};

P('== H-4 · CONSTRUCTION COST DIMENSIONS, ON THE JOURNAL LINE ==');

report('Every CWIP debit (vertical + land)',
  collect((je, l) => ALL_CWIP.includes(l.account_code) && c(drOf(l)) > 0),
  ['Project', 'Cost Code']);

report('Vertical construction invoice cost lines',
  collect((je, l) => VERTICAL_CWIP.includes(l.account_code) && c(drOf(l)) > 0
    && (je.rule_code === 'R-WBS-INV-01' || (docOf(je) || {}).type === 'CONSTRUCTION_INVOICE')),
  ['Project', 'Unit/WBS', 'Cost Code', 'Vendor']);

report('Land development invoice cost lines',
  collect((je, l) => LAND_CWIP.includes(l.account_code) && c(drOf(l)) > 0
    && (je.rule_code === 'R-WBS-INV-02' || (docOf(je) || {}).type === 'LAND_DEVELOPMENT_INVOICE')),
  ['Project', 'Cost Code', 'Vendor']);

// Whole-ledger dimension coverage.
let costCodeLines = 0, projectLines = 0, unitLines = 0, totalLines = 0;
POSTED.forEach((je) => (je.lines || []).forEach((l) => {
  totalLines++;
  if (l.cost_code) costCodeLines++;
  if (l.project_id != null) projectLines++;
  if (l.unit_code) unitLines++;
}));
P('');
P('== WHOLE LEDGER ==');
P(`  posted journal lines:           ${totalLines}`);
P(`  carrying line-level cost_code:  ${costCodeLines}`);
P(`  carrying line-level project_id: ${projectLines}`);
P(`  carrying line-level unit_code:  ${unitLines}`);

// The audit gate's own rules, evaluated here independently of audit.js.
P('');
P('== WHAT THE AUDIT GATE WOULD SEE ==');
const conOldShape = collect((je, l) => VERTICAL_CWIP.includes(l.account_code) && c(drOf(l)) > 0 && !l.unit_code && l.project_id == null).length;
const conNewShape = collect((je, l) => ALL_CWIP.includes(l.account_code) && c(drOf(l)) > 0 && l.project_id == null).length;
P(`  AUD-CON-001 as originally written (no unit AND no project): ${conOldShape} line(s)`);
P(`  AUD-CON-001 as strengthened       (no project):             ${conNewShape} line(s)`);
P('  The original shape accepted a line that named a unit and nothing else, which is why');
P('  462 construction cost lines with 0% project and 0% cost code passed a gate that had a rule for them.');

const invoiceDocs = Object.values(SOURCE_DOCS).filter((d) => d.type === 'CONSTRUCTION_INVOICE' || d.type === 'LAND_DEVELOPMENT_INVOICE');
const incomplete = invoiceDocs.filter((d) => !d.vendor || !d.cost_code || !d.project_id || (d.type === 'CONSTRUCTION_INVOICE' && !d.unit) || (!d.po_no && !d.contract));
P('');
P(`  construction / land invoice source documents: ${invoiceDocs.length}, incomplete: ${incomplete.length}`);

P('');
P(`construction-dimensions: ledger_lines=${totalLines} line_cost_code=${costCodeLines} line_project=${projectLines} `
  + `aud_con_001_new=${conNewShape} failures=${failures.length}`);
console.log(out.join('\n'));
if (failures.length) { failures.forEach((f) => console.error('FAIL', f)); process.exitCode = 1; }
