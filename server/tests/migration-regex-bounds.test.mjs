// 442: PostgreSQL regular expressions cap a bound {m,n} at 255 (RE_DUP_MAX). A larger bound is
// accepted when a function or CHECK is created and only fails, with 2201B, when it is evaluated,
// so no deploy step notices. 387 shipped {0,1023} and no webhook subscription could be created.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readdirSync,readFileSync} from 'node:fs';
import {join} from 'node:path';
const root=new URL('../db/migrations/',import.meta.url).pathname;
// A migration that is later repaired stays in the chain unchanged; the repair is named here and
// must itself be present, so the allowance cannot outlive the fix.
const REPAIRED={'387_webhook_subscription_authoritative.sql':'442_webhook_endpoint_path_regex_bound.sql'};
test('RXB-1 no migration writes a regex bound above 255 that is still live',()=>{
  const offenders=[];
  for(const dir of [root,join(root,'down')])for(const name of readdirSync(dir).filter(n=>/^\d+_.+\.sql$/.test(n))){
    const sql=readFileSync(join(dir,name),'utf8').replace(/--[^\n]*/g,'');
    for(const m of sql.matchAll(/\{(\d+)(?:,(\d*))?\}/g)){
      const bound=Math.max(Number(m[1]),m[2]?Number(m[2]):0);
      if(bound>255)offenders.push(`${dir===root?'':'down/'}${name}: ${m[0]}`);
    }
  }
  const live=offenders.filter(o=>!Object.keys(REPAIRED).some(n=>o.startsWith(n))&&!o.startsWith('442_')&&!o.startsWith('down/442_'));
  assert.deepEqual(live,[]);
  for(const fix of Object.values(REPAIRED))assert.ok(readdirSync(root).includes(fix),fix);
});

// 443: with standard_conforming_strings an ordinary literal keeps a backslash as written, so
// '\\.' reaches the regex engine as an escaped backslash followed by any character and rejects
// every canonical amount. A doubled backslash inside a bracket ('[/\\]') is a correct escape. 390 (repaired by 413) and 388 (repaired by 443) shipped this.
const DOUBLE_BACKSLASH_REPAIRED={'388_forecast_authoritative.sql':'443_forecast_line_amount_regex_fix.sql','390_recurring_scheduler_authoritative.sql':'413_recurring_scheduler_line_validation_fix.sql'};
test('RXB-2 no live regex match operand in an ordinary literal carries a doubled backslash',()=>{
  const offenders=[];
  for(const name of readdirSync(root).filter(n=>/^\d+_.+\.sql$/.test(n))){
    const sql=readFileSync(join(root,name),'utf8').replace(/--[^\n]*/g,'');
    for(const m of sql.matchAll(/!?~\*?\s*(E?)'((?:[^']|'')*)'/g))if(m[1]===''&&/\\\\[.dDsSwW]/.test(m[2]))offenders.push(`${name}: ${m[0].slice(0,60)}`);
  }
  const live=offenders.filter(o=>!Object.keys(DOUBLE_BACKSLASH_REPAIRED).some(n=>o.startsWith(n))&&!Object.values(DOUBLE_BACKSLASH_REPAIRED).some(n=>o.startsWith(n)));
  assert.deepEqual(live,[]);
  for(const fix of Object.values(DOUBLE_BACKSLASH_REPAIRED))assert.ok(readdirSync(root).includes(fix),fix);
});
