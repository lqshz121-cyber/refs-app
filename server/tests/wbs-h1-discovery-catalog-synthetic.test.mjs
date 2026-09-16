// Exercises the frozen-workbench parser with a SYNTHETIC artifact so the test
// gate no longer depends on outputs/wbs-h1-2026/qbo-company-workbench.html,
// which is gitignored and carries real WBS aggregates (row counts, debit/credit
// sums, monthly balances per company) that must not enter the repository.
//
// What is still proven: payload extraction from the `const DATA=` marker with
// nested braces and quoted braces, exact-count and no-duplicate rules, and the
// hash pin - one appended byte fails. What is deliberately NOT proven here: the
// reviewed production hash itself. That check stays where it belongs, in the
// provisioner's runtime preflight (main()), which refuses to touch the database
// unless the real artifact matches EXPECTED_SHA256.
import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFrozenWbsH1DiscoveryCatalog} from '../tools/provision-wbs-h1-discovery-companies.mjs';
import {WBS_H1_DISCOVERY_COMPANY_CODES} from '../tools/wbs-h1-discovery-company-codes.mjs';

const sha=s=>createHash('sha256').update(s,'utf8').digest('hex');
// Shape of the real workbench, contents fabricated: codes are placeholders,
// every figure is zero, and a decoy object with braces inside strings precedes
// the payload to make sure extraction is brace-aware.
const synthetic=codes=>`<!doctype html><html><body><script>
const DECOY={label:"not } the { payload"};
const DATA={"generated_at":"1970-01-01T00:00:00Z","companies":[${codes.map(c=>`{"company_code":"${c}","accounting_rows":0,"ap_rows":0,"ar_rows":0,"note":"{braces} in \\"strings\\" are fine"}`).join(',')}],"monthly":[]};
</script></body></html>`;
const codes=Array.from({length:192},(_,i)=>`ZZ${String(i).padStart(3,'0')}`);

test('extracts exactly the roster from a synthetic workbench when hash and count match',()=>{
  const html=synthetic(codes);
  const rows=readFrozenWbsH1DiscoveryCatalog(html,{expected:{sha256:sha(html),companyCount:192}});
  assert.equal(rows.length,192);
  assert.deepEqual(rows.map(r=>r.company_code),codes);
  assert.ok(rows.every(r=>r.company_name===`WBS ${r.company_code}`));
  assert.ok(Object.isFrozen(rows));
});

test('one appended byte fails the hash pin before any parsing happens',()=>{
  const html=synthetic(codes);
  assert.throws(()=>readFrozenWbsH1DiscoveryCatalog(`${html}\n`,{expected:{sha256:sha(html),companyCount:192}}),/hash does not match/);
});

test('count and duplicate rules fail closed on a synthetic payload',()=>{
  const short=synthetic(codes.slice(0,191));
  assert.throws(()=>readFrozenWbsH1DiscoveryCatalog(short,{expected:{sha256:sha(short),companyCount:192}}),/exactly 192 companies/);
  const dup=synthetic([...codes.slice(0,191),'ZZ000']);
  assert.throws(()=>readFrozenWbsH1DiscoveryCatalog(dup,{expected:{sha256:sha(dup),companyCount:192}}),/repeats a company code/);
});

test('production defaults are untouched: without `expected` only the reviewed hash is accepted, and a synthetic artifact is refused',()=>{
  const html=synthetic(codes);
  assert.throws(()=>readFrozenWbsH1DiscoveryCatalog(html),/hash does not match/);
  assert.throws(()=>readFrozenWbsH1DiscoveryCatalog(html,{expected:{sha256:'nothex',companyCount:192}}),/expectation is malformed/);
});

test('the committed roster is the governance artifact: 192 unique codes, contains WBPA, and its hash is stable',()=>{
  assert.equal(WBS_H1_DISCOVERY_COMPANY_CODES.length,192);
  assert.equal(new Set(WBS_H1_DISCOVERY_COMPANY_CODES).size,192);
  assert.ok(WBS_H1_DISCOVERY_COMPANY_CODES.includes('WBPA'));
  assert.equal(sha(JSON.stringify(WBS_H1_DISCOVERY_COMPANY_CODES)),'e5218ab029f4f094b39e7fc24c557fa5f23a7df850e6b25bf1cb2e760243f8a0','roster hash must equal the provisioner EXPECTED_ROSTER_SHA256');
});
