// R30/L15: the GO/NO-GO generator must default to NO-GO and only say GO when every
// P0 row is LIVE_VERIFIED with no GAP/BLOCKED/PARTIAL rows and all documents exist.
import test from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {writeFileSync,mkdtempSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
const run=(matrix)=>{const d=mkdtempSync(join(tmpdir(),'gng-'));const p=join(d,'m.md');writeFileSync(p,matrix);let out,code=0;try{out=execFileSync(process.execPath,[new URL('../tools/go-no-go-report.mjs',import.meta.url).pathname,p,'--json'],{encoding:'utf8'});}catch(e){out=e.stdout;code=e.status;}return {code,report:JSON.parse(out)};};
const head='| ID | Requirement | Code | Test / Doc | SHA | Offline read-back | Live read-back | Status | Owner |\n|---|---|---|---|---|---|---|---|---|\n';
test('the real matrix currently yields NO-GO with named blockers (production is not approved)',()=>{
  const {code,report}=(()=>{let out,code=0;try{out=execFileSync(process.execPath,[new URL('../tools/go-no-go-report.mjs',import.meta.url).pathname,new URL('../ACCEPTANCE-TRACEABILITY-MATRIX.md',import.meta.url).pathname,'--json'],{encoding:'utf8'});}catch(e){out=e.stdout;code=e.status;}return {code,report:JSON.parse(out)};})();
  assert.equal(report.decision,'NO-GO');assert.equal(code,3);assert.ok(report.blockers.length>0);
});
test('a P0 row without LIVE_VERIFIED is a blocker; GAP/BLOCKED rows are blockers; DONE without Owner tick is a blocker',()=>{
  const m=head+'| A1 | migrations | x | y | z | pass | not run | EVIDENCED | ☐ |\n| B5 | grant | x | y | z | pass | LIVE_VERIFIED: ok | GAP — revoke | ☐ |\n| C7 | trace | x | y | z | pass | LIVE_VERIFIED: ok | DONE | ☐ |\n';
  const {report}=run(m);assert.equal(report.decision,'NO-GO');
  assert.ok(report.blockers.some(b=>b.startsWith('A1 no live read-back')));assert.ok(report.blockers.some(b=>b.startsWith('B5 GAP')));assert.ok(report.blockers.some(b=>b.includes('C7 marked DONE without Owner tick')));
});
test('an empty or missing matrix is NO-GO, never GO',()=>{const {report}=run('');assert.equal(report.decision,'NO-GO');});
