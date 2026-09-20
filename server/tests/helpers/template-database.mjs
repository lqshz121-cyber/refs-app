// Z03: replace "empty a database" with "copy a clean one".
//
// The fixture problem: `TRUNCATE tenant CASCADE` costs 5.7-9.4s on this schema and the cost tracks
// the TABLE COUNT, not the data. At 250 tables it sits at ~94% of the production 10s
// statement_timeout, and every migration that adds a table pushes it closer. X01 bought headroom by
// giving the fixture's admin pool a maintenance timeout; that is necessary but it is not a fix for
// the growth curve.
//
// Why not ordered DELETE: 184 of the 250 public tables carry a DELETE trigger -- reject_mutation()
// on append-only evidence, refs_deployment_identity_immutable, and friends. Those guards exist on
// purpose, and TRUNCATE is the fixture's way past them because TRUNCATE does not fire row triggers.
// Making DELETE work would mean disabling those triggers, i.e. weakening exactly the isolation Z03
// forbids weakening. Measured, not assumed: a plain ordered DELETE aborts on
// `Deployment identity is immutable` (42501).
//
// What this does instead: migrate ONE template database, then hand each consumer a fresh clone.
// CREATE DATABASE ... TEMPLATE is a file copy of a near-empty database, measured at 276-433ms --
// roughly 20x faster than the TRUNCATE it replaces, and its cost scales with data size rather than
// table count, so it does not degrade as the schema grows.
import pg from 'pg';
import {migrateUp} from '../../runtime/migrations.mjs';

const URL_KEYS=['DATABASE_URL','MIGRATION_DATABASE_URL','CONTEXT_ISSUER_DATABASE_URL','GRANT_SYNC_DATABASE_URL'];
const ident=name=>{
  if(!/^[a-z_][a-z0-9_]{0,62}$/.test(name))throw new Error(`unsafe database identifier: ${name}`);
  return name;
};
const withDatabase=(url,name)=>{const u=new URL(url);u.pathname=`/${name}`;return u.toString();};

// Migrate once, mark as a template, reuse for the rest of the process.
let templatePromise=null;
export function resetTemplateCache(){templatePromise=null;}

export async function ensureTemplateDatabase({env=process.env,name='refs_fixture_template'}={}){
  if(templatePromise)return templatePromise;
  templatePromise=(async()=>{
    const base=env.MIGRATION_DATABASE_URL;
    if(!base)throw new Error('ensureTemplateDatabase requires MIGRATION_DATABASE_URL');
    ident(name);
    const admin=new pg.Client({connectionString:withDatabase(base,'postgres')});
    await admin.connect();
    try{
      // A template cannot be created from a database with live connections, and cannot itself be
      // connected to while cloning, so build it fresh and leave no session behind.
      await admin.query(`ALTER DATABASE ${name} IS_TEMPLATE false`).catch(()=>{});
      await admin.query(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`);
      await admin.query(`CREATE DATABASE ${name}`);
    }finally{await admin.end().catch(()=>{});}

    // migrations.mjs:102 refuses to migrate a database whose name does not match
    // MIGRATION_DATABASE_URL (MIGRATION_DATABASE_REJECTED). That guard is correct and worth
    // keeping, so point the variable at the template for exactly as long as the migration runs.
    const savedMigrationUrl=env.MIGRATION_DATABASE_URL;
    const pool=new pg.Pool({connectionString:withDatabase(base,name),max:2,
      statement_timeout:300000,lock_timeout:60000});
    try{
      env.MIGRATION_DATABASE_URL=withDatabase(base,name);
      await pool.query('CREATE EXTENSION IF NOT EXISTS pgcrypto');
      await migrateUp(pool,{});
    }finally{
      env.MIGRATION_DATABASE_URL=savedMigrationUrl;
      await pool.end().catch(()=>{});
    }

    const mark=new pg.Client({connectionString:withDatabase(base,'postgres')});
    await mark.connect();
    try{await mark.query(`ALTER DATABASE ${name} IS_TEMPLATE true`);}
    finally{await mark.end().catch(()=>{});}
    return name;
  })().catch(error=>{templatePromise=null;throw error;});
  return templatePromise;
}

// withFreshDatabase(body) -> body({url, databaseName})
// The four role URLs are retargeted for the duration, because runtimeConfig requires all four to
// address the same database, and restored afterwards even when body throws.
export async function withFreshDatabase(body,{env=process.env,template}={}){
  const base=env.MIGRATION_DATABASE_URL;
  if(!base)throw new Error('withFreshDatabase requires MIGRATION_DATABASE_URL');
  const templateName=template??await ensureTemplateDatabase({env});
  const databaseName=ident(`refs_fx_${Date.now().toString(36)}_${Math.random().toString(36).slice(2,8)}`);
  const saved=Object.fromEntries(URL_KEYS.map(k=>[k,env[k]]));
  const admin=new pg.Client({connectionString:withDatabase(base,'postgres')});
  await admin.connect();
  try{
    await admin.query(`CREATE DATABASE ${databaseName} TEMPLATE ${templateName}`);
    for(const key of URL_KEYS){if(saved[key])env[key]=withDatabase(saved[key],databaseName);}
    return await body({url:withDatabase(base,databaseName),databaseName});
  }finally{
    for(const key of URL_KEYS){
      if(saved[key]===undefined)delete env[key];else env[key]=saved[key];
    }
    await admin.query(`DROP DATABASE IF EXISTS ${databaseName} WITH (FORCE)`).catch(()=>{});
    await admin.end().catch(()=>{});
  }
}

// The growth curve this exists to contain. A fixture that empties the schema pays per table; a
// fixture that clones pays per byte. Exposed so the regression guard can assert on it.
export async function measureTeardownStrategies({env=process.env}={}){
  const base=env.MIGRATION_DATABASE_URL;
  const pool=new pg.Pool({connectionString:base,max:2,statement_timeout:300000});
  let truncateMs=null,tableCount=null;
  try{
    tableCount=Number((await pool.query(
      `SELECT count(*)::int n FROM information_schema.tables WHERE table_schema='public' AND table_type='BASE TABLE'`)).rows[0].n);
    const started=Date.now();
    await pool.query('TRUNCATE tenant CASCADE');
    truncateMs=Date.now()-started;
  }finally{await pool.end().catch(()=>{});}

  const templateName=await ensureTemplateDatabase({env});
  const admin=new pg.Client({connectionString:withDatabase(base,'postgres')});
  await admin.connect();
  let cloneMs=null;
  try{
    const name=ident(`refs_fx_probe_${Date.now().toString(36)}`);
    const started=Date.now();
    await admin.query(`CREATE DATABASE ${name} TEMPLATE ${templateName}`);
    cloneMs=Date.now()-started;
    await admin.query(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`);
  }finally{await admin.end().catch(()=>{});}
  return {tableCount,truncateMs,cloneMs};
}
