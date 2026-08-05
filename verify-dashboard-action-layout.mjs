import { readFileSync } from 'node:fs';

const html = readFileSync(new URL('./index.html', import.meta.url), 'utf8');
const dashboard = readFileSync(new URL('./src/modules-core.jsx', import.meta.url), 'utf8');

const checks = [
  ['dashboard exposes one action group', /className="qbo-home-actions"/],
  ['action group uses a stable two-column grid', /\.qbo-home-actions\{[^}]*display:grid;[^}]*grid-template-columns:repeat\(2,minmax\(0,1fr\)\)/],
  ['action buttons fill their grid cells', /\.qbo-home-actions \.btn\{[^}]*width:100%;[^}]*justify-content:center/],
  ['third action spans the full second row', /\.qbo-home-actions \.btn:last-child\{[^}]*grid-column:1\/-1/],
  ['small screens collapse actions to one column', /@media\(max-width:600px\)[\s\S]*?\.qbo-home-actions\{grid-template-columns:1fr;\}/],
];

for (const [name, pattern] of checks) {
  const source = name === 'dashboard exposes one action group' ? dashboard : html;
  if (!pattern.test(source)) throw new Error(`Dashboard action layout check failed: ${name}`);
}

const labels = ['Create journal entry', 'Open reports', 'See all activity'];
for (const label of labels) {
  if (!dashboard.includes(`>${label}</Btn>`)) throw new Error(`Missing dashboard action: ${label}`);
}

console.log('dashboard action layout verifier: PASS');
