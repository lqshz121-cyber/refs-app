const required = [
  'DATABASE_URL','MIGRATION_DATABASE_URL','CONTEXT_ISSUER_DATABASE_URL','GRANT_SYNC_DATABASE_URL',
  'OIDC_ISSUER','OIDC_AUDIENCE','OIDC_JWKS_URI','REFS_HTTP_ALLOWED_ORIGINS',
  'S3_ENDPOINT','S3_BUCKET','S3_REGION','S3_ACCESS_KEY_ID','S3_SECRET_ACCESS_KEY',
  'VIRUS_SCANNER_ENDPOINT','VIRUS_SCANNER_TOKEN','VIRUS_SCANNER_CA_FILE','VIRUS_SCANNER_SERVER_NAME',
  'ATTACHMENT_SCANNER_ACTOR_ID','ATTACHMENT_CLEANUP_ACTOR_ID','ATTACHMENT_CLEANUP_SCOPES',
  'WBS_SNAPSHOT_ED25519_PUBLIC_KEYS','REFS_STAGING_API_BASE_URL','REFS_STAGING_WEB_ORIGIN'
];
const missing = required.filter(key => !process.env[key]?.trim());
if (missing.length) {
  console.error(`staging-env: missing ${missing.join(', ')}`);
  process.exit(1);
}
for (const key of ['REFS_STAGING_API_BASE_URL','REFS_STAGING_WEB_ORIGIN','OIDC_ISSUER','OIDC_JWKS_URI','S3_ENDPOINT','VIRUS_SCANNER_ENDPOINT']) {
  if (!process.env[key].startsWith('https://')) throw new Error(`staging-env: ${key} must be HTTPS`);
}
console.log(`staging-env: ${required.length}/${required.length} required variables present`);
