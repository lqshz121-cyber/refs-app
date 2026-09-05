// ---------------------------------------------------------------------------
// Mutation harness for the ledger audit gate.
//
// A check nobody has broken on purpose is not a check. For every rule in
// audit.js this harness:
//
//   1. runs the REAL gate (the same audit.cjs `npm run test:audit` runs) with
//      one defect injected into a copy of the ledger, and requires the run to
//      exit non-zero AND to name the rule under test;
//   2. runs the same gate with the injection removed, and requires exit 0.
//
// It reuses the gate binary rather than re-implementing the rules, so the
// harness cannot drift away from what the gate actually does.
//
//   node tools/analysis/audit-mutation-harness.mjs
//   node tools/analysis/audit-mutation-harness.mjs loan-draw-as-cost
// ---------------------------------------------------------------------------
import { spawnSync } from 'node:child_process';
import { buildSync } from 'esbuild';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const bundle = path.join(root, 'audit.cjs');
// npm may install the CLI entry as JavaScript or as a native executable.
// The public API resolves the correct platform binary without guessing its format.
buildSync({absWorkingDir: root, entryPoints: ['./audit.js'], bundle: true,
  platform: 'node', format: 'cjs', jsx: 'automatic',
  loader: {'.js': 'jsx', '.jsx': 'jsx'}, outfile: bundle});

const run = (inject) => {
  const env = {...process.env};
  if (inject) env.REFS_AUDIT_INJECT = inject; else delete env.REFS_AUDIT_INJECT;
  const r = spawnSync(process.execPath, [bundle], {cwd: root, env, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024});
  const all = `${r.stdout || ''}${r.stderr || ''}`;
  const header = (r.stdout || '').split('\n').find((l) => l.startsWith('audit entities=')) || '';
  const fired = ((r.stdout || '').split('\n').find((l) => l.startsWith('audit-rules-fired')) || '').replace('audit-rules-fired ', '');
  return {status: r.status, all, header, fired, stderr: r.stderr || ''};
};

const catalogue = JSON.parse(run('--list').all.slice(run('--list').all.indexOf('[')));
const only = process.argv.slice(2);
const cases = only.length ? catalogue.filter((c) => only.includes(c.name)) : catalogue;
if (!cases.length) { console.error(`no such injection: ${only.join(', ')}`); process.exit(2); }

console.log('== BASELINE: the shipped seed, no injection ==');
const baseline = run(null);
console.log(`  ${baseline.header}`);
console.log(`  exit=${baseline.status}`);
const baselineOk = baseline.status === 0 && / fails=0/.test(baseline.header);
if (!baselineOk) console.log('  BASELINE IS NOT CLEAN - every "removed -> exit 0" below is reported against this state.');

const rows = [];
let broken = 0;
for (const c of cases) {
  const mutated = run(c.name);
  const named = new RegExp(`\\b${c.rule}\\b`).test(mutated.all);
  const detectedLine = /detected=true/.test(mutated.all);
  const ok = mutated.status !== 0 && named && detectedLine;
  if (!ok) broken += 1;
  rows.push({name: c.name, rule: c.rule, ok, status: mutated.status, named, fired: mutated.fired,
    evidence: (mutated.stderr.split('\n').find((l) => l.includes(c.rule)) || '').trim()});
}

console.log('');
console.log('== MUTATION RESULTS ==');
for (const r of rows) {
  console.log(`${r.ok ? 'PASS' : 'BROKEN'}  ${r.rule.padEnd(12)} ${r.name}`);
  console.log(`        injected -> exit=${r.status}, rule named=${r.named}`);
  if (r.evidence) console.log(`        ${r.evidence.slice(0, 240)}`);
}

console.log('');
console.log('== REMOVED: same gate, injection removed ==');
const clean = run(null);
console.log(`  ${clean.header}`);
console.log(`  exit=${clean.status}`);

console.log('');
console.log(`mutation-harness cases=${rows.length} proved=${rows.length - broken} broken=${broken} baseline_clean=${baselineOk}`);
if (broken || !baselineOk) process.exitCode = 1;
