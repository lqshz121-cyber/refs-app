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
  const strictDeps={MIGRATION_DATABASE_URL:'postgresql://migrator:another-secret@db.example/refs?sslmode=verify-full',CONTEXT_ISSUER_DATABASE_URL:'postgresql://issuer:issuer-secret@db.example/refs?sslmode=verify-full',GRANT_SYNC_DATABASE_URL:'postgresql://grant-sync:grant-sync-secret@db.example/refs?sslmode=verify-full'};
  assert.throws(()=>runtimeConfig({REFS_PG_REQUIRED:'1',DATABASE_URL:'postgresql://refs:password@db.example/refs',...strictDeps}),/weak password/);
  assert.throws(()=>runtimeConfig({NODE_ENV:'production',DATABASE_URL:'postgresql://refs:strong-secret@db.example/refs',...strictDeps}),/require TLS/);
  assert.doesNotThrow(()=>runtimeConfig({NODE_ENV:'production',DATABASE_URL:'postgresql://refs:strong-secret@db.example/refs?sslmode=verify-full',...strictDeps}));
  assert.throws(()=>runtimeConfig({NODE_ENV:'production',DATABASE_URL:'postgresql://refs:strong-secret@db.example/refs?sslmode=require',MIGRATION_DATABASE_URL:'postgresql://refs:strong-secret@db.example/refs?sslmode=require',CONTEXT_ISSUER_DATABASE_URL:'postgresql://issuer:issuer-secret@db.example/refs?sslmode=verify-full',GRANT_SYNC_DATABASE_URL:'postgresql://grant-sync:grant-sync-secret@db.example/refs?sslmode=verify-full'}),/credentials must be different/);
});

test('required mode accepts documented isolated test roles while known weak defaults remain rejected',()=>{
  const required={
    REFS_PG_REQUIRED:'1',
    DATABASE_URL:'postgresql://refs_runtime:refs_runtime_test_N7v2p9Q4x6Lm@127.0.0.1:55432/refs_kernel_test',
    MIGRATION_DATABASE_URL:'postgresql://refs_migrator:refs_migrator_test_K8r3w5T1z9Hp@127.0.0.1:55432/refs_kernel_test',
    CONTEXT_ISSUER_DATABASE_URL:'postgresql://refs_context_issuer:refs_issuer_test_P6m4s8V2q7Jc@127.0.0.1:55432/refs_kernel_test',
    GRANT_SYNC_DATABASE_URL:'postgresql://refs_grant_sync:refs_grant_sync_test_R9k5d3W8y2Fn@127.0.0.1:55432/refs_kernel_test'
  };
  assert.doesNotThrow(()=>runtimeConfig(required));
  assert.throws(()=>runtimeConfig({...required,DATABASE_URL:'postgresql://refs_runtime:refs_runtime_local_only@127.0.0.1:55432/refs_kernel_test'}),/weak password/);
});

test('parsed URL isolation rejects encoded credential aliases and divergent database endpoints',()=>{
  const base={REFS_PG_REQUIRED:'1',DATABASE_URL:'postgresql://runtime:strong-runtime@localhost:55432/refs_kernel_test',MIGRATION_DATABASE_URL:'postgresql://migrator:strong-migrator@localhost:55432/refs_kernel_test',CONTEXT_ISSUER_DATABASE_URL:'postgresql://issuer:strong-issuer@localhost:55432/refs_kernel_test',GRANT_SYNC_DATABASE_URL:'postgresql://grant-sync:strong-grant-sync@localhost:55432/refs_kernel_test'};
  assert.throws(()=>runtimeConfig({...base,MIGRATION_DATABASE_URL:'postgresql://runtime:strong-runtime@localhost:55432/refs_kernel_test?application_name=migrator'}),/credentials must be different/);
  assert.throws(()=>runtimeConfig({...base,CONTEXT_ISSUER_DATABASE_URL:'postgresql://issuer:strong-issuer@localhost:55432/other_test'}),/same database endpoint/);
});

test('timeouts reject NaN, zero, negative and unsafe values',()=>{
  for(const value of ['NaN','0','-1','9007199254740992'])assert.throws(()=>runtimeConfig({REFS_PG_STATEMENT_TIMEOUT_MS:value}),/safe integer/);
  assert.throws(()=>runtimeConfig({REFS_PG_LOCK_TIMEOUT_MS:'999999'}),/safe integer/);
});
