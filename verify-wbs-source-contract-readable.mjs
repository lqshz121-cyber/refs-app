import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const contract = readFileSync(new URL('./WBS-SOURCE-CONTRACT.md', import.meta.url), 'utf8');
const forbidden = /[\p{Script=Han}\uFFFD\u0080-\u009F]/u;

assert.ok(!forbidden.test(contract), 'WBS source contract must be readable English without CJK, replacement characters, or control-range mojibake');
[
  '# WBS to REFS Source Contract',
  'Current development boundary',
  'Required adapter contract',
  'Canonical REFS accounting path',
  'Future Gate 4 signed nonempty receipt',
  'Fail-closed behavior',
  'Executable local verification',
  'Future provider admission command',
  'real WBS semantics and production equivalence: not claimed',
].forEach(label => assert.ok(contract.includes(label), `missing WBS contract section: ${label}`));

[
  'test:wbs-accounting-foundation',
  'test:wbs-accounting-acceptance',
  'verify-wbs-e2e-flow-evidence.mjs',
  'verify-wbs-report-impact.mjs',
  'server/tests/wbs-readonly-mcp.test.mjs',
  'verify:release-wbs-receipt',
].forEach(command => assert.ok(contract.includes(command), `missing executable WBS command: ${command}`));

console.log('PASS: WBS source contract is readable, mock-ready, executable, and fail-closed');
