import {createHash} from 'node:crypto';
import {readFile} from 'node:fs/promises';

const sourcePath=new URL('../tests/postgres-kernel.test.mjs',import.meta.url);
const source=await readFile(sourcePath,'utf8');
const required=[
  "const prior=(await client.query('SELECT to_regprocedure($1) fn',[signature])).rows[0].fn;",
  "assert.equal((await client.query('SELECT to_regprocedure($1) fn',[signature])).rows[0].fn,prior);"
];
for(const marker of required){
  if(!source.includes(marker))throw new Error('PostgreSQL CI checkout is missing the historical migration round-trip restoration guard.');
}
const sha=createHash('sha256').update(source).digest('hex');
console.log(`postgres-ci-checkout: PASS git_sha=${process.env.GITHUB_SHA||'local'} postgres_kernel_sha256=${sha} restoration_guard=present`);
