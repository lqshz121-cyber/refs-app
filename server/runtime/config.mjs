const localDefault='postgresql://refs_runtime:refs_runtime_local_only@127.0.0.1:55432/refs_kernel_test';
const localMigrationDefault='postgresql://refs_migrator:refs_migrator_local_only@127.0.0.1:55432/refs_kernel_test';
const localIssuerDefault='postgresql://refs_context_issuer:refs_context_issuer_local_only@127.0.0.1:55432/refs_kernel_test';
const weakPasswords=new Set(['','postgres','password','refs','refs_local_only','refs_runtime_local_only','refs_migrator_local_only','refs_context_issuer_local_only','changeme']);

function positiveInteger(env,name,fallback,{min=1,max=600000}={}){
  const raw=env[name]??fallback;
  const value=Number(raw);
  if(!Number.isSafeInteger(value)||value<min||value>max)throw new Error(`${name} must be a safe integer between ${min} and ${max}`);
  return value;
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
  if(strict&&env.MIGRATION_DATABASE_URL&&env.MIGRATION_DATABASE_URL===env.DATABASE_URL)throw new Error('Runtime and migration database credentials must be different');
  if(strict&&[env.DATABASE_URL,env.MIGRATION_DATABASE_URL].includes(env.CONTEXT_ISSUER_DATABASE_URL))throw new Error('Context issuer credentials must be isolated from runtime and migration credentials');
  return {
    databaseUrl:validatedUrl(env.DATABASE_URL||localDefault,{strict}),
    migrationDatabaseUrl:env.MIGRATION_DATABASE_URL?validatedUrl(env.MIGRATION_DATABASE_URL,{strict}):(strict?null:localMigrationDefault),
    contextIssuerDatabaseUrl:env.CONTEXT_ISSUER_DATABASE_URL?validatedUrl(env.CONTEXT_ISSUER_DATABASE_URL,{strict}):(strict?null:localIssuerDefault),
    requirePostgres:strict,
    allowDown:env.REFS_ALLOW_DB_DOWN==='1',
    statementTimeoutMs:positiveInteger(env,'REFS_PG_STATEMENT_TIMEOUT_MS',10000,{min:100,max:600000}),
    lockTimeoutMs:positiveInteger(env,'REFS_PG_LOCK_TIMEOUT_MS',5000,{min:100,max:60000})
  };
}

export function databaseName(databaseUrl){
  const value=new URL(databaseUrl);
  return decodeURIComponent(value.pathname.replace(/^\//,''));
}
