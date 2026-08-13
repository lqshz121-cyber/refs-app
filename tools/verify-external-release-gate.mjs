import { existsSync, readFileSync } from 'node:fs';
import { createHash, createPublicKey, verify } from 'node:crypto';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { canonicalWbsLiveReceiptSigningPayload, isWbsLiveReceiptTimeWindowValid } from '../server/runtime/wbs-live-receipt-signing.mjs';

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
const hash = value => `sha256:${createHash('sha256').update(value).digest('hex')}`;

// Backwards-compatible export for the release-simulation harness.  The shared
// runtime helper prevents this release gate and server acceptance from drifting.
export const canonicalWbsReceiptSigningPayload = canonicalWbsLiveReceiptSigningPayload;

const normalizePinnedWbsProviderTrust = value => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const issuer = String(value.issuer || '').trim();
  const keyId = String(value.key_id || value.kid || '').trim();
  const pem = value.public_key || value.publicKey;
  if (!issuer || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(keyId)) return null;
  if (typeof pem !== 'string' || pem.trim().length < 64) return null;
  let publicKey;
  try { publicKey = createPublicKey(pem.replace(/\\n/g, '\n')); } catch { return null; }
  if (publicKey.asymmetricKeyType !== 'ed25519') return null;
  return Object.freeze({ issuer, keyId, publicKey });
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
  if (!requireEnv(environment, ['S3_ENDPOINT', 'S3_BUCKET', 'S3_REGION', 'VIRUS_SCANNER_ENDPOINT', 'VIRUS_SCANNER_SERVER_NAME', 'REFS_S3_SCANNER_LIFECYCLE_RECEIPT'])) return false;
  if (!String(environment.VIRUS_SCANNER_CA_PEM || environment.VIRUS_SCANNER_CA_FILE || '').trim()) return fail('RELEASE_GATE_CONFIG_MISSING', 'VIRUS_SCANNER_CA_PEM or VIRUS_SCANNER_CA_FILE');
  const receipt = jsonFile(resolve(environment.REFS_S3_SCANNER_LIFECYCLE_RECEIPT), 'REFS_S3_SCANNER_LIFECYCLE_RECEIPT');
  if (!receipt) return false;
  const required = ['upload', 'scan_clean', 'head_versioned', 'delete', 'delete_verified'];
  if (!required.every(step => receipt.steps?.includes(step)) || receipt.ok !== true) return fail('RELEASE_S3_SCANNER_LIFECYCLE_INCOMPLETE', required.join(','));
  if (receipt.endpoint !== environment.S3_ENDPOINT || receipt.bucket !== environment.S3_BUCKET || receipt.region !== environment.S3_REGION) return fail('RELEASE_S3_SCANNER_SCOPE_MISMATCH', 'receipt S3 endpoint, bucket, or region does not match configured release environment');
  const objectKey = String(receipt.object_key || '');
  const objectVersion = String(receipt.object_version || '');
  if (!objectKey || !objectVersion || receipt.head_versioned?.object_key !== objectKey || receipt.head_versioned?.object_version !== objectVersion) return fail('RELEASE_S3_SCANNER_VERSION_MISMATCH', 'versioned HEAD evidence must bind to the uploaded object version');
  const scanner = receipt.scanner || {};
  if (scanner.endpoint !== environment.VIRUS_SCANNER_ENDPOINT || scanner.server_name !== environment.VIRUS_SCANNER_SERVER_NAME || scanner.scanned_object_key !== objectKey || scanner.scanned_object_version !== objectVersion || scanner.result !== 'CLEAN') return fail('RELEASE_S3_SCANNER_VERSION_MISMATCH', 'scanner must prove CLEAN result for the uploaded object version');
  const deletion = receipt.delete || {};
  if (deletion.object_key !== objectKey || deletion.object_version !== objectVersion || deletion.delete_marker_removed !== true) return fail('RELEASE_S3_SCANNER_DELETE_INCOMPLETE', 'delete proof must remove the exact object version and delete marker');
  const verified = receipt.delete_verified || {};
  if (verified.object_key !== objectKey || verified.remaining_versions !== 0 || verified.remaining_delete_markers !== 0 || verified.object_lock_retention_blocked !== false) return fail('RELEASE_S3_SCANNER_DELETE_INCOMPLETE', 'delete verification must prove zero remaining versions and delete markers');
  console.log('release-s3-scanner: lifecycle receipt verified');
  return true;
}

export function verifyWbsReceiptEvidence(environment = process.env) {
  // Trust is deployment configuration, deliberately separate from the provider
  // evidence and from the runtime keyring used by inbound services.  A receipt
  // must never be allowed to bring the key that verifies it.
  if (!requireEnv(environment, [
    'REFS_WBS_PROVIDER_TRUST_FILE', 'REFS_WBS_SIGNED_RECEIPT_FILE',
    'REFS_WBS_REQUEST_RAW_FILE', 'REFS_WBS_RESPONSE_RAW_FILE', 'REFS_WBS_PACKAGE_RAW_FILE',
  ])) return false;
  const providerTrust = jsonFile(resolve(environment.REFS_WBS_PROVIDER_TRUST_FILE), 'REFS_WBS_PROVIDER_TRUST_FILE');
  if (!providerTrust) return false;
  const pin = normalizePinnedWbsProviderTrust(providerTrust);
  if (!pin) return fail('RELEASE_WBS_PROVIDER_TRUST_INVALID', 'expected one pinned Ed25519 provider issuer and key');
  const receipt = jsonFile(resolve(environment.REFS_WBS_SIGNED_RECEIPT_FILE), 'REFS_WBS_SIGNED_RECEIPT_FILE');
  if (!receipt) return false;
  const required = ['issuer', 'kid', 'algorithm', 'response_sha256', 'request_sha256', 'package_hash', 'nonce', 'signed_at', 'expires_at', 'tenant_id', 'entity_id', 'company_code', 'immutable_version'];
  if (!required.every(field => String(receipt[field] || '').trim()) || receipt.nonempty !== true) return fail('RELEASE_WBS_RECEIPT_INCOMPLETE', required.join(','));
  if (receipt.algorithm !== 'Ed25519' || ![receipt.request_sha256, receipt.response_sha256, receipt.package_hash].every(value => /^sha256:[0-9a-f]{64}$/.test(String(value)))) return fail('RELEASE_WBS_RECEIPT_INCOMPLETE', 'canonical SHA-256 receipt hashes are required');
  if (!isWbsLiveReceiptTimeWindowValid(receipt)) return fail('RELEASE_WBS_RECEIPT_TIME_WINDOW_INVALID', 'receipt timestamps must be canonical UTC, unexpired, and within clock skew');
  if (String(receipt.issuer).trim() !== pin.issuer) return fail('RELEASE_WBS_RECEIPT_ISSUER_MISMATCH', 'receipt issuer does not match the configured provider pin');
  if (String(receipt.kid).trim() !== pin.keyId) return fail('RELEASE_WBS_RECEIPT_KEY_MISMATCH', 'receipt key id does not match the configured provider pin');
  let raw;
  try {
    raw = {
      request: readFileSync(resolve(environment.REFS_WBS_REQUEST_RAW_FILE)),
      response: readFileSync(resolve(environment.REFS_WBS_RESPONSE_RAW_FILE)),
      package: readFileSync(resolve(environment.REFS_WBS_PACKAGE_RAW_FILE)),
    };
  } catch { return fail('RELEASE_WBS_RAW_EVIDENCE_MISSING', 'canonical raw request, response, and package bytes are required'); }
  if (hash(raw.request) !== receipt.request_sha256 || hash(raw.response) !== receipt.response_sha256 || hash(raw.package) !== receipt.package_hash) return fail('RELEASE_WBS_RAW_HASH_MISMATCH', 'receipt hashes do not bind the supplied canonical raw bytes');
  const signature = receipt.detached_signature;
  if (!signature || signature.key_id !== receipt.kid || signature.algorithm !== 'Ed25519' || typeof signature.value !== 'string') return fail('RELEASE_WBS_RECEIPT_SIGNATURE_MISSING', receipt.kid || 'unknown');
  let verified = false;
  try { verified = verify(null, Buffer.from(canonicalWbsReceiptSigningPayload(receipt), 'utf8'), pin.publicKey, Buffer.from(signature.value, 'base64')); } catch {}
  if (!verified) return fail('RELEASE_WBS_RECEIPT_SIGNATURE_INVALID', signature.key_id);
  console.log('release-wbs-receipt: pinned provider receipt and canonical raw evidence verified');
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

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const gate = process.argv[2];
  const runner = { ui: verifyUiEvidence, s3: verifyS3ScannerEvidence, wbs: verifyWbsReceiptEvidence, all: verifyAllExternalReleaseEvidence }[gate];
  if (!runner) fail('RELEASE_GATE_ARGUMENT_INVALID', 'use ui, s3, wbs, or all');
  else if (!runner()) process.exitCode ||= 1;
}
