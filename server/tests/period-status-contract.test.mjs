// R09: static contract for accounting_period.status / SOFT_CLOSED. No database required.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,readdir} from 'node:fs/promises';
import {
  PERIOD_STATUS_VALUES,PERIOD_STATUS_WRITERS,UNREACHABLE_PERIOD_STATUSES,
  PERIOD_STATUS_OPERATION_MATRIX,SETTINGS_POLICY_EXPECTATION,
  countOpenOnlyGuards,findPeriodRowGuardsAdmittingSoftClosed,scanPeriodStatusWriters
} from '../runtime/period-status-contract.mjs';

const dir=new URL('../db/migrations/',import.meta.url);
const files=[];
for(const name of (await readdir(dir)).filter(n=>n.endsWith('.sql')).sort()){
  files.push({file:name,sql:await readFile(new URL(name,dir),'utf8')});
}

test('period_status enum still declares exactly the three documented values',()=>{
  const core=files.find(f=>f.file==='001_wbs_accounting_core.sql');
  assert.ok(core,'001_wbs_accounting_core.sql must exist');
  const match=core.sql.match(/CREATE TYPE period_status AS ENUM \(([^)]*)\)/);
  assert.ok(match,'period_status enum declaration must exist');
  const declared=[...match[1].matchAll(/'([A-Z_]+)'/g)].map(m=>m[1]);
  assert.deepEqual(declared,PERIOD_STATUS_VALUES);
});

test('no migration can persist SOFT_CLOSED: every period-status writer targets OPEN or CLOSED',()=>{
  const writers=scanPeriodStatusWriters(files);
  assert.ok(writers.length>0,'expected at least one accounting_period.status writer');
  const produced=[...new Set(writers.map(w=>w.status))].sort();
  assert.deepEqual(produced,['CLOSED','OPEN'],
    `unexpected period-status writers: ${JSON.stringify(writers)}`);
  for(const status of UNREACHABLE_PERIOD_STATUSES){
    assert.equal(writers.some(w=>w.status===status),false,
      `${status} became writable; update period-status-contract.mjs, the operation matrix and docs/PERIOD-STATUS-SOFT-CLOSED-CONTRACT.md deliberately`);
  }
  for(const [fn,statuses] of Object.entries(PERIOD_STATUS_WRITERS)){
    const seen=[...new Set(writers.filter(w=>w.fn===fn).map(w=>w.status))].sort();
    assert.deepEqual(seen,[...statuses].sort(),`writer ${fn} changed the statuses it persists`);
  }
});

test('SOFT_CLOSED is terminal: reopen only accepts a retained CLOSED period',()=>{
  const reopen=files.find(f=>f.file==='293_period_reopen_control.sql');
  assert.ok(reopen,'293_period_reopen_control.sql must exist');
  assert.match(reopen.sql,/v_period\.status<>'CLOSED'/,
    'reopen must still gate on CLOSED; if SOFT_CLOSED became reopenable the matrix is stale');
  assert.match(reopen.sql,/Only a retained CLOSED period can be reopened/);
});

test('no period-row guard admits SOFT_CLOSED as a permitted state',()=>{
  assert.deepEqual(findPeriodRowGuardsAdmittingSoftClosed(files),[]);
  const guards=countOpenOnlyGuards(files);
  assert.ok(guards.equals>100,`expected the OPEN-only guard census to stay large, saw ${guards.equals}`);
});

test('there is still no SOFT-close permission in the catalog seeds',()=>{
  const seeded=files.flatMap(f=>[...f.sql.matchAll(/'(GL\.PERIOD\.[A-Z_.]+)'/g)].map(m=>m[1]));
  const unique=[...new Set(seeded)].sort();
  assert.deepEqual(unique,['GL.PERIOD.CLOSE','GL.PERIOD.REOPEN']);
});

test('approved close policy still claims SOFT_CLOSED is a soft lock the kernel cannot produce',()=>{
  const settings=files.find(f=>f.file==='374_accounting_settings_authoritative.sql');
  assert.ok(settings,'374_accounting_settings_authoritative.sql must exist');
  assert.match(settings.sql,/period_status\}'='SOFT_CLOSED'/);
  assert.equal(SETTINGS_POLICY_EXPECTATION.SOFT_CLOSED.soft_lock,true);
  assert.equal(SETTINGS_POLICY_EXPECTATION.SOFT_CLOSED.hard_lock,false);
  assert.equal(SETTINGS_POLICY_EXPECTATION.CLOSED.hard_lock,true);
});

test('operation matrix records SOFT_CLOSED as indistinguishable from CLOSED except on reopen',()=>{
  for(const [op,row] of Object.entries(PERIOD_STATUS_OPERATION_MATRIX)){
    assert.deepEqual(Object.keys(row).sort(),[...PERIOD_STATUS_VALUES].sort(),`matrix row ${op} must cover every status`);
  }
  const posting=['GL.JE.CREATE/refs_create_manual_journal','AP.BILL.CREATE/refs_create_business_document','GL.PERIOD.CLOSE/refs_close_period_v2'];
  for(const op of posting){
    const row=PERIOD_STATUS_OPERATION_MATRIX[op];
    assert.equal(row.SOFT_CLOSED,'55000',`${op} must reject SOFT_CLOSED with 55000`);
    assert.equal(row.SOFT_CLOSED,row.CLOSED,`${op} must treat SOFT_CLOSED and CLOSED identically`);
  }
  const reopen=PERIOD_STATUS_OPERATION_MATRIX['GL.PERIOD.REOPEN/refs_reopen_period_v1'];
  assert.equal(reopen.CLOSED,null,'CLOSED must remain the only reopenable state');
  assert.equal(reopen.SOFT_CLOSED,'55000','SOFT_CLOSED must remain a dead end');
});
