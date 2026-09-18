// P11 — anti-drift: every SQLSTATE a migration raises must have a deliberate HTTP status.
//
// statusFor() ends in `return 500`. Any SQLSTATE that reaches it unmapped is presented to the
// caller as an internal fault, even when it is an honest refusal the caller could act on. This
// test reads the raised codes out of the migrations and the mapped codes out of the router, so a
// new RAISE EXCEPTION ... USING ERRCODE that nobody mapped fails here instead of shipping as a 500.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,readdirSync} from 'node:fs';

const root=new URL('../',import.meta.url);
const migrationDir=new URL('db/migrations/',root);
const sql=readdirSync(migrationDir).filter(f=>f.endsWith('.sql'))
  .map(f=>readFileSync(new URL(f,migrationDir),'utf8')).join('\n');
const routerSource=readFileSync(new URL('api/accounting-http.mjs',root),'utf8');
const statusFor=routerSource.slice(routerSource.indexOf('function statusFor(error)'),routerSource.indexOf('const problemFor='));

const raised=new Set([...sql.matchAll(/ERRCODE\s*=\s*'([0-9A-Z]{5})'/g)].map(m=>m[1]));
const mapped=new Set([...statusFor.matchAll(/'([0-9A-Z]{5})'/g)].map(m=>m[1]));

// The deliberate mapping, kept here so a change of mind is a visible diff rather than a silent edit.
const EXPECTED=Object.freeze({
  '22004':422, // null_value_not_allowed  - a required argument was not supplied
  '22023':422, // invalid_parameter_value - the argument is out of contract
  '23503':422, // foreign_key_violation   - the referenced master does not exist
  '23505':409, // unique_violation        - idempotency or uniqueness conflict
  '23514':422, // check_violation         - a business rule refused the command
  '40001':412, // serialization_failure   - stale revision (else 503, see isRevisionPrecondition)
  '42501':403, // insufficient_privilege  - scope or SoD denial
  '54000':422, // program_limit_exceeded  - bounded population too large to serve safely
  '55000':423, // object_not_in_prerequisite_state - closed period / append-only guard
  '55006':409, // object_in_use           - evidence held by another posting
  '0A000':422, // feature_not_supported   - path closed or must go through its aggregate
  'P0002':404  // no_data_found           - the scoped object does not exist
});

test('the migration census and the router mapping are both non-empty',()=>{
  assert.ok(raised.size>=10,`expected a real census of raised SQLSTATEs, got ${raised.size}`);
  assert.ok(mapped.size>=10,`expected a real census of mapped SQLSTATEs, got ${mapped.size}`);
});

test('every SQLSTATE raised by a migration is mapped to a deliberate HTTP status, never a fall-through 500',()=>{
  const unmapped=[...raised].filter(code=>!mapped.has(code)).sort();
  assert.deepEqual(unmapped,[],
    `these SQLSTATEs are raised by migrations but fall through statusFor() to HTTP 500: ${unmapped.join(', ')}. `+
    'Map each one in statusFor() and record it in EXPECTED here, or stop raising it.');
});

test('the mapping table and the router agree, and the table covers every raised code',()=>{
  for(const code of raised)assert.ok(code in EXPECTED,`${code} is raised by a migration but missing from EXPECTED`);
  for(const code of Object.keys(EXPECTED))assert.ok(mapped.has(code),`${code} is in EXPECTED but statusFor() does not mention it`);
});

test('the four P11 additions are present and none of them is 500',()=>{
  for(const code of ['55006','0A000','22004','54000']){
    assert.ok(mapped.has(code),`${code} must stay mapped`);
    assert.notEqual(EXPECTED[code],500,`${code} must not be presented as an internal fault`);
  }
  assert.equal(EXPECTED['55006'],409,'object_in_use is a conflict, matching the inline 409 the acquisition route already returns');
});

test('statusFor still ends in a 500 fall-through so an unknown code is never silently a 2xx',()=>{
  assert.match(statusFor,/return 500;\s*}\s*$/,'the final fall-through must remain 500');
});
