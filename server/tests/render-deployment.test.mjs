import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {dirname,resolve} from 'node:path';

const root=resolve(dirname(fileURLToPath(import.meta.url)),'..','..');

test('Render staging manifest declares every production startup secret and uses locked frontend installs',async()=>{
  const manifest=await readFile(resolve(root,'render.yaml'),'utf8');
  for(const key of ['DATABASE_URL','MIGRATION_DATABASE_URL','CONTEXT_ISSUER_DATABASE_URL','GRANT_SYNC_DATABASE_URL','OIDC_ISSUER','OIDC_AUDIENCE','OIDC_JWKS_URI','REFS_HTTP_ALLOWED_ORIGINS','S3_ENDPOINT','S3_BUCKET','S3_REGION','S3_ACCESS_KEY_ID','S3_SECRET_ACCESS_KEY','VIRUS_SCANNER_ENDPOINT','VIRUS_SCANNER_TOKEN','VIRUS_SCANNER_CA_FILE','VIRUS_SCANNER_SERVER_NAME','ATTACHMENT_SCANNER_ACTOR_ID','WBS_SNAPSHOT_ED25519_PUBLIC_KEYS'])assert.match(manifest,new RegExp(`- key: ${key}\\r?\\n\\s+sync: false`));
  for(const key of ['REFS_PUBLIC_ACCOUNTING_API_BASE_URL','REFS_PUBLIC_ENTITY_ID','REFS_PUBLIC_PERIOD_ID','REFS_PUBLIC_CASH_ACCOUNT_CODE','REFS_PUBLIC_OIDC_ISSUER','REFS_PUBLIC_OIDC_AUTHORIZATION_ENDPOINT','REFS_PUBLIC_OIDC_TOKEN_ENDPOINT','REFS_PUBLIC_OIDC_REDIRECT_URI','REFS_PUBLIC_OIDC_CLIENT_ID','REFS_PUBLIC_OIDC_AUDIENCE'])assert.match(manifest,new RegExp(`- key: ${key}\\r?\\n\\s+sync: false`));
  assert.match(manifest,/buildCommand: npm ci && npm run build/);
  assert.doesNotMatch(manifest,/buildCommand: npm install && npm run build/);
  assert.equal((manifest.match(/autoDeployTrigger: off/g)||[]).length,3,'API, worker, and static client require one explicit coordinated release');
  const pages=await readFile(resolve(root,'.github','workflows','deploy.yml'),'utf8');
  assert.match(pages,/run: npm ci/);assert.doesNotMatch(pages,/run: npm install/);
  assert.match(pages,/name: Run frontend gate\r?\n\s+run: npm test/);
  assert.match(pages,/name: Run kernel static and unit gate\r?\n\s+working-directory: server\r?\n\s+run: npm test/);
  assert.match(manifest,/name: Content-Security-Policy\r?\n\s+value: "default-src 'self'; base-uri 'self'; object-src 'none'; frame-ancestors 'self'; script-src 'self' https:\/\/cdnjs\.cloudflare\.com;/);
  assert.doesNotMatch(manifest,/script-src 'self' 'unsafe-inline'/);
});
