// P13 — the secret scanner must catch what it claims to catch and must not cry wolf.
// A scanner that produces noise gets switched off, so the allowlist is tested as hard as the rules.
import test from 'node:test';
import assert from 'node:assert/strict';
import {scanLines,RULES,ALLOW} from '../../tools/secret-scan.mjs';

const line=(text,path='x.mjs',lineNo=1)=>({path,lineNo,text});
const hit=(text,path,lineNo)=>scanLines([line(text,path,lineNo)]);

test('every rule fires on a representative secret',()=>{
  const samples={
    AWS_ACCESS_KEY_ID:'const id="AKIAIOSFODNN7EXAMPLE";',
    AWS_SECRET:'aws_secret_access_key = "wJalrXUtnFEMIK7MDENGbPxRfiCYzEXAMPLEKEYY"',
    PRIVATE_KEY:'-----BEGIN RSA PRIVATE KEY-----',
    GITHUB_TOKEN:'ghp_0123456789abcdefghijklmnopqrstuvwxyz',
    SLACK_TOKEN:'xoxb-123456789012-abcdefghijkl',
    JWT:'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dBjftJeZ4CVPmB92K27uhbUJU1p1r',
    BEARER:'Authorization: Bearer abcdefghijklmnopqrstuvwxyz0123',
    SET_COOKIE:'Set-Cookie: session=abcdefghijklmnopqrstuvwxyz',
    RENDER_DEPLOY_HOOK:'https://api.render.com/deploy/srv-abc123?key=zzz',
    POSTGRES_URL_WITH_PASSWORD:'postgresql://admin:hunter2@db.example.com:5432/refs',
    GENERIC_SECRET_ASSIGNMENT:'const apiKey = "abcdefghijklmnopqrstuvwxyz012345";'
  };
  for(const rule of RULES){
    assert.ok(rule.id in samples,`${rule.id} has no sample in this test`);
    const found=hit(samples[rule.id]);
    assert.ok(found.some(f=>f.rule===rule.id),`${rule.id} did not fire on its own sample: ${samples[rule.id]}`);
  }
});

test('the Render deploy hook shape is caught, because it grants deploys to anyone holding it',()=>{
  const found=hit('    url: https://api.render.com/deploy/srv-d2abcdefghij?key=Ab3xYz');
  assert.equal(found[0].rule,'RENDER_DEPLOY_HOOK');
});

test('a local fixture database URL and an evidence hash are not findings',()=>{
  assert.deepEqual(hit("databaseUrl:'postgresql://refs_runtime:refs_runtime_test_N7v2p9Q4x6Lm@127.0.0.1:55750/db'"),[]);
  assert.deepEqual(hit("const h='sha256:"+'a'.repeat(64)+"';"),[]);
  assert.deepEqual(hit("const token=process.env.OUTBOX_PUBLISH_TOKEN;"),[]);
  assert.deepEqual(hit("  - key: REFS_WBS_API_TOKEN\n    sync: false"),[]);
});

test('reading a secret from the environment is never a finding, carrying one always is',()=>{
  assert.deepEqual(hit('const password=process.env.DB_PASSWORD;'),[]);
  assert.equal(hit('const password="S3cretValueThatIsLongEnough!";').length,1);
});

test('the allowlist stays short and every entry is a regular expression',()=>{
  assert.ok(ALLOW.length<=8,'a growing allowlist is how a scanner dies; widen it deliberately');
  for(const a of ALLOW)assert.ok(a instanceof RegExp);
});

test('findings carry enough to act on and the excerpt is truncated',()=>{
  const found=hit('const apiKey = "'+'z'.repeat(200)+'";','runtime/thing.mjs',42);
  assert.equal(found.length,1);
  assert.equal(found[0].path,'runtime/thing.mjs');assert.equal(found[0].line,42);
  assert.ok(found[0].why.length>0);
  assert.ok(found[0].excerpt.length<=80,'the excerpt must not reproduce the whole secret');
});
