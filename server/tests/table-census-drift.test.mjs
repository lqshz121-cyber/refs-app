// N34: the repository carries no checked-in table dictionary, and nothing guarded the
// gap — a migration could add fifty tables and no test would fail. These two contracts
// close that. The census (db/TABLE-CENSUS.json) is the checked-in set of tables the
// migrations create; adding or removing a CREATE TABLE now forces the census to be
// updated in the same change, so schema growth can never again happen unobserved.
// The second contract closes the manifest's files -> manifest direction: migrations.mjs
// refuses an unlisted .sql at runtime, but no unit test asserted it, so a stray file
// only surfaced on a live migrate.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,readdirSync} from 'node:fs';
import {MIGRATION_MANIFEST} from '../runtime/migration-manifest.mjs';

const UP_DIR=new URL('../db/migrations/',import.meta.url);
const DOWN_DIR=new URL('../db/migrations/down/',import.meta.url);
const CENSUS=new URL('../db/TABLE-CENSUS.json',import.meta.url);
const sqlFiles=dir=>readdirSync(dir).filter(f=>f.endsWith('.sql')).sort();

function tablesFromMigrations(){
  const created=new Map();
  for(const file of sqlFiles(UP_DIR)){
    const sql=readFileSync(new URL(file,UP_DIR),'utf8');
    const re=/create\s+table\s+(?:if\s+not\s+exists\s+)?(?:public\.)?([a-z0-9_]+)/gi;
    let m;
    while((m=re.exec(sql))){
      const name=m[1].toLowerCase();
      if(!created.has(name))created.set(name,file);
    }
  }
  return created;
}

test('N34-1: every table a migration creates is recorded in db/TABLE-CENSUS.json',()=>{
  const census=JSON.parse(readFileSync(CENSUS,'utf8'));
  assert.equal(census.schema_version,'REFS_TABLE_CENSUS_V1');
  const created=tablesFromMigrations();
  const recorded=new Map(census.tables.map(t=>[t.name,t.created_by]));

  const missing=[...created.keys()].filter(n=>!recorded.has(n)).sort();
  assert.deepEqual(missing,[],`migrations create tables absent from TABLE-CENSUS.json: ${missing.join(', ')}`);

  const stale=[...recorded.keys()].filter(n=>!created.has(n)).sort();
  assert.deepEqual(stale,[],`TABLE-CENSUS.json records tables no migration creates: ${stale.join(', ')}`);

  const moved=[...created.entries()].filter(([n,f])=>recorded.get(n)!==f)
    .map(([n,f])=>`${n}: census says ${recorded.get(n)}, migrations say ${f}`);
  assert.deepEqual(moved,[],`TABLE-CENSUS.json attributes tables to the wrong migration:\n${moved.join('\n')}`);

  assert.equal(census.table_count,created.size,'table_count must equal the number of tables the migrations create');
  assert.equal(census.migration_head,sqlFiles(UP_DIR).at(-1),'migration_head must name the last migration in the chain');
});

test('N34-2: the migration directory and MIGRATION_MANIFEST list exactly the same files',()=>{
  const manifest=MIGRATION_MANIFEST.map(e=>e.name);
  const up=sqlFiles(UP_DIR);
  const down=sqlFiles(DOWN_DIR);

  // manifest -> files is already covered by postgres-runtime-contract; this asserts the
  // reverse, so an untracked .sql on disk fails here instead of only at migrate time.
  const unlistedUp=up.filter(f=>!manifest.includes(f));
  assert.deepEqual(unlistedUp,[],`up migrations absent from MIGRATION_MANIFEST: ${unlistedUp.join(', ')}`);
  const unlistedDown=down.filter(f=>!manifest.includes(f));
  assert.deepEqual(unlistedDown,[],`down migrations absent from MIGRATION_MANIFEST: ${unlistedDown.join(', ')}`);

  assert.deepEqual(up,manifest,'up migration files must equal MIGRATION_MANIFEST in the same order');
  assert.deepEqual(down,manifest,'every manifest entry must have a down migration, and there must be no extra ones');
  assert.equal(new Set(manifest).size,manifest.length,'MIGRATION_MANIFEST must not repeat a name');
});
