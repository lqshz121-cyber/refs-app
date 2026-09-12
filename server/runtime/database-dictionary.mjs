import {createHash} from 'node:crypto';
import {KernelError} from './db.mjs';
import {MIGRATION_MANIFEST} from './migration-manifest.mjs';

const unsafeValue=/(?:postgres(?:ql)?:\/\/[^\s,;]+|(?:bearer\s+)[a-z0-9._~+\/-]+=*|-----BEGIN(?: [A-Z ]+)? PRIVATE KEY-----[\s\S]*?(?:-----END(?: [A-Z ]+)? PRIVATE KEY-----|$)|(?:password|secret|token|api[_-]?key)\s*[=:]\s*[^\s,;]+)/ig;

function stable(value){
  if(Array.isArray(value))return value.map(stable);
  if(value&&typeof value==='object')return Object.fromEntries(Object.keys(value).sort().map(key=>[key,stable(value[key])]));
  return value;
}

function digest(value){return createHash('sha256').update(JSON.stringify(stable(value))).digest('hex');}

function rows(result,code){
  if(!result||!Array.isArray(result.rows))throw new KernelError(code,'Database dictionary query did not return rows');
  return result.rows;
}

export function safeDatabaseDictionaryText(value){
  if(value===null||value===undefined)return null;
  return String(value).replace(unsafeValue,'[REDACTED]').slice(0,4000);
}

function safeRows(value){return value.map(row=>Object.fromEntries(Object.entries(row).map(([key,item])=>[key,safeDatabaseDictionaryText(item)])));}

function exactAppliedMigrations(applied){
  const expected=MIGRATION_MANIFEST.map(({name,up})=>({migration_name:name,checksum:up}));
  if(applied.length!==expected.length||applied.some((item,index)=>item.migration_name!==expected[index].migration_name||item.checksum!==expected[index].checksum)){
    throw new KernelError('DATABASE_DICTIONARY_MIGRATION_MISMATCH','The target database does not exactly match the fixed migration manifest');
  }
  return expected;
}

export function migrationManifestHash(){return digest(MIGRATION_MANIFEST.map(({name,up,down})=>({name,up,down})));}

export function renderDatabaseDictionaryMarkdown(dictionary){
  const catalog=dictionary.catalog;
  return [
    '# REFS database dictionary',
    '',
    `Generated at: ${dictionary.generated_at}`,
    `Catalog SHA-256: ${dictionary.catalog_sha256}`,
    `Migration manifest: ${dictionary.migration_manifest.applied_count}/${dictionary.migration_manifest.count} (${dictionary.migration_manifest.sha256})`,
    '',
    '## Objects',
    '',
    ...catalog.relations.map(item=>`- ${item.object_kind}: ${item.object_name}`),
    '',
    '## Columns',
    '',
    ...catalog.columns.map(item=>`- ${item.table_name}.${item.column_name}: ${item.data_type}${item.not_null==='true'?' NOT NULL':''}`),
    ''
  ].join('\n');
}

export async function readDatabaseDictionary({pool,schema='public',clock=()=>new Date()}={}){
  if(!pool||typeof pool.connect!=='function')throw new KernelError('DATABASE_DICTIONARY_POOL_REQUIRED','A PostgreSQL pool with connect() is required');
  if(typeof schema!=='string'||!schema.trim())throw new KernelError('DATABASE_DICTIONARY_SCHEMA_INVALID','A schema name is required');
  const client=await pool.connect();
  try{
    await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
    const identity=rows(await client.query("SELECT current_database() AS database_name, current_setting('server_version_num') AS server_version_num"),'DATABASE_DICTIONARY_IDENTITY_INVALID')[0];
    const applied=exactAppliedMigrations(rows(await client.query('SELECT migration_name, checksum FROM refs_schema_migration ORDER BY migration_name'),'DATABASE_DICTIONARY_MIGRATIONS_INVALID'));
    const [relations,columns,constraints,indexes,functions,triggers,policies]=await Promise.all([
      client.query("SELECT c.relname AS object_name, c.relkind AS object_kind, obj_description(c.oid, 'pg_class') AS comment, c.relrowsecurity AS row_level_security, c.relforcerowsecurity AS force_row_level_security FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname=$1 AND c.relkind IN ('r','p','v','m','S','f') ORDER BY c.relkind, c.relname",[schema]),
      client.query("SELECT c.relname AS table_name, a.attname AS column_name, format_type(a.atttypid,a.atttypmod) AS data_type, a.attnotnull AS not_null, pg_get_expr(ad.adbin,ad.adrelid) AS default_expression, col_description(a.attrelid,a.attnum) AS comment FROM pg_attribute a JOIN pg_class c ON c.oid=a.attrelid JOIN pg_namespace n ON n.oid=c.relnamespace LEFT JOIN pg_attrdef ad ON ad.adrelid=a.attrelid AND ad.adnum=a.attnum WHERE n.nspname=$1 AND a.attnum>0 AND NOT a.attisdropped AND c.relkind IN ('r','p','v','m','f') ORDER BY c.relname,a.attnum",[schema]),
      client.query("SELECT c.relname AS table_name, con.conname AS constraint_name, con.contype AS constraint_type FROM pg_constraint con JOIN pg_class c ON c.oid=con.conrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname=$1 ORDER BY c.relname,con.conname",[schema]),
      client.query('SELECT tablename AS table_name, indexname AS index_name FROM pg_indexes WHERE schemaname=$1 ORDER BY tablename,indexname',[schema]),
      client.query("SELECT p.proname AS function_name, p.pronargs::text AS argument_count, pg_get_function_result(p.oid) AS result_type, l.lanname AS language, p.prosecdef AS security_definer, p.provolatile AS volatility, obj_description(p.oid, 'pg_proc') AS comment FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace JOIN pg_language l ON l.oid=p.prolang WHERE n.nspname=$1 ORDER BY p.proname,p.pronargs",[schema]),
      client.query("SELECT c.relname AS table_name, t.tgname AS trigger_name, t.tgenabled AS enabled, t.tgtype::text AS trigger_type FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname=$1 AND NOT t.tgisinternal ORDER BY c.relname,t.tgname",[schema]),
      client.query('SELECT tablename AS table_name, policyname AS policy_name, permissive, roles, cmd FROM pg_policies WHERE schemaname=$1 ORDER BY tablename,policyname',[schema])
    ]);
    const catalog={relations:safeRows(rows(relations,'DATABASE_DICTIONARY_RELATIONS_INVALID')),columns:safeRows(rows(columns,'DATABASE_DICTIONARY_COLUMNS_INVALID')),constraints:safeRows(rows(constraints,'DATABASE_DICTIONARY_CONSTRAINTS_INVALID')),indexes:safeRows(rows(indexes,'DATABASE_DICTIONARY_INDEXES_INVALID')),functions:safeRows(rows(functions,'DATABASE_DICTIONARY_FUNCTIONS_INVALID')),triggers:safeRows(rows(triggers,'DATABASE_DICTIONARY_TRIGGERS_INVALID')),policies:safeRows(rows(policies,'DATABASE_DICTIONARY_POLICIES_INVALID'))};
    const dictionary={schema_version:'REFS_DATABASE_DICTIONARY_V1',generated_at:clock().toISOString(),database:{name:safeDatabaseDictionaryText(identity?.database_name),server_version_num:safeDatabaseDictionaryText(identity?.server_version_num),schema},migration_manifest:{count:MIGRATION_MANIFEST.length,sha256:migrationManifestHash(),applied_count:applied.length,applied},catalog};
    dictionary.catalog_sha256=digest({schema_version:dictionary.schema_version,database:dictionary.database,migration_manifest:dictionary.migration_manifest,catalog});
    await client.query('COMMIT');
    return dictionary;
  }catch(error){
    try{await client.query('ROLLBACK');}catch{}
    throw error;
  }finally{client.release();}
}
