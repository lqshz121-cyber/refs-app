import {mkdir,writeFile} from 'node:fs/promises';
import {dirname,resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {createPool,KernelError} from './db.mjs';
import {readDatabaseDictionary,renderDatabaseDictionaryMarkdown} from './database-dictionary.mjs';

const SAFE_SCHEMA=new Set(['public']);

function fail(code,message){throw new KernelError(code,message);}

export function databaseDictionaryOptions(argv=[],env=process.env){
  let output=null,markdown=null,schema='public';
  for(let index=0;index<argv.length;index+=1){
    const value=argv[index];
    if(value==='--out-json')output=argv[++index]||null;
    else if(value==='--out-markdown')markdown=argv[++index]||null;
    else if(value==='--schema')schema=argv[++index]||null;
    else fail('DATABASE_DICTIONARY_ARGUMENT_INVALID','Only --out-json, --out-markdown, and --schema are supported');
  }
  if(!output)fail('DATABASE_DICTIONARY_OUTPUT_REQUIRED','--out-json is required');
  if(!SAFE_SCHEMA.has(schema))fail('DATABASE_DICTIONARY_SCHEMA_INVALID','Only the public schema is permitted');
  if(typeof env.REFS_DATABASE_DICTIONARY_DATABASE_URL!=='string'||!env.REFS_DATABASE_DICTIONARY_DATABASE_URL.trim())fail('DATABASE_DICTIONARY_URL_REQUIRED','A dedicated database dictionary URL is required');
  if(['DATABASE_URL','MIGRATION_DATABASE_URL','CONTEXT_ISSUER_DATABASE_URL','GRANT_SYNC_DATABASE_URL'].some(name=>env[name]===env.REFS_DATABASE_DICTIONARY_DATABASE_URL))fail('DATABASE_DICTIONARY_URL_REUSED','The dictionary URL must not reuse a runtime or privileged database URL');
  let url;
  try{url=new URL(env.REFS_DATABASE_DICTIONARY_DATABASE_URL);}catch{fail('DATABASE_DICTIONARY_URL_INVALID','The database dictionary URL is invalid');}
  if(!['postgres:','postgresql:'].includes(url.protocol)||!url.username||!url.password||!url.pathname||url.pathname==='/')fail('DATABASE_DICTIONARY_URL_INVALID','The database dictionary URL is invalid');
  if(!/^refs_dictionary_reader$/i.test(decodeURIComponent(url.username)))fail('DATABASE_DICTIONARY_READER_ROLE_REQUIRED','The database dictionary URL must use the dedicated reader role');
  return {databaseUrl:url.toString(),output:resolve(output),markdown:markdown?resolve(markdown):null,schema};
}

export function safeDatabaseDictionaryErrorCode(error){
  return error instanceof KernelError&&/^DATABASE_DICTIONARY_[A-Z_]+$/.test(error.code)?error.code:'DATABASE_DICTIONARY_EXPORT_FAILED';
}

export async function exportDatabaseDictionary({argv=process.argv.slice(2),env=process.env,poolFactory=createPool,writer=writeFile,mkdirp=mkdir,clock=()=>new Date()}={}){
  const options=databaseDictionaryOptions(argv,env);
  const pool=await poolFactory({databaseUrl:options.databaseUrl,applicationName:'refs-database-dictionary-export',max:1,statementTimeoutMs:30000,lockTimeoutMs:5000});
  try{
    const dictionary=await readDatabaseDictionary({pool,schema:options.schema,clock});
    await mkdirp(dirname(options.output),{recursive:true});
    await writer(options.output,JSON.stringify(dictionary,null,2)+'\n',{encoding:'utf8',mode:0o600});
    if(options.markdown){
      await mkdirp(dirname(options.markdown),{recursive:true});
      await writer(options.markdown,renderDatabaseDictionaryMarkdown(dictionary),{encoding:'utf8',mode:0o600});
    }
    return {event:'database_dictionary_exported',catalog_sha256:dictionary.catalog_sha256,migration_manifest_sha256:dictionary.migration_manifest.sha256};
  }finally{await pool.end();}
}

if(import.meta.url===pathToFileURL(process.argv[1]||'').href){
  exportDatabaseDictionary().then(event=>console.log(JSON.stringify(event))).catch(error=>{console.error(JSON.stringify({event:'database_dictionary_export_failed',code:safeDatabaseDictionaryErrorCode(error)}));process.exitCode=1;});
}
