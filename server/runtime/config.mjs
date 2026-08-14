const localDefault='postgresql://refs_runtime:refs_runtime_test_N7v2p9Q4x6Lm@127.0.0.1:55432/refs_kernel_test';
const localMigrationDefault='postgresql://refs_migrator:refs_migrator_test_K8r3w5T1z9Hp@127.0.0.1:55432/refs_kernel_test';
const localIssuerDefault='postgresql://refs_context_issuer:refs_issuer_test_P6m4s8V2q7Jc@127.0.0.1:55432/refs_kernel_test';
const localGrantSyncDefault='postgresql://refs_grant_sync:refs_grant_sync_test_R9k5d3W8y2Fn@127.0.0.1:55432/refs_kernel_test';
const weakPasswords=new Set(['','postgres','password','refs','refs_local_only','refs_runtime_local_only','refs_migrator_local_only','refs_context_issuer_local_only','changeme']);

function positiveInteger(env,name,fallback,{min=1,max=600000}={}){
  const raw=env[name]??fallback;
  const value=Number(raw);
  if(!Number.isSafeInteger(value)||value<min||value>max)throw new Error(`${name} must be a safe integer between ${min} and ${max}`);
  return value;
}

function disabledByDefaultFeature(env,name){
  const value=String(env[name]??'DISABLED').trim().toUpperCase();
  if(!['DISABLED','ENABLED'].includes(value))throw new Error(`${name} must be ENABLED or DISABLED`);
  return value==='ENABLED';
}

function validatedUrl(raw,{strict}){
  let url;
  try{url=new URL(raw);}catch{throw new Error('DATABASE_URL must be a valid PostgreSQL URL');}
  if(!['postgres:','postgresql:'].includes(url.protocol))throw new Error('DATABASE_URL must use postgres:// or postgresql://');
  if(!url.pathname||url.pathname==='/')throw new Error('DATABASE_URL must name a database');
  if(strict&&weakPasswords.has(decodeURIComponent(url.password||'').toLowerCase()))throw new Error('DATABASE_URL uses a missing or weak password');
  const local=['127.0.0.1','localhost','::1','[::1]'].includes(url.hostname);
  const ssl=(url.searchParams.get('sslmode')||'').toLowerCase();
  if(strict&&!local&&!['require','verify-ca','verify-full'].includes(ssl))throw new Error('Remote production DATABASE_URL must require TLS');
  return url.toString();
}

export function runtimeConfig(env=process.env){
  const strict=env.NODE_ENV==='production'||env.REFS_PG_REQUIRED==='1';
  if(strict&&!env.DATABASE_URL)throw new Error('DATABASE_URL is required when PostgreSQL is required or NODE_ENV=production');
  if(strict&&!env.MIGRATION_DATABASE_URL)throw new Error('MIGRATION_DATABASE_URL is required when PostgreSQL is required or NODE_ENV=production');
  if(strict&&!env.CONTEXT_ISSUER_DATABASE_URL)throw new Error('CONTEXT_ISSUER_DATABASE_URL is required when PostgreSQL is required or NODE_ENV=production');
  if(strict&&!env.GRANT_SYNC_DATABASE_URL)throw new Error('GRANT_SYNC_DATABASE_URL is required when PostgreSQL is required or NODE_ENV=production');
  const databaseUrl=validatedUrl(env.DATABASE_URL||localDefault,{strict});
  const migrationDatabaseUrl=env.MIGRATION_DATABASE_URL?validatedUrl(env.MIGRATION_DATABASE_URL,{strict}):(strict?null:localMigrationDefault);
  const contextIssuerDatabaseUrl=env.CONTEXT_ISSUER_DATABASE_URL?validatedUrl(env.CONTEXT_ISSUER_DATABASE_URL,{strict}):(strict?null:localIssuerDefault);
  const grantSyncDatabaseUrl=env.GRANT_SYNC_DATABASE_URL?validatedUrl(env.GRANT_SYNC_DATABASE_URL,{strict}):(strict?null:localGrantSyncDefault);
  if(strict){
    const urls=[databaseUrl,migrationDatabaseUrl,contextIssuerDatabaseUrl,grantSyncDatabaseUrl].map(value=>new URL(value));
    const endpoints=urls.map(url=>`${url.hostname.toLowerCase()}:${url.port||'5432'}${url.pathname}`);
    if(new Set(endpoints).size!==1)throw new Error('Runtime, migration, and context issuer URLs must target the same database endpoint');
    const credentials=urls.map(url=>`${decodeURIComponent(url.username)}\u0000${decodeURIComponent(url.password)}`);
    if(new Set(credentials).size!==credentials.length)throw new Error('Runtime, migration, and context issuer credentials must be different');
    if(new Set(urls.map(url=>decodeURIComponent(url.username))).size!==urls.length)throw new Error('Runtime, migration, and context issuer roles must be different');
  }
  return {
    databaseUrl,
    migrationDatabaseUrl,
    contextIssuerDatabaseUrl,
    grantSyncDatabaseUrl,
    requirePostgres:strict,
    controlledDemoEnabled:disabledByDefaultFeature(env,'REFS_CONTROLLED_DEMO_MODE'),
    allowDown:env.REFS_ALLOW_DB_DOWN==='1',
    statementTimeoutMs:positiveInteger(env,'REFS_PG_STATEMENT_TIMEOUT_MS',10000,{min:100,max:600000}),
    lockTimeoutMs:positiveInteger(env,'REFS_PG_LOCK_TIMEOUT_MS',5000,{min:100,max:60000})
  };
}

export function databaseName(databaseUrl){
  const value=new URL(databaseUrl);
  return decodeURIComponent(value.pathname.replace(/^\//,''));
}
