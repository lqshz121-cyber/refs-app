import test from 'node:test';
import assert from 'node:assert/strict';
import {MIGRATION_MANIFEST} from '../runtime/migration-manifest.mjs';
import {readDatabaseDictionary,renderDatabaseDictionaryMarkdown} from '../runtime/database-dictionary.mjs';
import {databaseDictionaryOptions,exportDatabaseDictionary,safeDatabaseDictionaryErrorCode} from '../runtime/export-database-dictionary.mjs';

function pool({mismatch=false}={}){
  const queries=[];
  const client={
    async query(sql,args){
      queries.push({sql,args});
      if(sql.startsWith('BEGIN')||sql==='COMMIT'||sql==='ROLLBACK')return {rows:[]};
      if(sql.startsWith('SELECT current_database'))return {rows:[{database_name:'refs_kernel',server_version_num:'160001'}]};
      if(sql.startsWith('SELECT migration_name'))return {rows:MIGRATION_MANIFEST.map(({name,up},index)=>({migration_name:name,checksum:mismatch&&index===0?'0'.repeat(64):up}))};
      if(sql.includes('FROM pg_class c JOIN pg_namespace')&&sql.includes('obj_description'))return {rows:[{object_name:'journal_entry',object_kind:'r',comment:'Journal entries',row_level_security:true,force_row_level_security:false}]};
      if(sql.includes('FROM pg_attribute'))return {rows:[{table_name:'journal_entry',column_name:'memo',data_type:'text',not_null:false,default_expression:"'token=not-safe'::text",comment:'API token=not-safe'}]};
      if(sql.includes('FROM pg_constraint'))return {rows:[{table_name:'journal_entry',constraint_name:'journal_entry_pkey',constraint_type:'p'}]};
      if(sql.includes('FROM pg_indexes'))return {rows:[{table_name:'journal_entry',index_name:'journal_entry_pkey'}]};
      if(sql.includes('FROM pg_proc'))return {rows:[{function_name:'post_journal',argument_count:'1',result_type:'jsonb',language:'plpgsql',security_definer:true,volatility:'v',comment:'Posts an approved entry'}]};
      if(sql.includes('FROM pg_trigger'))return {rows:[{table_name:'journal_entry',trigger_name:'journal_guard',enabled:'O',trigger_type:'5'}]};
      if(sql.includes('FROM pg_policies'))return {rows:[{table_name:'journal_entry',policy_name:'tenant_scope',permissive:'PERMISSIVE',roles:'{refs_app}',cmd:'ALL'}]};
      throw Error(`Unexpected query: ${sql}`);
    },
    release(){queries.push({sql:'RELEASE'});}
  };
  return {queries,async connect(){return client;}};
}

test('database dictionary is snapshot-read-only, manifest-bound, and omits function source',async()=>{
  const target=pool();
  const dictionary=await readDatabaseDictionary({pool:target,clock:()=>new Date('2026-09-13T00:00:00.000Z')});
  assert.equal(target.queries[0].sql,'BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
  assert.equal(target.queries.at(-2).sql,'COMMIT');
  assert.equal(target.queries.at(-1).sql,'RELEASE');
  assert.equal(dictionary.migration_manifest.applied_count,MIGRATION_MANIFEST.length);
  assert.match(dictionary.migration_manifest.sha256,/^[a-f0-9]{64}$/);
  assert.match(dictionary.catalog_sha256,/^[a-f0-9]{64}$/);
  assert.equal(dictionary.catalog.functions[0].function_name,'post_journal');
  assert.equal(dictionary.catalog.columns[0].comment,'API [REDACTED]');
  assert.equal(dictionary.catalog.columns[0].default_expression,"'[REDACTED]");
  assert.ok(!target.queries.some(({sql})=>/pg_get_functiondef|pg_get_function_identity_arguments|pg_get_constraintdef|pg_get_triggerdef|\b(?:INSERT|UPDATE|DELETE)\b/i.test(sql)));
  assert.ok(target.queries.filter(({args})=>args).every(({args})=>args[0]==='public'));
  assert.match(renderDatabaseDictionaryMarkdown(dictionary),/Catalog SHA-256/);
});

test('database dictionary fails closed when migration history differs',async()=>{
  const target=pool({mismatch:true});
  await assert.rejects(readDatabaseDictionary({pool:target}),{code:'DATABASE_DICTIONARY_MIGRATION_MISMATCH'});
  assert.ok(target.queries.some(({sql})=>sql==='ROLLBACK'));
  assert.equal(target.queries.at(-1).sql,'RELEASE');
});

test('dictionary CLI requires a distinct dedicated reader and emits only safe evidence',async()=>{
  const url='postgresql://refs_dictionary_reader:strong-password@db.example/refs?sslmode=require';
  const env={REFS_DATABASE_DICTIONARY_DATABASE_URL:url,DATABASE_URL:'postgresql://refs_app:other@db.example/refs?sslmode=require'};
  const options=databaseDictionaryOptions(['--out-json','outputs/dictionary.json','--out-markdown','outputs/dictionary.md'],env);
  assert.equal(options.schema,'public');
  assert.equal(options.databaseUrl,url);
  assert.throws(()=>databaseDictionaryOptions(['--out-json','out.json'],{}),{code:'DATABASE_DICTIONARY_URL_REQUIRED'});
  assert.throws(()=>databaseDictionaryOptions(['--out-json','out.json'],{REFS_DATABASE_DICTIONARY_DATABASE_URL:env.DATABASE_URL,DATABASE_URL:env.DATABASE_URL}),{code:'DATABASE_DICTIONARY_URL_REUSED'});
  assert.throws(()=>databaseDictionaryOptions(['--out-json','out.json'],{REFS_DATABASE_DICTIONARY_DATABASE_URL:'postgresql://refs_app:secret@db.example/refs?sslmode=require'}),{code:'DATABASE_DICTIONARY_READER_ROLE_REQUIRED'});
  const writes=[],directories=[],target=pool();
  const event=await exportDatabaseDictionary({argv:['--out-json','outputs/dictionary.json'],env,poolFactory:async options=>{assert.equal(options.applicationName,'refs-database-dictionary-export');assert.equal(options.max,1);assert.equal(options.statementTimeoutMs,30000);return {...target,end:async()=>{}};},writer:async(path,value,options)=>writes.push({path,value,options}),mkdirp:async(path,options)=>directories.push({path,options}),clock:()=>new Date('2026-09-13T00:00:00.000Z')});
  assert.equal(event.event,'database_dictionary_exported');
  assert.equal(writes.length,1);assert.equal(directories.length,1);
  assert.doesNotMatch(JSON.stringify(writes),/strong-password|db\.example/);
  assert.equal(safeDatabaseDictionaryErrorCode(new Error('postgresql://secret')),'DATABASE_DICTIONARY_EXPORT_FAILED');
});
