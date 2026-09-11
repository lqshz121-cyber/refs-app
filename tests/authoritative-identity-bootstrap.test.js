import assert from 'node:assert/strict';
import test from 'node:test';
import {bootstrapAuthoritativeIdentity} from '../src/authoritative-identity-bootstrap.js';

test('a signed-out top-level visit starts one ordinary interactive login', async () => {
  const calls = [];
  const result = await bootstrapAuthoritativeIdentity({
    completeRedirect: async () => ({ok:false,code:'OIDC_LOGIN_REQUIRED'}),
    startLogin: async (...args) => { calls.push(args); },
  });
  assert.deepEqual(result,{cancelled:false,redirectStarted:true,result:null});
  assert.deepEqual(calls,[[]],'the first login must not pass prompt=none or make a second authorization request');
});

test('callback outcomes pass through without starting another authorization request', async () => {
  const callback = {ok:true};
  let loginCalls = 0;
  const result = await bootstrapAuthoritativeIdentity({
    completeRedirect: async () => callback,
    startLogin: async () => { loginCalls += 1; },
  });
  assert.deepEqual(result,{cancelled:false,redirectStarted:false,result:callback});
  assert.equal(loginCalls,0);
});

test('an interactive redirect failure returns the original login-required result', async () => {
  const loginRequired = {ok:false,code:'OIDC_LOGIN_REQUIRED'};
  const result = await bootstrapAuthoritativeIdentity({
    completeRedirect: async () => loginRequired,
    startLogin: async () => { throw new Error('navigation refused'); },
  });
  assert.deepEqual(result,{cancelled:false,redirectStarted:false,result:loginRequired});
});

test('an effect cleaned up while redirect completion is pending cannot start login', async () => {
  let resolveRedirect;
  let active = true;
  let loginCalls = 0;
  const pending = new Promise(resolve => { resolveRedirect = resolve; });
  const bootstrapping = bootstrapAuthoritativeIdentity({
    completeRedirect: async () => pending,
    startLogin: async () => { loginCalls += 1; },
  }, () => active);
  active = false;
  resolveRedirect({ok:false,code:'OIDC_LOGIN_REQUIRED'});
  assert.deepEqual(await bootstrapping,{cancelled:true,redirectStarted:false,result:null});
  assert.equal(loginCalls,0,'a stale effect must never issue an authorization redirect');
});
