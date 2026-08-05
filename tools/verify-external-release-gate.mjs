import { existsSync, readFileSync } from 'node:fs';
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

export function verifyUiEvidence(environment = process.env) {
  if (!requireEnv(environment, ['REFS_STAGING_WEB_ORIGIN', 'REFS_STAGING_API_BASE_URL', 'REFS_UI_E2E_MANIFEST'])) return false;
  const manifest = jsonFile(resolve(environment.REFS_UI_E2E_MANIFEST), 'REFS_UI_E2E_MANIFEST');
  if (!manifest) return false;
  for (const page of pages) {
    const row = manifest.pages?.[page];
    if (!row || row.webOrigin !== environment.REFS_STAGING_WEB_ORIGIN || !existsSync(row.screenshot) || !existsSync(row.visibleText)) return fail('RELEASE_UI_E2E_INCOMPLETE', page);
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
  const receipt = jsonFile(resolve(environment.REFS_WBS_SIGNED_RECEIPT_FILE), 'REFS_WBS_SIGNED_RECEIPT_FILE');
  if (!receipt) return false;
  const required = ['issuer', 'kid', 'algorithm', 'response_sha256', 'request_sha256', 'nonce', 'signed_at', 'expires_at', 'tenant_id', 'entity_id', 'company_code', 'immutable_version'];
  if (!required.every(field => String(receipt[field] || '').trim()) || receipt.nonempty !== true) return fail('RELEASE_WBS_RECEIPT_INCOMPLETE', required.join(','));
  console.log('release-wbs-receipt: handoff evidence shape verified; server admission must be run separately');
  return true;
}

if (import.meta.url === `file:///${process.argv[1]?.replaceAll('\\', '/')}`) {
  const gate = process.argv[2];
  const runner = { ui: verifyUiEvidence, s3: verifyS3ScannerEvidence, wbs: verifyWbsReceiptEvidence }[gate];
  if (!runner) fail('RELEASE_GATE_ARGUMENT_INVALID', 'use ui, s3, or wbs');
  else if (!runner()) process.exitCode ||= 1;
}
