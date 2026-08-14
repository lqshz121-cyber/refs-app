import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = file => readFileSync(new URL(file, import.meta.url), 'utf8');
const app = read('./src/app.jsx');
const authoritative = read('./src/authoritative-app.jsx');
const legacyDemo = read('./src/legacy-demo-app.jsx');
const aiAudit = read('./src/module-aiaudit.jsx');

// The AI Audit component deliberately models WBS mock rules and a browser-side
// review repository. It is valid only inside the frozen demonstration shell;
// importing it into the authoritative entry would make demo business state look
// like live accounting evidence.
assert.match(legacyDemo, /import \{ AIAudit \} from '\.\/module-aiaudit\.jsx';/,
  'the WBS mock AI Audit component must remain owned by the demonstration shell');
assert.match(aiAudit, /createWbsMockDataset|WBS mock rule engine/,
  'the component must continue to identify its mock-data contract explicitly');

for (const [name, source] of [['production entry', app], ['authoritative shell', authoritative]]) {
  assert.doesNotMatch(source, /module-aiaudit|ai-accounting\.js|wbs-accounting-foundation|createWbsMockDataset|buildWbsAccounting/,
    `${name} must not import AI mock-rule or WBS seed modules`);
  assert.doesNotMatch(source, /\brepo\.(?:load|save|audit)\b|\blocalStorage\s*[.(]/,
    `${name} must not retain browser accounting state for AI evidence`);
}

assert.match(app, /resolveRuntimeBoundary\(globalThis\)/,
  'the production entry must enforce the runtime boundary before rendering');
assert.match(app, /boundary\.surface !== SURFACE_AUTHORITATIVE/,
  'a missing or non-authoritative runtime configuration must fail closed');
assert.match(app, /<AuthoritativeApp environment=\{globalThis\}\s*\/>/,
  'only the authoritative shell may be mounted by the production entry');
assert.match(authoritative, /AuthoritativeAiAuditWorkspace/,
  'the authoritative shell may expose only the server-backed AI Audit workspace');
assert.match(authoritative, /route === 'ai-audit'/,
  'the server-backed AI Audit workspace must have a stable authoritative route');
assert.doesNotMatch(authoritative, /['"]aireview['"]|module-aiaudit|\bAIAudit\b/,
  'the authoritative AI route must not import the browser-state demonstration AI Audit component');

console.log('authoritative-ai-boundary: AI mock/review UI remains demonstration-only; production mounts no browser-state AI evidence.');
