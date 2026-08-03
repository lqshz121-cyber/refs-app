import test from 'node:test';import assert from 'node:assert/strict';import {generateKeyPairSync,sign} from 'node:crypto';
import {createWbsSnapshotSignatureVerifier} from '../runtime/wbs-snapshot-signature.mjs';

test('pinned Ed25519 keyring verifies only the exact WBS package hash and declared key id',async()=>{
  const first=generateKeyPairSync('ed25519'),second=generateKeyPairSync('ed25519');const verifier=createWbsSnapshotSignatureVerifier({publicKeys:{'it-wbs-2026-08':first.publicKey.export({type:'spki',format:'pem'}),'it-wbs-2026-09':second.publicKey.export({type:'spki',format:'pem'})}});
  const packageHash='sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
  const snapshot={package_hash:packageHash,detached_signature:{key_id:'it-wbs-2026-08',algorithm:'Ed25519',value:sign(null,Buffer.from(packageHash),first.privateKey).toString('base64')}};
  assert.equal(await verifier(snapshot),true);assert.equal(await verifier({...snapshot,package_hash:`${packageHash}0`}),false);assert.equal(await verifier({...snapshot,detached_signature:{...snapshot.detached_signature,key_id:'it-wbs-revoked'}}),false);assert.equal(await verifier({...snapshot,detached_signature:{...snapshot.detached_signature,key_id:'it-wbs-2026-09'}}),false);assert.equal(await verifier({...snapshot,detached_signature:{...snapshot.detached_signature,algorithm:'RSA'}}),false);
});

test('invalid, empty and non-Ed25519 keyrings fail closed',()=>{
  assert.throws(()=>createWbsSnapshotSignatureVerifier({}),/keyring is required/);assert.throws(()=>createWbsSnapshotSignatureVerifier({publicKeys:{}}),/keyring is required/);
  assert.throws(()=>createWbsSnapshotSignatureVerifier({publicKeys:{'bad key':'invalid-public-key-material-that-is-not-pem-invalid-public-key-material-that-is-not-pem'}}),/key id/);
  assert.throws(()=>createWbsSnapshotSignatureVerifier({publicKeys:{'it-wbs-2026-08':'invalid-public-key-material-that-is-not-pem-invalid-public-key-material-that-is-not-pem'}}),/invalid/);
  const {publicKey}=generateKeyPairSync('rsa',{modulusLength:2048});assert.throws(()=>createWbsSnapshotSignatureVerifier({publicKeys:{'it-wbs-2026-08':publicKey.export({type:'spki',format:'pem'})}}),/Ed25519/);
});
