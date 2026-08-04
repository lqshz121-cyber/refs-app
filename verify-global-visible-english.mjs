import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const root = new URL('.', import.meta.url).pathname.replace(/^\/(.:)/, '$1');
const read = file => readFileSync(join(root, file), 'utf8');
const sourceFiles = [];
const walk = directory => {
  for (const entry of readdirSync(join(root, directory), { withFileTypes: true })) {
    const relative = join(directory, entry.name);
    if (entry.isDirectory()) walk(relative);
    else if (/\.(?:js|jsx)$/.test(entry.name)) sourceFiles.push(relative);
  }
};
walk('src');
sourceFiles.push('index.html');

const forbidden = /[\p{Script=Han}\uFFFD\u0080-\u009F]/u;
const violations = sourceFiles.flatMap(file => {
  const lines = read(file).split(/\r?\n/);
  return lines.flatMap((line, index) => forbidden.test(line) ? [`${file}:${index + 1}`] : []);
});
assert.deepEqual(violations, [], `visible-source encoding violations:\n${violations.join('\n')}`);

assert.ok(existsSync(join(root, 'dist', 'index.html')), 'dist/index.html is missing; run npm.cmd run build first');
assert.ok(existsSync(join(root, 'dist', 'bundle.js')), 'dist/bundle.js is missing; run npm.cmd run build first');
for (const file of ['dist/index.html', 'dist/bundle.js']) {
  assert.ok(!forbidden.test(read(file)), `${file} contains a forbidden visible-text code point`);
}

const pages = [
  ['Dashboard', 'src/modules-core.jsx', 'export function Dashboard'],
  ['Rule Center', 'src/modules-more.jsx', 'Accounting Rule Center'],
  ['Integration Hub', 'src/modules-more.jsx', 'Integration Hub'],
  ['Reports', 'src/modules-more.jsx', 'Reports Center'],
  ['Expenses', 'src/module-ap.jsx', 'page-h">Expenses'],
  ['Accounting', 'src/module-coa.jsx', 'Chart of Accounts'],
  ['Reconcile', 'src/module-bankrec.jsx', 'Bank Reconciliation'],
  ['Bank Transactions', 'src/module-banktx.jsx', 'Bank transactions'],
];
for (const [name, file, contract] of pages) {
  assert.ok(read(file).includes(contract), `${name}: missing static English render contract (${contract})`);
  console.log(`PASS STATIC: ${name}`);
}
console.log('PASS STATIC: source and dist English/no-mojibake gate');
console.log('BLOCKED RUNTIME: browser/API/OIDC page E2E is not evaluated by this offline verifier.');
