import test from 'node:test';
import assert from 'node:assert/strict';
import {createAuthoritativeReadGuard} from '../src/authoritative-read-guard.js';

const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return {promise, resolve}; };
test('a delayed company A response cannot overwrite company B after a scope change', async () => {
  const guard = createAuthoritativeReadGuard();
  const slow = deferred();
  let visible = null;
  const currentA = guard.begin();
  const pending = slow.promise.then(value => { if (currentA()) visible = value; });
  guard.invalidate();
  const currentB = guard.begin();
  if (currentB()) visible = 'company B';
  slow.resolve('company A');
  await pending;
  assert.equal(visible, 'company B');
});
test('the latest same-company refresh wins, and sign-out revokes pending success or failure', async () => {
  const guard = createAuthoritativeReadGuard();
  const old = guard.begin();
  const latest = guard.begin();
  assert.equal(old(), false);
  assert.equal(latest(), true);
  guard.invalidate();
  assert.equal(latest(), false);
  const signedBackIn = guard.begin();
  assert.equal(signedBackIn(), true);
  assert.equal(old(), false);
});
test('a workflow drill does not cancel a separate loading screen, but switching company cancels both', () => {
  const guard = createAuthoritativeReadGuard();
  const refresh = guard.begin();
  const drill = guard.begin('draft');
  assert.equal(refresh(), true);
  assert.equal(drill(), true);
  guard.invalidate();
  assert.equal(refresh(), false);
  assert.equal(drill(), false);
});
test('an old component callback invoked after company change cannot start a read or cancel the new company request', () => {
  const guard = createAuthoritativeReadGuard();
  const companyA = guard.capture();
  let calls = 0;
  const lateCallback = () => {
    const current = guard.begin('draft', companyA);
    if (!current()) return;
    calls += 1;
  };
  guard.invalidate();
  const companyB = guard.capture();
  const active = guard.begin('draft', companyB);
  lateCallback();
  assert.equal(calls, 0);
  assert.equal(active(), true);
  guard.invalidate();
  assert.equal(guard.begin('draft', companyB)(), false, 'sign-out revokes retained callbacks too');
});
