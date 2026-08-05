import { existsSync, readFileSync } from 'node:fs';
import { createPublicKey, verify } from 'node:crypto';
import { resolve } from 'node:path';

const forbidden = /[\p{Script=Han}\uFFFD\u0080-\u009F]/u;
const pages = ['Dashboard', 'Reports', 'Reconcile', 'BankTx', 'Expenses', 'Accounting', 'Rule Center', 'Integration Hub'];

const fail = (code, detail) => {
  console.error(`${code}: ${detail}`);
  process.exitCode = 2;
  return false;
};
const requireEnv = (environment, names) => {
  const missing = names.filter(name => !String(environment[name] || '').trim());
  return missing.length ? fail('RELEASE_GATE_CONFIG_MISSING', missing.join(',')) : true;
};
const jsonFile = (path, label) => {
  if (!existsSync(path)) return fail('RELEASE_GATE_EVIDENCE_MISSING', `${label}=${path}`);
  try { return JSON.parse(readFileSync(path, 'utf8')); }
  catch { return fail('RELEASE_GATE_EVIDENCE_INVALID', `${label} is not JSON`); }
};
const normalizeWbsPublicKeys = value => {
  const raw = value?.publicKeys || value?.public_keys || value;
  const entries = Array.isArray(raw?.keys)
    ? raw.keys.map(row => [row.kid || row.key_id, row.public_key || row.publicKey])
    : Object.entries(raw || {});
  const keys = new Map();
  for (const [keyId, pem] of entries) {
    if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(String(keyId || ''))) return null;
    if (typeof pem !== 'string' || pem.trim().length < 64) return null;
    let key;
    try { key = createPublicKey(pem.replace(/\\n/g, '\n')); } catch { return null; }
    if (key.asymmetricKeyType !== 'ed25519') return null;
    keys.set(keyId, key);
  }
  return keys.size ? keys : null;
};

export function verifyUiEvidence(environment = process.env) {
  if (!requireEnv(environment, ['REFS_STAGING_WEB_ORIGIN', 'REFS_STAGING_API_BASE_URL', 'REFS_UI_E2E_MANIFEST'])) return false;
  const manifest = jsonFile(resolve(environment.REFS_UI_E2E_MANIFEST), 'REFS_UI_E2E_MANIFEST');
  if (!manifest) return false;
  if (manifest.webOrigin !== environment.REFS_STAGING_WEB_ORIGIN || manifest.apiBaseUrl !== environment.REFS_STAGING_API_BASE_URL) return fail('RELEASE_UI_ORIGIN_MISMATCH', 'manifest origin does not match configured staging endpoints');
  const oidc = manifest.oidc || {};
  if (manifest.authenticated !== true || !oidc.issuer || !oidc.audience || !oidc.subject || oidc.token_refresh_verified !== true) return fail('RELEASE_UI_OIDC_EVIDENCE_INCOMPLETE', 'authenticated OIDC session and token refresh evidence are required');
  const apiSmoke = manifest.apiSmoke || {};
  if (apiSmoke.baseUrl !== environment.REFS_STAGING_API_BASE_URL || apiSmoke.authenticated_status !== 200 || apiSmoke.anonymous_rejection_status !== 401) return fail('RELEASE_UI_API_SMOKE_INCOMPLETE', 'authenticated API and anonymous rejection evidence are required');
  for (const page of pages) {
    const row = manifest.pages?.[page];
    if (!row || row.webOrigin !== environment.REFS_STAGING_WEB_ORIGIN || row.apiBaseUrl !== environment.REFS_STAGING_API_BASE_URL || row.authenticated !== true || !existsSync(row.screenshot) || !existsSync(row.visibleText)) return fail('RELEASE_UI_E2E_INCOMPLETE', page);
    if (forbidden.test(readFileSync(row.visibleText, 'utf8'))) return fail('RELEASE_UI_VISIBLE_TEXT_INVALID', page);
  }
  console.log(`release-ui-e2e: ${pages.length}/8 evidence artifacts verified`);
  return true;
}

export function verifyS3ScannerEvidence(environment = process.env) {
  if (!requireEnv(environment, ['S3_ENDPOINT', 'S3_BUCKET', 'S3_REGION', 'VIRUS_SCANNER_ENDPOINT', 'VIRUS_SCANNER_CA_FILE', 'VIRUS_SCANNER_SERVER_NAME', 'REFS_S3_SCANNER_LIFECYCLE_RECEIPT'])) return false;
  const receipt = jsonFile(resolve(environment.REFS_S3_SCANNER_LIFECYCLE_RECEIPT), 'REFS_S3_SCANNER_LIFECYCLE_RECEIPT');
  if (!receipt) return false;
  const required = ['upload', 'scan_clean', 'head_versioned', 'delete', 'delete_verified'];
  if (!required.every(step => receipt.steps?.includes(step)) || receipt.ok !== true) return fail('RELEASE_S3_SCANNER_LIFECYCLE_INCOMPLETE', required.join(','));
  console.log('release-s3-scanner: lifecycle receipt verified');
  return true;
}

export function verifyWbsReceiptEvidence(environment = process.env) {
  if (!requireEnv(environment, ['WBS_SNAPSHOT_ED25519_PUBLIC_KEYS', 'REFS_WBS_SIGNED_RECEIPT_FILE'])) return false;
  const keyring = jsonFile(resolve(environment.WBS_SNAPSHOT_ED25519_PUBLIC_KEYS), 'WBS_SNAPSHOT_ED25519_PUBLIC_KEYS');
  if (!keyring) return false;
  const keys = normalizeWbsPublicKeys(keyring);
  if (!keys) return fail('RELEASE_WBS_KEYRING_INVALID', 'expected pinned Ed25519 public keys');
  const receipt = jsonFile(resolve(environment.REFS_WBS_SIGNED_RECEIPT_FILE), 'REFS_WBS_SIGNED_RECEIPT_FILE');
  if (!receipt) return false;
  const required = ['issuer', 'kid', 'algorithm', 'response_sha256', 'request_sha256', 'package_hash', 'nonce', 'signed_at', 'expires_at', 'tenant_id', 'entity_id', 'company_code', 'immutable_version'];
  if (!required.every(field => String(receipt[field] || '').trim()) || receipt.nonempty !== true) return fail('RELEASE_WBS_RECEIPT_INCOMPLETE', required.join(','));
  const signature = receipt.detached_signature;
  if (!signature || signature.key_id !== receipt.kid || signature.algorithm !== 'Ed25519' || typeof signature.value !== 'string') return fail('RELEASE_WBS_RECEIPT_SIGNATURE_MISSING', receipt.kid || 'unknown');
  const publicKey = keys.get(signature.key_id);
  if (!publicKey) return fail('RELEASE_WBS_RECEIPT_KEY_UNKNOWN', signature.key_id);
  let verified = false;
  try { verified = verify(null, Buffer.from(receipt.package_hash, 'utf8'), publicKey, Buffer.from(signature.value, 'base64')); } catch {}
  if (!verified) return fail('RELEASE_WBS_RECEIPT_SIGNATURE_INVALID', signature.key_id);
  console.log('release-wbs-receipt: signed nonempty receipt evidence verified');
  return true;
}

export function verifyAllExternalReleaseEvidence(environment = process.env) {
  const checks = [
    ['ui', verifyUiEvidence],
    ['s3', verifyS3ScannerEvidence],
    ['wbs', verifyWbsReceiptEvidence],
  ];
  let ok = true;
  for (const [, runner] of checks) {
    ok = runner(environment) && ok;
  }
  if (ok) console.log(`external-release-gate: ${checks.length}/3 provider evidence gates verified`);
  return ok;
}

if (import.meta.url === `file:///${process.argv[1]?.replaceAll('\\', '/')}`) {
  const gate = process.argv[2];
  const runner = { ui: verifyUiEvidence, s3: verifyS3ScannerEvidence, wbs: verifyWbsReceiptEvidence, all: verifyAllExternalReleaseEvidence }[gate];
  if (!runner) fail('RELEASE_GATE_ARGUMENT_INVALID', 'use ui, s3, wbs, or all');
  else if (!runner()) process.exitCode ||= 1;
}
