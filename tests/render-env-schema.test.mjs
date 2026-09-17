// R27 / L22: the Blueprint must never carry literal secrets, duplicate keys, or
// API/static coordinate drift. Runs the static checker and requires zero problems.
import test from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
test('render.yaml / render.integrations.yaml pass the secret-free schema check',()=>{
  const out=execFileSync(process.execPath,[new URL('../tools/render-env-schema-check.mjs',import.meta.url).pathname,'--json'],{cwd:new URL('../',import.meta.url).pathname,encoding:'utf8'});
  const r=JSON.parse(out);assert.deepEqual(r.problems,[]);assert.ok(r.services.length>=5);
  for(const s of r.services)if(s.type==='web'&&/api/.test(s.name))assert.ok(s.secrets>=1,`${s.name} must take its database URL as a secret or link`);
});
