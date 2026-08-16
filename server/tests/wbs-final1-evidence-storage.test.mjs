import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {S3ImmutableEvidenceStorage} from '../runtime/attachment-storage.mjs';

const hash=body=>`sha256:${createHash('sha256').update(body).digest('hex')}`;
const ids={tenantId:'11111111-1111-4111-8111-111111111111',entityId:'22222222-2222-4222-8222-222222222222',admissionId:'33333333-3333-4333-8333-333333333333',immutableVersion:'44444444-4444-4444-8444-444444444444'};
const make=fetcher=>new S3ImmutableEvidenceStorage({endpoint:'https://s3.example.test',bucket:'refs-evidence',region:'us-east-1',accessKeyId:'test-key',secretAccessKey:'test-secret',fetcher,clock:()=>new Date('2026-08-16T00:00:00.000Z'),retentionDays:2555});

test('writes exact Final-1 bytes with versioning and COMPLIANCE retention metadata',async()=>{
  const body=Buffer.from('{"schema_version":"WBS_READONLY_SNAPSHOT_V2"}'),expectedHash=hash(body),calls=[];
  const storage=make(async(url,init)=>{calls.push({url:String(url),init});return init.method==='PUT'?new Response('',{status:200,headers:{'x-amz-version-id':'v-1',etag:'"etag-1"'}}):new Response('',{status:200,headers:{'x-amz-version-id':'v-1','x-amz-meta-sha256':expectedHash,'content-length':String(body.length),'content-type':'application/json','x-amz-object-lock-mode':'COMPLIANCE','x-amz-object-lock-retain-until-date':'2033-08-15T00:00:00.000Z'}});});
  const result=await storage.putImmutableVersion({...ids,domain:'PAYABLES',artifact:'package.json',bytes:body,expectedHash,receiptHash:'sha256:'+'a'.repeat(64)});
  assert.equal(result.storageVersion,'v-1');assert.equal(result.contentHash,expectedHash);assert.equal(result.retentionMode,'COMPLIANCE');assert.equal(result.idempotent,false);
  assert.equal(calls.length,2);assert.equal(calls[0].init.method,'PUT');assert.deepEqual(Buffer.from(calls[0].init.body),body);assert.equal(calls[1].init.method,'HEAD');
  assert.equal(calls[0].init.headers['x-amz-object-lock-mode'],'COMPLIANCE');assert.equal(calls[0].init.headers['x-amz-meta-sha256'],expectedHash);
  assert.match(calls[0].init.headers.authorization,/SignedHeaders=.*content-length.*x-amz-content-sha256/);
  assert.ok(!String(calls[0].url).includes('test-secret'));
});

test('fails before network on changed bytes and fails closed without a version id',async()=>{
  let calls=0;const storage=make(async()=>{calls++;return new Response('',{status:200});});
  await assert.rejects(()=>storage.putImmutableVersion({...ids,domain:'INSURANCE',artifact:'request.raw',bytes:Buffer.from('changed'),expectedHash:'sha256:'+'b'.repeat(64),receiptHash:'sha256:'+'a'.repeat(64)}),/bytes or hash/);
  assert.equal(calls,0);
  const body=Buffer.from('exact');
  await assert.rejects(()=>storage.putImmutableVersion({...ids,domain:'INSURANCE',artifact:'request.raw',bytes:body,expectedHash:hash(body),receiptHash:'sha256:'+'a'.repeat(64)}),error=>error.code==='WBS_EVIDENCE_STORAGE_VERSION_MISSING');
});

test('reads only the exact version and recomputes the retained hash',async()=>{
  const body=Buffer.from('retained exact bytes'),expectedHash=hash(body);
  const storage=make(async(url,init)=>{assert.equal(init.method,'GET');assert.equal(new URL(url).searchParams.get('versionId'),'v-2');return new Response(body,{status:200,headers:{'x-amz-version-id':'v-2','x-amz-meta-sha256':expectedHash,'content-length':String(body.length)}});});
  assert.deepEqual(Buffer.from(await storage.readVerifiedVersion({storageRef:'s3://refs-evidence/refs-wbs-final1/111/222/PAYABLES/333/444/package.json-a',storageVersion:'v-2',expectedHash})),body);
});

test('readiness requires both bucket versioning and Object Lock',async()=>{
  const storage=make(async url=>new URL(url).searchParams.has('versioning')?new Response('<VersioningConfiguration><Status>Enabled</Status></VersioningConfiguration>',{status:200}):new Response('<ObjectLockConfiguration><ObjectLockEnabled>Enabled</ObjectLockEnabled></ObjectLockConfiguration>',{status:200}));
  assert.equal(await storage.probeImmutable(),true);
});
