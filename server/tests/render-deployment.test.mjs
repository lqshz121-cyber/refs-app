import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {dirname,resolve} from 'node:path';

const root=resolve(dirname(fileURLToPath(import.meta.url)),'..','..');

test('Render staging manifest declares every production startup secret and uses locked frontend installs',async()=>{
  const manifest=await readFile(resolve(root,'render.yaml'),'utf8');
  for(const key of ['DATABASE_URL','MIGRATION_DATABASE_URL','CONTEXT_ISSUER_DATABASE_URL','GRANT_SYNC_DATABASE_URL','OIDC_ISSUER','OIDC_AUDIENCE','OIDC_JWKS_URI','REFS_HTTP_ALLOWED_ORIGINS','S3_ENDPOINT','S3_BUCKET','S3_REGION','S3_ACCESS_KEY_ID','S3_SECRET_ACCESS_KEY','VIRUS_SCANNER_ENDPOINT','VIRUS_SCANNER_TOKEN','VIRUS_SCANNER_CA_FILE','VIRUS_SCANNER_SERVER_NAME','ATTACHMENT_SCANNER_ACTOR_ID','WBS_SNAPSHOT_ED25519_PUBLIC_KEYS'])assert.match(manifest,new RegExp(`- key: ${key}\\r?\\n\\s+sync: false`));
  assert.match(manifest,/buildCommand: npm ci && npm run build/);
  assert.doesNotMatch(manifest,/buildCommand: npm install && npm run build/);
});
