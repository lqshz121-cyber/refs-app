import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { generateKeyPairSync, sign } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { canonicalWbsReceiptSigningPayload } from './verify-external-release-gate.mjs';

const node = process.execPath;
const generator = resolve('tools/create-local-release-simulation.mjs');
const gate = resolve('tools/verify-external-release-gate.mjs');

const generated = spawnSync(node, [generator], { encoding: 'utf8' });
assert.equal(generated.status, 0, `generator failed\n${generated.stdout}\n${generated.stderr}`);

const envConfig = JSON.parse(readFileSync(resolve('outputs/local-release-simulation/env.json'), 'utf8'));
const env = { ...process.env, ...envConfig };

for (const name of ['ui', 's3', 'wbs']) {
  const result = spawnSync(node, [gate, name], { encoding: 'utf8', env });
  assert.equal(
    result.status,
    0,
    `${name} local simulation gate failed\nSTDOUT:\n${result.stdout}\nSTDERR:\n${result.stderr}`,
  );
}

const aggregate = spawnSync(node, [gate, 'all'], { encoding: 'utf8', env });
assert.equal(
  aggregate.status,
  0,
  `aggregate local simulation gate failed\nSTDOUT:\n${aggregate.stdout}\nSTDERR:\n${aggregate.stderr}`,
);
assert.match(aggregate.stdout, /external-release-gate: 3\/3 provider evidence gates verified/);

const uiManifest = JSON.parse(readFileSync(envConfig.REFS_UI_E2E_MANIFEST, 'utf8'));
assert.equal(uiManifest.mode, 'LOCAL_SIMULATION');
assert.match(uiManifest.warning, /not production\/live evidence/i);
assert.equal(uiManifest.authenticated, true);
assert.equal(uiManifest.oidc?.token_refresh_verified, true);
assert.equal(uiManifest.apiSmoke?.authenticated_status, 200);

const unauthenticatedManifest = resolve('outputs/local-release-simulation/ui-manifest-unauthenticated.json');
writeFileSync(unauthenticatedManifest, `${JSON.stringify({ ...uiManifest, authenticated: false }, null, 2)}\n`, 'utf8');
const unauthenticated = spawnSync(node, [gate, 'ui'], {
  encoding: 'utf8',
  env: { ...env, REFS_UI_E2E_MANIFEST: unauthenticatedManifest },
});
assert.equal(unauthenticated.status, 2, 'unauthenticated UI evidence must fail closed');
assert.match(`${unauthenticated.stdout}${unauthenticated.stderr}`, /RELEASE_UI_OIDC_EVIDENCE_INCOMPLETE/);

const badApiManifest = resolve('outputs/local-release-simulation/ui-manifest-bad-api.json');
writeFileSync(badApiManifest, `${JSON.stringify({ ...uiManifest, apiSmoke: { ...uiManifest.apiSmoke, anonymous_rejection_status: 200 } }, null, 2)}\n`, 'utf8');
const badApi = spawnSync(node, [gate, 'ui'], {
  encoding: 'utf8',
  env: { ...env, REFS_UI_E2E_MANIFEST: badApiManifest },
});
assert.equal(badApi.status, 2, 'UI evidence with weak API auth smoke must fail closed');
assert.match(`${badApi.stdout}${badApi.stderr}`, /RELEASE_UI_API_SMOKE_INCOMPLETE/);

const s3Receipt = JSON.parse(readFileSync(envConfig.REFS_S3_SCANNER_LIFECYCLE_RECEIPT, 'utf8'));
assert.equal(s3Receipt.mode, 'LOCAL_SIMULATION');
assert.match(s3Receipt.warning, /not provider-backed/i);
assert.equal(s3Receipt.scanner?.scanned_object_version, s3Receipt.object_version);
assert.equal(s3Receipt.delete_verified?.remaining_versions, 0);
assert.equal(s3Receipt.delete_verified?.remaining_delete_markers, 0);

const wrongScannerVersionReceipt = resolve('outputs/local-release-simulation/s3-scanner-wrong-version.json');
writeFileSync(wrongScannerVersionReceipt, `${JSON.stringify({ ...s3Receipt, scanner: { ...s3Receipt.scanner, scanned_object_version: 'wrong-version' } }, null, 2)}\n`, 'utf8');
const wrongScannerVersion = spawnSync(node, [gate, 's3'], {
  encoding: 'utf8',
  env: { ...env, REFS_S3_SCANNER_LIFECYCLE_RECEIPT: wrongScannerVersionReceipt },
});
assert.equal(wrongScannerVersion.status, 2, 'scanner evidence must bind to the exact object version');
assert.match(`${wrongScannerVersion.stdout}${wrongScannerVersion.stderr}`, /RELEASE_S3_SCANNER_VERSION_MISMATCH/);

const incompleteDeleteReceipt = resolve('outputs/local-release-simulation/s3-scanner-incomplete-delete.json');
writeFileSync(incompleteDeleteReceipt, `${JSON.stringify({ ...s3Receipt, delete_verified: { ...s3Receipt.delete_verified, remaining_versions: 1 } }, null, 2)}\n`, 'utf8');
const incompleteDelete = spawnSync(node, [gate, 's3'], {
  encoding: 'utf8',
  env: { ...env, REFS_S3_SCANNER_LIFECYCLE_RECEIPT: incompleteDeleteReceipt },
});
assert.equal(incompleteDelete.status, 2, 'delete verification must fail closed when any object version remains');
assert.match(`${incompleteDelete.stdout}${incompleteDelete.stderr}`, /RELEASE_S3_SCANNER_DELETE_INCOMPLETE/);

const wrongBucketReceipt = resolve('outputs/local-release-simulation/s3-scanner-wrong-bucket.json');
writeFileSync(wrongBucketReceipt, `${JSON.stringify({ ...s3Receipt, bucket: 'other-bucket' }, null, 2)}\n`, 'utf8');
const wrongBucket = spawnSync(node, [gate, 's3'], {
  encoding: 'utf8',
  env: { ...env, REFS_S3_SCANNER_LIFECYCLE_RECEIPT: wrongBucketReceipt },
});
assert.equal(wrongBucket.status, 2, 'S3 receipt must bind to configured endpoint, bucket, and region');
assert.match(`${wrongBucket.stdout}${wrongBucket.stderr}`, /RELEASE_S3_SCANNER_SCOPE_MISMATCH/);

const wbsReceipt = JSON.parse(readFileSync(envConfig.REFS_WBS_SIGNED_RECEIPT_FILE, 'utf8'));
assert.equal(wbsReceipt.mode, 'LOCAL_SIMULATION');
assert.match(wbsReceipt.warning, /not a live WBS signed receipt/i);
assert.equal(wbsReceipt.detached_signature?.algorithm, 'Ed25519');

const tamperedReceipt = resolve('outputs/local-release-simulation/wbs-signed-receipt-tampered.json');
writeFileSync(tamperedReceipt, `${JSON.stringify({ ...wbsReceipt, package_hash: 'sha256:'.concat('9'.repeat(64)) }, null, 2)}\n`, 'utf8');
const tampered = spawnSync(node, [gate, 'wbs'], {
  encoding: 'utf8',
  env: { ...env, REFS_WBS_SIGNED_RECEIPT_FILE: tamperedReceipt },
});
assert.equal(tampered.status, 2, 'tampered WBS receipt must fail closed');
assert.match(`${tampered.stdout}${tampered.stderr}`, /RELEASE_WBS_RAW_HASH_MISMATCH/);

const wrongIssuerReceipt = resolve('outputs/local-release-simulation/wbs-signed-receipt-wrong-issuer.json');
writeFileSync(wrongIssuerReceipt, `${JSON.stringify({ ...wbsReceipt, issuer: 'untrusted-wbs' }, null, 2)}\n`, 'utf8');
const wrongIssuer = spawnSync(node, [gate, 'wbs'], {
  encoding: 'utf8',
  env: { ...env, REFS_WBS_SIGNED_RECEIPT_FILE: wrongIssuerReceipt },
});
assert.equal(wrongIssuer.status, 2, 'receipt issuer must match the deployment-pinned provider');
assert.match(`${wrongIssuer.stdout}${wrongIssuer.stderr}`, /RELEASE_WBS_RECEIPT_ISSUER_MISMATCH/);

const wrongKidReceipt = resolve('outputs/local-release-simulation/wbs-signed-receipt-wrong-kid.json');
writeFileSync(wrongKidReceipt, `${JSON.stringify({ ...wbsReceipt, kid: 'unexpected-key', detached_signature: { ...wbsReceipt.detached_signature, key_id: 'unexpected-key' } }, null, 2)}\n`, 'utf8');
const wrongKid = spawnSync(node, [gate, 'wbs'], {
  encoding: 'utf8',
  env: { ...env, REFS_WBS_SIGNED_RECEIPT_FILE: wrongKidReceipt },
});
assert.equal(wrongKid.status, 2, 'receipt key id must match the deployment-pinned provider');
assert.match(`${wrongKid.stdout}${wrongKid.stderr}`, /RELEASE_WBS_RECEIPT_KEY_MISMATCH/);

const forgedPair = generateKeyPairSync('ed25519');
const forgedReceipt = { ...wbsReceipt, detached_signature: { ...wbsReceipt.detached_signature } };
forgedReceipt.detached_signature.value = sign(null, Buffer.from(canonicalWbsReceiptSigningPayload(forgedReceipt), 'utf8'), forgedPair.privateKey).toString('base64');
const forgedReceiptPath = resolve('outputs/local-release-simulation/wbs-signed-receipt-forged-key.json');
const callerKeyringPath = resolve('outputs/local-release-simulation/caller-supplied-keyring.json');
writeFileSync(forgedReceiptPath, `${JSON.stringify(forgedReceipt, null, 2)}\n`, 'utf8');
writeFileSync(callerKeyringPath, `${JSON.stringify({ [wbsReceipt.kid]: forgedPair.publicKey.export({ type: 'spki', format: 'pem' }) }, null, 2)}\n`, 'utf8');
const callerSuppliedKeyring = spawnSync(node, [gate, 'wbs'], {
  encoding: 'utf8',
  env: { ...env, REFS_WBS_SIGNED_RECEIPT_FILE: forgedReceiptPath, WBS_SNAPSHOT_ED25519_PUBLIC_KEYS: callerKeyringPath },
});
assert.equal(callerSuppliedKeyring.status, 2, 'a caller-supplied runtime keyring must not establish release trust');
assert.match(`${callerSuppliedKeyring.stdout}${callerSuppliedKeyring.stderr}`, /RELEASE_WBS_RECEIPT_SIGNATURE_INVALID/);

const rawMismatchPath = resolve('outputs/local-release-simulation/wbs-response-tampered.raw');
writeFileSync(rawMismatchPath, '{"response":"tampered"}\n', 'utf8');
const rawMismatch = spawnSync(node, [gate, 'wbs'], {
  encoding: 'utf8',
  env: { ...env, REFS_WBS_RESPONSE_RAW_FILE: rawMismatchPath },
});
assert.equal(rawMismatch.status, 2, 'receipt must bind its response hash to the supplied canonical raw response bytes');
assert.match(`${rawMismatch.stdout}${rawMismatch.stderr}`, /RELEASE_WBS_RAW_HASH_MISMATCH/);

console.log('local-release-simulation: ui, s3, and wbs gates pass with local simulation artifacts');
