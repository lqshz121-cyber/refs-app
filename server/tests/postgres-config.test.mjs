import test from 'node:test';
import assert from 'node:assert/strict';
import {runtimeConfig} from '../runtime/config.mjs';

test('local discovery has an explicit test-only default',()=>{
  const config=runtimeConfig({});
  assert.match(config.databaseUrl,/refs_kernel_test/);
  assert.match(config.migrationDatabaseUrl,/refs_migrator/);
  assert.match(config.contextIssuerDatabaseUrl,/refs_context_issuer/);
  assert.equal(config.requirePostgres,false);
});

test('production and required modes require an explicit database URL',()=>{
  assert.throws(()=>runtimeConfig({NODE_ENV:'production'}),/DATABASE_URL is required/);
  assert.throws(()=>runtimeConfig({REFS_PG_REQUIRED:'1'}),/DATABASE_URL is required/);
});

test('strict mode rejects weak credentials and remote non-TLS URLs',()=>{
  const strictDeps={MIGRATION_DATABASE_URL:'postgresql://migrator:another-secret@db.example/refs?sslmode=verify-full',CONTEXT_ISSUER_DATABASE_URL:'postgresql://issuer:issuer-secret@db.example/refs?sslmode=verify-full'};
  assert.throws(()=>runtimeConfig({REFS_PG_REQUIRED:'1',DATABASE_URL:'postgresql://refs:password@db.example/refs',...strictDeps}),/weak password/);
  assert.throws(()=>runtimeConfig({NODE_ENV:'production',DATABASE_URL:'postgresql://refs:strong-secret@db.example/refs',...strictDeps}),/require TLS/);
  assert.doesNotThrow(()=>runtimeConfig({NODE_ENV:'production',DATABASE_URL:'postgresql://refs:strong-secret@db.example/refs?sslmode=verify-full',MIGRATION_DATABASE_URL:'postgresql://migrator:another-secret@db.example/refs?sslmode=verify-full',CONTEXT_ISSUER_DATABASE_URL:'postgresql://issuer:issuer-secret@db.example/refs?sslmode=verify-full'}));
  assert.throws(()=>runtimeConfig({NODE_ENV:'production',DATABASE_URL:'postgresql://refs:strong-secret@db.example/refs?sslmode=require',MIGRATION_DATABASE_URL:'postgresql://refs:strong-secret@db.example/refs?sslmode=require',CONTEXT_ISSUER_DATABASE_URL:'postgresql://issuer:issuer-secret@db.example/refs?sslmode=verify-full'}),/credentials must be different/);
});

test('timeouts reject NaN, zero, negative and unsafe values',()=>{
  for(const value of ['NaN','0','-1','9007199254740992'])assert.throws(()=>runtimeConfig({REFS_PG_STATEMENT_TIMEOUT_MS:value}),/safe integer/);
  assert.throws(()=>runtimeConfig({REFS_PG_LOCK_TIMEOUT_MS:'999999'}),/safe integer/);
});
