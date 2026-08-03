import test from 'node:test';import assert from 'node:assert/strict';import {generateKeyPairSync,sign} from 'node:crypto';
import {createWbsSnapshotSignatureVerifier} from '../runtime/wbs-snapshot-signature.mjs';

test('pinned Ed25519 public key verifies only the exact WBS package hash',async()=>{
  const {privateKey,publicKey}=generateKeyPairSync('ed25519');const verifier=createWbsSnapshotSignatureVerifier({publicKeyPem:publicKey.export({type:'spki',format:'pem'})});
  const packageHash='sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
  const snapshot={package_hash:packageHash,detached_signature:{key_id:'it-wbs-2026-08',algorithm:'Ed25519',value:sign(null,Buffer.from(packageHash),privateKey).toString('base64')}};
  assert.equal(await verifier(snapshot),true);assert.equal(await verifier({...snapshot,package_hash:`${packageHash}0`}),false);assert.equal(await verifier({...snapshot,detached_signature:{...snapshot.detached_signature,algorithm:'RSA'}}),false);
});

test('invalid, short and non-Ed25519 pinned public keys fail closed',()=>{
  assert.throws(()=>createWbsSnapshotSignatureVerifier({}),/required/);
  assert.throws(()=>createWbsSnapshotSignatureVerifier({publicKeyPem:'invalid-public-key-material-that-is-not-pem-invalid-public-key-material-that-is-not-pem'}),/invalid/);
  const {publicKey}=generateKeyPairSync('rsa',{modulusLength:2048});assert.throws(()=>createWbsSnapshotSignatureVerifier({publicKeyPem:publicKey.export({type:'spki',format:'pem'})}),/Ed25519/);
});
