import { mkdirSync, writeFileSync } from 'node:fs';
import { generateKeyPairSync, sign } from 'node:crypto';
import { dirname, resolve } from 'node:path';

const outRoot = resolve('outputs/local-release-simulation');
const writeText = (path, text) => {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, text, 'utf8');
};
const writeJson = (path, value) => writeText(path, `${JSON.stringify(value, null, 2)}\n`);

const webOrigin = 'https://local.refs.example.test';
const apiBaseUrl = 'https://api.local.refs.example.test';
const s3Endpoint = 'https://s3.local.refs.example.test';
const s3Bucket = 'local-simulation-bucket';
const s3Region = 'us-east-1';
const scannerEndpoint = 'https://scanner.local.refs.example.test';
const scannerServerName = 'scanner.local.refs.example.test';
const scannerCaFile = resolve(outRoot, 'scanner-ca.pem');
const objectKey = 'simulation/clean-document.pdf';
const objectVersion = 'local-version-0001';
const objectContentHash = `sha256:${'3'.repeat(64)}`;
const pages = ['Dashboard', 'Reports', 'Reconcile', 'BankTx', 'Expenses', 'Accounting', 'Rule Center', 'Integration Hub'];

const pageEvidence = {};
for (const page of pages) {
  const slug = page.toLowerCase().replaceAll(' ', '-');
  const visibleText = resolve(outRoot, 'ui', `${slug}.txt`);
  const screenshot = resolve(outRoot, 'ui', `${slug}.png`);
  writeText(visibleText, [
    `REFS ${page}`,
    'Mode: LOCAL_SIMULATION',
    'Authenticated staging substitute evidence only.',
    'No external provider, production OIDC, or WBS data was used.',
  ].join('\n'));
  writeFileSync(screenshot, Buffer.from(`LOCAL_SIMULATION_SCREENSHOT:${page}\n`, 'utf8'));
  pageEvidence[page] = { webOrigin, apiBaseUrl, authenticated: true, visibleText, screenshot };
}

writeJson(resolve(outRoot, 'ui-manifest.json'), {
  mode: 'LOCAL_SIMULATION',
  warning: 'This verifies release harness wiring only. It is not production/live evidence.',
  authenticated: true,
  webOrigin,
  apiBaseUrl,
  oidc: {
    issuer: 'https://oidc.local.refs.example.test',
    audience: 'refs-accounting-api',
    subject: 'local-simulation-controller',
    token_refresh_verified: true,
  },
  apiSmoke: {
    baseUrl: apiBaseUrl,
    authenticated_status: 200,
    anonymous_rejection_status: 401,
  },
  pages: pageEvidence,
});

writeJson(resolve(outRoot, 's3-scanner-receipt.json'), {
  mode: 'LOCAL_SIMULATION',
  warning: 'This verifies release harness wiring only. It is not provider-backed S3/scanner evidence.',
  ok: true,
  endpoint: s3Endpoint,
  bucket: s3Bucket,
  region: s3Region,
  object_key: objectKey,
  object_version: objectVersion,
  content_hash: objectContentHash,
  head_versioned: {
    object_key: objectKey,
    object_version: objectVersion,
    content_hash: objectContentHash,
    size_bytes: 31,
  },
  scanner: {
    endpoint: scannerEndpoint,
    server_name: scannerServerName,
    engine: 'local-simulation-scanner',
    scanned_object_key: objectKey,
    scanned_object_version: objectVersion,
    result: 'CLEAN',
  },
  delete: {
    object_key: objectKey,
    object_version: objectVersion,
    delete_marker_removed: true,
  },
  delete_verified: {
    object_key: objectKey,
    remaining_versions: 0,
    remaining_delete_markers: 0,
    object_lock_retention_blocked: false,
  },
  steps: ['upload', 'scan_clean', 'head_versioned', 'delete', 'delete_verified'],
});

const { privateKey: wbsPrivateKey, publicKey: wbsPublicKey } = generateKeyPairSync('ed25519');
const wbsKeyId = 'local-sim-key-1';
const wbsPackageHash = `sha256:${'2'.repeat(64)}`;
const wbsSignature = sign(null, Buffer.from(wbsPackageHash, 'utf8'), wbsPrivateKey).toString('base64');

writeJson(resolve(outRoot, 'wbs-public-keys.json'), {
  mode: 'LOCAL_SIMULATION',
  publicKeys: {
    [wbsKeyId]: wbsPublicKey.export({ type: 'spki', format: 'pem' }),
  },
});

writeJson(resolve(outRoot, 'wbs-signed-receipt.json'), {
  mode: 'LOCAL_SIMULATION',
  warning: 'This verifies release harness wiring only. It is not a live WBS signed receipt.',
  nonempty: true,
  issuer: 'wbs-local-simulation',
  kid: wbsKeyId,
  algorithm: 'Ed25519',
  response_sha256: '0'.repeat(64),
  request_sha256: '1'.repeat(64),
  package_hash: wbsPackageHash,
  detached_signature: {
    key_id: wbsKeyId,
    algorithm: 'Ed25519',
    value: wbsSignature,
  },
  nonce: 'local-simulation-nonce',
  signed_at: '2026-08-05T00:00:00.000Z',
  expires_at: '2026-08-06T00:00:00.000Z',
  tenant_id: 'tenant-local-simulation',
  entity_id: 'entity-local-simulation',
  company_code: 'WBSIM',
  immutable_version: 'local-simulation-v1',
  payload_summary: {
    type: 'AutoRec Detail',
    rows: 1,
    amount: '123.45',
  },
});

writeJson(resolve(outRoot, 'env.json'), {
  REFS_STAGING_WEB_ORIGIN: webOrigin,
  REFS_STAGING_API_BASE_URL: apiBaseUrl,
  REFS_UI_E2E_MANIFEST: resolve(outRoot, 'ui-manifest.json'),
  S3_ENDPOINT: s3Endpoint,
  S3_BUCKET: s3Bucket,
  S3_REGION: s3Region,
  VIRUS_SCANNER_ENDPOINT: scannerEndpoint,
  VIRUS_SCANNER_CA_FILE: scannerCaFile,
  VIRUS_SCANNER_SERVER_NAME: scannerServerName,
  REFS_S3_SCANNER_LIFECYCLE_RECEIPT: resolve(outRoot, 's3-scanner-receipt.json'),
  WBS_SNAPSHOT_ED25519_PUBLIC_KEYS: resolve(outRoot, 'wbs-public-keys.json'),
  REFS_WBS_SIGNED_RECEIPT_FILE: resolve(outRoot, 'wbs-signed-receipt.json'),
});

writeText(scannerCaFile, 'LOCAL SIMULATION CA PLACEHOLDER\n');

console.log(`local-release-simulation: wrote artifacts to ${outRoot}`);
