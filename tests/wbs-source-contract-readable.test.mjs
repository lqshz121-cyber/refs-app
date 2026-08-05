import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('../WBS-SOURCE-CONTRACT.md', import.meta.url), 'utf8');
assert.doesNotMatch(source, /[\p{Script=Han}\uFFFD\u0080-\u009F]|\u00ef\u00bf\u00bd/u, 'contract must be English-only and free of mojibake');
for (const marker of [
  'record ID, line ID, revision, and tombstone',
  'canonical request and\n  filter context',
  'issuer, `kid`, allowed algorithm',
  'nonce or export identifier',
  'outputs/staging/wbs-receipt-admission.log',
  'zero Raw promotion',
  'PAYABLE_INCUR',
  'CONTROL_EVIDENCE_ONLY',
]) assert.ok(source.includes(marker), `missing Gate 4 contract marker: ${marker}`);
console.log('wbs-source-contract-readable: Gate 4 handoff is English-only and complete');
