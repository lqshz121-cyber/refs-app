// R07: snapshot the live function catalog as a hash manifest.
//
// db/FUNCTION-CATALOG.json records, for every function and procedure in `public` at the manifest
// head, its signature and the sha256 of pg_get_functiondef(). catalog-patch-drift-postgres compares a
// freshly migrated database against this file. The point: an in-place amendment lives only in the
// catalog, so a later whole-function CREATE OR REPLACE that silently reverts it changes exactly one
// hash here -- and this file cannot change without a reviewer seeing which function moved and why.
//
// Regenerate deliberately, on a fresh fully migrated database, after any migration that touches a
// function:   npm run db:function-catalog
import {writeFileSync} from 'node:fs';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {createPool} from './db.mjs';
import {runtimeConfig} from './config.mjs';
import {MIGRATION_MANIFEST} from './migration-manifest.mjs';

export const FUNCTION_CATALOG_SCHEMA='REFS_FUNCTION_CATALOG_V1';
export const FUNCTION_CATALOG_PATH=new URL('../db/FUNCTION-CATALOG.json',import.meta.url);

export const LIVE_CATALOG_SQL=`
  SELECT p.oid::regprocedure::text AS signature,
         p.prokind::text AS kind,
         encode(sha256(convert_to(pg_get_functiondef(p.oid),'UTF8')),'hex') AS sha256
  FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
  WHERE n.nspname='public' AND p.prokind IN ('f','p')
  ORDER BY 1`;

export async function readPostgresMajor(pool){
  return Number((await pool.query("SELECT current_setting('server_version_num')::int/10000 AS major")).rows[0].major);
}

export async function readLiveFunctionCatalog(pool){
  const rows=(await pool.query(LIVE_CATALOG_SQL)).rows;
  return rows.map(r=>({signature:r.signature.replace(/^public\./,''),kind:r.kind,sha256:r.sha256}));
}

export function buildCatalogDocument(functions,{ledgerHead,postgresMajor}){
  return {
    schema_version:FUNCTION_CATALOG_SCHEMA,
    // pg_get_functiondef output is stable within a major version; the gate that checks this file
    // (core-gates) runs on this major. Other majors compare anyway but name the mismatch first.
    postgres_major:postgresMajor,
    migration_head:ledgerHead,
    manifest_head:MIGRATION_MANIFEST[MIGRATION_MANIFEST.length-1].name,
    function_count:functions.length,
    functions:functions.map(f=>({signature:f.signature,kind:f.kind,sha256:f.sha256})).sort((a,b)=>a.signature<b.signature?-1:1),
  };
}

export async function exportFunctionCatalog({env=process.env,out=FUNCTION_CATALOG_PATH}={}){
  const pool=await createPool({databaseUrl:runtimeConfig(env).migrationDatabaseUrl,applicationName:'refs-function-catalog',max:1});
  try{
    const ledger=(await pool.query('SELECT count(*)::int AS rows, max(migration_name) AS head FROM refs_schema_migration')).rows[0];
    if(ledger.rows!==MIGRATION_MANIFEST.length||ledger.head!==MIGRATION_MANIFEST[MIGRATION_MANIFEST.length-1].name){
      throw Object.assign(new Error(`database is at ${ledger.rows}/${ledger.head}, manifest is ${MIGRATION_MANIFEST.length}/${MIGRATION_MANIFEST[MIGRATION_MANIFEST.length-1].name}; run db:up on a fresh database first`),{code:'FUNCTION_CATALOG_LEDGER_MISMATCH'});
    }
    const postgresMajor=await readPostgresMajor(pool);
    const doc=buildCatalogDocument(await readLiveFunctionCatalog(pool),{ledgerHead:ledger.head,postgresMajor});
    writeFileSync(out,`${JSON.stringify(doc,null,2)}\n`);
    return doc;
  }finally{await pool.end();}
}

if(import.meta.url===pathToFileURL(process.argv[1]||'').href){
  exportFunctionCatalog().then(doc=>{
    console.log(JSON.stringify({event:'function_catalog_exported',path:fileURLToPath(FUNCTION_CATALOG_PATH),function_count:doc.function_count,migration_head:doc.migration_head}));
  }).catch(error=>{console.error(JSON.stringify({event:'function_catalog_export_failed',code:error.code||null,message:error.message}));process.exit(1);});
}
